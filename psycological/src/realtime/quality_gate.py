"""Re-exports the canonical quality-gate implementation from
`backend/psychological/realtime/quality_gate.py` -- this file and that one
used to be two hand-maintained, drifting copies of the exact same classes
(confirmed byte-identical `MultiFeatureQualityClassifier` before this
change). `psycological/scripts/check_signal_quality.py` already imports
the backend copy directly rather than a local one; this makes
`psycological/src/realtime/pipeline.py`'s own `from .quality_gate import
TrustedIoTEEGValidator` resolve to that SAME canonical implementation too,
instead of a second copy that has to be kept in sync by hand.
"""

import sys
from pathlib import Path

_repo_root = Path(__file__).resolve().parents[3]  # .../psycological/src/realtime -> repo root
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from backend.psychological.realtime.quality_gate import (  # noqa: E402,F401
    ADC_FULL_SCALE,
    GAIN,
    VREF_VOLTS,
    ConnectivityValidator,
    ItakuraArtifactDetector,
    MultiFeatureQualityClassifier,
    SignalQualityGate,
    TraditionalEEGValidator,
    TrustedIoTEEGValidator,
    auto_scale_adc_to_uv,
)
