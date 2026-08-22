"""
SAM40 EEG channel layout.

Order taken from data/SAM40/Coordinates.locs, which is the actual recording
order for the 32-channel 'Data' / 'Clean_data' arrays in the .mat files.
This is NOT the same order as DEAP's 32 channels (SAM40 uses FT9/FT10/PO9/PO10
where DEAP uses AF3/AF4, and the ordering differs throughout) -- do not reuse
a DEAP channel list here.
"""

CHANNEL_NAMES = [
    'Cz', 'Fz', 'Fp1', 'F7', 'F3', 'FC1', 'C3', 'FC5',
    'FT9', 'T7', 'CP5', 'CP1', 'P3', 'P7', 'PO9', 'O1',
    'Pz', 'Oz', 'O2', 'PO10', 'P8', 'P4', 'CP2', 'CP6',
    'T8', 'FT10', 'FC6', 'C4', 'FC2', 'F4', 'F8', 'Fp2',
]

CHANNEL_INDEX = {name: i for i, name in enumerate(CHANNEL_NAMES)}

T7_IDX = CHANNEL_INDEX['T7']  # 9
T8_IDX = CHANNEL_INDEX['T8']  # 24

SFREQ = 128  # Hz
TRIAL_SECONDS = 25
TRIAL_SAMPLES = SFREQ * TRIAL_SECONDS  # 3200
