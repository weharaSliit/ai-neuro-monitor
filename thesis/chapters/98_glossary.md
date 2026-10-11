#- Glossary

**Baseline (personal).** The wearer's own calm-state profile (mean and spread of each feature), captured during calm breathing and used to normalise later readings.

**Calibration.** The procedure in which the wearer sits calmly for about 3.5 minutes so that the system can learn their baseline; a second, eight-minute procedure, the limit test, finds their personal threshold.

**Drift.** Movement of the recent average stress probability away from the level measured at calibration.

**Fusion.** Combining the ring's and the EEG headband's stress probabilities into one state, each judged against its own personal threshold.

**Leave-one-subject-out (LOSO) validation.** Evaluation in which a model is trained on all subjects but one and tested on the held-out subject, repeated for every subject.

**Personal threshold.** The stress probability above which this particular wearer is reported as stressed; it replaces the population threshold when calibration separates rest from task clearly.

**Phasic and tonic (EDA).** The fast responses and the slow level of skin conductance.

**Population threshold.** The decision threshold (0.6447) derived from the ROC curve of the deployed model on WESAD, used when no personal threshold exists.

**Recall gap.** The absolute difference between the recall of the Normal and Stress classes; a small gap means both classes are detected about equally well.

**Train–serve mismatch.** A difference between the data a model was trained on and the data it receives in use.

**Trend indicator.** An advisory flag raised when most monitored features move towards a stress pattern over recent windows; it never changes the Normal/Stress label.

**Window.** A 60-second slice of signal from which one set of features and one stress probability are computed.
