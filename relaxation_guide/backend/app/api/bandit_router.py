"""
API Router for Bandit State Retrieval (GET /bandit/{user_id}).
Exposes current Beta(alpha, beta) parameters across all 10 context clusters and user preference history.
"""

from fastapi import APIRouter
from app.models.schemas import BanditStateResponse
from app.services.thompson_bandit import thompson_bandit
from app.services.preference_learner import preference_learner
from app.database.db_manager import db_manager

router = APIRouter(tags=["Bandit State"])

@router.get("/bandit/{user_id}", response_model=BanditStateResponse)
def get_bandit_state(user_id: str):
    """
    GET /bandit/{user_id}
    Retrieves current Thompson Bandit parameters across all 10 context clusters and user preference learner state.
    """
    bandit_clusters = thompson_bandit.get_user_bandit_state(user_id)
    pref_summary = preference_learner.get_user_preference_summary(user_id)
    history = db_manager.get_intervention_history(user_id, limit=10)
    
    return BanditStateResponse(
        user_id=user_id,
        clusters=bandit_clusters,
        preference_history={
            "summary": pref_summary,
            "recent_interventions": history
        }
    )
