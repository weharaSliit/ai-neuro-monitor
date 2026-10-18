"""SAM40 subjects whose EEG calibration passes reliably in simulation (SIMULATED).

Each SAM40 subject is run through the EEG calibration exactly as the bridge
runs it -- 2 min settle, rest blocks to /calibrate, 19 task blocks, 7 recovery
blocks (mqtt_bridge.py), direction-aware ABA rule (sam40/decision.py) -- with
the full headband layer (eeg.py, tuned to real wearable02 blocks; NOT
weakened), several virtual users per subject. A subject is 'responsive' when
the calibration ends 'ok' in at least MIN_PASS of its runs.

Why: most SAM40 subjects' real rest->task shift is 0.5-1 spread, below the
1-spread separation the calibration needs, and the realistic headband noise
lowers it further -- so a randomly drawn 'typical' user ends 'not_separated'
or 'drift_suspected' most of the time and the mind is shown as Limited. The
'responsive' demo profile (profiles.DEMO_PROFILES) draws only from these
subjects so a live demo shows a calibrated mind. The offline study's
profiles are unchanged.

  PYTHONPATH=../..:. ../../venv/bin/python -m simkit.responders [--runs 8]
Writes reference/responsive_subjects.json.
"""
import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

REF = Path(__file__).resolve().parents[1] / "reference"
OUT = REF / "responsive_subjects.json"
N_TASK, N_REC = 19, 7          # mqtt_bridge.py N_THRESHOLD_TASK_BLOCKS / N_RECOVERY_BLOCKS
MIN_PASS = 0.75               # share of runs that must end 'ok'
SEED0 = 900


def score_trials(subject):
    """Deployed-model rest score (log-odds) of each of the subject's Relax and task
    recordings, as the bridge scores rest blocks (no gain, clamped), at the
    headband's typical amplitude (11.4 uV RMS, real good-contact wearable02)."""
    from backend.psychological.realtime.pipeline import RealtimeInference
    from .eeg import _sam40
    from .evaluate import MODEL_DIR
    from .fidelity import to_samples
    global _ENGINE
    _ENGINE = globals().get("_ENGINE") or RealtimeInference(MODEL_DIR)
    d = _sam40()[subject]
    lg = lambda p: float(np.log(p / (1 - p))) if p and 0 < p < 1 else None  # noqa: E731
    sc = lambda x: lg(_ENGINE.preview_block_score(to_samples(x * 11.4 / (np.std(x) + 1e-12)), use_gain=False)["score"])  # noqa: E731
    return {"rest": [sc(x) for x in d["rest"]], "task": [sc(x) for x in d["task"]]}


def calibrate(subject, seed):
    """One virtual user with this SAM40 subject through the bridge's EEG calibration."""
    from backend.psychological.realtime.pipeline import RealtimeInference
    from . import session
    from .evaluate import MODEL_DIR, N_REST, SETTLE_S, Run, _samples
    orig = session.sample_user

    def forced(profile, s):
        up, taus = orig(profile, s)
        up.eeg["subject"] = subject
        return up, taus
    session.sample_user = forced
    try:
        R = Run("typical", seed)
    finally:
        session.sample_user = orig
    R.run_for(0.0, "settle", SETTLE_S)
    e = RealtimeInference(MODEL_DIR)
    for b in R.run_blocks(0.0, "rest", N_REST):
        e.calibrate_bipolar_block(_samples(b["uv"], b["millis"]))
    if e.finalize_calibration_bipolar(allow_degraded=True)["status"] not in ("ok", "degraded"):
        return subject, seed, None, "calibration_failed"
    for b in R.run_blocks(1.0, "task", N_TASK):
        e.score_threshold_task_block(_samples(b["uv"], b["millis"]))
    for b in R.run_blocks(0.0, "recovery", N_REC):
        e.score_recovery_block(_samples(b["uv"], b["millis"]))
    t = e.finalize_personal_threshold()
    return subject, seed, t.get("separation_sd"), t.get("calibration_status")


def _job(a):
    return calibrate(*a)


def _score(subject):
    return subject, score_trials(subject)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=16, help="virtual users per subject")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    from .profiles import sam40_strata
    subjects = sorted(sam40_strata()["all"])
    t0 = time.time()
    with ProcessPoolExecutor(args.workers) as ex:
        scored = dict(ex.map(_score, subjects))
        res = list(ex.map(_job, [(s, SEED0 + k) for s in subjects for k in range(args.runs)]))
    per = {}
    for s in subjects:
        r = [x for x in res if x[0] == s]
        seps = [x[2] for x in r if x[2] is not None]
        per[s] = {"ok": sum(x[3] == "ok" for x in r), "runs": len(r),
                  "median_separation_sd": float(np.median(seps)) if seps else None,
                  "statuses": {st: sum(x[3] == st for x in r) for st in {x[3] for x in r}}}
    responsive = sorted(s for s, v in per.items() if v["ok"] / v["runs"] >= MIN_PASS)
    OUT.write_text(json.dumps({
        "source": "simkit/responders.py (SIMULATED: SAM40 T7-T8 + headband layer, bridge EEG calibration, deployed model)",
        "rule": f"calibration_status 'ok' in >= {MIN_PASS:.0%} of {args.runs} runs (seeds {SEED0}..{SEED0 + args.runs - 1})",
        "responsive": responsive,
        # evidence: every SAM40 recording scored alone (no headband layer) -- all Relax recordings
        # score as rest, so a noisy calibration rest comes from the headband layer, not the data
        "trial_scores_logodds": {str(s): scored[s] for s in subjects},
        "overall_ok_share": float(np.mean([x[3] == "ok" for x in res])),
        "subjects": per,
    }, indent=1))
    print(f"responsive: {responsive}  (overall ok share {np.mean([x[3] == 'ok' for x in res]):.0%}, {time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
