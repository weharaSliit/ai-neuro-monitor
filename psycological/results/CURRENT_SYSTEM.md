# Current System — Methodology, Validation, Results

Scope: only what is actually deployed/used right now. For the full
exploratory history (rejected approaches, why they were rejected, every
experiment that led here), see `results/methodology/00_INDEX.md` onward —
this document deliberately does not repeat that narrative, only its
conclusions where they explain a current design choice.

## 1. What's deployed

```
T7/T8 (ear-worn, 2 electrodes + 1 mastoid reference/bias)
  -> ADS1292R @ 250 SPS -> ESP32 -> MQTT
  -> glitch/spike filter + uniform-250Hz-grid interpolation
  -> resample 250Hz -> 128Hz
  -> notch + 0.5-45Hz bandpass
  -> bipolar (T7-T8) differential feature extraction
  -> logistic_regression model (bipolar-only, LOSO AUC 0.706)
  -> task_state_score (calibrated_p)
  -> persistence-gated decision states
  -> Firebase Realtime Database (phsycological/{session}/{window})
```

Data source for training: SAM40 (40 subjects, T7/T8, `label_task`: Relax=0,
{Stroop, Arithmetic, Mirror-image}=1). This is the only label in this
project with real, replicated LOSO signal — self-report-based labels
(`label_rating`, per-subject trajectory) are near-chance regardless of
channel count, so the system estimates objective *task-state* (cognitive
demand), not validated subjective *stress*. All output naming reflects
this (`task_state_score`, not `stress_score`).

## 2. Data acquisition (training data, not real-time hardware)

This covers where the *training* data for the currently deployed model
comes from -- the SAM40 dataset itself, loaded offline. It's a separate
concern from the real-time hardware's own data acquisition (ESP32/ADS1292R/
MQTT, Section 7) and doesn't overlap with it.

**Source**: `data/SAM40/filtered_data/*.mat`, one file per (subject, task,
trial), loaded via `src/sam40/loader.py`. Filenames follow
`{task}_sub_{subject}_trial{trial}.mat`; each file's `Clean_data` key holds
a `(32, 3200)` float64 array -- 32 channels at 128Hz for 25 seconds. The
`filtered` source (`Clean_data`) is used, not `raw_data`'s `Data` key
(SAM40's own pre-cleaning applied by the dataset's creators, upstream of
and separate from this project's own bandpass/CAR processing) --
`--source filtered` is `build_dataset.py`'s default.

**Structure**: 40 subjects x 4 conditions (Relax, Stroop, Arithmetic,
Mirror-image) x 3 trials each = 480 total 25-second recordings. Only
Relax has no self-report rating; the other three each have a 1-10 rating
per trial from `data/SAM40/scales.xls` (`src/sam40/labels.py`), read via a
two-row-header sheet (`Trial_{1,2,3}` blocks, each split into Maths/
Symmetry/Stroop sub-columns).

**Channel montage and the bug it caught**: channel order comes from
`data/SAM40/Coordinates.locs` (`src/sam40/channels.py`) -- SAM40's actual
recording order, which is NOT the same as DEAP's 32-channel order (SAM40
uses FT9/FT10/PO9/PO10 where DEAP uses AF3/AF4, and the ordering differs
throughout). An early version of this project's channel-renaming script
assigned DEAP's order to SAM40 data, which would have mislabeled T7/T8 --
caught and fixed before any labeled data was generated. In SAM40's true
order, `T7_IDX=9`, `T8_IDX=24` (0-based).

**What the currently-deployed model actually trains on**: only the T7 and
T8 rows are extracted from each 32-channel trial (`--channels T7 T8`),
after the full 32-channel array has already been bandpass-filtered and
common-average-referenced (`preprocess_trial()` -- CAR must run on the
full montage *before* channel selection, or it's a materially different,
much weaker operation). Label used: `binary_label_from_task()` -- Relax=0,
any of {Stroop, Arithmetic, Mirror-image}=1 (`label_task` in the feature
table) -- the only one of SAM40's three candidate labels with real,
replicated LOSO signal (Section 1). The resulting 480-row, 25-second-block
feature table (`results/features_bipolar_only_25s_block.csv`, bipolar-only
column subset) is what `results/models_25s_block_bipolar_only/` was
actually trained on.

## 3. Feature set (bipolar-only)

**Why bipolar-only, not the richer CAR-dependent set**: the offline model
trained on T7/T8 after common-average-referencing (CAR) against SAM40's
full 32-channel montage reaches a higher LOSO AUC (0.795), but CAR
requires a 32-channel average this 2-electrode hardware can never
reproduce. Training and serving on the same feature space eliminates that
mismatch entirely rather than mitigating it, at the cost of a lower
ceiling (0.706 AUC). This is the deployed default; the 0.795 CAR model
remains available only as an offline upper-bound comparison
(`results/models_25s_block/`), not for live inference.

**29 features**, all derived from the single virtual channel
`bipolar = T7 - T8` (reference-agnostic by construction — the same
difference regardless of what either electrode is referenced against):
delta/theta/alpha/beta/gamma band power (absolute, relative, log), theta/
alpha, beta/alpha, theta/beta ratios, Hjorth activity/mobility/
complexity, spectral entropy, sample entropy, spectral slope, time-domain
stats (mean/std/rms/ptp). No cross-channel connectivity features (coherence/
PLV/PLI) — those need two independent channels; bipolar collapses to one.

**Baseline z-score normalization was tested on this exact feature set and
rejected**: self-standardizing SAM40's 3 Relax blocks/subject against
their own mean/std is a fixed statistical degeneracy (any 3 self-referenced
values satisfy `sum(z)≈0` regardless of content), inflating LOSO AUC to an
invalid ~0.996. Not deployed. The real-time pipeline's `infer_block`/
`calibrate_block` also compute `_blrel`/`_slope3` baseline-relative columns
for the T7/T8 per-channel (not bipolar) features — a leftover of the
original CAR-model pipeline's feature set. The currently deployed bipolar-only model's
`feature_columns` are plain `bipolar_*` names only, so these `_blrel`/
`_slope3` columns are computed at inference time but not read by the
deployed model at all.

## 4. Model

| | |
|---|---|
| Artifact | `results/models_25s_block_bipolar_only/sam40_t7t8_state_model.joblib` |
| Family | `logistic_regression` (StandardScaler + LogisticRegression, class-weight balanced) |
| Granularity | Direct 25-second block feature extraction (one row per trial, not averaged windows) |
| LOSO AUC | **0.706** |
| LOSO balanced accuracy | 0.594 |
| Training-fold normalization | `StandardScaler` fit only on each LOSO fold's training subjects (verified: fitting on 440 rows leaves `.mean_` unchanged after scoring a held-out 40-row fold) — leakage-safe by construction, not a new addition, standard practice throughout this project |

**Model selection**: chosen from 5 families (SVM, RandomForest,
LogisticRegression, HistGradientBoosting, MLP) evaluated identically via
subject-grouped LOSO on the bipolar-only feature set; `logistic_regression`
won. Block-level direct extraction (vs. averaging window-level predictions)
is the single largest lever in this project (+0.06 to +0.15 AUC over
window-level, larger than any feature-engineering addition).

**Knowledge distillation was tried and does not appear in the deployed
system**: teacher (32ch or subset) -> T7/T8 student, tested across 6+
configurations (window/block level, teacher choice, with/without bipolar
or derived features). Never meaningfully improved on the plain model. Not
part of the current pipeline.

**Calibration status**: grouped nested Platt scaling on this exact
bipolar-only model (Section 5) substantially improves ECE (0.224 -> 0.033)
and Brier/log-loss, but no standalone, reusable calibrator object was
persisted from that run (fold-specific calibrators are discarded after
evaluation, by design, to avoid leakage). The real-time pipeline's
`calibrated_p` is therefore currently the model's raw `predict_proba`
output, not a calibrated probability in the validated sense — a known,
documented gap, not an oversight.

## 5. Model evaluation (statistical performance analysis)

Full LOSO comparison across all 5 model families on the bipolar-only
feature set (`results/models_25s_block_bipolar_only/model_comparison.csv`):

| model | accuracy | balanced_accuracy | f1 | roc_auc |
|---|---|---|---|---|
| **logistic_regression** (deployed) | 0.608 | 0.594 | 0.662 | **0.706** |
| svm | 0.604 | 0.558 | 0.657 | 0.673 |
| hist_gb | 0.706 | 0.563 | 0.803 | 0.643 |
| random_forest | 0.671 | 0.558 | 0.762 | 0.641 |
| mlp | 0.598 | 0.549 | 0.657 | 0.624 |

`logistic_regression` wins on AUC and balanced accuracy -- the metrics
that matter given SAM40's class imbalance (Relax is the minority: 1
condition vs. 3 task conditions). `hist_gb`/`random_forest` post higher
raw accuracy/F1 by defaulting toward the majority class, which is why
accuracy/F1 were not used as the selection criteria anywhere in this
project.

**Discriminative performance** (`scripts/bipolar_statistical_analysis.py`,
`results/final_analysis/bipolar_metric_suite.csv`):

| Statistic | Value | 95% CI | vs. chance |
|---|---|---|---|
| Mean-per-subject AUC | **0.706** | [0.635, 0.771] | excludes 0.5 |
| Pooled AUC | 0.632 | [0.577, 0.692] | excludes 0.5 |

Two different, both-legitimate statistics: pooled treats every block as
independent; mean-per-subject averages each subject's own AUC first (the
one matching "0.706" everywhere else in this document).

**Per-subject AUC varies enormously** (`bipolar_per_subject_auc.csv`,
`results/plots/per_subject_auc_distribution.png`) -- the pooled/mean
numbers above hide this: **8 of 40 subjects (20%) score below chance**
(worst: AUC=0.074), while ~18 subjects sit at AUC>=0.8 and 4 hit a
perfect 1.0. Mean (0.706) and median (0.741) diverge because the
below-chance tail pulls the mean down. The model is not uniformly useful
across people -- for roughly 1 in 5 subjects in this dataset it is
actively anti-predictive, not merely weak.

**ANOVA across task category**: F=6.71, p=1.93x10^-4 -- the four
conditions differ significantly in mean calibrated score.

**Relax vs. each stress task** (Welch's t-test, Cohen's d):

| Comparison | t | p | Cohen's d |
|---|---|---|---|
| Relax vs. Stroop | +3.04 | 0.0027 | 0.39 (small) |
| Relax vs. Arithmetic | +3.91 | 0.0001 | 0.51 (medium) |
| Relax vs. Mirror-image | +3.49 | 0.0006 | 0.45 (small-medium) |

**Task-state score vs. self-reported rating** (the correlation check this
label-quality question always needs, per Section 1): trial-level Pearson
r=-0.128 (p=0.015, statistically significant but negative and weak --
~1.6% of variance explained); between-subject r=-0.285 (p=0.075, not
significant). With n=360, a trivial effect reaches significance -- this
does not contradict the standing finding (Section 1) that self-reported
stress is not recoverable from this EEG; a wrong-signed, negligible-effect
correlation is not evidence the model tracks subjective stress.

**Diagnostic plots**: `results/plots/logistic_regression_bipolar_only_diagnostics.png`
(ROC curve, calibration/reliability diagram, top-15 feature coefficients,
score distribution by class) -- the score-distribution panel shows
substantial overlap between Relax and Task blocks in the 0.4-0.7 range,
the visual counterpart of a 0.706 (not near-1.0) AUC.

## 6. Decision logic

`src/sam40/decision.py`, `compute_states()`, applied to the running
series of block scores within a session. `DecisionThresholds`' probability
defaults were originally picked by inspecting the overall LOSO score
distribution by eye -- not leakage-controlled, not validated against
held-out subjects, and (see below) subsequently shown to behave badly.
That's been replaced by a proper methodology, and **the code default has
been updated** (2026-08-18) to the result -- this section documents how.

| State | Trigger (current code, deployed) |
|---|---|
| `high_load_alert` | `calibrated_p >= 0.758` for >=3 consecutive blocks |
| `micro_break_recommended` | `calibrated_p >= 0.775` for >=20 consecutive blocks |
| `fatigue_warning` | spectral slope steepening + theta ratio above this session's own 75th percentile, sustained >=60 blocks |
| `cooldown_logged` | transition from `>=0.758` to `<=0.725` |

Persistence *counts* (3/20/60 blocks) are in **blocks** (25s each), not
literal minutes — the spec's original "10 min"/"30 min" language was
translated to block counts, but SAM40 (25s isolated trials) has no
continuous multi-block sequences per subject to validate whether these
specific counts are right at real multi-minute timescales. These duration
requirements are carried through **unchanged as operational
requirements** — not validated by anything below.

### How the probability thresholds were chosen

Unlike the duration requirements, the probability *thresholds* ARE
testable with SAM40's block-level data, as an instantaneous (single-block)
trigger question. Architecture kept deliberately decoupled from the model
(per explicit design decision) so threshold sets can be swapped and
compared without retraining:

```
Model -> calibrated_p -> Threshold configuration -> Persistence logic -> State
```

**Step 1 -- nested, leakage-controlled candidate generation**
(`scripts/nested_threshold_selection.py`):

> Decision thresholds were selected using nested, subject-grouped
> validation. For each outer LOSO fold, calibrated out-of-fold
> probabilities from an inner grouped cross-validation (within the 39
> training subjects only) were used to characterize the empirical
> probability distribution and generate candidate percentile-based
> operating points. Candidates were scored against state-specific
> objectives -- sensitivity subject to a false-alert-rate cap for
> high-load/break, false-recovery rate for cooldown -- using only inner
> (training-subject) data. The winning threshold was locked and applied,
> unchanged, to the outer held-out subject; the calibrator and thresholds
> never see that subject's data at any level.

This landed far from the original hand-picked values, with high stability
across all 40 outer folds (std ~0.004-0.005 per threshold):
high_load 0.70->0.794, break 0.75->0.810, cooldown_low 0.30->0.696.

**Step 2 -- three-way comparison before choosing** (per explicit
instruction: don't just swap in the nested-selected values without
checking how they actually behave). `scripts/threshold_set_comparison.py`
ran three parts against three candidate sets:

- **A. Distribution** of `calibrated_p` (SAM40 LOSO): P5=0.629, P10=0.665,
  P25=0.712, P50=0.758, P75=0.791, P80=0.800, P85=0.809, P90=0.819,
  P95=0.835 (`calibrated_p_percentiles.csv`).
- **B. State behavior**, simulated with the real persistence-gated state
  machine over 40 synthetic 12-block sessions (SAM40's own in-domain
  calibrated scores, Relax x3->Stroop x3->Arithmetic x3->Mirror x3 per
  subject -- see script docstring for why STEW was tried first and
  abandoned: applying this model to STEW's features produced a
  scale-mismatch artifact, raw scores collapsing to ~0, not a real
  signal):

  | Set | high_load / break / cooldown_low | Alerts/session | Sessions w/ alert | Cooldown events | %time high-load | Flips/session |
  |---|---|---|---|---|---|---|
  | A (original) | 0.70 / 0.75 / 0.30 | 6.10 | 95% | **0.00** | 79.6% | **1.70** |
  | B (nested-selected) | 0.794 / 0.810 / 0.696 | 1.05 | 25% | 0.15 | 22.9% | 0.38 |
  | **C (sensitivity-optimized, DEPLOYED)** | **0.758 / 0.775 / 0.725** | 2.55 | 55% | 0.825 | 50.0% | 0.83 |

  (Cooldown-event counts were corrected after an initial run of this
  comparison: `threshold_set_comparison.py` originally left `cooldown_high_p`
  -- the "was high" bar `cooldown_logged` checks before a drop -- unset for
  sets B/C, silently inheriting whatever `DecisionThresholds`' dataclass
  default happened to be rather than each set's own `high_load_p`. Fixed
  to explicitly mirror each set's own threshold, matching how set A and
  the final deployed thresholds are defined; the corrected numbers above
  replace an earlier inconsistent 0.95/1.90.)

  Set A is not a usable alerting mechanism: it fires on 95% of sessions,
  flags 80% of all time as "high load," and `cooldown_logged` can
  **never** fire (0.30 is never reached by this model's actual score
  range). Set B is highly specific but fires on only 1 in 4 sessions.
  Set C is the deliberate middle ground.
- **C. Temporal sanity**: example real sequence (subject 1,
  Relax x3->Stroop x3->Arithmetic x3->Mirror x3): `[0.699, 0.811, 0.751,
  0.700, 0.740, 0.713, 0.824, 0.750, 0.756, 0.814, 0.750, 0.739]`. Set A
  fires and stays fired from block 7 -- looks clean here, but only because
  this subject's nominal "Relax" blocks already sit at 0.70-0.81 (one of
  the noisier per-subject cases, Section 5); A's flip rate is highest
  project-wide (1.70/session), so this example isn't representative. Sets
  B and C both never fire for this subject: three individual blocks
  exceed each threshold but never 3 *consecutive* ones, so persistence
  gating correctly suppresses the alert -- a real, useful finding that
  persistence and threshold choice interact (a threshold can be crossed
  repeatedly and still never trigger if the crossings aren't consecutive).

**Decision: Set C deployed.** `high_load_p=0.758`, `break_p=0.775`,
`cooldown_low_p=0.725` (`cooldown_high_p` mirrored to `0.758`, matching
the original design where it tracked `high_load_p`). Chosen over B
because B's near-total silence (fires on only 1 in 4 sessions) trades
away too much detection for specificity; chosen over A because A doesn't
discriminate at all. This is a judgment call between two real costs
(false alarms vs. missed detections), not a value with a single
objectively-correct answer -- documented here so the trade-off is
visible, not hidden inside a hardcoded number.

Full outer-fold, truly-held-out honest performance numbers (from the
nested selection, closest available proxy for Set C's real-world
behavior) remain modest: at the nested-selected (Set B) operating point,
outer sensitivity was 26.9% at a 15.0% false-alert rate for high_load,
16.7%/8.3% for break. Set C sits at a more permissive point on the same
curve (higher sensitivity, higher false-alert rate, by construction) --
not separately re-measured on truly held-out outer folds, only validated
via the A/B/C session-behavior comparison above. This remains a real,
open limitation: no threshold choice here has been shown to give a
*strong* false-alarm/detection trade-off, only a deliberately chosen
*point on* that trade-off.

## 7. Real-time pipeline (`src/realtime/`)

**Signal-quality gate** (`quality_gate.py`, `TrustedIoTEEGValidator`):
every block is checked before scoring — 9-factor amplitude/spectral gate,
SNR, Itakura spectral-distance check against the first trusted calibration
block, and an ML soft-quality rating. Assesses the SAME signal
`pipeline.preprocess_block()` actually produces for the model (raw-code
checks -- completeness/clipping/flatline -- use raw ADC codes; everything
else uses the real filtered signal) -- previously ran a separate, weaker
re-derivation of filtering internally, confirmed to report amplitude up to
~25x higher than what the model actually received on real captured data;
fixed. `max_amplitude=7000uV`, checked against every real-hardware reading
collected during this project and confirmed well-positioned, not changed.
PLI-vs-phase-shuffled-surrogate coupling is computed and reported but is
diagnostic-only, not a rejection criterion -- it was capable of rejecting
known-clean SAM40 reference signal (weak/near-zero block-level T7-T8
coupling is a real, expected property of this channel pair, not evidence
of bad signal).

**Session health** (`SessionQualityMonitor`): rolling 8-block rejection
rate, classified `CLEAN` (<=20% rejected) / `USABLE` (<=50%) /
`SETUP_FAILURE` (>50%) against a literature-benchmark scale (not yet
calibrated against this project's own labeled sessions).

**Calibration acceptance rule**: a block must reach `GOOD` (not merely
avoid `POOR`) to be used as this user's baseline. Grounded in real data:
every known-clean epoch scored >=85.4 (`GOOD`); every calibration block
from a session with a real hardware fault topped out at 79.9
(`QUESTIONABLE`) and never reached `GOOD`. If zero blocks reach `GOOD`
within the calibration window, the session hard-stops by default
(`--calibration-fallback stop`) rather than proceeding with an
empty/meaningless baseline; `--calibration-fallback best-available` opts
into an explicitly-flagged (`baseline_degraded=True` on every subsequent
output) degraded baseline instead, for exercising the rest of the
pipeline without pretending the data is trustworthy.

**Adaptive baseline drift tracking** (`AdaptiveBaselineTracker`,
monitoring-only): tracks slow drift in what "calm" looks like over a
session via an EMA, updated ONLY from blocks that already score at/below
the session's own `cooldown_low_p` -- i.e. blocks the model itself
currently reads as calm. Deliberately does not adapt from every block:
doing so would let a genuine sustained high-load episode slowly get
absorbed into the baseline and never trigger `high_load_alert`.
Unsupervised (no ground-truth label used or available) and self-
referential (uses the model's own low-probability output as the calm
proxy) -- `baseline_drift` is exposed on every trusted block's output as
a soft diagnostic, not a validated correction signal: there is no labeled
data yet to confirm it tracks real electrode/hardware degradation rather
than genuine low-arousal variation. **Does not feed back into
`calibrated_p` or any decision** -- the deployed bipolar-only model
doesn't read baseline-relative (`_blrel`) features at all (Section 3), so
there is currently nothing for a drift correction to feed into without a
separate, larger design decision (retraining on drift-corrected features).
Built in response to the question of whether continuous/adaptive learning
could address the per-subject variability found in Section 5 (8/40
subjects below-chance) -- this is the safe, unsupervised half of that
idea; true supervised continual learning isn't feasible here since no
reliable ground-truth label exists in live deployment (self-reported
stress doesn't correlate with this EEG anywhere in this project).

**Raw-telemetry cleanup** (`raw_cleaning.py`, real-time path only, not
applied to offline training data): glitch/spike removal (absolute
10,000uV ceiling or 5x rolling-MAD, 0.1s window, empirically tuned to
avoid false-flagging genuine EEG oscillation), and interpolation of the
firmware's per-sample `millis` timestamps onto a uniform 250Hz grid
(corrects WiFi/MQTT jitter/drops before the fixed-rate resample step).
Sustained faults (>50% of a block flagged) are deliberately left
unmodified rather than interpolated through near-total signal loss — that
class of fault is the quality gate's job, not this function's.

**Firebase Realtime Database sync** (`firebase_sync.py`, optional): pushes
one record per block to `{root_path}/{session_id}/{window}` (default
root_path `phsycological`), matching a fusion-ready schema
(`task_state_score`, `task_state_label`, `task_state_trend`,
`eeg_quality_score`, `eeg_quality_flag`, `eeg_missing`, timestamps,
`model_version`, `feature_set`) intended for future HRV/GSR fusion. EEG
outputs `task_state_score` only — never `stress_score` or equivalent, per
the finding in Section 1 that self-report/stress is not what this model
validates.

## 8. Validation

- **Offline**: subject-grouped LOSO throughout (`LeaveOneGroupOut` on
  subject ID); bootstrap CIs (10,000 resamples) on the headline AUC.
- **Software correctness (replay test)**: real SAM40 signal round-tripped
  through synthetic ADC codes, through the full real pipeline code path
  (ADC decode -> raw-cleaning -> resample -> filter -> features -> model ->
  decision). Current bipolar-only model: Relax=0.508, Mirror=0.594,
  Arithmetic=0.759, Stroop=0.739 — correct ordering preserved (Relax
  lowest), though these particular replayed scores don't cross the
  persistence-gated alert thresholds in this run (weaker separation than
  the CAR model, consistent with its lower 0.706 vs 0.795 ceiling). This
  validates the *code path*, not real-hardware signal quality.
- **ADC decode bench test**: self-test (`adc_bench_verify.py`) recovers a
  known synthetic signal's amplitude within 0.2% and correctly detects a
  deliberately injected gain error. Not yet run against the *physical*
  device's actual output.
- **Live hardware end-to-end: not yet validated, but the picture improved
  substantially.** Every real calibration session before this fix scored
  `QUESTIONABLE` (61.5-79.9), never `GOOD`. Re-running the exact same
  captured raw data (`session_raw.csv`) through the corrected,
  consistent quality gate: all 3 blocks now score `GOOD` (88.1-94.3) and
  are correctly accepted as baseline -- a real architectural bug (gate
  assessing a different, worse-filtered signal than the model actually
  received), not solely a hardware fault, was responsible for a
  significant part of the earlier failures. A genuine, smaller-scale
  issue remains: FFT on that same raw data shows 78.6% of one channel's
  spectral power in the 48-52Hz mains band (severe common-mode rejection
  failure), and a physical-jumper short-input test separately showed a
  fault upstream of the electrodes (mean -3910uV, std 3638uV with inputs
  shorted, vs. an expected ~0uV) -- both still open, root cause
  (board/power vs. reference-electrode contact/wiring) not yet isolated,
  but no longer expected to be as severe as the original 40-320mV
  readings suggested. Next live session should be re-attempted with the
  fixed gate before further hardware changes.

## 9. Results (current deployed model)

| Metric | Value |
|---|---|
| LOSO AUC (bipolar-only, block-level) | 0.706 |
| LOSO balanced accuracy | 0.594 |
| Offline CAR-model AUC (upper-bound reference only, not deployed) | 0.795, 95% CI [0.732, 0.853] |
| What the score means | `P(cognitively demanding task \| T7-T8 bipolar EEG)` — task-state, not validated stress |
| Cross-dataset replication | Independent HCI dataset, C5/C6 analog pair: AUC 0.609 vs. SAM40 T7/T8's 0.606 (label_task) -- same order of magnitude |

## 10. Evaluated and explicitly NOT part of the current system

- **CAR-dependent full feature set as the deployment model** — higher
  offline AUC (0.795) but carries a training/inference reference mismatch
  live hardware can't close; kept only as an offline benchmark.
- **Knowledge distillation** (any teacher/student configuration) — never
  meaningfully improved over the plain model.
- **Subject-level baseline z-score normalization** — statistically invalid
  at 25s-block granularity (leakage from self-standardizing n=3 samples).
- **Personalized (leave-one-trial-out) calibration** — failed; SAM40
  provides too little per-subject data.
- **`label_rating` / per-subject trajectory labels** — near-chance even
  with the full 32-channel montage; not used as a training target.
- **Frontal channel sets (F3/F4/Fz/Cz) / alternative ear-adjacent pairs
  (CP5+FT10, C5/C6)** — explored as alternatives to T7/T8; project stayed
  with T7/T8 for the ear-worn form factor despite T7/T8 showing no
  particular AUC advantage over other pairs.
- **STEW / cross-dataset domain adaptation (CORAL, per-feature
  Wasserstein)** — used for validation/generalization checks only, not
  part of the deployed inference path.
