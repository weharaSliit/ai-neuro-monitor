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

    if os.path.exists(kaggle_path):
        df_mobile = pd.read_csv(kaggle_path)

        # Extract all 5 mobile features: dwell (ms), flight (ms), scroll (px/s), tilt (deg), typing_speed (CPM)
        dwell_ms    = df_mobile["avg_dwell"].values * 1000.0    # Convert to ms
        flight_ms   = df_mobile["avg_flight"].values * 1000.0   # Convert to ms
        scroll_val  = df_mobile["scroll_magnitude"].fillna(45.0).values
        tilt_val    = df_mobile["tilt_axis"].fillna(59.09).values       # Population mean from Kaggle (deg)
        cpm_val     = df_mobile["typing_speed"].fillna(39.40).values    # Population mean from Kaggle (CPM)

        X_train_raw = np.column_stack([dwell_ms, flight_ms, scroll_val, tilt_val, cpm_val])
        training_source = f"Kaggle Mobile 5-Feature ({len(X_train_raw)} real mobile records, 20 users)"
        print(f"📊 Training on REAL Mobile Touchscreen Data (5 features): {len(X_train_raw)} samples...")
    else:
        # ── HARD STOP: No synthetic or random fallback allowed ───────────────
        # The production OC-SVM MUST be trained on real mobile touchscreen data.
        # Allowing synthetic or CMU-scroll-imputed data would silently corrupt the
        # scaler statistics and invalidate all academic precision claims (92.7%).
        raise FileNotFoundError(
            "\n\n❌ [S8] PRODUCTION DEPLOYMENT BLOCKED — Real mobile data not found.\n"
            f"   Expected: {kaggle_path}\n\n"
            "   FIX: Run the Kaggle preprocessing pipeline first:\n"
            "     1. Download dataset from:\n"
            "        https://www.kaggle.com/datasets/aryaanyaadav/mobile-behavioral-biometrics-dataset\n"
            "     2. Place the CSV in:\n"
            "        phenotyping/research_v1_kaggle_mobile/data/raw/behavioral_biometrics.csv\n"
            "     3. Run:  python phenotyping/research_v1_kaggle_mobile/src/s1_kaggle_preprocess.py\n"
            "     4. Then re-run this script.\n\n"
            "   ⚠️  Synthetic/random fallback data has been permanently removed from this pipeline\n"
            "       to preserve academic integrity of the deployed model.\n"
        )

    # ── 2. Fit StandardScaler (Feature Scaler) ───────────────────────────────
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_raw)

    print(f"✅ StandardScaler fitted (5 features):")
    print(f"   Dwell    mean: {scaler.mean_[0]:.2f} ms   | std: {scaler.scale_[0]:.2f} ms")
    print(f"   Flight   mean: {scaler.mean_[1]:.2f} ms   | std: {scaler.scale_[1]:.2f} ms")
    print(f"   Scroll   mean: {scaler.mean_[2]:.2f} px/s | std: {scaler.scale_[2]:.2f} px/s")
    print(f"   Tilt     mean: {scaler.mean_[3]:.2f} deg  | std: {scaler.scale_[3]:.2f} deg")
    print(f"   CPM      mean: {scaler.mean_[4]:.2f} cpm  | std: {scaler.scale_[4]:.2f} cpm")

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
            'scroll_velocity': float(scaler.mean_[2]),
            'tilt_angle': float(scaler.mean_[3]),
            'cpm': float(scaler.mean_[4])
        },
        'stds': {
            'avg_dwell': float(scaler.scale_[0]),
            'avg_flight': float(scaler.scale_[1]),
            'scroll_velocity': float(scaler.scale_[2]),
            'tilt_angle': float(scaler.scale_[3]),
            'cpm': float(scaler.scale_[4])
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
        "inputs": ["dwell_time", "flight_time", "scroll_velocity", "tilt_angle", "cpm"],
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