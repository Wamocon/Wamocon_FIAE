'use client';

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

interface WeeklyProgressChartProps {
  data: any[];
}

export function WeeklyProgressChart({ data }: WeeklyProgressChartProps) {
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
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e1423',
            border: '2px solid #ff1a1a',
            borderRadius: '12px',
            color: 'currentColor',
            boxShadow: '0 8px 24px rgba(255, 26, 26, 0.3)',
          }}
        />
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
      height={200}
      className="from-background/40 rounded-xl bg-gradient-to-br to-green-900/10 p-2"
    >
      <RadarChart data={data}>
        <PolarGrid stroke="#6b7280" strokeOpacity={0.2} />
        <PolarAngleAxis
          dataKey="skill"
          stroke="currentColor"
          fontSize={11}
          tick={{ fill: 'currentColor' }}
        />
        <PolarRadiusAxis
          stroke="currentColor"
          fontSize={10}
          tick={{ fill: 'currentColor' }}
          axisLine={false}
        />
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
          angle={-45}
          textAnchor="end"
          height={60}
          tick={{ fill: 'currentColor' }}
        />
        <YAxis
          stroke="currentColor"
          fontSize={10}
          tick={{ fill: 'currentColor' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e1423',
            border: '2px solid #ff1a1a',
            borderRadius: '12px',
            color: 'currentColor',
            boxShadow: '0 8px 24px rgba(255, 26, 26, 0.3)',
          }}
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
