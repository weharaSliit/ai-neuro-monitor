"""
Configuration module for Calm AI (Context-Aware Personalized Closed-Loop Bio-Feedback & Adaptive Neural Stress Intervention System).
Contains constants, weight parameters, safety override thresholds, reward mappings, badge definitions, and technique catalog.
"""
import sys
import os

# Add the project root directory (one level up from backend) to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from dotenv import load_dotenv

# Load environment variables from backend/.env file if present
load_dotenv()

# --- General System Config ---
APP_NAME = "Calm AI - Context-Aware Personalized Closed-Loop Stress System"
VERSION = "3.0.0"
APP_DESCRIPTION = "Context-Aware Personalized Closed-Loop Bio-Feedback & Adaptive Neural Stress Intervention System"

# --- SMTP / Email Delivery Config ---
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", "noreply@caps-research.org")

# --- Firebase Config ---
_CONFIG_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_CONFIG_DIR)
_ROOT_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "../../"))
_COMMON_CRED1 = os.path.join(_ROOT_DIR, "backend", "common", "serviceAccountKey.json")
_COMMON_CRED2 = os.path.join(_BACKEND_DIR, "serviceAccountKey.json")

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
    ("stress", "pre-stress"): 0.7,    # Partial recovery
    ("pre-stress", "normal"): 0.6,    # Good early intervention
    ("stress", "stress"): 0.3,        # No change (stressed)
    ("pre-stress", "pre-stress"): 0.3, # No change (pre-stressed)
    ("normal", "normal"): 0.3,        # No change (normal)
    ("normal", "pre-stress"): -0.3,   # Mild deterioration
    ("normal", "stress"): -0.5,       # Severe deterioration
    ("pre-stress", "stress"): -0.3,   # Moderate deterioration
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

# --- Relaxation Techniques Catalog ---
TECHNIQUES = {
    "guided_meditation": {
        "id": "guided_meditation",
        "title": "Guided Meditation & Breathwork",
        "description": "Simple breathing and mindfulness exercises to calm your mind.",
        "sub_options": [
            {"id": "water_lily_pond", "title": "Lily Pond Breathing", "description": "Relaxing water lily blooms synced to deep breathing."},
            {"id": "vagus_humming", "title": "Humming Exhale", "description": "Soothing humming exhalations to quickly lower stress."},
            {"id": "diaphragmatic_pace", "title": "Deep Belly Breathing", "description": "Slow, deep abdominal breathing for fast relaxation."},
            {"id": "box_meditation", "title": "Box Breathing", "description": "4-4-4-4 breathing rhythm to restore balance."}
        ]
    },
    "breathing_garden": {
        "id": "breathing_garden",
        "title": "Breathing Garden",
        "description": "Visual breathing pacing guided by soothing nature animations.",
        "sub_options": [
            {"id": "flower_meadow", "title": "Flower Meadow", "description": "Blooming flowers matched to 4-7-8 breathing."},
            {"id": "cosmic_nebula", "title": "Cosmic Nebula", "description": "Starlight pulse for calm, rhythmic breathing."}
        ]
    },
    "cognitive_destress": {
        "id": "cognitive_destress",
        "title": "Cognitive De-Stress",
        "description": "Quick mini-games and exercises to break stress loops.",
        "sub_options": [
            {"id": "soft_fascination", "title": "Nature Scenery", "description": "Calming nature visuals for instant mental rest."},
            {"id": "progressive_muscle", "title": "Muscle Release", "description": "Simple tense-and-release exercises to drop tension."},
            {"id": "guided_imagery", "title": "Forest Walk", "description": "Peaceful forest walk for stress relief."},
            {"id": "pattern_alignment", "title": "Memory Match", "description": "Fun pattern matching game to clear your head."}
        ]
    }
}
