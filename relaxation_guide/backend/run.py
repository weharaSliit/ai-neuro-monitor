"""
Forwarder script for Relaxation Guide backend server.
Launches unified Flask backend app in backend/relaxation_guide.
"""

import sys
import os
from pathlib import Path

repo_root = Path(__file__).resolve().parents[2]
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from backend.relaxation_guide.app import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)

