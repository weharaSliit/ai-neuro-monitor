"""
API Router for Smart Suitability Checking (POST /suitability/check).
"""

from fastapi import APIRouter
from pydantic import BaseModel
from app.services.suitability_checker import suitability_checker

router = APIRouter(tags=["Suitability Check"])

class SuitabilityCheckRequest(BaseModel):
    user_id: str = "user_default"
    technique_id: str
    current_stress_label: str = "normal"
    stress_probability: float = 0.5

@router.post("/suitability/check")
def check_technique_suitability(req: SuitabilityCheckRequest):
    """
    POST /suitability/check
    Checks if a selected technique is optimal for the user's live stress state and probability scores.
    """
    return suitability_checker.check_suitability(
        req.user_id, req.technique_id, req.current_stress_label, req.stress_probability
    )
