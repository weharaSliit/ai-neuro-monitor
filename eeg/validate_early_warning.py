"""
validate_early_warning.py — formal early-warning validation suite for the
three complementary detectors in trend_detector.py:

    PersonalTrendMonitor  — slow, sustained CUSUM (~20s dwell), gradual drift
    FeatureTrendMonitor   — multivariate counterpart, same dwell design
    ShockDetector         — fast, abrupt, majority-of-3 Shewhart, dual-signal

Computes the metrics an early-warning system should actually be judged on
(not classification AUC): false alarms/hour, mean time between false
alarms (MTBF), detection delay on an abrupt step-change, lead time on a
gradual ramp (vs. when the classifier itself would cross into STRESSED),
and an approximate precision/recall pass on real DEAP data.

IMPORTANT CAVEAT on the DEAP precision/recall numbers: DEAP labels are one
self-report rating per ~60s trial, replicated onto every epoch (see this
module's own docstring in trend_detector.py) — there is no real within-
trial onset timestamp. So "recall" here means "did some alarm fire
somewhere during a trial labeled stressed" (a coarse correlation check),
NOT "did the alarm fire at the correct moment relative to onset". The
synthetic ramp/step tests are what actually measure lead time / detection
delay, precisely because DEAP can't.

Run:
    python3 validate_early_warning.py
Outputs:
    data/unified_output/early_warning_report.json
"""

import sys
import json
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE / "models"))

from trend_detector import PersonalTrendMonitor, FeatureTrendMonitor, ShockDetector  # noqa: E402

UNIFIED_OUTPUT_DIR = _HERE / "data" / "unified_output"
REPORT_PATH = UNIFIED_OUTPUT_DIR / "early_warning_report.json"

EPOCH_STRIDE_S = 0.5
N_FEAT = 76


def _make_monitors():
    return PersonalTrendMonitor(), FeatureTrendMonitor(), ShockDetector()


def _step(t, p_emo, feat, trend_mon, feat_mon, shock):
    """One epoch through all three detectors. Returns a dict of their
    alarm flags/scores, matching what StressInferenceEngine.process_epoch
    actually wires together."""
    tr = trend_mon.update(t, p_emo, is_calm=True)
    fr = feat_mon.update(t, feat)
    p_base = trend_mon.fixed_baseline
    f_base = feat_mon.baseline
    sh = shock.update(t, p_emo, p_base.mu if p_base.ready else None, p_base.sigma, not p_base.ready,
                       fr.feature_dist, f_base.dist_mu if f_base.ready else None,
                       f_base.dist_sigma, not f_base.ready)
    calibrating = tr.calibrating or (not f_base.ready)
    any_alarm = tr.trend_alarm or fr.feature_trend_alarm or sh.shock_alarm
    return dict(calibrating=calibrating, trend_alarm=tr.trend_alarm,
                feature_trend_alarm=fr.feature_trend_alarm, shock_alarm=sh.shock_alarm,
                any_alarm=any_alarm)


# ─────────────────────────────────────────────
#  1) Calm false-alarm rate + MTBF  (synthetic, stationary)
# ─────────────────────────────────────────────

def run_calm_false_alarm_test(n_sessions=8, session_minutes=30, seed=0):
    rng = np.random.default_rng(seed)
    n_epochs = int(session_minutes * 60 / EPOCH_STRIDE_S)
    total_hours = n_sessions * session_minutes / 60.0

    counters = {k: {"events": 0, "prev": False} for k in
                ("trend_alarm", "feature_trend_alarm", "shock_alarm", "any_alarm")}

    for _ in range(n_sessions):
        trend_mon, feat_mon, shock = _make_monitors()
        for i in range(n_epochs):
            t = i * EPOCH_STRIDE_S
            p = float(np.clip(rng.normal(0.15, 0.08), 0, 1))
            feat = rng.normal(0, 1, size=N_FEAT)
            r = _step(t, p, feat, trend_mon, feat_mon, shock)
            if r["calibrating"]:
                continue
            for k in counters:
                cur = r[k]
                if cur and not counters[k]["prev"]:
                    counters[k]["events"] += 1
                counters[k]["prev"] = cur
        for k in counters:
            counters[k]["prev"] = False   # don't let a session-boundary edge leak into the next session

    out = {}
    for k, c in counters.items():
        rate_per_hr = c["events"] / total_hours
        mtbf_min = (total_hours * 60.0 / c["events"]) if c["events"] > 0 else None
        out[k] = {"events": c["events"], "false_alarms_per_hour": round(rate_per_hr, 4),
                   "mtbf_minutes": round(mtbf_min, 1) if mtbf_min else None}
    out["total_synthetic_hours"] = round(total_hours, 2)
    return out


# ─────────────────────────────────────────────
#  2) Abrupt step-change — detection delay
# ─────────────────────────────────────────────

def run_step_change_test(n_trials=5, inject_at_s=100.0, session_s=200.0, seed=10):
    delays = {"trend_alarm": [], "feature_trend_alarm": [], "shock_alarm": [], "any_alarm": []}
    n_epochs = int(session_s / EPOCH_STRIDE_S)

    for trial in range(n_trials):
        rng = np.random.default_rng(seed + trial)
        trend_mon, feat_mon, shock = _make_monitors()
        first_fire = {k: None for k in delays}
        for i in range(n_epochs):
            t = i * EPOCH_STRIDE_S
            p = float(np.clip(rng.normal(0.15, 0.08), 0, 1))
            feat = rng.normal(0, 1, size=N_FEAT)
            if t >= inject_at_s:
                p = float(np.clip(p + 0.5, 0, 1))
                feat = feat + 3.0
            r = _step(t, p, feat, trend_mon, feat_mon, shock)
            if t < inject_at_s:
                continue
            for k in delays:
                if r[k] and first_fire[k] is None:
                    first_fire[k] = t
        for k in delays:
            if first_fire[k] is not None:
                delays[k].append(round(first_fire[k] - inject_at_s, 2))

    out = {}
    for k, ds in delays.items():
        out[k] = {
            "n_detected": len(ds), "n_trials": n_trials,
            "mean_delay_s": round(float(np.mean(ds)), 2) if ds else None,
            "max_delay_s": round(float(np.max(ds)), 2) if ds else None,
        }
    return out


# ─────────────────────────────────────────────
#  3) Gradual ramp — lead time vs. classifier threshold crossing
# ─────────────────────────────────────────────

def run_ramp_lead_time_test(n_trials=5, ramp_start_s=100.0, ramp_end_s=220.0,
                             p_target=0.65, classifier_thresh=0.5, session_s=260.0, seed=20):
    lead_times = {"trend_alarm": [], "feature_trend_alarm": [], "shock_alarm": [], "any_alarm": []}
    n_epochs = int(session_s / EPOCH_STRIDE_S)

    for trial in range(n_trials):
        rng = np.random.default_rng(seed + trial)
        trend_mon, feat_mon, shock = _make_monitors()
        p_base = 0.15
        first_fire = {k: None for k in lead_times}
        classifier_cross_t = None

        for i in range(n_epochs):
            t = i * EPOCH_STRIDE_S
            if t < ramp_start_s:
                frac = 0.0
            elif t > ramp_end_s:
                frac = 1.0
            else:
                frac = (t - ramp_start_s) / (ramp_end_s - ramp_start_s)

            p_mean = p_base + frac * (p_target - p_base)
            p = float(np.clip(rng.normal(p_mean, 0.08), 0, 1))
            feat = rng.normal(0, 1, size=N_FEAT) + frac * 2.0

            r = _step(t, p, feat, trend_mon, feat_mon, shock)

            if classifier_cross_t is None and p >= classifier_thresh:
                classifier_cross_t = t
            for k in lead_times:
                if r[k] and first_fire[k] is None:
                    first_fire[k] = t

        if classifier_cross_t is not None:
            for k in lead_times:
                if first_fire[k] is not None:
                    lead_times[k].append(round(classifier_cross_t - first_fire[k], 2))

    out = {}
    for k, ls in lead_times.items():
        out[k] = {
            "n_detected_before_or_at_crossing": sum(1 for x in ls if x >= 0),
            "n_trials": n_trials,
            "mean_lead_time_s": round(float(np.mean(ls)), 2) if ls else None,
            "min_lead_time_s": round(float(np.min(ls)), 2) if ls else None,
        }
    return out


# ─────────────────────────────────────────────
#  4) Real DEAP data — coarse precision/recall vs. trial labels
# ─────────────────────────────────────────────

def run_real_data_precision_recall(n_subjects=15):
    from real_time_inference import FEATURES_NPZ, STUDENT_PKL, _StudentUnpickler
    sys.path.insert(0, str(_HERE / "models"))
    from student_model import StudentMLP  # noqa: F401

    d = np.load(FEATURES_NPZ, allow_pickle=True)
    F = d["F_student_ext"].astype(np.float32)
    sid = d["subject_id"].astype(np.int32)
    source = d["source"]
    y_emo = d["y_emo"].astype(np.int32)
    deap_mask = np.array([str(s).lower() == "deap" for s in source])
    subjs = np.unique(sid[deap_mask])[:n_subjects]

    with open(STUDENT_PKL, "rb") as f:
        student = _StudentUnpickler(f).load()

    tp = fp = fn = tn = 0
    per_subject = []
    for subject_id in subjs:
        mask = deap_mask & (sid == subject_id)
        Fs = F[mask]
        ye = y_emo[mask]
        p_emo_all = student.predict_proba(Fs)

        trend_mon, feat_mon, shock = _make_monitors()
        s_tp = s_fp = s_fn = s_tn = 0
        for i in range(len(Fs)):
            t = round(i * EPOCH_STRIDE_S, 2)
            r = _step(t, float(p_emo_all[i]), Fs[i], trend_mon, feat_mon, shock)
            if r["calibrating"]:
                continue
            pred = r["any_alarm"]
            label = bool(ye[i])
            if pred and label: s_tp += 1
            elif pred and not label: s_fp += 1
            elif not pred and label: s_fn += 1
            else: s_tn += 1
        tp += s_tp; fp += s_fp; fn += s_fn; tn += s_tn
        n = s_tp + s_fp + s_fn + s_tn
        per_subject.append({"subject": int(subject_id), "n_epochs": n,
                             "alarm_rate": round((s_tp + s_fp) / n, 4) if n else None,
                             "y_pos_rate": round(ye.mean(), 4)})

    precision = tp / (tp + fp) if (tp + fp) > 0 else None
    recall = tp / (tp + fn) if (tp + fn) > 0 else None
    fpr = fp / (fp + tn) if (fp + tn) > 0 else None

    return {
        "caveat": ("DEAP labels are one rating per ~60s trial, not onset-timed — "
                   "this is a coarse 'did any alarm fire during a labeled-stressed trial' "
                   "correlation check, NOT validated onset-timing accuracy."),
        "n_subjects": len(subjs), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(precision, 4) if precision is not None else None,
        "recall": round(recall, 4) if recall is not None else None,
        "false_positive_rate": round(fpr, 4) if fpr is not None else None,
        "per_subject": per_subject,
    }


def main():
    print("=" * 70)
    print("  EARLY-WARNING VALIDATION SUITE")
    print("  PersonalTrendMonitor + FeatureTrendMonitor + ShockDetector")
    print("=" * 70)

    print("\n[1/4] Calm false-alarm rate + MTBF (8 x 30min synthetic)...")
    calm = run_calm_false_alarm_test()
    for k, v in calm.items():
        if k == "total_synthetic_hours":
            continue
        print(f"  {k:22s} events={v['events']:3d}  /hr={v['false_alarms_per_hour']:.4f}  "
              f"MTBF={v['mtbf_minutes']}")

    print("\n[2/4] Abrupt step-change detection delay (5 synthetic trials)...")
    step = run_step_change_test()
    for k, v in step.items():
        print(f"  {k:22s} detected {v['n_detected']}/{v['n_trials']}  "
              f"mean_delay={v['mean_delay_s']}s  max={v['max_delay_s']}s")

    print("\n[3/4] Gradual ramp lead time (5 synthetic trials)...")
    ramp = run_ramp_lead_time_test()
    for k, v in ramp.items():
        print(f"  {k:22s} fired-before-crossing {v['n_detected_before_or_at_crossing']}/{v['n_trials']}  "
              f"mean_lead={v['mean_lead_time_s']}s  min={v['min_lead_time_s']}s")

    print("\n[4/4] Real DEAP data — coarse precision/recall (15 subjects)...")
    real = run_real_data_precision_recall()
    print(f"  precision={real['precision']}  recall={real['recall']}  "
          f"false_positive_rate={real['false_positive_rate']}")
    print(f"  ({real['caveat']})")

    report = {
        "calm_false_alarm_test": calm,
        "step_change_detection_delay": step,
        "ramp_lead_time": ramp,
        "real_data_precision_recall": real,
    }
    UNIFIED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved -> {REPORT_PATH}")


if __name__ == "__main__":
    main()
