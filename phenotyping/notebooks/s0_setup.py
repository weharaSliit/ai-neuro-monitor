# s0_setup.py — Run once
import subprocess, sys, os

libs = ["pandas","numpy","scikit-learn","scipy","openpyxl","matplotlib"]
for lib in libs:
    subprocess.check_call([sys.executable, "-m", "pip", "install", lib, "-q"])

for folder in ["../data/raw","../data/processed","../outputs"]:
    os.makedirs(folder, exist_ok=True)

print("✅ Setup complete")