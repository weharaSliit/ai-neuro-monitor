# Discussion

## Interpretation of Findings

**Choosing a model (RQ1).** The comparison shows why accuracy alone is a poor guide. LDA is the most accurate model but misses almost one in five stress windows while rarely misjudging calm ones; for a stress-awareness tool, missed stress is the costlier error, and accuracy hides it. The ten models fall into a narrow band of balanced accuracy (0.816 to 0.885), and, with only 15 subjects and no significance test, small differences should not be treated as reliable, so the choice of XGBoost rests on balanced errors, well-behaved probabilities and low serving cost, and not on a clear performance win. A reader should treat the choice as defensible but not uniquely optimal; k-nearest neighbours, random forest and the RBF support vector machine are comparable alternatives.

**Personalisation (RQ2).** Normalising each person's features by their own calm baseline raised accuracy by 8.3 percentage points and Stress F1 by 10.2 points at the default cut-off, and the deployed model is trained this way. This supports the argument that a large share of error under subject-independent validation is inter-person variability, not a limitation of the features. Two cautions apply. Each baseline was taken from a subject's first three labelled Normal windows, so it assumes a clean calm period, and a real user's calibration may be less clean than WESAD's baseline condition. The reported accuracy is also from laboratory data and from the same 15 subjects used to choose the threshold, so it is expected to be lower on the ring.

**Personal thresholds on real data.** [[TODO: rewrite after recalibrating the ring users with the retrained model. The first measurement (5 of 17 records with a personal threshold, all below the earlier population value of 0.7141) was made with the raw-feature model and is no longer valid. Discuss the new thresholds against 0.6447, and note that the separation rule is conservative by design, so users with weak separation stay on the population threshold.]]

**Transfer.** The failure on SWELL supports the view that laboratory-trained models should not be assumed to transfer across protocols and devices, and is a second reason, besides the threshold shift, to treat the population model as a starting point.

**Trend indicator (RQ3).** The indicator responds to the onset of stress far better than chance, and it is quiet on stable and noisy signals at moderate vote thresholds. Its cost is a noticeable false-alarm rate at the deployed setting, and its behaviour varies by person, from uninformative for one subject to immediate for most. For an advisory flag that does not change the label, a threshold of 0.45 offers a better trade-off than 0.35.

## Comparison with Literature Baselines and Existing Solutions

Studies on WESAD {{cite:calvo}} and on other wearable data {{cite:nechyporenko,gedam}} report a wide range of accuracies, and the closest hardware system reports 91.3% {{cite:segono}}. On WESAD, a study of ten algorithms reports 99.8% accuracy for a convolutional network, but with a subject-dependent evaluation {{cite:calvo}}. A study of 37 adults using finger and earlobe GSR reports 0.833 accuracy for k-nearest neighbours, measured on a test set of only 12 samples {{cite:nechyporenko}}. A study of 50 housewives with ECG, GSR and skin temperature reports 97.51% accuracy for three classes, from a random 75/25 split and not a leave-one-subject-out protocol {{cite:gedam}}. One reviewed study combines LOSO validation with personalisation, and reports 85.06% with a localised personalised model on wrist EDA from 41 pre-surgery patients {{cite:anusha}}. Direct comparison is limited because those studies differ in label definition, window length, feature set, and, for many, in the validation protocol, and a LOSO protocol is the stricter one {{cite:pataca}}. The LOSO accuracy of the deployed model (0.945 at its ROC-derived threshold, 0.934 at the default cut-off) is above the 91.3% of the hardware-similar system, but that figure is for a different dataset and protocol, and the deployed model has been validated only on laboratory data, not on labelled ring data. The distinguishing features of this work against the compared systems are the personal threshold with a safe fallback, the baseline adaptation and drift check, the validated trend indicator, the checking of the pipeline on real ring data, and the plain-language interface. {{tab:compare}} summarises the comparison. Cells marked "not reported" reflect what the reviewed papers state and are not claims that the feature is absent.

Table[compare]: Comparison of this work with the closest studies
| System | Sensors | Data | Validation | Accuracy | Personalisation | Trend indicator |
| {{cite:calvo}} | WESAD chest and wrist signals | WESAD, 15 subjects | Subject-dependent | 99.8% (CNN) | Not reported | Not reported |
| {{cite:nechyporenko}} | Shimmer3 GSR+, finger and earlobe | 37 adults, own data | Single split, 12-sample test set | 83.3% (kNN) | Not reported | Not reported |
| {{cite:gedam}} | ECG, GSR, skin temperature | 50 housewives, own data | Random 75/25 split | 97.51% (LSTM, 3 classes) | Not reported | Not reported |
| {{cite:segono}} | ESP32, MAX30102, Grove GSR | 30 participants, own data | [[TODO: validation protocol]] | 91.3% (CNN, 4 levels) | None | Not reported |
| {{cite:anusha}} | Wrist EDA | 41 pre-surgery patients | LOSO | 85.06% (personalised) | Yes (localised model) | Not reported |
| This work | Ring: MAX30102, GSR, accelerometer | WESAD, 15 subjects | LOSO | 94.5% (93.4% at 0.5), binary | Baseline, personal threshold, drift check | Yes, validated on WESAD |
Source: compiled by the author from the papers listed.

## Research Contribution

The research contributions are: a balanced, subject-independent comparison of ten classifiers with an explicit recall-gap analysis; a ROC-derived population threshold; a personal-threshold procedure with a measurable safety rule; [[TODO: after recalibration, the measured shift between the population threshold and personal thresholds on real ring data;]] the empirical validation of the trend indicator with a chance baseline and a threshold sweep; and a documented train–serve inconsistency that offline reporting alone would have hidden.

## Product Contribution

The product contribution is a working ring-to-interface pipeline that scores each minute, personalises the decision, and presents a plain-language state in a mobile application, a web dashboard and a clinical view, and that integrates with the EEG, phone-behaviour and relaxation components through a shared fused record.

## Limitations and Threats to Validity

1. **Device and signal shift.** Training used chest ECG at 700 Hz, whereas the ring uses PPG-derived intervals and GSR at about 5 Hz (V3 and V4 in {{tab:findings}}).
2. **Train–serve mismatch.** The first model was trained on raw features but scored baseline-normalised inputs (V1); this was corrected by retraining, and the pNN20 unit mismatch (V2) was corrected in the no-baseline path. The corrected pipeline has been checked offline only, and a real-user check after redeployment is still needed.
3. **Laboratory stress.** TSST stress is stronger and shorter than everyday stress, and generalisation to daily life is not shown.
4. **Sample size.** Fifteen training subjects and a small number of real ring users limit confidence, especially for personalisation, which depends on individual variability.
5. **No ground truth on the ring.** Real ring data are unlabelled, so accuracy on the ring has not been measured; at most, threshold behaviour and usability can be examined, and the threshold check must be repeated with the retrained model.
6. **Baseline assumption.** The calm baseline assumes the user was calm during calibration; the drift check cannot separate a stale baseline from a genuinely stressful week.
7. **Threshold chosen and reported on the same predictions.** The decision threshold was derived from the pooled held-out predictions on which its accuracy is also reported, so the accuracy at that threshold is slightly optimistic; the figure at the 0.5 cut-off is the cleaner estimate.
8. **Trend indicator.** It was validated on 30-second-step WESAD windows with separately recorded conditions, so onset may look sharper than in daily life; the synthetic scenario is idealised.
9. **Labels.** Training labels come from the experimental condition (baseline or TSST), not from self-report. Other studies show that physiological arousal and perceived stress can differ {{cite:dybvik,kyriakou}}, so these labels cannot be assumed to match what each person felt.
10. **Usability study.** [[TODO: state sample size and selection limits of the usability study.]]

## Implications

A population model can be a useful starting point for a new device only if the decision point is personalised and the output is checked on the target hardware; reporting offline accuracy is not sufficient. For practice, the safe-fallback rule is a reusable design pattern: personalise when the evidence is clear and fall back otherwise. For this system, the next step is to repeat the real-user check with the retrained model and, ideally, to collect labelled ring data.
