import os
import sys
import pickle
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import warnings

warnings.filterwarnings('ignore')

from label_unification import (
    process_deap_subject,
    process_sam40_subject,
    UnifiedStressDataset,
    load_deap_ratings,
    get_subject_ratings,
    load_all_sam40_subjects,
    DEAP_RATINGS_XLS,
    SAM40_SCALES_XLS,
)


# ─────────────────────────────────────────────
#  DEAP DATASET LOADER
# ─────────────────────────────────────────────

def load_deap_subject(subject_id: int, data_dir: Path) -> Optional[Dict]:
    filename = data_dir / f"s{subject_id:02d}.dat"

    if not filename.exists():
        print(f"  ⚠️  {filename.name} not found — skipping")
        return None

    try:
        with open(filename, 'rb') as f:
            subject = pickle.load(f, encoding='latin1')
        return {'data': subject['data'], 'labels': subject['labels']}
    except Exception as e:
        print(f"  ❌ Error loading {filename.name}: {e}")
        return None


def load_deap_dataset(
    data_dir: Path,
    subject_ids: Optional[List[int]] = None,
) -> List[Dict]:
    if subject_ids is None:
        subject_ids = range(1, 33)

    subjects = []
    print(f"Loading DEAP subjects from {data_dir.name}...")

    for sid in subject_ids:
        subj = load_deap_subject(sid, data_dir)
        if subj is not None:
            subjects.append((sid, subj))
            print(f"  ✓ s{sid:02d} loaded")

    print(f"✅ Loaded {len(subjects)} DEAP subjects\n")
    return subjects


# ─────────────────────────────────────────────
#  UNIFIED LABELING APPLICATION
# ─────────────────────────────────────────────

def apply_unified_labeling(
    deap_dir: Path,
    sam40_dir: Path,
    output_dir: Path,
    deap_subject_ids: Optional[List[int]] = None,
    sam40_subject_ids: Optional[List[int]] = None,
    deap_ratings_path: Optional[str] = None,
    sam40_scales_path: Optional[str] = None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    deap_ratings_path = deap_ratings_path or DEAP_RATINGS_XLS
    sam40_scales_path = sam40_scales_path or SAM40_SCALES_XLS
    sam40_raw_dir     = str(sam40_dir / "raw_data")

    print("=" * 70)
    print("  UNIFIED LABELING PIPELINE")
    print("=" * 70 + "\n")

    # ── STEP 1: Load DEAP ──
    deap_pairs = load_deap_dataset(deap_dir, deap_subject_ids)  # list of (sid, dict)

    # ── STEP 2: Load SAM40 with real XLS scores ──
    print(f"Loading SAM40 subjects from: {sam40_raw_dir}")
    print(f"  Using scales.xls: {sam40_scales_path}")
    sam40_pairs = []  # list of (sid, dict)
    if Path(sam40_raw_dir).exists():
        loaded = load_all_sam40_subjects(
            raw_data_dir = sam40_raw_dir,
            scales_path  = sam40_scales_path,
            subject_ids  = sam40_subject_ids,
        )
        sam40_pairs = list(enumerate(loaded, start=1))
        print(f"✅ Loaded {len(sam40_pairs)} SAM40 subjects\n")
    else:
        print(f"⚠️  raw_data folder not found: {sam40_raw_dir}\n")

    if not deap_pairs and not sam40_pairs:
        print("❌ No data loaded from either dataset!")
        return

    # ── STEP 3: Load DEAP XLS ratings ──
    ratings_df = None
    if Path(deap_ratings_path).exists():
        print(f"Loading DEAP participant ratings: {deap_ratings_path}")
        ratings_df = load_deap_ratings(deap_ratings_path)
    else:
        print(f"⚠️  DEAP ratings XLS not found: {deap_ratings_path}")

    # ── STEP 4: Process subjects, build arrays + CSV rows in one pass ──
    print("\nApplying unified labeling framework...\n")
    builder  = UnifiedStressDataset()
    csv_rows: List[Dict] = []
    sample_idx = 0

    # — DEAP subjects —
    for sid, subj_data in deap_pairs:
        subj_ratings = get_subject_ratings(ratings_df, sid) if ratings_df is not None else None
        processed    = process_deap_subject(subj_data, subject_ratings=subj_ratings)
        builder.add_deap_subject(processed, subject_id=sid)

        n = len(processed['emotional_labels'])
        for i in range(n):
            row: Dict = {
                'sample_id'      : sample_idx,
                'dataset'        : 'deap',
                'subject_id'     : sid,
                'trial'          : i + 1,
                'task'           : None,
                'trial_num'      : None,
                'score_raw'      : None,
                'valence_raw'    : float(processed['valence_raw'][i]),
                'arousal_raw'    : float(processed['arousal_raw'][i]),
                'dominance_raw'  : (float(processed['dominance_raw'][i])
                                    if processed.get('dominance_raw') is not None else None),
                'liking_raw'     : (float(processed['liking_raw'][i])
                                    if processed.get('liking_raw') is not None else None),
                'familiarity_raw': (float(processed['familiarity_raw'][i])
                                    if processed.get('familiarity_raw') is not None else None),
                'y_emo'          : int(processed['emotional_labels'][i]),
                'y_perc'         : int(processed['perceived_labels'][i]),
            }
            csv_rows.append(row)
            sample_idx += 1

        print(f"  DEAP s{sid:02d} → y_emo+: {processed['emotional_labels'].sum()}/{n}  "
              f"y_perc+: {processed['perceived_labels'].sum()}/{n}")

    # — SAM40 subjects —
    for sid, subj_data in sam40_pairs:
        processed = process_sam40_subject(subj_data['eeg'], subj_data['scores'])
        builder.add_sam40_subject(processed, subject_id=sid)

        for i, score_info in enumerate(subj_data['scores']):
            row = {
                'sample_id'      : sample_idx,
                'dataset'        : 'sam40',
                'subject_id'     : sid + 100,      # matches UnifiedStressDataset offset
                'trial'          : i,
                'task'           : score_info['task'],
                'trial_num'      : score_info['trial'],
                'score_raw'      : score_info['score'],
                'valence_raw'    : None,
                'arousal_raw'    : None,
                'dominance_raw'  : None,
                'liking_raw'     : None,
                'familiarity_raw': None,
                'y_emo'          : int(processed['emotional_labels'][i]),
                'y_perc'         : int(processed['perceived_labels'][i]),  # -1 sentinel
            }
            csv_rows.append(row)
            sample_idx += 1

        n = len(processed['emotional_labels'])
        print(f"  SAM40 s{sid:02d} → y_emo+: {processed['emotional_labels'].sum()}/{n}  "
              f"y_perc: -1 (sentinel)")

    dataset = builder.build()
    stats   = builder.label_statistics()

    # ── STEP 5: Save unified EEG arrays (.npz) ──
    npz_file = output_dir / "unified_dataset.npz"
    print(f"\n💾 Saving EEG arrays to {npz_file.name}...")
    np.savez(
        npz_file,
        X_full     = dataset['X_full'],
        X_t7t8     = dataset['X_t7t8'],
        y_emo      = dataset['y_emo'],
        y_perc     = dataset['y_perc'],
        source     = dataset['source'],
        subject_id = dataset['subject_id'],
        trial_idx  = dataset['trial_idx'],
    )
    X_full = dataset['X_full']
    y_emo  = dataset['y_emo']
    y_perc = dataset['y_perc']
    source = dataset['source']
    sam40_m = np.array([str(s).lower() == 'sam40' for s in source])
    deap_m  = ~sam40_m
    print(f"   ✓ X_full={X_full.shape}  y_emo={y_emo.shape}")
    print(f"   DEAP  : {deap_m.sum():,} samples  y_emo+={y_emo[deap_m].mean():.1%}  "
          f"y_perc+={y_perc[deap_m].mean():.1%}")
    print(f"   SAM40 : {sam40_m.sum():,} samples  y_emo+={y_emo[sam40_m].mean():.1%}  "
          f"y_perc=-1 (sentinel, masked in training)")

    # ── STEP 6: Save per-trial labels CSV ──
    labels_csv = output_dir / "unified_labels.csv"
    print(f"\n📋 Saving per-trial labels to {labels_csv.name}...")
    df_labels = pd.DataFrame(csv_rows, columns=[
        'sample_id', 'dataset', 'subject_id', 'trial', 'task', 'trial_num',
        'score_raw',
        'valence_raw', 'arousal_raw', 'dominance_raw', 'liking_raw', 'familiarity_raw',
        'y_emo', 'y_perc',
    ])
    df_labels.to_csv(labels_csv, index=False)
    print(f"   ✓ {len(df_labels)} rows  ×  {len(df_labels.columns)} columns")
    print(f"   DEAP  rows: {(df_labels.dataset=='deap').sum():,}  "
          f"(valence/arousal/dominance/liking/familiarity from participant_ratings.xls)")
    print(f"   SAM40 rows: {(df_labels.dataset=='sam40').sum():,}  "
          f"(score_raw from scales.xls, task + trial_num per trial)")

    # ── STEP 7: Save per-dataset split CSVs ──
    deap_csv  = output_dir / "deap_labels.csv"
    sam40_csv = output_dir / "sam40_labels.csv"
    df_labels[df_labels.dataset == 'deap'].to_csv(deap_csv, index=False)
    df_labels[df_labels.dataset == 'sam40'].to_csv(sam40_csv, index=False)
    print(f"   ✓ deap_labels.csv  /  sam40_labels.csv (split copies)")

    # ── STEP 8: Save label statistics report ──
    stats_file = output_dir / "label_statistics.txt"
    print(f"\n📊 Saving statistics to {stats_file.name}...")
    with open(stats_file, 'w') as f:
        f.write("=" * 70 + "\n")
        f.write("  UNIFIED DATASET — LABEL STATISTICS\n")
        f.write("=" * 70 + "\n\n")
        f.write(f"Total samples:           {stats['total_samples']}\n")
        f.write(f"  DEAP samples:          {stats['deap_samples']}\n")
        f.write(f"  SAM40 samples:         {stats['sam40_samples']}\n\n")
        f.write("LABEL SOURCES:\n")
        f.write(f"  DEAP  ratings XLS:     {deap_ratings_path}\n")
        f.write(f"  SAM40 scales  XLS:     {sam40_scales_path}\n\n")
        f.write("EMOTIONAL STRESS (direct, fast):\n")
        f.write(f"  Positive (stressed):   {stats['emotional_stress_pos']}\n")
        f.write(f"  Negative:              {stats['emotional_stress_neg']}\n")
        f.write(f"  Positive ratio:        {stats['emotional_stress_ratio']:.2%}\n\n")
        f.write("PERCEIVED STRESS (sustained, pre-detected):\n")
        f.write(f"  Positive (stressed):   {stats['perceived_stress_pos']}\n")
        f.write(f"  Negative:              {stats['perceived_stress_neg']}\n")
        f.write(f"  Positive ratio:        {stats['perceived_stress_ratio']:.2%}\n\n")
        f.write("CO-OCCURRENCE PATTERNS:\n")
        f.write(f"  Both stressed:         {stats['both_stressed']}\n")
        f.write(f"  Emotional only:        {stats['emotional_only']}\n")
        f.write(f"  Perceived only:        {stats['perceived_only']}\n")
        f.write("\n" + "=" * 70 + "\n")
    print(f"   ✓ Statistics saved")

    # ── STEP 9: Summary ──
    print("\n" + "=" * 70)
    print("  UNIFIED LABELING COMPLETE")
    print("=" * 70)
    print(f"\n📁 Output: {output_dir}\n")
    print(f"  • unified_dataset.npz     EEG arrays  (X_full, X_t7t8, y_emo, y_perc, …)")
    print(f"  • unified_labels.csv      {len(df_labels):,} rows — all labels + metadata")
    print(f"  • deap_labels.csv         DEAP split  (valence/arousal/dominance from XLS)")
    print(f"  • sam40_labels.csv        SAM40 split (self-reported scores from scales.xls)")
    print(f"  • label_statistics.txt    distribution summary\n")
    print("✅ Dataset ready for model training!")
    print("=" * 70 + "\n")

    print("NEXT STEPS — Load the dataset:\n")
    print("```python")
    print("import numpy as np, pandas as pd\n")
    print(f"data   = np.load('{npz_file}', allow_pickle=True)")
    print("X_full = data['X_full']   # (N, 32, T) teacher EEG")
    print("X_t7t8 = data['X_t7t8']   # (N,  2, T) student EEG (T7/T8)")
    print("y_emo  = data['y_emo']    # (N,) emotional stress")
    print("y_perc = data['y_perc']   # (N,) perceived stress\n")
    print(f"labels = pd.read_csv('{labels_csv}')")
    print("```\n")


# ─────────────────────────────────────────────
#  MAIN ENTRY POINT
# ─────────────────────────────────────────────

if __name__ == "__main__":

    workspace_root = Path(__file__).resolve().parents[1]
    deap_data_dir  = workspace_root / "eeg" / "data" / "deap-dataset" / "data_preprocessed_python"
    sam40_data_dir = workspace_root / "eeg" / "data" / "SAM40"
    output_dir     = workspace_root / "eeg" / "data" / "unified_output"

    if not deap_data_dir.exists():
        print(f"❌ DEAP data directory not found: {deap_data_dir}")
        sys.exit(1)

    if not sam40_data_dir.exists():
        print(f"❌ SAM40 data directory not found: {sam40_data_dir}")
        sys.exit(1)

    try:
        apply_unified_labeling(
            deap_dir          = deap_data_dir,
            sam40_dir         = sam40_data_dir,
            output_dir        = output_dir,
            deap_subject_ids  = None,   # all 32 DEAP subjects
            sam40_subject_ids = None,   # all 40 SAM40 subjects
        )
    except Exception as e:
        print(f"\n❌ Pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
