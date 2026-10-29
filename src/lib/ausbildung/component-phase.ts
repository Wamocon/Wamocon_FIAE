/**
 * The group of a training component in the lists of the activity report:
 * 1 and 2 are the two phases, 3 is everything else (integrative content, the
 * elective qualifications of KfBM and rows without a phase).
 *
 * The rows of a catalog carry the phase in `phase` (KfBM has no training year),
 * the old FIAE rows carry it in `trainingYear`. The phase wins.
 */
export type ComponentPhase = 1 | 2 | 3;

export function componentPhase(component: {
  phase?: number | null;
  trainingYear?: number | null;
}): ComponentPhase {
  if (component.phase === 1 || component.phase === 2) return component.phase;
  if (component.trainingYear === 1 || component.trainingYear === 2) {
    return component.trainingYear;
  }
  return 3;
}
