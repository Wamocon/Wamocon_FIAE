'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
    FileText,
    User,
    Calendar,
    Plus,
    X,
    Check,
    AlertCircle,
    Filter,
    Award,
} from 'lucide-react';

interface Exam {
    id: string;
    traineeId: string;
    traineeName: string;
    examDate: string;
    subject: string;
    examTypeValue: string;
    isCompanyExam: boolean;
    points: number | null;
    maxPoints: number | null;
    passed: boolean | null;
    lernfeldCode: string | null;
}

interface Trainee {
    id: string;
    firstName: string | null;
    lastName: string | null;
}

const EXAM_TYPES = {
    KLAUSUR: { label: 'Klausur', bg: 'bg-rose-500/20', text: 'text-rose-600 dark:text-rose-400' },
    TEST: { label: 'Test', bg: 'bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
    PROJEKT: { label: 'Projekt', bg: 'bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400' },
    PRAESENTATION: { label: 'Präsentation', bg: 'bg-violet-500/20', text: 'text-violet-600 dark:text-violet-400' },
    COMPANY: { label: 'Betrieblich', bg: 'bg-green-500/20', text: 'text-green-600 dark:text-green-400' },
};

export function TrainerExamsTab() {
    const { profile } = useAuth();
    const [exams, setExams] = useState<Exam[]>([]);
    const [trainees, setTrainees] = useState<Trainee[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [traineeFilter, setTraineeFilter] = useState<string>('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [showGradeModal, setShowGradeModal] = useState(false);
    const [selectedExam, setSelectedExam] = useState<Exam | null>(null);

    useEffect(() => {
        if (!profile?.id) return;
        const trainerId = profile.id;
        async function loadData() {
            setLoading(true);
            try {
                const [examsRes, traineesRes] = await Promise.all([
                    fetch(`/api/trainer/school/exams?trainerId=${trainerId}${traineeFilter ? `&traineeId=${traineeFilter}` : ''}`),
                    fetch(`/api/trainer/trainees?trainerProfileId=${trainerId}`)
                ]);
                if (examsRes.ok) {
                    const data = await examsRes.json();
                    setExams(data.exams || []);
                }
                if (traineesRes.ok) {
                    const data = await traineesRes.json();
                    setTrainees(data.trainees || []);
                }
            } catch (e) {
                setError('Fehler beim Laden');
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, [profile?.id, traineeFilter]);

    const handleAddExam = async (examData: any) => {
        if (!profile?.id) return;
        try {
            const res = await fetch('/api/trainer/school/exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...examData, trainerId: profile.id }),
            });
            if (res.ok) {
                const data = await res.json();
                setExams(prev => [data.exam, ...prev]);
                setShowAddModal(false);
            }
        } catch (e) {
            setError('Fehler beim Erstellen');
        }
    };

    const handleGradeExam = async (examId: string, points: number, maxPoints: number) => {
        try {
            const res = await fetch(`/api/trainer/school/exams/${examId}/grade`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points, maxPoints }),
            });
            if (res.ok) {
                const data = await res.json();
                setExams(prev => prev.map(e => e.id === examId ? { ...e, points, maxPoints, passed: data.passed } : e));
                setShowGradeModal(false);
                setSelectedExam(null);
            }
        } catch (e) {
            setError('Fehler beim Bewerten');
        }
    };

    const schoolExams = exams.filter(e => !e.isCompanyExam);
    const companyExams = exams.filter(e => e.isCompanyExam);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex items-center gap-3">
                    <Filter className="h-5 w-5 text-muted-foreground" />
                    <select
                        value={traineeFilter}
                        onChange={(e) => setTraineeFilter(e.target.value)}
                        className="px-4 py-2.5 rounded-xl bg-background border border-border min-w-[200px]"
                    >
                        <option value="">Alle Trainees</option>
                        {trainees.map(t => (
                            <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                        ))}
                    </select>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="btn-accent flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
                >
                    <Plus className="h-4 w-4" />
                    Betriebliche Prüfung
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Company Exams Section */}
                    <div>
                        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                            <Award className="h-4 w-4 text-green-500" />
                            Betriebliche Prüfungen ({companyExams.length})
                        </h3>
                        {companyExams.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic">Keine betrieblichen Prüfungen vorhanden.</p>
                        ) : (
                            <div className="grid gap-3">
                                {companyExams.map(exam => (
                                    <ExamCard
                                        key={exam.id}
                                        exam={exam}
                                        onGrade={() => { setSelectedExam(exam); setShowGradeModal(true); }}
                                        canGrade
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* School Exams Section */}
                    <div>
                        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                            <FileText className="h-4 w-4 text-accent" />
                            Schulische Prüfungen ({schoolExams.length})
                        </h3>
                        {schoolExams.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic">Keine schulischen Prüfungen vorhanden.</p>
                        ) : (
                            <div className="grid gap-3">
                                {schoolExams.map(exam => (
                                    <ExamCard key={exam.id} exam={exam} canGrade={false} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <p className="text-sm text-destructive">{error}</p>
                    <button onClick={() => setError(null)} className="ml-auto"><X className="h-4 w-4" /></button>
                </div>
            )}

            {showAddModal && (
                <AddCompanyExamModal
                    trainees={trainees}
                    onClose={() => setShowAddModal(false)}
                    onAdd={handleAddExam}
                />
            )}

            {showGradeModal && selectedExam && (
                <GradeExamModal
                    exam={selectedExam}
                    onClose={() => { setShowGradeModal(false); setSelectedExam(null); }}
                    onGrade={handleGradeExam}
                />
            )}
        </div>
    );
}

function ExamCard({ exam, onGrade, canGrade }: { exam: Exam; onGrade?: () => void; canGrade: boolean }) {
    const typeConfig = EXAM_TYPES[exam.isCompanyExam ? 'COMPANY' : (exam.examTypeValue as keyof typeof EXAM_TYPES)] || EXAM_TYPES.KLAUSUR;
    const hasGrade = exam.points !== null;

    return (
        <div className="p-4 rounded-xl bg-muted/30 border border-border">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-lg bg-accent/10">
                        <User className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                        <h4 className="font-medium text-foreground">{exam.traineeName}</h4>
                        <p className="text-sm text-muted-foreground">{exam.subject}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(exam.examDate).toLocaleDateString('de-DE')}
                            </span>
                            <span className={`px-2 py-0.5 rounded ${typeConfig.bg} ${typeConfig.text}`}>
                                {typeConfig.label}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {hasGrade ? (
                        <div className={`px-3 py-1.5 rounded-lg text-sm font-medium ${exam.passed ? 'bg-green-500/20 text-green-600' : 'bg-rose-500/20 text-rose-600'}`}>
                            {exam.points}/{exam.maxPoints} ({exam.passed ? 'Bestanden' : 'Nicht bestanden'})
                        </div>
                    ) : canGrade && onGrade ? (
                        <button
                            onClick={onGrade}
                            className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 text-sm font-medium"
                        >
                            Bewerten
                        </button>
                    ) : (
                        <span className="text-xs text-muted-foreground">Noch nicht bewertet</span>
                    )}
                </div>
            </div>
        </div>
    );
}

function AddCompanyExamModal({ trainees, onClose, onAdd }: {
    trainees: Trainee[];
    onClose: () => void;
    onAdd: (data: any) => void;
}) {
    const [traineeId, setTraineeId] = useState('');
    const [subject, setSubject] = useState('');
    const [examDate, setExamDate] = useState('');
    const [examType, setExamType] = useState('KLAUSUR');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!traineeId || !subject || !examDate) return;
        onAdd({
            traineeId,
            subject,
            examDate: new Date(examDate).toISOString(),
            examTypeValue: examType,
            isCompanyExam: true,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
                <div className="p-6 border-b border-border">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold">Betriebliche Prüfung anlegen</h3>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
                    </div>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">Trainee</label>
                        <select value={traineeId} onChange={e => setTraineeId(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border" required>
                            <option value="">Auswählen...</option>
                            {trainees.map(t => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-2">Fach/Thema</label>
                        <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border" placeholder="z.B. Netzwerktechnik" required />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-2">Datum</label>
                            <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Typ</label>
                            <select value={examType} onChange={e => setExamType(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border">
                                <option value="KLAUSUR">Klausur</option>
                                <option value="TEST">Test</option>
                                <option value="PROJEKT">Projekt</option>
                                <option value="PRAESENTATION">Präsentation</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-3 rounded-xl glass-effect font-medium">Abbrechen</button>
                        <button type="submit" className="btn-accent flex-1 px-4 py-3 rounded-xl font-medium flex items-center justify-center gap-2">
                            <Check className="h-4 w-4" />Erstellen
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function GradeExamModal({ exam, onClose, onGrade }: {
    exam: Exam;
    onClose: () => void;
    onGrade: (examId: string, points: number, maxPoints: number) => void;
}) {
    const [points, setPoints] = useState(exam.points?.toString() || '');
    const [maxPoints, setMaxPoints] = useState(exam.maxPoints?.toString() || '100');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const p = parseFloat(points);
        const m = parseFloat(maxPoints);
        if (isNaN(p) || isNaN(m) || p < 0 || m <= 0) return;
        onGrade(exam.id, p, m);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl">
                <div className="p-6 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold">Prüfung bewerten</h3>
                            <p className="text-sm text-muted-foreground">{exam.traineeName} - {exam.subject}</p>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
                    </div>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-2">Punkte</label>
                            <input type="number" value={points} onChange={e => setPoints(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border" min="0" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Max. Punkte</label>
                            <input type="number" value={maxPoints} onChange={e => setMaxPoints(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-muted border border-border" min="1" required />
                        </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-3 rounded-xl glass-effect font-medium">Abbrechen</button>
                        <button type="submit" className="btn-accent flex-1 px-4 py-3 rounded-xl font-medium">Speichern</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
