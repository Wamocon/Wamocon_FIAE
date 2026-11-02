'use client';

import { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface ProgressTrendChartProps {
  data: { week: string; progress: number }[];
  loading?: boolean;
}

export function ProgressTrendChart({
  data,
  loading = false,
}: ProgressTrendChartProps) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const tooltipStyle = useMemo(
    () => ({
      backgroundColor: theme === 'dark' ? '#1e1423' : '#ffffff',
      border: '1px solid #ef4444',
      borderRadius: '8px',
      color: theme === 'dark' ? '#ffffff' : '#1f2937',
      boxShadow:
        theme === 'dark'
          ? '0 4px 12px rgba(0,0,0,0.5)'
          : '0 4px 12px rgba(0,0,0,0.15)',
    }),
    [theme]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Check data validity
  const hasValidData = Array.isArray(data) && data.length > 0;

  // Show loading state if not mounted OR if data is still being fetched
  if (!mounted || loading) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (!hasValidData) {
    return (
      <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">
        {t('charts.noActivityData')}
      </div>
    );
  }

  // Create safe data copy
  const safeData = data.map(item => ({
    week: String(item?.week || ''),
    progress: Number(item?.progress || 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={safeData}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#6b7280"
          strokeOpacity={0.3}
        />
        <XAxis
          dataKey="week"
          stroke="currentColor"
          fontSize={12}
          tick={{ fill: 'currentColor' }}
        />
        {/* The progress is a percentage of the completed enablers */}
        <YAxis
          stroke="currentColor"
          fontSize={12}
          tick={{ fill: 'currentColor' }}
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(value: number) => `${value}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number) => [`${value}%`, t('charts.progress')]}
        />
        <Area
          type="monotone"
          dataKey="progress"
          stroke="#ef4444"
          fill="#ef4444"
          fillOpacity={0.4}
          strokeWidth={3}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface ModuleProgressChartProps {
  data: {
    name: string;
    completed: number;
    inProgress: number;
    notStarted: number;
  }[];
  loading?: boolean;
}

export function ModuleProgressChart({
  data,
  loading = false,
}: ModuleProgressChartProps) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const tooltipStyle = useMemo(
    () => ({
      backgroundColor: theme === 'dark' ? '#1e1423' : '#ffffff',
      border: '1px solid #ef4444',
      borderRadius: '8px',
      color: theme === 'dark' ? '#ffffff' : '#1f2937',
      boxShadow:
        theme === 'dark'
          ? '0 4px 12px rgba(0,0,0,0.5)'
          : '0 4px 12px rgba(0,0,0,0.15)',
    }),
    [theme]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Check data validity
  const hasValidData = Array.isArray(data) && data.length > 0;

  // Show loading state if not mounted OR if data is still being fetched
  if (!mounted || loading) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (!hasValidData) {
    return (
      <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">
        {t('charts.noCourseData')}
      </div>
    );
  }

  // Create safe data copy with abbreviated names
  const safeData = data.map(item => ({
    name:
      String(item?.name || '').length > 22
        ? String(item?.name || '').substring(0, 21) + '…'
        : String(item?.name || ''),
    fullName: String(item?.name || ''),
    completed: Number(item?.completed || 0),
    inProgress: Number(item?.inProgress || 0),
    notStarted: Number(item?.notStarted || 0),
  }));

  // One row per course, horizontal bars: the names stay readable and the whole
  // title is in the tooltip. The chart grows with the number of courses.
  const rowHeight = 28;
  const chartHeight = Math.max(200, safeData.length * rowHeight + 40);

  return (
    <div className="max-h-[320px] overflow-y-auto">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={safeData} layout="vertical">
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#6b7280"
            strokeOpacity={0.3}
          />
          {/* The unit: number of trainees */}
          <XAxis
            type="number"
            allowDecimals={false}
            stroke="currentColor"
            fontSize={12}
            tick={{ fill: 'currentColor' }}
            label={{
              value: t('charts.traineesAxis'),
              position: 'insideBottomRight',
              offset: -4,
              fill: 'currentColor',
              fontSize: 11,
            }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            stroke="currentColor"
            fontSize={10}
            tick={{ fill: 'currentColor' }}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(_label, payload) =>
              String(payload?.[0]?.payload?.fullName ?? '')
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            dataKey="completed"
            name={t('charts.completed')}
            stackId="a"
            fill="#ef4444"
          />
          <Bar
            dataKey="inProgress"
            name={t('charts.inProgress')}
            stackId="a"
            fill="#dc2626"
          />
          <Bar
            dataKey="notStarted"
            name={t('charts.notStarted')}
            stackId="a"
            fill="#3c2846"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
