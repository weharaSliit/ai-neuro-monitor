import React from 'react';
import { useTheme } from '../context/ThemeContext';

export function SparkChart({ data = [], color = '#7c6bf7', height = 48, activeIndex = -1 }) {
  const { t, isDark } = useTheme();

  if (!data.length) return null;

  const maxVal = Math.max(...data.map(d => (typeof d === 'object' ? d.val : d)), 1);
  const barWidth = Math.max(100 / data.length - 8, 4);

  return (
    <div className="flex items-end gap-[3px] w-full" style={{ height }}>
      {data.map((item, i) => {
        const val = typeof item === 'object' ? item.val : item;
        const isActive = typeof item === 'object' ? item.active : i === activeIndex;
        const pct = Math.max((val / maxVal) * 100, 6);

        return (
          <div
            key={i}
            className="flex-1 rounded-md transition-all duration-500"
            style={{
              height: `${pct}%`,
              backgroundColor: isActive ? color : (isDark ? '#2a2a38' : '#e5e5ea'),
              minWidth: 4,
              opacity: isActive ? 1 : 0.6,
            }}
          />
        );
      })}
    </div>
  );
}
