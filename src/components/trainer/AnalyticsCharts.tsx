'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { TrendingUp, Target } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

interface AnalyticsChartsProps {
  progressTrend: Array<{ week: string; progress: number }>;
  moduleProgress: Array<{
    name: string;
    completed: number;
    inProgress: number;
    notStarted: number;
  }>;
  labels: {
    progressOverTime: string;
    moduleProgress: string;
  };
}

export function AnalyticsCharts({
  progressTrend,
  moduleProgress,
  labels,
}: AnalyticsChartsProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const axisColor = isDark ? '#ffffff' : '#374151';
  const tooltipStyle = useMemo(() => ({
    backgroundColor: isDark ? '#1e1423' : '#ffffff',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    color: isDark ? '#ffffff' : '#1f2937',
    boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.15)',
  }), [isDark]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {/* Progress Over Time */}
      <div className="glass-effect rounded-2xl p-6 shadow-lg">
        <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
          <TrendingUp className="text-accent mr-3 h-6 w-6" />
          {labels.progressOverTime}
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={progressTrend}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#6b7280"
              strokeOpacity={0.3}
            />
            <XAxis
              dataKey="week"
              stroke={axisColor}
              fontSize={12}
              tick={{ fill: axisColor }}
            />
            <YAxis stroke={axisColor} fontSize={12} tick={{ fill: axisColor }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="progress"
              stroke="#ef4444"
              fill="#ef4444"
              fillOpacity={0.3}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Module Progress */}
      <div className="glass-effect rounded-2xl p-6 shadow-lg">
        <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
          <Target className="text-primary mr-3 h-6 w-6" />
          {labels.moduleProgress}
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={moduleProgress}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#6b7280"
              strokeOpacity={0.3}
            />
            <XAxis
              dataKey="name"
              stroke={axisColor}
              fontSize={10}
              angle={-45}
              textAnchor="end"
              height={60}
              tick={{ fill: axisColor }}
            />
            <YAxis stroke={axisColor} fontSize={12} tick={{ fill: axisColor }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar
              dataKey="completed"
              stackId="a"
              fill="#ef4444"
              radius={[4, 0, 0, 4]}
              stroke="#ffffff"
              strokeWidth={1}
            />
            <Bar
              dataKey="inProgress"
              stackId="a"
              fill="#dc2626"
              stroke="#ffffff"
              strokeWidth={1}
            />
            <Bar
              dataKey="notStarted"
              stackId="a"
              fill="#3c2846"
              radius={[0, 4, 4, 0]}
              stroke="#ffffff"
              strokeWidth={1}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
