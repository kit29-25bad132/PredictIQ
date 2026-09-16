import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  id?: string;
  title: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    label: string;
  };
  accentColor?: 'blue' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'purple';
  statusBadge?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  id,
  title,
  value,
  subValue,
  icon: Icon,
  trend,
  accentColor = 'blue',
  statusBadge,
}) => {
  const colorMap = {
    blue: {
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      text: 'text-blue-400',
      glow: 'shadow-blue-500/5',
    },
    cyan: {
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/20',
      text: 'text-cyan-400',
      glow: 'shadow-cyan-500/5',
    },
    emerald: {
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      text: 'text-emerald-400',
      glow: 'shadow-emerald-500/5',
    },
    amber: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      text: 'text-amber-400',
      glow: 'shadow-amber-500/5',
    },
    rose: {
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/20',
      text: 'text-rose-400',
      glow: 'shadow-rose-500/5',
    },
    purple: {
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
      text: 'text-purple-400',
      glow: 'shadow-purple-500/5',
    },
  };

  const scheme = colorMap[accentColor] || colorMap.blue;

  return (
    <div
      id={id || `metric-${title.toLowerCase().replace(/\s+/g, '-')}`}
      className={`relative overflow-hidden rounded-xl border ${scheme.border} bg-slate-900/80 p-5 backdrop-blur-md transition-all duration-200 hover:border-slate-700 shadow-lg ${scheme.glow}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${scheme.bg} ${scheme.text}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono tracking-tight text-white">
          {value}
        </span>
        {statusBadge && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${scheme.bg} ${scheme.text}`}>
            {statusBadge}
          </span>
        )}
      </div>

      {(subValue || trend) && (
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          {subValue && <span>{subValue}</span>}
          {trend && (
            <span
              className={`font-medium ${
                trend.direction === 'up'
                  ? 'text-rose-400'
                  : trend.direction === 'down'
                  ? 'text-emerald-400'
                  : 'text-slate-400'
              }`}
            >
              {trend.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
export default MetricCard;
