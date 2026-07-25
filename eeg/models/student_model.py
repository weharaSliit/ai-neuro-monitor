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
    Load F_student (or F_student_ext) + labels including y_pre_stage.
    Returns X, y_emo, y_perc, y_pre_stage, subject_id, source.

    Parameters
    ----------
    use_extended : bool
        If True, load F_student_ext (76-dim) instead of F_student (30-dim).
        Requires feature_extraction.py to have been run with the extended pipeline.
    """
    if npz_path is None:
        npz_path = UNIFIED_OUTPUT_DIR / "features_dataset.npz"
    if not Path(npz_path).exists():
        return _synthetic_data()

    d           = np.load(npz_path, allow_pickle=True)
    feat_key    = "F_student_ext" if (use_extended and "F_student_ext" in d) else "F_student"
    X           = d[feat_key].astype(np.float32)
    y_emo       = d["y_emo"].astype(np.int64)
    y_perc      = d["y_perc"].astype(np.int64).copy()
    subject_id  = d["subject_id"]
    source      = d["source"]
    y_pre_stage = (d["y_pre_stage"].astype(np.int64) if "y_pre_stage" in d
                   else ((y_emo == 1) & (y_perc == 0)).astype(np.int64))

    yp_v = y_perc[y_perc >= 0]
    print(f"  {feat_key}: {X.shape}")
    print(f"  y_emo       : pos={int(y_emo.sum()):,}  bal={y_emo.mean():.2%}  (DEAP+SAM40)")
    print(f"  y_pre_stage : pos={int(y_pre_stage.sum()):,}  bal={y_pre_stage.mean():.2%}  (build-up phase)")
    print(f"  y_perc      : pos={int((y_perc == 1).sum()):,}  bal={yp_v.mean():.2%}  (y_perc≥0)")
    return X, y_emo, y_perc, y_pre_stage, subject_id, source


def _synthetic_data():
    rng = np.random.default_rng(RANDOM_STATE)
    E_d = 400; E_s = 200; E = E_d + E_s
    X   = rng.standard_normal((E, N_FEAT_FLAT)).astype(np.float32)
    ye  = np.concatenate([(rng.random(E_d) < 0.24).astype(np.int64),
                           (rng.random(E_s) < 0.79).astype(np.int64)])
    yp  = np.full(E, -1, dtype=np.int64)
    for i in range(E_d):
        yp[i] = int(rng.random() < (0.22 if ye[i] == 1 else 0.02))
    yps = ((ye == 1) & (yp == 0)).astype(np.int64)
    src = np.array(["deap"] * E_d + ["sam40"] * E_s)
    sid = np.concatenate([np.repeat(np.arange(20), E_d // 20),
                           np.repeat(np.arange(20, 40), E_s // 20)]).astype(np.int32)
    X[ye == 1, 8] += 1.5; X[yp == 1, 7] -= 1.0
    # Pre-stage: moderate elevation on beta (T8 index 1 = beta feature)
    X[yps == 1, 6] += 0.7
    return X, ye, yp, yps, sid, src


def load_soft_logits(soft_dir=SOFT_DIR):
    soft_dir = Path(soft_dir)
    needed   = ["soft_emo.npy", "soft_perc.npy", "y_emo.npy", "y_perc.npy", "source.npy"]
    for f in needed:
        if not (soft_dir / f).exists():
            raise FileNotFoundError(
                f"Missing: {soft_dir / f}\nRun teacher_model.py first.")
    soft_pre = (np.load(soft_dir / "soft_pre_stage.npy").astype(np.float32)
                if (soft_dir / "soft_pre_stage.npy").exists() else None)
    y_pre    = (np.load(soft_dir / "y_pre_stage.npy").astype(np.int64)
                if (soft_dir / "y_pre_stage.npy").exists() else None)
    return (np.load(soft_dir / "soft_emo.npy").astype(np.float32),
            soft_pre,
            np.load(soft_dir / "soft_perc.npy").astype(np.float32),
            np.load(soft_dir / "y_emo.npy").astype(np.int64),
            y_pre,
            np.load(soft_dir / "y_perc.npy").astype(np.int64),
            np.load(soft_dir / "source.npy", allow_pickle=True))


# ═══════════════════════════════════════════════════════════════════
#  KNN STUDENT
# ═══════════════════════════════════════════════════════════════════

class StudentKNN:
    """
    Triple-head KNN student (T7+T8 wearable model).
    knn_emo  → emotional stress detection
    knn_pre  → pre-stage stress detection (early warning: emo=1 before perc fires)
    knn_perc → sustained/perceived stress detection
    Distilled from teacher's soft logits via weighted resampling.
    """
    def __init__(self, k=KNN_K):
        self.k = k
        def _pipe():
            return Pipeline([
                ("sc",  StandardScaler()),
                ("clf", KNeighborsClassifier(
                    n_neighbors=k, metric="euclidean",
                    weights="distance", algorithm="ball_tree", n_jobs=-1,
                )),
            ])
        self.knn_emo  = _pipe()
        self.knn_pre  = _pipe()
        self.knn_perc = _pipe()

    def _weighted_resample(self, X, y, weights, rng):
        w = weights.clip(1e-3, None)
        p = w / w.sum()
        idx = rng.choice(len(X), size=len(X), replace=True, p=p)
        return X[idx], y[idx]

    def fit(self, X, ye, yp, yps, src, soft_emo=None, soft_pre=None, soft_perc=None):
        rng = np.random.default_rng(RANDOM_STATE)

        # Emo head
        if soft_emo is not None:
            Xr, yer = self._weighted_resample(X, ye, soft_emo, rng)
        else:
            Xr, yer = X, ye
        print(f"  [StudentKNN k={self.k}] emo on {len(Xr):,} ...")
        self.knn_emo.fit(Xr, yer)

        # Pre-stage head — all epochs (y_pre_stage is always 0 or 1)
        if soft_pre is not None:
            Xp, ypsp = self._weighted_resample(X, yps, soft_pre, rng)
        else:
            Xp, ypsp = X, yps
        print(f"  [StudentKNN k={self.k}] pre_stage on {len(Xp):,} "
              f"(pos={int(ypsp.sum()):,} = {ypsp.mean():.1%}) ...")
        self.knn_pre.fit(Xp, ypsp)

        # Perc head
        dm  = np.array([int(ypi) >= 0 for ypi in yp])
        Xd, ypd = X[dm], yp[dm]
        if soft_perc is not None:
            Xd, ypd = self._weighted_resample(Xd, ypd, soft_perc[dm], rng)
        print(f"  [StudentKNN k={self.k}] perc on {len(Xd):,} labeled epochs ...")
        self.knn_perc.fit(Xd, ypd)
        return self

    def predict_proba(self, X):
        return (self.knn_emo.predict_proba(X)[:, 1].astype(np.float32),
                self.knn_pre.predict_proba(X)[:, 1].astype(np.float32),
                self.knn_perc.predict_proba(X)[:, 1].astype(np.float32))

    def predict(self, X):
        return (self.knn_emo.predict(X),
                self.knn_pre.predict(X),
                self.knn_perc.predict(X))

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
    Triple-head compact MLP student (T7+T8, 30-dim input).

    Replaces StudentKNN to improve cross-subject generalisation.
    Architecture: shared trunk (30->64->64) + three sigmoid heads.
    Trained with focal loss + per-head WeightedRandomSampler.
    Scaler is stored inside the object so pickle is self-contained.

    API is identical to StudentKNN — predict_proba(X) returns
    (p_emo, p_pre, p_perc) as float32 numpy arrays.
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
        self.head_emo  = nn.Linear(hidden, 1)
        self.head_pre  = nn.Linear(hidden, 1)
        self.head_perc = nn.Linear(hidden, 1)

    def forward(self, x):
        h = self.trunk(x)
        return (torch.sigmoid(self.head_emo(h)).squeeze(1),
                torch.sigmoid(self.head_pre(h)).squeeze(1),
                torch.sigmoid(self.head_perc(h)).squeeze(1))

    def _to_tensor(self, arr):
        return torch.tensor(arr, dtype=torch.float32).to(DEVICE)

    def _train_head(self, X_sc, y_head, head_param, epochs, lr):
        """Train one head while keeping the trunk shared (all params updated)."""
        sampler = _balanced_sampler(y_head)
        ds = torch.utils.data.TensorDataset(
            torch.tensor(X_sc, dtype=torch.float32),
            torch.tensor(y_head, dtype=torch.float32),
        )
        loader = torch.utils.data.DataLoader(
            ds, batch_size=MLP_BATCH, sampler=sampler
        )
        opt = torch.optim.Adam(self.parameters(), lr=lr, weight_decay=1e-5)
        sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
        self.train()
        for _ in range(epochs):
            for Xb, yb in loader:
                Xb, yb = Xb.to(DEVICE), yb.to(DEVICE)
                opt.zero_grad()
                pe, pps, pp = self(Xb)
                # Head-specific loss picked by head_param
                pred = {"emo": pe, "pre": pps, "perc": pp}[head_param]
                _focal_loss_mlp(pred, yb).backward()
                opt.step()
            sch.step()

    def fit(self, X, ye, yp, yps, src,
            soft_emo=None, soft_pre=None, soft_perc=None):
        """Fit scaler then train each head with its own class-balanced loader."""
        self.scaler.fit(X)
        X_sc = self.scaler.transform(X).astype(np.float32)
        self.to(DEVICE)

        dm = (yp >= 0)
        print(f"  [StudentMLP hidden={MLP_HIDDEN}] emo head ...")
        self._train_head(X_sc, ye.astype(np.float32), "emo", MLP_EPOCHS, MLP_LR)

        yps_f = yps.astype(np.float32)
        print(f"  [StudentMLP] pre_stage head (pos={int(yps_f.sum()):,}) ...")
        self._train_head(X_sc, yps_f, "pre", MLP_EPOCHS, MLP_LR)

        yp_dm = yp[dm].astype(np.float32)
        print(f"  [StudentMLP] perc head (pos={int((yp_dm==1).sum()):,}) ...")
        self._train_head(X_sc[dm], yp_dm, "perc", MLP_EPOCHS, MLP_LR)

        self.cpu()
        return self

    def predict_proba(self, X):
        """Returns (p_emo, p_pre, p_perc) as float32 arrays. Same API as KNN."""
        self.eval()
        X_sc = self.scaler.transform(X).astype(np.float32)
        with torch.no_grad():
            pe, pps, pp = self(torch.tensor(X_sc))
        return pe.numpy(), pps.numpy(), pp.numpy()

    def predict(self, X, threshold=0.5):
        pe, pps, pp = self.predict_proba(X)
        return ((pe >= threshold).astype(int),
                (pps >= threshold).astype(int),
                (pp >= threshold).astype(int))

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

def make_student_sequences(X, ye, yp, yps, sid, src,
                            seq_len=CNN_SEQ_LEN):
    """
    Build (N_seq, seq_len, n_feat) sequences from consecutive epochs
    within the same (subject, source) group.

    Returns
    -------
    Xs    : (N_seq, seq_len, n_feat)  float32
    ye_s  : (N_seq,)  int64  — label at last epoch in sequence
    yp_s  : (N_seq,)  int64
    yps_s : (N_seq,)  int64
    groups: (N_seq,)  int32  — subject_id for stratification
    """
    Xs, ye_s, yp_s, yps_s, grps = [], [], [], [], []
    for subj in np.unique(sid):
        for source_val in np.unique(src):
            mask = (sid == subj) & (np.array([str(s).lower() for s in src]) ==
                                    str(source_val).lower())
            idx = np.where(mask)[0]
            if len(idx) < seq_len:
                continue
            for i in range(len(idx) - seq_len + 1):
                window = idx[i:i + seq_len]
                Xs.append(X[window])
                ye_s.append(ye[window[-1]])
                yp_s.append(yp[window[-1]])
                yps_s.append(yps[window[-1]])
                grps.append(int(subj))

    if not Xs:
        return (np.zeros((0, seq_len, X.shape[1]), dtype=np.float32),
                *[np.zeros(0, dtype=np.int64)] * 3,
                np.zeros(0, dtype=np.int32))

    return (np.array(Xs, dtype=np.float32),
            np.array(ye_s, dtype=np.int64),
            np.array(yp_s, dtype=np.int64),
            np.array(yps_s, dtype=np.int64),
            np.array(grps, dtype=np.int32))


class StudentCNNBiLSTM(nn.Module):
    """
    Temporal triple-head student model: 1D-CNN local encoder + BiLSTM.

    Input : (batch, seq_len, n_feat) — seq_len consecutive epoch features
    Output: (p_emo, p_pre, p_perc) probabilities at the last epoch.

    Why temporal?
    - Stress evolves over seconds; a 10-epoch (5 s) look-back window
      lets the BiLSTM capture building arousal before perceived stress fires.
    - The CNN encoder maps each epoch's feature vector to a compact
      representation, then the BiLSTM models temporal dynamics across epochs.

    API differences from StudentMLP
    - predict_proba(X) still works, but X must be (N, seq_len, n_feat)
    - For single-epoch inference, call predict_epoch(x_single) which
      pads with zeros to form a valid sequence.
    """

    def __init__(self, n_feat=N_FEAT_EXT, hidden=CNN_HIDDEN,
                 seq_len=CNN_SEQ_LEN, dropout=CNN_DROPOUT):
        super().__init__()
        self.seq_len = seq_len
        self.n_feat  = n_feat
        self.scaler  = StandardScaler()

        # Per-epoch CNN encoder (linear for speed; Conv1d requires permuting)
        self.encoder = nn.Sequential(
            nn.Linear(n_feat, 64), nn.GELU(), nn.Dropout(dropout),
            nn.Linear(64, 32),    nn.GELU(),
        )
        # Temporal BiLSTM
        self.lstm = nn.LSTM(32, hidden, num_layers=2, batch_first=True,
                            bidirectional=True,
                            dropout=dropout if 2 > 1 else 0.0)
        self.norm = nn.LayerNorm(hidden * 2)
        self.drop = nn.Dropout(dropout)

        # Triple heads (same API as StudentMLP)
        self.head_emo  = nn.Linear(hidden * 2, 1)
        self.head_pre  = nn.Linear(hidden * 2, 1)
        self.head_perc = nn.Linear(hidden * 2, 1)

    def forward(self, x):
        """x: (B, seq_len, n_feat)."""
        B, S, F = x.shape
        # Encode each epoch independently
        enc = self.encoder(x.reshape(B * S, F)).reshape(B, S, -1)   # (B, S, 32)
        out, _ = self.lstm(enc)
        h = self.drop(self.norm(out[:, -1, :]))                      # last timestep
        return (torch.sigmoid(self.head_emo(h)).squeeze(1),
                torch.sigmoid(self.head_pre(h)).squeeze(1),
                torch.sigmoid(self.head_perc(h)).squeeze(1))

    def _train_head(self, X_sc, ys_seq, head_key, epochs, lr):
        """Train all params for one head's focal loss (sequences already built)."""
        y_last = ys_seq[:, -1]
        sampler = _balanced_sampler(y_last.numpy() if torch.is_tensor(y_last)
                                    else y_last)
        ds = torch.utils.data.TensorDataset(X_sc,
                                             torch.tensor(y_last, dtype=torch.float32))
        ld = torch.utils.data.DataLoader(ds, CNN_BATCH, sampler=sampler)
        opt = torch.optim.Adam(self.parameters(), lr=lr, weight_decay=1e-5)
        sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
        self.train()
        for _ in range(epochs):
            for Xb, yb in ld:
                Xb, yb = Xb.to(DEVICE), yb.to(DEVICE)
                opt.zero_grad()
                pe, pps, pp = self(Xb)
                pred = {"emo": pe, "pre": pps, "perc": pp}[head_key]
                _focal_loss_mlp(pred, yb, gamma=CNN_FOCAL_G).backward()
                opt.step()
            sch.step()

    def fit(self, Xs, ye_s, yp_s, yps_s, groups=None,
            soft_emo=None, soft_pre=None, soft_perc=None):
        """
        Fit on pre-built sequence arrays.

        Xs    : (N, seq_len, n_feat)
        ye_s  : (N,) labels at last epoch
        yp_s  : (N,) perceived stress at last epoch
        yps_s : (N,) pre-stage at last epoch
        """
        # Fit scaler on flattened epochs
        E, S, F = Xs.shape
        self.scaler.fit(Xs.reshape(E * S, F))
        Xs_sc = self.scaler.transform(Xs.reshape(E * S, F)).reshape(E, S, F)
        Xs_t  = torch.tensor(Xs_sc, dtype=torch.float32)

        ye_t  = torch.tensor(ye_s,  dtype=torch.float32)
        yps_t = torch.tensor(yps_s, dtype=torch.float32)

        self.to(DEVICE)

        print(f"  [StudentCNNBiLSTM seq={self.seq_len}] emo head …")
        self._train_head(Xs_t, ye_t.unsqueeze(1).expand(-1, S), "emo", CNN_EPOCHS, CNN_LR)

        print(f"  [StudentCNNBiLSTM] pre_stage head …")
        self._train_head(Xs_t, yps_t.unsqueeze(1).expand(-1, S), "pre", CNN_EPOCHS, CNN_LR)

        dm = yp_s >= 0
        if dm.sum() > CNN_BATCH:
            yp_t = torch.tensor(yp_s[dm], dtype=torch.float32)
            print(f"  [StudentCNNBiLSTM] perc head (pos={int((yp_s[dm]==1).sum()):,}) …")
            self._train_head(Xs_t[dm], yp_t.unsqueeze(1).expand(-1, S),
                             "perc", CNN_EPOCHS, CNN_LR)

        self.cpu()
        return self

    def predict_proba(self, Xs: np.ndarray):
        """
        Xs : (N, seq_len, n_feat) or (N, n_feat) for single-epoch mode.
        Returns (p_emo, p_pre, p_perc) as float32 arrays.
        """
        if Xs.ndim == 2:
            Xs = self._pad_to_sequences(Xs)
        E, S, F = Xs.shape
        Xs_sc = self.scaler.transform(Xs.reshape(E * S, F)).reshape(E, S, F)
        self.eval()
        with torch.no_grad():
            pe, pps, pp = self(torch.tensor(Xs_sc, dtype=torch.float32))
        return pe.numpy(), pps.numpy(), pp.numpy()

    def predict_epoch(self, x_single: np.ndarray):
        """Single epoch (n_feat,) → (p_emo, p_pre, p_perc)."""
        seq = np.zeros((1, self.seq_len, x_single.shape[0]), dtype=np.float32)
        seq[0, -1] = x_single
        return self.predict_proba(seq)

    def _pad_to_sequences(self, X_flat: np.ndarray):
        """(N, n_feat) → (N, seq_len, n_feat) with zero padding."""
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


def evaluate_student(model, X_te, ye_te, yp_te, yps_te, src_te, tag="KNN"):
    p_emo, p_pre, p_perc = model.predict_proba(X_te)

    deap_m  = np.array([str(s).lower() == "deap" for s in src_te])
    results = {}
    for name, yt, ypr in [
        ("emo",       ye_te,          p_emo),
        ("pre_stage", yps_te,         p_pre),
        ("perc_deap", yp_te[deap_m],  p_perc[deap_m]),
    ]:
        if len(yt) < 10 or len(np.unique(yt)) < 2:
            continue
        thr, _ = find_optimal_threshold(ypr, yt, "f1_pos")
        pred   = (ypr >= thr).astype(int)
        results[name] = {
            "accuracy"         : float(accuracy_score(yt, pred)),
            "balanced_accuracy": float(balanced_accuracy_score(yt, pred)),
            "f1_macro"         : float(f1_score(yt, pred, average="macro", zero_division=0)),
            "f1_pos"           : float(f1_score(yt, pred, pos_label=1, zero_division=0)),
            "auc_roc"          : float(roc_auc_score(yt, ypr)),
            "threshold"        : thr,
            "n"                : int(len(yt)),
        }

    print(f"\n  [{tag}]")
    print(f"  {'Head':<12} {'Acc':>6} {'BalAcc':>7} {'F1':>6} {'F1+':>6} {'AUC':>6}")
    print("  " + "─" * 48)
    for k, m in results.items():
        print(f"  {k:<12} {m['accuracy']:.4f} {m['balanced_accuracy']:.4f}  "
              f"{m['f1_macro']:.4f} {m['f1_pos']:.4f} {m['auc_roc']:.4f}")
    return results


# ═══════════════════════════════════════════════════════════════════
#  FULL PIPELINE
# ═══════════════════════════════════════════════════════════════════

def run_student_pipeline(npz_path=None, soft_dir=SOFT_DIR,
                         model_type="mlp", use_extended=False):
    model_type = model_type.lower()
    _labels = {
        "mlp":         f"MLP (hidden={MLP_HIDDEN}, focal-loss, gamma={MLP_FOCAL_G})",
        "knn":         f"KNN (k={KNN_K}, ball_tree)",
        "cnn_bilstm":  f"CNN+BiLSTM (hidden={CNN_HIDDEN}, seq={CNN_SEQ_LEN}, focal-loss)",
    }
    label = _labels.get(model_type, model_type)
    feat_desc = "76-dim extended" if use_extended else "30-dim base"
    print(f"\n{'=' * 62}")
    print(f"  STUDENT PIPELINE — T7+T8 wearable model  {label}")
    print(f"  Features: {feat_desc}  |  3-head: emo | pre_stage | perceived")
    print(f"{'=' * 62}")

    print("\n[1] Loading student features")
    X, y_emo, y_perc, y_pre_stage, sid, source = load_student_data(
        npz_path, use_extended=use_extended
    )

    print("\n[2] Loading teacher soft logits")
    soft_emo, soft_pre, soft_perc, _, y_pre_soft, _, _ = load_soft_logits(soft_dir)
    n = min(len(X), len(soft_emo))
    if len(X) != len(soft_emo):
        print(f"  Size mismatch — trimming to {n}")
    X           = X[:n];            y_emo       = y_emo[:n]
    y_perc      = y_perc[:n];       y_pre_stage = y_pre_stage[:n]
    sid         = sid[:n];          source      = source[:n]
    soft_emo    = soft_emo[:n];     soft_perc   = soft_perc[:n]
    soft_pre    = soft_pre[:n]  if soft_pre  is not None else None
    y_pre_soft  = y_pre_soft[:n] if y_pre_soft is not None else y_pre_stage

    print("\n[3] Subject-stratified split (80/20)")
    gss = GroupShuffleSplit(1, test_size=TEST_SIZE, random_state=RANDOM_STATE)
    tr, te = next(gss.split(X, y_emo, groups=sid))
    X_tr,  X_te     = X[tr],            X[te]
    ye_tr, ye_te     = y_emo[tr],        y_emo[te]
    yp_tr, yp_te     = y_perc[tr],       y_perc[te]
    yps_tr, yps_te   = y_pre_stage[tr],  y_pre_stage[te]
    se_tr, spe_tr    = soft_emo[tr],     soft_perc[tr]
    sp_tr            = soft_pre[tr] if soft_pre is not None else None
    src_tr, src_te   = source[tr],       source[te]
    print(f"  Train:{len(tr):,} ({len(np.unique(sid[tr]))} subj)  "
          f"Test:{len(te):,} ({len(np.unique(sid[te]))} subj)")
    print(f"  Pre-stage test positives: {int(yps_te.sum()):,} / {len(yps_te):,} "
          f"= {yps_te.mean():.1%}")

    if model_type == "cnn_bilstm":
        print(f"\n[4] Building epoch sequences for CNN+BiLSTM (seq_len={CNN_SEQ_LEN})")
        Xs, ye_s, yp_s, yps_s, grp_s = make_student_sequences(
            X_tr, ye_tr, yp_tr, yps_tr, sid[tr], src_tr, seq_len=CNN_SEQ_LEN
        )
        print(f"  Sequences: {len(Xs):,}  shape={Xs.shape if len(Xs) else 'empty'}")
        if len(Xs) == 0:
            print("  WARNING: no sequences built — falling back to MLP")
            model_type = "mlp"
        else:
            model = StudentCNNBiLSTM(n_feat=X.shape[1])
            model.fit(Xs, ye_s, yp_s, yps_s)

    if model_type == "mlp":
        print(f"\n[4] Training MLP student (focal loss, balanced sampling)")
        model = StudentMLP(n_feat=X.shape[1])
        model.fit(
            X_tr, ye_tr, yp_tr, yps_tr, src_tr,
            soft_emo=se_tr,
            soft_pre=sp_tr,
            soft_perc=spe_tr,
        )
    elif model_type == "knn":
        print("\n[4] Subsampling for KNN training")
        rng   = np.random.default_rng(RANDOM_STATE)
        idx_k = (rng.choice(len(X_tr), KNN_SUBSAMPLE, replace=False)
                 if len(X_tr) > KNN_SUBSAMPLE else np.arange(len(X_tr)))
        if len(X_tr) > KNN_SUBSAMPLE:
            print(f"  Subsampled to {KNN_SUBSAMPLE:,}/{len(X_tr):,}")

        print("\n[5] Training KNN student (triple-head)")
        model = StudentKNN(k=KNN_K)
        model.fit(
            X_tr[idx_k], ye_tr[idx_k], yp_tr[idx_k], yps_tr[idx_k], src_tr[idx_k],
            soft_emo=se_tr[idx_k],
            soft_pre=sp_tr[idx_k] if sp_tr is not None else None,
            soft_perc=spe_tr[idx_k],
        )

    print("\n[5 or 6] Evaluating on held-out test set")
    results  = evaluate_student(model, X_te, ye_te, yp_te, yps_te, src_te, tag=label)
    mean_auc = np.mean([v.get("auc_roc", 0.) for v in results.values()])
    print(f"\n  Mean AUC (emo + pre_stage + perc) = {mean_auc:.4f}")

    print("\n[Last] Saving model")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model.save(MODELS_DIR / "student_model.pkl")
    print(f"  Saved → {MODELS_DIR}/student_model.pkl")

    rpt = {
        "model"    : label,
        "mean_auc" : mean_auc,
        "heads"    : ["emo", "pre_stage", "perc"],
        "pre_stage_framing":
            "pre_stage (emo=1 & perc=0): build-up phase before perceived stress fires",
        "results"  : results,
    }

    def _j(o):
        if isinstance(o, np.integer):  return int(o)
        if isinstance(o, np.floating): return float(o)
        if isinstance(o, np.ndarray):  return o.tolist()
        raise TypeError(type(o))

    with open(MODELS_DIR / "student_results.json", "w") as f:
        json.dump(rpt, f, indent=2, default=_j)

    print(f"\n{'=' * 62}")
    print(f"  Student: {label}  Mean AUC={mean_auc:.4f}")
    print(f"  Stage 0=no stress | Stage 1=pre_stage | Stage 2=perceived")
    print(f"{'=' * 62}\n")
    return model, results


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--npz",      default=None)
    p.add_argument("--soft_dir", default=None)
    p.add_argument("--model",    default="mlp", choices=["mlp", "knn", "cnn_bilstm"],
                   help="Student model type (default: mlp)")
    p.add_argument("--extended", action="store_true",
                   help="Use 76-dim extended features (requires re-running feature_extraction.py)")
    args = p.parse_args()
    model, results = run_student_pipeline(
        Path(args.npz)      if args.npz      else None,
        Path(args.soft_dir) if args.soft_dir else SOFT_DIR,
        model_type=args.model,
        use_extended=args.extended,
    )
    for k, m in results.items():
        print(f"  {k}: auc={m['auc_roc']:.4f}  bal_acc={m['balanced_accuracy']:.4f}")