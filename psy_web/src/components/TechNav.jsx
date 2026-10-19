import { SessionPicker } from './panels';

// Header shared by the three technical pages: tabs, title, session picker.
export const TECH_PAGES = [
  ['concept', 'Live monitor'],
  ['calibration', 'Calibration'],
  ['tech', 'Devices'],
  ['ringcheck', 'Ring check'],
];

export default function TechNav({ page, go, title, subtitle, picker }) {
  return (
    <header className="tech-head">
      <nav className="tech-tabs" aria-label="Technical pages">
        <span className="tech-brand">MindPulse · technical</span>
        {TECH_PAGES.map(([k, label]) => (
          <button key={k} type="button" className={`tech-tab${page === k ? ' on' : ''}`} aria-current={page === k ? 'page' : undefined}
            onClick={() => go(k)}>{label}</button>
        ))}
        <button type="button" className="tech-tab simple" onClick={() => go('profile')}>Simple view ↩</button>
      </nav>
      <div className="top">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {picker && <SessionPicker picker={picker} />}
      </div>
    </header>
  );
}
