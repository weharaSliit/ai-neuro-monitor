"""
Forwarder script for User-Wise Real-Time Adaptation Demonstration.
Calls backend/relaxation_guide/demo_user_wise_realtime_adaptation.py.
"""

import sys
import os
from pathlib import Path

repo_root = Path(__file__).resolve().parents[2]
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.relaxation_guide.demo_user_wise_realtime_adaptation import run_user_wise_adaptation_demo

if __name__ == "__main__":
    run_user_wise_adaptation_demo()
