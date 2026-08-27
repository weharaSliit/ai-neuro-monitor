import pandas as pd
import os

BASE = os.path.dirname(os.path.abspath(__file__))

swell_path = os.path.join(BASE, "..", "data", "raw", "Behavioral-features_per_minute.xlsx")
if os.path.exists(swell_path):
    df = pd.read_excel(swell_path, sheet_name="SWELLdata", nrows=3)
    print("=" * 60)
    print("SWELL RAW COLUMNS (Behavioral-features_per_minute.xlsx)")
    print("=" * 60)
    print(f"Total columns: {len(df.columns)}")
    for c in df.columns:
        print(f"  {c}  -> sample: {df[c].iloc[0]}")
else:
    print(f"NOT FOUND: {swell_path}")
