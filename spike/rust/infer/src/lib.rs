//! Spike: hand-written GRU forward pass and tree-ensemble evaluator (no dependencies).
//!
//! GRU semantics follow ONNX `GRU` with `linear_before_reset = 1` (the PyTorch/Keras-v3 form):
//!   z = σ(W_z x + Wb_z + R_z h + Rb_z)
//!   r = σ(W_r x + Wb_r + R_r h + Rb_r)
//!   n = tanh(W_h x + Wb_h + r ⊙ (R_h h + Rb_h))
//!   h' = (1 − z) ⊙ n + z ⊙ h
//! followed by a linear head on the last hidden state.

pub const H: usize = 32;
pub const I: usize = 30;
pub const SEQ: usize = 14;
const G: usize = 3 * H;

pub struct Gru {
    w: Vec<f32>,  // [3H, I]
    r: Vec<f32>,  // [3H, H]
    wb: Vec<f32>, // [3H]
    rb: Vec<f32>, // [3H]
    head_w: Vec<f32>,
    head_b: f32,
}

fn f32s(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

#[inline(always)]
fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

impl Gru {
    pub fn from_bytes(b: &[u8]) -> Gru {
        let v = f32s(b);
        let mut o = 0;
        let mut take = |n: usize| {
            let s = v[o..o + n].to_vec();
            o += n;
            s
        };
        let w = take(G * I);
        let r = take(G * H);
        let wb = take(G);
        let rb = take(G);
        let head_w = take(H);
        let head_b = take(1)[0];
        Gru { w, r, wb, rb, head_w, head_b }
    }

    /// `x` is one LGU's sequence, `[SEQ, I]` row-major. Returns the head output.
    pub fn forward(&self, x: &[f32]) -> f32 {
        debug_assert_eq!(x.len(), SEQ * I);
        let mut h = [0f32; H];
        let mut gx = [0f32; G];
        let mut gh = [0f32; G];
        for t in 0..SEQ {
            let xt = &x[t * I..(t + 1) * I];
            for g in 0..G {
                let row = &self.w[g * I..(g + 1) * I];
                let mut s = self.wb[g];
                for k in 0..I {
                    s += row[k] * xt[k];
                }
                gx[g] = s;
                let row = &self.r[g * H..(g + 1) * H];
                let mut s = self.rb[g];
                for k in 0..H {
                    s += row[k] * h[k];
                }
                gh[g] = s;
            }
            for j in 0..H {
                let z = sigmoid(gx[j] + gh[j]);
                let r = sigmoid(gx[H + j] + gh[H + j]);
                let n = (gx[2 * H + j] + r * gh[2 * H + j]).tanh();
                h[j] = (1.0 - z) * n + z * h[j];
            }
        }
        let mut y = self.head_b;
        for j in 0..H {
            y += self.head_w[j] * h[j];
        }
        y
    }
}

#[derive(Clone, Copy)]
struct Node {
    feature: i32, // -1 = leaf
    threshold: f32,
    left: u32,
    right: u32,
    value: f32,
}

pub struct Trees {
    nodes: Vec<Node>,
    n_trees: usize,
    per_tree: usize,
}

impl Trees {
    pub fn from_bytes(b: &[u8]) -> Trees {
        let n_trees = u32::from_le_bytes(b[0..4].try_into().unwrap()) as usize;
        let per_tree = u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize;
        let nodes = b[8..]
            .chunks_exact(20)
            .map(|c| Node {
                feature: i32::from_le_bytes(c[0..4].try_into().unwrap()),
                threshold: f32::from_le_bytes(c[4..8].try_into().unwrap()),
                left: i32::from_le_bytes(c[8..12].try_into().unwrap()).max(0) as u32,
                right: i32::from_le_bytes(c[12..16].try_into().unwrap()).max(0) as u32,
                value: f32::from_le_bytes(c[16..20].try_into().unwrap()),
            })
            .collect::<Vec<_>>();
        assert_eq!(nodes.len(), n_trees * per_tree);
        Trees { nodes, n_trees, per_tree }
    }

    /// Sum of leaf values; `x <= threshold` goes left (LightGBM convention).
    pub fn predict(&self, x: &[f32]) -> f32 {
        let mut s = 0.0f32;
        for t in 0..self.n_trees {
            let tree = &self.nodes[t * self.per_tree..(t + 1) * self.per_tree];
            let mut n = 0usize;
            loop {
                let nd = tree[n];
                if nd.feature < 0 {
                    s += nd.value;
                    break;
                }
                n = if x[nd.feature as usize] <= nd.threshold { nd.left } else { nd.right } as usize;
            }
        }
        s
    }
}

pub fn f32_vec(b: &[u8]) -> Vec<f32> {
    f32s(b)
}

/// Runs both models over every LGU in `inputs` (`[N, SEQ, I]`), writing GRU and tree outputs.
pub fn predict_all(gru: &Gru, trees: &Trees, inputs: &[f32], out_gru: &mut [f32], out_trees: &mut [f32]) {
    for (i, x) in inputs.chunks_exact(SEQ * I).enumerate() {
        out_gru[i] = gru.forward(x);
        out_trees[i] = trees.predict(&x[(SEQ - 1) * I..]);
    }
}

// ---- wasm32 exports (no wasm-bindgen: plain C ABI, timed from JS) ----
#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use std::sync::OnceLock;

    static GRU_BYTES: &[u8] = include_bytes!("../../fixtures/gru.bin");
    static TREE_BYTES: &[u8] = include_bytes!("../../fixtures/trees.bin");
    static INPUT_BYTES: &[u8] = include_bytes!("../../fixtures/inputs.bin");

    struct State {
        gru: Gru,
        trees: Trees,
        inputs: Vec<f32>,
        out_gru: Vec<f32>,
        out_trees: Vec<f32>,
    }
    static mut STATE: OnceLock<State> = OnceLock::new();

    #[allow(static_mut_refs)]
    fn st() -> &'static mut State {
        unsafe {
            STATE.get_or_init(|| {
                let inputs = f32_vec(INPUT_BYTES);
                let n = inputs.len() / (SEQ * I);
                State {
                    gru: Gru::from_bytes(GRU_BYTES),
                    trees: Trees::from_bytes(TREE_BYTES),
                    inputs,
                    out_gru: vec![0.0; n],
                    out_trees: vec![0.0; n],
                }
            });
            STATE.get_mut().unwrap()
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn init() -> u32 {
        (st().inputs.len() / (SEQ * I)) as u32
    }
    /// GRU + trees for one LGU (index `i`), repeated `reps` times; returns the last GRU output.
    #[unsafe(no_mangle)]
    pub extern "C" fn one(i: u32, reps: u32) -> f32 {
        let s = st();
        let x = &s.inputs[i as usize * SEQ * I..(i as usize + 1) * SEQ * I];
        let mut y = 0.0;
        for _ in 0..reps {
            y = s.gru.forward(core::hint::black_box(x)) + s.trees.predict(&x[(SEQ - 1) * I..]);
        }
        y
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn gru_one(i: u32, reps: u32) -> f32 {
        let s = st();
        let x = &s.inputs[i as usize * SEQ * I..(i as usize + 1) * SEQ * I];
        let mut y = 0.0;
        for _ in 0..reps {
            y = s.gru.forward(core::hint::black_box(x));
        }
        y
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn all() -> u32 {
        let s = st();
        predict_all(&s.gru, &s.trees, &s.inputs, &mut s.out_gru, &mut s.out_trees);
        s.out_gru.len() as u32
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn out_gru_ptr() -> *const f32 {
        st().out_gru.as_ptr()
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn out_trees_ptr() -> *const f32 {
        st().out_trees.as_ptr()
    }
}
