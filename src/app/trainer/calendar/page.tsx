'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
    Calendar,
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
} from 'lucide-react';

// Types
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
    examSubType: string | null;
    createdByTrainerId: string | null;
    isPersonal: boolean;
}

interface Trainee {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
}

// Block type configs (same as trainee view)
const BLOCK_CONFIG: Record<string, { label: string; Icon: any; color: string; lightBg: string; border: string; text: string }> = {
    SCHOOL: { label: 'Schule', Icon: School, color: 'bg-accent', lightBg: 'bg-accent/20', border: 'border-accent/50', text: 'text-accent' },
    COMPANY: { label: 'WMC', Icon: Building2, color: 'bg-green-500', lightBg: 'bg-green-500/20', border: 'border-green-500/50', text: 'text-green-600 dark:text-green-400' },
    HOLIDAY: { label: 'Urlaub', Icon: Palmtree, color: 'bg-amber-500', lightBg: 'bg-amber-500/20', border: 'border-amber-500/50', text: 'text-amber-600 dark:text-amber-400' },
    EXAM: { label: 'Prüfung', Icon: FileText, color: 'bg-rose-500', lightBg: 'bg-rose-500/20', border: 'border-rose-500/50', text: 'text-rose-600 dark:text-rose-400' },
    PERSONAL: { label: 'Persönlich', Icon: User, color: 'bg-violet-500', lightBg: 'bg-violet-500/20', border: 'border-violet-500/50', text: 'text-violet-600 dark:text-violet-400' },
    SONSTIGES: { label: 'Sonstiges', Icon: AlertCircle, color: 'bg-slate-500', lightBg: 'bg-slate-500/20', border: 'border-slate-500/50', text: 'text-slate-600 dark:text-slate-400' },
    TRAINER_BLOCKER: { label: 'Trainer', Icon: User, color: 'bg-indigo-500', lightBg: 'bg-indigo-500/20', border: 'border-indigo-500/50', text: 'text-indigo-600 dark:text-indigo-400' },
};

const WEEKDAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Helper functions
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

export default function TrainerCalendarPage() {
    const { profile } = useAuth();
    const [trainees, setTrainees] = useState<Trainee[]>([]);
    const [selectedTraineeId, setSelectedTraineeId] = useState<string>('');
    const [blocks, setBlocks] = useState<Block[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [currentDate] = useState(new Date());
    const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth());
    const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
    const [showAddModal, setShowAddModal] = useState(false);

    // Load trainees
    useEffect(() => {
        if (!profile?.id) return;

        async function loadTrainees() {
            try {
                const res = await fetch(`/api/trainer/trainees?trainerProfileId=${profile.id}`);
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

    // Load blocks for selected trainee
    useEffect(() => {
        if (!selectedTraineeId) {
            setBlocks([]);
            setLoading(false);
            return;
        }

        async function loadBlocks() {
            setLoading(true);
            try {
                const res = await fetch(`/api/trainer/blocks?traineeId=${selectedTraineeId}&year=${selectedYear}`);
                if (res.ok) {
                    const data = await res.json();
                    setBlocks(data.blocks || []);
                }
            } catch (e) {
                console.error('Failed to load blocks:', e);
                setError('Fehler beim Laden der Blöcke');
            } finally {
                setLoading(false);
            }
        }
        loadBlocks();
    }, [selectedTraineeId, selectedYear]);

    // Generate calendar grid
    const calendarDays = (() => {
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

        const nextMonth = selectedMonth === 11 ? 0 : selectedMonth + 1;
        const nextYear = selectedMonth === 11 ? selectedYear + 1 : selectedYear;
        const remainingDays = 42 - days.length;
        for (let day = 1; day <= remainingDays; day++) {
            const date = new Date(nextYear, nextMonth, day);
            days.push({ date, isCurrentMonth: false, isToday: false, blocks: blocks.filter(b => isDateInBlock(date, b)) });
        }

        return days;
    })();

    const handleAddBlock = async (blockData: any) => {
        if (!profile?.id || !selectedTraineeId) return;

        try {
            const res = await fetch('/api/trainer/blocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trainerId: profile.id,
                    traineeId: selectedTraineeId,
                    ...blockData,
                }),
            });

            if (!res.ok) throw new Error('Fehler beim Erstellen');
            const data = await res.json();
            setBlocks(prev => [...prev, data.block]);
            setShowAddModal(false);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const selectedTrainee = trainees.find(t => t.id === selectedTraineeId);

    return (
        <div className="min-h-screen p-4 md:p-6 lg:p-8">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-foreground md:text-3xl flex items-center gap-3">
                    <Calendar className="h-7 w-7 text-accent" />
                    Trainee-Kalender
                </h1>
                <p className="text-muted-foreground mt-1">
                    Verwalte Blockertermine für deine Trainees
                </p>
            </div>

            {/* Trainee Selector */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <select
                        value={selectedTraineeId}
                        onChange={(e) => setSelectedTraineeId(e.target.value)}
                        className="px-4 py-2.5 rounded-xl bg-background border border-border text-foreground min-w-[200px] focus:ring-2 focus:ring-accent/50 outline-none transition-all"
                    >
                        <option value="">Trainee auswählen...</option>
                        {trainees.map(trainee => (
                            <option key={trainee.id} value={trainee.id}>
                                {trainee.firstName} {trainee.lastName}
                            </option>
                        ))}
                    </select>
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
                    {/* Month Navigation */}
                    <div className="flex items-center justify-between p-4 rounded-xl glass-effect mb-4">
                        <button
                            onClick={() => {
                                if (selectedMonth === 0) {
                                    setSelectedMonth(11);
                                    setSelectedYear(y => y - 1);
                                } else {
                                    setSelectedMonth(m => m - 1);
                                }
                            }}
                            className="p-2 rounded-lg hover:bg-muted transition-colors text-foreground"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>

                        <div className="flex items-center gap-4">
                            <h3 className="text-lg font-bold text-foreground min-w-[180px] text-center">
                                {MONTHS_DE[selectedMonth]} {selectedYear}
                            </h3>
                            <button
                                onClick={() => {
                                    setSelectedMonth(currentDate.getMonth());
                                    setSelectedYear(currentDate.getFullYear());
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition"
                            >
                                Heute
                            </button>
                        </div>

                        <button
                            onClick={() => {
                                if (selectedMonth === 11) {
                                    setSelectedMonth(0);
                                    setSelectedYear(y => y + 1);
                                } else {
                                    setSelectedMonth(m => m + 1);
                                }
                            }}
                            className="p-2 rounded-lg hover:bg-muted transition-colors text-foreground"
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </div>

                    {/* Legend */}
                    <div className="flex flex-wrap gap-4 mb-6 p-4 rounded-xl glass-effect">
                        {Object.entries(BLOCK_CONFIG)
                            .filter(([type]) => !['PERSONAL', 'TRAINER_BLOCKER'].includes(type))
                            .map(([type, config]) => (
                                <div key={type} className="flex items-center gap-2">
                                    <div className={`h-3 w-3 rounded-full ${config.color}`} />
                                    <span className="text-sm font-medium text-muted-foreground">{config.label}</span>
                                </div>
                            ))}
                    </div>

                    {/* Calendar Grid */}
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
                        </div>
                    ) : (
                        <div className="rounded-2xl glass-effect overflow-hidden">
                            <div className="grid grid-cols-7 border-b border-border">
                                {WEEKDAYS_DE.map((day, i) => (
                                    <div key={day} className={`py-3 text-center text-sm font-semibold ${i >= 5 ? 'text-muted-foreground' : 'text-foreground'}`}>
                                        {day}
                                    </div>
                                ))}
                            </div>
                            <div className="grid grid-cols-7">
                                {calendarDays.map((dayData, index) => {
                                    const isWeekend = index % 7 >= 5;
                                    const hasBlocks = dayData.blocks.length > 0;
                                    const primaryBlock = dayData.blocks[0];
                                    const config = primaryBlock ? BLOCK_CONFIG[primaryBlock.blockType] : null;

                                    return (
                                        <div
                                            key={index}
                                            className={`
                                                relative min-h-[80px] md:min-h-[100px] p-2 border-b border-r border-border
                                                ${!dayData.isCurrentMonth ? 'opacity-40' : ''}
                                                ${dayData.isToday ? 'bg-accent/5' : ''}
                                                ${isWeekend && dayData.isCurrentMonth ? 'bg-muted/30' : ''}
                                            `}
                                        >
                                            <div className={`
                                                inline-flex items-center justify-center h-7 w-7 rounded-full text-sm font-medium
                                                ${dayData.isToday ? 'bg-accent text-white' : isWeekend ? 'text-muted-foreground' : 'text-foreground'}
                                            `}>
                                                {dayData.date.getDate()}
                                            </div>

                                            {hasBlocks && (
                                                <div className="mt-1 space-y-1">
                                                    {dayData.blocks.slice(0, 2).map((block, bi) => {
                                                        const blockConfig = BLOCK_CONFIG[block.blockType] || BLOCK_CONFIG.PERSONAL;
                                                        return (
                                                            <div
                                                                key={block.id + bi}
                                                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${blockConfig.lightBg} ${blockConfig.text} ${blockConfig.border} border`}
                                                            >
                                                                <blockConfig.Icon className="h-3 w-3 flex-shrink-0" />
                                                                <span className="truncate hidden md:block">{blockConfig.label}</span>
                                                            </div>
                                                        );
                                                    })}
                                                    {dayData.blocks.length > 2 && (
                                                        <div className="text-[10px] text-muted-foreground px-1.5">+{dayData.blocks.length - 2} mehr</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div className="text-center py-16">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-bold text-foreground mb-2">Trainee auswählen</h3>
                    <p className="text-muted-foreground">Wähle einen Trainee aus, um deren Kalender zu sehen.</p>
                </div>
            )}

            {/* Error Display */}
            {error && (
                <div className="mt-4 flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                    <p className="text-sm text-destructive">{error}</p>
                    <button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-destructive/10 rounded">
                        <X className="h-4 w-4 text-destructive" />
                    </button>
                </div>
            )}

            {/* Add Block Modal */}
            {showAddModal && selectedTrainee && (
                <TrainerAddBlockModal
                    traineeName={`${selectedTrainee.firstName || ''} ${selectedTrainee.lastName || ''}`.trim()}
                    onClose={() => setShowAddModal(false)}
                    onAdd={handleAddBlock}
                    trainees={trainees}
                    initialTraineeId={selectedTraineeId}
                />
            )}
        </div>
    );
}

// Trainer Add Block Modal
function TrainerAddBlockModal({
    traineeName,
    onClose,
    onAdd,
    trainees,
    initialTraineeId,
}: {
    traineeName: string;
    onClose: () => void;
    onAdd: (data: any) => void;
    trainees: Trainee[];
    initialTraineeId: string;
}) {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [blockType, setBlockType] = useState('TRAINER_BLOCKER');
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [description, setDescription] = useState('');
    const [sendInvitation, setSendInvitation] = useState(true);

    // Multi-select state
    const [selectedTraineeIds, setSelectedTraineeIds] = useState<string[]>([initialTraineeId]);
    const [selectionMode, setSelectionMode] = useState<'single' | 'all' | 'custom'>('single');

    const handleTraineeToggle = (id: string) => {
        setSelectedTraineeIds(prev =>
            prev.includes(id) ? prev.filter(tid => tid !== id) : [...prev, id]
        );
    };

    const handleSelectionModeChange = (mode: 'single' | 'all' | 'custom') => {
        setSelectionMode(mode);
        if (mode === 'single') {
            setSelectedTraineeIds([initialTraineeId]);
        } else if (mode === 'all') {
            setSelectedTraineeIds(trainees.map(t => t.id));
        } else {
            // keep current selection or default to initial
            if (selectedTraineeIds.length === 0) setSelectedTraineeIds([initialTraineeId]);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!startDate || !endDate) return;
        if (selectedTraineeIds.length === 0) {
            alert('Bitte mindestens einen Trainee auswählen');
            return;
        }

        onAdd({
            startDate: new Date(startDate).toISOString(),
            endDate: new Date(endDate).toISOString(),
            blockType,
            title: title || null,
            notes: notes || null,
            description: description || null,
            sendInvitation,
            traineeIds: selectedTraineeIds, // Send all IDs
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
                                {selectionMode === 'single' ? `Für ${traineeName}` :
                                    selectionMode === 'all' ? 'Für alle Trainees' :
                                        `Für ${selectedTraineeIds.length} Trainees`}
                            </p>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition text-foreground">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Trainee Selection */}
                    <div className="space-y-3 p-4 rounded-xl bg-muted/30 border border-border">
                        <label className="block text-sm font-medium text-foreground">Empfänger</label>
                        <div className="flex bg-muted rounded-lg p-1">
                            <button
                                type="button"
                                onClick={() => handleSelectionModeChange('single')}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${selectionMode === 'single' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Nur {traineeName.split(' ')[0]}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSelectionModeChange('custom')}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${selectionMode === 'custom' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Auswählen
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSelectionModeChange('all')}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${selectionMode === 'all' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Alle ({trainees.length})
                            </button>
                        </div>

                        {selectionMode === 'custom' && (
                            <div className="max-h-40 overflow-y-auto space-y-1 p-2 bg-background rounded-lg border border-border">
                                {trainees.map(t => (
                                    <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedTraineeIds.includes(t.id)}
                                            onChange={() => handleTraineeToggle(t.id)}
                                            className="rounded border-border text-accent focus:ring-accent"
                                        />
                                        <span className="text-sm text-foreground truncate">{t.firstName} {t.lastName}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">Startdatum</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">Enddatum</label>
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
                        <label className="block text-sm font-medium text-foreground mb-2">Titel</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                            placeholder="z.B. Besprechung, Schulung..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">Beschreibung</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground min-h-[80px]"
                            placeholder="Details zum Termin..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">Notizen (optional)</label>
                        <input
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground"
                            placeholder="Interne Notizen..."
                        />
                    </div>

                    <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50 border border-border">
                        <input
                            type="checkbox"
                            id="sendInvitation"
                            checked={sendInvitation}
                            onChange={(e) => setSendInvitation(e.target.checked)}
                            className="h-4 w-4 rounded border-border text-accent"
                        />
                        <label htmlFor="sendInvitation" className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                            <Send className="h-4 w-4 text-muted-foreground" />
                            Kalendereinladung an Trainee(s) senden
                        </label>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl glass-effect text-foreground font-medium transition"
                        >
                            Abbrechen
                        </button>
                        <button
                            type="submit"
                            className="btn-accent flex-1 px-4 py-3 rounded-xl font-medium transition flex items-center justify-center gap-2"
                        >
                            <Check className="h-4 w-4" />
                            Erstellen
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
