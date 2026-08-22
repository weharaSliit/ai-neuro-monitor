"""
FastAPI Main Application Entry Point for Calm AI.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import APP_NAME, VERSION, APP_DESCRIPTION
from app.api import (
    intervention_router,
    validate_router,
    bandit_router,
    chatbot_router,
    auth_router,
    suitability_router,
    telemetry_router
)

app = FastAPI(
    title=APP_NAME,
    version=VERSION,
    description=APP_DESCRIPTION
)

# Configure CORS for Expo Mobile App & React Native Web
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(intervention_router.router)
app.include_router(validate_router.router)
app.include_router(bandit_router.router)
app.include_router(chatbot_router.router)
app.include_router(auth_router.router)
app.include_router(suitability_router.router)
app.include_router(telemetry_router.router)

@app.get("/")
def root_status():
    return {
        "status": "online",
        "app": APP_NAME,
        "version": VERSION,
        "description": APP_DESCRIPTION,
        "docs_url": "/docs"
    }
