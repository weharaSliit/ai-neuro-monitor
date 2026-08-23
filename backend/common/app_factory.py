import sys

from flask import Flask
from flask_cors import CORS


def create_app(import_name: str) -> Flask:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    app = Flask(import_name)
    CORS(app)
    return app
