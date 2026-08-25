"""
Objective 2 Integration & Handshake Verification Suite
Tests Flask REST API endpoints, One-Class SVM inference engine,
EMA baseline updates, and Ground-Truth EMA Label ingestion.
"""

import sys
import requests
import json
import time

BASE_URL = "http://127.0.0.1:5001"
TEST_USER_ID = "chathurika_001"

def run_tests():
    print("=" * 60)
    print("OBJECTIVE 2 END-TO-END INTEGRATION TEST SUITE")
    print("=" * 60)

    # FIX: previously the closing banner always printed "ALL TESTS PASSED"
    # unconditionally, even when every individual test below failed — each
    # failure was caught and printed as [FAIL], but nothing tracked whether
    # any failure had occurred, so the summary line could never actually
    # report failure. all_passed now tracks real outcome across every test,
    # and the process exits non-zero on failure so this is usable in CI.
    all_passed = True

    # 1. Health Check Endpoint
    print("\n[Test 1] Testing /health endpoint...")
    try:
        r = requests.get(f"{BASE_URL}/health")
        print(f"Status Code: {r.status_code}")
        print(f"Response: {r.json()}")
        assert r.status_code == 200
        print("[OK] Health Check Passed!")
    except Exception as e:
        print(f"[FAIL] Health Check Failed: {e}")
        print("\n" + "=" * 60)
        print("SOME TESTS FAILED — health check must pass before any other")
        print("endpoint can be reached; stopping here.")
        print("=" * 60)
        sys.exit(1)

    # 2. Real-Time Behavioral Feature Vector Prediction (/behavior/predict)
    print("\n[Test 2] Testing /behavior/predict (Inference & EMA Engine)...")
    payload_normal = {
        "user_id": TEST_USER_ID,
        "dwell_times": [180, 195, 205, 190, 210, 185, 200, 192, 198, 202, 188, 194],
        "flight_times": [320, 310, 330, 315, 325, 305, 340, 312, 328, 318, 322, 335],
        "interaction_rate": 2.4,
        "scroll_velocity": 450.0,
        "data_valid": True
    }
    try:
        r = requests.post(f"{BASE_URL}/behavior/predict", json=payload_normal)
        print(f"Status Code: {r.status_code}")
        print(f"Response: {json.dumps(r.json(), indent=2)}")
        assert r.status_code == 200
        print("[OK] Behavioral Prediction Endpoint Passed!")
    except Exception as e:
        print(f"[FAIL] Prediction Endpoint Failed: {e}")
        all_passed = False

    # 3. Ground-Truth EMA Label Ingestion (/behavior/label) - PSS-4 & SISS
    print("\n[Test 3] Testing /behavior/label (Ground-Truth Ingestion)...")
    siss_payload = {
        "user_id": TEST_USER_ID,
        "type": "siss",
        "score": 3,
        "timestamp": "2026-08-03T20:00:00Z"
    }
    pss4_payload = {
        "user_id": TEST_USER_ID,
        "type": "pss4",
        "score": 7,
        "timestamp": "2026-08-03T20:05:00Z"
    }
    try:
        r_siss = requests.post(f"{BASE_URL}/behavior/label", json=siss_payload)
        print(f"SISS Response: {r_siss.json()}")
        assert r_siss.status_code == 200

        r_pss4 = requests.post(f"{BASE_URL}/behavior/label", json=pss4_payload)
        print(f"PSS-4 Response: {r_pss4.json()}")
        assert r_pss4.status_code == 200
        print("[OK] Ground-Truth Ingestion Endpoint Passed!")
    except Exception as e:
        print(f"[FAIL] Ground-Truth Ingestion Failed: {e}")
        all_passed = False

    # 4. Neuroadaptive Bridge Endpoint (/behavior/stress-summary)
    print("\n[Test 4] Testing /behavior/stress-summary (Neuroadaptive Handshake)...")
    try:
        r = requests.get(f"{BASE_URL}/behavior/stress-summary?user_id={TEST_USER_ID}")
        print(f"Status Code: {r.status_code}")
        print(f"Response: {json.dumps(r.json(), indent=2)}")
        assert r.status_code == 200
        print("[OK] Neuroadaptive Bridge Handshake Passed!")
    except Exception as e:
        print(f"[FAIL] Neuroadaptive Bridge Failed: {e}")
        all_passed = False

    print("\n" + "=" * 60)
    if all_passed:
        print("ALL OBJECTIVE 2 INTEGRATION TESTS PASSED SUCCESSFULLY!")
    else:
        print("SOME TESTS FAILED — see [FAIL] lines above.")
    print("=" * 60)

    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    run_tests()
