"""
API Router for Multimodal Fusion Engine Telemetry Ingestion (POST /telemetry/ingest, GET /telemetry/fusion-output).
Ingests single fused_stress_label and stress_probability received from teammates' multimodal data fusion engine.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
from app.models.schemas import TelemetryPayload, ProcessedSignalResult, FusionEngineIngestRequest
from app.services.telemetry_aggregator import telemetry_aggregator
from app.services.missing_value_handler import missing_value_handler

router = APIRouter(tags=["Telemetry Ingestion"])

@router.post("/telemetry/ingest", response_model=ProcessedSignalResult)
def ingest_fusion_engine_telemetry(req: FusionEngineIngestRequest):
    """
    POST /telemetry/ingest
    Accepts single fused_stress_label and stress_probability outputs from teammates' multimodal data fusion engine,
    and passes them through MVH & Safety Override.
    """
    telemetry_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=req.user_id,
        fused_stress_label=req.fused_stress_label,
        stress_probability=req.stress_probability,
        seconds_since_last_packet=req.seconds_since_last_packet
    )
    return missing_value_handler.process_telemetry(telemetry_payload)

@router.get("/telemetry/fusion-output", response_model=ProcessedSignalResult)
@router.get("/telemetry/local-files", response_model=ProcessedSignalResult)
def read_and_process_fusion_output(user_id: str = "user_default"):
    """
    GET /telemetry/fusion-output (alias GET /telemetry/local-files)
    Reads teammate multimodal fusion engine output file, extracts single fused_stress_label and stress_probability, and processes MVH.
    """
    fusion_data = telemetry_aggregator.read_fusion_engine_output()
    fused_lbl = fusion_data.get("fused_stress_label", fusion_data.get("label", "normal"))
    stress_prob = float(fusion_data.get("stress_probability", fusion_data.get("probability", 0.50)))

    telemetry_payload = telemetry_aggregator.parse_fusion_payload(
        user_id=user_id,
        fused_stress_label=fused_lbl,
        stress_probability=stress_prob,
        seconds_since_last_packet=0.0
    )
    return missing_value_handler.process_telemetry(telemetry_payload)

