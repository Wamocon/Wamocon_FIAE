// Invented quiz JSON (schema 1.0) for the tests. Nothing here comes from the
// real files: the titles and texts are made up and follow only the form of the
// schema. The question texts equal those of the Word fixtures of the apply
// tests (quizLines), so a plan from Word and a plan from JSON can be compared.
import { DIR } from '../apply/fixtures';

export const SECTION = {
  t1: 'Komponente Teil 1 (1-15 Monate)',
  t2: 'Komponente Teil 2 (16-36 Monate)',
  all: 'Komponente - während der gesamten Ausbildung',
};

export const LEVEL_NAMES = ['leicht', 'mittel', 'schwer'] as const;

export interface QuizSpec {
  /** Quiz id like 1a, 6d, 24_1a */
  id: string;
  /** Component id like 01, 06.2, 10 */
  componentId: string;
  /** Component folder name of the Word tree, for example DIR.k1 */
  dir: string;
  /** Title of the quiz: the heading of the enabler */
  title?: string;
  /** Questions per level */
  count?: number;
  tag?: string;
}

/** "Komponente Teil 1 (...)/01 - Titel (§ ...)" split into section and component folder. */
export function splitDir(dir: string): { section: string; folder: string } {
  const at = dir.indexOf('/');
  return { section: dir.slice(0, at), folder: dir.slice(at + 1) };
}

export function jsonQuestions(
  quizId: string,
  levelName: string,
  count: number,
  tag: string
) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      id: `${quizId}-${levelName}-q${n}`,
      number: n,
      question: `Erfundene Frage ${tag}${n}?`,
      options: [
        { key: 'A', text: 'erste Antwort' },
        { key: 'B', text: 'zweite Antwort' },
        { key: 'C', text: 'dritte Antwort' },
        { key: 'D', text: 'vierte Antwort' },
      ],
      correct_answer: 'B',
      explanation: `Erfundene Begründung ZETA-${tag}${n}.`,
    };
  });
}

export function jsonQuiz(spec: QuizSpec): Record<string, any> {
  const { section, folder } = splitDir(spec.dir);
  const count = spec.count ?? 10;
  const letter = spec.id.slice(-1);
  const title =
    spec.title ?? `${spec.id.replace(/_\d/, '')}) Erfundenes Thema ${letter}`;
  const difficulties: Record<string, unknown> = {};
  for (const level of LEVEL_NAMES) {
    difficulties[level] = {
      label: level,
      source: `${section}/${folder}`,
      questions: jsonQuestions(
        spec.id,
        level,
        count,
        `${spec.tag ?? spec.id}${level === 'leicht' ? 'Low' : level === 'mittel' ? 'Medium' : 'High'}`
      ),
      attached_source: 'Enabler_Quizze_Low_Medium_High.json',
    };
  }
  const sourceFile = (file: string) =>
    `${section}/${folder}/Enablers/${spec.id}_Thema/Quiz/${spec.id}_Quiz_${file}.docx`;
  return {
    id: spec.id,
    title,
    category: section,
    source_files: {
      High: sourceFile('High'),
      Low: sourceFile('Low'),
      Medium: sourceFile('Medium'),
    },
    difficulties,
    curriculum_component: { id: spec.componentId, title: folder },
    training_section: section,
  };
}

export function lessonFile(quizzes: unknown[]): Record<string, any> {
  return {
    schema_version: '1.0',
    quiz_count: quizzes.length,
    difficulty_levels: [...LEVEL_NAMES],
    quizzes,
  };
}

export function jsonGlobalQuiz(
  id: string,
  count = 20,
  tag = 'g'
): Record<string, any> {
  return {
    id,
    curriculum_component: {
      id,
      title: `${id}) Erfundenes Globalthema (§ 4 Abs. 2 Nr. 1)`,
    },
    title: `${id}) Erfundenes Globalthema (§ 4 Abs. 2 Nr. 1)`,
    source: `00_Global_Quizze/Word/${id}_Global_Quiz_Thema.docx`,
    source_file: `${id}_Global_Quiz_Thema.docx`,
    source_json: 'Global_Quizze.json',
    questions: jsonQuestions(id, 'global', count, tag).map(q => ({
      ...q,
      id: `${id}-q${q.number}`,
    })),
  };
}

export function globalFile(quizzes: unknown[]): Record<string, any> {
  return {
    schema_version: '1.0',
    quiz_count: quizzes.length,
    quizzes,
  };
}

/** The quizzes of the sample: K1 (1a), K6.1 (6a), K6.2 (6d), K10 (10a), K20 (20a). */
export const SAMPLE_SPECS: QuizSpec[] = [
  { id: '1a', componentId: '01', dir: DIR.k1 },
  { id: '6a', componentId: '06.1', dir: DIR.k6_1 },
  { id: '6d', componentId: '06.2', dir: DIR.k6_2 },
  { id: '10a', componentId: '10', dir: DIR.k10 },
  { id: '20a', componentId: '20', dir: DIR.k20 },
];

export const SAMPLE_GLOBALS = ['01', '06.1', '06.2', '10', '20'];

export const sampleLesson = () => lessonFile(SAMPLE_SPECS.map(jsonQuiz));
export const sampleGlobal = () =>
  globalFile(SAMPLE_GLOBALS.map(id => jsonGlobalQuiz(id)));

/** Deep copy for a test that changes the sample. */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
