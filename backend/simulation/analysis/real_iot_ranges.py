"""
Real IoT reading ranges, from every real session in Firebase (read-only;
simulated sim_* users are left out). The simulator's signals are tuned to
these, and the fidelity check compares against them.

  EEG (wearable02, psychological/{uid}/{sid}/{block})
    per block: RMS and peak-to-peak (uV, unclamped), out-of-range fraction,
    quality-gate skips, bipolar band features, model score; per calibration:
    rest-block spread in log-odds.
  Ring (wearable01, physiological/predictions/{uid}/{sid}/{push})
    per 60 s window: heart rate, beat intervals -> RMSSD, HRV features,
    skin conductance level, skin responses, movement, stress probability.

  venv/bin/python backend/simulation/analysis/real_iot_ranges.py
Writes backend/simulation/reference/real_iot_ranges.json (+ a cache of the raw pulls).
"""
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))
from backend.common.firebase_config import FIREBASE_DB_URL  # noqa: E402

DB = FIREBASE_DB_URL.rstrip("/")
OUT = REPO / "backend" / "simulation" / "reference"
CACHE = OUT / "cache"
FLAT_RMS_UV, GOOD_RMS_UV = 1.0, 3.0
SKIP_USERS = {"current_session_id", "current_user_id"}
EEG_FEATS = ["delta_rel_power", "theta_rel_power", "alpha_rel_power", "beta_rel_power", "gamma_rel_power",
             "theta_alpha_ratio", "spectral_slope", "spectral_entropy", "sample_entropy", "hjorth_mobility",
             "hjorth_complexity", "std", "ptp"]
RING_FEATS = ["MeanHR", "AVNN", "SDHR", "SD1", "pNN20", "SCL_mean", "SCL_slope", "SCR_count", "SCR_amp_mean",
              "EDA_std", "EDA_range", "ACC_mean", "ACC_std"]


def get(path, shallow=False):
    cache = CACHE / (path.replace("/", "__") + (".shallow" if shallow else "") + ".json")
    if cache.exists():
        return json.loads(cache.read_text())
    r = requests.get(f"{DB}/{path}.json", params={"shallow": "true"} if shallow else None, timeout=120)
    r.raise_for_status()
    v = r.json()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(v))
    return v


def real_users(root):
    return [u for u in (get(root, shallow=True) or {}) if u not in SKIP_USERS and not u.startswith("sim_")]


def stats(xs):
    a = np.array([x for x in xs if x is not None and np.isfinite(x)], dtype=float)
    if not len(a):
        return None
    q = np.percentile(a, [5, 25, 50, 75, 95])
    return {"n": int(len(a)), "mean": float(a.mean()), "sd": float(a.std(ddof=1)) if len(a) > 1 else 0.0,
            "p5": float(q[0]), "p25": float(q[1]), "median": float(q[2]), "p75": float(q[3]), "p95": float(q[4])}


def logit(p):
    p = min(max(p, 1e-300), 1 - 1e-16)
    return math.log(p) - math.log1p(-p)


def eeg_ranges():
    blocks, spreads, sess_count = [], [], 0
    jobs = []
    for u in real_users("psychological"):
        for s in (get(f"psychological/{u}", shallow=True) or {}):
            if s.startswith("session_") or s.startswith("wearable02_"):
                jobs.append((u, s))

    def pull(us):
        u, s = us
        try:
            return us, get(f"psychological/{u}/{s}")
        except Exception:
            return us, None

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(pull, jobs))
    for (u, s), d in results:
        if not isinstance(d, dict):
            continue
        n_here = 0
        for k, v in d.items():
            if not k.isdigit() or not isinstance(v, dict):
                continue
            n_here += 1
            f = ((v.get("features_eeg") or {}).get("bipolar") or {})
            blocks.append({"user": u, "sid": s, "skipped": bool(v.get("skipped")), "std": v.get("eeg_std_uv_unclamped"),
                           "ptp": v.get("eeg_ptp_uv_unclamped"), "oor": v.get("eeg_out_of_range_fraction"),
                           "score": v.get("task_state_score"), **{f"f_{x}": f.get(x) for x in EEG_FEATS}})
        sess_count += n_here > 0
        cal = d.get("calibration_result") or {}
        rest = [logit(x) for x in (cal.get("rest_scores") or []) if x and 0 < x < 1 and abs(logit(x)) <= 40]
        if len(rest) >= 5:
            spreads.append(float(np.std(rest, ddof=1)))
    ok = [b for b in blocks if not b["skipped"]]
    # Current ADC scale only (gain fix, Oct 2026), and good electrode contact:
    # a large share of trusted blocks are near-flat (RMS ~0.2 uV) -- a contact
    # fault the quality gate passes. The simulator is tuned to GOOD recordings.
    cur = [b for b in ok if b["sid"] >= "session_20261001"]
    flat = [b for b in cur if b["std"] is not None and b["std"] < FLAT_RMS_UV]
    good = [b for b in cur if b["std"] is not None and b["std"] >= GOOD_RMS_UV]
    sc = [logit(b["score"]) for b in good if b["score"] and 0 < b["score"] < 1]
    # rest spread also from recalibration live blocks of real users
    for sid, r in (get("eeg_recalibration") or {}).items():
        if not isinstance(r, dict) or r.get("source") == "stimulator" or str(r.get("user_id", "")).startswith("sim_"):
            continue
        live = r.get("live") or []
        live = live if isinstance(live, list) else list(live.values())
        rest = [logit(b["score"]) for b in live if isinstance(b, dict) and b.get("phase") == "rest"
                and b.get("score") and 0 < b["score"] < 1 and abs(logit(b["score"])) <= 40]
        if len(rest) >= 5:
            spreads.append(float(np.std(rest, ddof=1)))
    return {
        "n_sessions": sess_count, "n_blocks": len(blocks), "n_users": len({b["user"] for b in blocks}),
        "skip_rate": (sum(b["skipped"] for b in blocks) / len(blocks)) if blocks else None,
        "rms_uv": stats([b["std"] for b in blocks]), "ptp_uv": stats([b["ptp"] for b in blocks]),
        "out_of_range_fraction": stats([b["oor"] for b in blocks]),
        "rms_uv_trusted": stats([b["std"] for b in ok]),
        "flat_share_of_trusted_current": (len(flat) / len(cur)) if cur else None,
        "flat_sessions": sorted({f"{b['user']}/{b['sid']}" for b in flat}),
        "good_contact": {"n_blocks": len(good), "sessions": sorted({f"{b['user']}/{b['sid']}" for b in good}),
                         "rms_uv": stats([b["std"] for b in good]), "ptp_uv": stats([b["ptp"] for b in good]),
                         "score_logodds": stats(sc),
                         "features": {x: stats([b[f"f_{x}"] for b in good]) for x in EEG_FEATS}},
        "rest_spread_logodds": stats(spreads),
    }


def ring_ranges():
    wins = []
    jobs = [(u, s) for u in real_users("physiological/predictions")
            for s in (get(f"physiological/predictions/{u}", shallow=True) or {})]

    def pull(us):
        u, s = us
        try:
            return us, get(f"physiological/predictions/{u}/{s}")
        except Exception:
            return us, None

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(pull, jobs))
    for (u, s), d in results:
        if not isinstance(d, dict):
            continue
        for v in d.values():
            if not isinstance(v, dict) or not isinstance(v.get("features"), dict):
                continue
            ibi = np.array([x for x in (v.get("ibi_sequence") or []) if isinstance(x, (int, float)) and 300 <= x <= 2000])
            rmssd = float(np.sqrt(np.mean(np.diff(ibi) ** 2))) if len(ibi) > 3 else None
            wins.append({"user": u, "p": v.get("prob_stress"), "rmssd": rmssd, **{x: v["features"].get(x) for x in RING_FEATS}})
    per_user_hr = [np.median([w["MeanHR"] for w in wins if w["user"] == u and w["MeanHR"]]) for u in {w["user"] for w in wins}]
    per_user_scl = [np.median([w["SCL_mean"] for w in wins if w["user"] == u and w["SCL_mean"] is not None])
                    for u in {w["user"] for w in wins}]
    return {
        "n_windows": len(wins), "n_users": len({w["user"] for w in wins}),
        "prob_stress": stats([w["p"] for w in wins]),
        "prob_stress_share_below_0.1": (sum(1 for w in wins if w["p"] is not None and w["p"] < 0.1) / len(wins)) if wins else None,
        "prob_stress_share_above_0.9": (sum(1 for w in wins if w["p"] is not None and w["p"] > 0.9) / len(wins)) if wins else None,
        "rmssd_ms": stats([w["rmssd"] for w in wins]),
        "per_user_median_hr": stats(per_user_hr), "per_user_median_scl": stats(per_user_scl),
        "features": {x: stats([w[x] for w in wins]) for x in RING_FEATS},
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    res = {"source": "Firebase, all real users (sim_* excluded), read-only", "eeg": eeg_ranges(), "ring": ring_ranges()}
    (OUT / "real_iot_ranges.json").write_text(json.dumps(res, indent=2))
    e, r = res["eeg"], res["ring"]
    f = lambda s, k="median": "—" if not s else f"{s[k]:.3g}"  # noqa: E731
    rng = lambda s: "—" if not s else f"{s['p5']:.3g} – {s['p95']:.3g} (median {s['median']:.3g})"  # noqa: E731
    print(f"EEG: {e['n_users']} users, {e['n_sessions']} sessions, {e['n_blocks']} blocks, quality-gate skips {100 * (e['skip_rate'] or 0):.0f}%")
    print(f"  RMS uV            {rng(e['rms_uv'])}")
    g = e["good_contact"]
    print(f"  near-flat (<{FLAT_RMS_UV} uV) share of trusted blocks since Oct: {100 * (e['flat_share_of_trusted_current'] or 0):.0f}% "
          f"in {len(e['flat_sessions'])} sessions")
    print(f"  GOOD contact ({g['n_blocks']} blocks, {len(g['sessions'])} sessions):")
    print(f"    RMS uV          {rng(g['rms_uv'])}")
    print(f"    ptp uV          {rng(g['ptp_uv'])}")
    print(f"    score log-odds  {rng(g['score_logodds'])}")
    for x in ("theta_rel_power", "alpha_rel_power", "beta_rel_power", "delta_rel_power", "gamma_rel_power", "spectral_slope", "sample_entropy"):
        print(f"    {x:15s} {rng(g['features'][x])}")
    print(f"  rest spread (log-odds) {rng(e['rest_spread_logodds'])}  (n {e['rest_spread_logodds']['n'] if e['rest_spread_logodds'] else 0})")
    print(f"Ring: {r['n_users']} users, {r['n_windows']} windows")
    print(f"  prob_stress       {rng(r['prob_stress'])}; <0.1: {100 * r['prob_stress_share_below_0.1']:.0f}%  >0.9: {100 * r['prob_stress_share_above_0.9']:.0f}%")
    print(f"  RMSSD ms          {rng(r['rmssd_ms'])}")
    print(f"  user median HR    {rng(r['per_user_median_hr'])}")
    print(f"  user median SCL   {rng(r['per_user_median_scl'])}")
    for x in ("MeanHR", "SD1", "SCL_mean", "SCR_count", "SCR_amp_mean", "EDA_std", "ACC_std"):
        print(f"  {x:17s} {rng(r['features'][x])}")


if __name__ == "__main__":
    main()
