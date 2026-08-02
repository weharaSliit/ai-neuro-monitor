import json
import pickle
import warnings
import numpy as np
from pathlib import Path
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    accuracy_score, balanced_accuracy_score,
    f1_score, roc_auc_score, average_precision_score,
)
import torch
import torch.nn as nn

warnings.filterwarnings("ignore")

UNIFIED_OUTPUT_DIR = Path(
    "/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/Research"
    "/ai-neuro-monitor/eeg/data/unified_output"
)
MODELS_DIR = UNIFIED_OUTPUT_DIR / "models"
SOFT_DIR   = UNIFIED_OUTPUT_DIR / "soft_logits"

N_CHANNELS  = 2
N_FEATURES  = 15
N_FEAT_FLAT = N_CHANNELS * N_FEATURES   # 30 — base student features
N_FEAT_EXT  = 76                         # extended: base+spectral_ext+nonlinear+connectivity

TEST_SIZE    = 0.20
RANDOM_STATE = 42

KNN_K         = 7
KNN_SUBSAMPLE = 8_000   # ball_tree k=7 query saturates below 10k at 30 dims

MLP_HIDDEN    = 64
MLP_DROPOUT   = 0.30
MLP_EPOCHS    = 80
MLP_LR        = 1e-3
MLP_BATCH     = 256
MLP_FOCAL_G   = 2.0    # focal loss gamma — down-weights easy negatives

CNN_HIDDEN    = 64     # BiLSTM hidden units (x2 bidirectional)
CNN_DROPOUT   = 0.35
CNN_EPOCHS    = 80
CNN_LR        = 5e-4
CNN_BATCH     = 128
CNN_SEQ_LEN   = 10     # consecutive epoch sequence for temporal modelling
CNN_FOCAL_G   = 2.0

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

np.random.seed(RANDOM_STATE)


# ═══════════════════════════════════════════════════════════════════
#  DATA LOADING
# ═══════════════════════════════════════════════════════════════════

def load_student_data(npz_path=None, use_extended=False):
    """
    Load F_student (or F_student_ext) + y_emo.
    Returns X, y_emo, subject_id, source.
    """
    if npz_path is None:
        npz_path = UNIFIED_OUTPUT_DIR / "features_dataset.npz"
    if not Path(npz_path).exists():
        return _synthetic_data()

    d          = np.load(npz_path, allow_pickle=True)
    feat_key   = "F_student_ext" if (use_extended and "F_student_ext" in d) else "F_student"
    X          = d[feat_key].astype(np.float32)
    y_emo      = d["y_emo"].astype(np.int64)
    subject_id = d["subject_id"].astype(np.int32)
    source     = d["source"]

    print(f"  {feat_key}: {X.shape}")
    print(f"  y_emo: pos={int(y_emo.sum()):,}  bal={y_emo.mean():.2%}  (DEAP+SAM40)")
    return X, y_emo, subject_id, source


def _synthetic_data():
    rng = np.random.default_rng(RANDOM_STATE)
    E_d = 400; E_s = 200; E = E_d + E_s
    X   = rng.standard_normal((E, N_FEAT_FLAT)).astype(np.float32)
    ye  = np.concatenate([(rng.random(E_d) < 0.24).astype(np.int64),
                           (rng.random(E_s) < 0.79).astype(np.int64)])
    src = np.array(["deap"] * E_d + ["sam40"] * E_s)
    sid = np.concatenate([np.repeat(np.arange(20), E_d // 20),
                           np.repeat(np.arange(20, 40), E_s // 20)]).astype(np.int32)
    X[ye == 1, 8] += 1.5
    return X, ye, sid, src


def load_soft_logits(soft_dir=SOFT_DIR):
    """Load soft logits from teacher (emo only)."""
    soft_dir = Path(soft_dir)
    for f in ["soft_emo.npy", "y_emo.npy", "source.npy"]:
        if not (soft_dir / f).exists():
            raise FileNotFoundError(
                f"Missing: {soft_dir / f}\nRun teacher_model.py first.")
    return (np.load(soft_dir / "soft_emo.npy").astype(np.float32),
            np.load(soft_dir / "y_emo.npy").astype(np.int64),
            np.load(soft_dir / "source.npy", allow_pickle=True))


# ═══════════════════════════════════════════════════════════════════
#  KNN STUDENT
# ═══════════════════════════════════════════════════════════════════

class StudentKNN:
    """
    Single-head KNN student (T7+T8 wearable, y_emo only).
    Distilled from teacher's soft logits via weighted resampling.
    """
    def __init__(self, k=KNN_K):
        self.k = k
        self.knn_emo = Pipeline([
            ("sc",  StandardScaler()),
            ("clf", KNeighborsClassifier(
                n_neighbors=k, metric="euclidean",
                weights="distance", algorithm="ball_tree", n_jobs=-1,
            )),
        ])

    def _weighted_resample(self, X, y, weights, rng):
        w = weights.clip(1e-3, None)
        p = w / w.sum()
        idx = rng.choice(len(X), size=len(X), replace=True, p=p)
        return X[idx], y[idx]

    def fit(self, X, ye, soft_emo=None):
        rng = np.random.default_rng(RANDOM_STATE)
        Xr, yer = (self._weighted_resample(X, ye, soft_emo, rng)
                   if soft_emo is not None else (X, ye))
        print(f"  [StudentKNN k={self.k}] emo on {len(Xr):,} "
              f"(pos={int(yer.sum()):,} = {yer.mean():.1%}) ...")
        self.knn_emo.fit(Xr, yer)
        return self

    def predict_proba(self, X):
        return self.knn_emo.predict_proba(X)[:, 1].astype(np.float32)

    def predict(self, X):
        return self.knn_emo.predict(X)

    def save(self, p):
        with open(p, "wb") as f: pickle.dump(self, f)

    @staticmethod
    def load(p):
        with open(p, "rb") as f: return pickle.load(f)


# ═══════════════════════════════════════════════════════════════════
#  MLP STUDENT  (replaces KNN — better cross-subject generalisation)
# ═══════════════════════════════════════════════════════════════════

def _focal_loss_mlp(pred, target, gamma=MLP_FOCAL_G):
    """Binary focal loss for a single head."""
    bce  = nn.functional.binary_cross_entropy(pred, target, reduction="none")
    p_t  = torch.where(target == 1, pred, 1.0 - pred)
    return ((1.0 - p_t) ** gamma * bce).mean()


def _balanced_sampler(y: np.ndarray):
    """WeightedRandomSampler that gives each class equal expected frequency."""
    n_pos = max(int(y.sum()), 1)
    n_neg = max(int(len(y) - n_pos), 1)
    w = np.where(y == 1, 1.0 / n_pos, 1.0 / n_neg)
    return torch.utils.data.WeightedRandomSampler(
        torch.tensor(w, dtype=torch.float32), len(y), replacement=True
    )


class StudentMLP(nn.Module):
    """
    Single-head compact MLP student (T7+T8, 30/76-dim input, y_emo only).

    Architecture: trunk (n_feat→64→64) + sigmoid head_emo.
    Trained with focal loss + WeightedRandomSampler.
    Scaler stored inside the object so pickle is self-contained.
    """

    def __init__(self, n_feat=N_FEAT_FLAT, hidden=MLP_HIDDEN, dropout=MLP_DROPOUT):
        super().__init__()
        self.n_feat = n_feat
        self.scaler = StandardScaler()
        self.trunk = nn.Sequential(
            nn.Linear(n_feat, hidden),
            nn.BatchNorm1d(hidden), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(hidden, hidden),
            nn.BatchNorm1d(hidden), nn.ReLU(), nn.Dropout(dropout),
        )
        self.head_emo = nn.Linear(hidden, 1)

    def forward(self, x):
        return torch.sigmoid(self.head_emo(self.trunk(x))).squeeze(1)

    def fit(self, X, ye, soft_emo=None):
        self.scaler.fit(X)
        X_sc = self.scaler.transform(X).astype(np.float32)
        self.to(DEVICE)
        sampler = _balanced_sampler(ye)
        ds = torch.utils.data.TensorDataset(
            torch.tensor(X_sc, dtype=torch.float32),
            torch.tensor(ye, dtype=torch.float32),
        )
        loader = torch.utils.data.DataLoader(ds, batch_size=MLP_BATCH, sampler=sampler)
        opt = torch.optim.Adam(self.parameters(), lr=MLP_LR, weight_decay=1e-5)
        sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=MLP_EPOCHS)
        print(f"  [StudentMLP hidden={MLP_HIDDEN}] emo head "
              f"(pos={int(ye.sum()):,} = {ye.mean():.1%}) ...")
        self.train()
        for _ in range(MLP_EPOCHS):
            for Xb, yb in loader:
                Xb, yb = Xb.to(DEVICE), yb.to(DEVICE)
                opt.zero_grad()
                _focal_loss_mlp(self(Xb), yb).backward()
                opt.step()
            sch.step()
        self.cpu()
        return self

    def predict_proba(self, X):
        self.eval()
        X_sc = self.scaler.transform(X).astype(np.float32)
        with torch.no_grad():
            p = self(torch.tensor(X_sc))
        return p.numpy().astype(np.float32)

    def predict(self, X, threshold=0.5):
        return (self.predict_proba(X) >= threshold).astype(int)

    def save(self, p):
        with open(p, "wb") as f:
            pickle.dump(self, f)

    @staticmethod
    def load(p):
        with open(p, "rb") as f:
            return pickle.load(f)


# ═══════════════════════════════════════════════════════════════════
#  CNN+BILSTM STUDENT  (temporal — exploits sequences of epochs)
# ═══════════════════════════════════════════════════════════════════

def make_student_sequences(X, ye, sid, src, seq_len=CNN_SEQ_LEN):
    """
    Build (N_seq, seq_len, n_feat) sequences from consecutive epochs
    within the same (subject, source) group.

    Returns
    -------
    Xs    : (N_seq, seq_len, n_feat)  float32
    ye_s  : (N_seq,)  int64  — y_emo at last epoch in sequence
    groups: (N_seq,)  int32  — subject_id for stratification
    """
    Xs, ye_s, grps = [], [], []
    src_lower = np.array([str(s).lower() for s in src])
    for subj in np.unique(sid):
        for source_val in np.unique(src_lower):
            mask = (sid == subj) & (src_lower == source_val)
            idx  = np.where(mask)[0]
            if len(idx) < seq_len:
                continue
            for i in range(len(idx) - seq_len + 1):
                window = idx[i:i + seq_len]
                Xs.append(X[window])
                ye_s.append(ye[window[-1]])
                grps.append(int(subj))

    if not Xs:
        return (np.zeros((0, seq_len, X.shape[1]), dtype=np.float32),
                np.zeros(0, dtype=np.int64),
                np.zeros(0, dtype=np.int32))

    return (np.array(Xs, dtype=np.float32),
            np.array(ye_s, dtype=np.int64),
            np.array(grps, dtype=np.int32))


class StudentCNNBiLSTM(nn.Module):
    """
    Single-head temporal student (y_emo only): CNN feature encoder + 2-layer BiLSTM.

    Input : (N, seq_len, n_feat) — consecutive epoch feature sequences.
    Output: p_emo at the last epoch in each sequence.

    Single-epoch inference: predict_epoch(x) zero-pads to seq_len.
    """

    def __init__(self, n_feat=N_FEAT_EXT, hidden=CNN_HIDDEN,
                 seq_len=CNN_SEQ_LEN, dropout=CNN_DROPOUT):
        super().__init__()
        self.seq_len = seq_len
        self.n_feat  = n_feat
        self.scaler  = StandardScaler()

        self.encoder = nn.Sequential(
            nn.Linear(n_feat, 64), nn.GELU(), nn.Dropout(dropout),
            nn.Linear(64, 32),    nn.GELU(),
        )
        self.lstm = nn.LSTM(32, hidden, num_layers=2, batch_first=True,
                            bidirectional=True,
                            dropout=dropout if 2 > 1 else 0.0)
        self.norm     = nn.LayerNorm(hidden * 2)
        self.drop     = nn.Dropout(dropout)
        self.head_emo = nn.Linear(hidden * 2, 1)

    def forward(self, x):
        """x: (B, seq_len, n_feat) → p_emo (B,)."""
        B, S, F = x.shape
        enc = self.encoder(x.reshape(B * S, F)).reshape(B, S, -1)
        out, _ = self.lstm(enc)
        h = self.drop(self.norm(out[:, -1, :]))
        return torch.sigmoid(self.head_emo(h)).squeeze(1)

    def fit(self, Xs, ye_s, groups=None):
        """
        Xs   : (N, seq_len, n_feat)
        ye_s : (N,) y_emo at last epoch
        """
        E, S, F = Xs.shape
        self.scaler.fit(Xs.reshape(E * S, F))
        Xs_sc = self.scaler.transform(Xs.reshape(E * S, F)).reshape(E, S, F)
        Xs_t  = torch.tensor(Xs_sc, dtype=torch.float32)
        ye_f  = torch.tensor(ye_s,  dtype=torch.float32)

        sampler = _balanced_sampler(ye_s)
        ds  = torch.utils.data.TensorDataset(Xs_t, ye_f)
        ld  = torch.utils.data.DataLoader(ds, CNN_BATCH, sampler=sampler)
        opt = torch.optim.Adam(self.parameters(), lr=CNN_LR, weight_decay=1e-5)
        sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=CNN_EPOCHS)

        self.to(DEVICE)
        print(f"  [StudentCNNBiLSTM seq={self.seq_len}] emo head "
              f"(pos={int(ye_s.sum()):,} = {ye_s.mean():.1%}) ...")
        self.train()
        for _ in range(CNN_EPOCHS):
            for Xb, yb in ld:
                Xb, yb = Xb.to(DEVICE), yb.to(DEVICE)
                opt.zero_grad()
                _focal_loss_mlp(self(Xb), yb, gamma=CNN_FOCAL_G).backward()
                opt.step()
            sch.step()
        self.cpu()
        return self

    def predict_proba(self, Xs: np.ndarray):
        """
        Xs : (N, seq_len, n_feat) or (N, n_feat) for single-epoch mode.
        Returns p_emo as float32 array.
        """
        if Xs.ndim == 2:
            Xs = self._pad_to_sequences(Xs)
        E, S, F = Xs.shape
        Xs_sc = self.scaler.transform(Xs.reshape(E * S, F)).reshape(E, S, F)
        self.eval()
        with torch.no_grad():
            p = self(torch.tensor(Xs_sc, dtype=torch.float32))
        return p.numpy().astype(np.float32)

    def predict_epoch(self, x_single: np.ndarray):
        """Single epoch (n_feat,) → p_emo scalar."""
        seq = np.zeros((1, self.seq_len, x_single.shape[0]), dtype=np.float32)
        seq[0, -1] = x_single
        return float(self.predict_proba(seq)[0])

    def _pad_to_sequences(self, X_flat: np.ndarray):
        N, F = X_flat.shape
        seq  = np.zeros((N, self.seq_len, F), dtype=np.float32)
        seq[:, -1, :] = X_flat
        return seq

    def save(self, p):
        with open(p, "wb") as f:
            pickle.dump(self, f)

    @staticmethod
    def load(p):
        with open(p, "rb") as f:
            return pickle.load(f)


# ═══════════════════════════════════════════════════════════════════
#  EVALUATION
# ═══════════════════════════════════════════════════════════════════

def find_optimal_threshold(probs, y_true, metric="f1_pos"):
    best_t, best_s = 0.5, -1.
    for t in np.arange(0.10, 0.91, 0.05):
        pred = (np.array(probs) >= t).astype(int)
        s = (f1_score(y_true, pred, pos_label=1, zero_division=0)
             if metric == "f1_pos" else
             f1_score(y_true, pred, average="macro", zero_division=0))
        if s > best_s: best_s, best_t = s, t
    return float(best_t), float(best_s)


def evaluate_student(model, X_te, ye_te, tag="Student"):
    """
    Single-head evaluation (y_emo only).
    Reports ROC-AUC and PR-AUC (average precision).
    """
    p_emo = model.predict_proba(X_te)

    if len(ye_te) < 10 or len(np.unique(ye_te)) < 2:
        print(f"  [{tag}] insufficient classes for evaluation")
        return {}

    thr, _ = find_optimal_threshold(p_emo, ye_te, "f1_pos")
    pred   = (p_emo >= thr).astype(int)
    results = {
        "emo": {
            "accuracy"          : float(accuracy_score(ye_te, pred)),
            "balanced_accuracy" : float(balanced_accuracy_score(ye_te, pred)),
            "f1_macro"          : float(f1_score(ye_te, pred, average="macro", zero_division=0)),
            "f1_pos"            : float(f1_score(ye_te, pred, pos_label=1, zero_division=0)),
            "auc_roc"           : float(roc_auc_score(ye_te, p_emo)),
            "auc_pr"            : float(average_precision_score(ye_te, p_emo)),
            "threshold"         : thr,
            "n"                 : int(len(ye_te)),
            "pos_rate"          : float(ye_te.mean()),
        }
    }
    m = results["emo"]
    print(f"\n  [{tag}]")
    print(f"  {'Head':<6} {'Acc':>6} {'BalAcc':>7} {'F1+':>6} {'ROC-AUC':>8} {'PR-AUC':>7} {'PosRate':>8}")
    print("  " + "─" * 54)
    print(f"  {'emo':<6} {m['accuracy']:.4f} {m['balanced_accuracy']:.4f} "
          f"{m['f1_pos']:.4f}  {m['auc_roc']:.4f}   {m['auc_pr']:.4f}  {m['pos_rate']:.2%}")
    return results


# ═══════════════════════════════════════════════════════════════════
#  FULL PIPELINE
# ═══════════════════════════════════════════════════════════════════

def run_student_pipeline(npz_path=None, soft_dir=SOFT_DIR,
                         model_type="mlp", use_extended=False):
    model_type = model_type.lower()
    _labels = {
        "mlp":        f"MLP (hidden={MLP_HIDDEN}, focal-loss, gamma={MLP_FOCAL_G})",
        "knn":        f"KNN (k={KNN_K}, ball_tree)",
        "cnn_bilstm": f"CNN+BiLSTM (hidden={CNN_HIDDEN}, seq={CNN_SEQ_LEN}, focal-loss)",
    }
    label     = _labels.get(model_type, model_type)
    feat_desc = "76-dim extended" if use_extended else "30-dim base"

    print(f"\n{'=' * 62}")
    print(f"  STUDENT PIPELINE — T7+T8 wearable  |  {label}")
    print(f"  Features: {feat_desc}  |  Head: y_emo only")
    print(f"{'=' * 62}")

    print("\n[1] Loading student features")
    X, y_emo, sid, source = load_student_data(npz_path, use_extended=use_extended)

    print("\n[2] Loading teacher soft logits")
    soft_emo, _, _ = load_soft_logits(soft_dir)
    n = min(len(X), len(soft_emo))
    if len(X) != len(soft_emo):
        print(f"  Size mismatch — trimming to {n}")
    X        = X[:n];        y_emo    = y_emo[:n]
    sid      = sid[:n];      source   = source[:n]
    soft_emo = soft_emo[:n]

    print("\n[3] Subject-stratified split (80/20)")
    gss = GroupShuffleSplit(1, test_size=TEST_SIZE, random_state=RANDOM_STATE)
    tr, te = next(gss.split(X, y_emo, groups=sid))
    X_tr, X_te   = X[tr],      X[te]
    ye_tr, ye_te = y_emo[tr],  y_emo[te]
    se_tr        = soft_emo[tr]
    src_tr       = source[tr]
    print(f"  Train:{len(tr):,} ({len(np.unique(sid[tr]))} subj)  "
          f"Test:{len(te):,} ({len(np.unique(sid[te]))} subj)")

    if model_type == "cnn_bilstm":
        print(f"\n[4] Building epoch sequences (seq_len={CNN_SEQ_LEN})")
        Xs, ye_s, _ = make_student_sequences(
            X_tr, ye_tr, sid[tr], src_tr, seq_len=CNN_SEQ_LEN
        )
        print(f"  Sequences: {len(Xs):,}  shape={Xs.shape if len(Xs) else 'empty'}")
        if len(Xs) == 0:
            print("  WARNING: no sequences — falling back to MLP")
            model_type = "mlp"
        else:
            model = StudentCNNBiLSTM(n_feat=X.shape[1])
            model.fit(Xs, ye_s)

    if model_type == "mlp":
        print(f"\n[4] Training MLP student")
        model = StudentMLP(n_feat=X.shape[1])
        model.fit(X_tr, ye_tr, soft_emo=se_tr)

    elif model_type == "knn":
        print("\n[4] Training KNN student")
        rng   = np.random.default_rng(RANDOM_STATE)
        idx_k = (rng.choice(len(X_tr), KNN_SUBSAMPLE, replace=False)
                 if len(X_tr) > KNN_SUBSAMPLE else np.arange(len(X_tr)))
        if len(X_tr) > KNN_SUBSAMPLE:
            print(f"  Subsampled to {KNN_SUBSAMPLE:,}/{len(X_tr):,}")
        model = StudentKNN(k=KNN_K)
        model.fit(X_tr[idx_k], ye_tr[idx_k], soft_emo=se_tr[idx_k])

    print("\n[5] Evaluating on held-out test set")
    results = evaluate_student(model, X_te, ye_te, tag=label)
    roc_auc = results.get("emo", {}).get("auc_roc", 0.)
    pr_auc  = results.get("emo", {}).get("auc_pr",  0.)
    print(f"\n  ROC-AUC={roc_auc:.4f}  PR-AUC={pr_auc:.4f}")

    print("\n[6] Saving model")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    suffix   = {"mlp": "mlp", "knn": "knn", "cnn_bilstm": "cnn_bilstm"}.get(model_type, model_type)
    pkl_path = MODELS_DIR / f"student_{suffix}.pkl"
    model.save(pkl_path)
    model.save(MODELS_DIR / "student_model.pkl")
    print(f"  Saved → {pkl_path}")

    rpt = {
        "model"  : label,
        "head"   : "emo",
        "roc_auc": roc_auc,
        "pr_auc" : pr_auc,
        "results": results,
    }

    def _j(o):
        if isinstance(o, np.integer):  return int(o)
        if isinstance(o, np.floating): return float(o)
        if isinstance(o, np.ndarray):  return o.tolist()
        raise TypeError(type(o))

    with open(MODELS_DIR / "student_results.json", "w") as f:
        json.dump(rpt, f, indent=2, default=_j)

    print(f"\n{'=' * 62}")
    print(f"  Student: {label}")
    print(f"  ROC-AUC={roc_auc:.4f}  PR-AUC={pr_auc:.4f}")
    print(f"  Stage: 0=Calm | 1=Rising risk (spiral) | 2=Stressed (p_emo ≥ personal threshold)")
    print(f"{'=' * 62}\n")
    return model, results


# ═══════════════════════════════════════════════════════════════════
#  ABLATION STUDY — compare feature sets and model architectures
# ═══════════════════════════════════════════════════════════════════

def run_ablation_study(npz_path=None, soft_dir=SOFT_DIR):
    """
    Ablation study comparing:
      A. MLP (30-dim base)   vs  MLP (76-dim extended)
      B. MLP (76-dim)        vs  CNN+BiLSTM (76-dim)
    Saves results to models/student_ablation.json.
    """
    print(f"\n{'=' * 62}")
    print("  STUDENT ABLATION — feature set × architecture")
    print(f"{'=' * 62}")

    configs = [
        ("MLP-base",       "mlp",        False),
        ("MLP-extended",   "mlp",        True),
        ("CNN+BiLSTM-ext", "cnn_bilstm", True),
    ]
    ablation = {}
    for name, mtype, ext in configs:
        print(f"\n--- {name} ---")
        try:
            _, res = run_student_pipeline(npz_path, soft_dir,
                                          model_type=mtype, use_extended=ext)
            ablation[name] = {
                "roc_auc": res.get("emo", {}).get("auc_roc", 0.),
                "pr_auc":  res.get("emo", {}).get("auc_pr",  0.),
                "results": res,
            }
        except Exception as e:
            print(f"  FAILED: {e}")
            ablation[name] = {"error": str(e)}

    def _j(o):
        if isinstance(o, (np.integer, int)):    return int(o)
        if isinstance(o, (np.floating, float)): return float(o)
        if isinstance(o, np.ndarray):           return o.tolist()
        raise TypeError(type(o))

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODELS_DIR / "student_ablation.json", "w") as f:
        json.dump(ablation, f, indent=2, default=_j)

    print(f"\n  {'Config':<18} {'ROC-AUC':>8} {'PR-AUC':>8}")
    print("  " + "─" * 38)
    for name, r in ablation.items():
        if "error" not in r:
            print(f"  {name:<18} {r['roc_auc']:.4f}   {r['pr_auc']:.4f}")
        else:
            print(f"  {name:<18}  ERROR: {r['error']}")
    print(f"\n  Saved → {MODELS_DIR}/student_ablation.json")
    return ablation


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--npz",      default=None)
    p.add_argument("--soft_dir", default=None)
    p.add_argument("--model",    default="mlp", choices=["mlp", "knn", "cnn_bilstm"],
                   help="Student model type (default: mlp)")
    p.add_argument("--extended", action="store_true",
                   help="Use 76-dim extended features")
    p.add_argument("--ablation", action="store_true",
                   help="Run ablation study (MLP-base vs MLP-ext vs CNN+BiLSTM-ext)")
    args = p.parse_args()

    npz_p    = Path(args.npz)      if args.npz      else None
    soft_p   = Path(args.soft_dir) if args.soft_dir else SOFT_DIR

    if args.ablation:
        run_ablation_study(npz_p, soft_p)
    else:
        model, results = run_student_pipeline(
            npz_p, soft_p, model_type=args.model, use_extended=args.extended
        )
        if "emo" in results:
            m = results["emo"]
            print(f"  emo: roc={m['auc_roc']:.4f}  pr={m['auc_pr']:.4f}  "
                  f"bal_acc={m['balanced_accuracy']:.4f}")