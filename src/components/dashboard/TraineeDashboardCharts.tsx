'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import { useTheme } from '@/contexts/ThemeContext';
import { shortenLabel, wrapLabel } from './chart-labels';

// Tick of the radar chart: the name of the skill in up to two lines, the whole
// name as the tooltip of the browser (a long name was cut or overlapped its
// neighbours)
function RadarTick(props: any) {
  const { x, y, payload, textAnchor } = props;
  const name = String(payload?.value ?? '');
  const lines = wrapLabel(name, 16, 2);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{name}</title>
      <text textAnchor={textAnchor} fill="currentColor" fontSize={10}>
        {lines.map((line, index) => (
          <tspan key={index} x={0} dy={index === 0 ? 0 : 12}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

// Tick of the bar chart: a shortened name with the whole name as the tooltip
function BarTick(props: any) {
  const { x, y, payload } = props;
  const name = String(payload?.value ?? '');
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{name}</title>
      <text
        textAnchor="end"
        fill="currentColor"
        fontSize={10}
        transform="rotate(-45)"
      >
        {shortenLabel(name, 24)}
      </text>
    </g>
  );
}

function useTooltipStyle() {
  const { theme } = useTheme();
  return useMemo(
    () => ({
      backgroundColor: theme === 'dark' ? '#1e1423' : '#ffffff',
      border: '2px solid #ff1a1a',
      borderRadius: '12px',
      color: theme === 'dark' ? '#ffffff' : '#1f2937',
      boxShadow:
        theme === 'dark'
          ? '0 8px 24px rgba(255,26,26,0.3)'
          : '0 4px 12px rgba(0,0,0,0.15)',
    }),
    [theme]
  );
}

interface WeeklyProgressChartProps {
  data: any[];
}

export function WeeklyProgressChart({ data }: WeeklyProgressChartProps) {
  const tooltipStyle = useTooltipStyle();
  return (
    <ResponsiveContainer
      width="100%"
      height={200}
      className="from-background/40 rounded-xl bg-gradient-to-br to-red-900/10 p-2"
    >
      <LineChart data={data}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#6b7280"
          strokeOpacity={0.2}
        />
        <XAxis
          dataKey="week"
          stroke="currentColor"
          fontSize={12}
          tick={{ fill: 'currentColor' }}
        />
        <YAxis
          stroke="currentColor"
          fontSize={12}
          tick={{ fill: 'currentColor' }}
        />
        <Tooltip contentStyle={tooltipStyle} />
        <Line
          type="monotone"
          dataKey="progress"
          stroke="#ff1a1a"
          strokeWidth={4}
          dot={{
            fill: '#ff1a1a',
            strokeWidth: 3,
            r: 6,
            stroke: 'currentColor',
          }}
          activeDot={{ r: 8, stroke: 'currentColor', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface SkillRadarChartProps {
  data: any[];
}

export function SkillRadarChart({ data }: SkillRadarChartProps) {
  return (
    <ResponsiveContainer
      width="100%"
      height={260}
      className="from-background/40 rounded-xl bg-gradient-to-br to-green-900/10 p-2"
    >
      <RadarChart data={data} outerRadius="58%">
        <PolarGrid stroke="#6b7280" strokeOpacity={0.2} />
        <PolarAngleAxis
          dataKey="skill"
          stroke="currentColor"
          fontSize={11}
          tick={<RadarTick />}
        />
        <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
        <Radar
          name="Skills"
          dataKey="value"
          stroke="#ff1a1a"
          fill="#ff1a1a"
          fillOpacity={0.3}
          strokeWidth={3}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

interface ModuleBarChartProps {
  data: any[];
}

export function ModuleBarChart({ data }: ModuleBarChartProps) {
  const tooltipStyle = useTooltipStyle();
  return (
    <ResponsiveContainer
      width="100%"
      height={200}
      className="from-background/40 rounded-xl bg-gradient-to-br to-blue-900/10 p-2"
    >
      <BarChart data={data}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#6b7280"
          strokeOpacity={0.2}
        />
        <XAxis
          dataKey="name"
          stroke="currentColor"
          fontSize={10}
          interval={0}
          height={90}
          tick={<BarTick />}
        />
        <YAxis
          stroke="currentColor"
          fontSize={10}
          tick={{ fill: 'currentColor' }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          // the axis shows a short name, the tooltip the whole one
          labelFormatter={(label, payload) =>
            payload?.[0]?.payload?.name ?? label
          }
        />
        <Bar
          dataKey="progress"
          fill="#ff1a1a"
          radius={[4, 4, 0, 0]}
          stroke="currentColor"
          strokeWidth={1}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
