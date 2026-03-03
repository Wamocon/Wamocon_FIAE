'use client';

import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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

// Block type configs base (labels will be translated in component)
const BLOCK_CONFIG_BASE: Record<
  string,
  {
    labelKey: string;
    Icon: any;
    color: string;
    lightBg: string;
    border: string;
    text: string;
  }
> = {
  SCHOOL: {
    labelKey: 'trainer.calendar.blockTypes.school',
    Icon: School,
    color: 'bg-accent',
    lightBg: 'bg-accent/20',
    border: 'border-accent/50',
    text: 'text-accent',
  },
  COMPANY: {
    labelKey: 'trainer.calendar.blockTypes.company',
    Icon: Building2,
    color: 'bg-green-500',
    lightBg: 'bg-green-500/20',
    border: 'border-green-500/50',
    text: 'text-green-600 dark:text-green-400',
  },
  HOLIDAY: {
    labelKey: 'trainer.calendar.blockTypes.holiday',
    Icon: Palmtree,
    color: 'bg-amber-500',
    lightBg: 'bg-amber-500/20',
    border: 'border-amber-500/50',
    text: 'text-amber-600 dark:text-amber-400',
  },
  EXAM: {
    labelKey: 'trainer.calendar.blockTypes.exam',
    Icon: FileText,
    color: 'bg-rose-500',
    lightBg: 'bg-rose-500/20',
    border: 'border-rose-500/50',
    text: 'text-rose-600 dark:text-rose-400',
  },
  PERSONAL: {
    labelKey: 'trainer.calendar.blockTypes.personal',
    Icon: User,
    color: 'bg-violet-500',
    lightBg: 'bg-violet-500/20',
    border: 'border-violet-500/50',
    text: 'text-violet-600 dark:text-violet-400',
  },
  SONSTIGES: {
    labelKey: 'trainer.calendar.blockTypes.other',
    Icon: AlertCircle,
    color: 'bg-slate-500',
    lightBg: 'bg-slate-500/20',
    border: 'border-slate-500/50',
    text: 'text-slate-600 dark:text-slate-400',
  },
  TRAINER_BLOCKER: {
    labelKey: 'trainer.calendar.blockTypes.trainer',
    Icon: User,
    color: 'bg-indigo-500',
    lightBg: 'bg-indigo-500/20',
    border: 'border-indigo-500/50',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
};

const WEEKDAY_KEYS = [
  'trainer.calendar.weekdays.mo',
  'trainer.calendar.weekdays.tu',
  'trainer.calendar.weekdays.we',
  'trainer.calendar.weekdays.th',
  'trainer.calendar.weekdays.fr',
  'trainer.calendar.weekdays.sa',
  'trainer.calendar.weekdays.su',
];
const MONTH_KEYS = [
  'trainer.calendar.months.january',
  'trainer.calendar.months.february',
  'trainer.calendar.months.march',
  'trainer.calendar.months.april',
  'trainer.calendar.months.may',
  'trainer.calendar.months.june',
  'trainer.calendar.months.july',
  'trainer.calendar.months.august',
  'trainer.calendar.months.september',
  'trainer.calendar.months.october',
  'trainer.calendar.months.november',
  'trainer.calendar.months.december',
];

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
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  // Data fetching via React Query
  const traineesUrl = profile?.id
    ? `/api/trainer/trainees?trainerProfileId=${profile.id}`
    : null;
  const { data: traineesData } = useApiQuery<{ trainees: Trainee[] }>(
    traineesUrl
  );
  const trainees = traineesData?.trainees || [];

  // Create translated versions
  const WEEKDAYS = useMemo(() => WEEKDAY_KEYS.map(key => t(key)), [t]);
  const MONTHS = useMemo(() => MONTH_KEYS.map(key => t(key)), [t]);
  const BLOCK_CONFIG = useMemo(() => {
    const config: Record<
      string,
      {
        label: string;
        Icon: any;
        color: string;
        lightBg: string;
        border: string;
        text: string;
      }
    > = {};
    for (const [key, value] of Object.entries(BLOCK_CONFIG_BASE)) {
      config[key] = { ...value, label: t(value.labelKey) };
    }
    return config;
  }, [t]);
  const [selectedTraineeId, setSelectedTraineeId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [currentDate] = useState(new Date());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth());
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [showAddModal, setShowAddModal] = useState(false);

  const blocksUrl = selectedTraineeId
    ? `/api/trainer/blocks?traineeId=${selectedTraineeId}&year=${selectedYear}`
    : null;
  const { data: blocksData, isLoading: loading } = useApiQuery<{
    blocks: Block[];
  }>(blocksUrl);
  const blocks = blocksData?.blocks || [];

  // Auto-select first trainee when data loads
  useEffect(() => {
    if (trainees.length > 0 && !selectedTraineeId) {
      setSelectedTraineeId(trainees[0].id);
    }
  }, [trainees, selectedTraineeId]);

  // Generate calendar grid
  const calendarDays = (() => {
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
        blocks: blocks.filter(b => isDateInBlock(date, b)),
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
        blocks: blocks.filter(b => isDateInBlock(date, b)),
      });
    }

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
      });
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

      if (!res.ok) throw new Error(t('trainer.calendar.createError'));
      if (blocksUrl) queryClient.invalidateQueries({ queryKey: [blocksUrl] });
      setShowAddModal(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const selectedTrainee = trainees.find(t => t.id === selectedTraineeId);

  return (
    <div className="min-h-full p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-foreground flex items-center gap-3 text-2xl font-bold md:text-3xl">
          <Calendar className="text-accent h-7 w-7" />
          {t('trainer.calendar.title')}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t('trainer.calendar.description')}
        </p>
      </div>

      {/* Trainee Selector */}
      <div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Users className="text-muted-foreground h-5 w-5" />
          <select
            value={selectedTraineeId}
            onChange={e => setSelectedTraineeId(e.target.value)}
            className="bg-background border-border text-foreground focus:ring-accent/50 min-w-[200px] rounded-xl border px-4 py-2.5 transition-all outline-none focus:ring-2"
          >
            <option value="" className="bg-card text-foreground">
              {t('trainer.calendar.selectTrainee')}
            </option>
            {trainees.map(trainee => (
              <option
                key={trainee.id}
                value={trainee.id}
                className="bg-card text-foreground"
              >
                {trainee.firstName} {trainee.lastName}
              </option>
            ))}
          </select>
        </div>

        {selectedTraineeId && (
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-accent flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            {t('trainer.calendar.createBlock')}
          </button>
        )}
      </div>

      {selectedTraineeId ? (
        <>
          {/* Month Navigation */}
          <div className="glass-effect mb-4 flex items-center justify-between rounded-xl p-4">
            <button
              onClick={() => {
                if (selectedMonth === 0) {
                  setSelectedMonth(11);
                  setSelectedYear(y => y - 1);
                } else {
                  setSelectedMonth(m => m - 1);
                }
              }}
              className="hover:bg-muted text-foreground rounded-lg p-2 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-4">
              <h3 className="text-foreground min-w-[180px] text-center text-lg font-bold">
                {MONTHS[selectedMonth]} {selectedYear}
              </h3>
              <button
                onClick={() => {
                  setSelectedMonth(currentDate.getMonth());
                  setSelectedYear(currentDate.getFullYear());
                }}
                className="bg-accent/10 text-accent hover:bg-accent/20 rounded-lg px-3 py-1.5 text-xs font-medium transition"
              >
                {t('trainer.calendar.today')}
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
              className="hover:bg-muted text-foreground rounded-lg p-2 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Legend */}
          <div className="glass-effect mb-6 flex flex-wrap gap-4 rounded-xl p-4">
            {Object.entries(BLOCK_CONFIG)
              .filter(
                ([type]) => !['PERSONAL', 'TRAINER_BLOCKER'].includes(type)
              )
              .map(([type, config]) => (
                <div key={type} className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${config.color}`} />
                  <span className="text-muted-foreground text-sm font-medium">
                    {config.label}
                  </span>
                </div>
              ))}
          </div>

          {/* Calendar Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <div className="glass-effect overflow-hidden rounded-2xl">
              <div className="border-border grid grid-cols-7 border-b">
                {WEEKDAYS.map((day, i) => (
                  <div
                    key={day}
                    className={`py-3 text-center text-sm font-semibold ${i >= 5 ? 'text-muted-foreground' : 'text-foreground'}`}
                  >
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((dayData, index) => {
                  const isWeekend = index % 7 >= 5;
                  const hasBlocks = dayData.blocks.length > 0;
                  const primaryBlock = dayData.blocks[0];
                  const config = primaryBlock
                    ? BLOCK_CONFIG[primaryBlock.blockType]
                    : null;

                  return (
                    <div
                      key={index}
                      className={`border-border relative min-h-[80px] border-r border-b p-2 md:min-h-[100px] ${!dayData.isCurrentMonth ? 'opacity-40' : ''} ${dayData.isToday ? 'bg-accent/5' : ''} ${isWeekend && dayData.isCurrentMonth ? 'bg-muted/30' : ''} `}
                    >
                      <div
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${dayData.isToday ? 'bg-accent text-accent-foreground' : isWeekend ? 'text-muted-foreground' : 'text-foreground'} `}
                      >
                        {dayData.date.getDate()}
                      </div>

                      {hasBlocks && (
                        <div className="mt-1 space-y-1">
                          {dayData.blocks.slice(0, 2).map((block, bi) => {
                            const blockConfig =
                              BLOCK_CONFIG[block.blockType] ||
                              BLOCK_CONFIG.PERSONAL;
                            return (
                              <div
                                key={block.id + bi}
                                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${blockConfig.lightBg} ${blockConfig.text} ${blockConfig.border} border`}
                              >
                                <blockConfig.Icon className="h-3 w-3 flex-shrink-0" />
                                <span className="hidden truncate md:block">
                                  {blockConfig.label}
                                </span>
                              </div>
                            );
                          })}
                          {dayData.blocks.length > 2 && (
                            <div className="text-muted-foreground px-1.5 text-[10px]">
                              {t('trainer.calendar.more').replace(
                                '{count}',
                                String(dayData.blocks.length - 2)
                              )}
                            </div>
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
        <div className="py-16 text-center">
          <Users className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h3 className="text-foreground mb-2 text-lg font-bold">
            {t('trainer.calendar.selectTraineePrompt')}
          </h3>
          <p className="text-muted-foreground">
            {t('trainer.calendar.selectTraineeDesc')}
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-destructive/10 border-destructive/20 mt-4 flex items-center gap-3 rounded-xl border p-4">
          <AlertCircle className="text-destructive h-5 w-5 flex-shrink-0" />
          <p className="text-destructive text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="hover:bg-destructive/10 ml-auto rounded p-1"
          >
            <X className="text-destructive h-4 w-4" />
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
  const { t } = useLanguage();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [blockType, setBlockType] = useState('TRAINER_BLOCKER');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [description, setDescription] = useState('');
  const [sendInvitation, setSendInvitation] = useState(true);

  // Multi-select state
  const [selectedTraineeIds, setSelectedTraineeIds] = useState<string[]>([
    initialTraineeId,
  ]);
  const [selectionMode, setSelectionMode] = useState<
    'single' | 'all' | 'custom'
  >('single');

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
      if (selectedTraineeIds.length === 0)
        setSelectedTraineeIds([initialTraineeId]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) return;
    if (selectedTraineeIds.length === 0) {
      toast.error(t('trainer.calendar.modal.selectAtLeastOne'));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border max-h-[90vh] w-full max-w-lg overflow-hidden overflow-y-auto rounded-2xl border shadow-2xl">
        <div className="border-border border-b bg-indigo-500/10 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-foreground text-lg font-bold">
                {t('trainer.calendar.modal.title')}
              </h3>
              <p className="text-muted-foreground text-sm">
                {selectionMode === 'single'
                  ? t('trainer.calendar.modal.forTrainee').replace(
                      '{name}',
                      traineeName
                    )
                  : selectionMode === 'all'
                    ? t('trainer.calendar.modal.forAllTrainees')
                    : t('trainer.calendar.modal.forMultiple').replace(
                        '{count}',
                        String(selectedTraineeIds.length)
                      )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="hover:bg-muted text-foreground rounded-lg p-2 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          {/* Trainee Selection */}
          <div className="bg-muted/30 border-border space-y-3 rounded-xl border p-4">
            <label className="text-foreground block text-sm font-medium">
              {t('trainer.calendar.modal.recipients')}
            </label>
            <div className="bg-muted flex rounded-lg p-1">
              <button
                type="button"
                onClick={() => handleSelectionModeChange('single')}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${selectionMode === 'single' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t('trainer.calendar.modal.onlySelected').replace(
                  '{name}',
                  traineeName.split(' ')[0]
                )}
              </button>
              <button
                type="button"
                onClick={() => handleSelectionModeChange('custom')}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${selectionMode === 'custom' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t('trainer.calendar.modal.select')}
              </button>
              <button
                type="button"
                onClick={() => handleSelectionModeChange('all')}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${selectionMode === 'all' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t('trainer.calendar.modal.all').replace(
                  '{count}',
                  String(trainees.length)
                )}
              </button>
            </div>

            {selectionMode === 'custom' && (
              <div className="bg-background border-border max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                {trainees.map(t => (
                  <label
                    key={t.id}
                    className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTraineeIds.includes(t.id)}
                      onChange={() => handleTraineeToggle(t.id)}
                      className="border-border text-accent focus:ring-accent rounded"
                    />
                    <span className="text-foreground truncate text-sm">
                      {t.firstName} {t.lastName}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t('trainer.calendar.modal.startDate')}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-muted border-border text-foreground w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
            <div>
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t('trainer.calendar.modal.endDate')}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-muted border-border text-foreground w-full rounded-xl border px-4 py-3"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('trainer.calendar.modal.titleField')}
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="bg-muted border-border text-foreground w-full rounded-xl border px-4 py-3"
              placeholder={t('trainer.calendar.modal.titlePlaceholder')}
            />
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('trainer.calendar.modal.descriptionField')}
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="bg-muted border-border text-foreground min-h-[80px] w-full rounded-xl border px-4 py-3"
              placeholder={t('trainer.calendar.modal.descriptionPlaceholder')}
            />
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('trainer.calendar.modal.notesField')}
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="bg-muted border-border text-foreground w-full rounded-xl border px-4 py-3"
              placeholder={t('trainer.calendar.modal.notesPlaceholder')}
            />
          </div>

          <div className="bg-muted/50 border-border flex items-center gap-3 rounded-xl border p-4">
            <input
              type="checkbox"
              id="sendInvitation"
              checked={sendInvitation}
              onChange={e => setSendInvitation(e.target.checked)}
              className="border-border text-accent h-4 w-4 rounded"
            />
            <label
              htmlFor="sendInvitation"
              className="text-foreground flex cursor-pointer items-center gap-2 text-sm"
            >
              <Send className="text-muted-foreground h-4 w-4" />
              {t('trainer.calendar.modal.sendInvitation')}
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="glass-effect text-foreground flex-1 rounded-xl px-4 py-3 font-medium transition"
            >
              {t('trainer.calendar.modal.cancel')}
            </button>
            <button
              type="submit"
              className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium transition"
            >
              <Check className="h-4 w-4" />
              {t('trainer.calendar.modal.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
