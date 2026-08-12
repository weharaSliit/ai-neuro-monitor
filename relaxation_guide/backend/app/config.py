"""
Configuration module for Calm AI (Context-Aware Personalized Closed-Loop Bio-Feedback & Adaptive Neural Stress Intervention System).
Contains constants, weight parameters, safety override thresholds, reward mappings, badge definitions, and technique catalog.
"""

import os
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

# --- Expanded 25-Game & Meditation Technique Catalog (5 Categories) ---
TECHNIQUES = {
    "guided_meditation": {
        "id": "guided_meditation",
        "title": "Guided Meditation & Breathwork",
        "description": "Immersive mindfulness sessions, box breathing, 432Hz chakra harmonics, and deep meditation timers.",
        "sub_options": [
            {"id": "box_meditation", "title": "Box Meditation", "description": "Structured 4-4-4-4 visual pacing for rapid autonomic calm."},
            {"id": "zen_body_scan", "title": "Zen Body Scan", "description": "Mindful muscle relaxation with expanding aura visuals."},
            {"id": "chakra_meditation", "title": "Chakra Harmonizer", "description": "432Hz & 528Hz frequency alignment for deep mental focus."},
            {"id": "transcendental_mind", "title": "Silent Zen Timer", "description": "Minimalist meditation timer with periodic singing bowl bells."},
            {"id": "sound_meditation", "title": "Acoustic Meditation", "description": "Resonant soundscape meditation for effortless presence."}
        ]
    },
    "focus_arcade": {
        "id": "focus_arcade",
        "title": "Focus & Flow Arcade",
        "description": "High-engagement, focus-inducing mini games engineered to replace stress loops with deep flow state.",
        "sub_options": [
            {"id": "zen_runner", "title": "Zen Wave Runner", "description": "2D rhythmic obstacle runner requiring sharp focus and crystal collection."},
            {"id": "lumina_blade", "title": "Lumina Stress Slicer", "description": "Swipe-to-slice stress orbs into particle bursts with slice combos."},
            {"id": "orb_defense", "title": "Aura Shield Defender", "description": "360-degree shield defender deflecting incoming tension asteroids."},
            {"id": "pattern_matrix", "title": "Mindful Pattern Matrix", "description": "High-concentration grid memory puzzle forcing complete cognitive focus."},
            {"id": "gravity_flow", "title": "Cosmic Gravity Shift", "description": "Physics timing game steering energy orbs through winding galaxy paths."}
        ]
    },
    "adaptive_environment": {
        "id": "adaptive_environment",
        "title": "Adaptive Environment",
        "description": "Dynamic sensory scenes that adapt colors, sounds, and visuals to soothe your nervous system.",
        "sub_options": [
            {"id": "rain_scene", "title": "Rain Scene", "description": "Calming raindrop acoustics and interactive touch ripples."},
            {"id": "forest_scene", "title": "Forest Scene", "description": "Gentle forest canopy with glowing fireflies touch interaction."},
            {"id": "ocean_scene", "title": "Ocean Scene", "description": "Rhythmic sea tides sync'd with soft bubble acoustics."},
            {"id": "sunset_glow", "title": "Sunset Glow", "description": "Warm dusk horizon color transitions for circadian calming."},
            {"id": "mountain_breeze", "title": "Mountain Breeze", "description": "Crisp mountain wind flows reacting to touch orientation."}
        ]
    },
    "breathing_garden": {
        "id": "breathing_garden",
        "title": "Breathing Garden",
        "description": "Gamified pacing exercises guided by nature blooming animations.",
        "sub_options": [
            {"id": "flower_meadow", "title": "Flower Meadow", "description": "Interactive flower blooming matched to 4-7-8 breathing cycles."},
            {"id": "zen_rock_garden", "title": "Zen Rock Garden", "description": "Rake zen sand patterns and stack balancing stones."},
            {"id": "water_lily_pond", "title": "Water Lily Pond", "description": "Expand floating water lilies through deep exhalations."},
            {"id": "cosmic_nebula", "title": "Cosmic Nebula", "description": "Starlight galaxy expansion sync'd to slow 6s breathing."},
            {"id": "crystal_cave", "title": "Crystal Cave", "description": "Resonant crystal pulses illuminating calm neural pathways."}
        ]
    },
    "cognitive_destress": {
        "id": "cognitive_destress",
        "title": "Cognitive De-Stress Arcade",
        "description": "Interactive tactile mini-games designed to interrupt ruminative stress loops.",
        "sub_options": [
            {"id": "bubble_pop", "title": "Zen Bubble Pop", "description": "Satisfying tactile bubble popping to release muscle tension."},
            {"id": "pattern_align", "title": "Pattern Alignment", "description": "Mindful geometric alignment guiding focused presence."},
            {"id": "stress_shatter", "title": "Stress Release Shatter", "description": "Touch-to-shatter glass physics dumping pent-up mental stress."},
            {"id": "cloud_float", "title": "Cloud Floating", "description": "Steer soft drifting clouds through calm azure skies."},
            {"id": "sand_drop", "title": "Cascade Sand", "description": "Flowing colorful sand physics providing hypnotic focus."}
        ]
    }
}
