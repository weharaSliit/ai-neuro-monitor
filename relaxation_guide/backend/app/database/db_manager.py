"""
Database Manager Module.
Provides SQLite local persistence for user-wise personalization,
Contextual Thompson Sampling bandit distributions, ratings, and interventions.
User accounts themselves live in backend/physiological (see app/shared_auth.py).
"""

import os
import json
import sqlite3
from typing import Dict, Any, List, Optional

from app.services import firebase_service

class DatabaseManager:
    def __init__(self, db_path: str = "caps_local.db"):
        self.db_path = db_path
        self.is_firebase = True
        self._init_sqlite()

    def _init_sqlite(self):
        """Initializes SQLite tables for user-wise local persistence as fallback."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Users table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    email TEXT UNIQUE,
                    password TEXT,
                    full_name TEXT,
                    is_email_verified INTEGER DEFAULT 0,
                    verification_code TEXT,
                    created_at REAL
                )
            """)

            # Interventions table per user
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS interventions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    technique_id TEXT,
                    sub_option_id TEXT,
                    cluster_id INTEGER,
                    pre_label TEXT,
                    post_label TEXT,
                    reward REAL,
                    recovery_pct REAL,
                    timestamp REAL
                )
            """)

            # Ratings table per user
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ratings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    technique_id TEXT,
                    sub_option_id TEXT,
                    stars INTEGER,
                    timestamp REAL
                )
            """)

            # User-wise Contextual Thompson Sampling Bandit Distributions table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS bandit_distributions (
                    user_id TEXT,
                    cluster_id INTEGER,
                    technique_id TEXT,
                    alpha REAL,
                    beta REAL,
                    PRIMARY KEY (user_id, cluster_id, technique_id)
                )
            """)

            # User-wise Gamification Stats table (XP, Streak, Badges)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_gamification (
                    user_id TEXT PRIMARY KEY,
                    xp INTEGER DEFAULT 0,
                    streak INTEGER DEFAULT 1,
                    unlocked_badges TEXT
                )
            """)

            conn.commit()
            conn.close()
        except Exception as e:
            print(f"SQLite init error: {e}")

    # --- User Lookup (Firebase Realtime DB Primary) ---
    # Account creation/verification lives in backend/physiological's
    # /register + /login now (see app/shared_auth.py) -- this module only
    # reads user records it doesn't own, for profile display.
    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves user details by user_id from Firebase Realtime DB."""
        # 1. Primary: Firebase Realtime DB
        fb_user = firebase_service.get_user(user_id)
        if fb_user:
            fb_user["user_id"] = user_id
            return fb_user

        # 2. Fallback: SQLite
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT user_id, email, password, full_name, is_email_verified, verification_code, created_at FROM users WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()
            conn.close()

            if row:
                return {
                    "user_id": row[0],
                    "email": row[1],
                    "password": row[2],
                    "full_name": row[3],
                    "is_email_verified": bool(row[4]),
                    "verification_code": row[5],
                    "created_at": row[6]
                }
        except Exception:
            pass

        return None

    def get_all_users(self) -> List[Dict[str, Any]]:
        """Retrieves all registered users from Firebase Realtime DB."""
        fb_users = firebase_service.list_users()
        users_list = []
        if isinstance(fb_users, dict):
            for uid, data in fb_users.items():
                if isinstance(data, dict):
                    data["user_id"] = uid
                    users_list.append(data)
        return users_list

    # --- User-Wise Bandit Distribution Persistence ---
    def save_bandit_distribution(self, user_id: str, cluster_id: int, technique_id: str, alpha: float, beta: float):
        """Saves a user's learned Beta(alpha, beta) parameters into Firebase Realtime DB."""
        firebase_service.save_bandit_distribution(user_id, cluster_id, technique_id, alpha, beta)
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO bandit_distributions (user_id, cluster_id, technique_id, alpha, beta)
                VALUES (?, ?, ?, ?, ?)
            """, (user_id, cluster_id, technique_id, alpha, beta))
            conn.commit()
            conn.close()
        except Exception:
            pass

    def load_bandit_distributions(self, user_id: str) -> Dict[int, Dict[str, Dict[str, float]]]:
        """Loads user-wise Beta distributions from Firebase Realtime DB."""
        fb_dists = firebase_service.get_bandit_distributions(user_id)
        if fb_dists:
            return fb_dists

        # Fallback to SQLite
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT cluster_id, technique_id, alpha, beta
                FROM bandit_distributions
                WHERE user_id = ?
            """, (user_id,))
            rows = cursor.fetchall()
            conn.close()

            user_dists: Dict[int, Dict[str, Dict[str, float]]] = {}
            for r in rows:
                c_id, t_id, a, b = r[0], r[1], r[2], r[3]
                if c_id not in user_dists:
                    user_dists[c_id] = {}
                user_dists[c_id][t_id] = {"alpha": a, "beta": b}
            return user_dists
        except Exception:
            return {}

    # --- Telemetry & Interventions ---
    def log_intervention(
        self,
        user_id: str,
        technique_id: str,
        sub_option_id: str,
        cluster_id: int,
        pre_label: str,
        post_label: str,
        reward: float,
        recovery_pct: float,
        timestamp: float
    ):
        """Stores an intervention record in SQLite."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO interventions (user_id, technique_id, sub_option_id, cluster_id, pre_label, post_label, reward, recovery_pct, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (user_id, technique_id, sub_option_id, cluster_id, pre_label, post_label, reward, recovery_pct, timestamp))
        conn.commit()
        conn.close()

    def log_rating(self, user_id: str, technique_id: str, sub_option_id: str, stars: int, timestamp: float):
        """Stores a user rating in SQLite."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO ratings (user_id, technique_id, sub_option_id, stars, timestamp)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, technique_id, sub_option_id, stars, timestamp))
        conn.commit()
        conn.close()

    def load_user_ratings(self, user_id: str) -> List[Dict[str, Any]]:
        """Loads user ratings from SQLite."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT technique_id, sub_option_id, stars, timestamp
            FROM ratings
            WHERE user_id = ?
            ORDER BY timestamp ASC
        """, (user_id,))
        rows = cursor.fetchall()
        conn.close()

        ratings = []
        for r in rows:
            ratings.append({
                "technique_id": r[0],
                "sub_option_id": r[1],
                "stars": r[2],
                "timestamp": r[3]
            })
        return ratings

    def save_user_gamification(self, user_id: str, xp: int, streak: int, unlocked_badges: List[str]):
        """Saves user XP, streak, and unlocked badges to SQLite."""
        badges_json = json.dumps(unlocked_badges)
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO user_gamification (user_id, xp, streak, unlocked_badges)
            VALUES (?, ?, ?, ?)
        """, (user_id, xp, streak, badges_json))
        conn.commit()
        conn.close()

    def load_user_gamification(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Loads user XP, streak, and unlocked badges from SQLite."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT xp, streak, unlocked_badges FROM user_gamification WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()

        if row:
            try:
                badges = json.loads(row[2]) if row[2] else ["streak_legend"]
            except Exception:
                badges = ["streak_legend"]
            return {
                "xp": row[0],
                "streak": row[1],
                "unlocked_badges": badges
            }
        return None

    def get_intervention_history(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Retrieves past interventions for a specific user from SQLite."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT technique_id, sub_option_id, cluster_id, pre_label, post_label, reward, recovery_pct, timestamp
            FROM interventions
            WHERE user_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        """, (user_id, limit))
        rows = cursor.fetchall()
        conn.close()

        history = []
        for r in rows:
            history.append({
                "technique_id": r[0],
                "sub_option_id": r[1],
                "cluster_id": r[2],
                "pre_label": r[3],
                "post_label": r[4],
                "reward": r[5],
                "recovery_pct": r[6],
                "timestamp": r[7]
            })
        return history

    def get_best_suited_technique_analytics(self, user_id: str) -> Dict[str, Any]:
        """
        Analyzes user-wise intervention history and 5-star ratings to determine:
        1. Fast stress reduction speed per technique (short-time recovery).
        2. Average 5-star feedback rating per technique.
        3. Best-suited relaxation method rank for this specific user.
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Fetch intervention history
        cursor.execute("""
            SELECT technique_id, pre_label, post_label, reward, recovery_pct, timestamp
            FROM interventions
            WHERE user_id = ?
        """, (user_id,))
        interventions = cursor.fetchall()

        # Fetch user ratings
        cursor.execute("""
            SELECT technique_id, stars
            FROM ratings
            WHERE user_id = ?
        """, (user_id,))
        ratings = cursor.fetchall()
        conn.close()

        # Group ratings by technique
        tech_ratings: Dict[str, List[int]] = {}
        for r in ratings:
            t_id, stars = r[0], r[1]
            if t_id not in tech_ratings:
                tech_ratings[t_id] = []
            tech_ratings[t_id].append(stars)

        # Group recovery stats by technique
        tech_stats: Dict[str, Dict[str, Any]] = {}
        for i in interventions:
            t_id, pre, post, rwd, rec_pct, ts = i
            if t_id not in tech_stats:
                tech_stats[t_id] = {
                    "total_sessions": 0,
                    "successful_recoveries": 0,
                    "total_recovery_pct": 0.0,
                    "avg_duration_sec": 30.0 # Standard short-time recovery duration (30s)
                }

            tech_stats[t_id]["total_sessions"] += 1
            tech_stats[t_id]["total_recovery_pct"] += rec_pct
            if post.lower() == "normal":
                tech_stats[t_id]["successful_recoveries"] += 1

        # Calculate user-wise ranked scores
        rankings = []
        for t_id, stats in tech_stats.items():
            sessions = stats["total_sessions"]
            avg_rec_pct = stats["total_recovery_pct"] / sessions if sessions > 0 else 0.0
            r_list = tech_ratings.get(t_id, [5])
            avg_stars = sum(r_list) / len(r_list) if r_list else 5.0

            # Short-time recovery speed score (30s baseline)
            speed_score = min(1.0, max(0.5, 30.0 / stats["avg_duration_sec"]))
            star_score = (avg_stars - 1.0) / 4.0 if avg_stars > 1.0 else 0.5
            recovery_score = avg_rec_pct / 100.0

            # Combined Suitability Score (50% Star Feedback + 30% Stress Reduction % + 20% Recovery Speed)
            combined_suitability = (0.50 * star_score) + (0.30 * recovery_score) + (0.20 * speed_score)

            rankings.append({
                "technique_id": t_id,
                "combined_suitability_score": round(combined_suitability, 4),
                "avg_star_rating": round(avg_stars, 1),
                "avg_recovery_pct": round(avg_rec_pct, 1),
                "avg_recovery_seconds": stats["avg_duration_sec"],
                "total_sessions_completed": sessions,
                "normal_baseline_successes": stats["successful_recoveries"]
            })

        # Sort rankings by highest suitability score
        rankings.sort(key=lambda x: x["combined_suitability_score"], reverse=True)

        best_technique = rankings[0]["technique_id"] if rankings else "guided_meditation"

        return {
            "user_id": user_id,
            "best_suited_technique_id": best_technique,
            "rankings": rankings
        }

# Global instance
db_manager = DatabaseManager()
