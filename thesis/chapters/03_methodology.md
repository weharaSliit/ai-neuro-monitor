# Research Methodology

## Research Design

The study follows a design-science approach with quantitative evaluation. A pipeline is designed and built (Chapters 4 and 5), evaluated offline on a public dataset under a subject-independent protocol, then examined on real ring data and, in a user study, for understandability. Each research question is tied to one evaluation: RQ1 to the LOSO model comparison, RQ2 to the personalisation experiments and the real-user threshold check, RQ3 to the trend-indicator validation, and RQ4 to the usability study.

## Data, Participants and Study Materials

### WESAD training data

The WESAD dataset provides chest-worn ECG, EDA and accelerometer recordings at 700 Hz from 15 subjects (identifiers S2–S11 and S13–S17) during a resting baseline and the Trier Social Stress Test {{cite:wesad,kirschbaum}}. The baseline condition is labelled Normal (0) and the stress condition Stress (1). Signals were cut into 60-second windows with a 30-second step. The final feature table contains 913 windows, of which 587 are Normal (64.3%) and 326 are Stress (35.7%) ({{tab:dataset}}). Samples within 30 seconds of any change of condition were excluded from labelling, and a window was rejected if it contained mixed labels, less than 90% clean signal, or fewer than 10 inter-beat intervals.

Table[dataset]: Window statistics of the WESAD training table
| Item | Value |
| Subjects | 15 (S2–S11, S13–S17) |
| Window length / step | 60 s / 30 s |
| Normal windows | 587 (64.3%) |
| Stress windows | 326 (35.7%) |
| Total windows | 913 |
| Candidate features | 40 |
| Deployed features | 23 |
Source: notebooks 04 and 05 outputs.

### Ring data

The ring is an ESP32-C3 based device carrying a MAX30102 pulse sensor, a Grove GSR sensor and an MPU-6050 accelerometer (Section 4.4). Ring data come from the live system. At the time of writing, the live database holds 57 registered accounts, many of them test accounts, and 17 calibrated records. [[TODO: state how many distinct real participants wore the ring, the recruitment method, and the total ring hours collected.]] Ring data are not labelled with ground-truth stress and are therefore used for calibration checks and usability, not for accuracy claims.

### Usability study materials

[[TODO: describe the participants (number, age range, background), the tasks (register, calibrate, read the home screen, find the baseline chart, open the clinical view), the questionnaire (System Usability Scale {{cite:brooke}} and open questions) and how long each session took.]]

## Experimental or Study Procedure

### Signal processing and feature extraction

For WESAD, ECG was band-pass filtered and R-peaks were detected with an adaptive detector in the Pan–Tompkins family {{cite:pantompkins}}. Inter-beat intervals were limited to 300–2000 ms and values deviating by more than 20% from the local median were removed. EDA was cleaned by interquartile-range clipping, linearly detrended, low-pass filtered at 5 Hz, and high-pass filtered at 0.05 Hz to obtain the phasic component; the tonic component is the filtered signal minus the phasic part. First and second derivatives and a five-level Haar wavelet decomposition were computed. Acceleration magnitude was used both to flag windows with strong motion (more than 1.2 g) and as two features. Forty candidate features were extracted per window: 15 HRV features, 22 EDA features and 3 motion features. {{fig:pipeline}} shows the same processing as applied to the ring, whose filter cut-offs are clamped below the Nyquist frequency because the ring samples GSR at about 5 Hz instead of 700 Hz. A window with fewer than four clean inter-beat intervals is rejected by the ring pipeline rather than filled with placeholder values. These settings follow published practice: a 5 Hz low-pass and 0.05 Hz high-pass for EDA {{cite:kyriakou}}, a 300–2000 ms interval limit for pulse-derived intervals {{cite:segono}}, and pNN20 in place of pNN50 {{cite:dybvik}}.

Figure[pipeline]: fig_signal_pipeline.png | Signal processing and feature extraction for one 60-second window
Source: compiled by the author from extract_features.py.

### Feature selection

Features were selected by a four-method vote: Spearman correlation with the label, Extra Trees importance, recursive feature elimination (RFE) and permutation importance. A feature kept at least two votes; this produced 22 features. The deployed set is a fixed, literature-grounded list of 23 features that agrees with the vote on 16 features; it adds SCL_slope, a tonic-level trend indicator of stress onset {{cite:kyriakou,segono}}, and keeps SD1, SCL_mean, EDA_std, EDA_q90, wavelet_d1_energy and the two accelerometer features, which the vote did not retain, for physiological reasons and because the ring provides them. {{tab:features}} lists the deployed features.

Table[features]: The 23 deployed features by category
| Category | Features | Count |
| HRV | AVNN, MeanHR, SDHR, pNN20, SD1 | 5 |
| EDA level and trend | SCL_mean, SCL_slope, EDA_mean, EDA_slope, EDA_std | 5 |
| EDA responses | SCR_count, SCR_amp_mean, SCR_width_mean | 3 |
| EDA distribution | EDA_q10, EDA_q75, EDA_q90, EDA_range | 4 |
| EDA derivatives | deriv1_std, deriv2_mean | 2 |
| EDA wavelet energy | wavelet_d1_energy, wavelet_d3_energy | 2 |
| Motion | ACC_mean, ACC_std | 2 |
| Total | | 23 |
Source: extract_features.py and notebook 04.

### Model comparison and decision threshold

Ten classifiers were compared under LOSO validation: LDA, k-nearest neighbours, random forest, XGBoost {{cite:chen}}, gradient boosting, RBF-kernel and linear support vector machines, a multilayer perceptron, logistic regression and AdaBoost, all from scikit-learn {{cite:pedregosa}} or the XGBoost library. In every fold the feature scaler was fitted on the training subjects only, and class imbalance was handled by balanced sample weights. The XGBoost settings were 300 trees, maximum depth 6, learning rate 0.1 and random seed 42. Besides accuracy and F1, balanced accuracy and the recall gap, defined as |recall(Normal) − recall(Stress)|, were computed to check that no model gains accuracy by favouring the majority class. The pooled out-of-fold probabilities of the chosen model were used to draw the ROC curve, and the population decision threshold was set where Youden's J is maximal {{cite:youden}}. The ten-model comparison used raw features. The chosen model was then retrained on baseline-normalised features (Section 3.3.4), and the deployed decision threshold was derived in the same way from the pooled out-of-fold probabilities of that retrained model.

### Personalisation procedure

Personalisation has five layers, shown in {{fig:calibration}}.

Figure[calibration]: fig_calibration_flow.png | Calibration and personal-threshold procedure
Source: compiled by the author from calibration_capture.py.

**Layer 1: personal baseline.** After a 30-second settling period, three 60-second windows are captured while the user breathes calmly, giving a personal mean and standard deviation for each feature. Subsequent windows are normalised against it: EDA features by ratio to the personal mean, other features by z-score, with the standard deviation floored at 10% of the absolute mean and at least 0.01 ({{eq:ratio}}, {{eq:zscore}}). The classifier is trained on features normalised in the same way, using each WESAD subject's first three Normal windows as that subject's baseline.

Eq[ratio]: r = x / μ_personal    (EDA features)

Eq[zscore]: z = (x − μ_personal) / max(σ_personal, 0.10 × |μ_personal|)    (other features)

**Layer 2: personal decision threshold.** The three resting windows are scored, then the user performs an eight-minute cognitive battery ({{tab:battery}}), during which eight 60-second windows are scored. If the mean task score exceeds the mean rest score by at least 0.10, the personal threshold is the midpoint of the two means ({{eq:midpoint}}); otherwise the population threshold is kept.

Eq[midpoint]: T_personal = ( mean(rest scores) + mean(task scores) ) / 2,    only if mean(task) − mean(rest) ≥ 0.10

Table[battery]: The cognitive battery used to find the personal threshold
| Activity | Duration | Demand |
| Serial subtraction (count down by 13; a mistake restarts the count) | 150 s | Mental arithmetic under penalty |
| Speed maths quiz (nine question types, six difficulty levels) | 100 s | Arithmetic under time pressure |
| Sequence-recall puzzle (3×3 tiles, growing length) | 70 s | Working memory |
| Even/odd sorter (falling numbers, speed penalty on a miss) | 90 s | Speeded decisions with negative feedback |
| Stroop colour-word test (ten colours, ink or word instruction) | 70 s | Cognitive conflict |
| Total | 480 s | |
Source: EegThresholdTaskScreen.js; designed after the arithmetic and Stroop tasks used in stress-induction research {{cite:kirschbaum,stroop}}.

**Layer 3: baseline adaptation.** When a user recalibrates, the new baseline is blended into the old one with an exponential moving average ({{eq:ema}}, α = 0.2), so the baseline follows slow change without being overwritten by one session.

Eq[ema]: μ_new = α × x̄_recalibration + (1 − α) × μ_old,    α = 0.2

A session-based variant that updated the baseline from ordinary daily windows was implemented first and then removed: real data showed that it never produced an update for any user, and everyday windows are not controlled resting measurements.

**Layer 4: drift check.** The mean stress probability of the last seven days (at least ten readings) is compared with the mean of the user's calm baseline scores; a difference larger than 0.15 is reported as a change, and recalibration is suggested.

**Layer 5: trend indicator.** Twenty-two features vote on whether the signal is moving towards stress over the last five windows: six tonic EDA features and twelve phasic or arousal features vote when they rise, and four HRV and motion features vote when they fall. The "trending towards stress" flag is raised when the share of voting features reaches 0.35 ({{eq:trend}}). The flag is advisory and never changes the Normal/Stress label.

Eq[trend]: V = (features voting for rising stress) / (features evaluated)  ≥  0.35

### Validation procedures

*Personalisation (RQ2).* The static LOSO experiment was repeated with every subject's features, in the training folds and in the held-out subject, normalised by that subject's own baseline (their first three Normal windows) before training. This quantifies the benefit of feature-level personalisation and is the training protocol of the deployed model. The decision threshold of the deployed model was taken from the pooled out-of-fold probabilities of this experiment as the point of the ROC curve with the highest Youden's J, and the final model was then fitted on all 15 subjects. *Real-user thresholds (RQ2).* The calibrated records in the live database were read to count how many produced a personal threshold and how far these deviate from the population value. *Cross-dataset check.* The HRV-only version of the model was tested on the SWELL knowledge-work dataset {{cite:swell}} as a sanity check on transfer to a different protocol and device. *Trend indicator (RQ3).* The production trend class was replayed on the WESAD windows of each subject in time order, with the baseline taken from the first three windows. A flag counts as a false alarm if it is raised in a calm window, and as a detection if it is raised within the first six stress windows. The detection rate was compared with that of a random flag with the same false-alarm rate, 1 − (1 − FA)^6, and the vote threshold was swept from 0.15 to 0.60. Synthetic stable, noisy and rising signals built from each subject's own statistics served as scenario tests.

## Measures and Evaluation Metrics

Classification quality is reported as accuracy, macro-averaged F1, per-class precision and recall, balanced accuracy, recall gap, confusion matrix and area under the ROC curve (AUC). Threshold quality is reported by the Youden index J. The trend indicator is reported by false-alarm rate, detection rate within six windows and the difference from chance. Personalisation on real data is reported as the number of users with a personal threshold and the shift from the population value. Usability is reported by the System Usability Scale score {{cite:brooke}} and task success. [[TODO: add any additional measures from the user study, such as time on task.]]

## Data Analysis

LOSO folds hold out one subject at a time, and predictions are pooled across folds for the overall metrics. Thresholds are derived only from out-of-fold probabilities, so the held-out subject never influences its own threshold. No significance test was run, so all comparisons between models, and between the static and personalised pipelines, are descriptive. With 15 subjects, small differences in accuracy should not be read as reliable.

## Ethics, Privacy, Security and Responsible AI

Passwords are stored as scrypt hashes and the Flask services use bearer tokens. Raw sensor streams are never written to the cloud database: only derived features and a down-sampled, filtered preview of each window (at most 80 GSR points and 150 inter-beat intervals) are stored. The system is a wellbeing aid, not a medical device, and does not diagnose. A calibration that does not clearly separate rest from task is rejected, so a poor calibration cannot make a user's results worse than the population model. The clinical view exposes other users' data, so its use is restricted to the research team. [[TODO: add the ethics-approval reference, the consent procedure for ring wearers and usability participants, and the data-retention policy.]]

## Reproducibility and Research Artefacts

The work is reproducible from the repository: six notebooks cover environment checks, dataset checks, preprocessing, feature selection, model training and personalisation validation; the trained model, scaler and feature list are saved as artefacts; `retrain_personalised.py` retrains the deployed model on baseline-normalised features, and `validate_trend_detector.py` reproduces the trend results. Random seeds are fixed at 42. The code is available at https://github.com/weharaSliit/ai-neuro-monitor. The experiments used Python 3.11.9 with NumPy 1.26.4, pandas 2.2.1, SciPy 1.12.0, scikit-learn 1.4.2, XGBoost 2.0.3, NeuroKit2 0.2.7, PyWavelets 1.5.0, Matplotlib 3.8.3 and joblib 1.3.2. The WESAD dataset is not included in the repository; it is publicly available from its authors {{cite:wesad}}, and the folder containing the subject directories (S2 to S17) is set as the dataset path in the configuration file `src/utils/config.py` before running notebook 03.
