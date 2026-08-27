"""
Configuration module for Relaxation Guide (Context-Aware Personalized Closed-Loop Bio-Feedback & Adaptive Neural Stress Intervention System).
Contains constants, weight parameters, safety override thresholds, reward mappings, badge definitions, and technique catalog.
"""
import sys
import os
from pathlib import Path

# Module path fix to support running from any CWD
_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from dotenv import load_dotenv

# Load environment variables from backend/.env file if present
load_dotenv()

# --- General System Config ---
APP_NAME = "Calm AI - Personalized Closed-Loop Stress Intervention System"
VERSION = "3.0.0"
APP_DESCRIPTION = "Context-Aware Personalized Closed-Loop Bio-Feedback & Adaptive Neural Stress Intervention System"

# --- Firebase Config ---
_COMMON_CRED1 = os.path.join(_REPO_ROOT, "backend", "common", "serviceAccountKey.json")
_COMMON_CRED2 = os.path.join(_THIS_DIR, "serviceAccountKey.json")

if os.path.exists(_COMMON_CRED1):
    DEFAULT_CRED = _COMMON_CRED1
elif os.path.exists(_COMMON_CRED2):
    DEFAULT_CRED = _COMMON_CRED2
else:
    DEFAULT_CRED = _COMMON_CRED1

FIREBASE_CRED_FILE = os.getenv("FIREBASE_CRED_FILE", DEFAULT_CRED)
FIREBASE_DB_URL = os.getenv("FIREBASE_DB_URL", "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/")
FIREBASE_NAMESPACE = os.getenv("FIREBASE_NAMESPACE", "")

# --- Probability Vector Constants ---
PROBABILITY_VECTOR_DIM = 2  # 2-element input vector: [stress_probability, 1.0 - stress_probability]

# --- Missing Value Handler Config ---
LOCF_MAX_SECONDS = 3.0           # Apply Last Observation Carried Forward within 3s
NORMAL_ASSUME_MAX_SECONDS = 10.0 # Assume normal state between 3s and 10s
ALERT_TIMEOUT_SECONDS = 10.0     # Trigger system alert after 10s of data loss

# --- Safety Override Thresholds ---
SAFETY_PROBABILITY_THRESHOLD = 0.75 # 75% confidence threshold for safety override

# --- Thompson Sampling & Blending Config ---
NUM_CLUSTERS = 10                # 10 K-Means context clusters
WEIGHT_PHYSIO = 0.70             # 70% weight to bandit physiological sample
WEIGHT_PREF = 0.30              # 30% weight to user preference score

# --- Preference Learner Config ---
DECAY_FACTOR = 0.95              # Daily exponential decay factor
DECAY_HALF_LIFE_DAYS = 7.0       # 7-day half life multiplier

# --- Habituation Penalty Config ---
HABITUATING_USAGE_THRESHOLD = 5  # Max uses allowed in 7 days before penalty
HABITUATING_PENALTY_FACTOR = 0.90 # 10% penalty (multiplier 0.90)

# --- Validator Reward Mapping Matrix ---
REWARD_MATRIX = {
    ("stress", "normal"): 1.0,        # Complete recovery
    ("stress", "stress"): 0.3,        # No change (stressed)
    ("normal", "normal"): 0.3,        # No change (normal)
    ("normal", "stress"): -0.5,       # Deterioration
}

REJECTION_REWARD = -0.5               # Level 1 fallback negative reward penalty

# --- Gamification & Badges Config ---
NORMAL_ACHIEVED_XP = 100
BADGES_CATALOG = [
    {
        "id": "zen_master",
        "title": "Zen Master",
        "icon": "🧘",
        "description": "Completed interventions across all 5 technique categories."
    },
    {
        "id": "vagus_shield",
        "title": "Vagus Shield",
        "icon": "🛡️",
        "description": "Achieved 3 consecutive successful recoveries to Normal state."
    },
    {
        "id": "stress_slayer",
        "title": "Stress Slayer",
        "icon": "⚡",
        "description": "Successfully recovered from acute Safety Override stress."
    },
    {
        "id": "streak_legend",
        "title": "Streak Legend",
        "icon": "🔥",
        "description": "Maintained a 5-day continuous relaxation streak."
    },
    {
        "id": "recovery_champ",
        "title": "100% Recovery Champion",
        "icon": "🏆",
        "description": "Achieved 100% complete stress recovery."
    }
]

# --- 9-Technique Catalog (3 Categories x 3 Sub-Techniques Each) ---
TECHNIQUES = {
    "guided_meditation": {
        "id": "guided_meditation",
        "title": "Guided Meditation & Breathwork",
        "description": "Mindfulness practice, structured box breathing, acoustic frequency alignment, and silent meditation timers.",
        "sub_options": [
            {"id": "box_meditation", "title": "Box Meditation", "description": "Structured 4-4-4-4 visual and auditory breathing rhythm for rapid vagal nerve activation."},
            {"id": "chakra_harmonizer", "title": "Chakra Harmonizer", "description": "432Hz & 528Hz acoustic harmonic frequency alignment for neural synchronization."},
            {"id": "silent_zen_timer", "title": "Silent Zen Timer", "description": "Minimalist open monitoring meditation timer with periodic singing bowl cues."}
        ]
    },
    "breathing_garden": {
        "id": "breathing_garden",
        "title": "Breathing Garden",
        "description": "Gamified physiological pacing exercises guided by interactive organic nature animations.",
        "sub_options": [
            {"id": "flower_meadow", "title": "Flower Meadow", "description": "Interactive flower blooming matched to 4-7-8 parasympathetic breathing cycles."},
            {"id": "water_lily_pond", "title": "Water Lily Pond", "description": "Expanding water lily blooms synchronized with diaphragmatic exhalations."},
            {"id": "cosmic_nebula", "title": "Cosmic Nebula", "description": "Starlight galaxy expansion pacing slow 6-breaths-per-minute resonance."}
        ]
    },
    "cognitive_destress": {
        "id": "cognitive_destress",
        "title": "Cognitive De-Stress Arcade",
        "description": "Tactile micro-interventions designed to disrupt active cognitive stress loops and release tension.",
        "sub_options": [
            {"id": "muscle", "title": "Progressive Muscle Relaxation", "description": "Tense & release muscle cycling for physical tension discharge and vagal nerve activation."},
            {"id": "pattern", "title": "Pattern Alignment", "description": "Visuospatial working memory color matching to disrupt intrusive rumination loops."},
            {"id": "nature", "title": "Soft Fascination Viewing", "description": "Passive nature restoration viewing asking nothing of directed attention."}
        ]
    }
}
