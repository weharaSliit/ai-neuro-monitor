"""
alert_queue.py — records trend/alarm episodes and hands them off to a
SEPARATE, external stress-intervention system via a local append-only
JSON-lines queue file. That intervention system is out of scope here —
this module only ever writes; nothing in this repo reads the queue back.

Two pieces:

  1. StageEdgeWatcher — watches each epoch's `stage` (0=CALM, 1=PRE-STAGE,
     2=STRESSED) for a CHANGE and turns every transition into one
     structured event (onset / escalate / de-escalate / end), with the
     underlying detector(s) that caused it (trend_alarm, shock_alarm,
     alert_type) and the episode's running peak severity attached. This
     IS the record of trends: every PRE-STAGE/STRESSED episode a session
     produced, not just a raw per-epoch number.

     Keyed on `stage` (the pipeline's own aggregated decision — see
     real_time_inference.py:502-503, which already folds in SpiralLSTM's
     alert, the p_emo CUSUM `trend_alarm`, and a corroborated
     `shock_alarm`) rather than one independent event stream per detector:
     a downstream system should react to ONE severity signal, not three
     separately-timed ones. `feature_trend_alarm` doesn't gate `stage` by
     design (Sec. 4.5) so it's attached as context on every event instead.

  2. AlertQueue — appends each event as one JSON line to a durable file
     (ALERT_QUEUE_PATH), shared across server restarts and across
     sessions (each event carries `session_id` for traceability back to
     that session's CSV). Deliberately dumb: no network call, no retry
     logic, no knowledge of what (if anything) is tailing it. Append-only
     so multiple independent readers can each track their own read
     position (e.g. by the monotonic `id` field) without racing or losing
     events, and a consumer that isn't running yet loses nothing.
"""

import json
import time
from dataclasses import dataclass, field
from itertools import count
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent
ALERT_QUEUE_DIR  = _HERE / "data" / "alerts"
ALERT_QUEUE_PATH = ALERT_QUEUE_DIR / "stress_alerts.jsonl"

STAGE_NAMES = ["CALM", "PRE-STAGE", "STRESSED"]

_id_counter = count(1)


class AlertQueue:
    """Append-only JSON-lines writer. Always opens in append mode, so it
    picks up wherever the file left off across server restarts."""

    def __init__(self, path: Path = ALERT_QUEUE_PATH):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._f = open(self.path, "a", buffering=1)   # line-buffered — each
                                                        # event is flushed to
                                                        # disk immediately so
                                                        # a tailing reader sees
                                                        # it without delay

    def emit(self, event: dict) -> dict:
        event = {"id": next(_id_counter), "queued_at": round(time.time(), 3), **event}
        self._f.write(json.dumps(event) + "\n")
        return event

    def close(self):
        try:
            self._f.close()
        except Exception:
            pass


@dataclass
class StageEdgeWatcher:
    """Turns a stream of per-epoch `stage` values into onset/escalate/
    de-escalate/end events for one session. See module docstring."""

    queue: AlertQueue
    session_id: str
    _last_stage: Optional[int] = field(default=None, repr=False)
    _episode_start_s: Optional[float] = field(default=None, repr=False)
    _episode_peak: dict = field(default_factory=dict, repr=False)

    def update(self, time_s: float, result: dict) -> Optional[dict]:
        """Call once per epoch (including skipped ones) with that epoch's
        result dict. Returns the emitted event, or None if `stage` didn't
        change (or the epoch was skipped — a gap in the signal shouldn't
        by itself end an in-progress episode)."""
        stage = result.get("stage")
        if stage is None:
            return None

        if self._last_stage is None:
            self._last_stage = stage
            if stage > 0:
                self._episode_start_s = time_s
                self._track_peak(result)
            return None

        if stage == self._last_stage:
            if stage > 0:
                self._track_peak(result)
            return None

        if self._last_stage == 0:
            # CALM -> PRE-STAGE, or CALM -> STRESSED directly
            self._episode_start_s = time_s
            self._episode_peak = {}
            self._track_peak(result)
            event = self._emit("alert_start", time_s, stage, result)
        elif stage == 0:
            # fully resolved back to CALM
            event = self._emit("alert_end", time_s, stage, result)
            self._episode_start_s = None
            self._episode_peak = {}
        elif stage > self._last_stage:
            self._track_peak(result)
            event = self._emit("alert_escalate", time_s, stage, result)
        else:
            event = self._emit("alert_deescalate", time_s, stage, result)

        self._last_stage = stage
        return event

    def _track_peak(self, result: dict):
        for k in ("p_emo", "risk", "trend_score", "feature_trend_score"):
            v = result.get(k)
            if v is not None:
                self._episode_peak[k] = max(self._episode_peak.get(k, v), v)

    def _emit(self, event_type: str, time_s: float, stage: int, result: dict) -> dict:
        duration_s = (round(time_s - self._episode_start_s, 2)
                      if self._episode_start_s is not None else None)
        return self.queue.emit({
            "event"               : event_type,
            "session_id"          : self.session_id,
            "time_s"              : time_s,
            "stage"               : stage,
            "stage_name"          : STAGE_NAMES[stage],
            "episode_duration_s"  : duration_s,
            "alert_type"          : result.get("alert_type"),
            "trend_alarm"         : result.get("trend_alarm"),
            "feature_trend_alarm" : result.get("feature_trend_alarm"),
            "shock_alarm"         : result.get("shock_alarm"),
            "p_emo"               : result.get("p_emo"),
            "risk"                : result.get("risk"),
            "trend_score"         : result.get("trend_score"),
            "feature_trend_score" : result.get("feature_trend_score"),
            "episode_peak"        : dict(self._episode_peak),
        })


@dataclass
class BooleanAlarmWatcher:
    """
    Archives rising/falling edges of a single boolean alarm signal (e.g.
    `shock_alarm`) INDEPENDENTLY of `stage`.

    Why this exists alongside StageEdgeWatcher: shock_alarm (Sec 4.6) is a
    fast, ~3-second cross-window detector, but `stage` only changes on the
    OR of alert/trend_alarm/shock_alarm — so if trend_alarm is already
    holding `stage` at PRE-STAGE, a shock_alarm can flip on and off
    several times during that same episode without StageEdgeWatcher ever
    seeing a stage transition to record it. Each individual shock is still
    a meaningful, separately-timed event for a downstream intervention
    system, so it gets archived on its own.
    """

    queue: AlertQueue
    session_id: str
    result_key: str      # boolean field to watch, e.g. "shock_alarm"
    label: str            # event name prefix, e.g. "shock"
    _active: bool = field(default=False, repr=False)
    _start_s: Optional[float] = field(default=None, repr=False)

    def update(self, time_s: float, result: dict) -> Optional[dict]:
        """Call once per epoch (including skipped ones). Returns the
        emitted event, or None if the signal didn't flip (or the epoch
        was skipped — a signal gap shouldn't by itself close an
        in-progress shock)."""
        val = result.get(self.result_key)
        if val is None:
            return None
        val = bool(val)

        if val == self._active:
            return None

        if val:
            self._start_s = time_s
            event = self._emit(f"{self.label}_start", time_s, result, 0.0)
        else:
            duration_s = (round(time_s - self._start_s, 2)
                          if self._start_s is not None else None)
            event = self._emit(f"{self.label}_end", time_s, result, duration_s)
            self._start_s = None

        self._active = val
        return event

    def _emit(self, event_type: str, time_s: float, result: dict, duration_s) -> dict:
        stage = result.get("stage")
        return self.queue.emit({
            "event"            : event_type,
            "session_id"       : self.session_id,
            "time_s"           : time_s,
            "duration_s"       : duration_s,
            "stage"            : stage,
            "stage_name"       : STAGE_NAMES[stage] if stage is not None else None,
            "alert_type"       : result.get("alert_type"),
            "p_emo"            : result.get("p_emo"),
            "feature_dist"     : result.get("feature_dist"),
            "p_shock_z"        : result.get("p_shock_z"),
            "feature_shock_z"  : result.get("feature_shock_z"),
        })
