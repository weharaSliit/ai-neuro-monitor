import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { SparkChart } from './SparkChart';
import { StatusBadge } from './StatusBadge';
import { ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export function SignalDetailCard({ title, value, subtext, bars, colorClass, signalId, trend, status }) {
  const navigate = useNavigate();
  const { t, isDark } = useTheme();

  const color = colorClass?.includes('emerald') ? '#10b981' :
                colorClass?.includes('orange') ? '#f59e0b' :
                colorClass?.includes('red') ? '#ef4444' : '#7c6bf7';

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? t.warningText : trend === 'down' ? t.successText : t.textMuted;

  return (
    <button
      onClick={() => signalId && navigate(`/signal-detail/${signalId}`)}
      className={`w-full text-left ${t.card} border ${t.cardBorder} p-5 rounded-[20px] mb-3 transition-all duration-200 active:scale-[0.98] ${t.cardHover} animate-fade-in`}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${t.text}`}>{title}</span>
          {status && <StatusBadge status={status} />}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-bold`} style={{ color }}>{value}</span>
          {trend && <TrendIcon size={14} className={trendColor} />}
        </div>
      </div>

      {/* Mini Chart */}
      {bars && bars.length > 0 && (
        <div className="my-3">
          <SparkChart data={bars} color={color} height={40} />
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-between items-center">
        <p className={`text-[11px] font-medium ${t.textMuted}`}>{subtext}</p>
        {signalId && (
          <div className={`flex items-center gap-1 ${t.textDim}`}>
            <span className="text-[10px] font-bold">Details</span>
            <ChevronRight size={12} />
          </div>
        )}
      </div>
    </button>
  );
}