import threading
import time
import itertools
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
        self.last_append = None  # time.time() of the newest sample, None until one arrives

    def append(self, sample: AnySample) -> None:
        with self._lock:
            self._buf.append(sample)
            self.last_append = time.time()

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

    return connect_mqtt(broker, port, topic, on_message, client_id=client_id,
                         username=username, password=password, ca_cert=ca_cert)