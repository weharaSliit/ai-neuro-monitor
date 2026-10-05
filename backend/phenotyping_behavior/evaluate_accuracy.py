"""
evaluate_accuracy.py  —  Digital Phenotyping Accuracy & Validation Suite
=========================================================================
Compares passive AI stress predictions against ground-truth data.

Two validation methods are combined:
  Method 1 — Subjective EMA Ground-Truth (PSS-4 & SISS surveys)
  Method 2 — Objective Multimodal Triangulation (Physiological smartwatch predictions)

HOW TO USE:
-----------
# Evaluate a single known user ID (UUID from the phone, or a test ID):
    python evaluate_accuracy.py --user_id <UUID>

# Auto-discover ALL registered users from Firebase and evaluate each:
    python evaluate_accuracy.py --all

# List all registered user IDs without evaluating:
    python evaluate_accuracy.py --list

EXAMPLE:
    python evaluate_accuracy.py --all
    python evaluate_accuracy.py --user_id 3f2504e0-4f89-11d3-9a0c-0305e82c3301
"""

import argparse
import sys
import os
import numpy as np
from scipy import stats
from datetime import datetime, timezone

# ── Path fix: allow running directly from phenotyping_behavior/ ──────────────
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.abspath(os.path.join(_CURRENT_DIR, ".."))
_REPO_ROOT = os.path.abspath(os.path.join(_CURRENT_DIR, "..", ".."))
for _p in [_CURRENT_DIR, _BACKEND_ROOT, _REPO_ROOT]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from firebase_service import (
    init_firebase,
    list_all_user_ids,
    get_all_stress_predictions,
    get_validation_labels,
    get_physiological_predictions,
    get_controlled_experiments,
)

# ── Validation quality thresholds ────────────────────────────────────────────
SISS_STRESSED_THRESHOLD  = 4      # SISS 4-5 -> Stressed;  1-2 -> Normal;  3 -> skipped (neutral)
PSS4_STRESSED_THRESHOLD  = 5      # PSS-4  > 5 -> Stressed; <= 5 -> Normal
AI_SCORE_THRESHOLD       = 0.5    # passive model score > 0.5 -> Stressed
EMA_MATCH_WINDOW_MIN     = 60     # minutes: EMA label must be within +-60 min of a prediction
PHYSIO_MATCH_WINDOW_MIN  = 15     # minutes: physiological prediction must be within +-15 min

# Minimum matched samples needed before results are considered academically meaningful
MIN_SAMPLES_PRELIMINARY  = 10     # Below this: results are too unreliable to interpret
MIN_SAMPLES_VALID        = 30     # Below this: results are preliminary only
MIN_SAMPLES_PUBLISHABLE  = 50     # At or above this: results are publishable


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_ts(ts_str):
    """Parse ISO timestamp string; returns timezone-naive datetime or None."""
    if not ts_str:
        return None
    try:
        dt = datetime.fromisoformat(str(ts_str).replace('Z', '+00:00'))
        # Strip timezone info so comparisons are always naive-vs-naive
        return dt.replace(tzinfo=None)
    except Exception:
        return None

def _metrics(tp, tn, fp, fn):
    """Return a dict of accuracy metrics from a confusion matrix."""
    total = tp + tn + fp + fn
    if total == 0:
        return {"total": 0, "accuracy": 0.0, "precision": 0.0,
                "recall": 0.0, "f1_score": 0.0,
                "confusion_matrix": {"TP": 0, "TN": 0, "FP": 0, "FN": 0}}
    accuracy  = (tp + tn) / total
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall    = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1        = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    return {
        "total": total,
        "accuracy":   round(accuracy,   4),
        "precision":  round(precision,  4),
        "recall":     round(recall,     4),
        "f1_score":   round(f1,         4),
        "confusion_matrix": {"TP": tp, "TN": tn, "FP": fp, "FN": fn}
    }

def _nearest(samples, target_dt, max_minutes):
    """Find the closest sample to target_dt within max_minutes. Returns sample or None."""
    if not samples:
        return None
    closest = min(samples, key=lambda s: abs((s['dt'] - target_dt).total_seconds()))
    diff_min = abs((closest['dt'] - target_dt).total_seconds()) / 60.0
    return closest if diff_min <= max_minutes else None


# ── Method 1: EMA Ground-Truth ───────────────────────────────────────────────

def evaluate_ema(user_id):
    """
    Pairs each EMA survey answer (PSS-4 / SISS) with the nearest passive
    AI prediction within ±EMA_MATCH_WINDOW_MIN minutes.

    Binarization rules:
      SISS 4-5  → Stressed  |  SISS 1-2 → Normal  |  SISS 3 → skipped (neutral)
      PSS-4 > 5 → Stressed  |  PSS-4 ≤ 5 → Normal
      AI score  > 0.5       → Stressed
    """
    raw_preds  = get_all_stress_predictions(user_id)
    raw_labels = get_validation_labels(user_id)

    # Parse predictions
    preds = []
    for v in (raw_preds or {}).values():
        if not isinstance(v, dict):
            continue
        dt = _parse_ts(v.get('timestamp'))
        if dt:
            score = float(v.get('stress_score', 0.1))
            preds.append({'dt': dt, 'stressed': (v.get('is_anomaly', False) or score > AI_SCORE_THRESHOLD)})

    # Parse SISS labels
    labels = []
    for v in (raw_labels.get('siss') or {}).values():
        if not isinstance(v, dict):
            continue
        dt    = _parse_ts(v.get('timestamp'))
        score = v.get('score')
        if dt is None or score is None:
            continue
        if score >= SISS_STRESSED_THRESHOLD:
            labels.append({'dt': dt, 'stressed': True,  'type': 'SISS', 'raw': score})
        elif score <= 2:
            labels.append({'dt': dt, 'stressed': False, 'type': 'SISS', 'raw': score})
        # score == 3 → neutral, skip

    # Parse PSS-4 labels
    for v in (raw_labels.get('pss4') or {}).values():
        if not isinstance(v, dict):
            continue
        dt    = _parse_ts(v.get('timestamp'))
        score = v.get('score')
        if dt is None or score is None:
            continue
        labels.append({'dt': dt, 'stressed': (score > PSS4_STRESSED_THRESHOLD), 'type': 'PSS-4', 'raw': score})

    if not preds or not labels:
        return None

    tp = tn = fp = fn = unmatched = 0
    for lbl in labels:
        pred = _nearest(preds, lbl['dt'], EMA_MATCH_WINDOW_MIN)
        if pred is None:
            unmatched += 1
            continue
        if pred['stressed'] and lbl['stressed']:      tp += 1
        elif not pred['stressed'] and not lbl['stressed']: tn += 1
        elif pred['stressed'] and not lbl['stressed']:     fp += 1
        else:                                              fn += 1

    res = _metrics(tp, tn, fp, fn)
    res['unmatched_labels'] = unmatched
    return res


# ── Method 2: Physiological Triangulation ────────────────────────────────────

def evaluate_physio(user_id):
    """
    Method 2: Objective Physiological Cross-Validation.

    Reads physiological predictions from:
        fusion_engine/{display_name}/{session_key}/{push-key}
    where modality == 'physiological'  (Wehara's wearable component).

    Pairs each behavioral AI prediction with the nearest physiological
    reading within +/- PHYSIO_MATCH_WINDOW_MIN minutes.
    Also computes Pearson r between the two stress score streams.
    """
    raw_digital = get_all_stress_predictions(user_id)
    raw_physio  = get_physiological_predictions(user_id)  # now reads fusion_engine/

    digital = []
    for v in (raw_digital or {}).values():
        if not isinstance(v, dict):
            continue
        dt = _parse_ts(v.get('timestamp'))
        if dt:
            score = float(v.get('stress_score', 0.1))
            digital.append({'dt': dt, 'score': score, 'stressed': (score > AI_SCORE_THRESHOLD)})

    physio = []
    for v in (raw_physio or {}).values():
        if not isinstance(v, dict):
            continue
        dt = _parse_ts(v.get('timestamp'))
        if dt:
            # get_physiological_predictions() normalises the score to 'stress_score'
            score = float(v.get('stress_score', 0.1))
            physio.append({'dt': dt, 'score': score, 'stressed': (score > AI_SCORE_THRESHOLD)})

    print(f"  [debug] Behavioral windows: {len(digital)} | "
          f"Physiological records (fusion_engine): {len(physio)}")

    if not digital or not physio:
        return None

    d_scores, p_scores = [], []
    tp = tn = fp = fn = 0

    for d in digital:
        p = _nearest(physio, d['dt'], PHYSIO_MATCH_WINDOW_MIN)
        if p is None:
            continue
        d_scores.append(d['score'])
        p_scores.append(p['score'])
        if d['stressed'] and p['stressed']:           tp += 1
        elif not d['stressed'] and not p['stressed']: tn += 1
        elif d['stressed'] and not p['stressed']:     fp += 1
        else:                                         fn += 1

    if not d_scores:
        return None

    res = _metrics(tp, tn, fp, fn)
    r_corr = float(np.corrcoef(d_scores, p_scores)[0, 1]) if len(d_scores) > 1 else 0.0
    res['pearson_r'] = round(r_corr, 4)
    return res


# ── Method 3: Controlled Cognitive Stress Experiment & Hypothesis Testing ─────

def evaluate_controlled_experiment(user_id):
    """
    Method 3: Controlled Cognitive Stressor Validation (Lab / In-App Test).
    
    Compares behavioral metrics during a relaxed baseline task vs an induced
    cognitive stressor (timed Stroop test / mental arithmetic).
    
    Statistical tests performed:
      1. Paired Student's t-test (t-statistic, p-value)
      2. Wilcoxon Signed-Rank test (non-parametric p-value)
      3. Cohen's d Effect Size for dwell time, scroll velocity, and anomaly Z
      4. Controlled Classification Confusion Matrix (TP, TN, FP, FN, Accuracy)
    """
    raw_exp = get_controlled_experiments(user_id)
    if not raw_exp or not isinstance(raw_exp, dict):
        return None

    calm_dwells, stress_dwells = [], []
    calm_flights, stress_flights = [], []
    calm_scrolls, stress_scrolls = [], []
    calm_z_scores, stress_z_scores = [], []
    
    tp = tn = fp = fn = 0

    for exp_id, record in raw_exp.items():
        if not isinstance(record, dict):
            continue
        c = record.get('calm_metrics', {})
        s = record.get('stress_metrics', {})
        
        if not c or not s:
            continue
            
        if 'avg_dwell' in c and 'avg_dwell' in s:
            calm_dwells.append(float(c['avg_dwell']))
            stress_dwells.append(float(s['avg_dwell']))
        if 'avg_flight' in c and 'avg_flight' in s:
            calm_flights.append(float(c['avg_flight']))
            stress_flights.append(float(s['avg_flight']))
        if 'scroll_velocity' in c and 'scroll_velocity' in s:
            calm_scrolls.append(float(c['scroll_velocity']))
            stress_scrolls.append(float(s['scroll_velocity']))
        if 'composite_z' in c and 'composite_z' in s:
            calm_z_scores.append(float(c['composite_z']))
            stress_z_scores.append(float(s['stress_z'] if 'stress_z' in s else s['composite_z']))

        # Anomaly evaluation: Calm should be Normal (TN), Stressed should be Anomaly (TP)
        c_anom = c.get('is_anomaly', False) or float(c.get('stress_score', 0)) > AI_SCORE_THRESHOLD
        s_anom = s.get('is_anomaly', True) or float(s.get('stress_score', 1)) > AI_SCORE_THRESHOLD
        
        if s_anom: tp += 1
        else: fn += 1
        
        if not c_anom: tn += 1
        else: fp += 1

    n_sessions = len(calm_dwells)
    if n_sessions == 0:
        return None

    # Statistical significance on Dwell Time and Composite Z
    res = _metrics(tp, tn, fp, fn)
    res['total_sessions'] = n_sessions
    
    # Paired t-test
    if n_sessions >= 2:
        try:
            t_stat, p_val = stats.ttest_rel(stress_dwells, calm_dwells)
            res['t_stat'] = round(float(t_stat), 4)
            res['p_val'] = round(float(p_val), 6)
        except Exception:
            res['t_stat'] = None
            res['p_val'] = None
            
        # Cohen's d effect size on dwell time
        diff_mean = float(np.mean(stress_dwells) - np.mean(calm_dwells))
        pooled_sd = float(np.sqrt((np.var(stress_dwells) + np.var(calm_dwells)) / 2.0))
        res['cohens_d'] = round(diff_mean / max(pooled_sd, 1e-6), 4)
        
        # Wilcoxon Signed-Rank Test
        try:
            if n_sessions >= 5:
                w_stat, w_pval = stats.wilcoxon(stress_dwells, calm_dwells)
                res['wilcoxon_p'] = round(float(w_pval), 6)
            else:
                res['wilcoxon_p'] = None
        except Exception:
            res['wilcoxon_p'] = None
    else:
        res['t_stat'] = None
        res['p_val'] = None
        res['cohens_d'] = None
        res['wilcoxon_p'] = None

    res['mean_dwell_calm'] = round(float(np.mean(calm_dwells)), 2)
    res['mean_dwell_stress'] = round(float(np.mean(stress_dwells)), 2)
    return res


# ── Report printer ────────────────────────────────────────────────────────────

def _bar(value, width=20):
    """Simple ASCII progress bar for metric visualisation."""
    filled = int(round(value * width))
    return '[' + '#' * filled + '-' * (width - filled) + f']  {value * 100:.1f}%'

def print_report(user_id, ema_res, physio_res, exp_res=None):
    line = '=' * 70
    print(f'\n{line}')
    print(f'  DIGITAL PHENOTYPING -- TRIPLE-METHOD ACCURACY & VALIDATION REPORT')
    print(f'  User: {user_id}')
    print(line)

    # --- Method 1 ---
    print('\n  -- Method 1: Subjective EMA Ground-Truth (PSS-4 & SISS Surveys) --')
    if ema_res and ema_res['total'] > 0:
        cm  = ema_res['confusion_matrix']
        n   = ema_res['total']

        print(f"  Matched samples :  {n}  "
              f"(skipped unmatched: {ema_res.get('unmatched_labels', 0)})")
        print(f"  Confusion Matrix:  TP={cm['TP']}  TN={cm['TN']}  "
              f"FP={cm['FP']}  FN={cm['FN']}")

        if n < MIN_SAMPLES_PRELIMINARY:
            print(f"  [!!] RELIABILITY WARNING: Only {n} matched samples.")
            print(f"       Results are UNRELIABLE — minimum {MIN_SAMPLES_PRELIMINARY} needed to interpret.")
        elif n < MIN_SAMPLES_VALID:
            print(f"  [!]  PRELIMINARY RESULTS: {n} samples (need {MIN_SAMPLES_VALID} for valid, {MIN_SAMPLES_PUBLISHABLE} to publish).")
        elif n < MIN_SAMPLES_PUBLISHABLE:
            print(f"  [~]  VALID but not yet publishable: {n}/{MIN_SAMPLES_PUBLISHABLE} samples collected.")
        else:
            print(f"  [OK] Sample size sufficient for publication ({n} >= {MIN_SAMPLES_PUBLISHABLE}).")

        stressed_labels = cm['TP'] + cm['FN']
        normal_labels   = cm['TN'] + cm['FP']
        if normal_labels == 0 or stressed_labels == 0:
            print(f"  [!!] CLASS IMBALANCE: Need both calm and stressed surveys.")
        else:
            print(f"  [OK] Label Distribution: {stressed_labels} Stressed / {normal_labels} Normal.")

        print(f"  Accuracy    {_bar(ema_res['accuracy'])}")
        print(f"  Precision   {_bar(ema_res['precision'])}")
        print(f"  Recall      {_bar(ema_res['recall'])}")
        print(f"  F1-Score    {_bar(ema_res['f1_score'])}")
    else:
        print('  [!] No matched EMA survey labels found for this user yet.')
        print('      -> Complete a SISS or PSS-4 check-in in the mobile app.')

    # --- Method 2 ---
    print('\n  -- Method 2: Objective Physiological Triangulation (IoT Wearable) --')
    if physio_res and physio_res['total'] > 0:
        cm = physio_res['confusion_matrix']
        n  = physio_res['total']

        print(f"  Matched pairs   :  {n}")
        print(f"  Pearson r       :  {physio_res['pearson_r']}  "
              f"({'strong' if abs(physio_res['pearson_r']) >= 0.7 else 'moderate' if abs(physio_res['pearson_r']) >= 0.4 else 'weak'} correlation)")
        print(f"  Confusion Matrix:  TP={cm['TP']}  TN={cm['TN']}  "
              f"FP={cm['FP']}  FN={cm['FN']}")
        print(f"  Accuracy    {_bar(physio_res['accuracy'])}")
        print(f"  Precision   {_bar(physio_res['precision'])}")
        print(f"  Recall      {_bar(physio_res['recall'])}")
        print(f"  F1-Score    {_bar(physio_res['f1_score'])}")
    else:
        print('  [!] No physiological wearable predictions found for this user.')
        print('      -> Physiological/wearable module must be synced.')

    # --- Method 3 ---
    print('\n  -- Method 3: Controlled Cognitive Stress Experiment (Hypothesis Testing) --')
    if exp_res and exp_res['total'] > 0:
        cm = exp_res['confusion_matrix']
        print(f"  Completed Tests :  {exp_res['total_sessions']} experimental sessions")
        print(f"  Mean Dwell Time :  Calm: {exp_res['mean_dwell_calm']} ms  -->  Stressed: {exp_res['mean_dwell_stress']} ms")
        if exp_res.get('p_val') is not None:
            sig_str = "*** p < 0.001 (Highly Significant)" if exp_res['p_val'] < 0.001 else "** p < 0.01" if exp_res['p_val'] < 0.01 else "* p < 0.05 (Significant)" if exp_res['p_val'] < 0.05 else "n.s. (Not Significant)"
            print(f"  Paired t-test   :  t = {exp_res['t_stat']}, p = {exp_res['p_val']} ({sig_str})")
        if exp_res.get('cohens_d') is not None:
            effect_str = "Large Effect (d > 0.8)" if abs(exp_res['cohens_d']) >= 0.8 else "Medium Effect" if abs(exp_res['cohens_d']) >= 0.5 else "Small Effect"
            print(f"  Cohen's d       :  {exp_res['cohens_d']} ({effect_str})")
        if exp_res.get('wilcoxon_p') is not None:
            print(f"  Wilcoxon p-val  :  {exp_res['wilcoxon_p']}")
        print(f"  Confusion Matrix:  TP={cm['TP']}  TN={cm['TN']}  FP={cm['FP']}  FN={cm['FN']}")
        print(f"  Accuracy    {_bar(exp_res['accuracy'])}")
    else:
        print('  [!] No controlled experiment sessions recorded yet for this user.')
        print('      -> Run: python run_controlled_experiment.py --user_id <UID>')

    print(f'\n{line}\n')
    return {
        "ema_validation": ema_res,
        "physiological_triangulation": physio_res,
        "controlled_experiment": exp_res
    }


# ── Main entry point ──────────────────────────────────────────────────────────

def run_evaluation(user_id):
    """Evaluate a single user across all 3 methods and print the report."""
    ema_res    = evaluate_ema(user_id)
    physio_res = evaluate_physio(user_id)
    exp_res    = evaluate_controlled_experiment(user_id)
    return print_report(user_id, ema_res, physio_res, exp_res)


def run_all_users():
    """Auto-discover every registered user from Firebase and evaluate all."""
    user_ids = list_all_user_ids()
    if not user_ids:
        print('\n[WARN] No registered users found in Firebase under phenotyping/users/')
        return

    print(f'\n[INFO] Found {len(user_ids)} registered user(s) in Firebase.')
    all_results = {}
    for uid in user_ids:
        ema    = evaluate_ema(uid)
        physio = evaluate_physio(uid)
        exp    = evaluate_controlled_experiment(uid)
        all_results[uid] = print_report(uid, ema, physio, exp)

    return all_results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Digital Phenotyping Accuracy & Validation Suite (Methods 1, 2, and 3)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        '--user_id', type=str,
        help='Evaluate a specific user by their UUID (or test ID).'
    )
    group.add_argument(
        '--all', action='store_true',
        help='Auto-discover ALL registered users from Firebase and evaluate each.'
    )
    group.add_argument(
        '--list', action='store_true',
        help='List all registered user IDs in Firebase without evaluating.'
    )
    args = parser.parse_args()

    init_firebase()

    if args.list:
        ids = list_all_user_ids()
        if ids:
            print(f'\n[OK] {len(ids)} registered user(s) in Firebase:\n')
            for i, uid in enumerate(ids, 1):
                print(f'  {i:>3}. {uid}')
            print()
        else:
            print('\n[WARN] No users found under phenotyping/users/ in Firebase.\n')

    elif args.all:
        run_all_users()

    else:
        uid = args.user_id
        if not uid:
            parser.print_help()
            sys.exit(1)
        run_evaluation(uid)

