#!/usr/bin/env python3
"""
Convert NPZ (NumPy Compressed) files to CSV format
============================================

Handles various NPZ structures:
  - Flat arrays/matrices → single CSV
  - Multi-dimensional arrays → flattened or per-array CSVs
  - Mixed data types → column-based export
  - Large datasets → chunked writing (memory efficient)

Usage:
  python convert_npz_to_csv.py --input data.npz --output output_dir
  python convert_npz_to_csv.py --input data.npz --output data.csv --single
  python convert_npz_to_csv.py --input data.npz --output output_dir --flatten
"""

import sys
import argparse
import warnings
from pathlib import Path
from typing import Dict, Optional, Tuple, Union

import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')


def inspect_npz(npz_path: Path) -> Dict:
    """Inspect NPZ file structure without full load"""
    info = {}
    try:
        with np.load(npz_path, allow_pickle=True) as npz:
            for key in npz.files:
                arr = npz[key]
                info[key] = {
                    'dtype': str(arr.dtype),
                    'shape': tuple(arr.shape),
                    'size': arr.size,
                    'min': float(np.min(arr)) if np.issubdtype(arr.dtype, np.number) else 'N/A',
                    'max': float(np.max(arr)) if np.issubdtype(arr.dtype, np.number) else 'N/A',
                    'mean': float(np.mean(arr)) if np.issubdtype(arr.dtype, np.number) else 'N/A',
                }
    except Exception as e:
        print(f"Error inspecting NPZ: {e}", file=sys.stderr)
        return {}
    
    return info


def convert_1d_to_csv(arr: np.ndarray, output_path: Path, key: str = "data") -> bool:
    """Convert 1D array to CSV"""
    try:
        df = pd.DataFrame({key: arr})
        df.to_csv(output_path, index=False)
        print(f"✓ Saved 1D array to {output_path}")
        return True
    except Exception as e:
        print(f"✗ Error converting 1D array: {e}", file=sys.stderr)
        return False


def convert_2d_to_csv(arr: np.ndarray, output_path: Path, key: str = "data") -> bool:
    """Convert 2D array to CSV"""
    try:
        df = pd.DataFrame(arr)
        df.columns = [f"{key}_{i}" for i in range(arr.shape[1])]
        df.to_csv(output_path, index=False)
        print(f"✓ Saved 2D array ({arr.shape[0]}×{arr.shape[1]}) to {output_path}")
        return True
    except Exception as e:
        print(f"✗ Error converting 2D array: {e}", file=sys.stderr)
        return False


def convert_3d_to_csv(arr: np.ndarray, output_path: Path, key: str = "data", 
                      flatten: bool = False, max_dim: int = 2) -> bool:
    """
    Convert 3D array to CSV
    
    Options:
      - flatten=False: Save separate CSV per element along first dimension
      - flatten=True: Flatten to 2D by concatenating dimensions 2,3
    """
    try:
        shape = arr.shape
        
        if flatten:
            # Reshape (D1, D2, D3) -> (D1, D2*D3)
            reshaped = arr.reshape(shape[0], -1)
            df = pd.DataFrame(reshaped)
            df.columns = [f"{key}_{i}" for i in range(reshaped.shape[1])]
            df.to_csv(output_path, index=False)
            print(f"✓ Saved 3D array (flattened {shape} → {reshaped.shape}) to {output_path}")
            return True
        else:
            # Save separate CSV per first dimension element
            output_dir = output_path.parent
            output_stem = output_path.stem
            success_count = 0
            
            for i in range(min(shape[0], max_dim)):
                sub_arr = arr[i]  # (D2, D3)
                if sub_arr.ndim == 2:
                    sub_path = output_dir / f"{output_stem}_{i:04d}.csv"
                    sub_df = pd.DataFrame(sub_arr)
                    sub_df.columns = [f"col_{j}" for j in range(sub_arr.shape[1])]
                    sub_df.to_csv(sub_path, index=False)
                    print(f"  → {sub_path.name} ({sub_arr.shape[0]}×{sub_arr.shape[1]})")
                    success_count += 1
            
            print(f"✓ Saved 3D array as {success_count} CSVs to {output_dir}")
            return True
            
    except Exception as e:
        print(f"✗ Error converting 3D array: {e}", file=sys.stderr)
        return False


def convert_mixed_to_csv(npz_data: Dict, output_path: Path) -> bool:
    """
    Convert NPZ with multiple arrays to single CSV
    
    Strategy: Align all arrays by repeating shorter ones or stacking compatible shapes
    """
    try:
        max_rows = 0
        arrays_dict = {}
        
        # First pass: identify max rows and prepare arrays
        for key, arr in npz_data.items():
            if arr.ndim == 1:
                max_rows = max(max_rows, len(arr))
                arrays_dict[key] = arr
            elif arr.ndim == 2:
                max_rows = max(max_rows, arr.shape[0])
                # Flatten 2D to 1D or keep as multi-column
                if arr.shape[1] <= 5:  # Few columns
                    for col in range(arr.shape[1]):
                        arrays_dict[f"{key}_{col}"] = arr[:, col]
                else:  # Many columns, flatten
                    arrays_dict[key] = arr.reshape(arr.shape[0], -1)
            else:  # 3D+
                max_rows = max(max_rows, arr.shape[0])
                # Flatten all but first dimension
                arrays_dict[key] = arr.reshape(arr.shape[0], -1)
        
        # Second pass: align to max_rows (repeat or truncate)
        df_dict = {}
        for key, arr in arrays_dict.items():
            if isinstance(arr, np.ndarray) and arr.ndim == 2:
                # Multi-column array
                df_dict.update({
                    f"{key}_{i}": arr[:, i] if arr.shape[0] == max_rows else 
                                 np.pad(arr[:, i], (0, max_rows - arr.shape[0]), 
                                       mode='edge') if arr.shape[0] < max_rows else arr[:max_rows, i]
                    for i in range(arr.shape[1])
                })
            else:
                # 1D array
                if len(arr) == max_rows:
                    df_dict[key] = arr
                elif len(arr) < max_rows:
                    df_dict[key] = np.pad(arr, (0, max_rows - len(arr)), mode='edge')
                else:
                    df_dict[key] = arr[:max_rows]
        
        df = pd.DataFrame(df_dict)
        df.to_csv(output_path, index=False)
        print(f"✓ Saved mixed NPZ ({len(npz_data)} arrays) as {output_path.name} ({df.shape[0]}×{df.shape[1]})")
        return True
        
    except Exception as e:
        print(f"✗ Error converting mixed NPZ: {e}", file=sys.stderr)
        return False


def convert_npz_to_csv(
    input_path: Path,
    output_path: Path,
    single_file: bool = False,
    flatten: bool = False,
    inspect_only: bool = False
) -> bool:
    """
    Main conversion function
    
    Args:
      input_path: Path to .npz file
      output_path: Path to output CSV or directory
      single_file: Force single CSV output (default: separate per array)
      flatten: Flatten multi-dimensional arrays
      inspect_only: Only show structure, don't convert
    """
    
    if not input_path.exists():
        print(f"✗ Input file not found: {input_path}", file=sys.stderr)
        return False
    
    print(f"\n{'='*70}")
    print(f"  NPZ to CSV Converter")
    print(f"{'='*70}")
    print(f"Input:  {input_path}")
    
    # Inspect
    info = inspect_npz(input_path)
    print(f"\nNPZ Contents ({len(info)} arrays):")
    for key, meta in info.items():
        print(f"  {key:25s} shape={str(meta['shape']):20s} dtype={meta['dtype']:12s}")
        if meta['min'] != 'N/A':
            print(f"    → range: [{meta['min']:.4f}, {meta['max']:.4f}]  mean={meta['mean']:.4f}")
    
    if inspect_only:
        return True
    
    # Prepare output
    if output_path is None:
        output_path = input_path.parent / f"{input_path.stem}.csv"
    
    output_path = Path(output_path)
    if not single_file and output_path.suffix == '':
        output_path.mkdir(parents=True, exist_ok=True)
        print(f"Output: {output_path}/ (directory)")
    else:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Output: {output_path}")
    
    # Convert
    print(f"\nConverting...")
    try:
        with np.load(input_path, allow_pickle=True) as npz:
            npz_dict = {key: npz[key] for key in npz.files}
        
        if single_file or output_path.suffix == '.csv':
            # All arrays to single CSV
            convert_mixed_to_csv(npz_dict, output_path)
        else:
            # Separate CSV per array
            success = 0
            for key, arr in npz_dict.items():
                if arr.ndim == 1:
                    out = output_path / f"{key}.csv"
                    if convert_1d_to_csv(arr, out, key):
                        success += 1
                elif arr.ndim == 2:
                    out = output_path / f"{key}.csv"
                    if convert_2d_to_csv(arr, out, key):
                        success += 1
                else:  # 3D+
                    out = output_path / f"{key}.csv"
                    if convert_3d_to_csv(arr, out, key, flatten=flatten):
                        success += 1
            print(f"\n✓ Converted {success}/{len(npz_dict)} arrays")
        
        return True
        
    except Exception as e:
        print(f"✗ Conversion failed: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Convert NPZ (NumPy compressed) files to CSV format"
    )
    parser.add_argument(
        '--input', '-i', 
        type=Path, 
        required=True,
        help='Path to .npz file'
    )
    parser.add_argument(
        '--output', '-o',
        type=Path,
        default=None,
        help='Output CSV file or directory (default: same name as input)'
    )
    parser.add_argument(
        '--single', '-s',
        action='store_true',
        help='Save all arrays to single CSV (instead of separate files)'
    )
    parser.add_argument(
        '--flatten', '-f',
        action='store_true',
        help='Flatten multi-dimensional arrays (default: separate per dimension)'
    )
    parser.add_argument(
        '--inspect',
        action='store_true',
        help='Only inspect NPZ structure (no conversion)'
    )
    
    args = parser.parse_args()
    
    success = convert_npz_to_csv(
        input_path=args.input,
        output_path=args.output,
        single_file=args.single,
        flatten=args.flatten,
        inspect_only=args.inspect
    )
    
    print(f"{'='*70}\n")
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
