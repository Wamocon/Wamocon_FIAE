'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X, ChevronDown, ChevronUp, User, Calendar, Clock } from 'lucide-react';
import { toast } from 'sonner';
import SoftskillRatingGrid from './SoftskillRatingGrid';

interface Trainee {
    id: string;
    fullName: string;
    email: string;
}

interface Evaluation {
    id: string;
    traineeId: string;
    weekNumber: number;
    year: number;
    ausbildungsjahr: number;
    selfRating: string | null;
    selfComment: string | null;
    trainerRating: string | null;
    trainerComment: string | null;
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    arpThemeText: string | null;
    selfSubmittedAt: string | null;
}

interface SoftskillRating {
    criterionId: string;
    selfRating: string | null;
    trainerRating: string | null;
}

interface TrainerEvaluationReviewProps {
    evaluation: Evaluation;
    trainee: Trainee;
    existingSoftskillRatings?: SoftskillRating[];
    onApprove?: () => void;
    onReject?: () => void;
    onSave?: () => void;
}

const GRADE_OPTIONS = [
    { value: '1', label: 'sehr gut (1)', color: 'text-green-500' },
    { value: '2', label: 'gut (2)', color: 'text-green-400' },
    { value: '3', label: 'befriedigend (3)', color: 'text-yellow-500' },
    { value: '4', label: 'ausreichend (4)', color: 'text-orange-500' },
    { value: '5', label: 'mangelhaft (5)', color: 'text-red-400' },
    { value: '6', label: 'ungenügend (6)', color: 'text-red-600' },
];

export default function TrainerEvaluationReview({
    evaluation,
    trainee,
    existingSoftskillRatings = [],
    onApprove,
    onReject,
    onSave,
}: TrainerEvaluationReviewProps) {
    const [loading, setLoading] = useState(false);
    const [showSoftskills, setShowSoftskills] = useState(true);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');

    // Form state
    const [trainerRating, setTrainerRating] = useState(evaluation.trainerRating || '');
    const [trainerComment, setTrainerComment] = useState(evaluation.trainerComment || '');
    const [softskillRatings, setSoftskillRatings] = useState<Record<string, string>>(
        existingSoftskillRatings.reduce((acc, r) => ({ ...acc, [r.criterionId]: r.selfRating || '' }), {})
    );
    const [trainerSoftskillRatings, setTrainerSoftskillRatings] = useState<Record<string, string>>(
        existingSoftskillRatings.reduce((acc, r) => ({ ...acc, [r.criterionId]: r.trainerRating || '' }), {})
    );

    const isReadOnly = evaluation.status === 'APPROVED';

    const handleSave = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/trainer/evaluations/${evaluation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trainerRating,
                    trainerComment,
                    softskillRatings: Object.entries(trainerSoftskillRatings)
                        .filter(([_, rating]) => rating)
                        .map(([criterionId, rating]) => ({ criterionId, trainerRating: rating })),
                }),
            });

            if (res.ok) {
                toast.success('Bewertung gespeichert');
                onSave?.();
            } else {
                const error = await res.json();
                toast.error(error.error || 'Fehler beim Speichern');
            }
        } catch (error) {
            toast.error('Netzwerkfehler');
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (action: 'approve' | 'reject') => {
        if (action === 'approve' && !trainerRating) {
            toast.error('Bitte geben Sie zuerst eine Gesamtbewertung ab');
            return;
        }

        setLoading(true);
        try {
            // First save the ratings
            if (action === 'approve') {
                await handleSave();
            }

            const res = await fetch(`/api/trainer/evaluations/${evaluation.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    rejectionReason: action === 'reject' ? rejectionReason : null,
                }),
            });

            if (res.ok) {
                toast.success(action === 'approve' ? 'Bewertung genehmigt' : 'Zur Korrektur zurückgesendet');
                if (action === 'approve') onApprove?.();
                if (action === 'reject') onReject?.();
                setShowRejectModal(false);
            } else {
                const error = await res.json();
                toast.error(error.error || 'Fehler bei der Aktion');
            }
        } catch (error) {
            toast.error('Netzwerkfehler');
        } finally {
            setLoading(false);
        }
    };

    const handleTrainerSoftskillChange = (criterionId: string, rating: string) => {
        setTrainerSoftskillRatings(prev => ({ ...prev, [criterionId]: rating }));
    };

    // Calculate deviation
    const selfGrade = parseInt(evaluation.selfRating || '0');
    const trainerGrade = parseInt(trainerRating || '0');
    const deviation = selfGrade && trainerGrade ? Math.abs(selfGrade - trainerGrade) : null;

    return (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-3">
                            <User className="h-5 w-5 text-muted-foreground" />
                            {trainee.fullName}
                            <Badge
                                variant={
                                    evaluation.status === 'APPROVED' ? 'default' :
                                        evaluation.status === 'REJECTED' ? 'destructive' :
                                            'secondary'
                                }
                            >
                                {evaluation.status === 'SUBMITTED' ? 'Zur Prüfung' : evaluation.status}
                            </Badge>
                        </CardTitle>
                        <CardDescription className="flex items-center gap-4 mt-1">
                            <span className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" />
                                KW {evaluation.weekNumber} / {evaluation.year}
                            </span>
                            <span>{evaluation.ausbildungsjahr}. Ausbildungsjahr</span>
                            {evaluation.selfSubmittedAt && (
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <Clock className="h-3.5 w-3.5" />
                                    Eingereicht: {new Date(evaluation.selfSubmittedAt).toLocaleDateString('de-DE')}
                                </span>
                            )}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-6">
                {/* ARP Theme */}
                {evaluation.arpThemeText && (
                    <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
                        <p className="text-sm font-medium text-muted-foreground mb-1">ARP-Thema</p>
                        <p className="text-sm">{evaluation.arpThemeText}</p>
                    </div>
                )}

                {/* Side-by-Side Comparison */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Trainee Self-Assessment */}
                    <div className="space-y-3 p-4 rounded-lg bg-card/30 border border-border/50">
                        <p className="text-sm font-medium text-muted-foreground">Azubi Selbsteinschätzung</p>
                        <div className="flex items-center gap-2">
                            <span className="text-sm">Note:</span>
                            <Badge variant="outline" className="text-lg">
                                {GRADE_OPTIONS.find(g => g.value === evaluation.selfRating)?.label || '-'}
                            </Badge>
                        </div>
                        {evaluation.selfComment && (
                            <div>
                                <p className="text-xs text-muted-foreground">Kommentar:</p>
                                <p className="text-sm mt-1">{evaluation.selfComment}</p>
                            </div>
                        )}
                    </div>

                    {/* Trainer Assessment */}
                    <div className="space-y-3 p-4 rounded-lg bg-accent/5 border border-accent/20">
                        <p className="text-sm font-medium text-accent">Trainer Bewertung</p>
                        <div className="space-y-2">
                            <label className="text-sm text-muted-foreground">Note:</label>
                            <Select value={trainerRating} onValueChange={setTrainerRating} disabled={isReadOnly}>
                                <SelectTrigger className="bg-background/50">
                                    <SelectValue placeholder="Bewertung abgeben..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {GRADE_OPTIONS.map((grade) => (
                                        <SelectItem key={grade.value} value={grade.value}>
                                            <span className={grade.color}>{grade.label}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Deviation Indicator */}
                        {deviation !== null && (
                            <div className={`text-xs px-2 py-1 rounded ${deviation === 0 ? 'bg-green-500/20 text-green-400' :
                                    deviation <= 1 ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-red-500/20 text-red-400'
                                }`}>
                                Abweichung: {deviation} {deviation === 1 ? 'Note' : 'Noten'}
                            </div>
                        )}
                    </div>
                </div>

                {/* Trainer Comment */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">Trainer-Kommentar (max. 500 Zeichen)</label>
                    <Textarea
                        placeholder="Feedback für den Azubi..."
                        value={trainerComment}
                        onChange={(e) => setTrainerComment(e.target.value.substring(0, 500))}
                        disabled={isReadOnly}
                        className="bg-background/50 min-h-[80px]"
                    />
                    <p className="text-xs text-muted-foreground text-right">{trainerComment.length}/500</p>
                </div>

                {/* Softskills Section */}
                <div className="border-t pt-4">
                    <button
                        type="button"
                        onClick={() => setShowSoftskills(!showSoftskills)}
                        className="flex items-center gap-2 text-sm font-medium hover:text-accent transition-colors w-full justify-between"
                    >
                        <span>MES Softskill-Bewertung vergleichen</span>
                        {showSoftskills ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    {showSoftskills && (
                        <div className="mt-4">
                            <SoftskillRatingGrid
                                ratings={softskillRatings}
                                trainerRatings={trainerSoftskillRatings}
                                onChange={() => { }}
                                onTrainerChange={handleTrainerSoftskillChange}
                                readOnly={isReadOnly}
                                showTrainerRatings={true}
                                isTrainer={true}
                            />
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                {!isReadOnly && (
                    <div className="flex justify-end gap-3 pt-4 border-t">
                        <Button
                            variant="outline"
                            onClick={() => setShowRejectModal(true)}
                            disabled={loading}
                            className="text-destructive hover:text-destructive"
                        >
                            <X className="h-4 w-4 mr-2" />
                            Zur Korrektur
                        </Button>
                        <Button
                            onClick={() => handleAction('approve')}
                            disabled={loading || !trainerRating}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                            Genehmigen
                        </Button>
                    </div>
                )}

                {/* Rejection Modal */}
                {showRejectModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <Card className="w-full max-w-md mx-4">
                            <CardHeader>
                                <CardTitle>Korrektur anfordern</CardTitle>
                                <CardDescription>Bitte geben Sie einen Grund für die Ablehnung an.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Textarea
                                    placeholder="Was muss der Azubi korrigieren?"
                                    value={rejectionReason}
                                    onChange={(e) => setRejectionReason(e.target.value)}
                                    className="min-h-[100px]"
                                />
                                <div className="flex justify-end gap-3">
                                    <Button variant="outline" onClick={() => setShowRejectModal(false)}>
                                        Abbrechen
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        onClick={() => handleAction('reject')}
                                        disabled={loading || !rejectionReason.trim()}
                                    >
                                        Ablehnen
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
