from __future__ import annotations

import math
import os
from typing import Optional

import numpy as np
import pandas as pd

MODALITIES = ["eeg", "hrv_gsr"]


# ═══════════════════════════════════════════════════════════════════
#  SINGLE-WINDOW REAL-TIME FUSION (used by fusion_live_session.py's
#  live poll loop -- the only fusion path in this file. An earlier
#  Firestore-backed offline batch path (load_fusion_records()/
#  compute_fusion_for_records()/preprocess()/main()) was removed: the
#  Cloud Firestore API was never enabled on this project (confirmed by
#  a live PERMISSION_DENIED when actually queried), so that path could
#  never run against real data, only ever held dummy seed rows, and had
#  already drifted out of sync with fixes made here (the flat-0.5 fused
#  label, the plausibility gate below) -- removing it removes that
#  synchronization risk outright rather than adding another place future
#  fixes must be remembered and re-applied. If batch analysis becomes
#  needed later, build it against RTDB fusion_en/{user}/{session}/* --
#  where real production fusion data actually lives -- not Firestore.
#
#  (Behavioral/phenotyping was dropped as a fusion input -- MODALITIES is
#  EEG + HRV/GSR only now; backend/phenotyping_behavior/ keeps writing its
#  own predictions elsewhere, just not into this fusion.)
#
#  Fixes the scale mismatch compute_reliability_weight() silently had:
#  signal_quality_eeg is a SignalQualityGate score on 0-100 (see
#  backend/psychological/realtime/quality_gate.py), while
#  signal_quality_hrv_gsr is already 0.0-1.0
#  (backend/physiological/extract_features.py::compute_signal_quality) --
#  multiplying them together unnormalized let EEG's raw weight come out
#  ~100x inflated over HRV/GSR whenever EEG actually had a real value,
#  drowning out HRV/GSR almost entirely regardless of its own
#  quality/confidence. normalize_to_unit() below fixes that at the point
#  weights are computed, not by changing what gets stored in Firebase
#  (signal_quality_eeg stays 0-100 everywhere else it's read -- the EEG
#  screen's own display, SignalQualityGate's GOOD/QUESTIONABLE/POOR bands --
#  only this function's internal math treats it as 0-1).
#
#  model_acc is read from each modality's OWN model_acc_{m} field already
#  present in modalities_data (written once, at the source, by each
#  modality's own pipeline -- 0.706 for the deployed bipolar-only EEG
#  model, 0.851 for HRV/GSR; see
#  backend/psychological/realtime/firebase_sync.py::MODEL_ACCURACY_AUC,
#  backend/physiological/firebase_service.py::MODEL_ACC_HRV_GSR) rather
#  than a second hardcoded constant here that could drift out of sync with
#  the real, measured value each pipeline already reports.
# ═══════════════════════════════════════════════════════════════════

def normalize_to_unit(val, max_val: float = 1.0) -> float:
    """Clamps and scales a raw metric safely into [0.0, 1.0]."""
    if val is None:
        return 0.0
    try:
        val = float(val)
    except (TypeError, ValueError):
        return 0.0
    if np.isnan(val):
        return 0.0
    return max(0.0, min(1.0, val / max_val))


# A probability this close to 0 or 1 is not plausible confidence from
# either deployed model (EEG LOSO AUC 0.706, HRV/GSR LOSO accuracy 0.851 --
# see MODEL_ACCURACY_AUC/MODEL_ACC_HRV_GSR): reaching it requires the
# underlying decision function to sit dozens of log-odds from center, which
# real captured hardware sessions have shown happens only when live
# features fall far outside the model's training distribution (EEG
# raw_score collapsing to ~1e-37..1e-67 on real, quality-gate-PASSED
# blocks during this project's own validation -- a domain-shift artifact,
# not genuine certainty). 1e-6 sits comfortably below every plausible real
# score this project has observed (0.01-0.13) and comfortably above every
# observed underflow artifact, so it cleanly separates the two without
# touching either model's own calibration.
EXTREME_PROB_EPS = 1e-6


def _is_implausibly_extreme(prob: float) -> bool:
    return prob < EXTREME_PROB_EPS or prob > (1.0 - EXTREME_PROB_EPS)


def _fuse_raw(modalities_data: dict) -> dict:
    """
    Reliability-weighted fusion of one already-bucketed fusion_en window
    (see fusion_window_key()) across EEG and HRV/GSR streams, for
    fusion_live_session.py's live poll loop.

    modalities_data: {m: {"prob": ..., "confidence": ..., "signal_quality":
    ..., "model_acc": ..., "threshold": ...}} for m in MODALITIES -- a
    modality dict missing or with prob=None is treated as not reporting
    this window (weight 0), same effect as handle_missing_values() has on
    the batch path above. A modality reporting an IMPLAUSIBLY EXTREME prob
    (see EXTREME_PROB_EPS/_is_implausibly_extreme()) gets the same
    treatment -- weight 0, excluded from active_modalities -- since an
    out-of-distribution artifact dominating the fused result under a false
    appearance of certainty is worse than that modality simply not having
    reported this window at all.

    "threshold" is that modality's own EFFECTIVE decision boundary at the
    moment this reading was made -- personal_high_load_p if this user has
    completed EEG's onboarding threshold task, else the population
    high_load_p default (same for HRV/GSR's personal_stress_threshold /
    STRESS_DECISION_THRESHOLD); see make_eeg_fusion_record() and
    save_fusion_en_rtdb()'s callers. fused_stress_label used to compare
    fused_prob against a flat 0.5 -- disconnected from either modality's
    own calibrated threshold (~0.79 EEG, ~0.71 HRV/GSR population defaults,
    let alone either one's real personal value). fused_threshold below is
    instead the SAME reliability-weighted combination already used for
    fused_prob itself, just applied to each modality's threshold instead
    of its probability -- renormalized across only the modalities that
    both contributed weight AND supplied a threshold, so a modality
    temporarily missing a threshold doesn't silently drag the fused
    threshold toward 0.

    WHY a weighted COMBINATION of two still-separate probabilities, rather
    than either averaging blindly or collapsing them into one derived
    signal, per the interaction between EEG cognitive load and HRV/GSR
    autonomic arousal this fusion is modeling:
      - Shared response: a genuinely high-load mental task (e.g. this
        project's own onboarding arithmetic threshold task,
        EegThresholdTaskScreen.js) drives sympathetic activation too --
        cognitive load and autonomic arousal tend to rise TOGETHER under
        real stress, which is exactly why reliability weighting lets
        whichever modality currently has the stronger/cleaner signal
        dominate fused_prob rather than needing both to agree before
        registering anything.
      - Resource competition: sustained high arousal can itself degrade
        cognitive performance (and vice versa), so the two are not
        independent noise sources being averaged down -- they're expected
        to correlate under load, which modality_concordance below makes
        explicit instead of silently burying it inside one blended number.
      - Independent effects: the two can still diverge -- they act through
        separate physiological/mental pathways and don't always move
        together (e.g. elevated arousal with no measurable EEG load
        change, or the reverse). This is exactly why they're kept as two
        separately-tracked, reliability-weighted probabilities instead of
        one merged pre-fusion feature: a real divergence stays visible
        (see active_modalities/modality_weights) rather than being averaged
        away before it could ever be seen.
    """
    raw_weights = {}
    probs = {}
    thresholds = {}
    threshold_scales = {}

    for m in MODALITIES:
        mod_info = modalities_data.get(m) or {}
        prob = mod_info.get("prob")
        if prob is None:
            raw_weights[m] = 0.0
            probs[m] = 0.0
            thresholds[m] = None
            threshold_scales[m] = None
            continue

        conf = normalize_to_unit(mod_info.get("confidence"), 1.0)
        max_quality = 100.0 if m == "eeg" else 1.0
        quality = normalize_to_unit(mod_info.get("signal_quality"), max_quality)
        acc = normalize_to_unit(mod_info.get("model_acc"), 1.0)

        raw_weights[m] = quality * conf * acc
        probs[m] = normalize_to_unit(prob, 1.0)
        thresholds[m] = mod_info.get("threshold")
        threshold_scales[m] = mod_info.get("threshold_scale")

        # Plausibility gate -- see EXTREME_PROB_EPS's docstring. Zeroing the
        # WEIGHT (not probs[m] itself, which stays as reported for anyone
        # inspecting the raw record) means this modality contributes
        # nothing to fused_prob/fused_threshold and is excluded from
        # active_modalities/concordance below, identical to a missing prob.
        if _is_implausibly_extreme(probs[m]):
            raw_weights[m] = 0.0

    total_weight = sum(raw_weights.values())
    if total_weight > 1e-9:
        norm_weights = {m: w / total_weight for m, w in raw_weights.items()}
        fused_prob = sum(probs[m] * norm_weights[m] for m in MODALITIES)

        threshold_capable = [m for m in MODALITIES if raw_weights[m] > 0 and thresholds[m] is not None]
        if threshold_capable:
            tw_total = sum(raw_weights[m] for m in threshold_capable)
            fused_threshold = sum(thresholds[m] * (raw_weights[m] / tw_total) for m in threshold_capable)
        else:
            # Only reachable if every active modality is missing a
            # threshold value entirely (shouldn't happen once both sides'
            # /predict routes always supply their own effective threshold,
            # personal or population) -- 0.5 kept as a last-resort fallback,
            # not the everyday behavior.
            fused_threshold = 0.5
    else:
        norm_weights = {m: 0.0 for m in MODALITIES}
        fused_prob = None
        fused_threshold = None

    # modality_concordance -- makes the shared-response / independent-effects
    # tension explicit rather than letting the weighted average silently
    # paper over it: each active, threshold-capable modality is "elevated"
    # if ITS OWN prob is at/above ITS OWN effective threshold (not a shared
    # cutoff). All elevated (or all not) = 'concordant' -- EEG and HRV/GSR
    # agreeing is exactly what a genuine shared stress response predicts.
    # A split = 'discordant' -- not an error, just the independent-pathway
    # case surfacing (e.g. autonomic arousal up with no matching cognitive-
    # load rise, or vice versa) -- worth a caller's attention even though
    # fused_prob/fused_threshold above already handle it numerically via
    # reliability weighting. 'insufficient_data' when fewer than two
    # modalities are both active and threshold-capable this window, since
    # concordance/discordance isn't a meaningful comparison with only one
    # (or zero) real reading. Purely additive/observational -- does NOT
    # feed back into fused_prob/fused_threshold above.
    concordance_capable = [m for m in MODALITIES if raw_weights[m] > 0 and thresholds[m] is not None]
    modality_elevated = {m: (probs[m] >= thresholds[m]) for m in concordance_capable}
    if len(concordance_capable) >= 2:
        modality_concordance = "concordant" if len(set(modality_elevated.values())) == 1 else "discordant"
    else:
        modality_concordance = "insufficient_data"

    # Diagnostic only -- which modalities reported a real prob but got
    # gated out for being implausibly extreme (distinct from simply not
    # reporting at all, which active_modalities' absence already covers).
    # Recomputed from probs[m] (not raw_weights[m]==0, which is also true
    # for a modality that never reported) so this doesn't conflate the two
    # very different reasons a modality can end up excluded.
    implausible_modalities = [
        m for m in MODALITIES
        if (modalities_data.get(m) or {}).get("prob") is not None and _is_implausibly_extreme(probs[m])
    ]

    # fused_relative_index -- ADDITIVE, does not change fused_stress_
    # probability/threshold/label above (those keep their exact existing
    # values/meaning for every current consumer, e.g. relaxation_guide's
    # get_latest_prediction()). fused_stress_label is ALREADY algebraically
    # equivalent to a margin-based decision (fused_prob - fused_threshold
    # ==  the weighted average of each modality's OWN (prob - threshold),
    # since both use the same weights) -- so this isn't a different
    # decision, it's a differently-SCALED number for anyone who needs a
    # value that's comparable across modalities/users, which raw
    # fused_stress_probability is not (EEG's and Ring's population
    # thresholds differ by ~0.05-0.08, before personal calibration adds
    # more per-user spread on top -- 0.5 has no fixed meaning on the raw
    # scale, but 0 always means "exactly at this window's combined
    # personal threshold" here).
    #
    # Each modality's margin (prob - threshold) is normalized by ITS OWN
    # threshold_scale (EEG: MAX_THRESHOLD_SHIFT ~0.11, derived from real
    # SAM40 population spread; Ring: PERSONAL_THRESHOLD_MIN_SEPARATION
    # ~0.10, hand-picked -- see sam40/decision.py and physiological/
    # predictor.py) BEFORE combining with the same reliability weights
    # used above -- so "distance above/below threshold" is expressed in
    # units of "how big a shift this modality's own calibration considers
    # meaningful", not raw probability points, which aren't directly
    # comparable between two different classifiers.
    relative_capable = [
        m for m in MODALITIES
        if raw_weights[m] > 0 and thresholds[m] is not None
        and threshold_scales[m] is not None and threshold_scales[m] > 0
    ]
    if relative_capable:
        rw_total = sum(raw_weights[m] for m in relative_capable)
        fused_relative_index = sum(
            ((probs[m] - thresholds[m]) / threshold_scales[m]) * (raw_weights[m] / rw_total)
            for m in relative_capable
        )
    else:
        # Only reachable if every active, threshold-capable modality is
        # missing its threshold_scale (a caller not yet passing it) --
        # None here, not a guessed fallback, so a caller not supplying
        # threshold_scale gets an honest "not computed" rather than a
        # silently wrong number.
        fused_relative_index = None

    return {
        "fused_stress_probability": fused_prob,
        "fused_stress_threshold": fused_threshold,
        "fused_stress_label": None if fused_prob is None else ("HIGH_STRESS" if fused_prob >= fused_threshold else "NORMAL"),
        "fused_relative_index": fused_relative_index,
        "active_modalities": [m for m in MODALITIES if raw_weights[m] > 0],
        "modality_weights": norm_weights,
        "modality_concordance": modality_concordance,
        "modality_elevated": modality_elevated,
        "implausible_modalities": implausible_modalities,
    }


# ═══════════════════════════════════════════════════════════════════
#  ALIGNED-SCALE FUSION (default)
#
#  _fuse_raw() averages each model's RAW probability. The two models' raw
#  scales aren't comparable: on wearable02 the EEG model outputs ~0.001 at
#  rest (its own alert limit ~0.14), HRV/GSR ~0.9 under stress (limit ~0.71)
#  -- averaging those drags the fused value to whichever model happens to
#  output small numbers, regardless of where each sits relative to ITS OWN
#  limit. Its confidence max(p, 1-p) also rewards a saturated output (0.001
#  reads as "99.9% confident"), giving that model MORE weight exactly when
#  its number means least.
#
#  Aligned fusion first puts every model on one scale: its distance from its
#  own (personal or population) limit, in units of its own spread
#  (threshold_scale: EEG = the Personal Scale sigma, HRV/GSR =
#  PERSONAL_THRESHOLD_MIN_SEPARATION), mapped through a logistic:
#      p' = sigmoid((p - threshold) / threshold_scale)
#  so every model's limit sits at 0.5 and one spread above it at 0.73. The
#  usual quality x confidence x prior weighting then runs on p' (confidence
#  = max(p', 1-p')), and the fused limit is 0.5. A modality without a
#  threshold/scale makes the whole window fall back to raw fusion rather
#  than mix scales.
#
#  The function's own default stays "raw", so the paper's analysis scripts
#  (paper/analysis/revision*_analyses.py) reproduce their published numbers;
#  the LIVE system (fusion_live_session.py) passes FUSION_SCALE, which
#  defaults to "aligned" (set FUSION_SCALE=raw to go back).
# ═══════════════════════════════════════════════════════════════════

FUSION_SCALE = os.environ.get("FUSION_SCALE", "aligned").strip().lower()

# Saturated outputs (outside EXTREME_PROB_EPS) under the ALIGNED scale.
# _fuse_raw() drops them because raw confidence max(p, 1-p) would read a
# saturated 1e-7 as ~100% certain. The aligned scale doesn't have that
# problem: p is bounded in [0, 1], so its distance (p - threshold)/scale is
# bounded too (EEG at p=0 sits at -threshold/sigma, about -1 for a typical
# personal limit), and its confidence comes from p', not p. Dropping it only
# throws away a reading that does say "well below this person's limit". So
# the aligned path keeps it, clipped to [EPS, 1-EPS], with its weight scaled
# by this factor (it is still an out-of-training-range output) and listed in
# saturated_modalities. FUSION_SATURATED_WEIGHT=0 restores the old drop.
SATURATED_WEIGHT = float(os.environ.get("FUSION_SATURATED_WEIGHT", "0.5"))

# Cap on any one modality's aligned distance (in its own spreads), so one
# far-out reading can't pin p' at 0 or 1 on its own.
ALIGNED_Z_CAP = 3.0

# A modality may supply its own distance from its personal limit instead of
# (prob - threshold) / threshold_scale: "z" (distance from its own rest, in
# its own spreads) and "z_alert" (where its limit sits on that scale). EEG
# does, on a log-odds scale -- see backend/psychological/sam40/decision.py
# PERSONAL_SIGMA_LOGIT -- because its probability-space distance is flattened
# when scores sit near 0. FUSION_EEG_Z=0 ignores z and uses the probability
# distance for every modality.
USE_MODALITY_Z = os.environ.get("FUSION_EEG_Z", "1") != "0"


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def compute_realtime_multimodal_fusion(modalities_data: dict, scale: str | None = None) -> dict:
    """Reliability-weighted fusion of one window -- see the ALIGNED-SCALE
    FUSION note above and _fuse_raw()'s docstring for the weighting itself.
    Returns _fuse_raw()'s fields; under the aligned scale,
    fused_stress_probability/threshold/label/modality_weights are the aligned
    ones (threshold 0.5), and fused_probability_raw/fused_threshold_raw keep
    the raw-scale result for comparison."""
    scale = "raw" if scale is None else scale
    raw = _fuse_raw(modalities_data)
    out = {**raw, "fused_scale": "raw", "saturated_modalities": [],
           "fused_probability_raw": raw["fused_stress_probability"],
           "fused_threshold_raw": raw["fused_stress_threshold"], "aligned_probs": {}}
    if scale != "aligned":
        return out

    aligned = {}
    dist = {}
    saturated = []
    for m in MODALITIES:
        info = modalities_data.get(m) or {}
        p, thr, sc = info.get("prob"), info.get("threshold"), info.get("threshold_scale")
        if p is None:
            aligned[m] = {"prob": None}
            continue
        if thr is None or not sc or sc <= 0:
            return out                       # can't align this one: don't mix scales
        p = float(p)
        quality = info.get("signal_quality")
        if m in raw["implausible_modalities"]:
            if SATURATED_WEIGHT <= 0:
                aligned[m] = {"prob": None}
                continue
            p = min(max(p, EXTREME_PROB_EPS), 1.0 - EXTREME_PROB_EPS)
            quality = None if quality is None else float(quality) * SATURATED_WEIGHT
            saturated.append(m)
        z, z_alert = info.get("z"), info.get("z_alert")
        if USE_MODALITY_Z and z is not None and z_alert is not None:
            d_raw = float(z) - float(z_alert)
        else:
            d_raw = (p - float(thr)) / float(sc)
        d = max(-ALIGNED_Z_CAP, min(ALIGNED_Z_CAP, d_raw))
        dist[m] = d
        pa = _sigmoid(d)
        aligned[m] = {**info, "prob": pa, "confidence": max(pa, 1.0 - pa),
                      "signal_quality": quality, "threshold": 0.5, "threshold_scale": None}
    res = _fuse_raw(aligned)
    if res["fused_stress_probability"] is None:
        return out

    # Comparable-units margin, weighted by the ALIGNED weights.
    w = res["modality_weights"]
    rel = sum(w[m] * dist[m] for m in MODALITIES if w.get(m, 0) > 0)
    return {**out,
            "implausible_modalities": [m for m in raw["implausible_modalities"] if m not in saturated],
            "saturated_modalities": saturated,
            "modality_concordance": res["modality_concordance"],
            "modality_elevated": res["modality_elevated"],
            "fused_stress_probability": res["fused_stress_probability"],
            "fused_stress_threshold": 0.5,
            "fused_stress_label": "HIGH_STRESS" if res["fused_stress_probability"] >= 0.5 else "NORMAL",
            "modality_weights": res["modality_weights"],
            "active_modalities": res["active_modalities"],
            "fused_relative_index": rel,
            "fused_scale": "aligned",
            "aligned_probs": {m: a["prob"] for m, a in aligned.items() if a["prob"] is not None}}


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


# Note: this module no longer has a __main__ entry point -- it was the
# Firestore batch pipeline's own driver (load -> preprocess -> summarize ->
# fit meta-model), removed along with that pipeline. Stage 8 above
# (fit_logistic_meta_model()/apply_meta_model()) is still directly callable
# against any DataFrame with the right columns -- e.g. a future RTDB-sourced
# one -- it just has no built-in loader/driver script anymore.
