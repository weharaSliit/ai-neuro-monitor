"""Latent state: demand (0 calm .. 1 full load) drives each modality through a
first-order response with its own onset and recovery time constants,
x += (target - x) * (1 - exp(-dt / tau)), tau = tau_on when rising, tau_off
when falling. Plus within-session non-stationarity: slow fatigue and
occasional arousal events unrelated to demand (a sound, a movement)."""
import math
from dataclasses import dataclass, field


@dataclass
class Taus:
    on: float
    off: float


@dataclass
class LatentState:
    taus: dict                       # modality -> Taus  ('brain', 'heart', 'skin')
    fatigue_per_hour: float = 0.0    # slow drift towards 'tired' (alpha down / theta up)
    arousal_rate_per_min: float = 0.12
    loads: dict = field(default_factory=lambda: {"brain": 0.0, "heart": 0.0, "skin": 0.0})
    fatigue: float = 0.0
    arousal: float = 0.0             # unrelated arousal event, decays over ~15 s
    t: float = 0.0

    def step(self, demand, dt, rng, body=None):
        """demand drives the brain; body (default: the same demand) drives heart
        and skin -- separate when mental load and physical arousal differ."""
        target = {"brain": demand, "heart": demand if body is None else body, "skin": demand if body is None else body}
        for m, x in self.loads.items():
            tau = self.taus[m].on if target[m] > x else self.taus[m].off
            self.loads[m] = x + (target[m] - x) * (1 - math.exp(-dt / tau))
        self.fatigue = min(1.0, self.fatigue + self.fatigue_per_hour * dt / 3600.0)
        self.arousal *= math.exp(-dt / 15.0)
        if rng.random() < self.arousal_rate_per_min * dt / 60.0:
            self.arousal = min(1.0, self.arousal + rng.uniform(0.4, 1.0))
        self.t += dt
        return self.loads
