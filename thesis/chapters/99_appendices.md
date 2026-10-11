#- Appendix A: Research Instruments and Extended Results

##- A.1 Per-class classification report of the deployed model

Table[a_report]: Pooled LOSO report of the deployed (baseline-normalised) XGBoost model at threshold 0.6447 (913 windows)
| Class | Precision | Recall | F1 | Support |
| Normal | 0.941 | 0.976 | 0.958 | 587 |
| Stress | 0.954 | 0.890 | 0.921 | 326 |
| Macro average | 0.947 | 0.933 | 0.939 | 913 |
Source: retrain_personalised.py; accuracy 0.945; confusion matrix: Normal 573 and 14, Stress 36 and 290.

##- A.2 Personalisation experiment: personal-baseline model

Table[a_pers]: Pooled LOSO report of the baseline-normalised model at the 0.5 cut-off
| Class | Precision | Recall | F1 | Support |
| Normal | 0.944 | 0.954 | 0.949 | 587 |
| Stress | 0.916 | 0.899 | 0.907 | 326 |
| Accuracy | | | 0.934 | 913 |
Source: notebook 06, cell 4. Confusion matrix: Normal 560 and 27; Stress 33 and 293.

##- A.3 Trend indicator: results per subject at the deployed threshold (0.35)

Table[a_trend]: Per-subject trend-indicator results on WESAD
| Subject | Calm windows | False-alarm rate | Detected within 6 windows | Latency (windows) | Flag rate during stress |
| S2 | 34 | 0.147 | Yes | 0 | 0.526 |
| S3 | 34 | 0.235 | Yes | 0 | 0.500 |
| S4 | 35 | 0.171 | Yes | 0 | 0.474 |
| S5 | 36 | 0.056 | Yes | 0 | 0.421 |
| S6 | 35 | 0.114 | Yes | 0 | 0.500 |
| S7 | 35 | 0.143 | Yes | 0 | 0.737 |
| S8 | 35 | 0.314 | Yes | 0 | 0.571 |
| S9 | 35 | 0.171 | Yes | 0 | 0.737 |
| S10 | 35 | 0.057 | Yes | 3 | 0.273 |
| S11 | 36 | 0.389 | Yes | 0 | 0.476 |
| S13 | 36 | 0.111 | Yes | 1 | 0.750 |
| S14 | 36 | 0.167 | Yes | 0 | 0.222 |
| S15 | 35 | 0.486 | Yes | 3 | 0.048 |
| S16 | 35 | 0.086 | Yes | 0 | 0.667 |
| S17 | 35 | 0.114 | Yes | 0 | 0.550 |
Source: validate_trend_detector.py, trend_validation_per_subject.csv.

##- A.4 Feature selection summary

The four-method vote (Spearman correlation, Extra Trees importance, recursive feature elimination and permutation importance) gave four votes to AVNN, MeanHR, SDHR, wavelet_d3_energy and EDA_slope, three votes to SCR_count, pNN50, pNN20 and SCL_slope, and two votes to a further 14 features, 22 in total. The full table is in feature_selection_summary.csv. [[TODO: add the full 40-feature table here if the supervisor asks for it.]]

##- A.5 Usability study instruments

[[TODO: add the consent form, the task list, the System Usability Scale questionnaire and the open questions used in the usability study.]]

##- A.6 Research artefacts

Notebooks: 01_environment_verification, 02_dataset_verification, 03_preprocessing_pipeline, 04_feature_selection, 05_model_training and 06_binary_personalization_validation. Scripts: validate_trend_detector.py. Saved artefacts: best_model_obj1_v2.pkl, scaler_obj1_v2.pkl, feature_cols_obj1_v2.pkl. [[TODO: add the repository link and commit identifier of the version used for this thesis.]]

#- Appendix B: Academic Integrity and AI Use Disclosure

This appendix must be completed and checked by the author. The entries below describe how the generative AI tool was used in this work; replace anything that is not exactly true.

Table[a_ai]: Generative AI use in this work
| Item | Disclosure |
| Tool | Claude Code (Anthropic), a coding and writing assistant; [[TODO: add any other tool used, for example a grammar checker]] |
| Purpose | Writing and refactoring code (backend routes, mobile application, web dashboard); writing analysis scripts and notebook cells (the ten-model comparison, the balanced-accuracy table, the trend-indicator validation, figure scripts); explaining signal-processing and statistics concepts; checking results against the code and data; drafting and formatting this thesis |
| Representative workflow | The author described a requirement or a defect; the tool proposed code or text; the author ran the code, inspected the outputs and the data, and accepted, changed or rejected the proposal. [[TODO: add two or three representative prompts]] |
| Verification performed | [[TODO: state exactly what you did, for example: re-ran notebooks 05 and 06 and compared the printed values with Chapter 6; ran the trend script; ran the app and website against the live backend; checked every reference against the original paper; read and rewrote the thesis text]] |
| Sections and artefacts affected | Code under backend/physiological, StressApp and web; notebook 05 cells 1.5 to 1.7; validate_trend_detector.py; thesis scripts and the draft text of Chapters 1 to 9. [[TODO: confirm]] |
| Responsibility | The author remains responsible for the accuracy, originality, citations, code, data, analyses and conclusions in this thesis. |
Source: author's declaration.
