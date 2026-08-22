"""Incremental CSV logging for the realtime pipeline -- raw ADC samples,
preprocessed signal, and per-block decisions all go through the same
flush-every-row `CsvLogger`. Kept here (rather than in scripts/) so any
consumer of `realtime.mqtt_client` (live inference, capture/bench scripts)
can log raw samples without duplicating the writer.
"""

import csv

from .adc import code_to_microvolts
from .mqtt_client import RawSample

RAW_FIELDS = ['millis', 'ch1_code', 'ch2_code', 'ch1_uv', 'ch2_uv']


class CsvLogger:
    """Thin incremental CSV writer -- flushes every row so `tail -f` works
    live and no data is lost if the process is killed mid-session. Tolerant
    of rows with a different key subset (e.g. skipped blocks carry fewer
    quality fields than trusted ones) via extrasaction/restval."""

    def __init__(self, path: str | None, fieldnames: list[str]):
        self.file = open(path, 'w', newline='') if path else None
        self.writer = (csv.DictWriter(self.file, fieldnames=fieldnames, extrasaction='ignore', restval='')
                        if self.file else None)
        if self.writer:
            self.writer.writeheader()
            self.file.flush()

    def write(self, row: dict) -> None:
        if self.writer:
            self.writer.writerow(row)
            self.file.flush()

    def close(self) -> None:
        if self.file:
            self.file.close()


def log_raw_block(logger: CsvLogger, block: list[RawSample]) -> None:
    """Writes one row per raw sample (pre-preprocessing ADC codes + decoded uV)."""
    for s in block:
        logger.write({
            'millis': s.millis, 'ch1_code': s.ch1_code, 'ch2_code': s.ch2_code,
            'ch1_uv': f'{code_to_microvolts(s.ch1_code):.3f}', 'ch2_uv': f'{code_to_microvolts(s.ch2_code):.3f}',
        })
