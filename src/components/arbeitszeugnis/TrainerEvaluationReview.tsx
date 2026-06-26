'use client';

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  User,
  Calendar,
  Clock,
  Shield,
  Pencil,
} from 'lucide-react';
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
  releaseRating?: string | null;
  releaseComment?: string | null;
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
  trainerId?: string;
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
  trainerId,
  existingSoftskillRatings = [],
  onApprove,
  onReject,
  onSave,
}: TrainerEvaluationReviewProps) {
  const [loading, setLoading] = useState(false);
  const [showSoftskills, setShowSoftskills] = useState(true);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [editReason, setEditReason] = useState('');

  // Form state
  const [trainerRating, setTrainerRating] = useState(
    evaluation.trainerRating || ''
  );
  const [trainerComment, setTrainerComment] = useState(
    evaluation.trainerComment || ''
  );
  const [releaseRating, setReleaseRating] = useState(
    evaluation.releaseRating || ''
  );
  const [releaseComment, setReleaseComment] = useState(
    evaluation.releaseComment || ''
  );
  const [isEditing, setIsEditing] = useState(false);
  const [softskillRatings, setSoftskillRatings] = useState<
    Record<string, string>
  >(
    existingSoftskillRatings.reduce(
      (acc, r) => ({ ...acc, [r.criterionId]: r.selfRating || '' }),
      {}
    )
  );
  const [trainerSoftskillRatings, setTrainerSoftskillRatings] = useState<
    Record<string, string>
  >(
    existingSoftskillRatings.reduce(
      (acc, r) => ({ ...acc, [r.criterionId]: r.trainerRating || '' }),
      {}
    )
  );

  const isReadOnly = evaluation.status === 'APPROVED' && !isEditing;

  const handleSave = async () => {
    setLoading(true);
    try {
      const isReleaseEdit = evaluation.status === 'APPROVED' && isEditing;
      const payload: Record<string, unknown> = {
        trainerRating,
        trainerComment,
        softskillRatings: Object.entries(trainerSoftskillRatings)
          .filter(([_, rating]) => rating)
          .map(([criterionId, rating]) => ({
            criterionId,
            trainerRating: rating,
          })),
      };

      if (isReleaseEdit) {
        payload.isReleaseEdit = true;
        payload.releaseRating = releaseRating || undefined;
        payload.releaseComment = releaseComment || undefined;
        payload.editReason = editReason || undefined;
        if (trainerId) {
          payload.trainerId = trainerId;
        }
      }

      const res = await fetch(`/api/trainer/evaluations/${evaluation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success('Bewertung gespeichert');
        setIsEditing(false);
        setEditReason('');
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
        toast.success(
          action === 'approve'
            ? 'Bewertung genehmigt'
            : 'Zur Korrektur zurückgesendet'
        );
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

  const handleTrainerSoftskillChange = (
    criterionId: string,
    rating: string
  ) => {
    setTrainerSoftskillRatings(prev => ({ ...prev, [criterionId]: rating }));
  };

  // Calculate deviation
  const selfGrade = parseInt(evaluation.selfRating || '0');
  const trainerGrade = parseInt(trainerRating || '0');
  const deviation =
    selfGrade && trainerGrade ? Math.abs(selfGrade - trainerGrade) : null;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-3">
              <User className="text-muted-foreground h-5 w-5" />
              {trainee.fullName}
              <Badge
                variant={
                  evaluation.status === 'APPROVED'
                    ? 'default'
                    : evaluation.status === 'REJECTED'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {evaluation.status === 'SUBMITTED'
                  ? 'Zur Prüfung'
                  : evaluation.status}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1 flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                KW {evaluation.weekNumber} / {evaluation.year}
              </span>
              <span>Phase {evaluation.ausbildungsjahr}</span>
              {evaluation.selfSubmittedAt && (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Eingereicht:{' '}
                  {new Date(evaluation.selfSubmittedAt).toLocaleDateString(
                    'de-DE'
                  )}
                </span>
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ARP Theme */}
        {evaluation.arpThemeText && (
          <div className="bg-accent/5 border-accent/20 rounded-lg border p-3">
            <p className="text-muted-foreground mb-1 text-sm font-medium">
              ARP-Thema
            </p>
            <p className="text-sm">{evaluation.arpThemeText}</p>
          </div>
        )}

        {/* 3-Column Comparison: Azubi / Trainer / Freigabe */}
        <div className="grid grid-cols-3 gap-4">
          {/* Trainee Self-Assessment */}
          <div className="bg-card/30 border-border/50 space-y-3 rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">
              Azubi Selbsteinschätzung
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm">Note:</span>
              <Badge variant="outline" className="text-lg">
                {GRADE_OPTIONS.find(g => g.value === evaluation.selfRating)
                  ?.label || '-'}
              </Badge>
            </div>
            {evaluation.selfComment && (
              <div>
                <p className="text-muted-foreground text-xs">Kommentar:</p>
                <p className="mt-1 text-sm">{evaluation.selfComment}</p>
              </div>
            )}
          </div>

          {/* Trainer Assessment */}
          <div className="bg-accent/5 border-accent/20 space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="text-accent text-sm font-medium">
                Trainer Bewertung
              </p>
              {evaluation.status === 'APPROVED' && !isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1 text-xs text-amber-400 transition-colors hover:text-amber-300"
                >
                  <Pencil className="h-3 w-3" />
                  Bearbeiten
                </button>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-muted-foreground text-sm">Note:</label>
              <Select
                value={trainerRating}
                onValueChange={setTrainerRating}
                disabled={isReadOnly}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="Bewertung abgeben..." />
                </SelectTrigger>
                <SelectContent>
                  {GRADE_OPTIONS.map(grade => (
                    <SelectItem key={grade.value} value={grade.value}>
                      <span className={grade.color}>{grade.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Deviation Indicator */}
            {deviation !== null && (
              <div
                className={`rounded px-2 py-1 text-xs ${
                  deviation === 0
                    ? 'bg-green-500/20 text-green-400'
                    : deviation <= 1
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-red-500/20 text-red-400'
                }`}
              >
                Abweichung: {deviation} {deviation === 1 ? 'Note' : 'Noten'}
              </div>
            )}
          </div>

          {/* Release Grade */}
          <div className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-400">
              <Shield className="h-3.5 w-3.5" />
              Freigabenote
            </p>
            <div className="space-y-2">
              <label className="text-muted-foreground text-sm">Note:</label>
              <Select value={releaseRating} onValueChange={setReleaseRating}>
                <SelectTrigger className="bg-background/50 border-emerald-500/20">
                  <SelectValue placeholder="Freigabenote..." />
                </SelectTrigger>
                <SelectContent>
                  {GRADE_OPTIONS.map(grade => (
                    <SelectItem key={grade.value} value={grade.value}>
                      <span className={grade.color}>{grade.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground text-[10px]">
              Endgültige Note nach Besprechung mit dem Auszubildenden
            </p>
          </div>
        </div>

        {/* Trainer Comment */}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Trainer-Kommentar (max. 500 Zeichen)
          </label>
          <Textarea
            placeholder="Feedback für den Azubi..."
            value={trainerComment}
            onChange={e => setTrainerComment(e.target.value.substring(0, 500))}
            disabled={isReadOnly}
            className="bg-background/50 min-h-[80px]"
          />
          <p className="text-muted-foreground text-right text-xs">
            {trainerComment.length}/500
          </p>
        </div>

        {/* Skills Section */}
        <div className="border-t pt-4">
          <button
            type="button"
            onClick={() => setShowSoftskills(!showSoftskills)}
            className="hover:text-accent flex w-full items-center justify-between gap-2 text-sm font-medium transition-colors"
          >
            <span>MES Softskill-Bewertung vergleichen</span>
            {showSoftskills ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showSoftskills && (
            <div className="mt-4">
              <SoftskillRatingGrid
                ratings={softskillRatings}
                trainerRatings={trainerSoftskillRatings}
                onChange={() => {}}
                onTrainerChange={handleTrainerSoftskillChange}
                readOnly={isReadOnly}
                showTrainerRatings={true}
                isTrainer={true}
              />
            </div>
          )}
        </div>

        {/* Edit Reason (when editing approved evaluation) */}
        {isEditing && evaluation.status === 'APPROVED' && (
          <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
            <label className="text-sm font-medium text-amber-400">
              Änderungsgrund
            </label>
            <Textarea
              placeholder="Warum wird die Bewertung geändert?"
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
              className="bg-background/50 min-h-[60px]"
            />
          </div>
        )}

        {/* Action Buttons */}
        {isEditing && evaluation.status === 'APPROVED' ? (
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setIsEditing(false);
                setEditReason('');
              }}
              disabled={loading}
            >
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={loading || !trainerRating}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Änderungen speichern
            </Button>
          </div>
        ) : (
          !isReadOnly && (
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => setShowRejectModal(true)}
                disabled={loading}
                className="text-destructive hover:text-destructive"
              >
                <X className="mr-2 h-4 w-4" />
                Zur Korrektur
              </Button>
              <Button
                onClick={() => handleAction('approve')}
                disabled={loading || !trainerRating}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Genehmigen
              </Button>
            </div>
          )
        )}

        {/* Rejection Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="mx-4 w-full max-w-md">
              <CardHeader>
                <CardTitle>Korrektur anfordern</CardTitle>
                <CardDescription>
                  Bitte geben Sie einen Grund für die Ablehnung an.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder="Was muss der Azubi korrigieren?"
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  className="min-h-[100px]"
                />
                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowRejectModal(false)}
                  >
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
