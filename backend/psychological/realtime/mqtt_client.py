import threading
import itertools
import time
from collections import deque
from dataclasses import dataclass
from typing import Union, List

@dataclass(frozen=True)
class RawSample:
    millis: int
    ch1_code: int
    ch2_code: int

@dataclass(frozen=True)
class BipolarRawSample:
    millis: int
    code: int

# Define a type alias so the buffer knows it can expect either type of sample
AnySample = Union[RawSample, BipolarRawSample]

class RawSampleBuffer:
    def __init__(self, maxlen: int = 250 * 60):  # 60s of raw 250 SPS data as a safety cap
        self._buf = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        # (host wall-clock seconds, device millis) of the newest packet --
        # lets wall_time_for() date ANY buffered sample by its capture time,
        # even when blocks queue up behind a slow /predict (Render cold
        # start, retries) and are drained well after they were recorded.
        self._anchor: tuple[float, int] | None = None

    def note_arrival(self, device_millis: int) -> None:
        with self._lock:
            self._anchor = (time.time(), int(device_millis))

    def wall_time_for(self, device_millis: int) -> float | None:
        """Host wall-clock time (epoch s) at which the sample stamped
        device_millis was captured: newest arrival minus the device-clock
        gap since. MQTT transit (well under 1s) is ignored. None if there's
        no anchor yet, or if device_millis is AHEAD of the anchor (the
        device rebooted and its millis counter restarted in between), since
        the two counters are then unrelated."""
        with self._lock:
            anchor = self._anchor
        if anchor is None:
            return None
        anchor_wall, anchor_millis = anchor
        gap_ms = anchor_millis - int(device_millis)
        if gap_ms < 0:
            return None
        return anchor_wall - gap_ms / 1000.0

    def append(self, sample: AnySample) -> None:
        with self._lock:
            self._buf.append(sample)

    def drain(self, n: int) -> List[AnySample]:
        with self._lock:
            n = min(n, len(self._buf))
            return [self._buf.popleft() for _ in range(n)]

    def peek_count(self) -> int:
        with self._lock:
            return len(self._buf)

    def peek_recent(self, n: int) -> List[AnySample]:
        with self._lock:
            length = len(self._buf)
            if n >= length:
                return list(self._buf)
            # Highly optimized memory read using itertools
            return list(itertools.islice(self._buf, length - n, length))


def parse_payload(payload: str) -> List[RawSample]:
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


def parse_bipolar_payload(payload: str) -> List[BipolarRawSample]:
    samples = []
    for record in payload.strip().split(';'):
        record = record.strip()
        if not record:
            continue
        parts = record.split(',')
        if len(parts) != 2:
            continue
        try:
            millis_str, code_str = parts
            samples.append(BipolarRawSample(millis=int(millis_str), code=int(code_str)))
        except ValueError:
            continue
    return samples


def make_client(broker: str, port: int, topic: str, buffer: RawSampleBuffer, client_id: str = 'eeg_inference',
                 username: str = None, password: str = None, ca_cert: str = None):
    from backend.common.mqtt_bridge import connect_mqtt

    def on_message(client, userdata, msg):
        samples = parse_payload(msg.payload.decode('utf-8', errors='replace'))
        if not samples:
            print(f'[mqtt] dropped malformed/empty payload: {msg.payload!r}')
            return
        for sample in samples:
            buffer.append(sample)

    return connect_mqtt(broker, port, topic, on_message, client_id=client_id,
                         username=username, password=password, ca_cert=ca_cert)


def make_bipolar_client(broker: str, port: int, topic: str, buffer: RawSampleBuffer,
                         client_id: str = 'eeg_inference_bipolar',
                         username: str = None, password: str = None, ca_cert: str = None):
    from backend.common.mqtt_bridge import connect_mqtt

    def on_message(client, userdata, msg):
        samples = parse_bipolar_payload(msg.payload.decode('utf-8', errors='replace'))
        if not samples:
            print(f'[mqtt] dropped malformed/empty bipolar payload: {msg.payload!r}')
            return
        for sample in samples:
            buffer.append(sample)
        buffer.note_arrival(samples[-1].millis)

    return connect_mqtt(broker, port, topic, on_message, client_id=client_id,
                         username=username, password=password, ca_cert=ca_cert)