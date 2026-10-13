import threading
import time
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
        self.last_append = None  # time.time() of the newest sample, None until one arrives
        # Device-clock -> host-wall-clock mapping, as offset = arrival time -
        # device_millis/1000. Every packet arrives at capture time + network
        # delay, and the firmware now QUEUES batches during a Wi-Fi outage and
        # sends them late -- so the newest packet's arrival is not its capture
        # time. The SMALLEST offset seen is the least-delayed packet, i.e. the
        # best estimate of the true mapping; delay only ever adds to it.
        # Reset when the device reboots (its millis counter goes backwards).
        self._offset: float | None = None
        self._last_millis: int | None = None
        # Device restarts seen on arrival (millis counter went backwards).
        # Detected here, per packet, so a restart is caught even when the
        # buffer had already emptied before it -- a backwards jump INSIDE the
        # buffer (raw_cleaning.start_after_last_gap) only sees it otherwise.
        self.reboot_count = 0

    def note_arrival(self, device_millis: int) -> None:
        now = time.time()
        m = int(device_millis)
        with self._lock:
            if self._last_millis is not None and m < self._last_millis - 1000:
                self._offset = None                       # device rebooted: old mapping is invalid
                self._last_millis = None
                self.reboot_count += 1
            off = now - m / 1000.0
            if self._offset is None or off < self._offset:
                self._offset = off
            self._last_millis = m if self._last_millis is None else max(m, self._last_millis)

    def wall_time_for(self, device_millis: int) -> float | None:
        """Host wall-clock time (epoch s) at which the sample stamped
        device_millis was captured, via the least-delayed packet's mapping
        (see __init__). None before any packet, or for a sample from before
        the device's last reboot (newer than anything seen = unrelated clock)."""
        with self._lock:
            off, last = self._offset, self._last_millis
        if off is None or last is None or int(device_millis) > last:
            return None
        return off + int(device_millis) / 1000.0

    def append(self, sample: AnySample) -> None:
        with self._lock:
            self._buf.append(sample)
            self.last_append = time.time()

    def drain(self, n: int) -> List[AnySample]:
        with self._lock:
            n = min(n, len(self._buf))
            return [self._buf.popleft() for _ in range(n)]

    def discard_before_gap(self, n: int) -> tuple[int, float]:
        """Looks at the oldest n buffered samples; if they contain a stream
        break (see raw_cleaning.start_after_last_gap), drops everything up to
        it so the next block starts after the break. Returns (samples
        dropped, gap seconds; -1 = device reboot)."""
        from .raw_cleaning import start_after_last_gap
        with self._lock:
            head = list(itertools.islice(self._buf, 0, min(n, len(self._buf))))
            idx, gap = start_after_last_gap([s.millis for s in head])
            for _ in range(idx):
                self._buf.popleft()
            return idx, gap

    def clear(self) -> int:
        """Drops everything buffered; returns how many samples were dropped."""
        with self._lock:
            n = len(self._buf)
            self._buf.clear()
            return n

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