# Introduction

## Overall Project Context

Stress is one of the most common and costly health burdens of modern life. Prolonged, unmanaged stress contributes to cardiovascular disease, sleep disruption and anxiety and depressive disorders, yet it builds up gradually and is often invisible to the person experiencing it until symptoms are severe {{cite:taskasaplidis,haque}}. Tools that surface a person's stress state continuously and understandably, ideally before it fully develops, could support earlier self-management.

MindPulse is a multimodal stress-monitoring system developed by a four-member group. It combines four components. A smart ring measures heart-rate variability (HRV), skin conductance and motion. An EEG headband estimates cognitive load. A phone-behaviour component analyses typing and scrolling patterns. A relaxation guide delivers breathing exercises, audio and games. A fusion engine combines the ring and EEG probabilities into one stress state, and a mobile application and a web dashboard present that state to the wearer and, in a clinical view, to a researcher or clinician. The guiding idea is that every signal is judged against the wearer's own calibrated baseline and threshold, rather than against a population average.

## Individual Component Context

This thesis reports the physiological component: stress detection from the smart ring. The component covers the signal processing and feature extraction for the ring's heart-rate and skin-conductance signals, a stress classifier trained on a public dataset, the personalisation layers that adapt the classifier to each wearer, a trend indicator for rising stress, the backend services that run the pipeline, and the user and clinical interfaces for the ring's results. Its output, a "Body" probability judged against the wearer's own threshold, is one of the two inputs to the fusion engine.

## Problem Statement

Physiological stress responses differ greatly between people, and between devices. A model trained in a laboratory on one set of sensors is applied here to a different, low-cost ring worn by a different person. A single population decision threshold therefore risks two failures: missing real stress for some wearers and raising false alarms for others. In addition, users cannot act on probabilities and raw signals, so even an accurate system fails if its output is not understandable.

## Research Gap

The reviewed literature reports strong subject-independent results on the WESAD dataset {{cite:wesad,calvo,nechyporenko}} and several low-cost IoT systems {{cite:mozafari,segono}}, but five gaps remain for a ring-based system intended for real daily use:

1. Models are usually evaluated with k-fold splits that mix windows from the same person, which inflates accuracy; leave-one-subject-out (LOSO) evaluation is used by only a minority of studies {{cite:pataca}}.
2. Individual variability is widely acknowledged but rarely handled end to end: personalisation is proposed as necessary, yet it is seldom implemented, validated on real devices, and tied to a per-person decision threshold {{cite:prasad,villarejo,dybvik}}.
3. Baselines are treated as fixed after calibration, although physiology drifts over weeks.
4. Indicators of rising stress are shown to users in many applications without being validated against any ground truth.
5. Wearable stress systems rarely check whether a laboratory-trained model transfers to their own hardware, or present results in a form a non-expert can understand.

## Aim and Objectives

The aim of this component is to build and evaluate a personalised stress detector for a low-cost smart ring that gives accurate, understandable output.

The specific objectives are:

1. To train and compare stress classifiers on WESAD under LOSO validation and select one with documented evidence, including balanced metrics.
2. To build a signal-processing and feature pipeline for the ring that produces the same 23 features used in training.
3. To implement personalisation: a calm baseline, a personal decision threshold with a safe fallback, baseline adaptation at recalibration, and drift detection.
4. To implement and validate a trend indicator for rising stress.
5. To deliver the results through backend services, a mobile application and a web dashboard that present a plain-language state.
6. To evaluate the component technically and with users. [[TODO: confirm this wording matches the final user-study plan.]]

## Research Questions

- **RQ1.** Which classifier gives the best subject-independent Normal/Stress detection from HRV, GSR and motion features, and does the choice hold under balanced metrics?
- **RQ2.** Does personalising the baseline improve detection, and how does a personal decision threshold differ from the population threshold on real ring data?
- **RQ3.** Does a feature-voting trend indicator respond to the onset of stress better than chance, and at what false-alarm cost?
- **RQ4.** Can the output be presented so that non-technical users understand their state? [[TODO: link to the usability study results when available.]]

## Scope, Limitations and Assumptions

In scope are binary Normal/Stress detection from the ring, the personalisation layers, the backend services and the ring-related interface screens. Out of scope are clinical diagnosis, the EEG, phone-behaviour and relaxation components (developed by other group members), and a three-class model: an earlier "pre-stress" class was dropped because the dataset provides no real ground truth for it and models reached only F1 scores of 0.14–0.29 on it.

The component assumes that the wearer keeps the ring on the finger with good contact and sits still during calibration, and that processed ring signals are comparable to the chest and wrist signals used for training after the same processing. The principal limitation is that training data come from different sensors than the deployed ring (Chapter 7).

## Individual Contribution

The contributions of the author are:

- the preprocessing and feature-extraction pipeline for the ring and the four-method feature selection;
- the ten-model LOSO comparison with a balanced-accuracy and recall-gap analysis, and the ROC-based choice of the population decision threshold;
- the calm-breathing baseline, the personal-threshold procedure with its safety fallback, baseline adaptation at recalibration and the drift check;
- the empirical validation of the trend indicator on WESAD, and the check of personal thresholds on real ring data (to be repeated with the retrained model);
- the backend services, the processed-signal storage design, and the mobile and web interfaces for the ring and for calibration;
- identification, during verification, of a mismatch between the first model and its baseline-normalised inputs, and its correction by retraining (Section 5.4).

[[TODO: adjust this list to match exactly what you and your group members agreed as individual contributions.]]

## Thesis Structure

Chapter 2 reviews the literature and distils the gap. Chapter 3 describes the research methodology. Chapter 4 presents the product and solution design, and Chapter 5 the implementation, integration and testing. Chapter 6 reports results and validation, Chapter 7 discusses them, Chapter 8 covers commercialisation and sustainability, and Chapter 9 concludes.
