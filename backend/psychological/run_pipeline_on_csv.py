"""
Run a real wearable02 capture CSV through the actual live pipeline
(RealtimeInference.calibrate_bipolar_block / finalize_calibration_bipolar /
infer_bipolar_block -- backend/psychological/realtime/pipeline.py), the same
class and methods app.py's /calibrate and /predict routes call. NOT a
simulation and NOT synthetic data (see test_realtime_pipeline.py for that) --
this is for sanity-checking a specific real capture end-to-end: does it
calibrate cleanly, and what does live inference say about the blocks after.

CSV format expected: the local per-sample log written by mqtt_bridge.py /
app.py's log_raw_block_bipolar() -- header "esp32_uptime_ms,raw_adc_count,
eeg_uV", one row per raw ADC sample at SOURCE_FS (250Hz). Only
esp32_uptime_ms and raw_adc_count are used; eeg_uV is derived and ignored
here (preprocess_bipolar_block() computes it itself from the raw code).

Run with:
    python backend/psychological/run_pipeline_on_csv.py <path-to-csv>
    python backend/psychological/run_pipeline_on_csv.py <path-to-csv> --out results.json
"""

import argparse
import csv
import json
import sys
from pathlib import Path

if __package__ is None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from backend.psychological.realtime.pipeline import BLOCK_SEC, RealtimeInference
from backend.psychological.realtime.resample import SOURCE_FS
from backend.psychological.realtime.mqtt_client import BipolarRawSample

MODEL_DIR = Path(__file__).resolve().parent / "models"
N_CALIBRATION_BLOCKS = 3  # matches N_CALIBRATION_BLOCKS used by the real /calibrate route


def load_samples(csv_path: Path) -> list[BipolarRawSample]:
    samples = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            samples.append(BipolarRawSample(millis=int(row["esp32_uptime_ms"]), code=int(row["raw_adc_count"])))
    return samples


def run(csv_path: Path, n_calib: int = N_CALIBRATION_BLOCKS) -> dict:
    block_samples_raw = int(BLOCK_SEC * SOURCE_FS)
    samples = load_samples(csv_path)
    n_blocks = len(samples) // block_samples_raw

    print(f"Total raw samples: {len(samples)}  (~{len(samples) / SOURCE_FS:.1f}s at {SOURCE_FS}Hz)")
    print(f"BLOCK_SAMPLES_RAW={block_samples_raw} (BLOCK_SEC={BLOCK_SEC}s)  -> {n_blocks} full blocks available\n")

    blocks = [samples[i * block_samples_raw:(i + 1) * block_samples_raw] for i in range(n_blocks)]
    engine = RealtimeInference(MODEL_DIR)  # defaults: calibration_min_rating='QUESTIONABLE', quality gate ON

    results = {"csv": str(csv_path), "calibration_blocks": [], "finalize": None, "inference_blocks": []}

    print("=" * 70)
    print(f"PHASE 1: calibrate_bipolar_block() x{min(n_calib, n_blocks)} -- same as /calibrate route")
    print("=" * 70)
    for i in range(min(n_calib, n_blocks)):
        q = engine.calibrate_bipolar_block(blocks[i])
        entry = {
            "block": i + 1,
            "gate_rating": q.get("gate_rating"),
            "quality_score": q.get("quality_score"),
            "is_trusted": q.get("is_trusted"),
            "reason": q.get("reason"),
        }
        results["calibration_blocks"].append(entry)
        print(f"block {i + 1}/{n_calib}: rating={str(entry['gate_rating']):<12} score={entry['quality_score']!s:<6} "
              f"trusted={entry['is_trusted']}  reason={entry['reason']}")

    if n_blocks >= n_calib:
        outcome = engine.finalize_calibration_bipolar(allow_degraded=True)
        results["finalize"] = outcome
        print(f"\nfinalize_calibration_bipolar(allow_degraded=True) -> {outcome}")
    else:
        print(f"\nNot enough full blocks ({n_blocks}) to run {n_calib}-block calibration.")

    print()
    print("=" * 70)
    print("PHASE 2: infer_bipolar_block() on remaining blocks -- same as /predict route")
    print("=" * 70)
    for i in range(n_calib, n_blocks):
        r = engine.infer_bipolar_block(blocks[i])
        entry = {
            "block": i + 1,
            "skipped": r.get("skipped"),
            "task_state_score": r.get("calibrated_p"),
            "quality_gate_rating": r.get("quality_gate_rating"),
            "quality_quality_score": r.get("quality_quality_score"),
            "quality_reason": r.get("quality_reason") or r.get("reason"),
            "high_load_alert": r.get("high_load_alert"),
        }
        results["inference_blocks"].append(entry)
        label = None
        if entry["task_state_score"] is not None:
            label = "HIGH_LOAD" if entry["high_load_alert"] else "NORMAL"
        print(f"block {i + 1}: skipped={entry['skipped']}  score={entry['task_state_score']}  label={label}  "
              f"gate_rating={entry['quality_gate_rating']}  gate_score={entry['quality_quality_score']}  "
              f"reason={entry['quality_reason']}")

    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path", type=Path, help="Path to a raw capture CSV (esp32_uptime_ms,raw_adc_count,eeg_uV)")
    ap.add_argument("--out", type=Path, default=None, help="Optional path to write the full results as JSON")
    ap.add_argument("--n-calib", type=int, default=N_CALIBRATION_BLOCKS,
                     help=f"Number of leading blocks to treat as calibration (default {N_CALIBRATION_BLOCKS})")
    args = ap.parse_args()

    if not args.csv_path.is_file():
        raise SystemExit(f"CSV not found: {args.csv_path}")

    results = run(args.csv_path, n_calib=args.n_calib)

    if args.out:
        with open(args.out, "w") as f:
            json.dump(results, f, indent=2, default=str)
        print(f"\nFull JSON written to {args.out}")


if __name__ == "__main__":
    main()
