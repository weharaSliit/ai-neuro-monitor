"""
End-to-end check of the adaptive intervention flow (no real Firebase, no hardware).

Covers: context-aware recommendation -> measured-trajectory validation -> learning update ->
mid-session continue/switch/stop decision.

Run from the repo root:
    python -m backend.relaxation_guide.test_adaptive_system
"""

import sys
import time
from pathlib import Path

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.services import firebase_service
from backend.relaxation_guide.services.telemetry_aggregator import telemetry_aggregator

STATE = {"physio": 0.75, "pheno": 0.55}


def _install_fakes():
    store = {}
    firebase_service.get_baseline = lambda user_id, session_id=None: 0.30
    firebase_service.get_latest_phenotyping_prediction = lambda user_id: {
        "label": "stress", "stress_score": STATE["pheno"], "has_live_packet": True, "active_session_id": "s1"}
    telemetry_aggregator.read_fusion_engine_output = lambda user_id, session_id=None: {
        "fused_stress_label": "stress", "stress_probability": STATE["physio"],
        "has_live_packet": True, "user_baseline": 0.30, "is_calibrated": True}
    firebase_service.get_bandit_distributions = lambda user_id: {}
    firebase_service.save_bandit_distribution = lambda *a, **k: None
    firebase_service.get_fastest_recovery_technique_history = lambda user_id: {}
    firebase_service.save_relaxation_intervention = lambda *a, **k: None
    firebase_service.get_relaxation_interventions = lambda user_id: []
    firebase_service.get_ratings = lambda user_id: []
    firebase_service.save_rating = lambda *a, **k: None
    firebase_service.get_policy_state = lambda user_id: store.get(user_id)
    firebase_service.save_policy_state = lambda user_id, state: store.__setitem__(user_id, state)
    firebase_service.get_closed_loop_state = lambda user_id: None
    firebase_service.save_closed_loop_state = lambda *a, **k: None


def main():
    _install_fakes()
    from backend.relaxation_guide.app import app
    from backend.relaxation_guide.services.context_builder import context_builder
    from backend.relaxation_guide.services.thompson_bandit import thompson_bandit

    client = app.test_client()
    user = "adaptive_test_user"
    failures = []

    def check(name, cond, detail=""):
        print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))
        if not cond:
            failures.append(name)

    # 0. The routes the app polls every 2 s must feed the context and keep working.
    poll_user = "poll_user"
    for _ in range(5):
        r0 = client.get(f"/telemetry/fusion-output?user_id={poll_user}")
    check("fusion-output (2 s poll) works and returns context", r0.status_code == 200 and "context" in r0.get_json(), r0.status_code)
    check("polling builds up the user's context", context_builder.snapshot(poll_user)["ready"])
    rp = client.get(f"/telemetry/pipeline?user_id={poll_user}")
    check("pipeline route works and returns context", rp.status_code == 200 and "context" in rp.get_json(), rp.status_code)

    # 1. Build some history so the context has a slope (stress rising, then high).
    now = time.time()
    for i in range(30):
        context_builder.update(user, 0.35 + 0.013 * i, 0.30 + 0.008 * i, baseline=0.30, timestamp=now - 60 + 2 * i)

    r = client.post("/intervention", json={"user_id": user, "telemetry": {"timestamp": now}})
    rec = r.get_json()
    check("intervention returns a technique", r.status_code == 200 and bool(rec.get("technique_id")), rec.get("technique_id"))
    check("intervention explains its choice", bool(rec.get("reason")), rec.get("reason"))
    check("context is person-relative (z above baseline)", rec["context"]["z_rel"] > 1.0, rec["context"]["z_rel"])
    check("session id returned for learning", bool(rec.get("session_id")))

    # 2. Validation with a measured, falling stress trajectory (faster than natural recovery).
    tech = rec["technique_id"]
    t0 = now
    trajectory = [{"t": t0 + 10 * i, "p": 0.30 + (0.72 - 0.30) * float(np.exp(-10 * i / 150.0))} for i in range(61)]
    n_before = thompson_bandit.get_policy(user).linear[tech].n
    r = client.post("/validate", json={
        "user_id": user, "technique_id": tech, "pre_stress_label": "stress", "post_stress_label": "normal",
        "star_rating": 4, "duration_seconds": 600, "session_id": rec["session_id"],
        "context_cluster_id": rec["context_cluster_id"], "stress_trajectory": trajectory})
    val = r.get_json()
    check("validation used the measured trajectory", val.get("measured") is True)
    check("recovery percentage is measured (not a lookup)", val["recovery_percentage"] > 90, val["recovery_percentage"])
    check("reward beats natural recovery", val["reward_components"]["uplift_raw"] > 0.2, val["reward_components"]["uplift_raw"])
    check("policy learned from the session", thompson_bandit.get_policy(user).linear[tech].n == n_before + 1)

    # 3. A session where stress does not move: reward should be clearly lower.
    r2 = client.post("/intervention", json={"user_id": user, "telemetry": {"timestamp": now}})
    rec2 = r2.get_json()
    flat = [{"t": t0 + 10 * i, "p": 0.72} for i in range(61)]
    r2v = client.post("/validate", json={
        "user_id": user, "technique_id": rec2["technique_id"], "pre_stress_label": "stress",
        "post_stress_label": "stress", "star_rating": 2, "duration_seconds": 600,
        "session_id": rec2["session_id"], "context_cluster_id": rec2["context_cluster_id"], "stress_trajectory": flat})
    flat_val = r2v.get_json()
    check("no improvement gives a lower reward", flat_val["reward"] < val["reward"], f'{flat_val["reward"]:.2f} < {val["reward"]:.2f}')
    check("unrecovered session proposes another technique", flat_val.get("alternative_recommendation") is not None)

    # 3b. A game (sub-option) id reported by the web or the app must teach its technique family, not crash.
    r3 = client.post("/intervention", json={"user_id": user, "telemetry": {"timestamp": now}})
    rec3 = r3.get_json()
    n_gm = thompson_bandit.get_policy(user).linear["guided_meditation"].n
    r3v = client.post("/validate", json={
        "user_id": user, "technique_id": "water_lily_pond", "pre_stress_label": "stress", "post_stress_label": "normal",
        "star_rating": 4, "duration_seconds": 300, "session_id": rec3["session_id"],
        "context_cluster_id": rec3["context_cluster_id"], "stress_trajectory": trajectory})
    check("validate accepts a game id (web/app)", r3v.status_code == 200, r3v.status_code)

    # 4. Mid-session decisions.
    flat_user = "flat_user"
    now2 = time.time()
    for i in range(40):
        context_builder.update(flat_user, 0.70, 0.60, baseline=0.30, timestamp=now2 - 80 + 2 * i)
    early = client.post("/loop/step", json={"user_id": flat_user, "technique_id": "guided_meditation", "elapsed_seconds": 30}).get_json()
    late = client.post("/loop/step", json={"user_id": flat_user, "technique_id": "guided_meditation", "elapsed_seconds": 300}).get_json()
    check("too early to judge -> continue", early["action"] == "continue", early["action"])
    check("flat stress after evaluation time -> switch", late["action"] == "switch", late["action"])
    check("switch proposes a different technique",
          late.get("next_recommendation", {}).get("technique_id") not in (None, "guided_meditation"))

    rec_user = "recovered_user"
    for i in range(40):
        context_builder.update(rec_user, 0.31, 0.30, baseline=0.30, timestamp=now2 - 80 + 2 * i)
    done = client.post("/loop/step", json={"user_id": rec_user, "technique_id": "guided_meditation", "elapsed_seconds": 300}).get_json()
    check("back at baseline -> stop", done["action"] == "stop", done["action"])

    print("\nALL PASSED" if not failures else f"\n{len(failures)} FAILED: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
