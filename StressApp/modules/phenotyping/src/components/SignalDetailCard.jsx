import React from 'react';

export function SignalDetailCard({ title, value, subtext, bars, colorClass, borderClass }) {
  return (
    <div className={`bg-[#14141f] border ${borderClass || 'border-[#2a2a38]'} p-5 rounded-[24px] mb-4`}>
      <div className="flex justify-between items-start mb-4">
        <span className="text-sm font-semibold text-gray-200">{title}</span>
        <span className={`text-sm font-bold ${colorClass.replace('bg-', 'text-')}`}>{value}</span>
      </div>

      {/* Bar Chart Mockup */}
      <div className="flex items-end gap-1.5 mb-4 h-12">
        {bars.map((height, i) => (
          <div 
            key={i} 
            className={`flex-1 rounded-md transition-all duration-500 ${height.active ? colorClass : 'bg-[#2a2a38]'}`}
            style={{ height: `${height.val}%` }}
          ></div>
        ))}
      </div>

      <p className={`text-[11px] leading-tight font-medium ${colorClass.replace('bg-', 'text-')}`}>
        {subtext}
      </p>
      
      <button className="text-[10px] text-gray-600 mt-3 font-bold hover:text-gray-400 transition-colors">
        Tap for 7-day history ›
      </button>
    </div>
  );
}