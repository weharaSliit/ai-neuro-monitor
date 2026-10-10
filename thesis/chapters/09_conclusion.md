# Conclusion and Future Directions

## Conclusion

This thesis developed and evaluated a personalised stress detector for a low-cost smart ring. A binary XGBoost classifier on 23 HRV, electrodermal and motion features was chosen from ten models under leave-one-subject-out validation (85.1% accuracy, AUC 0.938 on raw features); it is not the most accurate of the ten but has even errors and well-behaved probabilities. Trained on features normalised by each person's calm baseline, which is how it is used on the ring, it reached 94.5% accuracy and an AUC of 0.986 at a ROC-derived threshold of 0.6447 (93.4% at the default cut-off). Layered personalisation, namely a calm baseline, a personal threshold with a safe fallback, baseline adaptation and a drift check, addresses the individual variability that limits population models. The trend indicator detected stress onset in every WESAD subject but with an 18% false-alarm rate, and a higher vote threshold is recommended. Checking the pipeline end to end revealed a mismatch between how the first model was trained and how it was used, which was corrected by retraining; this shows that offline accuracy is insufficient evidence for a deployed system. [[TODO: after recalibration, add one sentence on the personal thresholds measured on real ring data.]]

## Achievement of Objectives

Table[objectives]: Achievement of the objectives
| Objective | Status | Evidence |
| 1. Compare classifiers under LOSO and select one | Achieved | {{tab:models}}, {{fig:models}} |
| 2. Ring pipeline producing the training features | Achieved with caveats | Section 5.2; findings V1 to V4 in {{tab:findings}} |
| 3. Personalisation layers | Implemented and trained on baseline-normalised features; validation on real ring users pending | Sections 3.3, 6.1, 5.4 |
| 4. Validated trend indicator | Achieved on WESAD; ring validation pending | {{tab:trend}} |
| 5. Services, mobile app and web dashboard | Achieved | Chapters 4 and 5 |
| 6. Technical and user evaluation | Technical achieved; user study [[TODO: status]] | Chapter 6 |
Source: compiled by the author.

## Individual Research and Product Contributions

The research contributions are the balanced model comparison, the personal-threshold procedure with a measurable safety rule, [[TODO: the measured gap between a population and personal thresholds on real ring data, after recalibration,]] the validation of the trend indicator against chance, and the documented train–serve inconsistency. The product contribution is the working pipeline and its mobile, web and clinical interfaces, integrated with the other three components. [[TODO: align the wording with Section 1.8 and with your group's agreed split.]]

## Future Directions

1. Repeat the real-user threshold check after recalibrating users with the retrained model, and confirm that the corrected pipeline behaves as validated offline.
2. Collect labelled ring data with consent, using the limit test and self-report, to measure accuracy on the target device and to fine-tune the model.
3. Raise the trend vote threshold to about 0.45 and validate the indicator on real ring sessions.
4. Run a long-term study of the baseline adaptation and the drift check.
5. Compare PPG-derived and ECG-derived intervals against a reference device, and measure latency, heart-rate accuracy and battery life of the assembled ring.
6. Extend the usability study to more participants and to everyday use.
