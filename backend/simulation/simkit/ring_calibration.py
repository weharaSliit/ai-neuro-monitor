"""Ring (HRV/GSR) calibration for the live stimulator, run on the laptop with
the ring backend's OWN functions -- the same technique the EEG side uses
(rest -> high-load task -> recovery, midpoint limit with the recovery check):

  rest windows      extract_features -> compute_baseline -> predict_window  (= save_calibration_windows)
  task + recovery   predict_window -> midpoint_stress_threshold             (= run_task_calibration_capture)

Why here and not on the ring API: the API's recalibration trigger is not
deployed yet and its routes need a token signed with the server's secret.
The result is written in exactly the records the ring API writes
(physiological/baselines/{uid}, physiological/personal_thresholds/{uid}), so
the DEPLOYED ring bridge then finds a baseline and predicts for this user, and
every psy_web page and the fusion engine use these calibrated values. Fresh
per session (no EMA blend with an older baseline). Marked calibrated_by.
"""
import math
from datetime import datetime, timezone

import numpy as np

from backend.common.config import GSR_CAL
from backend.physiological.extract_features import extract_features
from backend.physiological.predictor import (
    STRESS_DECISION_THRESHOLD, compute_baseline, feature_cols, midpoint_stress_threshold, predict_window,
)

WINDOW_PACKETS = 300            # 60 s at the ring's 5 packets/s


def _windows(packets):
    """Consecutive 60 s windows -> (features_2d | None, reason)."""
    out = []
    for i in range(0, len(packets) - WINDOW_PACKETS + 1, WINDOW_PACKETS):
        pk = packets[i:i + WINDOW_PACKETS]
        ibi = [b for d in pk for b in d["ibi"]]
        gsr = [d["gsr"] for d in pk]
        acc = [math.sqrt(d["acc_x"] ** 2 + d["acc_y"] ** 2 + d["acc_z"] ** 2) / 9.81 for d in pk]
        if len(ibi) < 10 or len(gsr) < 20 or len(acc) < 10:
            out.append((None, "insufficient data"))
            continue
        f2, motion, _fd, fallback, _wd = extract_features(ibi, gsr, acc, GSR_CAL, actual_fs=5)
        out.append((None, "movement") if motion else (None, "too few clean beats") if fallback else (f2, "ok"))
    return out


class RingCalibration:
    def __init__(self):
        self.packets = {"rest": [], "task": [], "recovery": []}
        self.baseline = None            # (mean, std)
        self.rest_scores = []
        self.result = None

    def add(self, phase, packet):
        if phase in self.packets and packet is not None:
            self.packets[phase].append(packet)

    def n_windows(self, phase):
        return len(self.packets[phase]) // WINDOW_PACKETS

    def finish_rest(self):
        """Baseline from the clean rest windows. Returns the records to write, or (None, reason)."""
        good = [f for f, why in _windows(self.packets["rest"]) if why == "ok"]
        if len(good) < 2:
            return None, f"only {len(good)} clean rest window(s) (need 2)"
        X = np.array([f[0] for f in good])
        b_mean, b_std = compute_baseline(X, n_windows=len(X))
        self.baseline = (b_mean, b_std)
        self.rest_scores = [float(predict_window(X[i:i + 1], b_mean, b_std)["prob_stress"]) for i in range(len(X))]
        now = datetime.now(timezone.utc).isoformat()
        base = {feat: {"mean": float(b_mean[i]), "std": float(b_std[i])} for i, feat in enumerate(feature_cols)}
        base.update({"updated_at": now, "session_count": 0, "calibrated_by": "live_stimulator"})
        thr = {"resting_scores": self.rest_scores, "resting_scores_updated_at": now, "calibrated_by": "live_stimulator"}
        return {"baseline": base, "thresholds": thr}, None

    def finish_task(self):
        """Midpoint limit from task + recovery against the resting scores (with the recovery check)."""
        if self.baseline is None:
            return None, "no ring baseline"
        b_mean, b_std = self.baseline
        score = lambda f: float(predict_window(f, b_mean, b_std)["prob_stress"])  # noqa: E731
        task = [score(f) for f, why in _windows(self.packets["task"]) if why == "ok"]
        rec = [score(f) for f, why in _windows(self.packets["recovery"]) if why == "ok"]
        if not task:
            return None, "no clean task window"
        mid = midpoint_stress_threshold(self.rest_scores, task, recovery_scores=rec) or {}
        limit = mid["limit"] if mid.get("separated") else None
        rec_mean = float(np.mean(rec)) if rec else None
        res = {"status": "ok" if limit is not None else mid.get("status", "not_separated"),
               "personal_stress_threshold": limit, "method": "midpoint (median rest, sustained task) + recovery check",
               "baseline": mid.get("baseline"), "task_level": mid.get("task_level"),
               "needed_separation": mid.get("needed_separation"), "aba_confirmed": mid.get("aba_confirmed"),
               "reversal": mid.get("reversal"), "n_task_windows": len(task),
               "recovery_scores": rec, "recovery_mean": rec_mean,
               "recovered": None if rec_mean is None else bool(rec_mean < (limit if limit is not None else STRESS_DECISION_THRESHOLD)),
               "calibrated_by": "live_stimulator"}
        self.result = res
        now = datetime.now(timezone.utc).isoformat()
        upd = {"task_scores": task, "task_result": res, "task_updated_at": now}
        if limit is not None:
            upd.update({"personal_stress_threshold": float(limit), "threshold_updated_at": now})
        else:                           # not separated: no personal limit -> the population limit applies
            upd.update({"personal_stress_threshold": None})
        return {"thresholds": upd, "task": task, "recovery": rec}, None
