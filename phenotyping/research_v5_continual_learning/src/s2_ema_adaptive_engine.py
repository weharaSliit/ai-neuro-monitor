#(Continuous baseline updates)

class EMAAdaptiveEngine:
    """
    Formula: mu_new = alpha * x_current + (1 - alpha) * mu_old
    Alpha (Smoothing factor): 0.1 (updates slowly to ensure stability)
    """
    def __init__(self, initial_baseline, alpha=0.1):
        self.means = initial_baseline['means']
        self.stds = initial_baseline['stds']
        self.alpha = alpha

    def update_baseline(self, daily_df, feature_cols, is_stress_day=False):
        # PROTECTIVE LOGIC: Do not update baseline on days with stress alerts
        if is_stress_day:
            print("🛑 [S2] Stress detected today. Baseline update suspended to prevent contamination.")
            return

        for col in feature_cols:
            daily_avg = daily_df[col].mean()
            daily_std = daily_df[col].std()
            
            # EMA Update
            self.means[col] = (self.alpha * daily_avg) + (1 - self.alpha) * self.means[col]
            self.stds[col] = (self.alpha * daily_std) + (1 - self.alpha) * self.stds[col]
        
        print("🔄 [S2] Baseline successfully adapted to today's behavioral rhythms.")

    def get_z_score(self, value, feature_name):
        mu = self.means.get(feature_name, 0)
        sigma = self.stds.get(feature_name, 1e-6)
        return (value - mu) / sigma