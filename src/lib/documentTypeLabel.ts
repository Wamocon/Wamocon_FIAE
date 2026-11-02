/**
 * Readable name of the type of a content document, for the trainer screens.
 *
 * The content editor showed one letter (T, E, S) and the use case page the raw name
 * (TRAINEE_QUESTION). A use case has two PDFs, the task and the model solution, and
 * the letter S stood for both, so they looked like an old and a new copy of the same
 * file. The labels name them.
 */

export type DocumentTypeKey =
  | 'THEORY'
  | 'EXERCISE'
  | 'TRAINEE_QUESTION'
  | 'TRAINER_SOLUTION';

const LABEL_KEYS: Record<DocumentTypeKey, string> = {
  THEORY: 'documentType.theory',
  EXERCISE: 'documentType.exercise',
  TRAINEE_QUESTION: 'documentType.task',
  TRAINER_SOLUTION: 'documentType.solution',
};

/** Locale key of the label, or null for a type this screen does not know. */
export function documentTypeLabelKey(
  documentType: string | null | undefined
): string | null {
  if (!documentType) return null;
  return LABEL_KEYS[documentType as DocumentTypeKey] ?? null;
}

/** Label for a type: the translated name, or the raw type if it is unknown. */
export function documentTypeLabel(
  documentType: string | null | undefined,
  t: (key: string) => string
): string {
  const key = documentTypeLabelKey(documentType);
  if (key) return t(key);
  return documentType ?? '';
}
