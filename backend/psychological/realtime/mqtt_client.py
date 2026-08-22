"""MQTT subscriber for the ESP32 firmware's batched payload on
mindpulse/wearable02/sensors -- one or more "millis,ch1,ch2" records per
message, separated by ';'
(see firmware/eeg_t7t8/eeg_t7t8.ino publishBatch(), BATCH_SIZE samples per
publish rather than one publish() per sample).

Kept transport-agnostic from the processing pipeline: this module only
parses messages and appends to a buffer: `RawSampleBuffer` -- pipeline.py
owns turning accumulated samples into inference blocks (25s = 3200 samples
@ 128 Hz, or the equivalent duration of new raw 250 SPS data).
"""

import threading
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class RawSample:
    millis: int
    ch1_code: int
    ch2_code: int


class RawSampleBuffer:
    """Thread-safe append/drain buffer for incoming raw ADC samples."""

    def __init__(self, maxlen: int = 250 * 60):  # 60s of raw 250 SPS data as a safety cap
        self._buf = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def append(self, sample: RawSample) -> None:
        with self._lock:
            self._buf.append(sample)

    def drain(self, n: int) -> list[RawSample]:
        """Pop up to n oldest samples (FIFO); returns fewer if not enough buffered yet."""
        with self._lock:
            n = min(n, len(self._buf))
            return [self._buf.popleft() for _ in range(n)]

    def peek_count(self) -> int:
        with self._lock:
            return len(self._buf)

    def peek_recent(self, n: int) -> list:
        """Returns up to the n most recently appended samples WITHOUT
        removing them -- for a live preview push that runs independently
        of (and doesn't compete with) drain()'s FIFO block consumption."""
        with self._lock:
            if n >= len(self._buf):
                return list(self._buf)
            return list(self._buf)[-n:]


def parse_payload(payload: str) -> list[RawSample]:
    """Parses the firmware's batched payload: ';'-separated "millis,ch1,ch2"
    records (publishBatch() in the .ino). A malformed individual record is
    dropped on its own rather than discarding the whole batch."""
    samples = []
    for record in payload.strip().split(';'):
        record = record.strip()
        if not record:
            continue
        parts = record.split(',')
        if len(parts) != 3:
            continue
        try:
            millis_str, ch1_str, ch2_str = parts
            samples.append(RawSample(millis=int(millis_str), ch1_code=int(ch1_str), ch2_code=int(ch2_str)))
        except ValueError:
            continue
    return samples


def make_client(broker: str, port: int, topic: str, buffer: RawSampleBuffer, client_id: str = 'eeg_inference'):
    """Returns a connected, already-looping paho-mqtt client wired to append
    parsed samples into `buffer` (connection/subscribe/loop_start wiring
    lives in backend/common/mqtt_bridge.py, shared with the ring's bridge).
    Caller owns eventual .loop_stop()/.disconnect().
    """
    from backend.common.mqtt_bridge import connect_mqtt

    def on_message(client, userdata, msg):
        samples = parse_payload(msg.payload.decode('utf-8', errors='replace'))
        if not samples:
            print(f'[mqtt] dropped malformed/empty payload: {msg.payload!r}')
            return
        for sample in samples:
            buffer.append(sample)

    return connect_mqtt(broker, port, topic, on_message, client_id=client_id)
