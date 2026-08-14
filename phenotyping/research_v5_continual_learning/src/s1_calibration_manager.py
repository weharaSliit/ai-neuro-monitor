#(Logic for the 7-day baseline)

import numpy as np
import pandas as pd
import datetime

class CalibrationManager:
    """
    Implements Research Gap 3: Calibration Period.
    Ensures the model doesn't alert until a stable 7-day 'Normal' 
    baseline is established.
    """
    def __init__(self, target_days=7, min_samples_per_day=50):
        self.target_days = target_days
        self.min_samples = min_samples_per_day
        self.daily_counts = {}
        self.is_calibrated = False

    def track_progress(self, timestamp, sample_count):
        # Convert timestamp to date string
        date_key = datetime.datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d')
        self.daily_counts[date_key] = self.daily_counts.get(date_key, 0) + sample_count
        
        # Check if enough days have passed with sufficient data
        valid_days = [d for d, count in self.daily_counts.items() if count >= self.min_samples]
        
        if len(valid_days) >= self.target_days:
            self.is_calibrated = True
            return True, len(valid_days)
        return False, len(valid_days)

    def calculate_initial_baseline(self, calibration_df, feature_cols):
        """Calculates the first Mean and StdDev after 7 days."""
        print(f"📈 [S1] Calibration Complete. Calculating initial baseline...")
        baseline = {
            'means': calibration_df[feature_cols].mean().to_dict(),
            'stds': calibration_df[feature_cols].std().replace(0, 1e-6).to_dict()
        }
        return baseline