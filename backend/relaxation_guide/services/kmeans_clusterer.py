"""
K-Means Context Clusterer Service for Relaxation Guide.
"""

import sys
import numpy as np
from typing import List
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import NUM_CLUSTERS, PROBABILITY_VECTOR_DIM


class KMeansClusterer:
    def __init__(self, n_clusters: int = NUM_CLUSTERS, feature_dim: int = PROBABILITY_VECTOR_DIM):
        self.n_clusters = n_clusters
        self.feature_dim = feature_dim

        centers = []
        for i in range(self.n_clusters):
            stress_prob = max(0.05, 0.95 - (i * 0.10))
            cluster_vector = np.array([stress_prob, max(0.0, 1.0 - stress_prob)])
            centers.append(cluster_vector)

        self.cluster_centers = np.array(centers)

    def predict_cluster(self, features_flat: List[float]) -> int:
        vec = np.array(features_flat[:self.feature_dim])
        if len(vec) < self.feature_dim:
            pad = np.zeros(self.feature_dim - len(vec))
            vec = np.concatenate([vec, pad])

        distances = np.linalg.norm(self.cluster_centers - vec, axis=1)
        return int(np.argmin(distances))


kmeans_clusterer = KMeansClusterer()
