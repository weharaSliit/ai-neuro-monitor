# Product and Solution Design

## Requirements

Requirements were derived from the research aim, the supervisor's feedback and the needs of two user groups: wearers, who need an understandable state, and researchers or clinicians, who need detail. The research topic was agreed with the supervisor, and the requirements were set through discussion with the supervisor and a review of the literature (Chapter 2); no interviews or survey of prospective users were carried out. The needs of the two user groups are therefore the author's reasoned assumptions from the literature and from the way similar systems present results, and they have not been confirmed with users. The usability evaluation in Chapter 6 is the first point at which user feedback is collected.

Table[reqs]: Functional and non-functional requirements of the ring component
| ID | Requirement | Priority |
| FR1 | Stream ring data (inter-beat intervals, GSR, acceleration) to the backend | High |
| FR2 | Extract the 23 features from each 60-second window and return a stress probability | High |
| FR3 | Capture a calm baseline in about 3.5 minutes with live progress | High |
| FR4 | Set a personal threshold from rest and task scores, or fall back to the population threshold | High |
| FR5 | Warn when the recent average moves away from the calm baseline | Medium |
| FR6 | Flag a rising stress pattern without changing the label | Medium |
| FR7 | Show a plain-language state, with ring, slider and chart, in the app and on the web | High |
| FR8 | Provide a clinical view with all features, processed signals and calibration records | Medium |
| NFR1 | A new reading appears within about one minute of the window ending | High |
| NFR2 | Interfaces fit phones, tablets and desktops | High |
| NFR3 | No raw sensor streams stored in the cloud database | High |
| NFR4 | Services tolerate the cold start of a free hosting tier | Medium |
| NFR5 | A failed or poor calibration never makes results worse than the population model | High |
Source: compiled by the author.

## Component Architecture within the Complete Solution

{{fig:architecture}} shows the architecture. The ring publishes its samples over MQTT with TLS to a cloud broker. A bridge forwards each window to the Flask physiological service, which extracts features, scores the window, applies the user's baseline and threshold, and writes the result to the Firebase Realtime Database. The fusion engine, shared with the EEG component, reads the ring and EEG probabilities for the same minute, judges each against its own personal threshold, and writes a fused state. The mobile application, the web dashboard and the clinical view read the database and call the Flask routes for history, baseline and calibration. Authentication is a bearer token issued by the Flask service.

Figure[architecture]: fig_architecture.png | System architecture and data flow of the ring component
Source: compiled by the author.

## Design Alternatives and Decisions

**Model.** Ten classifiers were compared (Section 6.1). XGBoost was kept as the deployed model although it is not the most accurate model in the comparison: LDA reaches higher accuracy (0.908) but catches only 80.7% of stress windows against 96.4% of Normal windows, a recall gap of 0.157. XGBoost has a recall gap of 0.017, a balanced accuracy of 0.853, and returns well-behaved probabilities that suit a ROC-derived and later personalised threshold. The decision therefore rests on balanced errors and probability behaviour rather than on peak accuracy, and is stated as such. These figures describe the comparison on raw features; XGBoost was then retrained on baseline-normalised features, which is how it is used on the ring.

**Binary rather than three-class.** An earlier three-class variant with a "pre-stress" class was dropped because the dataset provides no real ground truth for it and models did not learn it. Early warning is instead given by a separate trend indicator that never overrides the label.

**Personalisation by baseline, threshold and adaptation.** A personal baseline corrects the inputs, a personal threshold corrects the decision point, and an EMA blend lets the baseline move slowly. A personal threshold is accepted only when rest and task scores separate by at least 0.10, which makes the mechanism safe by design: it can help or do nothing.

**Processed previews instead of raw streams.** Storing raw signals would fill the database and expose more personal data, so only features and small processed previews are stored.

**Two interfaces from one backend.** A mobile application serves wearers on the move and a web dashboard serves desktop use and demonstrations; both read the same services so that they always agree.

## Detailed Design

### Signal processing and decision logic

The processing chain is shown in {{fig:pipeline}} (Chapter 3). Each 60-second window yields 23 features, and the window is rejected, not filled in, if motion exceeds the gate or fewer than four clean beats are found. The classifier outputs a stress probability *p*. A window is labelled Stress if *p* is at least the user's threshold *T*, where *T* is the personal threshold when one exists and 0.6447 otherwise. For display, the state is Low if *p* < *T* − 0.12, Moderate if *p* lies within 0.12 below *T*, and High if *p* ≥ *T*. A user who has no baseline yet is scored by the earlier raw-feature model against its own threshold of 0.7141.

### Data model

The Realtime Database holds, per user, the baseline mean and standard deviation of every feature, the resting scores, the personal threshold, per-session windows (features, probability, label, trend flag, and the processed preview), baseline-adaptation records, and the fused windows written by the fusion engine. Window keys of the fused records are epoch minutes, so the ring and EEG records of the same minute meet in one record.

### Backend services

The Flask service exposes routes to register and log in, to score a window (`/predict`), to run the calm baseline (`/calibrate/start`, `/calibrate/status`) and the limit test (`/calibrate/threshold/start`, `/calibrate/threshold/status`), and to read baselines, history, drift history, adaptation history and, for the clinical view, the same data for any user.

### Interface design

The home screen shows a greeting, a coloured state card (Calm, Rising, Stressed), two rings (Mind and Body), an overall stress slider with the user's own limit marked, a stress-rhythm chart, shortcuts, and the status of the ring, headband and phone. The Ring screen shows the Body ring with a Stress, Heart and Skin chart. The Profile holds the calibration steps and personal limits, and the baseline-change card appears on the home screen. The clinical view lists users, shows the live user first, and offers per-user tabs with feature charts selected by a dropdown. All charts size themselves to their container, scroll sideways when crowded, and show a value on touch or hover. The website mirrors these screens. {{fig:ui_home}} to {{fig:ui_clinical}} show the main screens. [[TODO: replace the five figure placeholders below with real screenshots.]]

Figure[ui_home]: PLACEHOLDER | Home screen of the mobile application | screenshot of the mobile home screen (state card, rings, slider, rhythm chart)
Figure[ui_ring]: PLACEHOLDER | Ring screen with the Stress, Heart and Skin chart | screenshot of the Ring screen
Figure[ui_calibration]: PLACEHOLDER | Calm-breathing calibration with progress ring and per-device progress | screenshot of the calibration screen while running
Figure[ui_baseline]: PLACEHOLDER | Baseline-change card on the home screen | screenshot of the "Has your baseline changed?" card
Figure[ui_clinical]: PLACEHOLDER | Clinical view with feature dropdown chart | screenshot of the website or app clinical view

## Standards and Professional Practice

HRV measures follow the standards of measurement {{cite:taskforce}}, and EDA processing follows the tonic and phasic decomposition of the literature {{cite:boucsein,benedek}}. References follow the IEEE style. Passwords are hashed, tokens expire after 30 days, and data minimisation is applied by storing derived values only. Interfaces use sufficient colour contrast and plain language. [[TODO: add any coding standard, accessibility guideline, or data-protection law you followed, for example Sri Lanka's Personal Data Protection Act, No. 9 of 2022.]]
