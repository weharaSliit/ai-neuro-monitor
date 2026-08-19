import React from 'react';
import { useTheme } from '../context/ThemeContext';

export function StatusBadge({ status = 'normal' }) {
  const { t } = useTheme();

  const config = {
    normal:    { label: 'Normal',    classes: t.badgeNormal },
    elevated:  { label: 'Elevated',  classes: t.badgeElevated },
    anomalous: { label: 'Anomalous', classes: t.badgeAnomalous },
    info:      { label: 'Info',      classes: t.badgeInfo },
    calibrating: { label: 'Calibrating', classes: t.badgeInfo },
  };

  const c = config[status] || config.normal;

  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${c.classes}`}>
      {c.label}
    </span>
  );
}
