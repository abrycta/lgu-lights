//! Native timing + check against the NumPy references. Run from spike/rust:
//!   cargo run -j 2 --release -p spike-infer --bin bench
use spike_infer::*;
use std::hint::black_box;
use std::time::Instant;

fn main() {
    let fx = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/");
    let rd = |n: &str| std::fs::read(format!("{fx}{n}")).unwrap();
    let gru = Gru::from_bytes(&rd("gru.bin"));
    let trees = Trees::from_bytes(&rd("trees.bin"));
    let inputs = f32_vec(&rd("inputs.bin"));
    let ref_gru = f32_vec(&rd("ref_gru.bin"));
    let ref_trees = f32_vec(&rd("ref_trees.bin"));
    let n = inputs.len() / (SEQ * I);
    let (mut og, mut ot) = (vec![0.0; n], vec![0.0; n]);
    predict_all(&gru, &trees, &inputs, &mut og, &mut ot);
    let dg = og.iter().zip(&ref_gru).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
    let dt = ot.iter().zip(&ref_trees).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
    println!("n_lgu={n}  max|rust-numpy| GRU={dg:.2e} trees={dt:.2e}");

    // one LGU, GRU only and GRU+trees
    let x = &inputs[..SEQ * I];
    for (label, f) in [
        ("gru_one", &(|| gru.forward(black_box(x))) as &dyn Fn() -> f32),
        ("trees_one", &(|| trees.predict(black_box(&x[(SEQ - 1) * I..])))),
        ("gru+trees_one", &(|| gru.forward(black_box(x)) + trees.predict(&x[(SEQ - 1) * I..]))),
    ] {
        let reps = 20_000;
        let mut best = f64::MAX;
        for _ in 0..5 {
            let t = Instant::now();
            for _ in 0..reps {
                black_box(f());
            }
            best = best.min(t.elapsed().as_secs_f64() / reps as f64);
        }
        println!("{label}: {:.2} µs (best of 5 × {reps})", best * 1e6);
    }
    let mut times = vec![];
    for _ in 0..30 {
        let t = Instant::now();
        predict_all(&gru, &trees, black_box(&inputs), &mut og, &mut ot);
        times.push(t.elapsed().as_secs_f64() * 1e3);
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("all {n} LGUs (GRU+trees): median {:.3} ms, min {:.3} ms (30 runs)", times[15], times[0]);
}
