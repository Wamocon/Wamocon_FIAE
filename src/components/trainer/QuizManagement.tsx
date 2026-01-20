'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Pencil, X, Check, Search, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// Minimal shadcn-like primitives for this self-contained demo
function Dialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="glass-effect border-accent/30 relative z-10 w-full max-w-5xl rounded-3xl border bg-background p-0 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-muted'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  );
}

function RadioGroup({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex gap-4">
      {options.map((opt) => (
        <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            className="h-4 w-4 border-border text-blue-600 focus:ring-blue-500"
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// Simple combobox with multi-select behavior
type ComboOption = { id: string; label: string };

function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = 'Search trainees...',
}: {
  options: ComboOption[];
  selected: string[]; // selected IDs
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useState<HTMLDivElement | null>(null)[0] as any;
  const setContainerRef = (el: HTMLDivElement | null) => {
    (MultiSelect as any)._ref = el;
  };
  const ref: React.MutableRefObject<HTMLDivElement | null> = useMemo(() => ({ current: (MultiSelect as any)._ref || null }), []);
  // Attach actual ref on render
  const assignRef = (el: HTMLDivElement | null) => {
    setContainerRef(el);
    ref.current = el;
  };
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const node = ref.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [ref]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={assignRef}>
      <div className="mb-2 flex flex-wrap gap-2">
        {selected.map((id) => {
          const opt = options.find(o => o.id === id);
          const label = opt?.label ?? id;
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2 py-1 text-xs text-foreground">
              {label}
              <button onClick={() => toggle(id)} aria-label={`Remove ${label}`} className="text-muted hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="pl-9"
        />
        <button
          type="button"
          aria-label={open ? 'Close' : 'Open'}
          onClick={() => setOpen((o) => !o)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="absolute z-30 mt-2 max-h-60 w-full overflow-auto rounded-md border border-accent/30 bg-background p-1 shadow-lg">
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-sm text-muted">No results</div>
          )}
          {filtered.map((opt) => {
            const active = selected.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggle(opt.id)}
                className={`flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-accent/20 ${active ? 'text-foreground' : 'text-foreground'}`}
              >
                <span>{opt.label}</span>
                {active && <Check className="h-4 w-4" />}

              </button>
            );
          })}
          <div className="sticky bottom-0 flex justify-end border-t border-accent/30 bg-background/80 p-1">
            <Button variant="secondary" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}

type QuizListItem = {
  id: string;
  title: string;
  quiz_type: 'mini' | 'big';
  is_active?: boolean;
  assigned_count: number;
  created_at: string;
};

type QuestionDraft = {
  id: string;
  text: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
};

export function QuizManagement() {
  const { profile } = useAuth();
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Create dialog state
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Step 1: Details
  const [title, setTitle] = useState('');
  const [isActive, setIsActive] = useState(false);

  // Step 2: Questions
  const blankQuestion = (): QuestionDraft => ({ id: crypto.randomUUID(), text: '', options: ['', '', '', ''], correctIndex: 0 });
  const [questions, setQuestions] = useState<QuestionDraft[]>([blankQuestion()]);

  // Step 3: Trainees assignment
  const [traineeOptions, setTraineeOptions] = useState<ComboOption[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]); // selected trainee IDs
  // Collaborators (trainers) management
  const [trainerOptions, setTrainerOptions] = useState<ComboOption[]>([]);
  const [collaborators, setCollaborators] = useState<string[]>([]);

  const resetForm = () => {
    setStep(0);
    setTitle('');
    setIsActive(false);
    setQuestions([blankQuestion()]);
    setAssigned([]);
    setCollaborators([]);
    setEditMode(false);
    setEditId(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/trainer/quizzes/${id}`);
      if (!res.ok) throw new Error('Failed to load quiz');
      const data = await res.json();
      setEditMode(true);
      setEditId(data.id);
      setStep(0);
      setTitle(data.title || '');
      setIsActive(Boolean(data.is_active));
      const mappedQs: QuestionDraft[] = Array.isArray(data.questions)
        ? data.questions.map((qq: any) => ({
          id: crypto.randomUUID(),
          text: String(qq.question_text || ''),
          options: (qq.options || ['', '', '', '']).slice(0, 4).concat(['', '', '', '']).slice(0, 4) as [string, string, string, string],
          correctIndex: Number(qq.correct_index ?? 0) as 0 | 1 | 2 | 3,
        }))
        : [blankQuestion()];
      setQuestions(mappedQs.length ? mappedQs : [blankQuestion()]);
      setAssigned(Array.isArray(data.assigned_trainee_ids) ? data.assigned_trainee_ids : []);
      // Load current quiz collaborators
      try {
        const memRes = await fetch(`/api/trainer/quiz-members?quizId=${id}`);
        if (memRes.ok) {
          const mem = await memRes.json();
          const ids: string[] = Array.isArray(mem.members) ? mem.members.map((m: any) => String(m.trainerId)) : [];
          setCollaborators(ids);
        }
      } catch { }
      setOpen(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const addQuestion = () => setQuestions((qs) => [...qs, blankQuestion()]);
  const removeQuestion = (id: string) => setQuestions((qs) => (qs.length > 1 ? qs.filter((q) => q.id !== id) : qs));
  const updateQuestionText = (id: string, text: string) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, text } : q)));
  const updateOption = (id: string, idx: number, val: string) =>
    setQuestions((qs) =>
      qs.map((q) => (q.id === id ? { ...q, options: q.options.map((o, i) => (i === idx ? val : o)) as any } : q)),
    );
  const setCorrect = (id: string, idx: 0 | 1 | 2 | 3) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, correctIndex: idx } : q)));

  const canSave = useMemo(() => {
    if (!title.trim()) return false;
    if (questions.length === 0) return false;
    for (const q of questions) {
      if (!q.text.trim()) return false;
      if (q.options.some((o) => !o.trim())) return false;
    }
    return true;
  }, [title, questions]);

  const onSave = async () => {
    if (!profile) return;
    try {
      setSaving(true);
      const payload = {
        trainer_id: profile.id,
        title: title.trim(),
        is_active: isActive,
        quiz_type: 'big' as const,
        questions: questions.map((qq) => ({
          question_text: qq.text.trim(),
          options: qq.options.map((o) => o.trim()),
          correct_index: qq.correctIndex,
        })),
        assigned_trainee_ids: assigned,
      };
      if (editMode && editId) {
        const res = await fetch(`/api/trainer/quizzes/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, trainerId: profile.id }),
        });
        if (!res.ok) throw new Error('Failed to save changes');
        // Sync collaborators: diff current vs selected
        await syncQuizMembers(editId, collaborators, profile.id);
      } else {
        const res = await fetch(`/api/trainer/quizzes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create quiz');
        const created = await res.json();
        const newId = String(created.id);
        if (newId) {
          await syncQuizMembers(newId, collaborators, profile.id);
        }
      }
      setOpen(false);
      resetForm();
      // refresh list
      await loadQuizzes();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/trainer/quizzes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      await loadQuizzes();
    } catch (e) {
      console.error(e);
    }
  };

  const loadQuizzes = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/trainer/quizzes?trainerId=${profile.id}`);
      if (!res.ok) throw new Error('Failed to load quizzes');
      const data = await res.json();
      const items: QuizListItem[] = (data.quizzes || []).filter((q: any) => q.quiz_type === 'big');
      setQuizzes(items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadTrainees = async () => {
    if (!profile) return;
    try {
      const res = await fetch(`/api/trainer/trainees?trainerProfileId=${profile.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const opts: ComboOption[] = (data.trainees || []).map((t: any) => ({ id: t.id, label: t.full_name }));
      setTraineeOptions(opts);
    } catch (e) {
      console.error(e);
    }
  };
  const loadTrainers = async () => {
    if (!profile) return;
    try {
      const res = await fetch(`/api/trainer/trainers?excludeId=${profile.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const opts: ComboOption[] = (data.trainers || []).map((t: any) => ({ id: t.id, label: t.full_name }));
      setTrainerOptions(opts);
    } catch (e) {
      console.error(e);
    }
  };

  async function syncQuizMembers(quizId: string, desired: string[], addedById: string) {
    try {
      const curRes = await fetch(`/api/trainer/quiz-members?quizId=${quizId}`);
      const cur = curRes.ok ? await curRes.json() : { members: [] };
      const currentIds: string[] = Array.isArray(cur.members) ? cur.members.map((m: any) => String(m.trainerId)) : [];
      const want = new Set(desired);
      const have = new Set(currentIds);
      const toAdd = Array.from(want).filter((id) => !have.has(id));
      const toRemove = Array.from(have).filter((id) => !want.has(id));

      await Promise.all(
        toAdd.map((trainerId) =>
          fetch(`/api/trainer/quiz-members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quiz_id: quizId, trainer_id: trainerId, added_by_id: addedById }),
          }),
        ),
      );
      await Promise.all(
        toRemove.map((trainerId) =>
          fetch(`/api/trainer/quiz-members`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quiz_id: quizId, trainer_id: trainerId }),
          }),
        ),
      );
    } catch (e) {
      console.error('syncQuizMembers error', e);
    }
  }

  useEffect(() => {
    if (profile?.id) {
      loadTrainees();
      loadTrainers();
      loadQuizzes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-foreground text-2xl font-bold">Quiz Management</h2>
          <Button onClick={openCreate} className="gap-2 bg-gradient-to-r from-accent to-primary text-foreground hover:from-accent/90 hover:to-primary/90">
            <Plus className="h-4 w-4" /> Create New Quiz
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="divide-y divide-border">
              <tr>
                <th className="px-4 py-3 text-sm font-medium text-foreground">Quiz Title</th>
                <th className="px-4 py-3 text-sm font-medium text-foreground">Status</th>
                <th className="px-4 py-3 text-sm font-medium text-foreground">Trainees Assigned</th>
                <th className="px-4 py-3 text-sm font-medium text-foreground">Date Created</th>
                <th className="px-4 py-3 text-sm font-medium text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quizzes.map((q) => (
                <tr key={q.id} className="transition-colors hover:bg-accent/10">
                  <td className="px-4 py-3 text-sm font-medium text-foreground">
                    <a href={`/trainer/quiz-management/${q.id}`} className="underline hover:text-primary">{q.title}</a>
                  </td>
                  <td className="px-4 py-3">
                    {q.is_active ? (
                      <span className="inline-flex items-center rounded-full bg-green-500/20 px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400">Active</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">{q.assigned_count} Trainees</td>
                  <td className="px-4 py-3 text-sm text-foreground">{new Date(q.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button className="h-8 gap-1 px-3" onClick={() => openEdit(q.id)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <a href={`/trainer/quiz-management/${q.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-accent/30 px-3 text-sm hover:bg-background/60">View</a>
                      <Button variant="destructive" className="h-8 gap-1 px-3" onClick={() => onDelete(q.id)}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={open} onClose={() => setOpen(false)}>
        <div className="flex items-start justify-between  rounded-t-3xl border-b border-accent/30 bg-background px-6 py-4">
          <div>
            <h3 className="text-foreground text-lg font-semibold">{editMode ? 'Edit Global Quiz' : 'Create New Global Quiz'}</h3>
            <p className="text-muted text-sm">Follow the steps to {editMode ? 'update' : 'set up'} your quiz.</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Steps header */}
        <div className="flex items-center gap-3 px-6 pt-4">
          <div className={`h-2 flex-1 rounded-full ${step >= 0 ? 'bg-blue-600' : 'bg-muted'}`} />
          <div className={`h-2 flex-1 rounded-full ${step >= 1 ? 'bg-blue-600' : 'bg-muted'}`} />
          <div className={`h-2 flex-1 rounded-full ${step >= 2 ? 'bg-blue-600' : 'bg-muted'}`} />
        </div>

        {/* Step content */}
        {step === 0 && (
          <div className="h-[12vh] overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              <div>
                <label className="text-foreground mb-1 block text-sm font-medium">Quiz Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter quiz title" />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-muted/30 p-3">
                <div>
                  <div className="text-foreground text-sm font-medium">Set Active</div>
                  <div className="text-muted text-xs">Make this quiz available to trainees</div>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              {questions.map((q, qi) => (
                <div key={q.id} className="rounded-lg border border-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-foreground text-sm font-medium">Question {qi + 1}</div>
                    <button onClick={() => removeQuestion(q.id)} className="text-muted hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mb-3">
                    <label className="text-foreground mb-1 block text-xs font-medium">Question Text</label>
                    <Input value={q.text} onChange={(e) => updateQuestionText(q.id, e.target.value)} placeholder="Type your question..." />
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {q.options.map((opt, idx) => (
                      <div key={idx}>
                        <label className="text-foreground mb-1 block text-xs font-medium">Option {idx + 1}</label>
                        <Input value={opt} onChange={(e) => updateOption(q.id, idx, e.target.value)} placeholder={`Option ${idx + 1}`} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <label className="text-foreground mb-1 block text-xs font-medium">Correct Answer</label>
                    <RadioGroup
                      value={String(q.correctIndex)}
                      onChange={(v) => setCorrect(q.id, Number(v) as 0 | 1 | 2 | 3)}
                      options={[
                        { value: '0', label: 'Option 1' },
                        { value: '1', label: 'Option 2' },
                        { value: '2', label: 'Option 3' },
                        { value: '3', label: 'Option 4' },
                      ]}
                    />
                  </div>
                </div>
              ))}
              <div>
                <Button variant="secondary" className="gap-2" onClick={addQuestion}>
                  <Plus className="h-4 w-4" /> Add Question
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="h-[20vh] overflow-y-auto px-6 py-4">
            <div className="space-y-6">
              <div>
                <label className="text-foreground mb-1 block text-sm font-medium">Assign Trainees</label>
                <MultiSelect options={traineeOptions} selected={assigned} onChange={setAssigned} />
              </div>
              <div>
                <label className="text-foreground mb-1 block text-sm font-medium">Collaborating Trainers</label>
                <MultiSelect options={trainerOptions} selected={collaborators} onChange={setCollaborators} placeholder="Search trainers..." />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-accent/30 bg-background px-6 py-4">
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => (s > 0 ? ((s - 1) as 0 | 1 | 2) : s))}>
              Back
            </Button>
            <Button onClick={() => setStep((s) => (s < 2 ? ((s + 1) as 0 | 1 | 2) : s))} disabled={step === 2}>
              Next
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={onSave} disabled={!canSave || saving}>
              {editMode ? 'Save Changes' : 'Save Quiz'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div >
  );
}
