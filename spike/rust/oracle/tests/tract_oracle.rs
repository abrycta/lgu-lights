//! The hand-written GRU and trees must equal tract running the ONNX export of the same weights (|d| ≤ 1e-5).
use spike_infer::*;
use tract_onnx::prelude::*;

fn fx(n: &str) -> Vec<u8> {
    std::fs::read(format!("{}/../fixtures/{n}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn max_diff(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max)
}

fn ours() -> (Vec<f32>, Vec<f32>, Vec<f32>) {
    let inputs = f32_vec(&fx("inputs.bin"));
    let n = inputs.len() / (SEQ * I);
    let (mut og, mut ot) = (vec![0.0; n], vec![0.0; n]);
    predict_all(&Gru::from_bytes(&fx("gru.bin")), &Trees::from_bytes(&fx("trees.bin")), &inputs, &mut og, &mut ot);
    (inputs, og, ot)
}

#[test]
fn gru_matches_tract() -> TractResult<()> {
    let (inputs, og, _) = ours();
    let n = og.len();
    // [N, SEQ, I] -> [SEQ, N, I]
    let mut x = vec![0f32; inputs.len()];
    for b in 0..n {
        for t in 0..SEQ {
            for k in 0..I {
                x[(t * n + b) * I + k] = inputs[(b * SEQ + t) * I + k];
            }
        }
    }
    let t0 = std::time::Instant::now();
    let model = tract_onnx::onnx()
        .model_for_path(format!("{}/../fixtures/gru.onnx", env!("CARGO_MANIFEST_DIR")))?
        .into_optimized()?
        .into_runnable()?;
    let xt = tract_ndarray::Array3::from_shape_vec((SEQ, n, I), x)?.into_tensor();
    let res = model.run(tvec!(xt.into()))?;
    let y = res[0].to_plain_array_view::<f32>()?.iter().copied().collect::<Vec<_>>();
    let d = max_diff(&og, &y);
    eprintln!("GRU: tract (load+optimise+run {:?}) vs hand-written max|d| = {d:.3e} over {n} LGUs", t0.elapsed());
    assert!(d <= 1e-5, "GRU diverges: {d}");
    Ok(())
}

/// tract 0.23.9 cannot run ai.onnx.ml TreeEnsembleRegressor ("Unimplemented(TreeEnsembleRegressor)
/// ToTypedTranslator"), so this test pins that fact and checks the trees against the NumPy reference,
/// which itself equals onnxruntime 1.31 on trees.onnx to 2.4e-7 (export_model.py).
#[test]
fn trees_match_reference() {
    let (_, _, ot) = ours();
    let err = tract_onnx::onnx()
        .model_for_path(format!("{}/../fixtures/trees.onnx", env!("CARGO_MANIFEST_DIR")))
        .and_then(|m| m.into_optimized())
        .err()
        .map(|e| format!("{e:?}"));
    eprintln!("tract on trees.onnx: {}", err.as_deref().unwrap_or("OK (now supported: switch this test to tract)"));
    let r = f32_vec(&fx("ref_trees.bin"));
    let d = max_diff(&ot, &r);
    eprintln!("Trees: numpy/onnxruntime reference vs hand-written max|d| = {d:.3e} over {} LGUs", ot.len());
    assert!(d <= 1e-5, "trees diverge: {d}");
}
