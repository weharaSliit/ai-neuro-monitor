import { memo } from 'react';
import { COLORS, SLIDER_MODERATE_AT, SLIDER_LIMIT_AT } from '../lib/levels';
import { Badge } from './ui';

// Web twin of StressApp/modules/shared/LevelSlider.js -- the tick marks
// the person's OWN limit (always at the same spot, since the slider is
// mapped piecewise around their threshold).
function LevelSlider({ title, position, word, color }) {
  const has = position != null;
  const grad = `linear-gradient(90deg, ${COLORS.normal} 0%, ${COLORS.normal}AA ${SLIDER_MODERATE_AT * 100 - 8}%, `
    + `${COLORS.warning} ${SLIDER_MODERATE_AT * 100 + 4}%, ${COLORS.warning} ${SLIDER_LIMIT_AT * 100 - 4}%, `
    + `${COLORS.stress} ${SLIDER_LIMIT_AT * 100 + 6}%, ${COLORS.stress} 100%)`;
  return (
    <div className="slider">
      <div className="between">
        <span className="subtitle">{title}</span>
        {has ? <Badge color={color}>{word}</Badge> : <span className="caption">No reading</span>}
      </div>
      <div className="slider-track" style={{ background: grad, opacity: has ? 1 : 0.35 }}>
        <div className="slider-tick" style={{ left: `${SLIDER_LIMIT_AT * 100}%` }} title="Your limit" />
        {has && <div className="slider-knob" style={{ left: `${position * 100}%`, borderColor: color }} />}
      </div>
      <div className="slider-scale">
        <span className="caption">Low</span>
        <span className="caption">Moderate</span>
        <span className="caption">High</span>
      </div>
    </div>
  );
}

export default memo(LevelSlider);
