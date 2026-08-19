"""
API Router for AI Chatbot (POST /chat).
"""

from fastapi import APIRouter
from app.models.schemas import ChatRequest, ChatResponse
from app.services.chatbot_service import chatbot_service

router = APIRouter(tags=["AI Chatbot"])

@router.post("/chat", response_model=ChatResponse)
def chat_with_assistant(req: ChatRequest):
    """
    POST /chat
    Provides personalized AI relaxation counseling based on user's message and current stress state.
    """
    res = chatbot_service.generate_response(req.message, req.current_stress_label or "normal")
    return ChatResponse(
        reply=res["reply"],
        suggested_action=res.get("suggested_action")
    )
