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
  examSubType?:
    | 'IHK_ABSCHLUSSPRUEFUNG_T1'
    | 'IHK_ABSCHLUSSPRUEFUNG_T2'
    | 'KLAUSUR_WMC'
    | 'KLAUSUR_ALLGEMEIN'
    | 'PRAKTISCHE_PRUEFUNG'
    | 'MUENDLICHE_PRUEFUNG'
    | 'PROJEKTARBEIT'
    | 'ANDERE'
    | null;
}

interface Trainee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

const BLOCK_CONFIG: Record<
  string,
  {
    label: string;
    Icon: any;
    color: string;
    lightBg: string;
    border: string;
    text: string;
  }
> = {
  SCHOOL: {
    label: 'Schule',
    Icon: School,
    color: 'bg-accent',
    lightBg: 'bg-accent/20',
    border: 'border-accent/50',
    text: 'text-accent',
  },
  COMPANY: {
    label: 'WMC',
    Icon: Building2,
    color: 'bg-green-500',
    lightBg: 'bg-green-500/20',
    border: 'border-green-500/50',
    text: 'text-green-600 dark:text-green-400',
  },
  HOLIDAY: {
    label: 'Urlaub',
    Icon: Palmtree,
    color: 'bg-amber-500',
    lightBg: 'bg-amber-500/20',
    border: 'border-amber-500/50',
    text: 'text-amber-600 dark:text-amber-400',
  },
  EXAM: {
    label: 'Prüfung',
    Icon: FileText,
    color: 'bg-rose-500',
    lightBg: 'bg-rose-500/20',
    border: 'border-rose-500/50',
    text: 'text-rose-600 dark:text-rose-400',
  },
  TRAINER_BLOCKER: {
    label: 'Trainer',
    Icon: User,
    color: 'bg-indigo-500',
    lightBg: 'bg-indigo-500/20',
    border: 'border-indigo-500/50',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
};

const EXAM_SUBTYPE_LABELS: Record<string, string> = {
  IHK_ABSCHLUSSPRUEFUNG_T1: 'IHK Abschlussprüfung Teil 1',
  IHK_ABSCHLUSSPRUEFUNG_T2: 'IHK Abschlussprüfung Teil 2',
  KLAUSUR_WMC: 'Klausur WMC',
  KLAUSUR_ALLGEMEIN: 'Klausur (Allgemein)',
  PRAKTISCHE_PRUEFUNG: 'Praktische Prüfung',
  MUENDLICHE_PRUEFUNG: 'Mündliche Prüfung',
  PROJEKTARBEIT: 'Projektarbeit',
  ANDERE: 'Andere Prüfung',
};

const WEEKDAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

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
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    async function loadTrainees() {
      try {
        const res = await fetch(
          `/api/trainer/trainees?trainerProfileId=${profile?.id}`,
          { cache: 'no-store' }
        );
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
        const res = await fetch(
          `/api/trainer/blocks?traineeId=${selectedTraineeId}&year=${selectedYear}`,
          { cache: 'no-store' }
        );
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

    const days: {
      date: Date;
      isCurrentMonth: boolean;
      isToday: boolean;
      blocks: Block[];
    }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const date = new Date(prevYear, prevMonth, day);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        blocks: blocks
          .filter(b => isDateInBlock(date, b))
          .sort(
            (a, b) =>
              new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
          ),
      });
    }

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
        blocks: blocks
          .filter(b => isDateInBlock(date, b))
          .sort(
            (a, b) =>
              new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
          ),
      });
    }

    const remainingDays = 42 - days.length;
    const nextMonth = selectedMonth === 11 ? 0 : selectedMonth + 1;
    const nextYear = selectedMonth === 11 ? selectedYear + 1 : selectedYear;
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(nextYear, nextMonth, day);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        blocks: blocks
          .filter(b => isDateInBlock(date, b))
          .sort(
            (a, b) =>
              new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
          ),
      });
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
        blocks: blocks
          .filter(b => isDateInBlock(date, b))
          .sort(
            (a, b) =>
              new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
          ),
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

  const handleUpdateBlock = async (
    blockId: string,
    updates: Partial<Block>
  ) => {
    try {
      const res = await fetch(`/api/trainer/blocks/${blockId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(t('calendar.error.updateBlock'));
      const data = await res.json();
      setBlocks(prev =>
        prev.map(b => (b.id === blockId ? { ...b, ...data.block } : b))
      );
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
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Users className="text-muted-foreground h-5 w-5" />
          <select
            value={selectedTraineeId}
            onChange={e => setSelectedTraineeId(e.target.value)}
            className="bg-background border-border text-foreground focus:ring-accent/50 [&_option]:bg-card [&_option]:text-foreground min-w-[200px] rounded-xl border px-4 py-2.5 outline-none focus:ring-2"
          >
            <option value="" className="bg-card text-foreground">
              Trainee auswählen...
            </option>
            {trainees.map(trainee => (
              <option
                key={trainee.id}
                value={trainee.id}
                className="bg-card text-foreground"
              >
                {trainee.email
                  ? trainee.email.split('@')[0].split('.').join(' ')
                  : 'Unbekannt'}
              </option>
            ))}
          </select>

          {selectedTraineeId && (
            <div className="bg-muted border-border ml-2 flex rounded-xl border p-1">
              <button
                onClick={() => setViewMode('month')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${viewMode === 'month' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Monat
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${viewMode === 'week' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Woche
              </button>
            </div>
          )}
        </div>

        {selectedTraineeId && (
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-accent flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Blocker erstellen
          </button>
        )}
      </div>

      {selectedTraineeId ? (
        <>
          {/* Navigation Bar */}
          <div className="bg-muted/30 flex items-center justify-between rounded-xl p-4">
            <button
              onClick={goToPrev}
              className="hover:bg-muted rounded-lg p-2 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-4">
              <h3 className="text-foreground min-w-[200px] text-center text-lg font-bold">
                {viewMode === 'month'
                  ? `${MONTHS_DE[selectedMonth]} ${selectedYear}`
                  : `KW ${
                      selectedWeek
                        ? (() => {
                            const d = new Date(
                              Date.UTC(
                                selectedWeek.getFullYear(),
                                selectedWeek.getMonth(),
                                selectedWeek.getDate()
                              )
                            );
                            const dayNum = d.getUTCDay() || 7;
                            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
                            const yearStart = new Date(
                              Date.UTC(d.getUTCFullYear(), 0, 1)
                            );
                            return Math.ceil(
                              ((d.getTime() - yearStart.getTime()) / 86400000 +
                                1) /
                                7
                            );
                          })()
                        : ''
                    } • ${selectedWeek?.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`}
              </h3>
              <button
                onClick={goToToday}
                className="bg-accent/10 text-accent hover:bg-accent/20 rounded-lg px-3 py-1.5 text-xs font-medium"
              >
                Heute
              </button>
            </div>

            <button
              onClick={goToNext}
              className="hover:bg-muted rounded-lg p-2 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Legend - Only show in Month view */}
          {viewMode === 'month' && (
            <div className="bg-muted/20 flex flex-wrap gap-4 rounded-xl p-3">
              {Object.entries(BLOCK_CONFIG).map(([type, config]) => (
                <div key={type} className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${config.color}`} />
                  <span className="text-muted-foreground text-xs font-medium">
                    {config.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Calendar Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="border-accent/30 border-t-accent h-10 w-10 animate-spin rounded-full border-4" />
            </div>
          ) : (
            <div className="border-border overflow-hidden rounded-xl border">
              <div className="border-border bg-muted/30 grid grid-cols-7 border-b">
                {WEEKDAYS_DE.map((day, i) => (
                  <div
                    key={day}
                    className={`py-3 text-center text-sm font-semibold ${i >= 5 ? 'text-muted-foreground' : 'text-foreground'}`}
                  >
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
                          onClick={() => {
                            setSelectedDate(dayData.date);
                            setShowAddModal(true);
                          }}
                          className={`border-border hover:bg-muted/30 relative h-[120px] cursor-pointer overflow-hidden border-r border-b p-1.5 transition-all ${!dayData.isCurrentMonth ? 'opacity-40' : ''} ${dayData.isToday ? 'bg-accent/5' : ''} ${isWeekend && dayData.isCurrentMonth ? 'bg-muted/30' : ''}`}
                        >
                          <div
                            className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${dayData.isToday ? 'bg-accent text-accent-foreground' : isWeekend ? 'text-muted-foreground' : 'text-foreground font-semibold'}`}
                          >
                            {dayData.date.getDate()}
                          </div>
                          {hasBlocks && (
                            <div className="mt-1 space-y-1">
                              {dayData.blocks.slice(0, 2).map((block, bi) => {
                                const blockConfig =
                                  BLOCK_CONFIG[block.blockType] ||
                                  BLOCK_CONFIG.TRAINER_BLOCKER;
                                return (
                                  <button
                                    key={block.id + bi}
                                    onClick={e => {
                                      e.stopPropagation();
                                      setSelectedBlock(block);
                                    }}
                                    className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${blockConfig.lightBg} ${blockConfig.text} ${blockConfig.border} border text-left transition-all hover:brightness-95`}
                                  >
                                    <blockConfig.Icon className="h-3 w-3 flex-shrink-0" />
                                    <span className="hidden truncate md:block">
                                      {new Date(
                                        block.startDate
                                      ).toLocaleTimeString('de-DE', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}{' '}
                                      {block.title ||
                                        (block.blockType === 'EXAM' &&
                                        block.examSubType
                                          ? EXAM_SUBTYPE_LABELS[
                                              block.examSubType
                                            ]
                                          : block.description ||
                                            blockConfig.label)}
                                    </span>
                                  </button>
                                );
                              })}
                              {dayData.blocks.length > 2 && (
                                <div
                                  role="button"
                                  onClick={e =>
                                    handleMoreClick(dayData.date, e)
                                  }
                                  className="text-muted-foreground hover:text-foreground cursor-pointer px-1.5 text-[10px] hover:underline"
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
                          className={`border-border relative min-h-[400px] border-r p-2 ${dayData.isToday ? 'bg-accent/5' : ''} ${isWeekend ? 'bg-muted/30' : ''} `}
                        >
                          <div className="border-border/50 mb-4 flex flex-col items-center border-b pb-2">
                            <span className="text-2xl font-bold">
                              {dayData.date.getDate()}
                            </span>
                          </div>

                          <div className="space-y-2">
                            {dayData.blocks.map((block, bi) => {
                              const blockConfig =
                                BLOCK_CONFIG[block.blockType] ||
                                BLOCK_CONFIG.TRAINER_BLOCKER;
                              return (
                                <button
                                  key={block.id + bi}
                                  onClick={() => setSelectedBlock(block)}
                                  className={`w-full rounded-lg border p-2 text-left transition-all hover:scale-[1.02] ${blockConfig.lightBg} ${blockConfig.text} ${blockConfig.border} `}
                                >
                                  <div className="mb-1 flex items-start gap-2">
                                    <blockConfig.Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                    <span className="text-xs leading-tight font-semibold">
                                      {block.title ||
                                        (block.blockType === 'EXAM' &&
                                        block.examSubType
                                          ? EXAM_SUBTYPE_LABELS[
                                              block.examSubType
                                            ]
                                          : blockConfig.label)}
                                    </span>
                                  </div>
                                  {block.description && (
                                    <p className="line-clamp-2 text-[10px] opacity-80">
                                      {block.description}
                                    </p>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="py-16 text-center">
          <Users className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h3 className="text-foreground mb-2 text-lg font-bold">
            {t('trainee.management.title')}
          </h3>
          <p className="text-muted-foreground">{t('calendar.selectTrainee')}</p>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border-destructive/20 flex items-center gap-3 rounded-xl border p-4">
          <AlertCircle className="text-destructive h-5 w-5" />
          <p className="text-destructive text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="hover:bg-destructive/10 ml-auto rounded p-1"
          >
            <X className="text-destructive h-4 w-4" />
          </button>
        </div>
      )}

      {showAddModal && selectedTrainee && (
        <AddBlockerModal
          trainees={trainees}
          initialTraineeId={selectedTraineeId}
          initialDate={selectedDate}
          onClose={() => {
            setShowAddModal(false);
            setSelectedDate(null);
          }}
          onAdd={handleAddBlock}
        />
      )}

      {selectedBlock && (
        <BlockDetailModal
          block={selectedBlock}
          trainerId={profile?.id || ''}
          onClose={() => setSelectedBlock(null)}
          onDelete={handleDeleteBlock}
          onEdit={block => {
            setEditingBlock(block);
            setSelectedBlock(null);
          }}
        />
      )}

      {editingBlock && (
        <EditBlockModal
          block={editingBlock}
          onClose={() => setEditingBlock(null)}
          onSave={updates => handleUpdateBlock(editingBlock.id, updates)}
        />
      )}
    </div>
  );
}

function AddBlockerModal({
  trainees,
  initialTraineeId,
  initialDate,
  onClose,
  onAdd,
}: {
  trainees: Trainee[];
  initialTraineeId: string;
  initialDate?: Date | null;
  onClose: () => void;
  onAdd: (data: any) => void;
}) {
  const { t } = useLanguage();
  const [startDate, setStartDate] = useState(
    initialDate ? initialDate.toISOString().split('T')[0] : ''
  );
  const [endDate, setEndDate] = useState(
    initialDate ? initialDate.toISOString().split('T')[0] : ''
  );
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sendInvitation, setSendInvitation] = useState(true);
  const [selectedTraineeIds, setSelectedTraineeIds] = useState<string[]>([
    initialTraineeId,
  ]);
  const [selectionMode, setSelectionMode] = useState<
    'single' | 'all' | 'custom'
  >('single');
  const [blockType, setBlockType] = useState<string>('TRAINER_BLOCKER');
  const [examSubType, setExamSubType] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleSelectionModeChange = (mode: 'single' | 'all' | 'custom') => {
    setSelectionMode(mode);
    if (mode === 'single') setSelectedTraineeIds([initialTraineeId]);
    else if (mode === 'all') setSelectedTraineeIds(trainees.map(t => t.id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate || selectedTraineeIds.length === 0) return;
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    if (end <= start || end.getTime() - start.getTime() < 60000) {
      setError(
        'Endzeit muss nach Startzeit liegen und mindestens 1 Minute dauern.'
      );
      return;
    }
    setError(null);
    onAdd({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      blockType,
      examSubType: blockType === 'EXAM' ? examSubType : null,
      title: title || null,
      description: description || null,
      sendInvitation,
      traineeIds: selectedTraineeIds,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border max-h-[90vh] w-full max-w-lg overflow-hidden overflow-y-auto rounded-2xl border shadow-2xl">
        <div className="border-border border-b bg-indigo-500/10 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-foreground text-lg font-bold">
                Blocker erstellen
              </h3>
              <p className="text-muted-foreground text-sm">
                {selectionMode === 'all'
                  ? `Für alle ${trainees.length} Trainees`
                  : `Für ${selectedTraineeIds.length} Trainee(s)`}
              </p>
            </div>
            <button onClick={onClose} className="hover:bg-muted rounded-lg p-2">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div className="bg-muted/30 border-border space-y-3 rounded-xl border p-4">
            <label className="block text-sm font-medium">Empfänger</label>
            <div className="bg-muted flex rounded-lg p-1">
              {(['single', 'custom', 'all'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleSelectionModeChange(mode)}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${selectionMode === mode ? 'bg-background text-foreground shadow' : 'text-muted-foreground'}`}
                >
                  {mode === 'single'
                    ? 'Einzeln'
                    : mode === 'all'
                      ? `Alle (${trainees.length})`
                      : 'Auswählen'}
                </button>
              ))}
            </div>
            {selectionMode === 'custom' && (
              <div className="bg-background max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                {trainees.map(t => (
                  <label
                    key={t.id}
                    className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTraineeIds.includes(t.id)}
                      onChange={() =>
                        setSelectedTraineeIds(prev =>
                          prev.includes(t.id)
                            ? prev.filter(id => id !== t.id)
                            : [...prev, t.id]
                        )
                      }
                      className="border-border text-accent rounded"
                    />
                    <span className="text-sm">
                      {t.firstName} {t.lastName}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-medium">
                {t('calendar.modal.blockType')}
              </label>
              <select
                value={blockType}
                onChange={e => {
                  setBlockType(e.target.value);
                  if (e.target.value !== 'EXAM') setExamSubType('');
                }}
                className="bg-muted border-border focus:ring-accent/50 w-full rounded-xl border px-4 py-3 outline-none focus:ring-2"
              >
                {Object.entries(BLOCK_CONFIG).map(([type, config]) => (
                  <option key={type} value={type}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>
            {blockType === 'EXAM' ? (
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Prüfungs-Art
                </label>
                <select
                  value={examSubType}
                  onChange={e => setExamSubType(e.target.value)}
                  className="bg-muted border-border focus:ring-accent/50 w-full rounded-xl border px-4 py-3 outline-none focus:ring-2"
                  required
                >
                  <option value="">Auswählen...</option>
                  <option value="IHK_ABSCHLUSSPRUEFUNG_T1">
                    IHK Abschlussprüfung Teil 1
                  </option>
                  <option value="IHK_ABSCHLUSSPRUEFUNG_T2">
                    IHK Abschlussprüfung Teil 2
                  </option>
                  <option value="KLAUSUR_WMC">Klausur WMC</option>
                  <option value="KLAUSUR_ALLGEMEIN">Klausur (Allgemein)</option>
                  <option value="PRAKTISCHE_PRUEFUNG">
                    Praktische Prüfung
                  </option>
                  <option value="MUENDLICHE_PRUEFUNG">Mündliche Prüfung</option>
                  <option value="PROJEKTARBEIT">Projektarbeit</option>
                  <option value="ANDERE">Sonstige</option>
                </select>
              </div>
            ) : (
              <div className="pointer-events-none opacity-50">
                <label className="mb-2 block text-sm font-medium">
                  Prüfungs-Art
                </label>
                <div className="bg-muted border-border text-muted-foreground w-full rounded-xl border px-4 py-3">
                  N/A
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-medium">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-muted border-border w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Ende</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-muted border-border w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-medium">
                Startzeit
              </label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="bg-muted border-border w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Endzeit</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="bg-muted border-border w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Titel</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="bg-muted border-border w-full rounded-xl border px-4 py-3"
              placeholder="z.B. Besprechung..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Beschreibung
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="bg-muted border-border min-h-[80px] w-full rounded-xl border px-4 py-3"
              placeholder="Details..."
            />
          </div>

          <label className="bg-muted/50 flex cursor-pointer items-center gap-3 rounded-xl border p-4">
            <input
              type="checkbox"
              checked={sendInvitation}
              onChange={e => setSendInvitation(e.target.checked)}
              className="text-accent h-4 w-4 rounded"
            />
            <Send className="text-muted-foreground h-4 w-4" />
            <span className="text-sm">{t('calendar.sendInvite')}</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="glass-effect flex-1 rounded-xl px-4 py-3 font-medium"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium"
              disabled={(() => {
                const start = new Date(`${startDate}T${startTime}:00`);
                const end = new Date(`${endDate}T${endTime}:00`);
                return end <= start || end.getTime() - start.getTime() < 60000;
              })()}
            >
              <Check className="h-4 w-4" />
              {t('common.create')}
            </button>
            {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
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
  onEdit,
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
  const canEditDelete =
    block.blockType === 'TRAINER_BLOCKER' &&
    block.createdByTrainerId === trainerId;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(block.id);
    setDeleting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl">
        {/* Header */}
        <div className={`p-6 ${config.lightBg}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`rounded-xl p-3 ${config.lightBg} border ${config.border}`}
              >
                <config.Icon className={`h-6 w-6 ${config.text}`} />
              </div>
              <div>
                <h3 className="text-foreground text-xl font-bold">
                  {block.title || config.label}
                </h3>
                <p className="text-muted-foreground text-sm">{config.label}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="hover:bg-muted text-foreground rounded-lg p-2 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-4 p-6">
          {/* Time Range */}
          <div>
            <p className="text-muted-foreground mb-1 flex items-center gap-1 text-xs tracking-wide uppercase">
              <Clock className="h-3 w-3" />
              Zeitraum
            </p>
            <p className="text-foreground font-medium">
              {formatDate(block.startDate)} • {formatTime(block.startDate)}
            </p>
            <p className="text-foreground">
              bis {formatDate(block.endDate)} • {formatTime(block.endDate)}
            </p>
          </div>

          {/* Description */}
          {block.description && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
                Beschreibung
              </p>
              <p className="text-foreground">{block.description}</p>
            </div>
          )}

          {/* Notes */}
          {block.notes && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
                Notizen
              </p>
              <p className="text-foreground">{block.notes}</p>
            </div>
          )}

          {/* Block Type Info */}
          {block.blockNumber && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
                Block-Nummer
              </p>
              <p className="text-foreground font-medium">{block.blockNumber}</p>
            </div>
          )}

          {/* Actions */}
          {confirmDelete ? (
            <div className="bg-destructive/10 border-destructive/20 space-y-3 rounded-xl border p-4">
              <p className="text-foreground text-sm font-medium">
                {t('exams.deleteConfirm')}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="glass-effect text-foreground flex-1 rounded-lg px-3 py-2 text-sm font-medium"
                  disabled={deleting}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-destructive flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center">
                    {deleting ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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
                  className="bg-accent/10 hover:bg-accent/20 text-accent flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-medium transition"
                >
                  <Edit3 className="h-4 w-4" />
                  {t('common.edit')}
                </button>
              )}
              {canEditDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="bg-destructive/10 hover:bg-destructive/20 text-destructive flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-medium transition"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('common.delete')}
                </button>
              )}
              <button
                onClick={onClose}
                className="glass-effect text-foreground hover:bg-muted flex-1 rounded-xl px-4 py-2.5 font-medium transition"
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
  onSave,
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
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(block.startDate);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date(block.endDate);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({
      title: title || null,
      description: description || null,
      startDate: new Date(`${startDate}T${startTime}:00`).toISOString(),
      endDate: new Date(`${endDate}T${endTime}:00`).toISOString(),
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl">
        <div className="border-border bg-accent/10 border-b p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Edit3 className="text-accent h-5 w-5" />
              <h3 className="text-foreground text-lg font-bold">
                Block bearbeiten
              </h3>
            </div>
            <button onClick={onClose} className="hover:bg-muted rounded-lg p-2">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-medium">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-muted border-border w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Ende</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-muted border-border w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-medium">
                Startzeit
              </label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="bg-muted border-border w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Endzeit</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="bg-muted border-border w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Titel</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="bg-muted border-border w-full rounded-xl border px-4 py-3"
              placeholder="z.B. Besprechung..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Beschreibung
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="bg-muted border-border min-h-[100px] w-full rounded-xl border px-4 py-3"
              placeholder="Details zum Termin..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="glass-effect flex-1 rounded-xl px-4 py-3 font-medium"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium"
            >
              {saving ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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
function setError(arg0: string | null) {
  throw new Error('Function not implemented.');
}
