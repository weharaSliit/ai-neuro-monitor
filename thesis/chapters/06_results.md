# Results and Validation

## Research Results

### Model comparison (RQ1)

{{tab:models}} and {{fig:models}} report the ten classifiers under LOSO validation on 913 windows from 15 subjects. LDA has the highest accuracy (0.908), followed by k-nearest neighbours and random forest (0.864 each); XGBoost, the RBF support vector machine and the multilayer perceptron reach 0.851. The balanced analysis changes the picture: LDA's accuracy comes from recalling 96.4% of Normal but only 80.7% of Stress windows (recall gap 0.157), whereas XGBoost recalls 84.5% of Normal and 86.2% of Stress windows (gap 0.017, balanced accuracy 0.853). The RBF support vector machine has the smallest gap (0.007) at a similar balanced accuracy (0.850), and k-nearest neighbours the second highest balanced accuracy (0.860).

Table[models]: Ten classifiers under LOSO validation (913 windows, 15 subjects)
| Model | Accuracy | F1-macro | Balanced accuracy | Recall Normal | Recall Stress | Recall gap |
| LDA | 0.908 | 0.897 | 0.885 | 0.964 | 0.807 | 0.157 |
| k-nearest neighbours | 0.864 | 0.854 | 0.860 | 0.874 | 0.847 | 0.027 |
| Random forest | 0.864 | 0.854 | 0.858 | 0.879 | 0.837 | 0.042 |
| XGBoost (raw features) | 0.851 | 0.842 | 0.853 | 0.845 | 0.862 | 0.017 |
| Gradient boosting | 0.850 | 0.842 | 0.857 | 0.833 | 0.880 | 0.047 |
| SVM, RBF kernel | 0.851 | 0.841 | 0.850 | 0.853 | 0.847 | 0.007 |
| Multilayer perceptron | 0.851 | 0.840 | 0.845 | 0.867 | 0.822 | 0.045 |
| Logistic regression | 0.838 | 0.832 | 0.853 | 0.799 | 0.908 | 0.109 |
| SVM, linear kernel | 0.808 | 0.802 | 0.823 | 0.772 | 0.874 | 0.103 |
| AdaBoost | 0.811 | 0.801 | 0.816 | 0.797 | 0.834 | 0.037 |
Source: notebook 05, cells 1.5 to 1.7.

Figure[models]: fig_model_comparison.png | Accuracy, balanced accuracy and recall gap of ten classifiers under LOSO validation
Source: notebook 05, cells 1.5 to 1.7.

The ten classifiers were compared on raw features. XGBoost was then retrained on baseline-normalised features, which is the form in which it receives its inputs when deployed (see below), so the pooled LOSO confusion matrix of the deployed model in {{tab:confusion}} comes from that retrained model at its ROC-derived threshold of 0.6447. Precision is 0.941 for Normal and 0.954 for Stress, and F1 is 0.958 and 0.921. The model errs towards missed stress (36 of 326 Stress windows) more than towards false alarms (14 of 587 Normal windows).

Table[confusion]: Pooled LOSO confusion matrix of the deployed (baseline-normalised) XGBoost model at threshold 0.6447
| Actual \ Predicted | Normal | Stress |
| Normal | 573 | 14 |
| Stress | 36 | 290 |
Source: retrain_personalised.py.

For the deployed model, the pooled out-of-fold probabilities give an AUC of 0.986 ({{fig:loso}}). The Youden-optimal decision threshold is 0.6447, with a true-positive rate of 0.893 and a false-positive rate of 0.024 (J = 0.869), giving accuracy 0.945, macro F1 0.939 and recall of 0.976 for Normal and 0.890 for Stress. At the default cut-off of 0.5 the same predictions give accuracy 0.934 and Stress F1 0.907. The threshold was chosen on the same pooled predictions on which these figures are reported, so the accuracy at 0.6447 is slightly optimistic and the figure at 0.5 is the cleaner like-for-like comparison with the static model. For the raw-feature model compared above, the AUC is 0.938 and its Youden threshold is 0.7141 (true-positive rate 0.850, false-positive rate 0.121, J = 0.729); that model is now used only to score a user who has no baseline.

Figure[loso]: fig_loso_evaluation.png | Pooled LOSO evaluation of the deployed (baseline-normalised) model: confusion matrix, ROC curve, feature importance and summary
Source: notebook 05 and the evaluation script.

### Personalisation of the baseline (RQ2)

When every subject's features were normalised by that subject's own baseline before training and testing, LOSO accuracy at the 0.5 cut-off rose from 0.851 to 0.934, macro F1 from 0.842 to 0.928, and Stress F1 from 0.805 to 0.907 ({{tab:pers}}, {{fig:pers}}). The confusion matrix at 0.5 was 560 and 27 for Normal and 33 and 293 for Stress. The AUC rose from 0.938 to 0.986. Each subject's baseline was formed from that subject's first three Normal windows, which assumes that the calibration windows were truly calm; in the deployed system the baseline comes from the user's own three calm calibration windows. This protocol is the one used to train the deployed model.

Table[pers]: Static versus personal-baseline model under LOSO (both at the 0.5 cut-off)
| Metric | Static | Personal baseline | Change |
| Accuracy | 0.851 | 0.934 | +0.083 |
| F1-macro | 0.842 | 0.928 | +0.086 |
| F1 Normal | 0.879 | 0.949 | +0.070 |
| F1 Stress | 0.805 | 0.907 | +0.102 |
| AUC | 0.938 | 0.986 | +0.048 |
Source: notebook 06, cell 4, and the evaluation script.

Figure[pers]: fig_personalisation.png | Static versus personal-baseline model under LOSO validation
Source: notebook 06, cell 4.

### Cross-dataset check

Applied to the SWELL knowledge-work dataset {{cite:swell}} using only the five HRV features that both datasets share, the WESAD-trained model reached an accuracy of 0.429, macro F1 of 0.367 and Stress F1 of 0.169, with only 12.7% of Stress windows recalled. The model therefore did not transfer. This result cannot be attributed to the missing GSR alone, because the dataset, protocol, device and label definition all differ; it is a directional warning that a laboratory-trained model should not be assumed to transfer to a different setting.

### Personal thresholds on real ring data (RQ2)

[[TODO: re-measure after recalibration. The personal thresholds first collected from the live database (5 of 17 calibrated records, values 0.348 to 0.572, all below the earlier population threshold of 0.7141) were computed with the first, raw-feature model, so they are no longer valid for the retrained model. Recalibrate the ring users, then report: the number of calibrated records, how many have a personal threshold, the values, and the shift from the population threshold of 0.6447. Separate records without a threshold into those that did not take the limit test and those whose rest and task scores differed by less than 0.10.]] The sign and size of any shift can reflect real differences between the ring and the WESAD sensors, or between users and the dataset (V3 and V4 in {{tab:findings}}); the present data cannot separate these, so a shift is evidence that a population threshold does not carry over to the ring, not a measurement of the true size of the difference.

Figure[real]: fig_real_thresholds.png | First measurement of personal thresholds on real ring data, made with the raw-feature model, compared with the earlier population threshold (to be replaced after recalibration)
Source: live database, personal_thresholds records.

### Trend indicator (RQ3)

Replaying the production trend class on the WESAD windows of each subject gave the results in {{tab:trend}} and {{fig:trend}}. At the deployed vote threshold of 0.35 the indicator flagged stress onset within six windows in all 15 subjects (median latency 0 windows, maximum 3), where a random flag with the same false-alarm rate would catch 62.7%. It flagged 18.4% of calm windows. Subject-level variation is large: the false-alarm rate reached 0.486 for one subject and 0.389 for another, and for the subject with 0.486 the indicator fired in only 4.8% of the stress windows, so for that subject it was not informative. Raising the vote threshold to 0.45 halves false alarms to 8.9% while still detecting onset in 14 of 15 subjects (93.3%); at 0.50 false alarms fall to 6.6% and detection to 86.7%. In the synthetic scenarios the indicator stayed nearly quiet on stable and noisy signals at thresholds of 0.40 and above (at most 3.6% of windows flagged), and detected the ramp in every subject at 0.40 and in 86.7% at 0.45.

Table[trend]: Trend indicator versus vote threshold on WESAD (15 subjects)
| Vote threshold | False alarms in calm windows | Onset detected within 6 windows | Random flag, same false-alarm rate | Synthetic stable: false alarms | Synthetic rising: detected |
| 0.30 | 0.264 | 1.000 | 0.773 | 0.210 | 1.000 |
| 0.35 (deployed) | 0.184 | 1.000 | 0.627 | 0.105 | 1.000 |
| 0.40 | 0.133 | 0.933 | 0.512 | 0.010 | 1.000 |
| 0.45 | 0.089 | 0.933 | 0.390 | 0.010 | 0.867 |
| 0.50 | 0.066 | 0.867 | 0.308 | 0.005 | 0.800 |
Source: validate_trend_detector.py.

Figure[trend]: fig_trend_validation.png | Trend indicator: detection and false alarms against the vote threshold
Source: validate_trend_detector.py.

## Product and Technical Results

The ring pipeline runs end to end: a window arrives over MQTT, features are extracted, the window is scored against the user's baseline and threshold, and the probability, label, trend flag and processed preview are written to the database and shown within about a minute. The clinical view displays all 23 features through a dropdown chart together with the filtered GSR and inter-beat-interval previews. [[TODO: add measured values if you have them: end-to-end latency from the end of a window to the on-screen update (median and worst case); heart-rate agreement between the MAX30102 and a reference pulse oximeter (mean absolute error over N minutes); GSR response to a known stimulus such as a deep breath or a cold object; motion-gate behaviour; battery life of the 250 mAh cell. Without a measurement, state that it was not measured.]]

## User or Stakeholder Validation

[[TODO: report the usability study. Suggested layout: a table with participants (number, age range, background), mean System Usability Scale score and its interpretation, task success rate for each task, and the most common comments. Quote two or three participants. State what you changed afterwards. During development, the interface was already simplified in response to feedback that the first version was cluttered: technical charts moved to the clinical view, plain-language states replaced probabilities, and the calibration screen gained a progress ring and per-device progress.]]

Table[usability]: Usability study summary
| Item | Result |
| Participants | [[TODO: number and profile]] |
| System Usability Scale (mean, range) | [[TODO: score]] |
| Task success: register and log in | [[TODO: %]] |
| Task success: complete calibration | [[TODO: %]] |
| Task success: say what the home state means | [[TODO: %]] |
| Task success: find the baseline-change chart | [[TODO: %]] |
Source: usability study, [[TODO: date]].

## Integration Results

[[TODO: report how the ring and the EEG probabilities combined in the fusion engine: number of fused windows, how often the two modalities agreed or disagreed, and one or two example sessions with the fused state. Report that the website and phone shared one live session without taking the devices from each other, if you tested it.]]

## Summary of Findings

1. Under subject-independent validation on raw features, XGBoost reached an accuracy of 0.851, macro F1 of 0.842 and AUC of 0.938 with balanced class recall. It is not the most accurate model (LDA 0.908), and it was kept for balanced errors and probability behaviour.
2. A ROC-derived population threshold outperformed the default 0.5 on Youden's index, both for the raw-feature model (0.7141) and for the deployed baseline-normalised model (0.6447).
3. Training on baseline-normalised features raised LOSO accuracy from 0.851 to 0.934 at the 0.5 cut-off and Stress F1 from 0.805 to 0.907; at the re-derived threshold of 0.6447 the deployed model reaches accuracy 0.945 and AUC 0.986. This is the model now deployed.
4. A WESAD-trained HRV model did not transfer to the SWELL dataset (accuracy 0.429).
5. [[TODO: after recalibrating the ring users with the retrained model, report how many calibrated records produced a personal threshold and how they compare with the population value of 0.6447.]]
6. The trend indicator detected onset in all 15 subjects at the deployed setting but with an 18.4% false-alarm rate; a vote threshold of 0.45 is a better balance.
7. [[TODO: user-study finding.]]
