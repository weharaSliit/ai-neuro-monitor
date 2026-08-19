# ============================================================
# calibrate_ring.py
# CLI wrapper around calibration_capture.run_calibration_capture() —
# collects N_BASELINE_WIN windows of real resting sensor data over
# MQTT and saves them as a personal baseline for USER_ID.
#
# Run once before mqtt_bridge.py, ring worn, sitting still,
# from backend/physiological/:
#   python calibrate_ring.py
# Takes ~SETTLE_SEC + N_BASELINE_WIN * WINDOW_SEC (~3.5 minutes).
# Re-run any time to recalibrate — EMA-merges into the existing
# baseline rather than overwriting it outright (same behavior the
# in-app calibration trigger has, since both call the same function).
# ============================================================

import sys
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.common.config import N_BASELINE_WIN, SETTLE_SEC, WINDOW_SEC
from backend.physiological.firebase_service import init_firebase
from backend.physiological.calibration_capture import run_calibration_capture

USER_ID = "Wehara"

init_firebase()


def print_progress(status, extra):
    if status == 'settling':
        print(f"Letting the sensor settle for {SETTLE_SEC}s before capturing "
              f"(electrode contact needs a moment to stabilize)...")
    elif status == 'window_skipped':
        print(f"  Window skipped — insufficient data "
              f"(ibi={extra['ibi']}, gsr={extra['gsr']}, acc={extra['acc']}). "
              f"Stay still, keep your finger steady on the sensor.")
    elif status == 'window_captured':
        print(f"  Window {extra['window_idx']}/{N_BASELINE_WIN} captured "
              f"(fs={extra['fs']}Hz)")
    elif status == 'saving':
        print(f"\nCollected {N_BASELINE_WIN} windows. Saving baseline...")
    elif status == 'done':
        print(f"Done: {extra}")
    elif status == 'error':
        print(f"Error: {extra['message']}")


print(f"Calibration: sit comfortably and relax for "
      f"~{N_BASELINE_WIN * WINDOW_SEC // 60} minute(s) "
      f"(plus a {SETTLE_SEC}s settling period first).")
print("Keep your finger steady on the MAX30102, don't talk or move.")
print("Starting MQTT calibration listener...\n")

run_calibration_capture(USER_ID, on_progress=print_progress)
