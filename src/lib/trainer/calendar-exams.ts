/**
 * The exams of a trainee in the calendar of the trainer. The calendar read only
 * the blocks of the trainee (ausbildung_blocks), so an exam the trainee entered
 * himself (school_exams, for example "Netzwerktechnik") never showed up there.
 * The exams are drawn as blocks of the type EXAM now, view only (a block made
 * of an exam has no trainer who created it, so it can be neither edited nor
 * deleted in the calendar).
 *
 * As in the calendar of the trainee, an exam is left out when a block of the
 * type EXAM starts on the same day (the same appointment is not drawn twice).
 * Pure, no imports.
 */

export interface CalendarExam {
  id: string;
  examDate: string;
  subject: string;
  examTypeValue?: string | null;
  isPersonal?: boolean | null;
}

export interface CalendarBlockLike {
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
  examSubType?: null;
}

const dayOf = (value: string) => new Date(value).toISOString().slice(0, 10);

export function examsAsBlocks(
  exams: readonly CalendarExam[],
  blocks: ReadonlyArray<Pick<CalendarBlockLike, 'blockType' | 'startDate'>>,
  typeLabel: (examType: string | null | undefined) => string
): CalendarBlockLike[] {
  const examBlockDays = new Set(
    blocks.filter(b => b.blockType === 'EXAM').map(b => dayOf(b.startDate))
  );
  return exams
    .filter(exam => {
      if (Number.isNaN(new Date(exam.examDate).getTime())) return false;
      return !examBlockDays.has(dayOf(exam.examDate));
    })
    .map(exam => {
      const date = new Date(exam.examDate);
      return {
        id: `exam:${exam.id}`,
        calendarWeek: 0,
        year: date.getFullYear(),
        startDate: exam.examDate,
        endDate: exam.examDate,
        blockType: 'EXAM',
        blockNumber: null,
        title: exam.subject,
        notes: null,
        description: typeLabel(exam.examTypeValue),
        createdByTrainerId: null,
        isPersonal: !!exam.isPersonal,
        examSubType: null,
      };
    });
}
