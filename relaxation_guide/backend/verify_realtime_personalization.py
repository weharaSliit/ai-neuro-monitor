"""
Verification Script for Real-Time Adaptive Personalization.
Tests user-scoped Firebase fusion_en_sessions telemetry ingestion, Contextual Thompson Sampling adaptation,
and user-wise preference learning.
"""

import sys
import os
import time

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.telemetry_aggregator import telemetry_aggregator
from app.services.missing_value_handler import missing_value_handler
from app.services.kmeans_clusterer import kmeans_clusterer
from app.services.thompson_bandit import thompson_bandit
from app.services.preference_learner import preference_learner
from app.services.validator import validator
from app.services import firebase_service
from app.models.schemas import TelemetryPayload, InterventionRequest

def run_tests():
    print("=" * 70)
    print("RUNNING REAL-TIME ADAPTATION & PERSONALIZATION VERIFICATION TEST")
    print("=" * 70)

    # User 1: High Stress User (User_Alpha)
    u1_id = "user_alpha_test"
    u1_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=u1_id,
        fused_stress_label="high_stress",
        stress_probability=0.92,
        seconds_since_last_packet=0.0,
        is_calibrated=True
    )

    # User 2: Moderate/Pre-Stress User (User_Beta)
    u2_id = "user_beta_test"
    u2_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=u2_id,
        fused_stress_label="pre-stress",
        stress_probability=0.55,
        seconds_since_last_packet=0.0,
        is_calibrated=True
    )

    # 1. Process Telemetry & Missing Value Handler
    u1_processed = missing_value_handler.process_telemetry(u1_payload)
    u2_processed = missing_value_handler.process_telemetry(u2_payload)

    print(f"\n[Test 1] Processed Signals:")
    print(f"  User Alpha ({u1_id}): label={u1_processed.effective_label}, prob={u1_processed.features_flat[0]}")
    print(f"  User Beta  ({u2_id}): label={u2_processed.effective_label}, prob={u2_processed.features_flat[0]}")

    assert u1_processed.effective_label == "stress"
    assert u2_processed.effective_label == "pre-stress"

    # 2. Context Cluster Prediction
    u1_cluster = kmeans_clusterer.predict_cluster(u1_processed.features_flat)
    u2_cluster = kmeans_clusterer.predict_cluster(u2_processed.features_flat)

    print(f"\n[Test 2] K-Means Context Clusters:")
    print(f"  User Alpha ({u1_id}): Cluster ID={u1_cluster}")
    print(f"  User Beta  ({u2_id}): Cluster ID={u2_cluster}")

    assert u1_cluster != u2_cluster, "High stress vs Pre-stress should assign to distinct context clusters"

    # Warm-up memory cache for both users
    thompson_bandit.select_technique(u1_id, u1_cluster)
    thompson_bandit.select_technique(u2_id, u2_cluster)

    # 3. Thompson Sampling Initial Selection
    u1_tech, u1_blend, u1_phys, u1_pref, u1_ms, _ = thompson_bandit.select_technique(u1_id, u1_cluster)
    u2_tech, u2_blend, u2_phys, u2_pref, u2_ms, _ = thompson_bandit.select_technique(u2_id, u2_cluster)

    print(f"\n[Test 3] Thompson Sampling Selection (< 200ms latency):")
    print(f"  User Alpha: Tech={u1_tech}, Blended Score={u1_blend:.4f}, Exec Time={u1_ms:.2f}ms")
    print(f"  User Beta:  Tech={u2_tech}, Blended Score={u2_blend:.4f}, Exec Time={u2_ms:.2f}ms")

    assert u1_ms < 200.0, f"Execution latency must be < 200ms (got {u1_ms:.2f}ms)"
    assert u2_ms < 200.0, f"Execution latency must be < 200ms (got {u2_ms:.2f}ms)"

    # 4. User Rating & Personalization Learning
    print(f"\n[Test 4] Simulating User Feedback & Preference Learning:")
    # User Alpha highly rates "breathing_garden" (5 stars)
    score_alpha = preference_learner.record_rating(u1_id, "breathing_garden", "flower_meadow", 5)
    # User Beta highly rates "adaptive_environment" (5 stars)
    score_beta = preference_learner.record_rating(u2_id, "adaptive_environment", "gentle_rain", 5)

    print(f"  User Alpha 'breathing_garden' Decayed Preference Score: {score_alpha:.4f}")
    print(f"  User Beta 'adaptive_environment' Decayed Preference Score: {score_beta:.4f}")

    assert score_alpha > 0.8, "5-star rating should yield high preference score"
    assert score_beta > 0.8, "5-star rating should yield high preference score"

    # 6. Save Intervention & Check Fastest Recovery Analysis in relaxation_intervention
    print(f"\n[Test 6] Saving to relaxation_intervention & Analyzing User Recovery Speed:")
    firebase_service.save_relaxation_intervention(u1_id, "session_test_101", {
        "user_id": u1_id,
        "technique_id": "breathing_garden",
        "recovery_percentage": 100.0,
        "recovery_duration_seconds": 15.0,
        "star_rating": 5
    })

    boosts = firebase_service.get_fastest_recovery_technique_history(u1_id)
    print(f"  User Alpha ({u1_id}) Recovery Speed Boosts: {boosts}")
    assert "breathing_garden" in boosts and boosts["breathing_garden"] > 0, "Fast recovery should yield prior boost for User Alpha"

    print("\n" + "=" * 70)
    print("ALL REAL-TIME ADAPTATION & PERSONALIZATION TESTS PASSED SUCCESSFULLY! [OK]")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()
