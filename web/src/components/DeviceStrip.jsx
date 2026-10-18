// The two devices at the very top of the page: connected or not, at a glance.
function Dev({ icon, name, on, text }) {
  return (
    <span className={`dev ${on ? 'on' : ''}`}>
      <i className="dot" aria-hidden="true" />
      <span className="dev-ico" aria-hidden="true">{icon}</span>
      <b>{name}</b>
      <em>{text}</em>
    </span>
  );
}

export default function DeviceStrip({ ringOn, eegOn, fingerOff }) {
  return (
    <div className="devstrip" role="status">
      <Dev icon="💍" name="Ring" on={ringOn} text={!ringOn ? 'Not connected' : fingerOff ? 'Finger off' : 'Connected'} />
      <Dev icon="🧠" name="Headband" on={eegOn} text={eegOn ? 'Connected' : 'Not connected'} />
    </div>
  );
}
