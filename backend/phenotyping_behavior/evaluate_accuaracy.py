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
from datetime import datetime, timezone

# ── Path fix: allow running directly from phenotyping_behavior/ ──────────────
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.abspath(os.path.join(_CURRENT_DIR, ".."))
for _p in [_CURRENT_DIR, _BACKEND_ROOT]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from firebase_service import (
    init_firebase,
    list_all_user_ids,
    get_all_stress_predictions,
    get_validation_labels,
    get_physiological_predictions,
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


# ── Report printer ────────────────────────────────────────────────────────────

def _bar(value, width=20):
    """Simple ASCII progress bar for metric visualisation."""
    filled = int(round(value * width))
    return '[' + '#' * filled + '-' * (width - filled) + f']  {value * 100:.1f}%'

def print_report(user_id, ema_res, physio_res):
    line = '=' * 70
    print(f'\n{line}')
    print(f'  DIGITAL PHENOTYPING -- ACCURACY REPORT')
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

        # ── FIX 1: Minimum sample size gate ──────────────────────────────────
        if n < MIN_SAMPLES_PRELIMINARY:
            print(f"  [!!] RELIABILITY WARNING: Only {n} matched samples.")
            print(f"       Results are UNRELIABLE — minimum {MIN_SAMPLES_PRELIMINARY} needed to interpret.")
            print(f"       Do NOT report these numbers in research. Collect more surveys.")
        elif n < MIN_SAMPLES_VALID:
            print(f"  [!]  PRELIMINARY RESULTS: {n} samples (need {MIN_SAMPLES_VALID} for valid, {MIN_SAMPLES_PUBLISHABLE} to publish).")
            print(f"       Treat these numbers as early indicators only.")
        elif n < MIN_SAMPLES_PUBLISHABLE:
            print(f"  [~]  VALID but not yet publishable: {n}/{MIN_SAMPLES_PUBLISHABLE} samples collected.")
        else:
            print(f"  [OK] Sample size sufficient for publication ({n} >= {MIN_SAMPLES_PUBLISHABLE}).")

        # ── FIX 2: Class balance check ────────────────────────────────────────
        stressed_labels = cm['TP'] + cm['FN']   # all ground-truth "Stressed" cases
        normal_labels   = cm['TN'] + cm['FP']   # all ground-truth "Normal" cases
        if normal_labels == 0:
            print(f"  [!!] CLASS IMBALANCE: Zero 'Normal/Calm' surveys found!")
            print(f"       Accuracy is inflated — the model has never been tested on calm moments.")
            print(f"       -> Users MUST submit surveys also when they feel calm and relaxed.")
        elif stressed_labels == 0:
            print(f"  [!!] CLASS IMBALANCE: Zero 'Stressed' surveys found!")
            print(f"       Accuracy is inflated — the model has never been tested on stress moments.")
        else:
            ratio = round(stressed_labels / max(normal_labels, 1), 2)
            if ratio > 3.0 or ratio < 0.33:
                print(f"  [!]  IMBALANCED LABELS: {stressed_labels} Stressed vs {normal_labels} Normal (ratio={ratio}).")
                print(f"       Collect more of the minority class for balanced evaluation.")
            else:
                print(f"  [OK] Balanced labels: {stressed_labels} Stressed / {normal_labels} Normal.")

        print(f"  Accuracy    {_bar(ema_res['accuracy'])}")
        print(f"  Precision   {_bar(ema_res['precision'])}")
        print(f"  Recall      {_bar(ema_res['recall'])}")
        print(f"  F1-Score    {_bar(ema_res['f1_score'])}")
    else:
        print('  [!] No matched EMA survey labels found for this user yet.')
        print('      -> Ask the user to complete a SISS or PSS-4 check-in in the app.')

    # --- Method 2 ---
    print('\n  -- Method 2: Objective Physiological Triangulation (Wearable) --')
    if physio_res and physio_res['total'] > 0:
        cm = physio_res['confusion_matrix']
        n  = physio_res['total']

        # ── FIX 1 (Method 2): Minimum sample size gate ───────────────────────
        if n < MIN_SAMPLES_PRELIMINARY:
            print(f"  [!!] RELIABILITY WARNING: Only {n} matched physiological pairs.")
            print(f"       Results are UNRELIABLE — minimum {MIN_SAMPLES_PRELIMINARY} needed.")
        elif n < MIN_SAMPLES_VALID:
            print(f"  [!]  PRELIMINARY: {n} matched pairs (need {MIN_SAMPLES_VALID} for valid results).")
        else:
            print(f"  [OK] Physiological sample count sufficient ({n} pairs).")

        # ── FIX 2 (Method 2): Class balance check ────────────────────────────
        stressed_physio = cm['TP'] + cm['FN']
        normal_physio   = cm['TN'] + cm['FP']
        if normal_physio == 0:
            print(f"  [!!] CLASS IMBALANCE: Zero 'Normal' physiological readings matched.")
            print(f"       Pearson r and Accuracy are unreliable without calm baseline data.")

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
        print('      -> Physiological module must be running and synced.')

    print(f'\n{line}\n')
    return {"ema_validation": ema_res, "physiological_triangulation": physio_res}


# ── Main entry point ──────────────────────────────────────────────────────────

def run_evaluation(user_id):
    """Evaluate a single user and print the report."""
    ema_res    = evaluate_ema(user_id)
    physio_res = evaluate_physio(user_id)
    return print_report(user_id, ema_res, physio_res)


def run_all_users():
    """Auto-discover every registered user from Firebase and evaluate all."""
    user_ids = list_all_user_ids()
    if not user_ids:
        print('\n[WARN] No registered users found in Firebase under phenotyping/users/')
        print('       Make sure at least one user has completed app onboarding.\n')
        return

    print(f'\n[INFO] Found {len(user_ids)} registered user(s) in Firebase.')
    all_results = {}
    for uid in user_ids:
        ema    = evaluate_ema(uid)
        physio = evaluate_physio(uid)
        all_results[uid] = print_report(uid, ema, physio)

    return all_results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Digital Phenotyping Accuracy Evaluation Tool',
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
        # Default: evaluate the supplied user_id
        uid = args.user_id
        if not uid:
            parser.print_help()
            sys.exit(1)
        run_evaluation(uid)
