# MindPulse ring validation: how to run it

Three tests, one video. This checks that the ring's readings are realistic and
agree with a reference. It is a plausibility and agreement check, not a clinical
validation.

| Test | Proves | People | Pass line |
|---|---|---|---|
| T1 Heart rate vs pulse oximeter | Ring heart rate agrees with a reference | 1 person (add the 4 T3 people for a resting reading) | mean absolute error < 5 bpm |
| T2 GSR stimuli | Skin conductance responds to known stimuli | same person as T1 | rise within about 1-5 s, repeats 3 times |
| T3 Quality gates and latency | Bad windows are refused; values update quickly | 4 people | 100% of motion and finger-off attempts rejected; median latency < ~60 s |

## 0. One-time preparation (about 1 hour)

1. Push the latest code and let Render redeploy. Check that the start-up log shows
   `Model: XGBClassifier` and `Features: 23`. The model on Render must be the v3 one.
2. **Recalibrate every person who will be tested** (calm-breathing calibration in
   the app, then the limit test if you want a personal threshold). Old baselines
   were made with the old model.
3. Charge the ring. Confirm "ring online" in the app for 5 minutes.
4. Start the bridge on the PC that receives the ring's MQTT data:
   `python -m backend.physiological.mqtt_bridge` from the repository root.
   If the backend is on Render, set `PHYSIOLOGICAL_FLASK_URL` to its `/predict`
   address first. Keep this terminal visible: **rejected windows are printed there.**
5. Things to have on the table: ring, fingertip pulse oximeter, a cold bottle,
   stopwatch, a phone or camera on a stand, a laptop showing the web dashboard
   (clinical view), and a printed copy of the three log templates.
6. Python needs `numpy` and `matplotlib` (the project's `stress_env` has them).
   Run all scripts from this `validation/` folder.

## 1. How to wear it

- Ring on the **index finger**, sensor on the fingertip pad, snug but not tight.
- GSR electrodes on two fingers of the **same** hand as the ring.
- Oximeter on a finger of the **other** hand.
- Seated, back supported, both hands resting at heart level.
- Warm, dry hands. No caffeine for 1 hour, no exercise for 15 minutes.
- Do not talk or move the hands during a reading.

## 2. Order for each person

1. Sit still for 2 minutes.
2. Calm-breathing calibration (about 3.5 minutes), hands still.
3. T1 (heart rate), then T2 (GSR) for the main person; T3 for the four people.

Every 20 seconds the bridge sends a 60-second window, so a reading appears about
every 20 s. Use readings taken after the first full minute of each condition.

## 3. T1: heart rate (main person, about 12 minutes)

Conditions (5 readings each, 2 minutes rest between conditions):
`rest`, `after_exercise` (30 stairs or 1 minute of star jumps, then sit and start
within 20 s), `slow_breathing` (6 breaths per minute).

For each reading:
1. Look at the oximeter and write its pulse rate every 10 seconds for 60 seconds
   (6 numbers) and take the average. That is `ref_hr`.
2. At the end of that minute, read the ring's heart rate (`MeanHR`) from the app,
   or run `python fetch_ring.py --user <name> --minutes 40` afterwards and take it
   from the matching time. That is `ring_hr`.
3. Copy `t1_log_template.csv` to `t1_log.csv` and fill in the rows.

Then:
```
python analyze_t1.py t1_log.csv
```
You get a table per condition, an overall mean absolute error, and
`t1_result.png` (Bland-Altman plot and agreement plot) for the video.

## 4. T2: GSR stimuli (same person, about 10 minutes)

Run each stimulus 3 times with 60 seconds of calm in between:
`deep_breath` (one sharp deep breath), `cold_object` (hold the cold bottle for 10 s),
`arithmetic` (count down from 500 by 13 for 30 s).

1. Write the **clock time** (HH:MM:SS) when each stimulus starts into
   `t2_log_template.csv` (copy to `t2_log.csv`). Use the same clock for all.
2. Right after the session:
```
python fetch_ring.py --user <name> --minutes 40
python analyze_t2.py ring_gsr_<name>.json t2_log.csv
```
You get the baseline, the peak, the rise, the delay and whether a response was
detected for every stimulus, plus `t2_result.png`.

If the clocks differ by more than a second or two, note the difference and
adjust the times in the log.

## 5. T3: quality gates and latency (4 people, about 8 minutes each)

For each person, after calibration:
- **motion** (3 attempts): shake the hand hard for 20 seconds. The bridge terminal
  should print `motion_rejected: True` and `Window rejected - too much movement`.
- **finger_off** (3 attempts): take the finger out of the ring for 30 seconds. The
  terminal should print `hrv_fallback` / `insufficient clean IBI data`, or the app
  shows the ring as "finger not detected".
- **latency** (5 trials): start the stopwatch at a clear event (for example a
  deep breath, or the moment a 60-second window completes), stop it when the new
  value appears on the screen. Write the seconds.

Fill `t3_log_template.csv` (copy to `t3_log.csv`). For motion and finger_off,
`outcome` is `rejected` if the window was refused, `scored` if it was scored anyway.

```
python analyze_t3.py t3_log.csv
```

## 6. Video (about 5 minutes)

| Time | Content |
|---|---|
| 0:00 | What is checked and why (not a medical claim) |
| 0:20 | The ring and the oximeter, and how they are worn |
| 0:45 | T1: both screens in one shot at rest, after exercise, slow breathing; end with `t1_result.png` |
| 2:15 | T2: live GSR chart for breath, cold bottle, arithmetic; end with `t2_result.png` |
| 3:30 | T3: shake gives a rejected window in the terminal; finger off; latency stopwatch |
| 4:30 | Results table and the limits (see below) |

Say the limits out loud:
- The oximeter is a consumer reference, not medical-grade.
- Heart-rate variability intervals cannot be validated without an ECG.
- The sample is small (one main person, four for the quality tests).
- The ring was checked for plausibility and agreement, not accuracy in the clinical sense.

## 7. What to write in the thesis (Section 6.2)

- T1: n, bias, MAE and limits of agreement per condition (from `t1_result.csv`).
- T2: for each stimulus the rise and the delay (from `t2_result.csv`).
- T3: attempts rejected out of attempts, median and worst latency (`t3_result.txt`).
- The uncontrolled plausibility check of 854 live windows (`thesis/figures/fig_ring_vs_wesad_ranges.png`).

## Files in this folder

| File | Use |
|---|---|
| `fetch_ring.py` | Pull a user's recent windows and GSR previews from the live database |
| `analyze_t1.py` | Heart-rate agreement table and Bland-Altman plot |
| `analyze_t2.py` | GSR stimulus response table and plot |
| `analyze_t3.py` | Quality-gate and latency summary |
| `t1_log_template.csv`, `t2_log_template.csv`, `t3_log_template.csv` | Logging sheets to copy and fill in |
