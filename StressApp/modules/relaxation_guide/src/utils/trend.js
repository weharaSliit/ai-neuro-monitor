// Scales a stress history to 0..1 for drawing (1 = highest). The window is at
// least minRange wide, so small noise stays flat and real changes show clearly.
export const scaleSeries = (history, minRange = 0.2) => {
  const values = (history || []).filter(Number.isFinite);
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = Math.max(hi - lo, minRange);
  const mid = (hi + lo) / 2;
  return values.map((v) => Math.max(0, Math.min(1, (v - mid) / range + 0.5)));
};
