# Ring check: ringcheck01 / run_1792360450625

Heart Rate app readings: 18  ·  ring windows in the run: 59

## Heart rate vs Heart Rate app

| ring value | n | mean error (bpm) | bias (bpm) | r | within 5 bpm | within 10 bpm |
|---|---|---|---|---|---|---|
| live beats | 9 | 3.9 | -2.1 | 0.87 | 67% | 89% |
| 60 s window | 12 | 4.6 | 1.9 | 0.75 | 75% | 83% |

## Per step

| step | s | HR live | HR window | GSR µS | move avg/peak (g) | finger off | quality | stress prob | labelled Stress | windows kept / expected |
|---|---|---|---|---|---|---|---|---|---|---|
| Get ready | 60 | 78.8 | 78.2 | 4.19 | 1.06 / 1.07 | 0% | 0.86 | 0.96 | 100% | 3/3 |
| Rest | 300 | 73.1 | 77.0 | 4.28 | 1.06 / 1.28 | 0% | 0.95 | 0.90 | 100% | 11/15 |
| Slow breathing | 120 | 81.0 | 88.5 | 4.41 | 1.06 / 1.07 | 0% | 0.83 | 0.85 | 100% | 1/6 |
| Mental task | 180 | 88.1 | 89.1 | 4.56 | 1.06 / 1.10 | 0% | 0.88 | 0.91 | 100% | 9/9 |
| Walk | 180 | 96.6 | 90.7 | 4.78 | 1.06 / 1.09 | 0% | 0.90 | 0.98 | 100% | 7/9 |
| Recovery | 181 | 93.6 | 91.4 | 5.05 | 1.06 / 1.09 | 0% | 0.85 | 0.94 | 100% | 5/9 |
| Shake hand | 120 | 90.4 | - | 5.28 | 1.06 / 1.22 | 0% | - | - | -% | 0/6 |
| Still | 60 | 76.8 | - | 5.29 | 1.06 / 1.07 | 0% | - | - | -% | 0/3 |
| Cold bottle | 120 | 78.3 | 81.1 | 5.22 | 1.06 / 1.07 | 0% | 0.78 | 0.96 | 100% | 5/6 |
| Still | 60 | 81.0 | 85.0 | 5.38 | 1.06 / 1.07 | 0% | 0.87 | 0.97 | 100% | 2/3 |
| Finger off | 90 | 89.4 | 86.9 | 1.86 | 1.06 / 1.07 | 83% | 0.99 | 0.33 | 20% | 5/4 |

## Slide numbers

- Heart rate agreement (live beats): mean error 3.9 bpm, r = 0.87, n = 9
- Heart rate rise walking vs rest: 24 bpm
- Skin conductance rise on the mental task: 0.28 µS
- Artefact windows withheld: 7 of 16 expected (finger off for 83% of the finger-off step; shake peak 1.2 g)