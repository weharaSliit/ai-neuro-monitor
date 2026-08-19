"""
K-Means Context Clusterer Service.
Clusters single stress probability values [stress_probability, 1.0 - stress_probability] into 1 of 10 context clusters.
"""

import numpy as np
from typing import List
from app.config import NUM_CLUSTERS, PROBABILITY_VECTOR_DIM

class KMeansClusterer:
    def __init__(self, n_clusters: int = NUM_CLUSTERS, feature_dim: int = PROBABILITY_VECTOR_DIM):
        self.n_clusters = n_clusters
        self.feature_dim = feature_dim
        
        # Initialize 10 structured cluster centroids across stress probability space [0.0 to 1.0]
        # Cluster 0 = Acute Stress Intensity (1.0) -> Cluster 9 = Deep Calm Intensity (0.0)
        centers = []
        for i in range(self.n_clusters):
            stress_prob = max(0.05, 0.95 - (i * 0.10)) # 0.95 (Cluster 0 acute stress) to 0.05 (Cluster 9 calm)
            cluster_vector = np.array([stress_prob, max(0.0, 1.0 - stress_prob)])
            centers.append(cluster_vector)
            
        self.cluster_centers = np.array(centers)

    def predict_cluster(self, features_flat: List[float]) -> int:
        """
        Assigns a stress probability vector to the nearest of 10 K-Means context cluster centroids.
        Calculates Euclidean distance efficiently. Execution time is < 1 millisecond.
        """
        vec = np.array(features_flat[:self.feature_dim])
        if len(vec) < self.feature_dim:
            vec = np.pad(vec, (0, self.feature_dim - len(vec)), 'constant')
            
        distances = np.linalg.norm(self.cluster_centers - vec, axis=1)
        cluster_id = int(np.argmin(distances))
        return cluster_id

# Global instance
kmeans_clusterer = KMeansClusterer()
