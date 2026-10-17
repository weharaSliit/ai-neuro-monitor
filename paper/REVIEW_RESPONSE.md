# Response to the external review (2026-09-29)

## Second revision: refocused on channel reduction and terminology

The paper is now built around one idea: reduce a 32-channel EEG cap to two
temporal electrodes (T7−T8) for everyday wearables, and combine them with
GSR and HRV. New title: *From a Full EEG Cap to Two Temporal Electrodes:
Cognitive Load Estimation for Everyday Wearables Combined with GSR and HRV*.

**New analysis** (`paper/analysis/channel_reduction.py`,
`results/R_channel_reduction.csv`): same 29 features and the same model
throughout, 40 people, LOSO.

| EEG signals | Electrodes | Per-person AUC |
|---|---|---|
| Full cap, 32 channels | 32 | 0.889 [0.851, 0.923] |
| T7 and T8, cap-average reference | 32 | 0.705 |
| **T7−T8** | **2** | **0.704 [0.631, 0.771]** |
| 8 other two-electrode pairs | 2 | 0.61–0.73; none significantly better than T7−T8 |

- The earlier claim "a 32-channel average reference would raise the AUC to
  0.795" is **not reproducible** from committed results: the committed
  112-feature cap-referenced T7/T8 model scores at most 0.655. It has been
  replaced by the table above.
- Distillation from a full-cap model does not recover the loss (0.701–0.705,
  from `psycological/results/plots/knowledge_distillation_comparison.png`).

**Terminology** (paper Table 1, used throughout):

- *cognitive load* (EEG output) and *arousal* (GSR/HRV output); neither is
  called stress. "Stress" now appears only in the name of the WESAD stress
  test and in dataset names.
- *GSR* instead of EDA (EDA is defined once); *GSR/HRV model* instead of
  "peripheral".
- *combined index*, *high flag* and *agreement* instead of "ABOVE" and
  "concordance".
- *component test*, *mechanism test* and *end-to-end test* instead of L1/L2/L3.

To make room, the model-family, task-contrast, score-scale, margin and
prior-sensitivity tables were folded into the text. Their numbers are
unchanged.

---

Paper: `paper/lncs/main.tex` (LNCS). Earlier version: the WhatsApp copy of
`main.tex` (unchanged). New analyses: `paper/analysis/revision3_analyses.py`,
which writes `results/M_*` to `results/Q_*`.

Run: `venv/bin/python paper/analysis/revision3_analyses.py` (about 3 min).

## New results

| # | Analysis | Result | Where in paper |
|---|---|---|---|
| M | Nested model-family selection for EEG (5 families, inner 5-fold GroupKFold) | Logistic regression chosen in **40/40** outer folds, so the nested AUC is 0.706 [0.633, 0.773], identical to the reported value. | Methods 4.1, Table 3 |
| M | Five-family table re-run with one code path | SVM and LR unchanged. The old MLP, RF and HGB rows did not match `model_comparison.csv`, so they were replaced (MLP 0.659, RF 0.653, HGB 0.652). | Table 3 |
| N | Permutation test (labels permuted within subject, full LOSO, 1000 perms) | p = 0.001; null mean 0.500, null P95 0.570 | Results 5.1 |
| N | EEG baselines | Untrained single features 0.51 to 0.61 (best θ/α: 0.609); band-power-only LR 0.687 | Results 5.1 |
| O | Personalization with the configuration selected in nested fashion | ΔBA = **+0.040 [0.008, 0.074]**, p = 0.027. The nested pick is 1+1 blocks with z = 1.0 in 38/40 folds; that configuration also admits below-chance users. | Results 5.3, abstract |
| O | Sensitivity and false alerts by user group (2+2, z = 1.645) | Users accepted at least once: sensitivity 25.2% → 54.1%, false-alert rate **8.9% → 17.8%**. Never-accepted and below-chance users are unchanged. | Results 5.3 |
| P | EEG quality score under injected artefacts | AUC drops to 0.52 to 0.61 while mean q_CL stays at **96.9 to 99.9**, with almost no POOR blocks. Only a flat (disconnected) input scores 0. | New Sect. 5.5, Table 9 |
| Q | Clock offset between EEG and peripheral devices (matches the live 25 s capture-time bucketing in `backend/common/fusion.py`) | Fused flag changes in 5.5% / 17.5% / 29.4% of cells for 5 / 15 / 30 s offsets | Results 5.4 |
| — | EEG single-block sensitivity at the nested high-load threshold | Committed artifacts give **29.4% [20.8, 38.9] at 18.3% [10.0, 27.5]**. The old 26.9% / 15.0% could not be reproduced from any committed file. | Results 5.1 |

Two findings are negative and now appear in the paper: the EEG quality
score does not detect moderate artefacts (P), and personalization gains
sensitivity at the cost of roughly twice the false alerts in accepted users
(O). Before submission, decide whether to recalibrate the quality gate or
only report the result.

## Point-by-point status

Status key: **Text** = wording changed. **Analysis** = new computation.
**Pending** = needs data or an author action that could not be done here.

| Item | Reviewer point | Status | What changed |
|---|---|---|---|
| 1 | Fusion presented as validated | Text | Title now says "Component Validation and Mechanism Evaluation of a Proposed…". The abstract, contributions and conclusion state that end-to-end accuracy is not established. Section 3 is now "Concept of Use (Design Intent)". |
| 2 | Personalization selection bias | Text + Analysis (O) | Labelled exploratory. The nested-selection estimate is reported. z = 1.645 is no longer called "primary". |
| 3 | WESAD fallback values | Text | All `\providecommand` fallbacks removed; compilation stops if `generated/wesad_results.tex` is missing. That file now holds the values you supplied, and 587 + 326 = 913 checks out. **Pending:** confirm the values come from the final run of `wesad_subject_level.py`. |
| 4 | Bipolar derivation vs. real 2-electrode device | Text | Methods: "validates the signal representation, not the acquisition" (placement, amplifier, impedance, motion, CMRR). Also in Limitations. |
| 5 | `a_m` is not a reliability measure | Text | Renamed "fixed, dataset-level performance prior". Pooled vs. per-subject AUC justified, and the per-subject variant added to Table 8 (0.5% of flags change). |
| 6 | Gate is not an OOD detector | Text | New "Plausibility gate" paragraph uses the reviewer's wording and explains why the gate exists (raw scores of 1e-37 to 1e-67). |
| 7 | Unit of evaluation / bootstrap details | Text | Statistics section now defines the prediction unit, per-subject vs. pooled metrics, the percentile bootstrap, 10,000 vs. 2,000 resamples, subject clustering and no stratification. |
| 8 | WESAD AUC unusually high | Text + scripted | Paper explains the TSST speech and timing confounds and treats non-overlapping windows as co-primary. `wesad_subject_level.py --robustness` adds simpler models, feature groups, single-feature baselines, stricter transition exclusion, a permutation test and per-subject AUCs (smoke-tested on synthetic data only). **Pending:** run it on the WESAD feature table; I can then add the numbers. |
| 9 | Overlapping windows | Text | Non-overlapping results are co-primary. The text states that grouping does not remove within-person dependence. |
| 10 | Score-scale inconsistency | Text | Everything in the paper uses scale (b). The paper states that the prototype still emits (c) and must switch to (b), using a persisted population calibrator, before L3. **Pending (code):** make that switch in `backend/psychological/realtime/pipeline.py`. |
| 11 | z-scoring "leaks the label" | Text | The rationale is now precise: the 3 Rest blocks are both the normalization set and the only negative test blocks. |
| 12 | Model-selection bias | Analysis (M) | Nested selection result added. The WESAD model family is stated as fixed before evaluation. |
| 13 | CIs for key estimates | Text | Abstract and text now carry CIs for the EEG AUC, WESAD AUC, the personalization gain, and EEG sensitivity and false-alert rate. Table 3 has AUC CIs. WESAD sensitivity and FPR are point values only (the script's macros give no CI). |
| 14 | No synchronized experiment | Text | Paper is reframed as component and mechanism evaluation. **Pending:** pilot data, if the venue expects end-to-end validation. |
| 15 | Persistence rules | Text | Now "illustrative design parameters". The 60-block rule is renamed a "sustained-change prompt", not fatigue. Missing-block handling follows the code: rejected blocks are skipped and the counter does not reset. |
| 16 | Signal-quality validation | Text + Analysis (P) | Both quality formulas are defined, and the EEG corruption experiment has been added. **Pending:** peripheral artefact tests (need recordings). |
| 17 | Temporal synchronization | Text + Analysis (Q) | Alignment is described as the code implements it (capture-time 25 s buckets, no carry-forward). Clock-offset sensitivity added. |
| 18 | Personalization breakdown | Analysis (O) | Sensitivity and false-alert rates by group added. The text says "emulation within one visit" and notes that 5 users is too few for the test–retest SD. |
| 19 | "Stress" terminology | Text | Section 2 explicitly separates load, arousal, task-induced vs. subjective stress, fatigue, emotional arousal and exertion. |
| 20 | Application claims | Text | "Candidate applications" all use "could support", with a sentence saying none is supported by the present evidence. |
| 21 | WESAD wording | Text | "Discriminates baseline from TSST-condition windows… dataset-specific evidence." |
| 22 | Practical meaning of the ~0.03 effect | Text | Reviewer's sentence added to Results 5.1 and the abstract. |
| 23 | Baselines | Analysis (N) + script | EEG baselines added. Hard AND/OR fusion added to `fusion_comparison.py` for the L3 study. WESAD baselines are in the `--robustness` run. |
| 24 | Reproducibility details | Text | Versions (Python 3.12.14, scikit-learn 1.8.0, XGBoost 2.0.3, NumPy 2.4.4, SciPy 1.17.1, pandas 3.0.2), CPU (Apple M5), seeds, threading, precision. On-device claim reworded to "computational feasibility… subject to target hardware". |
| 25 | Placeholders | **Pending** | `\SupervisorName` is still red; the `[pending]` markers are gone. The AUC figure is now always included. |
| 26 | LNCS format / page limit | **Pending** | Not compiled here (no TeX installed). The paper grew by about one page (new Table 9 and text). Check the venue's page limit in Overleaf. |
| 27 | Citation accuracy | Partly | Claims without a source were reworded instead of given new citations: ECG vs. optical IBI equivalence is stated as untested, and on-device feasibility is limited to laptop measurements. **Pending:** check `looney2012` against the T7/T8 claim, and confirm SAM40/WESAD details against the papers. |

## Files changed

- `paper/lncs/main.tex`: revised paper
- `paper/lncs/generated/wesad_results.tex`: WESAD macros (new)
- `paper/analysis/revision3_analyses.py`: analyses M to Q (new)
- `paper/analysis/results/{M,N,O,P,Q}_*.csv`: outputs (new)
- `paper/analysis/wesad_subject_level.py`: `--robustness` (K7–K10); sensitivity and FPR macros now formatted as percentages
- `paper/analysis/fusion_comparison.py`: hard AND/OR baselines

---

## Third revision: personalization, and no probability calibration

- **Platt scaling removed.** The EEG model's raw score is used throughout.
  Every threshold is a percentile of scores or is anchored to the person, and
  AUC depends only on score order, so detection and false-alert figures are
  unchanged. Task effects recomputed on raw scores: d_z = 0.60 / 0.79 / 0.59,
  all p < 0.001 (they were 0.56 / 0.71 / 0.52 on calibrated scores).
- **Population fallback removed.** Every person gets a personal threshold.
  The comparison in the paper is "the same model with one fixed threshold
  for everyone".
- **New analysis** (`paper/analysis/personalization.py`,
  `results/S_personalization_*.csv`). Onboarding trials are never tested.

| Onboarding | Personalization | Detection | False alerts | ΔBA [95% CI] |
|---|---|---|---|---|
| 100 s | rest-anchored threshold | 30% → **41%** | 20% → **17%** | **+0.069 [0.018, 0.122]**, p = 0.037 |
| 50 s | personal feature baseline | 30% → 38% | 19% → 19% | +0.040; people with AUC < 0.5: 8 → 5 |
| 50 / 100 s | midpoint threshold | 61–63% | 33–38% | +0.07–0.09, but many more false alerts |

- The GSR/HRV personal baseline is now presented as a strength: balanced
  accuracy 0.827 → 0.892, AUC 0.962 → 0.984.
- **Caveat.** Eight personalization settings were compared. The rest-anchored
  rule and k = 0.84 (targeting about 20% false alerts) were fixed before
  running, but all three trials come from one visit, so the paper says
  stability across days is still to be confirmed.
- **Remaining inconsistency.** The mechanism simulations (clock offset,
  prior sensitivity, missing data) still draw EEG scores from the older
  calibrated SAM40 scores. They are mechanism tests, so the conclusions hold,
  but they can be rerun on raw scores if needed.

---

## Fourth revision: personal z scale implemented

- **New module:** `fushion engin/personal_scale.py`. It adds to the fusion
  engine without changing `compute_realtime_multimodal_fusion`, which the
  live prototype still uses.
  - `PersonalBaseline`: onboarding sets μ_rest; `z = (s − μ_rest)/σ`;
    responsiveness check (onboarding task z ≥ 0.5); slow update of the
    baseline from confident-rest windows; σ switches from the training
    people's value to the person's own rest SD after 20 rest windows.
  - `fuse_personal_z`: weight = quality × performance prior; combined
    z_F; alert when z_F ≥ k (0.84); agreement and one of four states;
    |z| > 8 treated as an artefact.
- **New analysis:** `paper/analysis/personal_scale_analysis.py` (about
  7 s), writing `results/Z1`–`Z4`.
  - Z1: with 100 s onboarding and z ≥ 0.84, detection 30% → 41% and false
    alerts 20% → 17% (ΔBA +0.069 [0.018, 0.122]). At z ≥ 1.28, false
    alerts are 8% and detection 25%.
  - Z2: onboarding task z predicts later EEG AUC (ρ = 0.72, p < 10⁻⁶). The
    check flags 15 of 40 people, including 9 of the 10 below-chance people;
    those who pass average AUC 0.81.
  - Z3: largest |z| on real blocks is 3.4, so the artefact limit of 8 is safe.
  - Z4: fusion mechanism tests in z units (scenarios, quality sweep, prior
    sweep, clock offset). These replace the earlier simulations that used
    calibrated EEG scores.
- **Paper sections updated:** Terms, Concept (onboarding), Methods (why
  not Platt, with per-person numbers; Personal Scale; Combining), Results
  (Personal Scale with Table 5; Combination Rule with Table 7), Discussion,
  Abstract, Conclusion.
- **Not yet done:**
  - The GSR/HRV personal scale uses simulated z values in the mechanism
    tests; its σ must be estimated on WESAD (the data is not in the repo).
  - The live prototype (`pipeline.py`, `fusion_live_session.py`) does not
    yet call `personal_scale`.
  - The baseline update and the per-session re-onboarding need continuous,
    multi-session data.

---

## Fifth revision: combination tests use real data for arousal as well as load

- `wesad_subject_level.py` now also writes `results/wesad_K11_arousal_z.csv`:
  held-out WESAD raw scores converted to personal z exactly as for EEG
  (onboarding = first 3 rest windows; σ = drift of later rest windows,
  measured on the other people).
- `personal_scale_analysis.py` reads that file when it is present. Arousal
  is then drawn from real WESAD windows; without it, arousal is simulated and
  the paper shows a red "simulated values (re-run with WESAD)" marker.
  Controlled scenarios now use real values: low = median rest window,
  high = 90th percentile of task or stress-test windows.
- Table 7 and the combination text now come from
  `generated/fusion_results.tex`, like the WESAD values.
- **Finding:** the typical SAM40 task block has load z = 0.66, below the
  alert level of 0.84; only 40.6% of task blocks reach it. The paper now
  says so and ties it to the design (add GSR/HRV, require consecutive
  blocks).
- **Order to run on the WESAD machine:**
  1. `python paper/analysis/wesad_subject_level.py --features <wesad csv>`
  2. `python paper/analysis/personal_scale_analysis.py`
