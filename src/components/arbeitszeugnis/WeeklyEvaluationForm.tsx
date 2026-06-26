'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Save,
  Send,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  GraduationCap,
} from 'lucide-react';
import { toast } from 'sonner';
import SoftskillRatingGrid from './SoftskillRatingGrid';
import { useAuth } from '@/contexts/AuthContext';

interface ARPUseCase {
  id: string;
  letter: string;
  description: string;
  componentId: string;
  orderIndex?: number;
  component?: {
    code: string | null;
    title: string | null;
  };
}

interface Evaluation {
  id: string;
  weekNumber: number;
  year: number;
  ausbildungsjahr: number;
  selfRating: string | null;
  selfComment: string | null;
  trainerRating: string | null;
  trainerComment: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  arpUseCaseId: string | null;
  arpThemeText: string | null;
  rejectionReason: string | null;
}

interface SoftskillRating {
  criterionId: string;
  selfRating: string | null;
  trainerRating: string | null;
}

interface WeeklyEvaluationFormProps {
  weekNumber: number;
  year: number;
  ausbildungsjahr: number;
  existingEvaluation?: Evaluation;
  existingSoftskillRatings?: SoftskillRating[];
  onSave?: () => void;
  onSubmit?: () => void;
}

const GRADE_OPTIONS = [
  {
    value: '1',
    label: 'Sehr gut',
    sublabel: 'Note 1',
    color: 'text-emerald-400',
  },
  { value: '2', label: 'Gut', sublabel: 'Note 2', color: 'text-green-400' },
  {
    value: '3',
    label: 'Befriedigend',
    sublabel: 'Note 3',
    color: 'text-yellow-400',
  },
  {
    value: '4',
    label: 'Ausreichend',
    sublabel: 'Note 4',
    color: 'text-orange-400',
  },
  {
    value: '5',
    label: 'Mangelhaft',
    sublabel: 'Note 5',
    color: 'text-red-400',
  },
  {
    value: '6',
    label: 'Ungenügend',
    sublabel: 'Note 6',
    color: 'text-red-600',
  },
];

export default function WeeklyEvaluationForm({
  weekNumber,
  year,
  ausbildungsjahr,
  existingEvaluation,
  existingSoftskillRatings,
  onSave,
  onSubmit,
}: WeeklyEvaluationFormProps) {
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [arpUseCases, setArpUseCases] = useState<ARPUseCase[]>([]);
  const [showSoftskills, setShowSoftskills] = useState(false);

  // Form state
  const [arpUseCaseId, setArpUseCaseId] = useState(
    existingEvaluation?.arpUseCaseId || ''
  );
  const [arpThemeText, setArpThemeText] = useState(
    existingEvaluation?.arpThemeText || ''
  );
  const [selfRating, setSelfRating] = useState(
    existingEvaluation?.selfRating || ''
  );
  const [selfComment, setSelfComment] = useState(
    existingEvaluation?.selfComment || ''
  );
  const [softskillRatings, setSoftskillRatings] = useState<
    Record<string, string>
  >(
    existingSoftskillRatings?.reduce(
      (acc, r) => ({ ...acc, [r.criterionId]: r.selfRating || '' }),
      {}
    ) || {}
  );

  const isReadOnly = existingEvaluation?.status === 'APPROVED';
  const isRejected = existingEvaluation?.status === 'REJECTED';

  // Fetch ARP use cases
  useEffect(() => {
    async function fetchArpUseCases() {
      try {
        const res = await fetch('/api/training-use-cases', {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          setArpUseCases(data.useCases || []);
        }
      } catch (error) {
        console.error('Error fetching ARP use cases:', error);
      }
    }
    fetchArpUseCases();
  }, []);

  // Group use cases by component
  const groupedUseCases = useMemo(() => {
    const groups: Record<
      string,
      { code: string; title: string; useCases: ARPUseCase[] }
    > = {};

    arpUseCases.forEach(uc => {
      const componentCode = uc.component?.code || 'ANDERE';
      const componentTitle = uc.component?.title || 'Sonstige';

      if (!groups[componentCode]) {
        groups[componentCode] = {
          code: componentCode,
          title: componentTitle,
          useCases: [],
        };
      }
      groups[componentCode].useCases.push(uc);
    });

    // Sort groups by code
    return Object.values(groups).sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );
  }, [arpUseCases]);

  const handleSave = async (submit = false) => {
    if (submit) {
      setSubmitting(true);
    } else {
      setSaving(true);
    }

    try {
      const res = await fetch('/api/trainee/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: profile?.id,
          weekNumber,
          year,
          ausbildungsjahr,
          arpUseCaseId: arpUseCaseId || null,
          arpThemeText: arpThemeText || null,
          selfRating: selfRating || null,
          selfComment: selfComment || null,
          softskillRatings: Object.entries(softskillRatings)
            .filter(([_, rating]) => rating)
            .map(([criterionId, rating]) => ({
              criterionId,
              selfRating: rating,
            })),
          submit,
        }),
      });

      if (res.ok) {
        toast.success(
          submit ? 'Bewertung zur Prüfung eingereicht!' : 'Entwurf gespeichert'
        );
        if (submit && onSubmit) onSubmit();
        if (!submit && onSave) onSave();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Fehler beim Speichern');
      }
    } catch (error) {
      toast.error('Netzwerkfehler - bitte erneut versuchen');
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  };

  const handleSoftskillChange = (criterionId: string, rating: string) => {
    setSoftskillRatings(prev => ({ ...prev, [criterionId]: rating }));
  };

  const getStatusBadge = () => {
    switch (existingEvaluation?.status) {
      case 'APPROVED':
        return (
          <Badge className="border-emerald-500/30 bg-emerald-500/20 text-emerald-400">
            Genehmigt
          </Badge>
        );
      case 'REJECTED':
        return (
          <Badge className="border-red-500/30 bg-red-500/20 text-red-400">
            Abgelehnt
          </Badge>
        );
      case 'SUBMITTED':
        return (
          <Badge className="border-blue-500/30 bg-blue-500/20 text-blue-400">
            Zur Prüfung
          </Badge>
        );
      default:
        return (
          <Badge className="border-slate-500/30 bg-slate-500/20 text-slate-400">
            Neu
          </Badge>
        );
    }
  };

  // Get the selected use case for display
  const selectedUseCase = arpUseCases.find(uc => uc.id === arpUseCaseId);

  return (
    <Card className="border-border bg-card/90 shadow-xl backdrop-blur-xl">
      <CardHeader className="border-border border-b pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="from-primary/20 to-primary/5 border-primary/20 rounded-xl border bg-gradient-to-br p-2.5">
              <GraduationCap className="text-primary h-5 w-5" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-3 text-xl">
                KW {weekNumber} / {year}
                {getStatusBadge()}
              </CardTitle>
              <CardDescription className="mt-0.5">
                Phase {ausbildungsjahr} – Wöchentliche Leistungsbewertung
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* Rejection Warning */}
        {isRejected && existingEvaluation?.rejectionReason && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div>
              <p className="font-medium text-red-400">Korrektur erforderlich</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {existingEvaluation.rejectionReason}
              </p>
            </div>
          </div>
        )}

        {/* ARP Theme Selection */}
        <div className="space-y-3">
          <label className="text-foreground flex items-center gap-2 text-sm font-medium">
            <span className="bg-primary h-1.5 w-1.5 rounded-full" />
            ARP-Thema (Ausbildungsrahmenplan)
          </label>

          <Select
            value={arpUseCaseId}
            onValueChange={setArpUseCaseId}
            disabled={isReadOnly}
          >
            <SelectTrigger className="bg-muted border-border hover:border-border/80 h-11 text-base transition-colors">
              <SelectValue placeholder="Thema aus ARP auswählen...">
                {selectedUseCase && (
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-primary shrink-0 font-bold">
                      [{selectedUseCase.component?.code}]{' '}
                      {selectedUseCase.letter})
                    </span>
                    <span className="truncate">
                      {selectedUseCase.description}
                    </span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[400px] max-w-[700px]">
              {groupedUseCases.length === 0 ? (
                <div className="text-muted-foreground p-4 text-center text-sm">
                  Keine Themen verfügbar
                </div>
              ) : (
                groupedUseCases.map(group => (
                  <SelectGroup key={group.code}>
                    <SelectLabel className="text-primary/80 bg-muted/30 border-border border-b px-3 py-2 text-xs font-bold">
                      [{group.code}] {group.title}
                    </SelectLabel>
                    {group.useCases.map(useCase => (
                      <SelectItem
                        key={useCase.id}
                        value={useCase.id}
                        className="py-2.5 pl-6"
                      >
                        <div className="flex max-w-[620px] items-start gap-2">
                          <span className="text-primary min-w-[20px] shrink-0 font-bold">
                            {useCase.letter})
                          </span>
                          <span className="text-foreground text-sm leading-relaxed">
                            {useCase.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))
              )}
            </SelectContent>
          </Select>

          <div className="relative">
            <span className="text-muted-foreground absolute top-3 left-3 text-xs">
              oder
            </span>
            <Textarea
              placeholder="Eigenes Thema manuell eingeben..."
              value={arpThemeText}
              onChange={e => setArpThemeText(e.target.value)}
              disabled={isReadOnly || !!arpUseCaseId}
              className="bg-muted border-border hover:border-border/80 min-h-[48px] resize-none pl-12 transition-colors"
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-border border-t" />

        {/* Overall Self-Rating */}
        <div className="space-y-3">
          <label className="text-foreground flex items-center gap-2 text-sm font-medium">
            <span className="bg-primary h-1.5 w-1.5 rounded-full" />
            Selbsteinschätzung – Gesamtnote dieser Woche
          </label>

          <Select
            value={selfRating}
            onValueChange={setSelfRating}
            disabled={isReadOnly}
          >
            <SelectTrigger className="bg-muted border-border hover:border-border/80 h-11 text-base transition-colors">
              <SelectValue placeholder="Note auswählen...">
                {selfRating && (
                  <span className="flex items-center gap-3">
                    <span
                      className={`text-lg font-bold ${GRADE_OPTIONS.find(g => g.value === selfRating)?.color}`}
                    >
                      {selfRating}
                    </span>
                    <span className="text-foreground">
                      {GRADE_OPTIONS.find(g => g.value === selfRating)?.label}
                    </span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {GRADE_OPTIONS.map(grade => (
                <SelectItem
                  key={grade.value}
                  value={grade.value}
                  className="py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-8 text-xl font-bold ${grade.color}`}>
                      {grade.value}
                    </span>
                    <span className="text-foreground font-medium">
                      {grade.label}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      ({grade.sublabel})
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Self Comment */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-foreground flex items-center gap-2 text-sm font-medium">
              <span className="bg-primary h-1.5 w-1.5 rounded-full" />
              Kommentar zur Woche
            </label>
            <span className="text-muted-foreground text-xs">
              {selfComment.length}/500 Zeichen
            </span>
          </div>

          <Textarea
            placeholder="Beschreibe deine Leistungen, Herausforderungen und Lernerfolge dieser Woche..."
            value={selfComment}
            onChange={e => setSelfComment(e.target.value.substring(0, 500))}
            disabled={isReadOnly}
            className="bg-muted border-border hover:border-border/80 min-h-[120px] resize-none transition-colors"
          />
        </div>

        {/* Divider */}
        <div className="border-border border-t" />

        {/* Skills Section */}
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setShowSoftskills(!showSoftskills)}
            className="bg-muted border-border hover:border-border/80 group flex w-full items-center justify-between rounded-lg border p-3 transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="bg-primary/60 h-1.5 w-1.5 rounded-full" />
              <span className="text-foreground text-sm font-medium">
                MES Softskill-Bewertung
              </span>
              <span className="text-muted-foreground text-xs">
                (19 Kriterien)
              </span>
            </div>
            <div className="text-muted-foreground group-hover:text-foreground/70 flex items-center gap-2 transition-colors">
              <span className="text-xs">
                {showSoftskills ? 'Ausblenden' : 'Anzeigen'}
              </span>
              {showSoftskills ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          </button>

          {showSoftskills && (
            <div className="bg-muted/50 border-border/50 rounded-lg border p-4">
              <SoftskillRatingGrid
                ratings={softskillRatings}
                onChange={handleSoftskillChange}
                readOnly={isReadOnly}
                showTrainerRatings={false}
              />
            </div>
          )}
        </div>

        {/* Trainer Feedback */}
        {existingEvaluation?.trainerRating && (
          <div className="bg-accent/10 border-accent/20 space-y-3 rounded-xl border p-4">
            <p className="text-accent flex items-center gap-2 text-sm font-medium">
              <GraduationCap className="h-4 w-4" />
              Trainer-Bewertung
            </p>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground text-sm">Gesamtnote:</span>
              <Badge variant="secondary" className="px-3 py-1 text-lg">
                {GRADE_OPTIONS.find(
                  g => g.value === existingEvaluation.trainerRating
                )?.label || existingEvaluation.trainerRating}
              </Badge>
            </div>
            {existingEvaluation.trainerComment && (
              <div className="border-border border-t pt-2">
                <span className="text-muted-foreground text-sm">
                  Kommentar:
                </span>
                <p className="text-foreground mt-1 text-sm">
                  {existingEvaluation.trainerComment}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {!isReadOnly && (
          <div className="border-border flex justify-end gap-3 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => handleSave(false)}
              disabled={saving || submitting}
              className="border-border/60 hover:bg-muted min-w-[140px]"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Entwurf speichern
            </Button>
            <Button
              onClick={() => handleSave(true)}
              disabled={saving || submitting || !selfRating}
              className="from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 min-w-[170px] bg-gradient-to-r"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Zur Prüfung einreichen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
