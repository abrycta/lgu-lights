//! LightGBM tree-ensemble evaluator (numerical splits), the runtime twin of `lightgbm.Booster.predict`.
//!
//! Semantics follow LightGBM's `Tree::NumericalDecision`: `decision_type` bit 1 = default left, bits 2-3
//! = missing type (0 none, 1 zero, 2 NaN). With missing type other than NaN a NaN input is treated as
//! 0.0; with missing type zero, |x| <= 1e-35 goes the default way; with missing type NaN, NaN goes the
//! default way; otherwise `x <= threshold` goes left. Child indices < 0 are leaves (`!index`).
//! Categorical splits are rejected at load time (the trainer never produces them).

use serde::Deserialize;

const K_ZERO_THRESHOLD: f64 = 1e-35;

#[derive(Debug, Clone, Deserialize)]
pub struct Tree {
    pub split_feature: Vec<u32>,
    pub threshold: Vec<f64>,
    pub decision_type: Vec<u8>,
    pub left_child: Vec<i32>,
    pub right_child: Vec<i32>,
    pub leaf_value: Vec<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Forest {
    pub n_features: usize,
    pub trees: Vec<Tree>,
    /// Ensembles of several boosters are averaged: prediction = sum(trees) * scale.
    #[serde(default = "one")]
    pub scale: f64,
}

fn one() -> f64 {
    1.0
}

#[derive(Debug, PartialEq)]
pub enum ForestError {
    Categorical,
    Malformed(&'static str),
}

impl Tree {
    #[inline]
    pub fn predict(&self, x: &[f64]) -> f64 {
        if self.split_feature.is_empty() {
            return self.leaf_value[0];
        }
        let mut node: i32 = 0;
        while node >= 0 {
            let n = node as usize;
            let mut v = x[self.split_feature[n] as usize];
            let dt = self.decision_type[n];
            let missing = (dt >> 2) & 3;
            if missing != 2 && v.is_nan() {
                v = 0.0;
            }
            let go_default =
                (missing == 1 && v.abs() <= K_ZERO_THRESHOLD) || (missing == 2 && v.is_nan());
            node = if go_default {
                if dt & 2 != 0 {
                    self.left_child[n]
                } else {
                    self.right_child[n]
                }
            } else if v <= self.threshold[n] {
                self.left_child[n]
            } else {
                self.right_child[n]
            };
        }
        self.leaf_value[!node as usize]
    }
}

impl Forest {
    pub fn from_json(s: &str) -> Result<Forest, String> {
        let f: Forest = serde_json::from_str(s).map_err(|e| e.to_string())?;
        f.validate().map_err(|e| format!("{e:?}"))?;
        Ok(f)
    }

    pub fn validate(&self) -> Result<(), ForestError> {
        for t in &self.trees {
            let n = t.split_feature.len();
            if t.threshold.len() != n
                || t.decision_type.len() != n
                || t.left_child.len() != n
                || t.right_child.len() != n
            {
                return Err(ForestError::Malformed("node arrays differ in length"));
            }
            if t.leaf_value.len() != n + 1 {
                return Err(ForestError::Malformed(
                    "a tree needs one more leaf than internal nodes",
                ));
            }
            if t.decision_type.iter().any(|d| d & 1 != 0) {
                return Err(ForestError::Categorical);
            }
            if t.split_feature
                .iter()
                .any(|&f| f as usize >= self.n_features)
            {
                return Err(ForestError::Malformed("split feature out of range"));
            }
            let in_range = |c: &i32| {
                if *c >= 0 {
                    (*c as usize) < n
                } else {
                    (!*c as usize) <= n
                }
            };
            if !t.left_child.iter().chain(&t.right_child).all(in_range) {
                return Err(ForestError::Malformed("child index out of range"));
            }
        }
        Ok(())
    }

    #[inline]
    pub fn predict(&self, x: &[f64]) -> f64 {
        debug_assert_eq!(x.len(), self.n_features);
        let mut s = 0.0;
        for t in &self.trees {
            s += t.predict(x);
        }
        s * self.scale
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stump(dt: u8) -> Forest {
        Forest {
            n_features: 1,
            scale: 1.0,
            trees: vec![Tree {
                split_feature: vec![0],
                threshold: vec![0.5],
                decision_type: vec![dt],
                left_child: vec![-1],
                right_child: vec![-2],
                leaf_value: vec![-1.0, 1.0],
            }],
        }
    }

    #[test]
    fn numerical_split_and_missing_semantics() {
        // missing type NaN (bits 2-3 = 2), default left (bit 1)
        let f = stump(0b1010);
        assert_eq!(f.predict(&[0.2]), -1.0);
        assert_eq!(f.predict(&[0.5]), -1.0); // <= goes left
        assert_eq!(f.predict(&[0.9]), 1.0);
        assert_eq!(f.predict(&[f64::NAN]), -1.0);
        // missing type NaN, default right
        assert_eq!(stump(0b1000).predict(&[f64::NAN]), 1.0);
        // missing type none: NaN is treated as 0.0 -> left
        assert_eq!(stump(0).predict(&[f64::NAN]), -1.0);
        // missing type zero, default right: zero goes right although 0 <= 0.5
        assert_eq!(stump(0b0100).predict(&[0.0]), 1.0);
    }

    #[test]
    fn rejects_categorical_and_bad_children() {
        assert_eq!(stump(1).validate(), Err(ForestError::Categorical));
        let mut f = stump(0);
        f.trees[0].left_child = vec![5];
        assert!(f.validate().is_err());
    }
}
