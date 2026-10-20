"""Spike: random GRU + tree-ensemble weights, an ONNX export of the same weights, and a NumPy reference.

Writes to spike/rust/fixtures/ (gitignored, regenerate with `uv run python export_model.py`):
  gru.bin        little-endian f32: W[3H*I] R[3H*H] Wb[3H] Rb[3H] head_w[H] head_b[1]  (ONNX gate order z, r, h)
  trees.bin      u32 n_trees, u32 nodes_per_tree, then per node: i32 feature (-1 = leaf), f32 threshold,
                 i32 left, i32 right, f32 value   (x <= threshold goes left, as in LightGBM)
  inputs.bin     f32 [N_LGU, SEQ, I] (batch-major)
  gru.onnx       GRU(linear_before_reset=1) -> last hidden -> MatMul + Add        (input X: [SEQ, N, I])
  trees.onnx     ai.onnx.ml TreeEnsembleRegressor on the last time step           (input X: [N, I])
  ref_gru.bin, ref_trees.bin   f32 [N] NumPy float64 references (cast to f32)
"""

import pathlib
import struct

import numpy as np
import onnx
from onnx import TensorProto, helper

H, I, SEQ, N_LGU = 32, 30, 14, 1640
N_TREES, DEPTH = 100, 6
OUT = pathlib.Path(__file__).resolve().parent.parent / "rust" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(20261021)

# GRU weights, ONNX layout (gates stacked z, r, h)
W = (rng.standard_normal((3 * H, I)) * (1 / np.sqrt(I))).astype(np.float32)
R = (rng.standard_normal((3 * H, H)) * (1 / np.sqrt(H))).astype(np.float32)
Wb = (rng.standard_normal(3 * H) * 0.1).astype(np.float32)
Rb = (rng.standard_normal(3 * H) * 0.1).astype(np.float32)
head_w = (rng.standard_normal(H) * 0.3).astype(np.float32)
head_b = np.float32(0.25)
X = rng.standard_normal((N_LGU, SEQ, I)).astype(np.float32)

with open(OUT / "gru.bin", "wb") as f:
    for a in (W, R, Wb, Rb, head_w, np.array([head_b], np.float32)):
        f.write(np.ascontiguousarray(a, dtype="<f4").tobytes())
(OUT / "inputs.bin").write_bytes(np.ascontiguousarray(X, dtype="<f4").tobytes())


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def gru_ref(X):
    Wd, Rd, Wbd, Rbd = (a.astype(np.float64) for a in (W, R, Wb, Rb))
    h = np.zeros((X.shape[0], H))
    for t in range(SEQ):
        x = X[:, t, :].astype(np.float64)
        gx = x @ Wd.T + Wbd
        gh = h @ Rd.T + Rbd
        z = sigmoid(gx[:, :H] + gh[:, :H])
        r = sigmoid(gx[:, H : 2 * H] + gh[:, H : 2 * H])
        n = np.tanh(gx[:, 2 * H :] + r * gh[:, 2 * H :])
        h = (1 - z) * n + z * h
    return h @ head_w.astype(np.float64) + float(head_b)


# Trees: complete binary trees of depth DEPTH, breadth-first node ids
nodes_per_tree = 2 ** (DEPTH + 1) - 1
feat = np.full((N_TREES, nodes_per_tree), -1, np.int32)
thr = np.zeros((N_TREES, nodes_per_tree), np.float32)
left = np.full((N_TREES, nodes_per_tree), -1, np.int32)
right = np.full((N_TREES, nodes_per_tree), -1, np.int32)
val = np.zeros((N_TREES, nodes_per_tree), np.float32)
n_internal = 2**DEPTH - 1
for t in range(N_TREES):
    for n in range(nodes_per_tree):
        if n < n_internal:
            feat[t, n] = rng.integers(0, I)
            thr[t, n] = np.float32(rng.standard_normal() * 0.8)
            left[t, n], right[t, n] = 2 * n + 1, 2 * n + 2
        else:
            val[t, n] = np.float32(rng.standard_normal() * 0.05)

with open(OUT / "trees.bin", "wb") as f:
    f.write(struct.pack("<II", N_TREES, nodes_per_tree))
    for t in range(N_TREES):
        for n in range(nodes_per_tree):
            f.write(struct.pack("<ifiif", feat[t, n], thr[t, n], left[t, n], right[t, n], val[t, n]))


def trees_ref(Xlast):
    out = np.zeros(Xlast.shape[0])
    for i, x in enumerate(Xlast):
        s = 0.0
        for t in range(N_TREES):
            n = 0
            while feat[t, n] >= 0:
                n = left[t, n] if x[feat[t, n]] <= thr[t, n] else right[t, n]
            s += float(val[t, n])
        out[i] = s
    return out


ref_gru = gru_ref(X).astype(np.float32)
ref_trees = trees_ref(X[:, -1, :]).astype(np.float32)
(OUT / "ref_gru.bin").write_bytes(ref_gru.astype("<f4").tobytes())
(OUT / "ref_trees.bin").write_bytes(ref_trees.astype("<f4").tobytes())

# ---- ONNX: GRU
init = [
    helper.make_tensor("W", TensorProto.FLOAT, [1, 3 * H, I], W.flatten()),
    helper.make_tensor("R", TensorProto.FLOAT, [1, 3 * H, H], R.flatten()),
    helper.make_tensor("B", TensorProto.FLOAT, [1, 6 * H], np.concatenate([Wb, Rb])),
    helper.make_tensor("head_w", TensorProto.FLOAT, [H, 1], head_w),
    helper.make_tensor("head_b", TensorProto.FLOAT, [1], [head_b]),
    helper.make_tensor("axes0", TensorProto.INT64, [1], [0]),
]
nodes = [
    helper.make_node("GRU", ["X", "W", "R", "B"], ["Y", "Y_h"], hidden_size=H, linear_before_reset=1),
    helper.make_node("Squeeze", ["Y_h", "axes0"], ["h_last"]),  # [N, H]
    helper.make_node("MatMul", ["h_last", "head_w"], ["mm"]),  # [N, 1]
    helper.make_node("Add", ["mm", "head_b"], ["out"]),
]
g = helper.make_graph(
    nodes,
    "gru_spike",
    [helper.make_tensor_value_info("X", TensorProto.FLOAT, [SEQ, N_LGU, I])],
    [helper.make_tensor_value_info("out", TensorProto.FLOAT, [N_LGU, 1])],
    init,
)
m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)], producer_name="lgu-lights-spike")
m.ir_version = 8
onnx.checker.check_model(m)
onnx.save(m, OUT / "gru.onnx")

# ---- ONNX: trees (TreeEnsembleRegressor, ai.onnx.ml v3)
nodes_treeids, nodes_nodeids, nodes_featureids, nodes_values, nodes_modes = [], [], [], [], []
nodes_true, nodes_false = [], []
t_ids, t_nodeids, t_weights = [], [], []
for t in range(N_TREES):
    for n in range(nodes_per_tree):
        nodes_treeids.append(t)
        nodes_nodeids.append(n)
        if feat[t, n] >= 0:
            nodes_featureids.append(int(feat[t, n]))
            nodes_values.append(float(thr[t, n]))
            nodes_modes.append("BRANCH_LEQ")
            nodes_true.append(int(left[t, n]))
            nodes_false.append(int(right[t, n]))
        else:
            nodes_featureids.append(0)
            nodes_values.append(0.0)
            nodes_modes.append("LEAF")
            nodes_true.append(0)
            nodes_false.append(0)
            t_ids.append(t)
            t_nodeids.append(n)
            t_weights.append(float(val[t, n]))
tnode = helper.make_node(
    "TreeEnsembleRegressor",
    ["Xl"],
    ["yt"],
    domain="ai.onnx.ml",
    n_targets=1,
    aggregate_function="SUM",
    nodes_treeids=nodes_treeids,
    nodes_nodeids=nodes_nodeids,
    nodes_featureids=nodes_featureids,
    nodes_values=nodes_values,
    nodes_modes=nodes_modes,
    nodes_truenodeids=nodes_true,
    nodes_falsenodeids=nodes_false,
    target_ids=[0] * len(t_ids),
    target_treeids=t_ids,
    target_nodeids=t_nodeids,
    target_weights=t_weights,
)
gt = helper.make_graph(
    [tnode],
    "trees_spike",
    [helper.make_tensor_value_info("Xl", TensorProto.FLOAT, [N_LGU, I])],
    [helper.make_tensor_value_info("yt", TensorProto.FLOAT, [N_LGU, 1])],
)
mt = helper.make_model(
    gt,
    opset_imports=[helper.make_opsetid("", 17), helper.make_opsetid("ai.onnx.ml", 3)],
    producer_name="lgu-lights-spike",
)
mt.ir_version = 8
onnx.checker.check_model(mt)
onnx.save(mt, OUT / "trees.onnx")

# ---- Sanity: onnxruntime vs NumPy
import onnxruntime as ort  # noqa: E402

o = ort.InferenceSession(str(OUT / "gru.onnx")).run(None, {"X": np.transpose(X, (1, 0, 2)).copy()})[0][:, 0]
ot = ort.InferenceSession(str(OUT / "trees.onnx")).run(None, {"Xl": X[:, -1, :].copy()})[0][:, 0]
print(f"onnxruntime vs numpy  GRU max|d|={np.abs(o - ref_gru).max():.2e}  trees max|d|={np.abs(ot - ref_trees).max():.2e}")
print(f"ref_gru range [{ref_gru.min():.3f}, {ref_gru.max():.3f}]  ref_trees range [{ref_trees.min():.3f}, {ref_trees.max():.3f}]")
print("params: GRU", W.size + R.size + Wb.size + Rb.size + head_w.size + 1, " tree nodes", N_TREES * nodes_per_tree)
