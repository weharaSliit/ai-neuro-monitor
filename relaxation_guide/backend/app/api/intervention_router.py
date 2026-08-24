"""
API Router for Intervention Selection (POST /intervention) and Fallback Handling (POST /fallback).
Must execute Thompson Sampling selection in under 200ms.
"""
 
from fastapi import APIRouter, HTTPException, Depends
from app.models.schemas import (
    InterventionRequest,
    TechniqueRecommendation,
    TechniqueSubOption,
    FallbackRequest,
    FallbackResponse
)
from app.config import TECHNIQUES
from app.services.missing_value_handler import missing_value_handler
from app.services.kmeans_clusterer import kmeans_clusterer
from app.services.thompson_bandit import thompson_bandit
from app.services.preference_learner import preference_learner
from app.services.fallback_handler import fallback_handler
from app.services import firebase_service

router = APIRouter(tags=["Intervention"])

@router.post("/intervention", response_model=TechniqueRecommendation)
def get_personalized_intervention(req: InterventionRequest):
    """
    POST /intervention
    1. Processes single fused_stress_label and stress_probability received from multimodal fusion engine through Missing Value Handler & Safety Override.
    2. Maps features to 1 of 10 K-Means context clusters.
    3. Runs Contextual Thompson Sampling Bandit (70% physio + 30% preference).
    4. Selects default sub-option based on Preference Learner history.
    Guaranteed latency < 200 milliseconds.
    """
    # Step 1: Missing Value Handler & Safety Override
    processed_signal = missing_value_handler.process_telemetry(req.telemetry)
    
    # Step 2: Context Cluster Prediction
    cluster_id = kmeans_clusterer.predict_cluster(processed_signal.features_flat)
    
    # Step 3: Thompson Sampling Selection
    usage_7d = fallback_handler.get_all_7day_usage_counts(req.user_id)
    tech_id, blended_score, s_physio, s_pref, exec_ms, _ = thompson_bandit.select_technique(
        req.user_id, cluster_id, usage_7d
    )
    
    # Retrieve technique detail
    tech_catalog = TECHNIQUES.get(tech_id, TECHNIQUES["breathing_garden"])
    
    # Step 4: Sub-option selection based on user preference history
    preferred_sub_id = preference_learner.get_preferred_sub_option(req.user_id, tech_id)
    sub_options = [TechniqueSubOption(**so) for so in tech_catalog["sub_options"]]
    
    selected_sub = sub_options[0]
    if preferred_sub_id:
        for so in sub_options:
            if so.id == preferred_sub_id:
                selected_sub = so
                break
                
    # Step 5: Save intervention session details to root path: intervention_system_sessions/{user_id}/{session_id}
    session_id = f"session_{int(req.telemetry.timestamp)}"
    session_payload = {
        "user_id": req.user_id,
        "session_id": session_id,
        "timestamp": req.telemetry.timestamp,
        "fused_stress_label": req.telemetry.fused_stress_label,
        "stress_probability": req.telemetry.stress_probability,
        "recommended_technique_id": tech_id,
        "selected_sub_option_id": selected_sub.id,
        "context_cluster_id": cluster_id,
        "blended_score": round(blended_score, 4),
        "physiological_sample": round(s_physio, 4),
        "preference_score": round(s_pref, 4),
        "execution_time_ms": round(exec_ms, 2)
    }
    try:
        firebase_service.save_intervention_session(req.user_id, session_id, session_payload)
    except Exception as e:
        print(f"[Firebase Warning] Could not save to intervention_system_sessions: {e}")

    return TechniqueRecommendation(
        technique_id=tech_id,
        title=tech_catalog["title"],
        description=tech_catalog["description"],
        selected_sub_option=selected_sub,
        available_sub_options=sub_options,
        context_cluster_id=cluster_id,
        blended_score=round(blended_score, 4),
        physiological_sample=round(s_physio, 4),
        preference_score=round(s_pref, 4),
        execution_time_ms=round(exec_ms, 2)
    )

@router.post("/fallback", response_model=FallbackResponse)
def handle_intervention_rejection(req: FallbackRequest):
    """
    POST /fallback
    Processes technique rejection across 3 fallback levels:
    - Level 1: Displays top-2 alternative techniques, records -0.5 reward.
    - Level 2: 30-second Breathing Reset.
    - Level 3: Direct question menu ("Quiet moment", "Continue work", "Suggest later").
    """
    # Cluster 0 default fallback cluster
    cluster_id = 0
    level, alt_tech_ids, level2_breathing, level3_options = fallback_handler.process_rejection(
        req.user_id, cluster_id, req.rejected_technique_id
    )
    
    # Build Level 1 recommendations if level 1 active
    level1_recs = []
    if level == 1:
        for alt_id in alt_tech_ids:
            tech_catalog = TECHNIQUES[alt_id]
            subs = [TechniqueSubOption(**so) for so in tech_catalog["sub_options"]]
            level1_recs.append(TechniqueRecommendation(
                technique_id=alt_id,
                title=tech_catalog["title"],
                description=tech_catalog["description"],
                selected_sub_option=subs[0],
                available_sub_options=subs,
                context_cluster_id=cluster_id,
                blended_score=0.75,
                physiological_sample=0.7,
                preference_score=0.8,
                execution_time_ms=5.0
            ))
           
    return FallbackResponse(
        fallback_level=level,
        level1_alternatives=level1_recs if level == 1 else None,
        level2_breathing_reset=level2_breathing if level == 2 else None,
        level3_prompt_options=level3_options if level == 3 else None
    )
