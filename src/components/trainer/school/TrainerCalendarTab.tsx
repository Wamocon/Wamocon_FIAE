'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
    ChevronLeft,
    ChevronRight,
    Plus,
    School,
    Building2,
    Palmtree,
    FileText,
    User,
    X,
    Check,
    AlertCircle,
    Users,
    Send,
    Trash2,
    Edit3,
    Clock,
} from 'lucide-react';

interface Block {
    id: string;
    calendarWeek: number;
    year: number;
    startDate: string;
    endDate: string;
    blockType: string;
    blockNumber: number | null;
    title: string | null;
    notes: string | null;
    description: string | null;
    createdByTrainerId: string | null;
    isPersonal: boolean;
}

interface Trainee {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
}

const BLOCK_CONFIG: Record<string, { label: string; Icon: any; color: string; lightBg: string; border: string; text: string }> = {
    SCHOOL: { label: 'Schule', Icon: School, color: 'bg-accent', lightBg: 'bg-accent/20', border: 'border-accent/50', text: 'text-accent' },
    COMPANY: { label: 'WMC', Icon: Building2, color: 'bg-green-500', lightBg: 'bg-green-500/20', border: 'border-green-500/50', text: 'text-green-600 dark:text-green-400' },
    HOLIDAY: { label: 'Urlaub', Icon: Palmtree, color: 'bg-amber-500', lightBg: 'bg-amber-500/20', border: 'border-amber-500/50', text: 'text-amber-600 dark:text-amber-400' },
    EXAM: { label: 'Prüfung', Icon: FileText, color: 'bg-rose-500', lightBg: 'bg-rose-500/20', border: 'border-rose-500/50', text: 'text-rose-600 dark:text-rose-400' },
    TRAINER_BLOCKER: { label: 'Trainer', Icon: User, color: 'bg-indigo-500', lightBg: 'bg-indigo-500/20', border: 'border-indigo-500/50', text: 'text-indigo-600 dark:text-indigo-400' },
};

const WEEKDAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1;
}

function isDateInBlock(date: Date, block: Block): boolean {
    const start = new Date(block.startDate);
    const end = new Date(block.endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return date >= start && date <= end;
}

export function TrainerCalendarTab() {
    const { profile } = useAuth();
    const { t } = useLanguage();
    const [trainees, setTrainees] = useState<Trainee[]>([]);
    const [selectedTraineeId, setSelectedTraineeId] = useState<string>('');
    const [blocks, setBlocks] = useState<Block[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [currentDate] = useState(new Date());
    const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth());
    const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
    const [editingBlock, setEditingBlock] = useState<Block | null>(null);

    useEffect(() => {
        if (!profile?.id) return;
        async function loadTrainees() {
            try {
                const res = await fetch(`/api/trainer/trainees?trainerProfileId=${profile?.id}`, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    setTrainees(data.trainees || []);
                    if (data.trainees?.length > 0) {
                        setSelectedTraineeId(data.trainees[0].id);
                    }
                }
            } catch (e) {
                console.error('Failed to load trainees:', e);
            }
        }
        loadTrainees();
    }, [profile?.id]);

    const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
    const [selectedWeek, setSelectedWeek] = useState<Date>(new Date());

    useEffect(() => {
        // Initialize selected week to current week start
        const now = new Date();
        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        setSelectedWeek(d);
    }, []);

    useEffect(() => {
        if (!selectedTraineeId) {
            setBlocks([]);
            setLoading(false);
            return;
        }
        async function loadBlocks() {
            setLoading(true);
            try {
                const res = await fetch(`/api/trainer/blocks?traineeId=${selectedTraineeId}&year=${selectedYear}`, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    setBlocks(data.blocks || []);
                }
            } catch (e) {
                setError(t('calendar.error.loadBlocks'));
            } finally {
                setLoading(false);
            }
        }
        loadBlocks();
    }, [selectedTraineeId, selectedYear]);

    // Calendar Days (Month View)
    const calendarDays = useMemo(() => {
        if (viewMode !== 'month') return [];

        const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
        const firstDay = getFirstDayOfMonth(selectedYear, selectedMonth);
        const prevMonth = selectedMonth === 0 ? 11 : selectedMonth - 1;
        const prevYear = selectedMonth === 0 ? selectedYear - 1 : selectedYear;
        const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

        const days: { date: Date; isCurrentMonth: boolean; isToday: boolean; blocks: Block[] }[] = [];

        for (let i = firstDay - 1; i >= 0; i--) {
            const day = daysInPrevMonth - i;
            const date = new Date(prevYear, prevMonth, day);
            days.push({ date, isCurrentMonth: false, isToday: false, blocks: blocks.filter(b => isDateInBlock(date, b)) });
        }

        const today = new Date();
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(selectedYear, selectedMonth, day);
            const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
            days.push({ date, isCurrentMonth: true, isToday, blocks: blocks.filter(b => isDateInBlock(date, b)) });
        }

        const remainingDays = 42 - days.length;
        const nextMonth = selectedMonth === 11 ? 0 : selectedMonth + 1;
        const nextYear = selectedMonth === 11 ? selectedYear + 1 : selectedYear;
        for (let day = 1; day <= remainingDays; day++) {
            const date = new Date(nextYear, nextMonth, day);
            days.push({ date, isCurrentMonth: false, isToday: false, blocks: blocks.filter(b => isDateInBlock(date, b)) });
        }

        return days;
    }, [selectedYear, selectedMonth, blocks, viewMode]);

    // Week Days (Week View)
    const weekDays = useMemo(() => {
        if (viewMode !== 'week' || !selectedWeek) return [];
        const days: { date: Date; isToday: boolean; blocks: Block[] }[] = [];
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
                blocks: blocks.filter(b => isDateInBlock(date, b))
            });
        }
        return days;
    }, [selectedWeek, blocks, viewMode]);

    // Navigation Logic
    const goToPrev = () => {
        if (viewMode === 'month') {
            if (selectedMonth === 0) {
                setSelectedMonth(11);
                setSelectedYear(y => y - 1);
            } else {
                setSelectedMonth(m => m - 1);
            }
        } else {
            const newDate = new Date(selectedWeek);
            newDate.setDate(selectedWeek.getDate() - 7);
            setSelectedWeek(newDate);
            if (newDate.getMonth() !== selectedMonth) {
                setSelectedMonth(newDate.getMonth());
                setSelectedYear(newDate.getFullYear());
            }
        }
    };

    const goToNext = () => {
        if (viewMode === 'month') {
            if (selectedMonth === 11) {
                setSelectedMonth(0);
                setSelectedYear(y => y + 1);
            } else {
                setSelectedMonth(m => m + 1);
            }
        } else {
            const newDate = new Date(selectedWeek);
            newDate.setDate(selectedWeek.getDate() + 7);
            setSelectedWeek(newDate);
            if (newDate.getMonth() !== selectedMonth) {
                setSelectedMonth(newDate.getMonth());
                setSelectedYear(newDate.getFullYear());
            }
        }
    };

    const goToToday = () => {
        const now = new Date();
        setSelectedMonth(now.getMonth());
        setSelectedYear(now.getFullYear());

        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        setSelectedWeek(d);
    };

    const handleMoreClick = (date: Date, e: React.MouseEvent) => {
        e.stopPropagation();
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        setSelectedWeek(d);
        setViewMode('week');
    };

    const handleAddBlock = async (blockData: any) => {
        if (!profile?.id) return;
        try {
            const res = await fetch('/api/trainer/blocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trainerId: profile.id,
                    traineeIds: blockData.traineeIds || [selectedTraineeId],
                    ...blockData,
                }),
            });

            if (!res.ok) throw new Error(t('calendar.error.addBlock'));
            const data = await res.json();
            if (Array.isArray(data.blocks)) {
                setBlocks(prev => [...prev, ...data.blocks]);
            } else if (data.block) {
                setBlocks(prev => [...prev, data.block]);
            }
            setShowAddModal(false);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleDeleteBlock = async (blockId: string) => {
        try {
            const res = await fetch(`/api/trainer/blocks/${blockId}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error(t('calendar.error.deleteBlock'));
            setBlocks(prev => prev.filter(b => b.id !== blockId));
            setSelectedBlock(null);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleUpdateBlock = async (blockId: string, updates: Partial<Block>) => {
        try {
            const res = await fetch(`/api/trainer/blocks/${blockId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            if (!res.ok) throw new Error(t('calendar.error.updateBlock'));
            const data = await res.json();
            setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, ...data.block } : b));
            setEditingBlock(null);
            setSelectedBlock(null);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const selectedTrainee = trainees.find(t => t.id === selectedTraineeId);

    return (
        <div className="space-y-6">
            {/* Trainee Selector & Header Controls */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <select
                        value={selectedTraineeId}
                        onChange={(e) => setSelectedTraineeId(e.target.value)}
                        className="px-4 py-2.5 rounded-xl bg-background border border-border text-foreground min-w-[200px] focus:ring-2 focus:ring-accent/50 outline-none [&_option]:bg-card [&_option]:text-foreground"
                    >
                        <option value="" className="bg-card text-foreground">Trainee auswählen...</option>
                        {trainees.map(trainee => (
                            <option key={trainee.id} value={trainee.id} className="bg-card text-foreground">
                                {trainee.email ? trainee.email.split('@')[0].split('.').join(' ') : 'Unbekannt'}
                            </option>
                        ))}
                    </select>

                    {selectedTraineeId && (
                        <div className="flex bg-muted rounded-xl p-1 border border-border ml-2">
                            <button
                                onClick={() => setViewMode('month')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'month' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Monat
                            </button>
                            <button
                                onClick={() => setViewMode('week')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'week' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Woche
                            </button>
                        </div>
                    )}
                </div>

                {selectedTraineeId && (
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="btn-accent flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        Blocker erstellen
                    </button>
                )}
            </div>

            {selectedTraineeId ? (
                <>
                    {/* Navigation Bar */}
                    <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30">
                        <button
                            onClick={goToPrev}
                            className="p-2 rounded-lg hover:bg-muted transition-colors"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>

                        <div className="flex items-center gap-4">
                            <h3 className="text-lg font-bold text-foreground min-w-[200px] text-center">
                                {viewMode === 'month'
                                    ? `${MONTHS_DE[selectedMonth]} ${selectedYear}`
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
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20"
                            >
                                Heute
                            </button>
                        </div>

                        <button
                            onClick={goToNext}
                            className="p-2 rounded-lg hover:bg-muted transition-colors"
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </div>

                    {/* Legend - Only show in Month view */}
                    {viewMode === 'month' && (
                        <div className="flex flex-wrap gap-4 p-3 rounded-xl bg-muted/20">
                            {Object.entries(BLOCK_CONFIG).map(([type, config]) => (
                                <div key={type} className="flex items-center gap-2">
                                    <div className={`h-3 w-3 rounded-full ${config.color}`} />
                                    <span className="text-xs font-medium text-muted-foreground">{config.label}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Calendar Grid */}
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
                        </div>
                    ) : (
                        <div className="rounded-xl overflow-hidden border border-border">
                            <div className="grid grid-cols-7 border-b border-border bg-muted/30">
                                {WEEKDAYS_DE.map((day, i) => (
                                    <div key={day} className={`py-3 text-center text-sm font-semibold ${i >= 5 ? 'text-muted-foreground' : 'text-foreground'}`}>
                                        {day}
                                    </div>
                                ))}
                            </div>
                            <div className="grid grid-cols-7">
                                {viewMode === 'month'
                                    ? calendarDays.map((dayData, index) => {
                                        const isWeekend = index % 7 >= 5;
                                        const hasBlocks = dayData.blocks.length > 0;
                                        return (
                                            <div
                                                key={index}
                                                className={`relative min-h-[80px] p-2 border-b border-r border-border ${!dayData.isCurrentMonth ? 'opacity-40' : ''} ${dayData.isToday ? 'bg-accent/5' : ''} ${isWeekend && dayData.isCurrentMonth ? 'bg-muted/30' : ''}`}
                                            >
                                                <div className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-sm font-medium ${dayData.isToday ? 'bg-accent text-accent-foreground' : isWeekend ? 'text-muted-foreground' : 'text-foreground'}`}>
                                                    {dayData.date.getDate()}
                                                </div>
                                                {hasBlocks && (
                                                    <div className="mt-1 space-y-1">
                                                        {dayData.blocks.slice(0, 2).map((block, bi) => {
                                                            const blockConfig = BLOCK_CONFIG[block.blockType] || BLOCK_CONFIG.TRAINER_BLOCKER;
                                                            return (
                                                                <button
                                                                    key={block.id + bi}
                                                                    onClick={() => setSelectedBlock(block)}
                                                                    className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${blockConfig.lightBg} ${blockConfig.text} ${blockConfig.border} border hover:opacity-80 transition-opacity cursor-pointer text-left`}
                                                                >
                                                                    <blockConfig.Icon className="h-3 w-3 flex-shrink-0" />
                                                                    <span className="truncate hidden md:block">
                                                                        {block.title || block.description || blockConfig.label}
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                        {dayData.blocks.length > 2 && (
                                                            <div
                                                                role="button"
                                                                onClick={(e) => handleMoreClick(dayData.date, e)}
                                                                className="text-[10px] text-muted-foreground px-1.5 hover:text-foreground hover:underline cursor-pointer"
                                                            >
                                                                +{dayData.blocks.length - 2} mehr
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
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
                                                <div className="flex flex-col items-center mb-4 pb-2 border-b border-border/50">
                                                    <span className="text-2xl font-bold">{dayData.date.getDate()}</span>
                                                </div>

                                                <div className="space-y-2">
                                                    {dayData.blocks.map((block, bi) => {
                                                        const blockConfig = BLOCK_CONFIG[block.blockType] || BLOCK_CONFIG.TRAINER_BLOCKER;
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
                                                                        {block.title || blockConfig.label}
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
                                                </div>
                                            </div>
                                        );
                                    })
                                }
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div className="text-center py-16">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-bold text-foreground mb-2">{t('trainee.management.title')}</h3>
                    <p className="text-muted-foreground">{t('calendar.selectTrainee')}</p>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <p className="text-sm text-destructive">{error}</p>
                    <button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-destructive/10 rounded">
                        <X className="h-4 w-4 text-destructive" />
                    </button>
                </div>
            )}

            {showAddModal && selectedTrainee && (
                <AddBlockerModal
                    trainees={trainees}
                    initialTraineeId={selectedTraineeId}
                    onClose={() => setShowAddModal(false)}
                    onAdd={handleAddBlock}
                />
            )}

            {selectedBlock && (
                <BlockDetailModal
                    block={selectedBlock}
                    trainerId={profile?.id || ''}
                    onClose={() => setSelectedBlock(null)}
                    onDelete={handleDeleteBlock}
                    onEdit={(block) => {
                        setEditingBlock(block);
                        setSelectedBlock(null);
                    }}
                />
            )}

            {editingBlock && (
                <EditBlockModal
                    block={editingBlock}
                    onClose={() => setEditingBlock(null)}
                    onSave={(updates) => handleUpdateBlock(editingBlock.id, updates)}
                />
            )}
        </div>
    );
}

function AddBlockerModal({ trainees, initialTraineeId, onClose, onAdd }: {
    trainees: Trainee[];
    initialTraineeId: string;
    onClose: () => void;
    onAdd: (data: any) => void;
}) {
    const { t } = useLanguage();
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [sendInvitation, setSendInvitation] = useState(true);
    const [selectedTraineeIds, setSelectedTraineeIds] = useState<string[]>([initialTraineeId]);
    const [selectionMode, setSelectionMode] = useState<'single' | 'all' | 'custom'>('single');

    const handleSelectionModeChange = (mode: 'single' | 'all' | 'custom') => {
        setSelectionMode(mode);
        if (mode === 'single') setSelectedTraineeIds([initialTraineeId]);
        else if (mode === 'all') setSelectedTraineeIds(trainees.map(t => t.id));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!startDate || !endDate || selectedTraineeIds.length === 0) return;
        onAdd({
            startDate: new Date(startDate).toISOString(),
            endDate: new Date(endDate).toISOString(),
            blockType: 'TRAINER_BLOCKER',
            title: title || null,
            description: description || null,
            sendInvitation,
            traineeIds: selectedTraineeIds,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-border bg-indigo-500/10">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-foreground">Blocker erstellen</h3>
                            <p className="text-sm text-muted-foreground">
                                {selectionMode === 'all' ? `Für alle ${trainees.length} Trainees` : `Für ${selectedTraineeIds.length} Trainee(s)`}
                            </p>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div className="space-y-3 p-4 rounded-xl bg-muted/30 border border-border">
                        <label className="block text-sm font-medium">Empfänger</label>
                        <div className="flex bg-muted rounded-lg p-1">
                            {(['single', 'custom', 'all'] as const).map(mode => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => handleSelectionModeChange(mode)}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${selectionMode === mode ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
                                >
                                    {mode === 'single' ? 'Einzeln' : mode === 'all' ? `Alle (${trainees.length})` : 'Auswählen'}
                                </button>
                            ))}
                        </div>
                        {selectionMode === 'custom' && (
                            <div className="max-h-40 overflow-y-auto space-y-1 p-2 bg-background rounded-lg border">
                                {trainees.map(t => (
                                    <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedTraineeIds.includes(t.id)}
                                            onChange={() => setSelectedTraineeIds(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id])}
                                            className="rounded border-border text-accent"
                                        />
                                        <span className="text-sm">{t.firstName} {t.lastName}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-2">Start</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Ende</label>
                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border" required />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Titel</label>
                        <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border" placeholder="z.B. Besprechung..." />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Beschreibung</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border min-h-[80px]" placeholder="Details..." />
                    </div>

                    <label className="flex items-center gap-3 p-4 rounded-xl bg-muted/50 border cursor-pointer">
                        <input type="checkbox" checked={sendInvitation} onChange={e => setSendInvitation(e.target.checked)} className="h-4 w-4 rounded text-accent" />
                        <Send className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{t('calendar.sendInvite')}</span>
                    </label>

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-3 rounded-xl glass-effect font-medium">{t('common.cancel')}</button>
                        <button type="submit" className="btn-accent flex-1 px-4 py-3 rounded-xl font-medium flex items-center justify-center gap-2">
                            <Check className="h-4 w-4" />{t('common.create')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// Block Detail Modal - Shows block details and allows edit/delete for trainer-created blocks
function BlockDetailModal({
    block,
    trainerId,
    onClose,
    onDelete,
    onEdit
}: {
    block: Block;
    trainerId: string;
    onClose: () => void;
    onDelete: (blockId: string) => void;
    onEdit: (block: Block) => void;
}) {
    const { t } = useLanguage();
    const config = BLOCK_CONFIG[block.blockType] || BLOCK_CONFIG.TRAINER_BLOCKER;
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Check if this block was created by the current trainer
    const canEditDelete = block.blockType === 'TRAINER_BLOCKER' && block.createdByTrainerId === trainerId;

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('de-DE', {
            weekday: 'short',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });
    };

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit'
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
                {/* Header */}
                <div className={`p-6 ${config.lightBg}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-3 rounded-xl ${config.lightBg} border ${config.border}`}>
                                <config.Icon className={`h-6 w-6 ${config.text}`} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-foreground">
                                    {block.title || config.label}
                                </h3>
                                <p className="text-sm text-muted-foreground">{config.label}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition text-foreground">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* Time Range */}
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Zeitraum
                        </p>
                        <p className="text-foreground font-medium">{formatDate(block.startDate)}</p>
                        <p className="text-foreground">bis {formatDate(block.endDate)}</p>
                    </div>

                    {/* Description */}
                    {block.description && (
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Beschreibung</p>
                            <p className="text-foreground">{block.description}</p>
                        </div>
                    )}

                    {/* Notes */}
                    {block.notes && (
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notizen</p>
                            <p className="text-foreground">{block.notes}</p>
                        </div>
                    )}

                    {/* Block Type Info */}
                    {block.blockNumber && (
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Block-Nummer</p>
                            <p className="text-foreground font-medium">{block.blockNumber}</p>
                        </div>
                    )}

                    {/* Actions */}
                    {confirmDelete ? (
                        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 space-y-3">
                            <p className="text-sm text-foreground font-medium">{t('exams.deleteConfirm')}</p>
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
                                    <span className="inline-flex items-center justify-center h-4 w-4">
                                        {deleting ? (
                                            <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
                            {canEditDelete && (
                                <button
                                    onClick={() => onEdit(block)}
                                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent font-medium transition"
                                >
                                    <Edit3 className="h-4 w-4" />
                                    {t('common.edit')}
                                </button>
                            )}
                            {canEditDelete && (
                                <button
                                    onClick={() => setConfirmDelete(true)}
                                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium transition"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    {t('common.delete')}
                                </button>
                            )}
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

// Edit Block Modal - Allows editing block title and description
function EditBlockModal({
    block,
    onClose,
    onSave
}: {
    block: Block;
    onClose: () => void;
    onSave: (updates: Partial<Block>) => void;
}) {
    const { t } = useLanguage();
    const [title, setTitle] = useState(block.title || '');
    const [description, setDescription] = useState(block.description || '');
    const [startDate, setStartDate] = useState(block.startDate.split('T')[0]);
    const [endDate, setEndDate] = useState(block.endDate.split('T')[0]);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        await onSave({
            title: title || null,
            description: description || null,
            startDate: new Date(startDate).toISOString(),
            endDate: new Date(endDate).toISOString(),
        });
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-border bg-accent/10">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Edit3 className="h-5 w-5 text-accent" />
                            <h3 className="text-lg font-bold text-foreground">Block bearbeiten</h3>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-2">Start</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-muted border border-border"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Ende</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-muted border border-border"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Titel</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border"
                            placeholder="z.B. Besprechung..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Beschreibung</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border min-h-[100px]"
                            placeholder="Details zum Termin..."
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl glass-effect font-medium"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="btn-accent flex-1 px-4 py-3 rounded-xl font-medium flex items-center justify-center gap-2"
                        >
                            {saving ? (
                                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Check className="h-4 w-4" />
                            )}
                            {t('common.save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

