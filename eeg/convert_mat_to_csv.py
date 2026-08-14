import scipy.io
import pandas as pd
import numpy as np
import os

# Path to the .mat file
mat_path = 'data/SAM40/raw_data/Arithmetic_sub_1_trial1.mat'
# Output CSV file path
csv_path = 'data/SAM40/raw_data/Arithmetic_sub_1_trial1.csv'

# Load the .mat file
mat = scipy.io.loadmat(mat_path)

# Find the main numeric array (skip __header__, __version__, __globals__)
main_key = None
max_shape = 0
for key in mat:
    if key.startswith('__'):
        continue
    arr = mat[key]
    if isinstance(arr, np.ndarray) and arr.size > max_shape and np.issubdtype(arr.dtype, np.number):
        main_key = key
        max_shape = arr.size

if main_key is None:
    raise ValueError('No numeric array found in the .mat file.')

data = mat[main_key]
print(f"Extracted variable '{main_key}' with shape {data.shape}")

# If 2D or more, flatten to 2D for CSV
if data.ndim > 2:
    data = data.reshape(data.shape[0], -1)

df = pd.DataFrame(data)
df.to_csv(csv_path, index=False)
print(f"Saved CSV to {csv_path}")