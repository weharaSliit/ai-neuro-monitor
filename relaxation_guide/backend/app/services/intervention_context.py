from typing import Optional, Tuple

from app.config import (
    CONTEXT_WEIGHT_PHYSIO,
    CONTEXT_WEIGHT_PHENO,
    CONTEXT_PRESTRESS_FLOOR,
    CONTEXT_STRESS_FLOOR,
)


def _label_adjusted_score(label: str, score: float) -> float:
    normalized_label = (label or "").strip().lower().replace("_", "-")
    if "pre" in normalized_label or "moderate" in normalized_label or "medium" in normalized_label:
        return max(score, CONTEXT_PRESTRESS_FLOOR)
    if any(term in normalized_label for term in ("stress", "high", "acute")):
        return max(score, CONTEXT_STRESS_FLOOR)
    return score


def combine_intervention_context(
    physiological_label: str,
    physiological_score: float,
    phenotyping_label: Optional[str] = None,
    phenotyping_score: Optional[float] = None,
) -> Tuple[str, float]:
    physiological_score = _label_adjusted_score(physiological_label, physiological_score)

    if phenotyping_score is not None:
        phenotyping_score = _label_adjusted_score(phenotyping_label or "", phenotyping_score)
        combined_score = CONTEXT_WEIGHT_PHYSIO * physiological_score + CONTEXT_WEIGHT_PHENO * phenotyping_score
    else:
        combined_score = physiological_score

    combined_score = max(0.0, min(1.0, combined_score))
    if combined_score >= CONTEXT_STRESS_FLOOR:
        combined_label = "stress"
    elif combined_score >= CONTEXT_PRESTRESS_FLOOR:
        combined_label = "pre-stress"
    else:
        combined_label = "normal"

    return combined_label, combined_score
