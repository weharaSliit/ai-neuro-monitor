# Physiological Signals — Stress Detection Component

## Research Title
Perceived Stress Pre-Detection Using Wearable Physiological 
Sensors with Personalized Adaptive Machine Learning

## Objectives
- Objective 1: Static model comparison using public datasets (WESAD + SWELL-KW)
- Objective 2: Personalized adaptive model with continual learning
- Objective 3: Hardware validation on IoT ring

## Setup
1. Install Python 3.11
2. Install Microsoft C++ Build Tools
3. Create virtual environment: py -3.11 -m venv stress_env
4. Activate: stress_env\Scripts\activate
5. Install: pip install -r requirements.txt

## Dataset Location
Datasets stored outside repo at: C:\Users\weha1\datasets\
- WESAD: C:\Users\weha1\datasets\WESAD\
- SWELL: C:\Users\weha1\datasets\SWELL\

## Folder Structure
notebooks/     — Jupyter notebooks for each stage
src/           — Python source code
results/       — Saved results and plots
saved_models/  — Trained model files