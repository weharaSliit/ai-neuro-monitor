#!/usr/bin/env python3
"""
Train and persist the final offline T7/T8 stress-state model for SAM40.

Two distinct things happen here, and they must not be conflated:

1. Model SELECTION: every model family in sam40.train.MODELS is evaluated
   with leave-one-subject-out CV (the same subject-independent protocol used
   throughout this project). This LOSO score is the honest estimate of how
   the model would perform on a person it has never seen.

2. Model PERSISTENCE: the winning model family is then refit on ALL 40
   subjects' data and saved to disk -- this is the actual deployable
   artifact. Its LOSO score from step 1 is what you report as its expected
   real-world accuracy; you cannot re-evaluate the saved model on this same
   data to check that number, since it has already seen everyone in it.

Usage:
    python3 scripts/train_final_model.py
    python3 scripts/train_final_model.py --features results/features_T7-T8_4.0s.csv --label label_task
"""

import argparse
import sys
from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from sam40.train import MODELS, feature_columns, loso_evaluate, summarize  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--features', default=str(ROOT / 'results' / 'features_bipolar_only_25s_block.csv'))
    parser.add_argument('--label', default='label_task',
                         help="label_task is the only SAM40 label with real LOSO signal above "
                              "chance for T7/T8 (see results/SESSION_SUMMARY.md) -- label_rating "
                              "is near-chance even with all 32 channels.")
    parser.add_argument('--out-dir', default=str(ROOT / 'results' / 'models_25s_block_bipolar_only'))
    args = parser.parse_args()

    df = pd.read_csv(args.features)
    print(f'Loaded {len(df)} rows, {df.subject.nunique()} subjects, label={args.label}')

    print(f'\nComparing model families via LOSO ({list(MODELS.keys())})...')
    rows = []
    for name in MODELS:
        results = loso_evaluate(df, label_col=args.label, model_name=name)
        means = summarize(results)
        row = {'model': name}
        row.update(means.to_dict())
        rows.append(row)
        print(f'  {name:20s} balanced_acc={means.balanced_accuracy:.3f}  roc_auc={means.roc_auc:.3f}')

    cmp_df = pd.DataFrame(rows).sort_values('roc_auc', ascending=False).reset_index(drop=True)
    best = cmp_df.iloc[0]
    best_name = best['model']
    print(f'\nSelected: {best_name} (LOSO balanced_acc={best.balanced_accuracy:.3f}, '
          f'roc_auc={best.roc_auc:.3f})')

    print(f'\nRefitting {best_name} on all {df.subject.nunique()} subjects for the saved artifact...')
    data = df.dropna(subset=[args.label]).reset_index(drop=True)
    cols = feature_columns(data)
    X = data[cols].to_numpy()
    y = data[args.label].to_numpy().astype(int)

    final_model = MODELS[best_name]()
    final_model.fit(X, y)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    artifact = {
        'model': final_model,
        'model_name': best_name,
        'feature_columns': cols,
        'label_col': args.label,
        'channels': sorted({c.split('_')[0] for c in cols if not c.startswith('asym_')}),
        'window_sec_note': 'trained on 25.0s blocks (one per trial), 128Hz SAM40 filtered_data -- '
                           'inference input must use the same windowing/preprocessing',
        'loso_balanced_accuracy': float(best.balanced_accuracy),
        'loso_roc_auc': float(best.roc_auc),
        'loso_accuracy': float(best.accuracy),
        'n_subjects_trained_on': int(df.subject.nunique()),
    }
    model_path = out_dir / 'sam40_t7t8_state_model.joblib'
    joblib.dump(artifact, model_path)
    cmp_df.to_csv(out_dir / 'model_comparison.csv', index=False)

    print(f'\nWrote {model_path}')
    print(f'Wrote {out_dir / "model_comparison.csv"}')
    print(f'\nExpected real-world performance (from LOSO, NOT re-derived from the saved model): '
          f'balanced_accuracy={best.balanced_accuracy:.3f}, roc_auc={best.roc_auc:.3f}')


if __name__ == '__main__':
    main()
