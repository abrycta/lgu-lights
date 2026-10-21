//! Reliability tiers (DECISIONS Q9) and the fixed classification breaks used by map, legend and table.

/// CV <= 10 % reliable, 10-20 % use with caution, > 20 % unreliable (PSA's 20 % line).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Tier {
    Reliable = 0,
    Caution = 1,
    Unreliable = 2,
}

pub fn cv_tier(cv_percent: f64) -> Tier {
    if cv_percent.is_nan() || cv_percent > 20.0 {
        Tier::Unreliable
    } else if cv_percent > 10.0 {
        Tier::Caution
    } else {
        Tier::Reliable
    }
}

/// Fixed round-number breaks (percent poverty incidence) applied to every year, so maps compare
/// across years (ARCHITECTURE-RESEARCH §5): five classes, < 10, 10-20, 20-30, 30-40, >= 40.
pub const BREAKS: [f64; 4] = [10.0, 20.0, 30.0, 40.0];

pub fn class_of(value: f64) -> u8 {
    BREAKS.iter().take_while(|&&b| value >= b).count() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_boundaries_follow_psa_language() {
        assert_eq!(cv_tier(10.0), Tier::Reliable);
        assert_eq!(cv_tier(10.01), Tier::Caution);
        assert_eq!(cv_tier(20.0), Tier::Caution);
        assert_eq!(cv_tier(20.5), Tier::Unreliable);
        assert_eq!(cv_tier(f64::NAN), Tier::Unreliable);
        assert_eq!(cv_tier(f64::INFINITY), Tier::Unreliable);
    }

    #[test]
    fn classes_are_left_closed() {
        assert_eq!(class_of(0.0), 0);
        assert_eq!(class_of(9.99), 0);
        assert_eq!(class_of(10.0), 1);
        assert_eq!(class_of(45.0), 4);
    }
}
