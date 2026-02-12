'use client';

import { useEffect, useRef, useCallback } from 'react';

interface RadarDataPoint {
    component: string;
    fullTitle: string;
    label: string;
    grade: number | null;
    radarValue: number | null;
    gradedCount: number;
    isSoftSkill?: boolean;
}

interface SkillRadarChartProps {
    data: RadarDataPoint[];
    size?: number;
    showLabels?: boolean;
    forPDF?: boolean;
}

const GRADE_COLORS: Record<number, string> = {
    1: '#22c55e',
    2: '#84cc16',
    3: '#eab308',
    4: '#f97316',
    5: '#ef4444',
    6: '#991b1b',
};

const GRADE_LABELS: Record<number, string> = {
    1: 'Sehr gut',
    2: 'Gut',
    3: 'Befriedigend',
    4: 'Ausreichend',
    5: 'Mangelhaft',
    6: 'Ungenügend',
};

export function SkillRadarChart({
    data,
    size = 400,
    showLabels = true,
    forPDF = false
}: SkillRadarChartProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const drawChart = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const gradedData = data.filter(d => d.radarValue !== null && d.grade !== null);
        if (gradedData.length === 0 && data.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        ctx.scale(dpr, dpr);

        const dataCount = data.length;
        if (dataCount < 3) return;

        const centerX = size / 2;
        const centerY = size / 2;
        const maxRadius = size * 0.30;
        const levels = 6;
        const angleStep = (2 * Math.PI) / dataCount;

        const textColor = forPDF ? '#1f2937' : '#e5e7eb';
        const gridColor = forPDF ? 'rgba(100, 100, 100, 0.2)' : 'rgba(156, 163, 175, 0.15)';
        const gridColorOuter = forPDF ? 'rgba(100, 100, 100, 0.35)' : 'rgba(156, 163, 175, 0.25)';
        const axisColor = forPDF ? 'rgba(100, 100, 100, 0.25)' : 'rgba(156, 163, 175, 0.12)';

        ctx.clearRect(0, 0, size, size);

        if (forPDF) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
        }

        // Draw background circles with grade numbers
        for (let level = 1; level <= levels; level++) {
            const radius = (maxRadius / levels) * level;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = level === levels ? gridColorOuter : gridColor;
            ctx.lineWidth = level === levels ? 1.5 : 0.5;
            ctx.stroke();

            // Grade number on axis
            const gradeNum = 7 - level;
            ctx.font = '8px Inter, system-ui, sans-serif';
            ctx.fillStyle = forPDF ? '#9ca3af' : '#6b7280';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(gradeNum.toString(), centerX + radius + 4, centerY);
        }

        // Draw axes
        data.forEach((_, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const x = centerX + maxRadius * Math.cos(angle);
            const y = centerY + maxRadius * Math.sin(angle);

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(x, y);
            ctx.strokeStyle = axisColor;
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // Draw data polygon
        if (gradedData.length >= 1) {
            ctx.beginPath();
            let firstPointDrawn = false;
            
            data.forEach((point, i) => {
                if (point.radarValue === null) return;

                const angle = angleStep * i - Math.PI / 2;
                const radius = (maxRadius / levels) * point.radarValue;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);

                if (!firstPointDrawn) {
                    ctx.moveTo(x, y);
                    firstPointDrawn = true;
                } else {
                    ctx.lineTo(x, y);
                }
            });

            if (gradedData.length >= 3) {
                ctx.closePath();
            }

            const avgRadar = gradedData.reduce((sum, d) => sum + (d.radarValue || 0), 0) / gradedData.length;
            const avgGrade = Math.round(7 - avgRadar);
            const gradeColor = GRADE_COLORS[Math.max(1, Math.min(6, avgGrade))] || '#666';

            if (gradedData.length >= 3) {
                ctx.fillStyle = `${gradeColor}20`;
                ctx.fill();
            }
            ctx.strokeStyle = gradeColor;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // Draw data points
        data.forEach((point, i) => {
            const angle = angleStep * i - Math.PI / 2;

            if (point.radarValue !== null && point.grade !== null) {
                const radius = (maxRadius / levels) * point.radarValue;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);

                const pointGrade = Math.round(point.grade);
                const pointColor = GRADE_COLORS[Math.max(1, Math.min(6, pointGrade))] || '#666';

                ctx.beginPath();
                ctx.arc(x, y, 7, 0, 2 * Math.PI);
                ctx.fillStyle = pointColor;
                ctx.fill();
                ctx.strokeStyle = forPDF ? '#ffffff' : '#1f2937';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });

        // Draw labels
        if (showLabels) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            data.forEach((point, i) => {
                const angle = angleStep * i - Math.PI / 2;
                const labelRadius = maxRadius + 50;
                let x = centerX + labelRadius * Math.cos(angle);
                let y = centerY + labelRadius * Math.sin(angle);

                // Adjust for top/bottom
                const angleDeg = (angle * 180 / Math.PI + 90 + 360) % 360;
                if (angleDeg > 60 && angleDeg < 120) y += 8;
                else if (angleDeg > 240 && angleDeg < 300) y -= 8;

                ctx.font = 'bold 11px Inter, system-ui, sans-serif';
                ctx.fillStyle = textColor;

                // Truncate label
                let displayLabel = point.label;
                const maxWidth = 65;
                while (ctx.measureText(displayLabel).width > maxWidth && displayLabel.length > 5) {
                    displayLabel = displayLabel.slice(0, -1);
                }
                if (displayLabel !== point.label) displayLabel += '…';

                ctx.fillText(displayLabel, x, y);

                // Grade below
                if (point.grade !== null) {
                    const gradeNum = Math.round(point.grade);
                    const gradeColor = GRADE_COLORS[Math.max(1, Math.min(6, gradeNum))] || '#666';
                    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
                    ctx.fillStyle = gradeColor;
                    ctx.fillText(`Note ${point.grade.toFixed(1)}`, x, y + 14);
                } else {
                    ctx.font = '10px Inter, system-ui, sans-serif';
                    ctx.fillStyle = forPDF ? '#9ca3af' : '#6b7280';
                    ctx.fillText('–', x, y + 14);
                }
            });
        }

        // Center info
        const avgRadar = gradedData.length > 0
            ? gradedData.reduce((sum, d) => sum + (d.radarValue || 0), 0) / gradedData.length
            : 0;
        const avgGrade = 7 - avgRadar;
        const avgGradeRounded = Math.round(avgGrade);
        const avgColor = GRADE_COLORS[Math.max(1, Math.min(6, avgGradeRounded))] || '#666';

        ctx.font = 'bold 20px Inter, system-ui, sans-serif';
        ctx.fillStyle = avgColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Ø ${avgGrade.toFixed(1)}`, centerX, centerY - 8);

        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillStyle = forPDF ? '#6b7280' : '#9ca3af';
        ctx.fillText('Durchschnitt', centerX, centerY + 12);

    }, [data, size, showLabels, forPDF]);

    useEffect(() => {
        drawChart();
    }, [drawChart]);

    // Empty state
    if (data.length === 0) {
        return (
            <div key="empty-state" className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p>Keine bewerteten Komponenten vorhanden</p>
            </div>
        );
    }

    // Bar chart view for < 3 components
    if (data.length < 3) {
        return (
            <div key="bar-chart-view" className="space-y-4 p-4">
                <p className="text-sm text-muted-foreground text-center mb-4">
                    Mindestens 3 Komponenten für Radar-Ansicht erforderlich
                </p>
                <div className="space-y-3">
                    {data.map((point) => {
                        const gradeNum = point.grade ? Math.round(point.grade) : null;
                        const color = gradeNum ? GRADE_COLORS[Math.max(1, Math.min(6, gradeNum))] : '#666';
                        return (
                            <div key={point.component} className="flex items-center gap-3">
                                <div className="w-28 text-sm font-medium truncate" title={point.fullTitle}>
                                    {point.label}
                                </div>
                                <div className="flex-1 h-8 bg-muted/30 rounded-lg overflow-hidden relative">
                                    <div
                                        className="h-full rounded-lg transition-all duration-500"
                                        style={{
                                            width: point.radarValue ? `${(point.radarValue / 6) * 100}%` : '0%',
                                            backgroundColor: color
                                        }}
                                    />
                                    <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white drop-shadow-sm">
                                        {point.grade !== null ? `Note ${point.grade.toFixed(1)}` : '–'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <Legend />
            </div>
        );
    }

    // Radar chart view for >= 3 components
    return (
        <div key="radar-chart-view" className="relative">
            <canvas
                ref={canvasRef}
                className="mx-auto"
                style={{ maxWidth: '100%', height: 'auto' }}
            />
            <Legend />
        </div>
    );
}

function Legend() {
    return (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4 text-xs">
            {Object.entries(GRADE_COLORS).map(([grade, color]) => (
                <div key={grade} className="flex items-center gap-1.5">
                    <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                    />
                    <span className="font-semibold">{grade}</span>
                    <span className="text-muted-foreground">
                        {GRADE_LABELS[parseInt(grade)]}
                    </span>
                </div>
            ))}
        </div>
    );
}

// Export function to render chart for PDF with white background
export function renderRadarChartForPDF(
    data: RadarDataPoint[],
    size: number = 500
): Promise<string> {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            resolve('');
            return;
        }

        const gradedData = data.filter(d => d.radarValue !== null && d.grade !== null);
        const dpr = 2;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        ctx.scale(dpr, dpr);

        // White background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        if (data.length < 3 || gradedData.length === 0) {
            // Draw professional bar chart for < 3 items
            // Title
            ctx.font = 'bold 16px Inter, system-ui, sans-serif';
            ctx.fillStyle = '#1f2937';
            ctx.textAlign = 'center';
            ctx.fillText('Kompetenzübersicht', size / 2, 40);
            
            ctx.font = '11px Inter, system-ui, sans-serif';
            ctx.fillStyle = '#6b7280';
            ctx.fillText('Bewertete Ausbildungsbereiche', size / 2, 58);
            
            const barHeight = 50;
            const barGap = 25;
            const totalHeight = data.length * (barHeight + barGap) - barGap;
            const startY = 90;
            const barMaxWidth = size * 0.5;
            const labelWidth = size * 0.35;
            const barStartX = labelWidth;

            // Calculate average for header
            if (gradedData.length > 0) {
                const avgGrade = gradedData.reduce((sum, d) => sum + (d.grade || 0), 0) / gradedData.length;
                const avgGradeRounded = Math.round(avgGrade);
                const avgColor = GRADE_COLORS[Math.max(1, Math.min(6, avgGradeRounded))] || '#666';
                
                ctx.font = '12px Inter, system-ui, sans-serif';
                ctx.fillStyle = '#6b7280';
                ctx.textAlign = 'center';
                ctx.fillText('Gesamtdurchschnitt:', size / 2, startY + totalHeight + 50);
                
                ctx.font = 'bold 24px Inter, system-ui, sans-serif';
                ctx.fillStyle = avgColor;
                ctx.fillText(`Ø ${avgGrade.toFixed(1)}`, size / 2, startY + totalHeight + 80);
            }

            data.forEach((point, i) => {
                const y = startY + i * (barHeight + barGap);
                const gradeNum = point.grade ? Math.round(point.grade) : null;
                const color = gradeNum ? GRADE_COLORS[Math.max(1, Math.min(6, gradeNum))] : '#e5e7eb';
                // Invert for bar display: grade 1 = full bar, grade 6 = small bar
                const barWidth = point.grade ? ((7 - point.grade) / 6) * barMaxWidth : 0;

                // Label on left
                ctx.font = 'bold 14px Inter, system-ui, sans-serif';
                ctx.fillStyle = '#1f2937';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(point.label, labelWidth - 20, y + barHeight / 2);

                // Bar background with rounded corners
                ctx.fillStyle = '#f3f4f6';
                ctx.beginPath();
                ctx.roundRect(barStartX, y, barMaxWidth, barHeight, 10);
                ctx.fill();
                
                // Border
                ctx.strokeStyle = '#e5e7eb';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Bar fill with gradient effect
                if (barWidth > 0) {
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.roundRect(barStartX, y, barWidth, barHeight, 10);
                    ctx.fill();
                }

                // Grade text inside bar
                ctx.font = 'bold 16px Inter, system-ui, sans-serif';
                ctx.fillStyle = barWidth > barMaxWidth * 0.4 ? '#ffffff' : '#1f2937';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(
                    point.grade !== null ? `Note ${point.grade.toFixed(1)}` : '–',
                    barStartX + barMaxWidth / 2,
                    y + barHeight / 2
                );
            });

            // Legend at bottom
            const legendY = size - 60;
            const grades = [1, 2, 3, 4, 5, 6];
            const legendLabels = ['Sehr gut', 'Gut', 'Befriedigend', 'Ausreichend', 'Mangelhaft', 'Ungenügend'];
            const legendWidth = size * 0.85;
            const legendStartX = (size - legendWidth) / 2;
            const itemWidth = legendWidth / grades.length;

            ctx.font = '9px Inter, system-ui, sans-serif';
            grades.forEach((grade, i) => {
                const x = legendStartX + i * itemWidth + itemWidth / 2;
                
                // Color circle
                ctx.beginPath();
                ctx.arc(x - 20, legendY, 5, 0, 2 * Math.PI);
                ctx.fillStyle = GRADE_COLORS[grade];
                ctx.fill();
                
                // Label
                ctx.fillStyle = '#6b7280';
                ctx.textAlign = 'left';
                ctx.fillText(`${grade} ${legendLabels[i]}`, x - 12, legendY + 3);
            });

            resolve(canvas.toDataURL('image/png'));
            return;
        }

        // Draw full radar chart
        const dataCount = data.length;
        const centerX = size / 2;
        const centerY = size / 2;
        const maxRadius = size * 0.30;
        const levels = 6;
        const angleStep = (2 * Math.PI) / dataCount;

        // Background circles
        for (let level = 1; level <= levels; level++) {
            const radius = (maxRadius / levels) * level;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = level === levels ? 'rgba(100, 100, 100, 0.35)' : 'rgba(100, 100, 100, 0.15)';
            ctx.lineWidth = level === levels ? 1.5 : 0.5;
            ctx.stroke();
        }

        // Axes
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

        // Data polygon
        ctx.beginPath();
        let firstPoint = true;
        data.forEach((point, i) => {
            if (point.radarValue === null) return;
            const angle = angleStep * i - Math.PI / 2;
            const radius = (maxRadius / levels) * point.radarValue;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        });
        if (gradedData.length >= 3) ctx.closePath();

        const avgRadar = gradedData.reduce((sum, d) => sum + (d.radarValue || 0), 0) / gradedData.length;
        const avgGrade = Math.round(7 - avgRadar);
        const gradeColor = GRADE_COLORS[Math.max(1, Math.min(6, avgGrade))] || '#666';

        if (gradedData.length >= 3) {
            ctx.fillStyle = `${gradeColor}18`;
            ctx.fill();
        }
        ctx.strokeStyle = gradeColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Data points
        data.forEach((point, i) => {
            if (point.radarValue === null || point.grade === null) return;
            const angle = angleStep * i - Math.PI / 2;
            const radius = (maxRadius / levels) * point.radarValue;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);

            const pointGrade = Math.round(point.grade);
            const pointColor = GRADE_COLORS[Math.max(1, Math.min(6, pointGrade))] || '#666';

            ctx.beginPath();
            ctx.arc(x, y, 7, 0, 2 * Math.PI);
            ctx.fillStyle = pointColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        // Labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        data.forEach((point, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const labelRadius = maxRadius + 55;
            const x = centerX + labelRadius * Math.cos(angle);
            const y = centerY + labelRadius * Math.sin(angle);

            ctx.font = 'bold 11px Inter, system-ui, sans-serif';
            ctx.fillStyle = '#1f2937';
            ctx.fillText(point.label, x, y);

            if (point.grade !== null) {
                const gNum = Math.round(point.grade);
                ctx.font = 'bold 10px Inter, system-ui, sans-serif';
                ctx.fillStyle = GRADE_COLORS[Math.max(1, Math.min(6, gNum))] || '#666';
                ctx.fillText(`Note ${point.grade.toFixed(1)}`, x, y + 14);
            }
        });

        // Center
        ctx.font = 'bold 20px Inter, system-ui, sans-serif';
        ctx.fillStyle = gradeColor;
        ctx.fillText(`Ø ${(7 - avgRadar).toFixed(1)}`, centerX, centerY - 8);
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.fillText('Durchschnitt', centerX, centerY + 12);

        // Legend at bottom
        const legendY = size - 30;
        const legendItems = Object.entries(GRADE_COLORS);
        const legendWidth = legendItems.length * 55;
        const legendStartX = (size - legendWidth) / 2 + 20;

        legendItems.forEach(([grade, color], i) => {
            const x = legendStartX + i * 55;
            ctx.beginPath();
            ctx.arc(x, legendY, 6, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.font = 'bold 10px Inter, system-ui, sans-serif';
            ctx.fillStyle = '#374151';
            ctx.textAlign = 'left';
            ctx.fillText(grade, x + 10, legendY + 3);
        });

        resolve(canvas.toDataURL('image/png'));
    });
}
