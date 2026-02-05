'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ProgressTrendChartProps {
  data: { week: string; progress: number }[];
  loading?: boolean;
}

export function ProgressTrendChart({ data, loading = false }: ProgressTrendChartProps) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Check data validity
  const hasValidData = Array.isArray(data) && data.length > 0;

  // Show loading state if not mounted OR if data is still being fetched
  if (!mounted || loading) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (!hasValidData) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        {t('charts.noActivityData')}
      </div>
    );
  }

  // Create safe data copy
  const safeData = data.map(item => ({
    week: String(item?.week || ''),
    progress: Number(item?.progress || 0)
  }));

  // Calculate max for Y-axis domain
  const maxProgress = Math.max(...safeData.map(d => d.progress), 1);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={safeData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#6b7280" strokeOpacity={0.3} />
        <XAxis dataKey="week" stroke="currentColor" fontSize={12} tick={{ fill: 'currentColor' }} />
        <YAxis stroke="currentColor" fontSize={12} tick={{ fill: 'currentColor' }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e1423',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
          formatter={(value: number) => [`${value} ${t('charts.activities')}`, t('charts.progress')]}
        />
        <Area type="monotone" dataKey="progress" stroke="#ef4444" fill="#ef4444" fillOpacity={0.4} strokeWidth={3} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface ModuleProgressChartProps {
  data: { name: string; completed: number; inProgress: number; notStarted: number }[];
  loading?: boolean;
}

export function ModuleProgressChart({ data, loading = false }: ModuleProgressChartProps) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Check data validity
  const hasValidData = Array.isArray(data) && data.length > 0;

  // Show loading state if not mounted OR if data is still being fetched
  if (!mounted || loading) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (!hasValidData) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        {t('charts.noCourseData')}
      </div>
    );
  }

  // Create safe data copy with abbreviated names
  const safeData = data.map(item => ({
    name: String(item?.name || '').length > 15
      ? String(item?.name || '').substring(0, 15) + '...'
      : String(item?.name || ''),
    fullName: String(item?.name || ''),
    completed: Number(item?.completed || 0),
    inProgress: Number(item?.inProgress || 0),
    notStarted: Number(item?.notStarted || 0),
  }));

  // Calculate max for Y-axis domain
  const maxTotal = Math.max(...safeData.map(d => d.completed + d.inProgress + d.notStarted), 1);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={safeData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#6b7280" strokeOpacity={0.3} />
        <XAxis dataKey="name" stroke="currentColor" fontSize={10} angle={-45} textAnchor="end" height={60} tick={{ fill: 'currentColor' }} />
        <YAxis stroke="currentColor" fontSize={12} tick={{ fill: 'currentColor' }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e1423',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        />
        <Bar dataKey="completed" stackId="a" fill="#ef4444" />
        <Bar dataKey="inProgress" stackId="a" fill="#dc2626" />
        <Bar dataKey="notStarted" stackId="a" fill="#3c2846" />
      </BarChart>
    </ResponsiveContainer>
  );
}
