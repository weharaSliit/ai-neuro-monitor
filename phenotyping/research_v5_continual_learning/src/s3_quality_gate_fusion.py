#(Context & App category filtering)


class QualityGateFusion:
    """
    Research Novelty: Physical Noise Gate & App Context Filter.
    Ensures keystroke timing is only processed during mental work.
    """
    def __init__(self):
        self.valid_apps = ['productivity', 'communication', 'email', 'system']
        self.min_stationary_ratio = 0.85

    def is_data_valid(self, activity_state, app_category):
        # 1. Physical Noise Gate (0 = Stationary in StudentLife)
        is_stationary = (activity_state == 0)
        
        # 2. App Context Filter
        is_valid_context = app_category.lower() in self.valid_apps
        
        if is_stationary and is_valid_context:
            return True, "CLEAN_DATA"
        elif not is_stationary:
            return False, "REJECTED_PHYSICAL_NOISE"
        else:
            return False, "REJECTED_CONTEXT_MISMATCH"