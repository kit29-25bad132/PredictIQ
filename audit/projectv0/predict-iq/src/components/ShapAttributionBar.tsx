import React from 'react';
import { ContributingFactor } from '../types';
import { Activity, Flame, Zap, Gauge, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface ShapAttributionBarProps {
  factors: ContributingFactor[];
}

export const ShapAttributionBar: React.FC<ShapAttributionBarProps> = ({ factors }) => {
  const getIcon = (factorName: string) => {
    switch (factorName) {
      case 'Temperature':
        return <Flame className="h-4 w-4 text-amber-400" />;
      case 'Vibration':
        return <Activity className="h-4 w-4 text-rose-400" />;
      case 'Current':
        return <Zap className="h-4 w-4 text-cyan-400" />;
      case 'RPM':
        return <Gauge className="h-4 w-4 text-purple-400" />;
      default:
        return <Activity className="h-4 w-4 text-blue-400" />;
    }
  };

  const getImpactBadge = (impact: string) => {
    switch (impact) {
      case 'Critical':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
      case 'Very High':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'High':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'Above Normal':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      default:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    }
  };

  return (
    <div id="xai-contributions-container" className="space-y-4">
      {factors.map((item, idx) => {
        const isPositivePush = item.shap_value > 0;
        const normalizedPercent = Math.min(100, Math.max(8, Math.abs(item.shap_value) * 180));

        return (
          <div
            key={idx}
            id={`shap-item-${item.factor.toLowerCase()}`}
            className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 transition-all hover:border-slate-700"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80">
                  {getIcon(item.factor)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{item.factor}</span>
                    <span
                      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${getImpactBadge(
                        item.impact
                      )}`}
                    >
                      {item.impact}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Observed: <strong className="font-mono text-slate-200">{item.value_observed}</strong> (Ref: {item.threshold_reference})
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div className="font-mono text-xs">
                  <span className="text-slate-400">Attribution: </span>
                  <span
                    className={`font-bold ${
                      isPositivePush ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {item.shap_value > 0 ? `+${item.shap_value}` : `${item.shap_value}`}
                  </span>
                </div>
                {isPositivePush ? (
                  <ArrowUpRight className="h-4 w-4 text-rose-400" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 text-emerald-400" />
                )}
              </div>
            </div>

            {/* Attribution Bar Graphic */}
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    item.impact === 'Critical'
                      ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.5)]'
                      : item.impact === 'Very High' || item.impact === 'High'
                      ? 'bg-amber-500'
                      : item.impact === 'Above Normal'
                      ? 'bg-yellow-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${normalizedPercent}%` }}
                />
              </div>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {item.description}
            </p>
          </div>
        );
      })}
    </div>
  );
};
export default ShapAttributionBar;
