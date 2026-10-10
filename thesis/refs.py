"""Reference database (IEEE style). Keys are cited in the chapters as {{cite:key}}; numbers are assigned
automatically in order of first citation and the list is built from the citations actually used.
Entries marked [[TODO: ...]] are shown highlighted in the document so they get verified."""

REFS = {
    # ---- the student's own literature list (numbering [13]-[28] in the group report) ----
    'wesad': 'P. Schmidt, A. Reiss, R. Duerichen, C. Marberger, and K. Van Laerhoven, "Introducing WESAD, a multimodal dataset for wearable stress and affect detection," in *Proc. 20th ACM Int. Conf. Multimodal Interaction (ICMI \'18)*, 2018, pp. 400–408, doi: 10.1145/3242969.3242985.',
    'taskasaplidis': 'G. V. Taskasaplidis, D. Fotiadis, and P. D. Bamidis, "Review of stress detection methods using wearable sensors," *IEEE Access*, vol. 12, pp. 38219–38246, 2024, doi: 10.1109/ACCESS.2024.3373010.',
    'dalmeida': 'D. Dalmeida and G. L. Masala, "HRV features as viable physiological markers for stress detection using wearable devices," *Sensors*, vol. 21, no. 8, 2021, doi: 10.3390/s21082873.',
    'haque': 'Y. Haque, R. S. Zawad, C. S. A. Rony, H. Al Banna, T. Ghosh, M. S. Kaiser, and M. Mahmud, "State-of-the-art of stress prediction from heart rate variability using artificial intelligence," *Cognitive Computation*, vol. 16, pp. 455–481, 2024.',
    'lazarou': 'E. Lazarou and T. P. Exarchos, "Predicting stress levels using physiological data: Real-time stress prediction models utilizing wearable devices," *AIMS Neuroscience*, vol. 11, no. 2, pp. 76–102, Apr. 2024, doi: 10.3934/Neuroscience.2024006.',
    'kyriakou': 'N. Kyriakou et al., "Detecting moments of stress from measurements of wearable physiological sensors," *Sensors*, vol. 19, no. 17, 2019, doi: 10.3390/s19173805.',
    'prasad': 'Prasad and Upadhyaya, "Stress monitoring using wearable technology," in *Proc. IEEE Int. Conf. Comput. Autom. (ICCA)*, 2025. [[TODO: verify authors\' initials, pages and DOI before submission]]',
    'mozafari': 'E. Mozafari, F. Firouzi, and B. Farahani, "Towards IoT-enabled multimodal mental stress monitoring," in *Proc. IEEE Int. Conf. Omni-Layer Intell. Syst. (COINS)*, 2020, doi: 10.1109/COINS49042.2020.9191392.',
    'villarejo': 'A. Villarejo, B. Zapirain, and A. Zorrilla, "A stress sensor based on galvanic skin response (GSR) controlled by ZigBee," *Sensors*, vol. 12, no. 5, pp. 6075–6101, 2012.',
    'dybvik': 'A. Dybvik et al., "fNIRS, EEG, ECG, and GSR reveal an effect of complex, dynamically changing environments on cognitive load, affective state, and performance, but not physiological stress," *Frontiers in Human Neuroscience*, vol. 19, 2025, doi: 10.3389/fnhum.2025.1459653.',
    'segono': 'Y. Segono, E. Y. M. Hutagalung, H. G. Simbolon, N. I. Us, et al., "IoT-based stress monitoring using CNN for HRV-GSR analysis," *SinkrOn*, vol. 10, no. 1, pp. 621–637, 2026, doi: 10.33395/sinkron.v10i1.15671.',
    'calvo': 'A. Calvo, J. Martin, and C. Martín, "Early detection of chronic stress using wearable devices: A machine learning approach with the WESAD database," in *Proc. Int. Conf. Inf. Commun. Technol. Ageing Well e-Health (ICT4AWE)*, 2025, doi: 10.5220/0013209700003938.',
    'nechyporenko': 'A. Nechyporenko, M. Frohme, Y. Strelchuk, V. Omelchenko, V. Gargin, L. Ishchenko, and V. Alekseeva, "Galvanic skin response and photoplethysmography for stress recognition using machine learning and wearable sensors," *Applied Sciences*, vol. 14, no. 24, art. no. 11997, 2024, doi: 10.3390/app142411997.',
    'gedam': 'S. Gedam, P. Pranav, S. Dutta, and R. Jha, "A deep learning approach with wearable physiological sensors and feature selection methods to detect mental stress in Indian housewives," *Discover Artificial Intelligence*, vol. 6, art. no. 113, 2026.',
    'pataca': 'A. O. Pataca, E. Zdravevski, P. J. Coelho, N. M. Garcia, M. Deryuck, C. Albuquerque, et al., "Use of machine learning for predicting stress episodes based on wearable sensor data: A systematic review," *Computers in Biology and Medicine*, vol. 198, Part A, art. no. 111166, 2025, doi: 10.1016/j.compbiomed.2025.111166.',
    'anusha': 'A. S. Anusha, P. Sukumaran, V. Sarveswaran, S. Surees Kumar, A. Shyam, T. J. Akl, S. P. Preejith, and M. Sivaprakasam, "Electrodermal activity based pre-surgery stress detection using a wrist wearable," *IEEE J. Biomed. Health Inform.*, vol. 24, no. 1, pp. 92–100, Jan. 2020, doi: 10.1109/JBHI.2019.2893222.',
    # ---- additional standard sources ----
    'chen': 'T. Chen and C. Guestrin, "XGBoost: A scalable tree boosting system," in *Proc. 22nd ACM SIGKDD Int. Conf. Knowledge Discovery and Data Mining*, San Francisco, CA, USA, 2016, pp. 785–794.',
    'taskforce': 'Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology, "Heart rate variability: Standards of measurement, physiological interpretation, and clinical use," *Circulation*, vol. 93, no. 5, pp. 1043–1065, 1996.',
    'shaffer': 'F. Shaffer and J. P. Ginsberg, "An overview of heart rate variability metrics and norms," *Frontiers in Public Health*, vol. 5, art. no. 258, 2017.',
    'boucsein': 'W. Boucsein, *Electrodermal Activity*, 2nd ed. New York, NY, USA: Springer, 2012.',
    'benedek': 'M. Benedek and C. Kaernbach, "A continuous measure of phasic electrodermal activity," *Journal of Neuroscience Methods*, vol. 190, no. 1, pp. 80–91, 2010.',
    'kirschbaum': 'C. Kirschbaum, K.-M. Pirke, and D. H. Hellhammer, "The \'Trier Social Stress Test\' — a tool for investigating psychobiological stress responses in a laboratory setting," *Neuropsychobiology*, vol. 28, no. 1–2, pp. 76–81, 1993.',
    'stroop': 'J. R. Stroop, "Studies of interference in serial verbal reactions," *Journal of Experimental Psychology*, vol. 18, no. 6, pp. 643–662, 1935.',
    'cohen': 'S. Cohen, T. Kamarck, and R. Mermelstein, "A global measure of perceived stress," *Journal of Health and Social Behavior*, vol. 24, no. 4, pp. 385–396, 1983.',
    'youden': 'W. J. Youden, "Index for rating diagnostic tests," *Cancer*, vol. 3, no. 1, pp. 32–35, 1950.',
    'brooke': 'J. Brooke, "SUS: A quick and dirty usability scale," in *Usability Evaluation in Industry*, P. W. Jordan et al., Eds. London, U.K.: Taylor & Francis, 1996, pp. 189–194.',
    'pedregosa': 'F. Pedregosa et al., "Scikit-learn: Machine learning in Python," *Journal of Machine Learning Research*, vol. 12, pp. 2825–2830, 2011.',
    'swell': 'S. Koldijk, M. Sappelli, S. Verberne, M. A. Neerincx, and W. Kraaij, "The SWELL knowledge work dataset for stress and user modeling research," in *Proc. 16th Int. Conf. Multimodal Interaction (ICMI \'14)*, Istanbul, Turkey, 2014, pp. 291–298.',
    'pantompkins': 'J. Pan and W. J. Tompkins, "A real-time QRS detection algorithm," *IEEE Transactions on Biomedical Engineering*, vol. BME-32, no. 3, pp. 230–236, 1985.',
}
