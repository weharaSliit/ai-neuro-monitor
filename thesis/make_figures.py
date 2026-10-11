"""Generates every diagram/chart used in the thesis from verified numbers.
Run:  python thesis/make_figures.py
Numbers come from physiological_signals notebooks 05/06, validate_trend_detector.py and the
live Firebase personal_thresholds record (see thesis chapters for sources)."""
import os
import shutil

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'thesis', 'figures')
os.makedirs(OUT, exist_ok=True)
plt.rcParams['font.family'] = 'DejaVu Serif'

BRAND, GREEN, CORAL, AMBER, GREY = '#6E68B2', '#5E935A', '#E56B4E', '#E8A238', '#98929A'


def box(ax, x, y, w, h, text, fc='#EFEFFB', ec=BRAND, fs=9, bold=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0.02,rounding_size=0.08',
                                fc=fc, ec=ec, lw=1.4))
    ax.text(x + w / 2, y + h / 2, text, ha='center', va='center', fontsize=fs,
            fontweight='bold' if bold else 'normal', wrap=True)


def arrow(ax, x1, y1, x2, y2, color='#444'):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle='-|>', mutation_scale=12,
                                 color=color, lw=1.3))


def canvas(w, h):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, w)
    ax.set_ylim(0, h)
    ax.axis('off')
    return fig, ax


# ---- Figure 2.1 conceptual framework --------------------------------------
fig, ax = canvas(9, 3.2)
steps = ['Population\nmodel\n(WESAD, XGBoost)', 'Personal\nbaseline\n(calm breathing)',
         'Personal\nthreshold\n(limit test)', 'Drift check\n(last 7 days)',
         'Trend\nindicator', 'Plain-language\nstate']
for i, s in enumerate(steps):
    x = 0.2 + i * 1.48
    box(ax, x, 1.0, 1.25, 1.3, s, fc=['#EFEFFB', '#E7F5E5', '#E7F5E5', '#FEF5E7', '#FEF5E7', '#FDECE8'][i],
        ec=[BRAND, GREEN, GREEN, AMBER, AMBER, CORAL][i], fs=8.5)
    if i < len(steps) - 1:
        arrow(ax, x + 1.27, 1.65, x + 1.46, 1.65)
ax.text(4.5, 2.85, 'Conceptual framework of the personalised stress detector', ha='center', fontsize=10, fontweight='bold')
ax.text(4.5, 0.45, 'each layer addresses one gap: device transfer, individual variability, baseline staleness, early warning, interpretability',
        ha='center', fontsize=8, color=GREY)
fig.savefig(os.path.join(OUT, 'fig_framework.png'), dpi=200, bbox_inches='tight')
plt.close(fig)

# ---- Figure 4.1 system architecture ---------------------------------------
fig, ax = canvas(9.5, 4.4)
box(ax, 0.2, 2.9, 1.9, 0.9, 'Smart ring\nXIAO ESP32-C3\nMAX30102 · GSR · MPU-6050', fc='#E7F5E5', ec=GREEN, fs=8)
box(ax, 2.6, 2.9, 1.5, 0.9, 'MQTT broker\n(EMQX Cloud, TLS)', fs=8.5)
box(ax, 4.6, 2.9, 2.2, 0.9, 'Flask physiological service\nfeatures · model · calibration', fc='#EFEFFB', ec=BRAND, fs=8.5, bold=True)
box(ax, 7.2, 2.9, 2.1, 0.9, 'Firebase Realtime DB\nwindows · baselines\nthresholds', fc='#FEF5E7', ec=AMBER, fs=8.5)
box(ax, 4.6, 1.4, 2.2, 0.9, 'Fusion engine\n(with EEG component)', fs=8.5)
box(ax, 0.9, 0.15, 2.6, 0.85, 'Mobile app\n(React Native, Expo)', fc='#FDECE8', ec=CORAL, fs=8.5)
box(ax, 4.0, 0.15, 2.6, 0.85, 'Web dashboard\n(React, Vite)', fc='#FDECE8', ec=CORAL, fs=8.5)
box(ax, 7.1, 0.15, 2.2, 0.85, 'Clinical view\n(admin)', fc='#FDECE8', ec=CORAL, fs=8.5)
arrow(ax, 2.1, 3.35, 2.6, 3.35); arrow(ax, 4.1, 3.35, 4.6, 3.35); arrow(ax, 6.8, 3.35, 7.2, 3.35)
arrow(ax, 5.7, 2.9, 5.7, 2.3); arrow(ax, 6.8, 1.85, 8.2, 2.9)
arrow(ax, 8.2, 2.9, 6.9, 1.0); arrow(ax, 8.2, 2.9, 5.3, 1.0); arrow(ax, 8.2, 2.9, 2.2, 1.0)
ax.text(4.75, 4.15, 'System architecture and data flow of the ring component', ha='center', fontsize=10, fontweight='bold')
fig.savefig(os.path.join(OUT, 'fig_architecture.png'), dpi=200, bbox_inches='tight')
plt.close(fig)

# ---- Figure 4.2 signal processing pipeline ---------------------------------
fig, ax = canvas(9.5, 4.0)
box(ax, 0.2, 2.6, 2.0, 0.9, 'GSR samples (~5 Hz)', fc='#E7F5E5', ec=GREEN, fs=8.5)
box(ax, 0.2, 1.3, 2.0, 0.9, 'Inter-beat intervals\n(MAX30102)', fc='#E7F5E5', ec=GREEN, fs=8.5)
box(ax, 0.2, 0.1, 2.0, 0.9, 'Acceleration\n(MPU-6050)', fc='#E7F5E5', ec=GREEN, fs=8.5)
box(ax, 2.8, 2.6, 2.7, 0.9, 'IQR clip · detrend\nlow-pass · high-pass\ntonic / phasic · Haar wavelet', fs=8)
box(ax, 2.8, 1.3, 2.7, 0.9, '300–2000 ms range\n±20% local-median filter\n(≥4 clean beats)', fs=8)
box(ax, 2.8, 0.1, 2.7, 0.9, 'magnitude · mean · SD\nmotion gate', fs=8)
box(ax, 6.1, 1.3, 1.6, 0.9, '60 s window\n23 features', fc='#FEF5E7', ec=AMBER, fs=9, bold=True)
box(ax, 8.1, 1.3, 1.3, 0.9, 'Baseline\nnormalise\n→ model', fc='#EFEFFB', ec=BRAND, fs=8.5)
for y in (3.05, 1.75, 0.55):
    arrow(ax, 2.2, y, 2.8, y)
for y in (3.05, 1.75, 0.55):
    arrow(ax, 5.5, y, 6.1, 1.75)
arrow(ax, 7.7, 1.75, 8.1, 1.75)
ax.text(4.75, 3.85, 'Signal processing and feature extraction (per 60-second window)', ha='center', fontsize=10, fontweight='bold')
fig.savefig(os.path.join(OUT, 'fig_signal_pipeline.png'), dpi=200, bbox_inches='tight')
plt.close(fig)

# ---- Figure 4.3 calibration and personalisation flow -----------------------
fig, ax = canvas(9.5, 3.5)
items = [('Settle\n30 s', '#EFEFFB', BRAND), ('Calm breathing\n3 × 60 s windows\n→ baseline', '#E7F5E5', GREEN),
         ('Score rest\nwindows\n(3 values)', '#E7F5E5', GREEN), ('Limit test\n8 min, 5 activities\n→ task scores', '#FEF5E7', AMBER),
         ('Separation\n≥ 0.10 ?', '#FFFFFF', GREY), ('Personal threshold\n= midpoint', '#FDECE8', CORAL)]
xs = [0.1, 1.65, 3.35, 5.0, 6.75, 8.0]
ws = [1.3, 1.5, 1.4, 1.55, 1.1, 1.4]
for (t, fc, ec), x, w in zip(items, xs, ws):
    box(ax, x, 1.5, w, 1.0, t, fc=fc, ec=ec, fs=8)
for i in range(len(xs) - 1):
    arrow(ax, xs[i] + ws[i] + 0.01, 2.0, xs[i + 1] - 0.01, 2.0)
box(ax, 6.0, 0.15, 3.3, 0.8, 'No → keep the population threshold 0.7141', fc='#F0ECE4', ec=GREY, fs=8.5)
arrow(ax, 7.3, 1.5, 7.6, 0.95)
ax.text(4.75, 3.2, 'Calibration and personal-threshold procedure', ha='center', fontsize=10, fontweight='bold')
fig.savefig(os.path.join(OUT, 'fig_calibration_flow.png'), dpi=200, bbox_inches='tight')
plt.close(fig)

# ---- Figure 6.1 ten-model comparison ---------------------------------------
models = ['LDA', 'KNN', 'Random Forest', 'XGBoost', 'Gradient Boosting', 'SVM-RBF', 'MLP',
          'Logistic Reg.', 'SVM-Linear', 'AdaBoost']
acc = [0.908, 0.864, 0.864, 0.851, 0.850, 0.851, 0.851, 0.838, 0.808, 0.811]
bal = [0.885, 0.860, 0.858, 0.853, 0.857, 0.850, 0.845, 0.853, 0.823, 0.816]
gap = [0.157, 0.027, 0.042, 0.017, 0.047, 0.007, 0.045, 0.109, 0.103, 0.037]
fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2), gridspec_kw={'width_ratios': [1.5, 1]})
y = range(len(models))
a1.barh([i + 0.2 for i in y], acc, height=0.38, color=BRAND, label='Accuracy')
a1.barh([i - 0.2 for i in y], bal, height=0.38, color=GREEN, label='Balanced accuracy')
a1.set_yticks(list(y)); a1.set_yticklabels(models, fontsize=8); a1.invert_yaxis()
a1.set_xlim(0.75, 0.93); a1.set_xlabel('LOSO score', fontsize=9); a1.legend(fontsize=8, loc='lower right')
a1.set_title('Accuracy and balanced accuracy', fontsize=10)
cols = [CORAL if g > 0.1 else (AMBER if g > 0.04 else GREEN) for g in gap]
a2.barh(list(y), gap, color=cols); a2.set_yticks(list(y)); a2.set_yticklabels([]); a2.invert_yaxis()
a2.set_xlabel('|recall(Normal) − recall(Stress)|', fontsize=9); a2.set_title('Recall gap (smaller = more even)', fontsize=10)
for i, g in enumerate(gap):
    a2.text(g + 0.003, i, f'{g:.3f}', va='center', fontsize=8)
fig.suptitle('Ten classifiers under leave-one-subject-out validation (WESAD, 15 subjects, 913 windows)', fontsize=10, fontweight='bold')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'fig_model_comparison.png'), dpi=200, bbox_inches='tight')
plt.close(fig)

# ---- Figure 6.3 static vs personalised (notebook 06) -----------------------
fig, ax = plt.subplots(figsize=(7.5, 3.8))
labels = ['Accuracy', 'F1-macro', 'F1-Normal', 'F1-Stress']
st = [0.851, 0.842, 0.879, 0.805]
pe = [0.934, 0.928, 0.949, 0.907]
xs_ = range(4)
ax.bar([i - 0.2 for i in xs_], st, 0.38, color=GREY, label='Static model')
ax.bar([i + 0.2 for i in xs_], pe, 0.38, color=BRAND, label='Personal baseline, retrained')
for i in xs_:
    ax.text(i - 0.2, st[i] + 0.006, f'{st[i]:.3f}', ha='center', fontsize=8)
    ax.text(i + 0.2, pe[i] + 0.006, f'{pe[i]:.3f}', ha='center', fontsize=8)
ax.set_xticks(list(xs_)); ax.set_xticklabels(labels); ax.set_ylim(0.7, 1.0); ax.legend(fontsize=8, loc='upper left')
ax.set_title('Leave-one-subject-out: static vs personal-baseline model (research setting)', fontsize=10, fontweight='bold')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'fig_personalisation.png'), dpi=200, bbox_inches='tight')
plt.close(fig)

# ---- Figure 6.5 real-user personal thresholds ------------------------------
vals = [0.348, 0.353, 0.405, 0.477, 0.572]
fig, ax = plt.subplots(figsize=(7.2, 3.6))
ax.bar([f'User {i + 1}' for i in range(5)], vals, color=GREEN)
ax.axhline(0.7141, color=CORAL, ls='--', lw=1.6)
ax.text(4.45, 0.7141 + 0.015, 'population threshold 0.7141', ha='right', color=CORAL, fontsize=8.5)
for i, v in enumerate(vals):
    ax.text(i, v + 0.012, f'{v:.3f}', ha='center', fontsize=8.5)
ax.set_ylim(0, 0.85); ax.set_ylabel('Personal stress threshold')
ax.set_title('Personal thresholds produced on real ring data (5 of 17 calibrated records)', fontsize=10, fontweight='bold')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'fig_real_thresholds.png'), dpi=200, bbox_inches='tight')
plt.close(fig)

# ---- copy existing result images -------------------------------------------
shutil.copy(os.path.join(ROOT, 'physiological_model_evaluation_20260901T020755.png'), os.path.join(OUT, 'fig_loso_evaluation.png'))
shutil.copy(os.path.join(ROOT, 'physiological_signals', 'results', 'objective2', 'trend_validation.png'), os.path.join(OUT, 'fig_trend_validation.png'))
print('figures written to', OUT, sorted(os.listdir(OUT)))
