#!/usr/bin/env python3
"""
Convert preprocessed_dataset.npz to CSV format
==============================================

Handles the large preprocessed EEG dataset (60,694 epochs × 32 channels × 256 samples).

Arrays:
  - X_teacher: (60694, 32, 256) - all 32 channels, bandpass-filtered data
  - X_student: (60694, 2, 256) - T7/T8 channels only
  - y_emo: (60694,) - emotional stress labels {0, 1}
  - y_perc: (60694,) - perceived stress labels {-1, 0, 1}
  - source: (60694,) - dataset source (DEAP/SAM40)
  - trial_idx: (60694,) - trial index

Output formats:
  1. Compact: Statistical features per epoch (mean, std, min, max per channel)
  2. Detailed: All samples flattened (memory intensive)
  3. Segmented: Per-channel CSV files
  4. Metadata: Labels + source + trial info

Usage:
  python convert_preprocessed_to_csv.py --output-dir output
  python convert_preprocessed_to_csv.py --output-dir output --include-raw
  python convert_preprocessed_to_csv.py --output-dir output --chunk-size 10000
"""

import sys
import argparse
import warnings
from pathlib import Path
from typing import Optional, Dict, Tuple
import json

import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')

EEG_CHANNELS = [
    'Fp1', 'AF3', 'F7', 'F3', 'FC1', 'FC5', 'T7', 'C3',
    'CP1', 'CP5', 'P7', 'P3', 'PZ', 'PO3', 'O1', 'Oz',
    'O2', 'PO4', 'P4', 'P8', 'CP6', 'CP2', 'C4', 'T8',
    'FC6', 'FC2', 'F4', 'F8', 'AF4', 'Fp2', 'Fz', 'Cz'
]

STUDENT_CHANNELS = [6, 23]  # T7 (index 6), T8 (index 23)
STUDENT_CHANNEL_NAMES = ['T7', 'T8']


def load_preprocessed_npz(npz_path: Path) -> Dict:
    """Load preprocessed dataset NPZ file"""
    print(f"Loading {npz_path}...")
    data = {}
    
    with np.load(npz_path, allow_pickle=True) as npz:
        for key in npz.files:
            data[key] = npz[key]
            print(f"  {key}: {data[key].shape}")
    
    return data


def extract_features(X: np.ndarray, axis: int = 2) -> pd.DataFrame:
    """
    Extract statistical features from raw EEG data.
    
    Args:
        X: (epochs, channels, samples) or (epochs, samples) array
        axis: axis along which to compute statistics
    
    Returns:
        DataFrame with columns: ch_mean, ch_std, ch_min, ch_max, ch_rms, ch_kurtosis
    """
    features = {}
    
    # Mean
    features['mean'] = np.mean(X, axis=axis)
    
    # Std Dev
    features['std'] = np.std(X, axis=axis)
    
    # Min/Max
    features['min'] = np.min(X, axis=axis)
    features['max'] = np.max(X, axis=axis)
    
    # Peak-to-peak
    features['peak_to_peak'] = np.ptp(X, axis=axis)
    
    # RMS
    features['rms'] = np.sqrt(np.mean(X**2, axis=axis))
    
    return features


def create_compact_csv(data: Dict, output_dir: Path) -> Path:
    """
    Create compact CSV with statistical features (32 channels × 5 stats).
    Memory: ~100 MB for 60k epochs
    """
    print("\n1. Creating compact feature CSV...")
    
    X_teacher = data['X_teacher']  # (60694, 32, 256)
    n_epochs = X_teacher.shape[0]
    n_channels = X_teacher.shape[1]
    
    # Extract features per channel
    teacher_features = extract_features(X_teacher, axis=2)
    
    # Build DataFrame
    columns = []
    df_data = {}
    
    for ch_idx in range(n_channels):
        ch_name = EEG_CHANNELS[ch_idx]
        
        for stat_name, stat_data in teacher_features.items():
            col_name = f"{ch_name}_{stat_name}"
            columns.append(col_name)
            df_data[col_name] = stat_data[:, ch_idx]
    
    # Add metadata
    df_data['y_emo'] = data['y_emo']
    df_data['y_perc'] = data['y_perc']
    df_data['source'] = data['source']
    df_data['trial_idx'] = data['trial_idx']
    
    df = pd.DataFrame(df_data)
    output_path = output_dir / "preprocessed_compact.csv"
    df.to_csv(output_path, index=False)
    
    print(f"  Saved: {output_path}")
    print(f"  Shape: {df.shape}")
    print(f"  Size: {output_path.stat().st_size / (1024**2):.2f} MB")
    
    return output_path


def create_student_compact_csv(data: Dict, output_dir: Path) -> Path:
    """
    Create student model compact CSV (T7/T8 only, 2 channels × 5 stats).
    Memory: ~6 MB
    """
    print("\n2. Creating student (T7/T8) feature CSV...")
    
    X_student = data['X_student']  # (60694, 2, 256)
    
    # Extract features
    student_features = extract_features(X_student, axis=2)
    
    # Build DataFrame
    df_data = {}
    
    for ch_idx in range(2):
        ch_name = STUDENT_CHANNEL_NAMES[ch_idx]
        
        for stat_name, stat_data in student_features.items():
            col_name = f"{ch_name}_{stat_name}"
            df_data[col_name] = stat_data[:, ch_idx]
    
    # Add metadata
    df_data['y_emo'] = data['y_emo']
    df_data['y_perc'] = data['y_perc']
    df_data['source'] = data['source']
    df_data['trial_idx'] = data['trial_idx']
    
    df = pd.DataFrame(df_data)
    output_path = output_dir / "preprocessed_student.csv"
    df.to_csv(output_path, index=False)
    
    print(f"  Saved: {output_path}")
    print(f"  Shape: {df.shape}")
    print(f"  Size: {output_path.stat().st_size / (1024**2):.2f} MB")
    
    return output_path


def create_metadata_csv(data: Dict, output_dir: Path) -> Path:
    """
    Create metadata CSV with labels and source info.
    """
    print("\n3. Creating metadata CSV...")
    
    df = pd.DataFrame({
        'epoch_id': range(len(data['y_emo'])),
        'y_emo': data['y_emo'],
        'y_perc': data['y_perc'],
        'source': data['source'],
        'trial_idx': data['trial_idx'],
    })
    
    output_path = output_dir / "preprocessed_metadata.csv"
    df.to_csv(output_path, index=False)
    
    print(f"  Saved: {output_path}")
    print(f"  Shape: {df.shape}")
    
    # Statistics
    print(f"\n  Label Statistics:")
    print(f"    y_emo: {(df['y_emo'] == 1).sum()} positive ({100*(df['y_emo'] == 1).mean():.1f}%)")
    print(f"    y_perc: {(df['y_perc'] == 1).sum()} positive ({100*(df[df['y_perc'] >= 0]['y_perc'] == 1).mean():.1f}%)")
    print(f"    source: {dict(df['source'].value_counts())}")
    
    return output_path


def create_per_channel_csvs(data: Dict, output_dir: Path) -> list:
    """
    Create separate CSV for each of 32 channels (one per file).
    Each has all 256 samples per epoch + metadata.
    Memory: ~30 MB per file
    """
    print("\n4. Creating per-channel CSVs (32 files)...")
    
    X_teacher = data['X_teacher']  # (60694, 32, 256)
    channel_dir = output_dir / "preprocessed_channels"
    channel_dir.mkdir(parents=True, exist_ok=True)
    
    output_paths = []
    
    for ch_idx in range(32):
        ch_name = EEG_CHANNELS[ch_idx]
        ch_data = X_teacher[:, ch_idx, :]  # (60694, 256)
        
        # Create DataFrame with samples as columns
        df_data = {f"sample_{i}": ch_data[:, i] for i in range(256)}
        df_data['y_emo'] = data['y_emo']
        df_data['y_perc'] = data['y_perc']
        df_data['source'] = data['source']
        
        df = pd.DataFrame(df_data)
        output_path = channel_dir / f"preprocessed_{ch_name}.csv"
        df.to_csv(output_path, index=False)
        output_paths.append(output_path)
        
        if (ch_idx + 1) % 8 == 0:
            print(f"  {ch_idx + 1}/{32} channels saved ({output_path.stat().st_size / (1024**2):.1f} MB each)")
    
    print(f"  Total: {len(output_paths)} files")
    
    return output_paths


def create_raw_flattened_csv(data: Dict, output_dir: Path, chunk_size: int = 5000) -> Path:
    """
    Create raw CSV with all samples flattened (32 channels × 256 samples = 8192 columns).
    Uses chunked writing to minimize memory usage.
    Memory: ~1 GB during write, ~2.5 GB final file
    """
    print(f"\n5. Creating raw flattened CSV (chunked, chunk_size={chunk_size})...")
    
    X_teacher = data['X_teacher']  # (60694, 32, 256)
    n_epochs = X_teacher.shape[0]
    
    output_path = output_dir / "preprocessed_raw.csv"
    
    # Write header
    columns = []
    for ch_idx in range(32):
        ch_name = EEG_CHANNELS[ch_idx]
        for sample_idx in range(256):
            columns.append(f"{ch_name}_s{sample_idx}")
    
    columns.extend(['y_emo', 'y_perc', 'source', 'trial_idx'])
    
    # Write in chunks
    with open(output_path, 'w') as f:
        f.write(','.join(columns) + '\n')
        
        for chunk_start in range(0, n_epochs, chunk_size):
            chunk_end = min(chunk_start + chunk_size, n_epochs)
            chunk_size_actual = chunk_end - chunk_start
            
            # Reshape chunk: (chunk_size, 32*256)
            X_chunk = X_teacher[chunk_start:chunk_end].reshape(chunk_size_actual, -1)
            
            # Build data for this chunk
            chunk_data = np.column_stack([
                X_chunk,
                data['y_emo'][chunk_start:chunk_end],
                data['y_perc'][chunk_start:chunk_end],
                data['source'][chunk_start:chunk_end],
                data['trial_idx'][chunk_start:chunk_end],
            ])
            
            # Write to CSV
            np.savetxt(f, chunk_data, delimiter=',', fmt='%.6g')
            
            progress = min(chunk_end, n_epochs)
            print(f"  {progress}/{n_epochs} epochs written ({output_path.stat().st_size / (1024**3):.2f} GB)")
    
    print(f"  Saved: {output_path}")
    print(f"  Final size: {output_path.stat().st_size / (1024**3):.2f} GB")
    
    return output_path


def create_summary_report(data: Dict, output_dir: Path) -> Path:
    """Create JSON summary report"""
    print("\n6. Creating summary report...")
    
    report = {
        'conversion_time': pd.Timestamp.now().isoformat(),
        'dataset_info': {
            'total_epochs': int(len(data['y_emo'])),
            'n_channels': 32,
            'student_channels': ['T7', 'T8'],
            'samples_per_epoch': 256,
        },
        'data_statistics': {
            'X_teacher': {
                'shape': list(data['X_teacher'].shape),
                'dtype': str(data['X_teacher'].dtype),
                'range': [float(np.min(data['X_teacher'])), float(np.max(data['X_teacher']))],
            },
            'X_student': {
                'shape': list(data['X_student'].shape),
                'dtype': str(data['X_student'].dtype),
                'range': [float(np.min(data['X_student'])), float(np.max(data['X_student']))],
            },
            'y_emo': {
                'unique': list(np.unique(data['y_emo']).astype(int)),
                'counts': {int(k): int(v) for k, v in zip(*np.unique(data['y_emo'], return_counts=True))},
                'positive_ratio': float((data['y_emo'] == 1).mean()),
            },
            'y_perc': {
                'unique': list(np.unique(data['y_perc']).astype(int)),
                'counts': {int(k): int(v) for k, v in zip(*np.unique(data['y_perc'], return_counts=True))},
            },
            'source': {
                'unique': list(np.unique(data['source'])),
                'counts': {str(k): int(v) for k, v in zip(*np.unique(data['source'], return_counts=True))},
            },
        },
        'output_files': {
            'compact': 'preprocessed_compact.csv (~100 MB) - 32 channels × 5 stats each',
            'student': 'preprocessed_student.csv (~6 MB) - T7/T8 only',
            'metadata': 'preprocessed_metadata.csv - labels and source info',
            'channels': 'preprocessed_channels/ - separate file per channel (~30 MB each)',
            'raw': 'preprocessed_raw.csv (~2.5 GB) - all raw samples flattened',
        },
    }
    
    report_path = output_dir / "conversion_report.json"
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    
    print(f"  Saved: {report_path}")
    
    return report_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('data/unified_output/preprocessed_dataset.npz'),
                        help='Input NPZ file')
    parser.add_argument('--output-dir', type=Path, default=Path('data/unified_output'),
                        help='Output directory for CSV files')
    parser.add_argument('--include-raw', action='store_true',
                        help='Include raw flattened CSV (warning: ~2.5 GB)')
    parser.add_argument('--include-channels', action='store_true',
                        help='Include per-channel CSVs (32 files, ~30 MB each)')
    parser.add_argument('--chunk-size', type=int, default=5000,
                        help='Chunk size for raw CSV writing')
    
    args = parser.parse_args()
    
    # Validate input
    if not args.input.exists():
        print(f"Error: {args.input} not found", file=sys.stderr)
        sys.exit(1)
    
    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load data
    data = load_preprocessed_npz(args.input)
    
    # Create outputs
    print("\n" + "="*80)
    print("CONVERTING preprocessed_dataset.npz TO CSV")
    print("="*80)
    
    create_compact_csv(data, args.output_dir)
    create_student_compact_csv(data, args.output_dir)
    create_metadata_csv(data, args.output_dir)
    
    if args.include_channels:
        create_per_channel_csvs(data, args.output_dir)
    
    if args.include_raw:
        create_raw_flattened_csv(data, args.output_dir, chunk_size=args.chunk_size)
    
    create_summary_report(data, args.output_dir)
    
    print("\n" + "="*80)
    print("CONVERSION COMPLETE")
    print("="*80)
    print(f"\nOutput directory: {args.output_dir}")
    print("\nFiles created:")
    for csv_file in args.output_dir.glob("preprocessed*.csv"):
        size_mb = csv_file.stat().st_size / (1024**2)
        print(f"  {csv_file.name} ({size_mb:.1f} MB)")
    
    print("\nRecommendations:")
    print("  • Use preprocessed_compact.csv for most analysis (small, informative)")
    print("  • Use preprocessed_student.csv for mobile app testing")
    print("  • Use preprocessed_metadata.csv for label analysis")
    if not args.include_channels:
        print("  • Add --include-channels to get per-channel files")
    if not args.include_raw:
        print("  • Add --include-raw to get raw flattened CSV (requires ~2.5 GB)")


if __name__ == '__main__':
    main()
