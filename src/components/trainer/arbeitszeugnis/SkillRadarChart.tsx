'use client';

import { useEffect, useRef } from 'react';

interface RadarDataPoint {
    component: string;
    fullTitle: string;
    label: string;
    grade: number | null;
    radarValue: number | null;
    gradedCount: number;
}

interface SkillRadarChartProps {
    data: RadarDataPoint[];
    size?: number;
    showLabels?: boolean;
}

const GRADE_COLORS = {
    1: '#22c55e', // Emerald - excellent
    2: '#84cc16', // Lime - good
    3: '#eab308', // Yellow - satisfactory
    4: '#f97316', // Orange - sufficient
    5: '#ef4444', // Red - deficient
    6: '#991b1b', // Dark red - unsatisfactory
};

export function SkillRadarChart({
    data,
    size = 400,
    showLabels = true
}: SkillRadarChartProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // High DPI support
        const dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        ctx.scale(dpr, dpr);

        const centerX = size / 2;
        const centerY = size / 2;
        const maxRadius = size * 0.35; // Leave room for labels
        const levels = 6;
        const angleStep = (2 * Math.PI) / data.length;

        // Clear canvas
        ctx.clearRect(0, 0, size, size);

        // Draw background circles (grade levels)
        for (let level = 1; level <= levels; level++) {
            const radius = (maxRadius / levels) * level;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = level === levels ? 'rgba(100, 100, 100, 0.3)' : 'rgba(100, 100, 100, 0.15)';
            ctx.lineWidth = level === levels ? 2 : 1;
            ctx.stroke();
        }

        // Draw axes
        data.forEach((_, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const x = centerX + maxRadius * Math.cos(angle);
            const y = centerY + maxRadius * Math.sin(angle);

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(x, y);
            ctx.strokeStyle = 'rgba(100, 100, 100, 0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // Draw data polygon
        ctx.beginPath();
        data.forEach((point, i) => {
            if (point.radarValue === null) return;

            const angle = angleStep * i - Math.PI / 2;
            const radius = (maxRadius / levels) * point.radarValue;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.closePath();

        // Gradient fill based on overall performance
        const avgRadar = data.filter(d => d.radarValue !== null)
            .reduce((sum, d) => sum + (d.radarValue || 0), 0) / data.length;
        const avgGrade = 7 - avgRadar; // Convert back to grade
        const gradeColor = GRADE_COLORS[Math.round(avgGrade) as keyof typeof GRADE_COLORS] || '#666';

        ctx.fillStyle = `${gradeColor}33`; // 20% opacity
        ctx.fill();
        ctx.strokeStyle = gradeColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw data points
        data.forEach((point, i) => {
            if (point.radarValue === null) return;

            const angle = angleStep * i - Math.PI / 2;
            const radius = (maxRadius / levels) * point.radarValue;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);

            // Point color based on grade
            const pointGrade = point.grade || 3;
            const pointColor = GRADE_COLORS[Math.round(pointGrade) as keyof typeof GRADE_COLORS] || '#666';

            ctx.beginPath();
            ctx.arc(x, y, 6, 0, 2 * Math.PI);
            ctx.fillStyle = pointColor;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        // Draw labels
        if (showLabels) {
            ctx.font = '12px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            data.forEach((point, i) => {
                const angle = angleStep * i - Math.PI / 2;
                const labelRadius = maxRadius + 30;
                const x = centerX + labelRadius * Math.cos(angle);
                const y = centerY + labelRadius * Math.sin(angle);

                ctx.fillStyle = 'currentColor';
                ctx.fillText(point.label, x, y);

                if (point.grade !== null) {
                    ctx.font = '10px Inter, system-ui, sans-serif';
                    ctx.fillStyle = GRADE_COLORS[Math.round(point.grade) as keyof typeof GRADE_COLORS] || '#666';
                    ctx.fillText(`Note ${point.grade.toFixed(1)}`, x, y + 14);
                    ctx.font = '12px Inter, system-ui, sans-serif';
                }
            });
        }

        // Center label
        ctx.font = 'bold 14px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'currentColor';
        ctx.textAlign = 'center';
        ctx.fillText('Ø ' + (7 - avgRadar).toFixed(1), centerX, centerY - 8);
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(100, 100, 100, 0.8)';
        ctx.fillText('Durchschnitt', centerX, centerY + 8);

    }, [data, size, showLabels]);

    if (data.length < 3) {
        return (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
                Mindestens 3 Komponenten für Radar-Darstellung erforderlich
            </div>
        );
    }

    return (
        <div className="relative">
            <canvas
                ref={canvasRef}
                className="mx-auto"
                style={{ maxWidth: '100%', height: 'auto' }}
            />

            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-2 mt-4 text-xs">
                {Object.entries(GRADE_COLORS).map(([grade, color]) => (
                    <div key={grade} className="flex items-center gap-1">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: color }}
                        />
                        <span>{grade}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
