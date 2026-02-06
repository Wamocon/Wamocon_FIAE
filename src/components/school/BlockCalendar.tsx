'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
    Calendar,
    ChevronLeft,
    ChevronRight,
    Upload,
    Plus,
    School,
    Building2,
    Palmtree,
    FileText,
    User,
    X,
    Check,
    AlertCircle,
    Info,
    Sparkles,
    Trash2,
    Clock,
} from 'lucide-react';

interface Block {
    id: string;
    calendarWeek: number;
    year: number;
    startDate: string;
    endDate: string;
    blockType: 'SCHOOL' | 'COMPANY' | 'HOLIDAY' | 'EXAM' | 'PERSONAL' | 'SONSTIGES' | 'TRAINER_BLOCKER';
    blockNumber: number | null;
    title: string | null;
    notes: string | null;
    isPersonal: boolean;
    schuljahr: string;
    ausbildungsjahr: number;
    // New fields
    examSubType?: 'IHK_ABSCHLUSSPRUEFUNG_T1' | 'IHK_ABSCHLUSSPRUEFUNG_T2' | 'KLAUSUR_WMC' | 'KLAUSUR_ALLGEMEIN' | 'PRAKTISCHE_PRUEFUNG' | 'MUENDLICHE_PRUEFUNG' | 'PROJEKTARBEIT' | 'ANDERE' | null;
    description?: string | null;
    createdByTrainerId?: string | null;
    inviteeEmails?: string | null;
}

interface BlockMeta {
    currentSchuljahr: string;
    currentWeek: number;
    currentYear: number;
}

// Exam interface for calendar overlay
interface CalendarExam {
    id: string;
    examDate: string;
    subject: string;
    examTypeValue: string | null;
    lernfeldCode: string | null;
    teacher: string | null;
    period: string | null;
}

// Theme-aware block colors
const BLOCK_CONFIG = {
    SCHOOL: {
        labelKey: 'block.type.school',
        Icon: School,
        color: 'bg-accent',
        lightBg: 'bg-accent/20',
        border: 'border-accent/50',
        text: 'text-accent',
    },
    COMPANY: {
        labelKey: 'block.type.company',
        Icon: Building2,
        color: 'bg-green-500',
        lightBg: 'bg-green-500/20',
        border: 'border-green-500/50',
        text: 'text-green-600 dark:text-green-400',
    },
    HOLIDAY: {
        labelKey: 'block.type.holiday',
        Icon: Palmtree,
        color: 'bg-amber-500',
        lightBg: 'bg-amber-500/20',
        border: 'border-amber-500/50',
        text: 'text-amber-600 dark:text-amber-400',
    },
    EXAM: {
        labelKey: 'block.type.exam',
        Icon: FileText,
        color: 'bg-rose-500',
        lightBg: 'bg-rose-500/20',
        border: 'border-rose-500/50',
        text: 'text-rose-600 dark:text-rose-400',
    },
    PERSONAL: {
        labelKey: 'block.type.personal',
        Icon: User,
        color: 'bg-violet-500',
        lightBg: 'bg-violet-500/20',
        border: 'border-violet-500/50',
        text: 'text-violet-600 dark:text-violet-400',
    },
    SONSTIGES: {
        labelKey: 'block.type.other',
        Icon: AlertCircle,
        color: 'bg-slate-500',
        lightBg: 'bg-slate-500/20',
        border: 'border-slate-500/50',
        text: 'text-slate-600 dark:text-slate-400',
    },
    TRAINER_BLOCKER: {
        labelKey: 'block.type.trainer',
        Icon: User,
        color: 'bg-indigo-500',
        lightBg: 'bg-indigo-500/20',
        border: 'border-indigo-500/50',
        text: 'text-indigo-600 dark:text-indigo-400',
    },
};

// Weekday keys for translation
const WEEKDAY_KEYS = [
    'time.weekdays.mo', 'time.weekdays.tu', 'time.weekdays.we', 'time.weekdays.th',
    'time.weekdays.fr', 'time.weekdays.sa', 'time.weekdays.su'
];

// Helper to get days in a month
function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

// Helper to get first day of month (0 = Sunday, adjusted to Monday = 0)
function getFirstDayOfMonth(year: number, month: number) {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1; // Adjust so Monday = 0
}

// Helper to check if a date is within a block's range
function isDateInBlock(date: Date, block: Block): boolean {
    const start = new Date(block.startDate);
    const end = new Date(block.endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return date >= start && date <= end;
}

// Helper to format date as YYYY-MM-DD for comparison
function formatDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function BlockCalendar() {
    const { profile } = useAuth();
    const { t } = useLanguage();

    // Helper to get translated month names
    const getMonthName = (monthIndex: number) => {
        const monthKeys = [
            'time.months.january', 'time.months.february', 'time.months.march',
            'time.months.april', 'time.months.may', 'time.months.june',
            'time.months.july', 'time.months.august', 'time.months.september',
            'time.months.october', 'time.months.november', 'time.months.december'
        ];
        return t(monthKeys[monthIndex]);
    };

    // Get translated weekdays
    const weekdays = useMemo(() => WEEKDAY_KEYS.map(key => t(key)), [t]);

    const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
    const [selectedWeek, setSelectedWeek] = useState<Date>(new Date()); // Start date of the selected week

    const [blocks, setBlocks] = useState<Block[]>([]);
    const [exams, setExams] = useState<CalendarExam[]>([]);
    const [meta, setMeta] = useState<BlockMeta | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Use state for current date to avoid hydration issues
    const [currentDate, setCurrentDate] = useState<Date | null>(null);
    const [selectedMonth, setSelectedMonth] = useState(0);
    const [selectedYear, setSelectedYear] = useState(2026);

    const [showAddModal, setShowAddModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    // Initialize date on client side
    useEffect(() => {
        const now = new Date();
        setCurrentDate(now);
        setSelectedMonth(now.getMonth());
        setSelectedYear(now.getFullYear());

        // Set selected week start to current week's Monday
        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        setSelectedWeek(d);
    }, []);

    // Load blocks
    useEffect(() => {
        if (!profile?.id || selectedYear === 0) return;

        const loadBlocks = async () => {
            setLoading(true);
            setError(null);
            try {
                // Fetch blocks and exams in parallel
                const [blocksRes, examsRes] = await Promise.all([
                    fetch(`/api/trainee/school/blocks?traineeId=${profile.id}&year=${selectedYear}`),
                    fetch(`/api/trainee/school/exams?traineeId=${profile.id}`)
                ]);

                if (!blocksRes.ok) throw new Error(t('calendar.error.loadBlocks'));
                const blocksData = await blocksRes.json();
                setBlocks(blocksData.blocks || []);
                setMeta(blocksData.meta || null);

                if (examsRes.ok) {
                    const examsData = await examsRes.json();
                    setExams(examsData.exams || []);
                }
            } catch (e: any) {
                setError(e.message);
                setBlocks([]);
            } finally {
                setLoading(false);
            }
        };

        loadBlocks();
    }, [profile?.id, selectedYear]);


    // Generate calendar days for MONTH view
    const calendarDays = useMemo(() => {
        if (!currentDate || viewMode !== 'month') return [];

        const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
        const firstDay = getFirstDayOfMonth(selectedYear, selectedMonth);

        const prevMonth = selectedMonth === 0 ? 11 : selectedMonth - 1;
        const prevYear = selectedMonth === 0 ? selectedYear - 1 : selectedYear;
        const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

        const days: { date: Date; isCurrentMonth: boolean; isToday: boolean; blocks: Block[]; exams: CalendarExam[] }[] = [];

        // Previous month days
        for (let i = firstDay - 1; i >= 0; i--) {
            const day = daysInPrevMonth - i;
            const date = new Date(prevYear, prevMonth, day);
            days.push({
                date,
                isCurrentMonth: false,
                isToday: false,
                blocks: blocks.filter(b => isDateInBlock(date, b)),
                exams: exams.filter(e => {
                    const examDate = new Date(e.examDate);
                    return examDate.getDate() === date.getDate() &&
                        examDate.getMonth() === date.getMonth() &&
                        examDate.getFullYear() === date.getFullYear();
                }),
            });
        }

        // Current month days
        const today = new Date();
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(selectedYear, selectedMonth, day);
            const isToday =
                date.getDate() === today.getDate() &&
                date.getMonth() === today.getMonth() &&
                date.getFullYear() === today.getFullYear();

            days.push({
                date,
                isCurrentMonth: true,
                isToday,
                blocks: blocks.filter(b => isDateInBlock(date, b)),
                exams: exams.filter(e => {
                    const examDate = new Date(e.examDate);
                    return examDate.getDate() === date.getDate() &&
                        examDate.getMonth() === date.getMonth() &&
                        examDate.getFullYear() === date.getFullYear();
                }),
            });
        }

        // Next month days to fill grid
        const nextMonth = selectedMonth === 11 ? 0 : selectedMonth + 1;
        const nextYear = selectedMonth === 11 ? selectedYear + 1 : selectedYear;
        const remainingDays = 42 - days.length;

        for (let day = 1; day <= remainingDays; day++) {
            const date = new Date(nextYear, nextMonth, day);
            days.push({
                date,
                isCurrentMonth: false,
                isToday: false,
                blocks: blocks.filter(b => isDateInBlock(date, b)),
                exams: exams.filter(e => {
                    const examDate = new Date(e.examDate);
                    return examDate.getDate() === date.getDate() &&
                        examDate.getMonth() === date.getMonth() &&
                        examDate.getFullYear() === date.getFullYear();
                }),
            });
        }

        return days;
    }, [selectedYear, selectedMonth, blocks, exams, currentDate, viewMode]);

    // Generate days for WEEK view
    const weekDays = useMemo(() => {
        if (viewMode !== 'week' || !selectedWeek) return [];
        const days = [];
        const today = new Date();
        for (let i = 0; i < 7; i++) {
            const date = new Date(selectedWeek);
            date.setDate(selectedWeek.getDate() + i);
            const isToday =
                date.getDate() === today.getDate() &&
                date.getMonth() === today.getMonth() &&
                date.getFullYear() === today.getFullYear();

            days.push({
                date,
                isToday,
                blocks: blocks.filter(b => isDateInBlock(date, b)),
                exams: exams.filter(e => {
                    const examDate = new Date(e.examDate);
                    return examDate.getDate() === date.getDate() &&
                        examDate.getMonth() === date.getMonth() &&
                        examDate.getFullYear() === date.getFullYear();
                }),
            });
        }
        return days;
    }, [selectedWeek, blocks, exams, viewMode]);


    // Navigation Logic
    const goToPrevMonth = useCallback(() => {
        if (selectedMonth === 0) {
            setSelectedMonth(11);
            setSelectedYear(y => y - 1);
        } else {
            setSelectedMonth(m => m - 1);
        }
    }, [selectedMonth]);

    const goToNextMonth = useCallback(() => {
        if (selectedMonth === 11) {
            setSelectedMonth(0);
            setSelectedYear(y => y + 1);
        } else {
            setSelectedMonth(m => m + 1);
        }
    }, [selectedMonth]);

    const goToPrevWeek = useCallback(() => {
        const newDate = new Date(selectedWeek);
        newDate.setDate(selectedWeek.getDate() - 7);
        setSelectedWeek(newDate);
        // Sync month/year if week crosses boundary
        if (newDate.getMonth() !== selectedMonth) {
            setSelectedMonth(newDate.getMonth());
            setSelectedYear(newDate.getFullYear());
        }
    }, [selectedWeek, selectedMonth]);

    const goToNextWeek = useCallback(() => {
        const newDate = new Date(selectedWeek);
        newDate.setDate(selectedWeek.getDate() + 7);
        setSelectedWeek(newDate);
        if (newDate.getMonth() !== selectedMonth) {
            setSelectedMonth(newDate.getMonth());
            setSelectedYear(newDate.getFullYear());
        }
    }, [selectedWeek, selectedMonth]);

    const goToToday = useCallback(() => {
        const now = new Date();
        setSelectedMonth(now.getMonth());
        setSelectedYear(now.getFullYear());

        // Calculate start of current week
        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        setSelectedWeek(d);
    }, []);

    // Explicitly switch to week view and jump to date
    const handleMoreClick = (date: Date, e: React.MouseEvent) => {
        e.stopPropagation(); // prevent adding block

        // Set selected week start to the clicked date's week Monday
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);

        setSelectedWeek(d);
        setViewMode('week');
    };

    // Stats
    const stats = useMemo(() => {
        const schoolBlocks = blocks.filter(b => b.blockType === 'SCHOOL').length;
        const companyBlocks = blocks.filter(b => b.blockType === 'COMPANY').length;
        const holidayBlocks = blocks.filter(b => b.blockType === 'HOLIDAY').length;
        return { schoolBlocks, companyBlocks, holidayBlocks, total: blocks.length };
    }, [blocks]);

    const handleAddBlock = async (blockData: Partial<Block>) => {
        if (!profile?.id) return;
        try {
            const res = await fetch('/api/trainee/school/blocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    traineeId: profile.id,
                    ...blockData,
                }),
            });

            if (!res.ok) throw new Error(t('calendar.error.addBlock'));

            const data = await res.json();
            setBlocks(prev => [...prev, data.block]);
            setShowAddModal(false);
            setSelectedDate(null);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleDeleteBlock = async (blockId: string) => {
        try {
            const res = await fetch(`/api/trainee/school/blocks/${blockId}`, {
                method: 'DELETE',
            });

            if (!res.ok) throw new Error(t('calendar.error.deleteBlock'));

            setBlocks(prev => prev.filter(b => b.id !== blockId));
            setSelectedBlock(null);
        } catch (e: any) {
            setError(e.message);
        }
    };

    if (loading || !currentDate) {
        return (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
                <p className="text-muted-foreground text-sm">{t('calendar.loading')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6" suppressHydrationWarning>
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-foreground">{t('calendar.title')}</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        {t('calendar.description')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex bg-muted rounded-xl p-1 border border-border">
                        <button
                            onClick={() => setViewMode('month')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'month' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            {t('calendar.month')}
                        </button>
                        <button
                            onClick={() => setViewMode('week')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'week' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            {t('calendar.week')}
                        </button>
                    </div>

                    <button
                        onClick={() => setShowImportModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl glass-effect text-foreground text-sm font-medium transition-all hover:border-accent/30"
                    >
                        <Upload className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('calendar.import')}</span>
                    </button>
                    <button
                        onClick={() => {
                            setSelectedDate(new Date());
                            setShowAddModal(true);
                        }}
                        className="btn-accent flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('calendar.newBlock')}</span>
                    </button>
                </div>
            </div>

            {/* Navigation Bar */}
            <div className="flex items-center justify-between p-4 rounded-xl glass-effect">
                <button
                    onClick={viewMode === 'month' ? goToPrevMonth : goToPrevWeek}
                    className="p-2 rounded-lg hover:bg-muted transition-colors text-foreground"
                >
                    <ChevronLeft className="h-5 w-5" />
                </button>

                <div className="flex items-center gap-4">
                    <h3 className="text-lg font-bold text-foreground min-w-[200px] text-center">
                        {viewMode === 'month'
                            ? `${getMonthName(selectedMonth)} ${selectedYear}`
                            : `KW ${selectedWeek ? (
                                (() => {
                                    const d = new Date(Date.UTC(selectedWeek.getFullYear(), selectedWeek.getMonth(), selectedWeek.getDate()));
                                    const dayNum = d.getUTCDay() || 7;
                                    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
                                    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                                    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
                                })()
                            ) : ''} • ${selectedWeek?.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`
                        }
                    </h3>
                    <button
                        onClick={goToToday}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition"
                    >
                        {t('calendar.today')}
                    </button>
                </div>

                <button
                    onClick={viewMode === 'month' ? goToNextMonth : goToNextWeek}
                    className="p-2 rounded-lg hover:bg-muted transition-colors text-foreground"
                >
                    <ChevronRight className="h-5 w-5" />
                </button>
            </div>

            {/* Legend - Only show in Month view to save space in Week view */}
            {viewMode === 'month' && (
                <div className="flex flex-wrap gap-4 mb-6 p-4 rounded-xl glass-effect">
                    {Object.entries(BLOCK_CONFIG)
                        .filter(([type]) => !['PERSONAL', 'TRAINER_BLOCKER'].includes(type))
                        .map(([type, config]) => (
                            <div key={type} className="flex items-center gap-2">
                                <div className={`h-3 w-3 rounded-full ${config.color}`} />
                                <span className="text-sm font-medium text-muted-foreground">{t(config.labelKey)}</span>
                            </div>
                        ))}
                </div>
            )}

            {/* Calendar Grid Container */}
            <div className="rounded-2xl glass-effect overflow-hidden">
                {/* Weekday Headers */}
                <div className="grid grid-cols-7 border-b border-border bg-muted/20">
                    {weekdays.map((day, i) => (
                        <div
                            key={day}
                            className={`py-3 text-center text-sm font-semibold ${i >= 5 ? 'text-muted-foreground' : 'text-foreground'}`}
                        >
                            {day}
                        </div>
                    ))}
                </div>

                {/* Grid Content */}
                <div className="grid grid-cols-7">
                    {viewMode === 'month'
                        ? calendarDays.map((dayData, index) => {
                            const isWeekend = index % 7 >= 5;
                            const hasBlocks = dayData.blocks.length > 0;
                            const primaryBlock = dayData.blocks[0];

                            return (
                                <button
                                    key={index}
                                    onClick={() => {
                                        if (hasBlocks) {
                                            setSelectedBlock(primaryBlock);
                                        } else {
                                            setSelectedDate(dayData.date);
                                            setShowAddModal(true);
                                        }
                                    }}
                                    className={`
                                        relative min-h-[80px] md:min-h-[100px] p-2 border-b border-r border-border
                                        transition-all hover:bg-muted/50 cursor-pointer text-left
                                        ${!dayData.isCurrentMonth ? 'opacity-40' : ''}
                                        ${dayData.isToday ? 'bg-accent/5' : ''}
                                        ${isWeekend && dayData.isCurrentMonth ? 'bg-muted/30' : ''}
                                    `}
                                >
                                    {/* Date Number */}
                                    <div className={`
                                        inline-flex items-center justify-center h-7 w-7 rounded-full text-sm font-medium mb-1
                                        ${dayData.isToday
                                            ? 'bg-accent text-accent-foreground'
                                            : isWeekend
                                                ? 'text-muted-foreground'
                                                : 'text-foreground'
                                        }
                                    `}>
                                        {dayData.date.getDate()}
                                    </div>

                                    {/* Block Indicators */}
                                    {hasBlocks && (
                                        <div className="space-y-1">
                                            {dayData.blocks.slice(0, 2).map((block, bi) => {
                                                const blockConfig = BLOCK_CONFIG[block.blockType];
                                                return (
                                                    <div
                                                        key={block.id + bi}
                                                        className={`
                                                            flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                                                            ${blockConfig.lightBg} ${blockConfig.text} ${blockConfig.border} border
                                                        `}
                                                    >
                                                        <blockConfig.Icon className="h-3 w-3 flex-shrink-0" />
                                                        <span className="truncate hidden md:block">
                                                            {block.title || block.description || t(blockConfig.labelKey)}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                            {dayData.blocks.length > 2 && (
                                                <div
                                                    role="button"
                                                    onClick={(e) => handleMoreClick(dayData.date, e)}
                                                    className="text-[10px] text-muted-foreground px-1.5 hover:text-foreground hover:underline"
                                                >
                                                    {t('calendar.more').replace('{count}', String(dayData.blocks.length - 2))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Exam Indicators */}
                                    {dayData.exams.length > 0 && (
                                        <div className="mt-1 space-y-1">
                                            {dayData.exams.slice(0, 2).map((exam) => (
                                                <div
                                                    key={exam.id}
                                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                                                >
                                                    <FileText className="h-3 w-3 flex-shrink-0" />
                                                    <span className="truncate hidden md:block">
                                                        {exam.subject}
                                                    </span>
                                                </div>
                                            ))}
                                            {dayData.exams.length > 2 && (
                                                <div
                                                    role="button"
                                                    onClick={(e) => handleMoreClick(dayData.date, e)}
                                                    className="text-[10px] text-muted-foreground px-1.5 hover:text-foreground hover:underline"
                                                >
                                                    {t('calendar.moreExams').replace('{count}', String(dayData.exams.length - 2))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </button>
                            );
                        })
                        : weekDays.map((dayData, index) => {
                            const isWeekend = index >= 5;

                            return (
                                <div
                                    key={index}
                                    className={`
                                    relative min-h-[400px] p-2 border-r border-border
                                    ${dayData.isToday ? 'bg-accent/5' : ''}
                                    ${isWeekend ? 'bg-muted/30' : ''}
                                `}
                                >
                                    <div className={`
                                    flex flex-col items-center mb-4 pb-2 border-b border-border/50
                                `}>
                                        <span className="text-2xl font-bold">{dayData.date.getDate()}</span>
                                    </div>

                                    <div className="space-y-2">
                                        {/* Full list of blocks for the day */}
                                        {dayData.blocks.map((block, bi) => {
                                            const blockConfig = BLOCK_CONFIG[block.blockType];
                                            return (
                                                <button
                                                    key={block.id + bi}
                                                    onClick={() => setSelectedBlock(block)}
                                                    className={`
                                                    w-full text-left p-2 rounded-lg border transition-all hover:scale-[1.02]
                                                    ${blockConfig.lightBg} ${blockConfig.text} ${blockConfig.border}
                                                `}
                                                >
                                                    <div className="flex items-start gap-2 mb-1">
                                                        <blockConfig.Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                                        <span className="font-semibold text-xs leading-tight">
                                                            {block.title || t(blockConfig.labelKey)}
                                                        </span>
                                                    </div>
                                                    {block.description && (
                                                        <p className="text-[10px] opacity-80 line-clamp-2">
                                                            {block.description}
                                                        </p>
                                                    )}
                                                    <div className="mt-1.5 flex items-center gap-1 text-[10px] opacity-70">
                                                        <Clock className="h-3 w-3" />
                                                        {new Date(block.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        -
                                                        {new Date(block.endDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </button>
                                            );
                                        })}

                                        {/* Full list of exams */}
                                        {dayData.exams.map((exam) => (
                                            <div
                                                key={exam.id}
                                                className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400"
                                            >
                                                <div className="flex items-start gap-2 mb-1">
                                                    <FileText className="h-4 w-4 mt-0.5" />
                                                    <span className="font-semibold text-xs">{exam.subject}</span>
                                                </div>
                                                <p className="text-[10px] opacity-80">{exam.examTypeValue || t('calendar.examFallback')}</p>
                                            </div>
                                        ))}

                                        {/* Add Button Placeholder */}
                                        <button
                                            onClick={() => {
                                                setSelectedDate(dayData.date);
                                                setShowAddModal(true);
                                            }}
                                            className="w-full py-2 mt-2 rounded-lg border border-dashed border-border text-muted-foreground/50 hover:text-accent hover:border-accent hover:bg-accent/5 text-xs transition-colors flex items-center justify-center gap-1"
                                        >
                                            <Plus className="h-3 w-3" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    }
                </div>
            </div>

            {/* Quick Stats */}
            {stats.total > 0 && (
                <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl glass-effect border border-accent/20">
                        <div className="flex items-center gap-3">
                            <School className="h-5 w-5 text-accent" />
                            <div>
                                <p className="text-xl font-bold text-foreground">{stats.schoolBlocks}</p>
                                <p className="text-xs text-accent">{t('calendar.schoolBlocks')}</p>
                            </div>
                        </div>
                    </div>
                    <div className="p-4 rounded-xl glass-effect border border-green-500/20">
                        <div className="flex items-center gap-3">
                            <Building2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                            <div>
                                <p className="text-xl font-bold text-foreground">{stats.companyBlocks}</p>
                                <p className="text-xs text-green-600 dark:text-green-400">{t('calendar.companyPhases')}</p>
                            </div>
                        </div>
                    </div>
                    <div className="p-4 rounded-xl glass-effect border border-amber-500/20">
                        <div className="flex items-center gap-3">
                            <Palmtree className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                            <div>
                                <p className="text-xl font-bold text-foreground">{stats.holidayBlocks}</p>
                                <p className="text-xs text-amber-600 dark:text-amber-400">{t('calendar.holidayWeeks')}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Empty State */}
            {blocks.length === 0 && !loading && (
                <div className="text-center py-8 px-6">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-accent/10 flex items-center justify-center">
                        <Sparkles className="h-7 w-7 text-accent" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground mb-2">
                        {t('calendar.emptyState.title')}
                    </h3>
                    <p className="text-muted-foreground max-w-sm mx-auto mb-4 text-sm">
                        {t('calendar.emptyState.description')}
                    </p>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                    <p className="text-sm text-destructive">{error}</p>
                    <button
                        onClick={() => setError(null)}
                        className="ml-auto p-1 hover:bg-destructive/10 rounded"
                    >
                        <X className="h-4 w-4 text-destructive" />
                    </button>
                </div>
            )}

            {/* Block Detail Modal */}
            {selectedBlock && (
                <BlockDetailModal
                    block={selectedBlock}
                    onClose={() => setSelectedBlock(null)}
                    onDelete={handleDeleteBlock}
                />
            )}

            {/* Add Block Modal */}
            {showAddModal && (
                <AddBlockModal
                    onClose={() => {
                        setShowAddModal(false);
                        setSelectedDate(null);
                    }}
                    onAdd={handleAddBlock}
                    initialDate={selectedDate}
                />
            )}

            {/* Import Modal */}
            {showImportModal && (
                <ImportBlocksModal
                    onClose={() => setShowImportModal(false)}
                    traineeId={profile?.id || ''}
                    onSuccess={() => {
                        setShowImportModal(false);
                        window.location.reload();
                    }}
                />
            )}
        </div>
    );
}

// Block Detail Modal
function BlockDetailModal({
    block,
    onClose,
    onDelete
}: {
    block: Block;
    onClose: () => void;
    onDelete: (blockId: string) => void;
}) {
    const { t } = useLanguage();
    const config = BLOCK_CONFIG[block.blockType];
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('de-DE', {
            weekday: 'short',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });
    };

    const handleDelete = async () => {
        setDeleting(true);
        await onDelete(block.id);
        setDeleting(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
                <div className={`p-6 ${config.lightBg}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-3 rounded-xl ${config.lightBg} border ${config.border}`}>
                                <config.Icon className={`h-6 w-6 ${config.text}`} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-foreground">
                                    {block.title || t(config.labelKey)}
                                    {block.blockNumber && <span className="ml-2 text-muted-foreground">{t('calendar.block.blockNumber').replace('{number}', String(block.blockNumber))}</span>}
                                </h3>
                                <p className="text-sm text-muted-foreground">{t(config.labelKey)} • {t('calendar.block.calendarWeek').replace('{week}', String(block.calendarWeek))}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition text-foreground">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    {/* Time Range */}
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {t('calendar.block.period')}
                        </p>
                        <p className="text-foreground font-medium">{formatDate(block.startDate)}</p>
                        <p className="text-foreground">{t('calendar.block.until').replace('{date}', formatDate(block.endDate))}</p>
                    </div>

                    {/* Description (for trainer blockers or sonstiges) */}
                    {block.description && (
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('calendar.block.descriptionLabel')}</p>
                            <p className="text-foreground">{block.description}</p>
                        </div>
                    )}

                    {/* Notes */}
                    {block.notes && (
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('calendar.block.notes')}</p>
                            <p className="text-foreground">{block.notes}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 pt-2">
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('calendar.block.schoolYear')}</p>
                            <p className="text-foreground font-medium">{block.schuljahr}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('calendar.block.trainingYear')}</p>
                            <p className="text-foreground font-medium">{t('calendar.block.yearFormat').replace('{year}', String(block.ausbildungsjahr))}</p>
                        </div>
                    </div>

                    {confirmDelete ? (
                        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 space-y-3">
                            <p className="text-sm text-foreground font-medium">{t('calendar.block.deleteConfirm')}</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setConfirmDelete(false)}
                                    className="flex-1 px-3 py-2 rounded-lg glass-effect text-sm font-medium text-foreground"
                                    disabled={deleting}
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleting}
                                    className="flex-1 px-3 py-2 rounded-lg bg-destructive text-white text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <span className="flex items-center justify-center w-4 h-4">
                                        {deleting ? (
                                            <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                    </span>
                                    {t('common.delete')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setConfirmDelete(true)}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium transition"
                            >
                                <Trash2 className="h-4 w-4" />
                                {t('common.delete')}
                            </button>
                            <button
                                onClick={onClose}
                                className="flex-1 px-4 py-2.5 rounded-xl glass-effect text-foreground font-medium transition hover:bg-muted"
                            >
                                {t('common.close')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Add Block Modal
function AddBlockModal({
    onClose,
    onAdd,
    initialDate
}: {
    onClose: () => void;
    onAdd: (data: Partial<Block>) => void;
    initialDate: Date | null;
}) {
    const { t } = useLanguage();
    const [startDate, setStartDate] = useState(
        initialDate ? `${initialDate.getFullYear()}-${String(initialDate.getMonth() + 1).padStart(2, '0')}-${String(initialDate.getDate()).padStart(2, '0')}` : ''
    );
    const [endDate, setEndDate] = useState(
        initialDate ? `${initialDate.getFullYear()}-${String(initialDate.getMonth() + 1).padStart(2, '0')}-${String(initialDate.getDate()).padStart(2, '0')}` : ''
    );
    const [blockType, setBlockType] = useState<Block['blockType']>('SCHOOL');
    const [blockNumber, setBlockNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [examSubType, setExamSubType] = useState<Block['examSubType']>(null);
    const [description, setDescription] = useState('');
    const [inviteeEmails, setInviteeEmails] = useState('');

    // Exam sub-type options for dropdown
    const EXAM_SUB_TYPES = useMemo(() => [
        { value: 'IHK_ABSCHLUSSPRUEFUNG_T1', label: t('calendar.examSubTypes.ihkT1') },
        { value: 'IHK_ABSCHLUSSPRUEFUNG_T2', label: t('calendar.examSubTypes.ihkT2') },
        { value: 'KLAUSUR_WMC', label: t('calendar.examSubTypes.klausurWmc') },
        { value: 'KLAUSUR_ALLGEMEIN', label: t('calendar.examSubTypes.klausurAllgemein') },
        { value: 'PRAKTISCHE_PRUEFUNG', label: t('calendar.examSubTypes.praktisch') },
        { value: 'MUENDLICHE_PRUEFUNG', label: t('calendar.examSubTypes.muendlich') },
        { value: 'PROJEKTARBEIT', label: t('calendar.examSubTypes.projekt') },
        { value: 'ANDERE', label: t('calendar.examSubTypes.andere') },
    ], [t]);

    // Calculate calendar week from start date
    const getCalendarWeek = (dateStr: string): number => {
        const date = new Date(dateStr);
        const jan4 = new Date(date.getFullYear(), 0, 4);
        const dayDiff = (date.getTime() - jan4.getTime()) / 86400000;
        return Math.ceil((dayDiff + jan4.getDay() + 1) / 7);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!startDate || !endDate) return;

        const start = new Date(startDate);
        const end = new Date(endDate);

        onAdd({
            calendarWeek: getCalendarWeek(startDate),
            year: start.getFullYear(),
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            blockType,
            blockNumber: blockNumber ? parseInt(blockNumber, 10) : null,
            title: null,
            notes: notes || null,
            isPersonal: blockType === 'PERSONAL',
            examSubType: blockType === 'EXAM' ? examSubType : null,
            description: blockType === 'SONSTIGES' ? description : null,
            inviteeEmails: inviteeEmails || null,
        });
    };

    // Filter out PERSONAL and TRAINER_BLOCKER from trainee selection
    // Trainees can only create: SCHOOL, COMPANY, HOLIDAY, EXAM, SONSTIGES
    const availableBlockTypes = Object.entries(BLOCK_CONFIG).filter(
        ([type]) => !['PERSONAL', 'TRAINER_BLOCKER'].includes(type)
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-border">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-foreground">{t('calendar.modal.addBlock')}</h3>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition text-foreground">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">{t('calendar.modal.startDate')}</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">{t('calendar.modal.endDate')}</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">{t('calendar.modal.blockType')}</label>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            {availableBlockTypes.map(([type, config]) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setBlockType(type as Block['blockType'])}
                                    className={`
                                        p-3 rounded-xl flex flex-col items-center gap-1 transition-all border-2
                                        ${blockType === type
                                            ? `${config.lightBg} ${config.border} ${config.text}`
                                            : 'bg-card border-border text-muted-foreground hover:bg-muted'
                                        }
                                    `}
                                >
                                    <config.Icon className="h-5 w-5" />
                                    <span className="text-[10px] font-medium">{t(config.labelKey)}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {blockType === 'SCHOOL' && (
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">{t('calendar.modal.blockNumber')}</label>
                            <input
                                type="number"
                                min="1"
                                value={blockNumber}
                                onChange={(e) => setBlockNumber(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                                placeholder={t('calendar.modal.blockNumberPlaceholder')}
                            />
                        </div>
                    )}

                    {blockType === 'EXAM' && (
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">{t('calendar.modal.examType')}</label>
                            <select
                                value={examSubType || ''}
                                onChange={(e) => setExamSubType(e.target.value as Block['examSubType'])}
                                className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                            >
                                <option value="">{t('calendar.modal.selectPlaceholder')}</option>
                                {EXAM_SUB_TYPES.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {blockType === 'SONSTIGES' && (
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">{t('calendar.modal.descriptionRequired')}</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground min-h-[80px]"
                                placeholder={t('calendar.modal.descriptionPlaceholder')}
                                required={blockType === 'SONSTIGES'}
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">{t('calendar.modal.notesOptional')}</label>
                        <input
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                            placeholder={t('calendar.modal.notesPlaceholder')}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">{t('calendar.modal.inviteLabel')}</label>
                        <input
                            type="text"
                            value={inviteeEmails}
                            onChange={(e) => setInviteeEmails(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                            placeholder={t('calendar.modal.invitePlaceholder')}
                        />
                        <p className="text-xs text-muted-foreground mt-1">{t('calendar.inviteEmails')}</p>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl glass-effect text-foreground font-medium transition"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="submit"
                            className="btn-accent flex-1 px-4 py-3 rounded-xl font-medium transition flex items-center justify-center gap-2"
                        >
                            <Check className="h-4 w-4" />
                            {t('common.add')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}


// Import Blocks Modal
function ImportBlocksModal({
    onClose,
    traineeId,
    onSuccess,
}: {
    onClose: () => void;
    traineeId: string;
    onSuccess: () => void;
}) {
    const { t } = useLanguage();
    const [csvData, setCsvData] = useState('');
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

    const handleImport = async () => {
        if (!csvData.trim()) return;

        setImporting(true);
        setError(null);

        try {
            const lines = csvData.trim().split('\n');
            const headers = lines[0].split(',').map(h => h.trim());
            const data = lines.slice(1).map(line => {
                const values = line.split(',').map(v => v.trim());
                const row: Record<string, string> = {};
                headers.forEach((h, i) => {
                    row[h] = values[i] || '';
                });
                return row;
            });

            const res = await fetch('/api/trainee/school/blocks/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    traineeId,
                    csvData: data,
                    baseYear: new Date().getFullYear(),
                }),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || t('calendar.error.importFailed'));
            }

            setResult(json.result);
            setTimeout(onSuccess, 2000);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-accent/20">
                                <Upload className="h-5 w-5 text-accent" />
                            </div>
                            <h3 className="text-lg font-bold text-foreground">{t('calendar.import.title')}</h3>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition text-foreground">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <div className="p-4 rounded-xl bg-accent/10 border border-accent/20 flex gap-3">
                        <Info className="h-5 w-5 text-accent flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                            <p className="font-medium text-foreground mb-1">{t('calendar.import.formatLabel')}</p>
                            <p className="text-muted-foreground">{t('calendar.import.formatDescription')}</p>
                        </div>
                    </div>

                    <textarea
                        value={csvData}
                        onChange={(e) => setCsvData(e.target.value)}
                        className="w-full h-48 px-4 py-3 rounded-xl font-mono text-sm resize-none"
                        placeholder={`KW,Datum,10IT,11IT,12IT,Anmerkungen
33,10.08. - 14.08.,,5,,1. Schultag
34,17.08. - 21.08.,,5,,
35,24.08. - 28.08.,1,,,`}
                    />

                    {error && (
                        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex gap-3">
                            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                            <p className="text-sm text-destructive">{error}</p>
                        </div>
                    )}

                    {result && (
                        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 flex gap-3">
                            <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                            <p className="text-sm text-green-700 dark:text-green-300">
                                {t('calendar.import.result').replace('{imported}', String(result.imported)).replace('{skipped}', String(result.skipped))}
                            </p>
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl glass-effect text-foreground font-medium transition"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            onClick={handleImport}
                            disabled={importing || !csvData.trim()}
                            className="btn-accent flex-1 px-4 py-3 rounded-xl font-medium transition flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {importing ? (
                                <>
                                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    {t('calendar.import.importing')}
                                </>
                            ) : (
                                <>
                                    <Upload className="h-4 w-4" />
                                    {t('calendar.import.importButton')}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
