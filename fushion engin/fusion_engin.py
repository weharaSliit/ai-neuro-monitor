from __future__ import annotations

from datetime import timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent


MODALITIES = ["eeg", "hrv_gsr", "behav"]
NUMERIC_SUFFIXES = ["prob", "conf", "model_acc", "signal_quality"]

STALE_MAX_AGE_S = 30.0    # a modality's reading older than this is "stale"
MIN_CONFIDENCE  = 0.70    # below this, a modality's reading isn't trusted


# ═══════════════════════════════════════════════════════════════════
#  LOAD
# ═══════════════════════════════════════════════════════════════════

def load_fusion_records(collection_name: str = "fusion_engine",
                         credentials_path: Optional[Path] = None,
                         limit: Optional[int] = None) -> pd.DataFrame:

    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred_path = credentials_path or (_HERE / "serviceAccountKey.json")
        cred = credentials.Certificate(str(cred_path))
        firebase_admin.initialize_app(cred)
    db = firestore.client()

    query = db.collection(collection_name).order_by("timestamp")
    if limit:
        query = query.limit(limit)

    rows = []
    for doc in query.stream():
        d = doc.to_dict()
        d["doc_id"] = doc.id
        rows.append(d)

    df = pd.DataFrame(rows)
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    return df

_LEGACY_COLUMN_ALIASES = {
    "signal_quality_gsr_hrv": "signal_quality_hrv_gsr",
}


def normalize_legacy_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for legacy, canonical in _LEGACY_COLUMN_ALIASES.items():
        if legacy not in df.columns:
            continue
        if canonical in df.columns:
            df[canonical] = df[canonical].fillna(df[legacy])
            df = df.drop(columns=[legacy])
        else:
            df = df.rename(columns={legacy: canonical})
    return df


# ═══════════════════════════════════════════════════════════════════
#  STAGE 1 — TIMESTAMP SYNCHRONIZATION
# ═══════════════════════════════════════════════════════════════════

def synchronize_timestamps(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")

    for m in MODALITIES:
        col = f"timestamp_{m}"
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
        else:
            df[col] = df.get("timestamp")

    ts_cols = [f"timestamp_{m}" for m in MODALITIES]
    df["sync_skew_s"] = (df[ts_cols].max(axis=1) - df[ts_cols].min(axis=1)).dt.total_seconds()
    return df


# ═══════════════════════════════════════════════════════════════════
#  STAGE 2 — MISSING-VALUE HANDLING
# ═══════════════════════════════════════════════════════════════════

def handle_missing_values(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for m in MODALITIES:
        prob_col, conf_col = f"prob_{m}", f"conf_{m}"
        has_prob = prob_col in df.columns
        has_conf = conf_col in df.columns
        if has_prob and has_conf:
            df[f"{m}_missing"] = df[prob_col].isna() | df[conf_col].isna()
        else:
            df[f"{m}_missing"] = True

        for suffix in NUMERIC_SUFFIXES:
            col = f"{suffix}_{m}"
            df[col] = df[col].fillna(0.0) if col in df.columns else 0.0

        label_col = f"stress_label_{m}"
        df[label_col] = df[label_col].fillna("unknown") if label_col in df.columns else "unknown"

    return df


# ═══════════════════════════════════════════════════════════════════
#  STAGE 3 — STALE-PREDICTION DETECTION
# ═══════════════════════════════════════════════════════════════════

def flag_stale_predictions(df: pd.DataFrame,
                            max_age_s: float = STALE_MAX_AGE_S,
                            reference: str = "row_max") -> pd.DataFrame:
    
    df = df.copy()
    ts_cols = [f"timestamp_{m}" for m in MODALITIES]

    if reference == "wall_clock":
        ref = pd.Series(pd.Timestamp.now(tz=timezone.utc), index=df.index)
    elif reference == "row_max":
        ref = df[ts_cols].max(axis=1)
    else:
        raise ValueError(f"Unknown reference: {reference!r} (want 'wall_clock' or 'row_max')")

    for m in MODALITIES:
        age_s = (ref - df[f"timestamp_{m}"]).dt.total_seconds()
        df[f"{m}_age_s"] = age_s
        df[f"{m}_stale"] = age_s > max_age_s

    return df


# ═══════════════════════════════════════════════════════════════════
#  STAGE 4 — CONFIDENCE THRESHOLDING
# ═══════════════════════════════════════════════════════════════════

def apply_confidence_threshold(df: pd.DataFrame,
                                min_confidence: float = MIN_CONFIDENCE) -> pd.DataFrame:
    df = df.copy()
    for m in MODALITIES:
        df[f"{m}_confident"] = df[f"conf_{m}"] >= min_confidence
    return df


def flag_usable(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for m in MODALITIES:
        df[f"{m}_usable"] = ~df[f"{m}_missing"] & ~df[f"{m}_stale"] & df[f"{m}_confident"]
    return df


# ═══════════════════════════════════════════════════════════════════
#  STAGE 5 — RELIABILITY WEIGHTING
# ═══════════════════════════════════════════════════════════════════

def compute_reliability_weight(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for m in MODALITIES:
        df[f"{m}_reliability_weight"] = (
            df[f"signal_quality_{m}"] * df[f"model_acc_{m}"] * df[f"conf_{m}"]
        )
    return df


# ═══════════════════════════════════════════════════════════════════
#  STAGE 6 — RELIABILITY-WEIGHT NORMALIZATION
# ═══════════════════════════════════════════════════════════════════

def normalize_reliability_weights(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    weight_cols = [f"{m}_reliability_weight" for m in MODALITIES]
    total = df[weight_cols].sum(axis=1)
    for m in MODALITIES:
        df[f"{m}_reliability_weight_norm"] = np.where(
            total > 0, df[f"{m}_reliability_weight"] / total, 0.0
        )
    return df


# ═══════════════════════════════════════════════════════════════════
#  STAGE 7 — WEIGHTED FUSION
# ═══════════════════════════════════════════════════════════════════

def compute_weighted_fusion(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    weighted_cols = []
    for m in MODALITIES:
        col = f"{m}_weighted_avg"
        df[col] = df[f"prob_{m}"] * df[f"{m}_reliability_weight_norm"]
        weighted_cols.append(col)
    df["fused_probability"] = df[weighted_cols].sum(axis=1)
    return df


def compute_fusion_for_records(rows: list[dict]) -> list[dict]:
    df = pd.DataFrame(rows)
    df = handle_missing_values(df)
    df = compute_reliability_weight(df)
    df = normalize_reliability_weights(df)
    df = compute_weighted_fusion(df)
    df["fused_label"] = (df["fused_probability"] >= 0.5).astype(int)
    return df.to_dict(orient="records")


# ═══════════════════════════════════════════════════════════════════
#  STAGE 8 — LEARNED LOGISTIC META-MODEL (alternative to Stage 7's
#  fixed weighted average; requires real, labeled data)
# ═══════════════════════════════════════════════════════════════════

from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, KFold
from sklearn.metrics import roc_auc_score, average_precision_score, brier_score_loss

DEFAULT_META_FEATURES = ["prob_eeg", "prob_hrv_gsr"]
MIN_META_TRAIN_ROWS = 30   # below this, a fitted logistic model is not stable
                           # enough to report coefficients from with any confidence


class MetaModelResult:
    def __init__(self, model, feature_names, oof_pred, y_true, groups_used):
        self.model = model
        self.feature_names = feature_names
        self.oof_pred = oof_pred
        self.y_true = y_true
        self.groups_used = groups_used

    @property
    def coefficients(self) -> dict:
        coefs = {"intercept": float(self.model.intercept_[0])}
        for name, b in zip(self.feature_names, self.model.coef_[0]):
            coefs[name] = float(b)
        return coefs

    @property
    def oof_auc(self) -> float:
        return float(roc_auc_score(self.y_true, self.oof_pred))

    @property
    def oof_pr_auc(self) -> float:
        return float(average_precision_score(self.y_true, self.oof_pred))

    @property
    def oof_brier(self) -> float:
        return float(brier_score_loss(self.y_true, self.oof_pred))

    def summary(self) -> str:
        lines = [f"Logistic meta-model ({'grouped' if self.groups_used else 'plain'} "
                 f"out-of-fold CV, n={len(self.y_true)}):"]
        for name, b in self.coefficients.items():
            lines.append(f"  {name:<14} = {b:+.4f}")
        lines.append(f"  out-of-fold ROC-AUC = {self.oof_auc:.4f}   "
                      f"PR-AUC = {self.oof_pr_auc:.4f}   Brier = {self.oof_brier:.4f}")
        return "\n".join(lines)


def fit_logistic_meta_model(
    df: pd.DataFrame,
    label_col: str,
    feature_cols: list[str] = None,
    group_col: Optional[str] = "session_id",
    n_splits: int = 5,
    include_interaction: bool = False,
    random_state: int = 42,
) -> Optional[MetaModelResult]:

    feature_cols = feature_cols or DEFAULT_META_FEATURES

    if label_col not in df.columns:
        print(f"[meta-model] No ground-truth column '{label_col}' found in the data — "
              f"refusing to fit. The only label-like columns present "
              f"({[c for c in df.columns if c.startswith('stress_label_')]}) are each "
              f"modality's OWN prediction, not independent ground truth; fitting against "
              f"one of those would measure inter-modality agreement, not real stress "
              f"detection. Add a genuine label (self-report, validated reference) to the "
              f"fusion_engine records before training this meta-model.")
        return None

    missing_feats = [c for c in feature_cols if c not in df.columns]
    if missing_feats:
        print(f"[meta-model] Missing feature column(s): {missing_feats} — refusing to fit.")
        return None

    valid = df[feature_cols + [label_col]].notna().all(axis=1)
    n_valid = int(valid.sum())
    if n_valid < MIN_META_TRAIN_ROWS:
        print(f"[meta-model] Only {n_valid} labeled row(s) available (need >= "
              f"{MIN_META_TRAIN_ROWS}) — refusing to fit. This is expected if the "
              f"fusion_engine collection currently only holds upload_fusion_dataset.py's "
              f"dummy rows; it will start passing once dashboard_server.py (real EEG) and "
              f"a real HRV/GSR system are both writing labeled rows over real sessions.")
        return None

    sub = df.loc[valid].reset_index(drop=True)
    X = sub[feature_cols].to_numpy(dtype=float)
    if include_interaction and len(feature_cols) == 2:
        inter = (X[:, 0] * X[:, 1]).reshape(-1, 1)
        X = np.concatenate([X, inter], axis=1)
        feature_names = feature_cols + [f"{feature_cols[0]}*{feature_cols[1]}"]
    else:
        feature_names = list(feature_cols)
    y = sub[label_col].to_numpy()

    groups_used = group_col is not None and group_col in sub.columns and sub[group_col].nunique() >= n_splits
    if groups_used:
        splitter = GroupKFold(n_splits=n_splits)
        splits = splitter.split(X, y, groups=sub[group_col])
    else:
        if group_col is not None and group_col in sub.columns:
            print(f"[meta-model] '{group_col}' has fewer distinct values than n_splits="
                  f"{n_splits} — falling back to plain (ungrouped) KFold. Revisit once more "
                  f"sessions exist; ungrouped CV on session-correlated rows can leak.")
        splitter = KFold(n_splits=n_splits, shuffle=True, random_state=random_state)
        splits = splitter.split(X, y)

    oof_pred = np.full(len(y), np.nan)
    for tr, te in splits:
        if len(np.unique(y[tr])) < 2:
            continue
        fold_model = LogisticRegression(max_iter=1000, random_state=random_state)
        fold_model.fit(X[tr], y[tr])
        oof_pred[te] = fold_model.predict_proba(X[te])[:, 1]

    if np.isnan(oof_pred).any() or len(np.unique(y[~np.isnan(oof_pred)])) < 2:
        print("[meta-model] Could not complete out-of-fold evaluation (a fold had only one "
              "class present) — refusing to report coefficients without honest OOF metrics.")
        return None

    final_model = LogisticRegression(max_iter=1000, random_state=random_state)
    final_model.fit(X, y)   # refit on ALL valid data for the deployed model;
                             # oof_pred (from the per-fold models above) is what's reported

    result = MetaModelResult(final_model, feature_names, oof_pred, y, groups_used)
    print(f"[meta-model] Fit on {n_valid} real rows.\n{result.summary()}")
    return result


def apply_meta_model(df: pd.DataFrame, result: MetaModelResult) -> pd.DataFrame:
    df = df.copy()
    base_feats = [f for f in result.feature_names if "*" not in f]
    have_all = df[base_feats].notna().all(axis=1)
    X = df.loc[have_all, base_feats].to_numpy(dtype=float)
    if len(result.feature_names) > len(base_feats):
        inter = (X[:, 0] * X[:, 1]).reshape(-1, 1)
        X = np.concatenate([X, inter], axis=1)
    pred = np.full(len(df), np.nan)
    if len(X):
        pred[have_all.to_numpy()] = result.model.predict_proba(X)[:, 1]
    df["fused_probability_meta"] = pred
    return df


# ═══════════════════════════════════════════════════════════════════
#  PIPELINE
# ═══════════════════════════════════════════════════════════════════

def preprocess(df: pd.DataFrame,
               max_age_s: float = STALE_MAX_AGE_S,
               min_confidence: float = MIN_CONFIDENCE,
               staleness_reference: str = "row_max") -> pd.DataFrame:
    n = len(df)
    print(f"[fusion_engin] preprocess: {n} rows")

    print("[fusion_engin] Stage 0/7 — normalize_legacy_columns ...")
    df = normalize_legacy_columns(df)

    print("[fusion_engin] Stage 1/7 — synchronize_timestamps ...")
    df = synchronize_timestamps(df)

    print("[fusion_engin] Stage 2/7 — handle_missing_values ...")
    df = handle_missing_values(df)

    print(f"[fusion_engin] Stage 3/7 — flag_stale_predictions "
          f"(max_age_s={max_age_s}, reference={staleness_reference!r}) ...")
    df = flag_stale_predictions(df, max_age_s=max_age_s, reference=staleness_reference)

    print(f"[fusion_engin] Stage 4/7 — apply_confidence_threshold "
          f"(min_confidence={min_confidence}) ...")
    df = apply_confidence_threshold(df, min_confidence=min_confidence)

    print("[fusion_engin] Stage 4b/7 — flag_usable ...")
    df = flag_usable(df)

    print("[fusion_engin] Stage 5/7 — compute_reliability_weight ...")
    df = compute_reliability_weight(df)

    print("[fusion_engin] Stage 6/7 — normalize_reliability_weights ...")
    df = normalize_reliability_weights(df)

    print("[fusion_engin] Stage 7/7 — compute_weighted_fusion ...")
    df = compute_weighted_fusion(df)

    print(f"[fusion_engin] preprocess: done ({n} rows -> {len(df.columns)} columns)")
    return df


def summarize(df: pd.DataFrame) -> None:
    print(f"Preprocessing summary ({len(df)} rows):")
    for m in MODALITIES:
        n_missing = int(df[f"{m}_missing"].sum())
        n_stale   = int(df[f"{m}_stale"].sum())
        n_unconf  = int((~df[f"{m}_confident"]).sum())
        n_usable  = int(df[f"{m}_usable"].sum())
        mean_rw   = df[f"{m}_reliability_weight"].mean()
        mean_rwn  = df[f"{m}_reliability_weight_norm"].mean()
        print(f"  {m:<9} missing={n_missing:>3}  stale={n_stale:>3}  "
              f"low_confidence={n_unconf:>3}  usable={n_usable:>3}/{len(df)}  "
              f"mean_reliability_weight={mean_rw:.3f}  mean_norm={mean_rwn:.3f}")
    print(f"  mean sync_skew_s = {df['sync_skew_s'].mean():.3f}s")
    print(f"  mean fused_probability = {df['fused_probability'].mean():.3f}")


def report_modality_coverage(raw: pd.DataFrame) -> dict:
    n = len(raw)
    print(f"\n{'=' * 62}\n  REAL-DATA MODALITY COVERAGE  (n={n:,} Firestore documents)\n{'=' * 62}")
    coverage = {}
    for m in MODALITIES:
        col = f"prob_{m}"
        n_present = int(raw[col].notna().sum()) if col in raw.columns else 0
        pct = n_present / n if n else 0.0
        coverage[m] = pct
        print(f"  {m:<9} {n_present:>7,}/{n:,} rows have a real {col}  ({pct:.1%})")
    has_ground_truth = any(
        c for c in raw.columns
        if c not in [f"stress_label_{m}" for m in MODALITIES] and "ground_truth" in c.lower()
    )
    print(f"  independent ground-truth label column present: {has_ground_truth}")
    if not has_ground_truth:
        print(f"  (only per-modality columns like stress_label_eeg exist — each is that")
        print(f"   modality's OWN prediction via its own threshold, not external ground")
        print(f"   truth; see fit_logistic_meta_model()'s docstring for why that means it")
        print(f"   can't be used as the meta-model's training label)")
    return coverage


def main():
    print("Loading fusion_engine records from Firestore (REAL collection, not the")
    print("upload_fusion_dataset.py dummy seed script) ...")
    raw = load_fusion_records()
    print(f"  {len(raw):,} records loaded")

    coverage = report_modality_coverage(raw)

    df = preprocess(raw)

    out_path = _HERE / "data" / "unified_output" / "fusion_preprocessed.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)

    print()
    summarize(df)
    print(f"\nSaved -> {out_path}")

    print(f"\n{'=' * 62}\n  LOGISTIC META-MODEL\n{'=' * 62}")
    min_coverage = 0.05   # need at least SOME real rows per feature to attempt fitting
    ready = coverage.get("eeg", 0.0) >= min_coverage and coverage.get("hrv_gsr", 0.0) >= min_coverage
    if not ready:
        print(f"  Skipping fit: prob_hrv_gsr coverage is {coverage.get('hrv_gsr', 0.0):.1%} "
              f"(need >={min_coverage:.0%}). Real EEG-only writes exist "
              f"({coverage.get('eeg', 0.0):.1%} coverage) but no HRV/GSR system has written "
              f"real predictions to this collection yet, and there is no independent "
              f"ground-truth label column either (see coverage report above) — both are")
        print(f"  required before b1/b2 would mean anything. Re-run once both exist.")
    else:
        fit_logistic_meta_model(
            df,
            label_col="ground_truth_stress",
            feature_cols=["prob_eeg", "prob_hrv_gsr"],
        )


if __name__ == "__main__":
    main()
