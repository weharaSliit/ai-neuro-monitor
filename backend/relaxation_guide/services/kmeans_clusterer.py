"""
K-Means Context Clusterer for Relaxation Guide.

The clusters are learned from data, not placed by hand: experiments/train_context_kmeans.py fits
K-means on the person-relative context vectors [z_rel, slope, physio, pheno, disagreement],
chooses k with silhouette / Davies-Bouldin / bootstrap stability, and stores the standardised
centroids in models/kmeans_context.json. This module only loads that model and assigns clusters.

If the model file is missing (or a caller only knows one stress score), it falls back to a
transparent rule so the service still runs.
"""

import sys
import json
from pathlib import Path
from typing import List, Optional, Sequence

import numpy as np

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import NUM_CLUSTERS, CONTEXT_FEATURE_DIM
from backend.relaxation_guide.services.context_builder import default_context_vector

MODEL_PATH = _THIS_DIR.parent / "models" / "kmeans_context.json"


class KMeansClusterer:
    def __init__(self, model_path: Path = MODEL_PATH):
        self.model_path = Path(model_path)
        self.centroids: Optional[np.ndarray] = None   # standardised space
        self.mean = np.zeros(CONTEXT_FEATURE_DIM)
        self.std = np.ones(CONTEXT_FEATURE_DIM)
        self.k = NUM_CLUSTERS
        self.is_trained = False
        self._load()

    def _load(self) -> None:
        try:
            with open(self.model_path, "r", encoding="utf-8") as f:
                m = json.load(f)
            self.centroids = np.array(m["centroids"], dtype=float)
            self.mean = np.array(m["mean"], dtype=float)
            self.std = np.where(np.array(m["std"], dtype=float) < 1e-9, 1.0, np.array(m["std"], dtype=float))
            self.k = int(m["k"])
            self.is_trained = True
        except (OSError, KeyError, ValueError, json.JSONDecodeError):
            self.is_trained = False

    def predict_cluster(self, features: Sequence[float]) -> int:
        """Accepts the 5-d context vector, or the legacy [stress, 1-stress] pair."""
        vec = [float(v) for v in features]
        if len(vec) != CONTEXT_FEATURE_DIM:
            vec = default_context_vector(vec[0] if vec else 0.5)
        if not self.is_trained:
            return self._fallback_cluster(vec)
        x = (np.array(vec) - self.mean) / self.std
        return int(np.argmin(np.linalg.norm(self.centroids - x, axis=1)))

    def _fallback_cluster(self, vec: List[float]) -> int:
        """No trained model: bin the person-relative level (z) into NUM_CLUSTERS equal ranges."""
        z = min(3.0, max(-1.0, vec[0]))
        return int((z + 1.0) / 4.0 * (NUM_CLUSTERS - 1e-9))


kmeans_clusterer = KMeansClusterer()
