# Thesis draft: what you still need to fill in

Every item below is highlighted yellow in the Word file. Search the document for "TODO" to jump between them.
Total open items in the text: **62**.


Also on the title page and declaration: [STUDENT ID], [GROUP ID], [SPECIALISATION], [MONTH YEAR], supervisor and co-supervisor names. Edit them in Word, or in META at the top of build_thesis.py.

## Abstract (1)
- [ ] add one sentence on the user-study result (SUS score, number of participants).

## Acknowledgements (4)
- [ ] supervisor name
- [ ] co-supervisor name
- [ ] member names and their components
- [ ] add funding, equipment loans or any other substantial technical assistance, or delete this sentence.

## Chapter 1 Introduction (3)
- [ ] confirm this wording matches the final user-study plan.
- [ ] link to the usability study results when available.
- [ ] adjust this list to match exactly what you and your group members agreed as individual contributions.

## Chapter 2 Literature review (7)
- [ ] databases searched, e.g. IEEE Xplore, ACM Digital Library, MDPI, Google Scholar
- [ ] list, e.g. "stress detection", "wearable", "HRV", "GSR", "WESAD", "personalised"
- [ ] years
- [ ] state the number of papers screened and included, and add the reported accuracy and dataset of each study to the table from your literature spreadsheet.
- [ ] state the accuracy and validation protocol each study reports.
- [ ] name two or three products, cite their documentation, and state whether they use a personal baseline, a personal threshold, or EDA.
- [ ] cite the manufacturer's documentation.

## Chapter 3 Methodology (7)
- [ ] confirm in notebook 03 which boundary-exclusion rule produced the 913-window table; an earlier variant with a 30-second boundary exclusion gave 854 windows.
- [ ] state how many distinct real participants wore the ring, the recruitment method, and the total ring hours collected.
- [ ] describe the participants (number, age range, background), the tasks (register, calibrate, read the home screen, find the baseline chart, open the clinical view), the questionnaire (System Usability Scale {{cite:brooke}} and open questions) and how long each session took.
- [ ] add any additional measures from the user study, such as time on task.
- [ ] state whether any significance test was run (for example a paired test across the 15 per-subject accuracies) and report it in Chapter 6; if not, say that the comparison is descriptive.
- [ ] add the ethics-approval reference, the consent procedure for ring wearers and usability participants, and the data-retention policy.
- [ ] add the repository link, Python and library versions, and the dataset access instructions.

## Chapter 4 Design (3)
- [ ] add how the requirements were gathered, for example interviews, a survey, or supervisor meetings, with dates.
- [ ] replace the five figure placeholders below with real screenshots.
- [ ] add any coding standard, accessibility guideline, or data-protection law you followed, for example Sri Lanka's Personal Data Protection Act, No. 9 of 2022.

## Chapter 5 Implementation (6)
- [ ] add the firmware framework and language, the IDE, and the versions of the Python libraries from requirements.txt.
- [ ] add one paragraph on how the fusion weights are computed and tested if you contributed to that part; otherwise refer the reader to the fusion section of the group report.
- [ ] add the test cases you actually ran as a table: ID, description, input, expected result, actual result, pass/fail. Suggested cases: register, log in with a wrong password, calibrate with the ring off, calibrate with the finger off the ring, limit test with poor separation (fallback), recalibrate (EMA blend), view a user in the clinical view, open the website while the phone is live. Do not claim automated tests or counts that were not run.
- [ ] retrain on baseline-normalised features as in notebook 06, re-derive the threshold, re-run Section 6.1 checks
- [ ] multiply by 100 in the ring code or rescale
- [ ] add the deployment steps you used, the monitoring you did, and any outage observed.

## Chapter 6 Results (12)
- [ ] separate these two reasons from the records, and report how many wearers took the limit test.
- [ ] add measured values if you have them: end-to-end latency from the end of a window to the on-screen update (median and worst case); heart-rate agreement between the MAX30102 and a reference pulse oximeter (mean absolute error over N minutes); GSR response to a known stimulus such as a deep breath or a cold object; motion-gate behaviour; battery life of the 250 mAh cell. Without a measurement, state that it was not measured.
- [ ] report the usability study. Suggested layout: a table with participants (number, age range, background), mean System Usability Scale score and its interpretation, task success rate for each task, and the most common comments. Quote two or three participants. State what you changed afterwards. During development, the interface was already simplified in response to feedback that the first version was cluttered: technical charts moved to the clinical view, plain-language states replaced probabilities, and the calibration screen gained a progress ring and per-device progress.
- [ ] number and profile
- [ ] score
- [ ] %
- [ ] %
- [ ] %
- [ ] %
- [ ] date
- [ ] report how the ring and the EEG probabilities combined in the fusion engine: number of fused windows, how often the two modalities agreed or disagreed, and one or two example sessions with the fused state. Report that the website and phone shared one live session without taking the devices from each other, if you tested it.
- [ ] user-study finding.

## Chapter 7 Discussion (3)
- [ ] insert the accuracy, dataset and validation protocol reported by each of these studies.
- [ ] complete the comparison table from your literature spreadsheet: study, sensors, dataset, validation protocol, accuracy, personalisation, trend, and add one sentence for each.
- [ ] state sample size and selection limits of the usability study.

## Chapter 8 Commercialisation (7)
- [ ] add two or three user personas and, if you have them, the needs you heard from real users.
- [ ] name the main products, cite their documentation or price pages, and summarise them in a table: sensors, personal baseline, personal threshold, price, openness.
- [ ] add market size figures only from a cited report.
- [ ] add the bill of materials with prices for the ring components and an estimated unit cost.
- [ ] list the main licences, for example Flask, scikit-learn, XGBoost, React
- [ ] state whether a patent or registered design is planned.
- [ ] add the relevant data-protection law, for example Sri Lanka's Personal Data Protection Act, No. 9 of 2022, and any ethics approval.

## Chapter 9 Conclusion (2)
- [ ] status
- [ ] align the wording with Section 1.8 and with your group's agreed split.

## Appendices (7)
- [ ] add the full 40-feature table here if the supervisor asks for it.
- [ ] add the consent form, the task list, the System Usability Scale questionnaire and the open questions used in the usability study.
- [ ] add the repository link and commit identifier of the version used for this thesis.
- [ ] add any other tool used, for example a grammar checker
- [ ] add two or three representative prompts
- [ ] state exactly what you did, for example: re-ran notebooks 05 and 06 and compared the printed values with Chapter 6; ran the trend script; ran the app and website against the live backend; checked every reference against the original paper; read and rewrote the thesis text
- [ ] confirm
