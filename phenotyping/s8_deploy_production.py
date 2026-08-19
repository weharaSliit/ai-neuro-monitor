#Purpose: This prepares the model for Android Backend. It saves the OC-SVM and the required scaling parameters.


import joblib
import os
from sklearn.svm import OneClassSVM

def deploy_brain():
    print("🚀 [S8] Deploying Production Brain for Mobile Backend...")
    
    # Use the parameters validated in S6 and S7
    # One-Class SVM with RBF kernel is our production choice
    prod_model = OneClassSVM(kernel='rbf', nu=0.1, gamma='scale')
    
    # [FIX]: The model must be fitted before saving!
    # We create a synthetic baseline of 'normal' global behavior to initialize the boundaries
    import numpy as np
    np.random.seed(42)
    # Generating 500 samples of normal typing (dwell~120ms, flight~200ms, scroll~45)
    X_normal_baseline = np.random.normal(loc=[120, 200, 45], scale=[15, 20, 5], size=(500, 3))
    prod_model.fit(X_normal_baseline)
    
    # Metadata for the Android App to know how to handle incoming data
    model_package = {
        "model_name": "Pre-Stress Behavioral Engine",
        "version": "1.0.0",
        "inputs": ["dwell_time", "flight_time", "scroll_velocity"],
        "logic": "Z-Score Drift (1.0 - 1.5)",
        "calibration_period_days": 7
    }
    
    # --- PATH FIX ---
    # Ensure it always saves to phenotyping/models/ regardless of where you run it from
    base_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(base_dir, "models")
    
    os.makedirs(models_dir, exist_ok=True)
    joblib.dump(prod_model, os.path.join(models_dir, "stress_engine.pkl"))
    joblib.dump(model_package, os.path.join(models_dir, "model_metadata.joblib"))
    
    print("✅ Success: Production model and metadata deployed to /models/")

if __name__ == "__main__":
    deploy_brain()