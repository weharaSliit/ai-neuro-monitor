# This package is a deliberately partial COPY of phscycological/src/sam40/ --
# only the 5 files backend/psychological/realtime/pipeline.py actually needs
# at runtime (channels.py, decision.py, derived_features.py, features.py,
# preprocess.py). The full offline research/training package (labels.py,
# train.py, distill.py, twostage.py, calibration.py, loader.py, balance.py,
# quality.py, and sam40's own pipeline.py) stays ONLY in phscycological/ --
# it was deliberately left out of this backend/ service (see the
# conversation that created this module: "real-time service only", not the
# whole research codebase).
#
# Kept in sync with phscycological/src/sam40/ MANUALLY. If either copy
# changes, check the other -- there is no automated guard against drift.
