import firebase_admin
from firebase_admin import credentials, db

from backend.common.config import FIREBASE_CRED_FILE, FIREBASE_DB_URL, FIREBASE_NAMESPACE


def _ref(path: str):
    clean_path = str(path).lstrip('/')
    if not FIREBASE_NAMESPACE:
        return db.reference(clean_path)
    return db.reference(f"{FIREBASE_NAMESPACE}/{clean_path}")


cred = credentials.Certificate(FIREBASE_CRED_FILE)
firebase_admin.initialize_app(cred, {
    'databaseURL': FIREBASE_DB_URL
})

ref = _ref('test')
ref.set({'hello': 'world'})
print("Firebase write successful ✓")