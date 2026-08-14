#!/usr/bin/env python3

import os
import sys
import glob
from pathlib import Path
import pandas as pd
from datetime import datetime

# Standard 10-20 EEG Channel Names (32 channels)
# This matches the DEAP dataset channel order
DEAP_CHANNEL_NAMES = [
    'Fp1', 'AF3', 'F7', 'F3', 'FC1', 'FC5', 'T7', 'C3',
    'CP1', 'CP5', 'P7', 'P3', 'PZ', 'PO3', 'O1', 'OZ',
    'O2', 'PO4', 'P4', 'P8', 'CP6', 'CP2', 'C4', 'T8',
    'FC6', 'FC2', 'F4', 'F8', 'AF4', 'Fp2', 'Fz', 'Cz'
]

# Peripheral Channel Names (8 channels)
PERIPHERAL_CHANNELS = [
    'GSR', 'EMG_zygomaticus', 'EMG_trapezius', 'EOG',
    'Temperature', 'Respiration', 'Plethysmograph', 'ECG'
]

# Combined channel list (40 total)
ALL_CHANNEL_NAMES = DEAP_CHANNEL_NAMES + PERIPHERAL_CHANNELS

def get_channel_mapping(n_columns):
    """
    Create channel mapping based on number of columns.
    
    Parameters:
    -----------
    n_columns : int
        Number of columns in the CSV file
    
    Returns:
    --------
    dict : Mapping from generic names to proper channel names
    """
    channel_map = {}
    
    for i in range(min(n_columns, len(ALL_CHANNEL_NAMES))):
        generic_name = f'Channel_{i+1}'
        proper_name = ALL_CHANNEL_NAMES[i]
        channel_map[generic_name] = proper_name
    
    # For any remaining columns beyond our list
    for i in range(len(ALL_CHANNEL_NAMES), n_columns):
        generic_name = f'Channel_{i+1}'
        channel_map[generic_name] = f'Unknown_Channel_{i+1}'
    
    return channel_map

def rename_csv_channels(csv_file, inplace=True):
    """
    Rename channels in a single CSV file.
    
    Parameters:
    -----------
    csv_file : str
        Path to the CSV file
    inplace : bool
        If True, overwrite the original file; otherwise create a new file with _renamed suffix
    
    Returns:
    --------
    bool : True if successful, False otherwise
    """
    try:
        # Read CSV file
        df = pd.read_csv(csv_file)
        
        # Get original column names
        original_columns = df.columns.tolist()
        
        # Create channel mapping
        channel_map = get_channel_mapping(len(original_columns))
        
        # Rename columns
        df_renamed = df.rename(columns=channel_map)
        
        # Save file
        if inplace:
            df_renamed.to_csv(csv_file, index=False)
        else:
            base_name = csv_file.replace('.csv', '_renamed.csv')
            df_renamed.to_csv(base_name, index=False)
        
        return True, original_columns, df_renamed.columns.tolist()
        
    except Exception as e:
        return False, None, str(e)

def batch_rename_channels(csv_dir):
    """
    Rename channels in all CSV files in a directory.
    
    Parameters:
    -----------
    csv_dir : str
        Directory containing CSV files
    """
    # Find all CSV files
    csv_files = glob.glob(os.path.join(csv_dir, '**/*.csv'), recursive=True)
    
    if not csv_files:
        print(f"No CSV files found in {csv_dir}")
        return
    
    print(f"Found {len(csv_files)} CSV file(s)")
    print("=" * 80)
    
    successful = 0
    failed = 0
    
    for idx, csv_file in enumerate(sorted(csv_files), 1):
        print(f"\n[{idx}/{len(csv_files)}] Processing:")
        print(f"  File: {csv_file}")
        
        success, original_cols, new_cols = rename_csv_channels(csv_file, inplace=True)
        
        if success:
            print(f"  Status: ✓ SUCCESS")
            print(f"  Columns renamed: {len(original_cols)}")
            
            # Show first few channel names
            if isinstance(new_cols, list):
                print(f"  New channel names (first 8):")
                for i, col in enumerate(new_cols[:8]):
                    print(f"    {i+1}. {col}")
                if len(new_cols) > 8:
                    print(f"    ... and {len(new_cols) - 8} more channels")
                
                # Highlight T7 and T8
                if 'T7' in new_cols and 'T8' in new_cols:
                    t7_idx = new_cols.index('T7') + 1
                    t8_idx = new_cols.index('T8') + 1
                    print(f"  ✓ T7 found at channel {t7_idx}")
                    print(f"  ✓ T8 found at channel {t8_idx}")
            
            successful += 1
        else:
            print(f"  Status: ✗ FAILED")
            print(f"  Error: {new_cols}")
            failed += 1
    
    # Summary
    print("\n" + "=" * 80)
    print("CHANNEL RENAMING SUMMARY")
    print("=" * 80)
    print(f"Total files: {len(csv_files)}")
    print(f"Successful: {successful}")
    print(f"Failed: {failed}")
    print(f"Directory: {csv_dir}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Print channel reference
    print("\n" + "=" * 80)
    print("CHANNEL REFERENCE")
    print("=" * 80)
    print("\nEEG Channels (32):")
    for i, channel in enumerate(DEAP_CHANNEL_NAMES):
        if channel in ['T7', 'T8']:
            print(f"  Channel {i+1:2d}: {channel:8s} *** (TEMPORAL - STRESS/EMOTION)")
        else:
            print(f"  Channel {i+1:2d}: {channel:8s}")
    
    print("\nPeripheral Channels (8):")
    for i, channel in enumerate(PERIPHERAL_CHANNELS):
        print(f"  Channel {32+i+1:2d}: {channel}")

def print_channel_map():
    """Print the complete channel mapping."""
    print("\n" + "=" * 80)
    print("COMPLETE CHANNEL MAPPING")
    print("=" * 80)
    print("\nEEG Channels (32 - Standard 10-20 System):")
    print("-" * 80)
    
    # Group by brain region
    regions = {
        'FRONTAL': [0, 1, 2, 3, 4, 5, 26, 27, 28, 29, 30],
        'TEMPORAL': [6, 23],  # T7, T8
        'CENTRAL': [7, 22, 31],
        'PARIETAL': [10, 11, 18, 19],
        'OCCIPITAL': [14, 15, 16, 17],
        'OTHER': [8, 9, 12, 13, 20, 21, 24, 25]
    }
    
    for region, indices in regions.items():
        print(f"\n{region}:")
        for idx in indices:
            channel = DEAP_CHANNEL_NAMES[idx]
            if channel in ['T7', 'T8']:
                print(f"  Channel {idx+1:2d}: {channel:8s} *** (CRITICAL FOR STRESS/EMOTION)")
            else:
                print(f"  Channel {idx+1:2d}: {channel:8s}")
    
    print("\n\nPeripheral Channels (8):")
    print("-" * 80)
    for i, channel in enumerate(PERIPHERAL_CHANNELS):
        print(f"  Channel {32+i+1:2d}: {channel}")

def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nOptions:")
        print("  python3 rename_channels.py <csv_directory>  - Rename all CSV files")
        print("  python3 rename_channels.py --map             - Show channel mapping")
        sys.exit(1)
    
    if sys.argv[1] == '--map':
        print_channel_map()
        sys.exit(0)
    
    csv_dir = sys.argv[1]
    
    # Validate input directory
    if not os.path.isdir(csv_dir):
        print(f"Error: Directory '{csv_dir}' does not exist")
        sys.exit(1)
    
    print(f"Channel Renaming Tool for SAM40 EEG Data")
    print(f"Directory: {csv_dir}")
    print(f"Start time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    
    # Start renaming
    batch_rename_channels(csv_dir)
    
    print(f"\nEnd time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == '__main__':
    main()
