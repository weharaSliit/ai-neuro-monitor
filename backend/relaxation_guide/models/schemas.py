"""
Pydantic data models and schemas for Relaxation Guide API requests, responses, feature structures, and closed-loop personalization.
"""

from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field

class ProbabilityVector(BaseModel):
    stress_probability: float = Field(0.50, ge=0.0, le=1.0, description="Overall fused stress probability (0.0 to 1.0)")

    def to_flat_vector(self) -> List[float]:
        return [self.stress_probability, max(0.0, 1.0 - self.stress_probability)]

class TelemetryPayload(BaseModel):
    user_id: str = Field("user_default", description="Unique identifier for the user")
    timestamp: float = Field(..., description="Current UNIX timestamp in seconds")
    fused_stress_label: str = Field("normal", description="Single fused stress label from multimodal fusion engine: normal or stress")
    stress_probability: float = Field(0.50, ge=0.0, le=1.0, description="Single stress probability score from multimodal fusion engine (0.0 to 1.0)")
    seconds_since_last_packet: float = Field(0.0, description="Seconds elapsed since previous data packet")
    is_calibrated: bool = Field(True, description="True if 2-minute baseline calibration is complete")
    has_live_packet: bool = Field(True, description="True if live telemetry packet exists in current session node")
    user_baseline: Optional[float] = Field(None, description="Personal stress probability baseline from Firebase")

class FusionEngineIngestRequest(BaseModel):
    user_id: str = Field("user_default", description="User ID")
    fused_stress_label: str = Field("normal", description="Single fused stress label from teammate fusion engine (normal or stress)")
    stress_probability: float = Field(0.50, ge=0.0, le=1.0, description="Single stress probability score from teammate fusion engine (0.0 to 1.0)")
    seconds_since_last_packet: float = Field(0.0, description="Elapsed time since previous data packet")
    is_calibrated: bool = Field(True, description="True if 2-minute baseline calibration is complete")
    has_live_packet: bool = Field(True, description="True if live telemetry packet exists in current session node")
    user_baseline: Optional[float] = Field(None, description="Personal stress probability baseline from Firebase")

class ProcessedSignalResult(BaseModel):
    user_id: str
    effective_label: str
    is_safety_override: bool
    is_locf_applied: bool
    is_alert_triggered: bool
    features_flat: List[float]
    message: str
    has_live_packet: bool = True
    user_baseline: Optional[float] = None

class InterventionRequest(BaseModel):
    user_id: str = Field("user_default", description="User ID")
    telemetry: TelemetryPayload

class TechniqueSubOption(BaseModel):
    id: str
    title: str
    description: str

class TechniqueRecommendation(BaseModel):
    technique_id: str
    title: str
    description: str
    selected_sub_option: TechniqueSubOption
    available_sub_options: List[TechniqueSubOption]
    context_cluster_id: int
    blended_score: float
    physiological_sample: float
    preference_score: float
    execution_time_ms: float

class ValidationRequest(BaseModel):
    user_id: str
    technique_id: str
    pre_stress_label: str
    post_stress_label: str
    star_rating: Optional[int] = Field(5, ge=1, le=5, description="User 1 to 5 star feedback rating")
    duration_seconds: Optional[float] = Field(30.0, description="Short-time stress reduction duration in seconds")
    context_cluster_id: Optional[int] = Field(0, description="Context cluster ID (0-9)")

class UserTechniqueRanking(BaseModel):
    technique_id: str
    combined_suitability_score: float
    avg_star_rating: float
    avg_recovery_pct: float
    avg_recovery_seconds: float
    total_sessions_completed: int
    normal_baseline_successes: int

class UserAnalyticsResponse(BaseModel):
    user_id: str
    best_suited_technique_id: str
    rankings: List[UserTechniqueRanking]

class BadgeItem(BaseModel):
    id: str
    title: str
    icon: str
    description: str
    unlocked: bool = False

class ValidationResponse(BaseModel):
    reward: float
    recovery_percentage: float
    transition: str
    alpha_updated: float
    beta_updated: float
    message: str
    xp_earned: int = 0
    total_xp: int = 0
    is_normal_reached: bool = False
    unlocked_badges: List[BadgeItem] = []

class RatingRequest(BaseModel):
    user_id: str
    technique_id: str
    sub_option_id: str
    rating_stars: int = Field(..., ge=1, le=5, description="1 to 5 star user rating")

class RatingResponse(BaseModel):
    normalized_score: float
    decayed_score: float
    message: str

class FallbackRequest(BaseModel):
    user_id: str
    rejected_technique_id: str

class FallbackResponse(BaseModel):
    fallback_level: int
    level1_alternatives: Optional[List[TechniqueRecommendation]] = None
    level2_breathing_reset: Optional[Dict[str, Any]] = None
    level3_prompt_options: Optional[List[Dict[str, str]]] = None

class BanditStateResponse(BaseModel):
    user_id: str
    clusters: Dict[int, Dict[str, Dict[str, float]]]
    preference_history: Dict[str, Any]

class UserProfileResponse(BaseModel):
    user_id: str
    email: str
    full_name: str
    xp_points: int
    streak_days: int
    badges: List[BadgeItem]
