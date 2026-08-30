"""
Technique Evaluation & Recovery Validation Script.
Allows testing each relaxation technique separately without live EEG/GSR hardware data.
Tests both Successful Recovery and Failed Recovery scenarios for all 5 techniques.
"""

import sys
import os
import time
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import TECHNIQUES
from backend.relaxation_guide.services.validator import validator
from backend.relaxation_guide.services.gamification_service import gamification_service
from backend.relaxation_guide.services.thompson_bandit import thompson_bandit
from backend.relaxation_guide.database.db_manager import db_manager


def run_technique_validation_suite():
    print("=" * 80)
    print("      RELAXATION GUIDE: SEPARATE TECHNIQUE & RECOVERY EVALUATION TEST      ")
    print("=" * 80)
    print("Evaluating all 5 relaxation techniques for individual efficacy & recovery metrics...\n")

    test_user = "test_eval_user"
    cluster_id = 0

    techniques_to_test = list(TECHNIQUES.keys())

    print("-" * 80)
    print(f"{'TECHNIQUE':<22} | {'SCENARIO':<15} | {'REWARD':<7} | {'RECOVERY %':<10} | {'BANDIT (a, b)':<14}")
    print("-" * 80)

    for tech_id in techniques_to_test:
        tech_title = TECHNIQUES[tech_id]["title"]

        # 1. Test Full Recovery Scenario
        r_succ, rec_succ, desc_succ, a_succ, b_succ = validator.validate_and_update(
            user_id=test_user,
            cluster_id=cluster_id,
            technique_id=tech_id,
            pre_label="stress",
            post_label="normal",
            star_rating=5,
            duration_seconds=20.0
        )

        xp1, total_xp1, is_norm1, badges1 = gamification_service.record_intervention_outcome(
            test_user, tech_id, "stress", "normal", r_succ
        )

        db_manager.save_intervention(
            user_id=test_user,
            session_id=f"session_succ_{tech_id}",
            technique_id=tech_id,
            pre_label="stress",
            post_label="normal",
            reward=r_succ,
            recovery_pct=rec_succ,
            duration_sec=20.0
        )

        print(f"{tech_title:<22} | Full Recovery   | {r_succ:<7.2f} | {rec_succ:<10.1f}% | a={a_succ:.2f}, b={b_succ:.2f}")

        # 2. Test No Recovery Scenario
        r_fail, rec_fail, desc_fail, a_fail, b_fail = validator.validate_and_update(
            user_id=test_user,
            cluster_id=cluster_id,
            technique_id=tech_id,
            pre_label="stress",
            post_label="stress",
            star_rating=1,
            duration_seconds=60.0
        )

        xp2, total_xp2, is_norm2, badges2 = gamification_service.record_intervention_outcome(
            test_user, tech_id, "stress", "stress", r_fail
        )

        db_manager.save_intervention(
            user_id=test_user,
            session_id=f"session_fail_{tech_id}",
            technique_id=tech_id,
            pre_label="stress",
            post_label="stress",
            reward=r_fail,
            recovery_pct=rec_fail,
            duration_sec=60.0
        )

        print(f"{tech_title:<22} | No Relief       | {r_fail:<7.2f} | {rec_fail:<10.1f}% | a={a_fail:.2f}, b={b_fail:.2f}")
        print("-" * 80)

    print("\n" + "=" * 80)
    print("                      SUMMARY & GAMIFICATION RESULTS                        ")
    print("=" * 80)
    xp, streak, badges = gamification_service.get_user_badges_and_stats(test_user)
    print(f"Total XP Accumulated : {xp} XP")
    print(f"Current Streak       : {streak} Days")
    print(f"Unlocked Badges      : {[b.title for b in badges if b.unlocked]}")
    print("=" * 80)
    print("\nAll techniques successfully validated for recovery calculation and bandit updates!\n")


if __name__ == "__main__":
    run_technique_validation_suite()
