"""MQTT subscriber for the ESP32 firmware's batched payload on eeg/t7t8/raw
-- one or more "millis,ch1,ch2" records per message, separated by ';'
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
    """Returns a connected paho-mqtt client wired to append parsed samples into `buffer`.
    Caller owns calling .loop_start()/.loop_forever() and eventual .disconnect().
    """
    import paho.mqtt.client as mqtt

    def on_connect(client, userdata, flags, reason_code, properties=None):
        print(f'[mqtt] connected (reason_code={reason_code}), subscribing to {topic}')
        client.subscribe(topic)

    def on_message(client, userdata, msg):
        samples = parse_payload(msg.payload.decode('utf-8', errors='replace'))
        if not samples:
            print(f'[mqtt] dropped malformed/empty payload: {msg.payload!r}')
            return
        for sample in samples:
            buffer.append(sample)

    client = mqtt.Client(client_id=client_id, callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(broker, port)
    return client
