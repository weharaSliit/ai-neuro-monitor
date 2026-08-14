#!/usr/bin/env python3
"""
MAT to CSV Converter for SAM40 Dataset
Converts MATLAB .mat files to CSV format for easier data analysis.

Usage:
    python3 mat_to_csv_converter.py <input_directory> <output_directory>

Example:
    python3 mat_to_csv_converter.py ./raw_data ./raw_data_csv
"""

import os
import sys
import glob
from pathlib import Path
import scipy.io as sio
import pandas as pd
import numpy as np
from datetime import datetime

def mat_to_csv(mat_file, csv_file):
    """
    Convert a single MAT file to CSV format.
    
    Parameters:
    -----------
    mat_file : str
        Path to the input MAT file
    csv_file : str
        Path to the output CSV file
    
    Returns:
    --------
    bool : True if successful, False otherwise
    """
    try:
        # Load MAT file
        mat_data = sio.loadmat(mat_file, squeeze_me=True)
        
        # Remove MATLAB metadata
        mat_data = {k: v for k, v in mat_data.items() if not k.startswith('__')}
        
        # Convert to DataFrame
        if mat_data:
            # Handle different data structures
            if len(mat_data) == 1:
                # Single array in MAT file
                key = list(mat_data.keys())[0]
                data = mat_data[key]
                
                if isinstance(data, np.ndarray):
                    if data.ndim == 1:
                        # 1D array
                        df = pd.DataFrame({key: data})
                    elif data.ndim == 2:
                        # 2D array (channels × samples)
                        df = pd.DataFrame(data.T)
                        # Try to add channel names
                        n_channels = data.shape[0]
                        df.columns = [f'Channel_{i+1}' for i in range(n_channels)]
                    else:
                        # Higher dimensional array
                        df = pd.DataFrame(data.flatten())
                else:
                    df = pd.DataFrame({key: [data]})
            else:
                # Multiple variables in MAT file
                df = pd.DataFrame(mat_data)
            
            # Save to CSV
            df.to_csv(csv_file, index=False)
            return True
        else:
            print(f"Warning: No data found in {mat_file}")
            return False
            
    except Exception as e:
        print(f"Error converting {mat_file}: {e}")
        return False

def batch_convert(input_dir, output_dir):
    """
    Convert all MAT files in a directory to CSV format.
    
    Parameters:
    -----------
    input_dir : str
        Input directory containing MAT files
    output_dir : str
        Output directory for CSV files
    """
    # Create output directory if it doesn't exist
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    # Find all MAT files
    mat_files = glob.glob(os.path.join(input_dir, '**/*.mat'), recursive=True)
    
    if not mat_files:
        print(f"No MAT files found in {input_dir}")
        return
    
    print(f"Found {len(mat_files)} MAT file(s)")
    print("=" * 70)
    
    successful = 0
    failed = 0
    
    for idx, mat_file in enumerate(mat_files, 1):
        # Get relative path for output
        rel_path = os.path.relpath(mat_file, input_dir)
        csv_file = os.path.join(output_dir, rel_path.replace('.mat', '.csv'))
        
        # Create subdirectories if needed
        Path(csv_file).parent.mkdir(parents=True, exist_ok=True)
        
        # Convert file
        print(f"\n[{idx}/{len(mat_files)}] Converting:")
        print(f"  Input:  {mat_file}")
        print(f"  Output: {csv_file}")
        
        if mat_to_csv(mat_file, csv_file):
            print(f"  Status: ✓ SUCCESS")
            successful += 1
        else:
            print(f"  Status: ✗ FAILED")
            failed += 1
    
    # Summary
    print("\n" + "=" * 70)
    print("CONVERSION SUMMARY")
    print("=" * 70)
    print(f"Total files: {len(mat_files)}")
    print(f"Successful: {successful}")
    print(f"Failed: {failed}")
    print(f"Output directory: {output_dir}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

def main():
    """Main entry point."""
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    
    input_dir = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Validate input directory
    if not os.path.isdir(input_dir):
        print(f"Error: Input directory '{input_dir}' does not exist")
        sys.exit(1)
    
    print(f"MAT to CSV Converter")
    print(f"Input directory: {input_dir}")
    print(f"Output directory: {output_dir}")
    print(f"Start time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    
    # Start conversion
    batch_convert(input_dir, output_dir)
    
    print(f"End time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == '__main__':
    main()
