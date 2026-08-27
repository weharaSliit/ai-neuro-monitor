import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.phenotyping_behavior.predictor import predictor
from backend.phenotyping_behavior.ema_service import update_personalized_baseline

# 1. Test Normal Window
m_normal = {'avg_dwell': 6.0, 'avg_flight': 910.0, 'scroll_velocity': 920.0}
b_user = {
    'avg_dwell': {'mean': 5.74, 'std': 11.71},
    'avg_flight': {'mean': 917.46, 'std': 526.16},
    'scroll_velocity': {'mean': 922.39, 'std': 335.04}
}

res_normal = predictor.predict(m_normal, b_user, user_id='user_drift_test')
print("Normal Window Result:", res_normal['label'], "| Score:", res_normal['score'])

# 2. Test Moderate Drift (Escalation Band 1.0 - 2.0 Z) across consecutive windows
m_drift = {'avg_dwell': 20.0, 'avg_flight': 1600.0, 'scroll_velocity': 1400.0}
print("\nTesting 3-Window Temporal Drift Confirmation:")
for w in range(4):
    res_drift = predictor.predict(m_drift, b_user, user_id='user_drift_test')
    print(f"  Window {w+1}: Label -> '{res_drift['label']}' | Composite_Z: {res_drift['composite_z']} | Score: {res_drift['score']}")

# 3. Test High Confidence Stress (>2.0 Z + Anomaly)
m_high = {'avg_dwell': 45.0, 'avg_flight': 2500.0, 'scroll_velocity': 2200.0}
res_high = predictor.predict(m_high, b_user, user_id='user_drift_test')
print("\nHigh Stress Immediate Trigger:", res_high['label'], "| Composite_Z:", res_high['composite_z'])
