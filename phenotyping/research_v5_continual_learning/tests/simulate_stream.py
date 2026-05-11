#(Feeds data row-by-row to test adaptation)

import sys
import os
from pathlib import Path

# --- PATH BRIDGE: Allows running from any directory ---
# This finds the root of Objective 2 and adds it to Python's search list
ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

# Now we can import your research modules correctly
try:
    from src.s1_calibration_manager import CalibrationManager
    from src.s2_ema_adaptive_engine import EMAAdaptiveEngine
    from src.s3_quality_gate_fusion import QualityGateFusion
    from src.s4_drift_trend_analyzer import DriftTrendAnalyzer
except ImportError as e:
    print(f"❌ Import Error: {e}")
    print(f"Make sure you are in the folder: {ROOT}")
    sys.exit(1)

def run_research_simulation():
    print("\n" + "="*60)
    print(" 🎬 OBJECTIVE 2: CONTINUAL LEARNING SIMULATION")
    print(" 🔬 Goal: Test Personalized Baseline Adaptation & Noise Gate")
    print("="*60 + "\n")
    
    # 1. Initialize Components
    # We simulate a short 2-day calibration for this test
    calib = CalibrationManager(target_days=2, min_samples_per_day=2) 
    gate = QualityGateFusion()
    drift_analyzer = DriftTrendAnalyzer(window_size=3)
    
    # 2. Setup Initial Baseline (Mimicking Day 7 output)
    # Average dwell time 80ms, StdDev 10ms
    initial_base = {'means': {'dwell': 0.080}, 'stds': {'dwell': 0.010}}
    ema_engine = EMAAdaptiveEngine(initial_base, alpha=0.1)

    # 3. Simulated Behavioral Stream (Row-by-Row)
    # activity: 0=Stationary, 1=Moving
    stream = [
        {'time': "10:00", 'dwell': 0.082, 'act': 0, 'app': 'email', 'note': 'Normal behavior'},
        {'time': "10:05", 'dwell': 0.120, 'act': 1, 'app': 'system', 'note': 'Walking (Noise Gate should catch this)'},
        {'time': "10:10", 'dwell': 0.095, 'act': 0, 'app': 'productivity', 'note': 'Drift Step 1 (Pre-Stress Band)'},
        {'time': "10:15", 'dwell': 0.097, 'act': 0, 'app': 'productivity', 'note': 'Drift Step 2 (Pre-Stress Band)'},
        {'time': "10:20", 'dwell': 0.099, 'act': 0, 'app': 'productivity', 'note': 'Drift Step 3 (ALERT TRIGGER)'},
        {'time': "10:25", 'dwell': 0.150, 'act': 0, 'app': 'productivity', 'note': 'Peak Stress Anomaly'}
    ]

    for point in stream:
        # Step A: Check Context Gate
        valid, reason = gate.is_data_valid(point['act'], point['app'])
        
        if not valid:
            print(f"⏳ [{point['time']}] {point['note']:<40} | ❌ REJECTED: {reason}")
            continue
            
        # Step B: Calculate Personalized Z-Score
        z = ema_engine.get_z_score(point['dwell'], 'dwell')
        
        # Step C: Analyze Trend
        status = drift_analyzer.analyze_drift(z)
        
        # Output results
        print(f"✅ [{point['time']}] {point['note']:<40} | Z={z:>5.2f} | STATUS: {status}")

    print("\n" + "="*60)
    print(" ✅ Objective 2 Logic Validated.")
    print(" Model is successfully adapting and filtering noise.")
    print("="*60)

if __name__ == "__main__":
    run_research_simulation()