"""
End-to-end verification of the integrated pipeline: EEG Flask service ->
HRV/GSR firebase bridge -> shared Firebase backend -> fusion_engin.py ->
final stress_label + stress_probability. Drives the ACTUAL integration
layer built this session, not just the underlying libraries:

  - EEG: backend/psychological/app.py's real Flask app (test client),
          /calibrate then /predict, backed by the real trained model
          (backend/psychological/models/sam40_t7t8_state_model.joblib)
          via backend/psychological/realtime/pipeline.py::RealtimeInference.
          Internally this also exercises EegFirebaseSession, which writes
          RTDB phsycological/, Firestore fusion_engine, AND RTDB fusion_en
          -- all three real code paths, not reimplemented here.

  - HRV/GSR: backend/physiological/app.py itself can't be imported in this
          environment (best_model_obj1_v2.pkl is a teammate-local artifact
          not in this repo, and xgboost isn't installed) -- so this calls
          backend/physiological/firebase_service.py's real functions
          directly (save_fusion_engine_firestore, save_fusion_en_rtdb,
          label_session_ground_truth_firestore, label_session_ground_truth_rtdb),
          the same functions app.py's /predict and /pss4 call, fed a
          PLACEHOLDER stress probability (placeholder_hrv_gsr_score below)
          computed from REAL feature extraction (extract_features.py, pure
          numpy/scipy, no model needed) over synthetic IBI/GSR/ACC arrays.
          Every row is tagged is_placeholder_model_hrv_gsr=True and
          deliberately omits model_acc_hrv_gsr (0.851 belongs to the real
          trained model, not this stand-in). Swap placeholder_hrv_gsr_score()
          for a real predictor.predict_window() call once the model file +
          xgboost are available.

  - Fusion: fushion engin/fusion_engin.py's real preprocess() /
          fit_logistic_meta_model() / apply_meta_model(), unmodified.

Both sides write into ONE shared fake Firebase backend (in-memory, not the
real stress-monitor-c39ee project) -- the actual point of this test is
confirming EEG's and HRV/GSR's independent writes land in the SAME merged
document/row (matching session_id + window), through BOTH storage products
(Cloud Firestore fusion_engine AND Realtime Database fusion_en), not just
that each side works in isolation.

Usage:
    python3 "fushion engin/test_synthetic_fusion_e2e.py" --sessions 8 --windows 12
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import types
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "phscycological" / "src"))


# ═══════════════════════════════════════════════════════════════════
#  SHARED FAKE FIREBASE BACKEND -- one in-memory store, written by BOTH
#  backend/psychological (via EegFirebaseSession) and backend/physiological
#  (via firebase_service.py's functions), exactly as the real Firebase
#  project would be. Installed into sys.modules BEFORE either backend/
#  package is imported, so their real code runs unmodified against this.
# ═══════════════════════════════════════════════════════════════════

RTDB_TREE: dict[str, dict] = {}
FIRESTORE_STORE: dict[str, dict] = {}  # doc_id -> fields (single collection, matches our usage)


class FakeRTDBRef:
    def __init__(self, path: str):
        self.path = path.strip("/")

    def child(self, key):
        return FakeRTDBRef(f"{self.path}/{key}")

    def set(self, data):
        RTDB_TREE[self.path] = dict(data)

    def update(self, data):
        RTDB_TREE.setdefault(self.path, {}).update(data)

    def get(self):
        if self.path in RTDB_TREE:
            return RTDB_TREE[self.path]
        prefix = self.path + "/"
        children = {
            p[len(prefix):]: v for p, v in RTDB_TREE.items()
            if p.startswith(prefix) and "/" not in p[len(prefix):]
        }
        return children or None

    def push(self, data):
        import time
        key = f"auto_{time.time_ns()}"
        RTDB_TREE[f"{self.path}/{key}"] = dict(data)


class FakeFirestoreDocRef:
    def __init__(self, doc_id: str):
        self.doc_id = doc_id

    def set(self, data, merge=True):
        if merge:
            FIRESTORE_STORE.setdefault(self.doc_id, {}).update(data)
        else:
            FIRESTORE_STORE[self.doc_id] = dict(data)

    @property
    def reference(self):
        return self


class FakeFirestoreQuery:
    def __init__(self, matches: list[str]):
        self._matches = matches

    def stream(self):
        return [FakeFirestoreDocRef(doc_id) for doc_id in self._matches]


class FakeFirestoreCollection:
    def document(self, doc_id):
        return FakeFirestoreDocRef(doc_id)

    def where(self, field, op, value):
        assert op == "=="
        matches = [doc_id for doc_id, d in FIRESTORE_STORE.items() if d.get(field) == value]
        return FakeFirestoreQuery(matches)


class FakeFirestoreClient:
    def collection(self, name):
        return FakeFirestoreCollection()


_fake_fa = types.ModuleType("firebase_admin")
_fake_fa._apps = []
_fake_fa.credentials = types.SimpleNamespace(Certificate=lambda p: ("CRED", p))
_fake_fa.db = types.SimpleNamespace(reference=lambda p, app=None: FakeRTDBRef(p))
_fake_firestore_client = FakeFirestoreClient()
_fake_fa.firestore = types.SimpleNamespace(client=lambda *a, **k: _fake_firestore_client)


def _fake_initialize_app(cred, opts=None):
    _fake_fa._apps.append(1)
    return "APP"


def _fake_get_app():
    if not _fake_fa._apps:
        raise ValueError("no app")
    return "APP"


_fake_fa.initialize_app = _fake_initialize_app
_fake_fa.get_app = _fake_get_app
sys.modules["firebase_admin"] = _fake_fa
sys.modules["firebase_admin.credentials"] = _fake_fa.credentials
sys.modules["firebase_admin.db"] = _fake_fa.db
sys.modules["firebase_admin.firestore"] = _fake_fa.firestore

# EEG side reads its credential from $FIREBASE_CREDENTIALS (see
# backend/psychological/firebase_service.py's module docstring on why it
# never falls back to the checked-in backend/common/serviceAccountKey.json)
# -- must point at a REAL file (FirebaseSync checks .is_file()), content is
# irrelevant since credentials.Certificate() is stubbed above.
os.environ["FIREBASE_CREDENTIALS"] = str(Path(__file__).resolve())

import backend.psychological.app as eeg_app  # noqa: E402
from backend.psychological.realtime.pipeline import BLOCK_SAMPLES_RAW  # noqa: E402
from backend.psychological.realtime.resample import SOURCE_FS as EEG_SOURCE_FS  # noqa: E402
from backend.psychological.realtime.adc import microvolts_to_code  # noqa: E402

from scipy.signal import resample_poly  # noqa: E402
from sam40.loader import discover_trials, load_trial_data  # noqa: E402
from sam40.channels import CHANNEL_NAMES  # noqa: E402

import backend.physiological.firebase_service as phys_fs  # noqa: E402
from backend.physiological.extract_features import extract_features, compute_signal_quality  # noqa: E402

# fusion_engin.py lives in a directory with a space in its name -- import by path
_spec = importlib.util.spec_from_file_location("fusion_engin", REPO / "fushion engin" / "fusion_engin.py")
fusion_engin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fusion_engin)


# ═══════════════════════════════════════════════════════════════════
#  SYNTHETIC SESSION / GROUND-TRUTH GENERATION
# ═══════════════════════════════════════════════════════════════════

def true_stress_trajectory(n_windows: int, session_peak: float, rng: np.random.Generator) -> np.ndarray:
    """baseline -> task -> recovery, as a smooth 0..1 latent per window."""
    t = np.linspace(0, 1, n_windows)
    bump = np.exp(-((t - 0.5) ** 2) / (2 * 0.18 ** 2))
    trajectory = 0.08 + (session_peak - 0.08) * bump
    trajectory += rng.normal(0, 0.03, size=n_windows)
    return np.clip(trajectory, 0.0, 1.0)

class Sam40EegProvider:
    """Cycles through a real subject's SAM40 trials, providing 25s blocks
    of realistic EEG data instead of the purely synthetic generator."""
    def __init__(self, subject_id: int):
        data_path = REPO / 'phscycological' / 'data' / 'SAM40' / 'filtered_data'
        all_trials = discover_trials(data_path)
        self.subject_trials = [t for t in all_trials if t.subject == subject_id]
        if not self.subject_trials:
            raise ValueError(f"No SAM40 trials found for subject {subject_id} at {data_path}")

        self.chan_idx = [CHANNEL_NAMES.index(c) for c in ['T7', 'T8']]
        self.trial_iter = iter(self.subject_trials)
        self.current_trial_samples = []
        self.current_sample_idx = 0
        self._load_next_trial()

    def _load_next_trial(self):
        try:
            trial = next(self.trial_iter)
        except StopIteration:
            self.trial_iter = iter(self.subject_trials)
            trial = next(self.trial_iter)

        raw_32chan = load_trial_data(trial, source='filtered')
        # NO Common Average Reference (CAR) -- see test_realtime_pipeline_replay.py
        # for the rationale. We must simulate the 2-electrode hardware's input.
        selected = raw_32chan[self.chan_idx, :]
        upsampled = resample_poly(selected, EEG_SOURCE_FS, 128, axis=-1)
        codes = microvolts_to_code(upsampled)

        self.current_trial_samples = [
            {'ch1_code': int(codes[0, i]), 'ch2_code': int(codes[1, i])}
            for i in range(codes.shape[1])
        ]
        self.current_sample_idx = 0

    def get_next_block_json(self, start_millis: int) -> dict:
        if self.current_sample_idx + BLOCK_SAMPLES_RAW > len(self.current_trial_samples):
            self._load_next_trial()

        end_idx = self.current_sample_idx + BLOCK_SAMPLES_RAW
        block = self.current_trial_samples[self.current_sample_idx:end_idx]
        self.current_sample_idx = end_idx

        return {
            "millis": (start_millis + np.arange(BLOCK_SAMPLES_RAW) * (1000.0 / EEG_SOURCE_FS)).astype(int).tolist(),
            "ch1_code": [s['ch1_code'] for s in block],
            "ch2_code": [s['ch2_code'] for s in block],
        }


def synth_hrv_gsr_window(true_stress: float, rng: np.random.Generator,
                          window_sec: float = 60.0, fs: float = 5.0):
    """Physiologically-directioned synthetic IBI/GSR/ACC -- see prior
    version's docstring: higher stress -> shorter/less-variable IBIs,
    lower GSR ADC (== higher skin conductance)."""
    mean_ibi = 900.0 - 250.0 * true_stress + rng.normal(0, 20)
    sd_ibi = max(15.0, 55.0 - 35.0 * true_stress + rng.normal(0, 5))
    n_beats = max(10, int(window_sec / (mean_ibi / 1000.0)))
    ibi_array = np.clip(rng.normal(mean_ibi, sd_ibi, size=n_beats), 350, 1400).tolist()

    n_samples = int(window_sec * fs)
    gsr_calibration = 2048
    mean_adc = gsr_calibration - 300 - 550 * true_stress
    gsr_adc_array = np.clip(rng.normal(mean_adc, 40, size=n_samples), 200, gsr_calibration - 50).tolist()

    acc_array = np.clip(rng.normal(1.0, 0.02, size=n_samples), 0.85, 1.15).tolist()
    return ibi_array, gsr_adc_array, acc_array, gsr_calibration


def placeholder_hrv_gsr_score(feat_dict: dict) -> float:
    """NOT the trained XGBoost model -- see module docstring. Monotonic
    stand-in over REAL extracted features (lower AVNN, higher SCL_mean ->
    higher stress probability); constants hand-picked to spread this
    synthetic generator's output range, not fit to any real data."""
    avnn = feat_dict.get("AVNN", 750.0)
    scl = feat_dict.get("SCL_mean", 5.0)
    z = -0.012 * (avnn - 750.0) + 0.18 * (scl - 5.0)
    return float(1.0 / (1.0 + np.exp(-z)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=int, default=8)
    ap.add_argument("--windows", type=int, default=12)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    eeg_client = eeg_app.app.test_client()
    eeg_provider = Sam40EegProvider(subject_id=2)  # Use real data from subject 2
    truth_rows = []

    print(f"=== Driving the REAL integration layer: backend/psychological/app.py (Flask, real "
          f"model) + backend/physiological/firebase_service.py (real functions, placeholder "
          f"scorer) for {args.sessions} sessions x {args.windows} windows ===\n")

    for s in range(args.sessions):
        session_id = f"synthetic_e2e_{s}"
        # Alternate low/high bands (not one wide uniform draw) so the PSS-4-style
        # ground truth below (thresholded at score>6/16, i.e. session_peak>0.375)
        # comes out roughly class-balanced regardless of --sessions count --
        # a single wide draw left 7/8 sessions above threshold on one run,
        # starving the Stage 8 meta-model fit of one class entirely.
        session_peak = float(rng.uniform(0.10, 0.35) if s % 2 == 0 else rng.uniform(0.55, 0.95))
        stresses = true_stress_trajectory(args.windows, session_peak, rng)

        # ---- EEG: real /calibrate over the real Flask app ----
        millis = 0
        calib_blocks = []
        for _ in range(3):
            calib_blocks.append(eeg_provider.get_next_block_json(millis))
            millis += int(BLOCK_SAMPLES_RAW * (1000.0 / EEG_SOURCE_FS))
        r = eeg_client.post("/calibrate", json={
            "session_id": session_id, "allow_degraded": True, "blocks": calib_blocks,
        })
        if r.status_code != 200:
            print(f"  !! calibration failed for {session_id}: {r.get_json()}")
            continue

        for w in range(args.windows):
            true_s = float(stresses[w])
            truth_rows.append({"session_id": session_id, "window": w, "true_stress": true_s})

            # ---- EEG: real /predict over the real Flask app (writes RTDB
            # phsycological/, Firestore fusion_engine, RTDB fusion_en -- all
            # via the real EegFirebaseSession, unmodified) ----
            block = eeg_provider.get_next_block_json(millis)
            millis += int(BLOCK_SAMPLES_RAW * (1000.0 / EEG_SOURCE_FS))
            block["session_id"] = session_id
            r = eeg_client.post("/predict", json=block)
            if r.status_code != 200:
                print(f"  !! /predict failed for {session_id} window {w}: {r.get_json()}")

            # ---- HRV/GSR: real feature extraction + placeholder scorer,
            # written via the REAL backend/physiological/firebase_service.py
            # functions (same ones app.py's /predict calls) ----
            ibi, gsr_adc, acc, gsr_cal = synth_hrv_gsr_window(true_s, rng)
            _, motion_rejected, feat_dict = extract_features(ibi, gsr_adc, acc, gsr_cal, actual_fs=5.0)
            signal_quality = compute_signal_quality(ibi, gsr_adc, acc, motion_rejected, actual_fs=5.0)
            prob_stress = placeholder_hrv_gsr_score(feat_dict)
            prob_normal = 1.0 - prob_stress
            confidence = max(prob_normal, prob_stress)
            label = "Stress" if prob_stress > prob_normal else "Normal"

            phys_fs.save_fusion_engine_firestore(
                "synthetic_user", session_id, w, confidence, float(signal_quality),
                prob_normal, prob_stress, label, bool(prob_stress > 0.6),
            )
            phys_fs.save_fusion_en_rtdb(
                "synthetic_user", session_id, w, confidence, float(signal_quality),
                prob_normal, prob_stress, label, bool(prob_stress > 0.6),
            )

        # ---- Ground truth backfill (real PSS-4 style, both storage backends) ----
        pss4_score = int(np.clip(session_peak * 16, 0, 16))
        phys_fs.label_session_ground_truth_firestore(session_id, pss4_score)
        phys_fs.label_session_ground_truth_rtdb(session_id, pss4_score)

    truth_df = pd.DataFrame(truth_rows).set_index(["session_id", "window"])

    # ---- Cross-check: Firestore fusion_engine vs RTDB fusion_en agree on row count ----
    n_firestore = len(FIRESTORE_STORE)
    fusion_en_rows = {p: d for p, d in RTDB_TREE.items() if p.startswith("fusion_en/") and p.count("/") == 2}
    n_rtdb = len(fusion_en_rows)
    print(f"\nCross-check -- Firestore fusion_engine rows: {n_firestore}   "
          f"RTDB fusion_en rows: {n_rtdb}   {'MATCH' if n_firestore == n_rtdb else 'MISMATCH!'}")
    both_present = sum(1 for d in fusion_en_rows.values() if d.get("prob_eeg") is not None and d.get("prob_hrv_gsr") is not None)
    print(f"RTDB fusion_en rows with BOTH prob_eeg and prob_hrv_gsr merged: {both_present}/{n_rtdb}")
    gt_in_rtdb = sum(1 for d in fusion_en_rows.values() if d.get("ground_truth_stress") is not None)
    print(f"RTDB fusion_en rows with ground_truth_stress backfilled: {gt_in_rtdb}/{n_rtdb}")

    # ---- Hand the Firestore store to fusion_engin.py exactly as load_fusion_records() would ----
    rows = [dict(d, doc_id=doc_id) for doc_id, d in FIRESTORE_STORE.items()]
    raw = pd.DataFrame(rows)
    raw["timestamp"] = pd.to_datetime(raw["timestamp"], utc=True, errors="coerce")

    print(f"\n{len(raw)} fused Firestore documents assembled "
          f"({args.sessions} sessions x {args.windows} windows)\n")

    coverage = fusion_engin.report_modality_coverage(raw)
    df = fusion_engin.preprocess(raw)
    fusion_engin.summarize(df)

    print(f"\n{'=' * 62}\n  LOGISTIC META-MODEL (Stage 8)\n{'=' * 62}")
    result = fusion_engin.fit_logistic_meta_model(
        df, label_col="ground_truth_stress", feature_cols=["prob_eeg", "prob_hrv_gsr"],
        group_col="session_id", n_splits=5,
    )
    if result is not None:
        df = fusion_engin.apply_meta_model(df, result)

    df = df.set_index(["session_id", "window"])
    df["true_stress"] = truth_df["true_stress"]
    df["stress_label_fixed"] = (df["fused_probability"] >= 0.5).astype(int)
    if result is not None:
        df["stress_label_meta"] = (df["fused_probability_meta"] >= 0.5).astype(int)

    print(f"\n{'=' * 90}\n  FINAL OUTPUT (first 15 rows)\n{'=' * 90}")
    cols = ["prob_eeg", "prob_hrv_gsr", "fused_probability", "stress_label_fixed"]
    if result is not None:
        cols += ["fused_probability_meta", "stress_label_meta"]
    cols += ["ground_truth_stress"]
    print(df[cols].head(15).round(3).to_string())

    from sklearn.metrics import roc_auc_score
    print(f"\n{'=' * 62}\n  ROC-AUC vs synthetic ground truth (informational -- HRV/GSR\n"
          f"  side uses the placeholder scorer, not the real trained model)\n{'=' * 62}")
    y = df["ground_truth_stress"]
    comparisons = [("EEG only (real model, real Flask app)", "prob_eeg"),
                   ("HRV/GSR only (real feature extraction, placeholder scorer)", "prob_hrv_gsr"),
                   ("Fixed weighted fusion (Stage 7)", "fused_probability")]
    if result is not None:
        comparisons.append(("Learned meta-fusion (Stage 8)", "fused_probability_meta"))
    for name, col in comparisons:
        valid = df[col].notna() & y.notna()
        if valid.sum() > 1 and y[valid].nunique() > 1:
            auc = roc_auc_score(y[valid], df.loc[valid, col])
            print(f"  {name:<58} AUC = {auc:.3f}  (n={int(valid.sum())})")
        else:
            print(f"  {name:<58} AUC = n/a (insufficient rows/classes)")

    print(f"\nDone. Nothing written to the real Firebase project -- everything above ran "
          f"through the real backend/psychological and backend/physiological code against an "
          f"in-memory fake Firebase backend.")

    run_live_fusion_tests()


# ═══════════════════════════════════════════════════════════════════
#  LIVE FUSION LOOP VERIFICATION (fusion_live_session.py)
#  Uses the SAME fake RTDB_TREE already installed at module load, but with
#  simple, precisely-controlled windows (not the noisy synthetic generator
#  above) so trend/deviation assertions are exact, not probabilistic.
# ═══════════════════════════════════════════════════════════════════

def _full_fusion_row(p: float) -> dict:
    """A fully-populated fusion row at probability p for BOTH modalities --
    without conf/model_acc/signal_quality present, handle_missing_values()
    fills them with 0.0 and reliability_weight collapses to 0 for both
    modalities, making fused_probability always 0 regardless of p. Real
    conf/quality values here keep the assertions meaningful."""
    return {
        "prob_eeg": p, "conf_eeg": 0.9, "model_acc_eeg": 0.8, "signal_quality_eeg": 0.9,
        "prob_hrv_gsr": p, "conf_hrv_gsr": 0.9, "model_acc_hrv_gsr": 0.8, "signal_quality_hrv_gsr": 0.9,
    }


class _DummyRef:
    """Minimal stand-in for a firebase_admin db.reference(...) object,
    backed by the SAME RTDB_TREE / FakeRTDBRef this file already uses for
    the EEG/HRV-GSR integration test above -- reuses its exact get/child/
    update semantics rather than redefining them."""

    def __init__(self, path: str):
        self._ref = FakeRTDBRef(path)

    def get(self):
        return self._ref.get()

    def child(self, key):
        return self._ref.child(key)

    def update(self, data):
        self._ref.update(data)


def run_live_fusion_tests():
    """Verification for fusion_live_session.py's poll_once(), per this
    feature's approved plan: fusion bounds, trend (rising/falling),
    baseline/deviation (None before 3 readings, backfilled after), and
    session-end (stops the loop, doesn't mutate existing fused fields)."""
    sys.path.insert(0, str(REPO / "fushion engin"))
    import fusion_live_session as fls

    print(f"\n{'=' * 62}\n  LIVE FUSION LOOP VERIFICATION (fusion_live_session.py)\n{'=' * 62}")

    # ---- 1. Basic fusion bounds ----
    session_id = "live_test_basic"
    for w, (p_eeg, p_hrv) in enumerate([(0.8, 0.6), (0.2, 0.3), (0.5, 0.5)]):
        row = _full_fusion_row(p_eeg)
        row["prob_hrv_gsr"] = p_hrv
        RTDB_TREE[f"fusion_en/{session_id}/{w}"] = row
    session_ref = _DummyRef(f"fusion_en/{session_id}")
    ended_ref = _DummyRef(f"fusion_en_sessions/{session_id}/ended")
    result = fls.poll_once(session_id, session_ref, ended_ref)
    assert result["ended"] is False
    for w in range(3):
        row = RTDB_TREE[f"fusion_en/{session_id}/{w}"]
        assert 0.0 <= row["fused_probability"] <= 1.0, row
        assert row["fused_label"] == int(row["fused_probability"] >= 0.5), row
    print("  [OK] basic fusion: fused_probability in [0,1], fused_label matches threshold")

    # ---- 2. Trend: rising sequence -> 'increasing' ----
    session_id = "live_test_trend_up"
    session_ref = _DummyRef(f"fusion_en/{session_id}")
    ended_ref = _DummyRef(f"fusion_en_sessions/{session_id}/ended")
    rising = [0.10, 0.15, 0.20, 0.60, 0.90]
    for w, p in enumerate(rising):
        RTDB_TREE[f"fusion_en/{session_id}/{w}"] = _full_fusion_row(p)
        fls.poll_once(session_id, session_ref, ended_ref)  # incremental, like real live windows arriving
    last_row = RTDB_TREE[f"fusion_en/{session_id}/{len(rising) - 1}"]
    assert last_row["stress_trend"] == "increasing", last_row
    print("  [OK] stress_trend == 'increasing' for a rising fused-probability sequence")

    # ---- 3. Trend: falling sequence -> 'decreasing' ----
    session_id = "live_test_trend_down"
    session_ref = _DummyRef(f"fusion_en/{session_id}")
    ended_ref = _DummyRef(f"fusion_en_sessions/{session_id}/ended")
    falling = [0.90, 0.85, 0.80, 0.30, 0.10]
    for w, p in enumerate(falling):
        RTDB_TREE[f"fusion_en/{session_id}/{w}"] = _full_fusion_row(p)
        fls.poll_once(session_id, session_ref, ended_ref)
    last_row = RTDB_TREE[f"fusion_en/{session_id}/{len(falling) - 1}"]
    assert last_row["stress_trend"] == "decreasing", last_row
    print("  [OK] stress_trend == 'decreasing' for a falling fused-probability sequence")

    # ---- 4. Baseline / deviation: None before 3rd reading, backfilled after ----
    session_id = "live_test_baseline"
    session_ref = _DummyRef(f"fusion_en/{session_id}")
    ended_ref = _DummyRef(f"fusion_en_sessions/{session_id}/ended")
    values = [0.2, 0.3, 0.4, 0.9]
    for w, p in enumerate(values):
        RTDB_TREE[f"fusion_en/{session_id}/{w}"] = _full_fusion_row(p)
        fls.poll_once(session_id, session_ref, ended_ref)
        if w < 2:
            row = RTDB_TREE[f"fusion_en/{session_id}/{w}"]
            assert row["stress_deviation"] is None, row
    baseline_mean = float(np.mean([RTDB_TREE[f"fusion_en/{session_id}/{i}"]["fused_probability"] for i in range(3)]))
    for i in range(3):
        row = RTDB_TREE[f"fusion_en/{session_id}/{i}"]
        assert abs(row["stress_deviation"] - (row["fused_probability"] - baseline_mean)) < 1e-9, row
    print(f"  [OK] stress_deviation is None before 3rd fused reading, backfilled onto windows "
          f"0-2 once available (baseline_mean={baseline_mean:.3f})")

    # ---- 5. Session end: stops the loop, doesn't mutate existing fused fields ----
    session_id = "live_test_end"
    session_ref = _DummyRef(f"fusion_en/{session_id}")
    ended_ref = _DummyRef(f"fusion_en_sessions/{session_id}/ended")
    RTDB_TREE[f"fusion_en/{session_id}/0"] = _full_fusion_row(0.5)
    fls.poll_once(session_id, session_ref, ended_ref)
    before = dict(RTDB_TREE[f"fusion_en/{session_id}/0"])
    RTDB_TREE[f"fusion_en_sessions/{session_id}/ended"] = True
    result = fls.poll_once(session_id, session_ref, ended_ref)
    assert result == {"ended": True}, result
    after = RTDB_TREE[f"fusion_en/{session_id}/0"]
    assert after == before, (before, after)
    print("  [OK] session-end flag stops the loop and does not mutate existing fused fields")

    print("\nAll live-fusion-loop checks passed.")


if __name__ == "__main__":
    main()
