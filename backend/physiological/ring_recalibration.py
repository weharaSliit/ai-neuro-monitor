# ============================================================
# ring_recalibration.py
# Ring (HRV/GSR) recalibration requested from psy_web's "Calibration,
# scores & alerts" dashboard -- the ring's twin of the EEG bridge's
# eeg_recalibration/{sessionId} flow (backend/psychological/mqtt_bridge.py).
#
# psy_web can't call this API (no login token; its one write is a Firebase
# flag), so it writes ring_recalibration/{userId} = {status: 'requested',
# include_threshold}. A poller thread started by app.py picks the request up,
# claims it (transaction: requested -> capturing, so it never runs twice),
# and runs the SAME captures the app's Calibrate / limit-test buttons use:
#   run_calibration_capture()        2 min settle + N_BASELINE_WIN rest windows
#   run_task_calibration_capture()   N_TASK_WIN task windows + N_RECOVERY_WIN recovery
# Progress and every window's score go back to the same node, for the
# dashboard's progress bar and live calibration graph:
#   phase settle|rest|task|recovery|done, blocks_captured, blocks_needed,
#   live/{rest,task,recovery}: [prob_stress, ...]  (rest = provisional
#   scores against the windows so far, replaced each window -- that IS the
#   calm level settling; the saved resting scores replace them at the end).
# ============================================================

import threading
import time

from backend.common.config import CALIBRATION_SETTLE_SEC, N_BASELINE_WIN, N_RECOVERY_WIN
from backend.physiological.calibration_capture import (
    N_TASK_WIN, run_calibration_capture, run_task_calibration_capture,
)
from backend.physiological.firebase_service import _global_ref, load_resting_scores

POLL_SEC = 5
NODE = 'ring_recalibration'


def _update(uid, fields):
    try:
        _global_ref(f'{NODE}/{uid}').update({**fields, 'updated_at': time.time()})
    except Exception as e:
        print(f"[ring-recal {uid}] firebase update failed: {e}")


def _claim(uid) -> dict | None:
    """requested -> capturing, atomically; the request if we got it."""
    claimed = {}

    def txn(cur):
        if not isinstance(cur, dict) or cur.get('status') != 'requested':
            return cur
        claimed.update(cur)
        return {**cur, 'status': 'capturing', 'phase': 'settle', 'handled_at': time.time(),
                'settle_sec': CALIBRATION_SETTLE_SEC, 'settle_until': time.time() + CALIBRATION_SETTLE_SEC,
                'blocks_captured': 0, 'blocks_needed': N_BASELINE_WIN, 'live': None,
                'result': None, 'error': None}
    try:
        _global_ref(f'{NODE}/{uid}').transaction(txn)
    except Exception as e:
        print(f"[ring-recal {uid}] claim failed: {e}")
        return None
    return claimed or None


def _run(uid, req, set_busy):
    include_task = bool(req.get('include_threshold', True))
    n_task = int(req.get('task_windows') or N_TASK_WIN)
    print(f"[ring-recal {uid}] started from {req.get('source') or 'psy_web'} "
          f"(task {'on' if include_task else 'off'}, {n_task} task windows)")
    set_busy(uid, True)
    try:
        def on_rest(status, extra):
            if status == 'window_captured':
                fields = {'phase': 'rest', 'blocks_captured': extra.get('window_idx', 0)}
                if extra.get('rest_scores') is not None:
                    fields['live/rest'] = extra['rest_scores']
                _update(uid, fields)
            elif status == 'window_skipped':
                _update(uid, {'last_reason': 'Window skipped: not enough clean heart-rate data or too much movement.'})
            elif status == 'saving':
                _update(uid, {'status': 'saving', 'phase': 'rest'})
            elif status == 'error':
                _update(uid, {'status': 'failed', 'error': extra.get('message', 'calibration failed')})

        rest = run_calibration_capture(uid, on_progress=on_rest, live_scores=True)
        if rest is None:
            return
        saved = [round(float(s), 4) for s in (load_resting_scores(uid) or [])]
        if saved:
            _update(uid, {'live/rest': saved})
        if not include_task:
            _update(uid, {'status': 'done', 'phase': 'done', 'result': {'rest_windows': len(saved)}})
            return

        _update(uid, {'status': 'capturing', 'phase': 'task', 'blocks_captured': 0, 'blocks_needed': n_task,
                      'live/task': None, 'live/recovery': None, 'last_reason': None})
        task_live = []
        rec_live = []

        def on_task(status, extra):
            if status == 'capturing':
                blocks = extra.get('blocks') or []
                if blocks and len(blocks) > len(task_live):
                    task_live.append(blocks[-1].get('score') if blocks[-1].get('valid') else None)
                _update(uid, {'status': 'capturing', 'phase': 'task', 'blocks_captured': extra.get('window_idx', 0),
                              'blocks_needed': n_task, 'live/task': task_live})
            elif status == 'window_skipped':
                _update(uid, {'last_reason': 'Window skipped: not enough clean heart-rate data or too much movement.'})
            elif status == 'saving':
                _update(uid, {'status': 'saving', 'phase': 'task'})
            elif status == 'recovery':
                if extra.get('window_idx'):
                    rec_live.append(extra.get('score'))
                _update(uid, {'status': 'capturing', 'phase': 'recovery', 'blocks_captured': extra.get('window_idx', 0),
                              'blocks_needed': N_RECOVERY_WIN, 'live/recovery': rec_live})
            elif status == 'done':
                _update(uid, {'status': 'done', 'phase': 'done', 'result': {
                    k: extra.get(k) for k in ('status', 'personal_stress_threshold', 'baseline', 'task_level',
                                              'needed_separation', 'recovery_mean', 'recovered', 'n_task_windows', 'aba_confirmed')}})
            elif status == 'error':
                _update(uid, {'status': 'failed', 'error': extra.get('message', 'limit test failed')})

        run_task_calibration_capture(uid, on_progress=on_task, n_task_win=n_task)
    except Exception as e:
        _update(uid, {'status': 'failed', 'error': str(e)})
    finally:
        set_busy(uid, False)


def start_poller(is_busy, set_busy):
    """Background thread: watches ring_recalibration/ for 'requested'.
    is_busy(uid) -> True while the app's own Calibrate/limit test runs for
    that user (the request is then refused, not queued)."""
    def loop():
        while True:
            try:
                reqs = _global_ref(NODE).get() or {}
                for uid, req in reqs.items():
                    if not isinstance(req, dict) or req.get('status') != 'requested':
                        continue
                    if is_busy(uid):
                        _update(uid, {'status': 'failed', 'error': 'A calibration is already running for this user.'})
                        continue
                    claimed = _claim(uid)
                    if claimed:
                        threading.Thread(target=_run, args=(uid, claimed, set_busy), daemon=True).start()
            except Exception as e:
                print(f"[ring-recal] poll failed: {e}")
            time.sleep(POLL_SEC)

    threading.Thread(target=loop, daemon=True, name='ring-recalibration-poller').start()
    print(f"[ring-recal] watching {NODE}/ every {POLL_SEC}s")
