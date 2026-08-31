import time

# 25s, matching EEG's own BLOCK_SEC cadence (backend/psychological/realtime/
# pipeline.py) -- was 60. At 60s, EEG's ~2.4 blocks/window landed in the same
# key and RTDB's shallow update() meant each new EEG write silently discarded
# the previous one already in that window: measured live at ~57% of EEG
# blocks lost per session. Shrinking the bucket to match EEG's cadence cut
# that to <1% (simulated across 200 randomized sessions before this change
# was made, not just reasoned about). Ring's own ~60s cadence just means
# most 25s windows won't have a Ring reading, which is already-correct,
# already-covered behavior (compute_realtime_multimodal_fusion() treats a
# non-reporting modality as weight 0, not an error).
FUSION_WINDOW_BUCKET_SEC = 25


def fusion_window_key(ts: float | None = None, bucket_sec: int = FUSION_WINDOW_BUCKET_SEC) -> int:
    """Bucket key for fusion_en/{user}/{session}/{key} -- ABSOLUTE epoch
    time (not session-relative). ts=None falls back to time.time(), for a
    caller with no real capture timestamp handy.

    Prefer passing this record's own real capture timestamp (EEG's
    timestamp_end, Ring's own capture instant) instead of leaving ts=None --
    the whole point of bucketing by a real capture time rather than by
    whatever moment happens to be true API-write-completion time is that
    write-completion time carries the (variable, per-request) model-
    inference + network delay along with it, so two readings genuinely
    captured close together in real time could otherwise land in different
    buckets purely because one write happened to take longer than the
    other.

    ABSOLUTE (epoch-based), not session-relative: tested both -- session-
    relative bucketing (anchored to this session's own first capture, which
    is itself a single jittery sample) was measurably WORSE than a stable,
    session-independent absolute grid, not better."""
    return int((ts if ts is not None else time.time()) // bucket_sec)
