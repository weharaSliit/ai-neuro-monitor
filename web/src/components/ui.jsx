import { COLORS } from '../lib/levels';

export function Card({ children, className = '', style }) {
  return <section className={`card ${className}`} style={style}>{children}</section>;
}

export function CardHead({ title, sub, right }) {
  return (
    <div className="card-head">
      <div>
        <h3 className="title">{title}</h3>
        {sub && <p className="caption" style={{ margin: '2px 0 0' }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Dot({ color, live }) {
  return <span className={`dot ${live ? 'live' : ''}`} style={{ background: color }} />;
}

export function Badge({ color = COLORS.brand, children, dot, live }) {
  return (
    <span className="badge" style={{ background: color + '1F', color }}>
      {dot && <Dot color={color} live={live} />}
      {children}
    </span>
  );
}

export function LiveBadge({ online, onLabel = 'Live', offLabel = 'Offline' }) {
  return (
    <Badge color={online ? COLORS.normal : COLORS.textMuted} dot live={online}>
      {online ? onLabel : offLabel}
    </Badge>
  );
}

export function ActionTile({ lead, bold, tail, caption, icon, tint, onClick }) {
  return (
    <button className="tile" style={{ background: tint + '22' }} onClick={onClick}>
      <span className="arrow" style={{ color: tint }}>↗</span>
      <span style={{ fontSize: 26 }}>{icon}</span>
      <div>
        <div className="lead">{lead} <b>{bold}</b> {tail}</div>
        {caption && <div className="caption" style={{ marginTop: 4 }}>{caption}</div>}
      </div>
    </button>
  );
}

export function DeviceChip({ icon, tint, name, online, detail }) {
  return (
    <div className="chip">
      <div className="ico" style={{ background: tint + '1C' }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{name}</div>
        <div className="caption">{detail}</div>
      </div>
      <LiveBadge online={online} offLabel="Off" />
    </div>
  );
}

export function Stat({ label, value, unit, tint }) {
  return (
    <div className="stat" style={{ background: tint + '14' }}>
      <span className="micro">{label}</span>
      <b style={{ color: tint }}>
        {value ?? '—'}
        {value != null && unit && <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 4 }}>{unit}</span>}
      </b>
    </div>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner() { return <div className="spinner" />; }

export function Avatar({ name }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  return <div className="avatar">{letter}</div>;
}
