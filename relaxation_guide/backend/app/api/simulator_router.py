"""
API Router for Telemetry Simulation and Safety Override Validation (GET /simulate/telemetry, POST /simulate/mode).
"""

from fastapi import APIRouter
from pydantic import BaseModel
from app.models.schemas import TelemetryPayload, ProcessedSignalResult
from app.services.simulator_service import simulator_service
from app.services.missing_value_handler import missing_value_handler

router = APIRouter(tags=["Simulator"])

class ModeRequest(BaseModel):
    mode: str # "normal", "pre-stress", "stress", "safety_override_test"

@router.get("/simulate/telemetry", response_model=TelemetryPayload)
def get_simulated_telemetry(user_id: str = "user_default", dt: float = 0.0):
    """Generates real-time synthetic telemetry payload from Members 1-3."""
    return simulator_service.generate_telemetry(user_id, dt)

@router.post("/simulate/mode")
def set_simulation_mode(req: ModeRequest):
    """Sets simulator state: normal, pre-stress, stress, safety_override_test."""
    simulator_service.set_simulation_mode(req.mode)
    return {"message": f"Simulation mode updated to '{req.mode}'."}

@router.get("/simulate/processed", response_model=ProcessedSignalResult)
def get_processed_simulation(user_id: str = "user_default", dt: float = 0.0):
    """Generates telemetry payload AND processes it through Missing Value Handler & Safety Override immediately."""
    telemetry = simulator_service.generate_telemetry(user_id, dt)
    return missing_value_handler.process_telemetry(telemetry)
