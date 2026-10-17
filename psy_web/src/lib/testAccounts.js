// Accounts the simulation may use (same rule as backend/simulation/live_stimulator.py:
// ids starting "sim_", or "mp_" -- the accounts the team already runs simulations on).
// Calibrating from psy_web and the live stimulator are limited to these, so a real
// person's calibration and history can't be replaced by mistake. Viewing any user is fine.
export const TEST_PREFIXES = ['sim_', 'mp_'];
export const isTestAccount = (uid) => typeof uid === 'string' && TEST_PREFIXES.some((p) => uid.startsWith(p));
