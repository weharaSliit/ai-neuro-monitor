"""
Contextual Thompson Sampling Bandit Service for Relaxation Guide.
"""

import sys
import time
import numpy as np
from typing import Dict, Tuple, List, Optional
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.relaxation_guide.config import TECHNIQUES, WEIGHT_PHYSIO, WEIGHT_PREF, HABITUATING_PENALTY_FACTOR, HABITUATING_USAGE_THRESHOLD
from backend.relaxation_guide.services.preference_learner import preference_learner
from backend.relaxation_guide.database.db_manager import db_manager
from backend.relaxation_guide.services import firebase_service
from backend.relaxation_guide.services.contextual_policy import ContextualPolicy


class ThompsonBandit:
    def __init__(self):
        self._user_distributions: Dict[str, Dict[int, Dict[str, Dict[str, float]]]] = {}
        self._policies: Dict[str, ContextualPolicy] = {}
        self._pending_context: Dict[str, Dict[str, Dict]] = {}   # user -> session -> {cluster_id, vector}
        self._last_selection: Dict[str, Dict] = {}

    # ---------- contextual policy (continuous context + adaptive habituation) ----------
    def get_policy(self, user_id: str) -> ContextualPolicy:
        if user_id not in self._policies:
            saved = firebase_service.get_policy_state(user_id)
            arms = list(TECHNIQUES.keys())
            policy = None
            if saved and saved.get("arms"):
                try:
                    policy = ContextualPolicy.from_dict(saved)
                    for a in arms:   # techniques added after the state was saved
                        if a not in policy.linear:
                            policy = None
                            break
                except Exception as e:
                    print(f"[Policy Warning] Could not restore policy state ({e}); starting fresh.")
                    policy = None
            self._policies[user_id] = policy or ContextualPolicy(arms)
        return self._policies[user_id]

    def remember_context(self, user_id: str, session_id: str, cluster_id: int, vector, technique_id: str) -> None:
        sessions = self._pending_context.setdefault(user_id, {})
        sessions[session_id] = {"cluster_id": cluster_id, "vector": list(vector), "technique_id": technique_id}
        sessions["_latest"] = sessions[session_id]
        if len(sessions) > 12:
            for k in [k for k in sessions if k != "_latest"][:-10]:
                sessions.pop(k, None)

    def pop_context(self, user_id: str, session_id: Optional[str] = None) -> Optional[Dict]:
        sessions = self._pending_context.get(user_id, {})
        ctx = sessions.pop(session_id, None) if session_id else None
        return ctx or sessions.get("_latest")

    def get_last_selection(self, user_id: str) -> Optional[Dict]:
        return self._last_selection.get(user_id)

    def _get_user_cluster_dists(self, user_id: str, cluster_id: int) -> Dict[str, Dict[str, float]]:
        if user_id not in self._user_distributions:
            self._user_distributions[user_id] = {}
            fb_dists = firebase_service.get_bandit_distributions(user_id)
            if fb_dists:
                self._user_distributions[user_id] = fb_dists

        if cluster_id not in self._user_distributions[user_id]:
            self._user_distributions[user_id][cluster_id] = {
                tech_id: {"alpha": 1.0, "beta": 1.0}
                for tech_id in TECHNIQUES.keys()
            }

        return self._user_distributions[user_id][cluster_id]

    def select_technique(
        self,
        user_id: str,
        cluster_id: int,
        usage_history_7d: Optional[Dict[str, int]] = None,
        exclude_technique_ids: Optional[List[str]] = None,
        context_vector: Optional[List[float]] = None
    ) -> Tuple[str, float, float, float, float, Dict[str, float]]:
        start_time = time.time()
        cluster_dists = self._get_user_cluster_dists(user_id, cluster_id)

        if context_vector is not None:
            # Continuous-context path: cluster prior + per-user linear model + adaptive habituation.
            policy = self.get_policy(user_id)
            pref_scores = {t: preference_learner.get_preference_score(user_id, t) for t in cluster_dists}
            selection = policy.select(
                cluster_id, context_vector,
                exclude=exclude_technique_ids,
                pref_scores=pref_scores,
                cluster_dists=cluster_dists,
                boosts=firebase_service.get_fastest_recovery_technique_history(user_id),
            )
            self._last_selection[user_id] = selection
            tech = selection["technique_id"]
            d = selection["details"][tech]
            all_scores = {a: v["score"] for a, v in selection["details"].items()}
            exec_ms = (time.time() - start_time) * 1000.0
            return tech, d["score"], d["context_score"], d["preference"], exec_ms, all_scores
        usage_history = usage_history_7d or {}
        excluded = set(exclude_technique_ids or [])

        best_tech = None
        best_blended_score = -1.0
        best_physio_sample = 0.0
        best_pref_score = 0.0
        all_blended_scores = {}

        history_boosts = firebase_service.get_fastest_recovery_technique_history(user_id)

        for tech_id, params in cluster_dists.items():
            if tech_id in excluded and len(excluded) < len(cluster_dists):
                continue

            alpha = params["alpha"] + history_boosts.get(tech_id, 0.0)
            beta = params["beta"]

            s_physio = float(np.random.beta(max(0.1, alpha), max(0.1, beta)))
            s_pref = preference_learner.get_preference_score(user_id, tech_id)

            blended = (WEIGHT_PHYSIO * s_physio) + (WEIGHT_PREF * s_pref)

            uses_count = usage_history.get(tech_id, 0)
            if uses_count > HABITUATING_USAGE_THRESHOLD:
                blended *= HABITUATING_PENALTY_FACTOR

            all_blended_scores[tech_id] = blended

            if blended > best_blended_score:
                best_blended_score = blended
                best_tech = tech_id
                best_physio_sample = s_physio
                best_pref_score = s_pref

        if best_tech is None:
            best_tech = list(cluster_dists.keys())[0]

        exec_time_ms = (time.time() - start_time) * 1000.0

        return best_tech, best_blended_score, best_physio_sample, best_pref_score, exec_time_ms, all_blended_scores

    def update_distribution(self, user_id: str, cluster_id: int, technique_id: str, reward: float,
                            context_vector: Optional[List[float]] = None):
        if context_vector is not None:
            policy = self.get_policy(user_id)
            if technique_id in policy.linear:
                policy.update(technique_id, cluster_id, context_vector, max(0.0, min(1.0, reward)), update_beta=False)
                firebase_service.save_policy_state(user_id, policy.to_dict())
        cluster_dists = self._get_user_cluster_dists(user_id, cluster_id)
        if technique_id in cluster_dists:
            if reward >= 0:
                cluster_dists[technique_id]["alpha"] += reward
                cluster_dists[technique_id]["beta"] += (1.0 - reward)
            else:
                cluster_dists[technique_id]["beta"] += abs(reward)

            alpha_val = cluster_dists[technique_id]["alpha"]
            beta_val = cluster_dists[technique_id]["beta"]

            db_manager.save_bandit_distribution(
                user_id,
                cluster_id,
                technique_id,
                alpha_val,
                beta_val
            )

            try:
                firebase_service.save_bandit_distribution(
                    user_id,
                    cluster_id,
                    technique_id,
                    alpha_val,
                    beta_val
                )
            except Exception as e:
                print(f"[Firebase Warning] Could not save bandit distribution to Firebase: {e}")

    def get_user_bandit_state(self, user_id: str) -> Dict[int, Dict[str, Dict[str, float]]]:
        if user_id not in self._user_distributions:
            for c in range(10):
                self._get_user_cluster_dists(user_id, c)
        return self._user_distributions[user_id]


thompson_bandit = ThompsonBandit()
