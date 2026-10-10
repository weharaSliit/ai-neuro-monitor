# Literature Review and Related Work

## Review Method and Scope

The review covers wearable physiological stress detection with heart-rate variability (HRV) and electrodermal activity (EDA), public stress datasets, personalisation of stress models, and low-cost Internet-of-Things (IoT) stress-monitoring systems. The literature was gathered around five questions: which signals detect stress from a wearable, which public datasets exist, how the models are evaluated, how they are personalised, and how low-cost IoT systems are built. The sixteen sources retained were published between 2012 and 2026 by IEEE, ACM, MDPI, Springer, Elsevier, Frontiers, AIMS Press and SciTePress. They comprise one public dataset paper {{cite:wesad}}, five reviews {{cite:taskasaplidis,haque,pataca,prasad,lazarou}} and ten empirical studies {{cite:calvo,nechyporenko,mozafari,segono,villarejo,dybvik,dalmeida,kyriakou,anusha,gedam}}. Eleven of these were analysed in depth for their sensors, data, methods, reported results, limitations and the gaps they name themselves; they are summarised in {{tab:lit}}, together with the other sources used in this thesis. Studies were retained when they used HRV and/or EDA from a wearable, reported an evaluation, and were peer reviewed.

## Domain and Theoretical Foundations

### Physiology of stress

Psychological stress activates the sympathetic branch of the autonomic nervous system and reduces parasympathetic activity. The heart beats faster and with less beat-to-beat variability, and the sweat glands increase their activity, which raises skin conductance {{cite:taskforce,boucsein}}. Because EDA is driven by the sympathetic branch alone, it is regarded as a cleaner arousal signal than HRV, which mixes sympathetic and parasympathetic influences {{cite:taskasaplidis,lazarou}}. Both effects are involuntary and can be measured on the finger or wrist, so HRV and EDA are the two signal families most used for wearable stress detection, and the pairing of HR/HRV with GSR is the combination recommended by a recent review {{cite:dalmeida,taskasaplidis}}.

### Heart-rate variability features

HRV is computed from the series of inter-beat intervals (IBI). The time-domain measures used in this work are the average normal-to-normal interval (AVNN, in ms), the mean heart rate (MeanHR, in beats per minute), the standard deviation of heart rate (SDHR), the proportion of successive interval differences larger than 20 ms (pNN20), and the Poincaré short-term variability SD1, which equals the standard deviation of successive interval differences divided by the square root of two {{cite:taskforce,shaffer}}. Under stress, AVNN, pNN20 and SD1 tend to fall while MeanHR rises {{cite:dalmeida}}. Reviews find that time-domain features are the most consistently used and outperform frequency-domain features alone, and that ultra-short recordings of a few minutes are viable for real-time use {{cite:haque,dalmeida}}. One study found pNN20 more discriminative than the more common pNN50 {{cite:dybvik}}.

### Electrodermal activity features

The EDA signal is separated into a slow tonic component, the skin conductance level (SCL), and fast phasic bursts, the skin conductance responses (SCR) {{cite:boucsein,benedek}}. A common implementation low-pass filters the signal at 5 Hz and high-pass filters it at 0.05 Hz to separate the phasic part {{cite:kyriakou}}. Features include the mean and slope of the level, counts, amplitudes and widths of responses, percentiles of the signal, its first and second derivatives, and wavelet energies at several scales. Stress raises the level and the number of responses {{cite:kyriakou,anusha}}.

### The WESAD dataset and stress induction

WESAD provides synchronised chest-worn (ECG, EDA, respiration, accelerometer at 700 Hz) and wrist-worn recordings from 15 subjects across baseline, stress, amusement and meditation conditions {{cite:wesad}}. Stress is induced with the Trier Social Stress Test (TSST), which combines public speaking with mental arithmetic {{cite:kirschbaum}}. Other cognitive tasks, such as the Stroop colour-word test {{cite:stroop}}, are also widely used to raise arousal. Self-report instruments such as the Perceived Stress Scale {{cite:cohen}} provide a subjective reference.

### Evaluation and decision thresholds

Because windows from one person are strongly correlated, k-fold cross-validation that mixes a person's windows across training and test folds overstates performance. Leave-one-subject-out (LOSO) validation trains on all but one person and tests on the held-out person; it reflects deployment, where the wearer is unseen, and is the stricter protocol {{cite:mozafari,pataca}}. For stress detection, missing a stress episode is the costlier error, so some studies prioritise recall over accuracy {{cite:dalmeida}}. For a probabilistic classifier, the decision threshold on the stress probability can be chosen from the receiver operating characteristic (ROC) curve, for example by maximising Youden's J statistic, J = sensitivity + specificity − 1 {{cite:youden}}.

## Related Research

### Wearable stress detection with HRV and EDA

Most wearable stress detectors frame the task as binary classification over hand-crafted HRV and EDA features and report strong accuracy on held-out data {{cite:taskasaplidis,haque,lazarou,nechyporenko}}. A review of 43 HRV-based studies reports best accuracies of about 99% for support vector machines in controlled laboratories but roughly 80–88% for random forests and boosting in more realistic settings {{cite:haque}}. HRV alone has been classified with random forest and gradient boosting at an area under the ROC curve of 0.85 on a driving dataset, and with a multilayer perceptron at 0.75 on smartwatch data from four volunteers, with labels derived from a GSR cut-off, not from self-report {{cite:dalmeida}}. A rule-based algorithm on GSR and skin temperature detected moments of stress with 84% accuracy in real-world cycling and walking, but is binary and tied to one sensor {{cite:kyriakou}}. A study of 37 adults that used an air-raid siren as the stressor and recorded GSR and PPG with a finger-worn sensor separated stress from no stress with 0.833 accuracy using k-nearest neighbours on HRV features and GSR peak counts, but this was measured on a test set of only 12 samples {{cite:nechyporenko}}. A three-class study of 50 housewives (no, acute and chronic stress) reached 97.51% accuracy with an LSTM and recursive feature elimination on ECG, GSR and skin temperature, but used a random 75/25 split and no personalisation {{cite:gedam}}. On WESAD, one study compared ten algorithms and three preprocessing strategies with subject-dependent models, reported 99.8% accuracy for a convolutional network and found ECG and EDA the most informative signals {{cite:calvo}}. Subject-dependent evaluation, however, does not show how a model performs on a new person.

### Multimodal signals

Multimodal combinations outperform single sensors {{cite:haque,mozafari}}. In a five-level Stroop-based study with PPG, GSR and respiration, the best combination reached the highest accuracy with a linear support vector machine, and a convolutional network underperformed the classical learners because of the small dataset {{cite:mozafari}}. A cautionary study with fNIRS, EEG, ECG and EDA found that ECG and EDA did not separate workload conditions that participants rated very differently for stress, while fNIRS and EEG did; physiological arousal and perceived stress can diverge {{cite:dybvik}}. Kyriakou and colleagues likewise report moments where the algorithm detected a response that participants did not report as stressful {{cite:kyriakou}}.

### Personalisation and inter-subject variability

Individual differences are a recurring finding. Baselines vary between people and over the day {{cite:taskasaplidis}}; the baseline voltage of a GSR sensor varied from 0.7 V to 1.6 V across 16 adults, and per-person thresholds were required for reliable detection {{cite:villarejo}}; universal models perform worse than subject-specific ones {{cite:mozafari}}. Reviews state that personalisation is essential but unsolved in real-life settings and that continuous baseline recalibration in dynamic environments is an open problem {{cite:taskasaplidis,lazarou,prasad}}. In a pre-surgery setting, a localised personalised model for wrist EDA evaluated under LOSO improved on its non-personalised counterpart by 6.12% and reached 85.06% accuracy {{cite:anusha}}. Where baselines are used, they are rarely re-estimated, and their benefit is seldom quantified under a subject-independent protocol. Personalising the decision threshold itself, not only the input features, is even less common. Temporal context also helps: a two-layer model that considers the stress state of the preceding minute outperformed single-window classification {{cite:lazarou}}.

### Confounders and real-life performance

Models trained in laboratories degrade in free-living conditions because wearables measure the physiological response to stress and not stress itself; physical activity, temperature, laughter and caffeine can mimic stress signals, and motion artefacts contaminate PPG and GSR {{cite:lazarou,villarejo,taskasaplidis}}. Accelerometer-based gating and context are recommended {{cite:prasad,lazarou}}. Cross-device generalisation, where a model trained on one device is used on another, is untested in most studies {{cite:lazarou}}.

### Low-cost IoT systems

IoT systems pair small microcontrollers and low-power sensors with edge, fog and cloud processing {{cite:mozafari,villarejo}}. The study most similar in hardware to this work uses an ESP32, a MAX30102 pulse sensor and a Grove GSR sensor with a dual-branch convolutional network on 60-second windows with 50% overlap; it reports 91.3% accuracy for four stress levels with 30 participants, a latency of 1.47 s and a battery life of 13.6 h, compares against XGBoost (84.3%) and random forest (81.7%) on hand-crafted features, and includes no motion sensor, no personalisation and no perceived-stress labelling {{cite:segono}}. Wrist-worn EDA devices have also been used for stress detection in a clinical setting {{cite:anusha}}. A 2025 paper names smart rings as an emerging direction because of their size and comfort {{cite:prasad}}.

### Reviews and methodological observations

A systematic review of 66 machine-learning stress-prediction studies on wearable data found that the performance of models drops from an F1 of 0.84 in the laboratory to 0.71 in real-life settings, that only 11% of the studies use perceived stress as the label, and that few use LOSO evaluation {{cite:pataca}}. Several reviews also note that there is no large public benchmark, no standard evaluation metric, and little attention to real-time operation {{cite:haque,prasad}}. These observations motivate the evaluation choices of this thesis.

Table[lit]: Summary of the main studies reviewed
| Study | Data and setting | Method and reported result | Limitation relevant to this work |
| {{cite:wesad}} | WESAD: 15 subjects, chest and wrist sensors, TSST | Public dataset used for training here | Laboratory stress; different sensors from the ring |
| {{cite:taskasaplidis}} | Review of wearable stress detection | Recommends HR/HRV with GSR; names baseline recalibration, motion artefacts and real-life monitoring as open problems | Review; no new model |
| {{cite:dalmeida}} | PhysioNet driving data (27 subjects); smartwatch data (4 volunteers) | HRV only; random forest and gradient boosting AUROC 0.85, 80% recall; MLP AUROC 0.75 on watch data | Binary; labels from a GSR cut-off; small watch dataset |
| {{cite:haque}} | Review of 43 HRV studies, 2016–2021 | Best accuracy about 99% in the laboratory and 80–88% in realistic settings | No benchmark or standard metric; personalisation and real-time use under-studied |
| {{cite:lazarou}} | Review of real-time stress prediction and commercial devices | Lab models degrade in free living; personalisation unsolved | Cross-device generalisation untested |
| {{cite:kyriakou}} | Empatica E4; 19 lab and 56 field participants | Rule-based GSR and skin-temperature algorithm; 84% accuracy in the field | Binary; sensor-specific; motion artefacts |
| {{cite:prasad}} | Review with a proposed methodology | Random forest and XGBoost the best performers; smart rings named as a direction | Few demographics; real-time feedback missing |
| {{cite:mozafari}} | 30 subjects; five Stroop-based levels; PPG, GSR, respiration | LOSO validation; linear SVM best with respiration; CNN underperformed | Subject-to-subject variability high |
| {{cite:villarejo}} | Custom GSR sensor over ZigBee; 16 adults at home and office | Per-person thresholds; classifiers about 91–94% | Cannot separate stress from physical effort, laughter or caffeine |
| {{cite:dybvik}} | Tetris task with fNIRS, EEG, ECG, EDA | ECG and EDA did not separate workload conditions; fNIRS and EEG did | Physiological and perceived stress diverged |
| {{cite:segono}} | ESP32 + MAX30102 + Grove GSR; 30 participants; four levels | Dual-branch CNN 91.3%; XGBoost 84.3%; latency 1.47 s | No motion sensor, no personalisation, laboratory tasks |
| {{cite:calvo}} | WESAD; 15 participants; ten algorithms | CNN 99.8% accuracy; ECG and EDA most informative | Subject-dependent evaluation |
| {{cite:nechyporenko}} | 37 healthy adults aged 20–30; Shimmer3 GSR+ on fingers and earlobe; air-raid siren as stressor; 3 min no-stress against 3 min stress | HRV features chosen by random forest plus GSR peak count and width; k-nearest neighbours best at 0.833 accuracy | Best result measured on a 12-sample test set (10 of 12 correct); single session; siren stressor in the laboratory |
| {{cite:gedam}} | 50 Indian housewives; ECG, GSR and skin temperature; three classes (no, acute and chronic stress) | LSTM with recursive feature elimination; 97.51% accuracy on a 75/25 split | Random split, not LOSO; no personalisation; not a ring |
| {{cite:pataca}} | Systematic review of 66 studies, 2010–2025 (PRISMA) | ECG/HRV used in 79% of studies and EDA in 70%; random forest 85–99%; F1 falls from 0.84 in the laboratory to 0.71 in real life; only 11% use perceived stress | Review only |
| {{cite:anusha}} | 41 patients before surgery; wrist EDA; three classes from the STAI anxiety questionnaire | Wavelet, derivative and quantile features; localised personalised model 85.06% accuracy under LOSO, a 6.12% improvement from personalisation | EDA only, no HRV; clinical pre-surgery setting |
Source: compiled by the author from the papers listed.

## Existing Systems, Products and Techniques

Consumer and research wearables already estimate stress or arousal. A review lists the Empatica E4 (EDA, temperature, HRV, motion), the Oura Ring (HRV and sleep), the Moodmetric Ring (EDA and a stress level), the WHOOP strap (HRV, stress and recovery), the Shimmer3 GSR+ (GSR and skin temperature), the Fitbit Sense (HRV and stress tracking) and the Garmin Vivosmart (HRV and other metrics) {{cite:lazarou}}. The Oura and Moodmetric rings are the closest to this work in form. Research-grade devices record EDA but are expensive and not designed for everyday wear, while consumer devices rely mostly on HRV. In all of them the score is a black box: the wearer is not shown how it relates to their own normal range, and no source describes a personal decision threshold derived from a calibration task. [[TODO: add prices and the manufacturers' documentation if you compare cost.]]

## Gap Synthesis and Conceptual Framework

{{tab:gaps}} lists the gaps distilled from the review, the evidence for each, and the response taken in this work.

Table[gaps]: Research gaps, supporting evidence and the response in this component
| Gap | Description and evidence | Response in this work |
| G1 | Evaluation mixes a person's windows across folds; LOSO is used by a minority {{cite:mozafari,pataca}} | LOSO validation of every model |
| G2 | Individual variability acknowledged but population thresholds remain {{cite:taskasaplidis,haque,lazarou,villarejo}} | Personal baseline and personal threshold with safe fallback |
| G3 | Baselines treated as fixed; continual recalibration unsolved {{cite:taskasaplidis,prasad}} | EMA blend at recalibration; seven-day drift check |
| G4 | Temporal context helps {{cite:lazarou}}, but no reviewed study validates a rising-stress flag | Trend indicator validated against WESAD onsets |
| G5 | Transfer to a new device untested {{cite:lazarou}}; laboratory-to-real gap {{cite:haque,taskasaplidis}} | Real-user calibration check; cross-dataset check |
| G6 | Real-time operation and understandable output under-studied {{cite:haque,prasad}} | Plain-language state, rings, slider and personal limit line |
Source: compiled by the author.

The conceptual framework ({{fig:framework}}) places these responses in sequence: a personal baseline normalises the inputs, a population model trained on baseline-normalised features gives the probability, a personal threshold decides what counts as stress for this person, a drift check warns when the baseline is stale, a trend indicator warns of a rising pattern, and a plain-language layer presents the result.

Figure[framework]: fig_framework.png | Conceptual framework of the personalised stress detector
Source: compiled by the author.
