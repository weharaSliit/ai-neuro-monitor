"""Personal load/arousal scale: every model output is expressed as

        z = (score - mu_rest) / sigma

i.e. how far THIS person currently is above THEIR OWN resting level, in
units of normal resting noise. Replaces probability calibration (Platt) and
population thresholds: a calibrated probability is right only on average
across people and is tied to the training set's task/rest ratio, whereas z
means the same thing for every person (see paper Sect. "Personal Scale").

  PersonalBaseline   one model (EEG load or GSR/HRV arousal) for one person:
                     onboarding -> mu_rest, responsiveness check, z(),
                     slow baseline update from confident-rest windows.
  fuse_personal_z    combines the two z scores for one time-grid cell:
                     quality- and performance-weighted mean, alert flag,
                     agreement and load-arousal state.

Nothing here is fitted per window; sigma comes from training people
(`sigma_prior`) until the person has enough own rest data to replace it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

K_ALERT = 0.84          # z above own rest -> about 20% of rest blocks flagged
Z_MAX = 8.0             # |z| beyond this is treated as an artefact (no weight)
MIN_TASK_RESPONSE = 0.5  # onboarding task must sit >= 0.5 sigma above own rest
MODALITIES = ("eeg", "hrv_gsr")


@dataclass
class PersonalBaseline:
    sigma_prior: float                 # rest drift SD measured on training people
    mu_rest: float | None = None
    task_response: float | None = None  # onboarding task z (responsiveness)
    own_rest: list = field(default_factory=list)
    min_own_rest_for_sigma: int = 20

    # -- onboarding ------------------------------------------------------
    def onboard(self, rest_scores, task_scores=None) -> dict:
        rest = np.asarray(rest_scores, float)
        if rest.size == 0:
            raise ValueError("onboarding needs at least one rest block")
        self.mu_rest = float(rest.mean())
        self.own_rest = list(rest)
        out = {"mu_rest": self.mu_rest, "sigma": self.sigma, "responsive": None}
        if task_scores is not None and len(task_scores):
            self.task_response = float((np.mean(task_scores) - self.mu_rest) / self.sigma)
            out["task_response_z"] = self.task_response
            out["responsive"] = self.task_response >= MIN_TASK_RESPONSE
        return out

    # -- scale -----------------------------------------------------------
    @property
    def sigma(self) -> float:
        """Prior until enough own rest windows exist, then the person's own
        rest SD (never allowed below half the prior, to stay conservative)."""
        if len(self.own_rest) >= self.min_own_rest_for_sigma:
            return float(max(np.std(self.own_rest, ddof=1), 0.5 * self.sigma_prior))
        return float(self.sigma_prior)

    def z(self, score: float) -> float:
        if self.mu_rest is None:
            raise RuntimeError("onboard() first")
        return float((score - self.mu_rest) / self.sigma)

    # -- drift -----------------------------------------------------------
    def update_rest(self, score: float, alpha: float = 0.05) -> None:
        """Call only for windows confidently at rest (e.g. both models below
        alert and no task running). Slow EWMA so real load is not absorbed."""
        self.mu_rest = float((1 - alpha) * self.mu_rest + alpha * score)
        self.own_rest.append(float(score))


def fuse_personal_z(cell: dict, k: float = K_ALERT, z_max: float = Z_MAX) -> dict:
    """cell: {m: {"z": float|None, "signal_quality": q, "model_acc": a}}
    (EEG quality 0-100, GSR/HRV 0-1). Weight w_m = q_m * a_m; confidence is
    not a separate factor because |z| already carries the strength of the
    evidence. Returns fused z, alert flag, per-model flags, agreement and the
    load-arousal state."""
    w, zs = {}, {}
    for m in MODALITIES:
        d = cell.get(m) or {}
        zm = d.get("z")
        if zm is None or not np.isfinite(zm) or abs(zm) > z_max:
            continue
        q = float(d.get("signal_quality", 0.0)) / (100.0 if m == "eeg" else 1.0)
        wm = min(max(q, 0.0), 1.0) * min(max(float(d.get("model_acc", 1.0)), 0.0), 1.0)
        if wm > 0:
            w[m], zs[m] = wm, float(zm)
    if not w:
        return {"z_fused": None, "alert": None, "weights": {}, "high": {},
                "agreement": "insufficient_data", "state": None}
    tot = sum(w.values())
    wn = {m: v / tot for m, v in w.items()}
    zf = sum(wn[m] * zs[m] for m in zs)
    high = {m: zs[m] >= k for m in zs}
    if len(zs) == 2:
        agreement = "agree" if high["eeg"] == high["hrv_gsr"] else "disagree"
        state = {(True, True): "load+arousal", (True, False): "focused load",
                 (False, True): "arousal without load", (False, False): "rest"}[(high["eeg"], high["hrv_gsr"])]
    else:
        agreement, state = "insufficient_data", None
    return {"z_fused": zf, "alert": zf >= k, "weights": wn, "high": high,
            "agreement": agreement, "state": state}
