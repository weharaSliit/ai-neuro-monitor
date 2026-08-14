
import os

#Dataset paths
WESAD_PATH   = r"C:\Users\weha1\datasets\WESAD"

# SWELL
SWELL_BASE    = r"C:\Users\weha1\datasets\SWELL\archive\hrv dataset"
SWELL_TRAIN   = r"C:\Users\weha1\datasets\SWELL\archive\hrv dataset\data\final\train.csv"
SWELL_TEST    = r"C:\Users\weha1\datasets\SWELL\archive\hrv dataset\data\final\test.csv"
SWELL_LABELS  = r"C:\Users\weha1\datasets\SWELL\archive\hrv dataset\data\raw\labels\hrv stress labels.xlsx"
SWELL_RRI_DIR = r"C:\Users\weha1\datasets\SWELL\archive\hrv dataset\data\raw\rri"

# Component paths 
REPO_PATH      = r"C:\Users\weha1\OneDrive\Documents\ResearchCode\ai-neuro-monitor"
COMPONENT_PATH = os.path.join(REPO_PATH, "physiological_signals")
RESULTS_PATH   = os.path.join(COMPONENT_PATH, "results")
MODELS_PATH    = os.path.join(COMPONENT_PATH, "saved_models")

# WESAD subject IDs 
WESAD_SUBJECT_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17]

#  Signal parameters 
WESAD_CHEST_FS     = 700   # Hz
WESAD_WRIST_BVP_FS = 64    # Hz
WESAD_WRIST_EDA_FS = 4     # Hz

#  Window parameters 
WINDOW_SEC   = 60    # seconds
OVERLAP      = 0.5   # 50%
STEP_SEC     = 30    # seconds

#  Label boundary parameters
BOUNDARY_EXCLUSION_SEC   = 30   # ±30s around transitions = exclude

print("Config loaded successfully")