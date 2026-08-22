import time

FUSION_WINDOW_BUCKET_SEC = 60


def fusion_window_key(bucket_sec: int = FUSION_WINDOW_BUCKET_SEC) -> int:
    return int(time.time() // bucket_sec)
