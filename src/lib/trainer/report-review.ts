/**
 * Pure helpers of the review dialog of an Ausbildungsnachweis (trainer): what
 * the dialog is called, how hours are written and what is still missing before
 * the report can be approved. Client safe (no database).
 */

export type ReportStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** Key of the title of the dialog: "prüfen" only while there is something to check. */
export function reviewTitleKey(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'trainer.reports.modal.titleApproved';
    case 'REJECTED':
      return 'trainer.reports.modal.titleRejected';
    case 'DRAFT':
      return 'trainer.reports.modal.titleDraft';
    default:
      return 'trainer.reports.modal.title';
  }
}

/**
 * Hours written like the language: one decimal with a comma in German (0,0),
 * with a point in English. `fixed` always shows the decimal, otherwise a whole
 * number stays whole (8, 7,5).
 */
export function formatHours(
  value: number,
  language: string = 'de',
  fixed = false
): string {
  const number = Number.isFinite(value) ? value : 0;
  return number.toLocaleString(language === 'en' ? 'en-US' : 'de-DE', {
    minimumFractionDigits: fixed ? 1 : 0,
    maximumFractionDigits: 1,
  });
}

/** What the trainer still has to do before a report can be approved. */
export type ApproveMissing = 'entries' | 'grades' | 'skills';

export function approveMissing(input: {
  entryCount: number;
  allEntriesGraded: boolean;
  allSkillsRated: boolean;
}): ApproveMissing[] {
  // Without an entry there is nothing to grade: the report can only be rejected
  if (input.entryCount === 0) return ['entries'];
  const missing: ApproveMissing[] = [];
  if (!input.allEntriesGraded) missing.push('grades');
  if (!input.allSkillsRated) missing.push('skills');
  return missing;
}
