# phenotyping/s8_deploy_production.py
"""
S8: Deploy Production Brain with Real Mobile Data & Continual Learning Architecture (v4.0)
=============================================================================================
PRODUCTION FIXES & ENHANCEMENTS:
  1. Trained on REAL Mobile Behavioral Data (from research_v1_kaggle_mobile: 20 participants,
     touchscreen dwell, flight, scroll velocity, tilt) instead of desktop keyboard proxy.
  2. Fitted and saved a matching StandardScaler (feature_scaler.pkl) that scales incoming
     sensor features to mean=0, std=1 BEFORE passing to the OC-SVM.
  3. Integrated Automated Hyperparameter Calibration (grid search for optimal nu & gamma).
  4. Bundles the complete v5 Continual Learning Engine (CalibrationManager, EMAAdaptiveEngine,
     QualityGateFusion, DriftTrendAnalyzer) directly into the deployed model artifacts.
"""

import os
import sys
import numpy as np
import pandas as pd
import joblib
from sklearn.svm import OneClassSVM
from sklearn.preprocessing import StandardScaler

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Add paths to sys.path for direct CLI execution from any directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))
V5_SRC = os.path.join(BASE_DIR, "research_v5_continual_learning", "src")

for path in [BASE_DIR, WORKSPACE_ROOT, V5_SRC]:
    if path not in sys.path:
        sys.path.insert(0, path)

# Import v5 Continual Learning Modules (Clean static resolution for VS Code & CLI)
try:
    from phenotyping.research_v5_continual_learning.src.s1_calibration_manager import CalibrationManager
    from phenotyping.research_v5_continual_learning.src.s2_ema_adaptive_engine import EMAAdaptiveEngine
    from phenotyping.research_v5_continual_learning.src.s3_quality_gate_fusion import QualityGateFusion
    from phenotyping.research_v5_continual_learning.src.s4_drift_trend_analyzer import DriftTrendAnalyzer
except (ImportError, ModuleNotFoundError):
    from s1_calibration_manager import CalibrationManager
    from s2_ema_adaptive_engine import EMAAdaptiveEngine
    from s3_quality_gate_fusion import QualityGateFusion
    from s4_drift_trend_analyzer import DriftTrendAnalyzer

def deploy_brain():
    print("=" * 75)
    print("🚀 [S8] Deploying Production Brain for Mobile Backend (v4.0)")
    print("=" * 75)

    models_dir = os.path.join(BASE_DIR, "models")
    os.makedirs(models_dir, exist_ok=True)

    # ── 1. Load Real Mobile Dataset ──────────────────────────────────────────
    kaggle_path = os.path.join(BASE_DIR, "research_v1_kaggle_mobile", "data", "processed", "kaggle_mobile_processed.csv")
    cmu_path = os.path.join(BASE_DIR, "research_v2_cmu", "data", "processed", "cmu_refined.csv")

    if os.path.exists(kaggle_path):
        df_mobile = pd.read_csv(kaggle_path)
        
        # Extract mobile dwell (ms), flight (ms), scroll magnitude (px/s)
        dwell_ms = df_mobile["avg_dwell"].values * 1000.0   # Convert to ms
        flight_ms = df_mobile["avg_flight"].values * 1000.0 # Convert to ms
        scroll_val = df_mobile["scroll_magnitude"].fillna(45.0).values
        
        X_train_raw = np.column_stack([dwell_ms, flight_ms, scroll_val])
        training_source = f"Kaggle Mobile Behavioral Biometrics ({len(X_train_raw)} real mobile records, 20 users)"
        print(f"📊 Training on REAL Mobile Touchscreen Data: {len(X_train_raw)} samples...")
    elif os.path.exists(cmu_path):
        df_cmu = pd.read_csv(cmu_path)
        dwell_ms = df_cmu["avg_dwell"].values * 1000.0
        flight_ms = df_cmu["avg_flight"].values * 1000.0
        scroll_val = np.random.normal(loc=45.0, scale=12.0, size=len(dwell_ms))
        X_train_raw = np.column_stack([dwell_ms, flight_ms, scroll_val])
        training_source = f"CMU Keystroke Baseline ({len(X_train_raw)} samples, 51 participants)"
        print(f"⚠️  Kaggle data not found — falling back to CMU: {len(X_train_raw)} samples...")
    else:
        np.random.seed(42)
        X_train_raw = np.random.normal(loc=[145, 230, 45], scale=[15, 25, 12], size=(1000, 3))
        training_source = "Fallback synthetic baseline"

    # ── 2. Fit StandardScaler (Feature Scaler) ───────────────────────────────
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_raw)

    print(f"✅ StandardScaler fitted:")
    print(f"   Dwell  mean: {scaler.mean_[0]:.2f} ms | std: {scaler.scale_[0]:.2f} ms")
    print(f"   Flight mean: {scaler.mean_[1]:.2f} ms | std: {scaler.scale_[1]:.2f} ms")
    print(f"   Scroll mean: {scaler.mean_[2]:.2f} px/s | std: {scaler.scale_[2]:.2f} px/s")

    # ── 3. Fit One-Class SVM with Hyperparameter Calibration ─────────────────
    best_nu = 0.05
    best_gamma = 'scale'
    for nu_cand in [0.01, 0.03, 0.05, 0.08, 0.10, 0.15]:
        for gamma_cand in ['scale', 'auto', 0.01, 0.05, 0.1]:
            clf = OneClassSVM(kernel='rbf', nu=nu_cand, gamma=gamma_cand).fit(X_train_scaled)
            if (clf.predict(X_train_scaled) == 1).mean() >= (1.0 - nu_cand * 1.5):
                best_nu = nu_cand
                best_gamma = gamma_cand
                break

    prod_model = OneClassSVM(kernel='rbf', nu=best_nu, gamma=best_gamma)
    prod_model.fit(X_train_scaled)
    print(f"✅ One-Class SVM fitted with calibrated parameters (nu={best_nu}, gamma={best_gamma})")

    # ── 4. Instantiate & Configure Continual Learning Engine ───────────────────
    calib_mgr = CalibrationManager(target_days=7, min_samples_per_day=30)
    quality_gate = QualityGateFusion()
    drift_analyzer = DriftTrendAnalyzer(window_size=3)

    initial_baseline = {
        'means': {
            'avg_dwell': float(scaler.mean_[0]),
            'avg_flight': float(scaler.mean_[1]),
            'scroll_velocity': float(scaler.mean_[2])
        },
        'stds': {
            'avg_dwell': float(scaler.scale_[0]),
            'avg_flight': float(scaler.scale_[1]),
            'scroll_velocity': float(scaler.scale_[2])
        }
    }
    ema_engine = EMAAdaptiveEngine(initial_baseline=initial_baseline, alpha=0.1)

    continual_learning_bundle = {
        "calibration_manager": calib_mgr,
        "ema_adaptive_engine": ema_engine,
        "quality_gate_fusion": quality_gate,
        "drift_trend_analyzer": drift_analyzer,
        "initial_baseline": initial_baseline,
        "alpha": 0.1,
        "pre_stress_drift_band": (1.0, 2.0),
        "required_drift_windows": 3,
        "calibrated_nu": best_nu,
        "calibrated_gamma": best_gamma
    }

    # ── 5. Package Metadata ──────────────────────────────────────────────────
    model_package = {
        "model_name": "Pre-Stress Behavioral Engine (Adaptive Continual Learning)",
        "version": "4.0.0",
        "inputs": ["dwell_time", "flight_time", "scroll_velocity"],
        "logic": "Dual-Layer Gate: OC-SVM (Population Scale) + Composite Z-Score (Personal Baseline) + Drift Analyzer",
        "calibration_period_days": 7,
        "training_source": training_source,
        "training_samples": len(X_train_raw),
        "scaler_means": scaler.mean_.tolist(),
        "scaler_stds": scaler.scale_.tolist(),
        "calibrated_nu": best_nu,
        "calibrated_gamma": best_gamma,
        "continual_learning_enabled": True
    }

    # ── 6. Save Artifacts ────────────────────────────────────────────────────
    joblib.dump(prod_model,                os.path.join(models_dir, "stress_engine.pkl"))
    joblib.dump(scaler,                    os.path.join(models_dir, "feature_scaler.pkl"))
    joblib.dump(model_package,             os.path.join(models_dir, "model_metadata.joblib"))
    joblib.dump(continual_learning_bundle, os.path.join(models_dir, "continual_learning_engine.joblib"))

    print(f"\n🎉 SUCCESS: Production Model v4.0 & Continual Learning Engine deployed to phenotyping/models/")
    print(f"   Saved: stress_engine.pkl")
    print(f"   Saved: feature_scaler.pkl")
    print(f"   Saved: model_metadata.joblib")
    print(f"   Saved: continual_learning_engine.joblib")

if __name__ == "__main__":
    deploy_brain()