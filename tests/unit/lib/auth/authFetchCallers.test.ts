/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// The notification routes, every route of a trainee, of a trainer, of an admin
// or of the signed-in person (/api/trainer, /api/admin, /api/me), the
// activity report routes (activity-reports, weekly-evaluations,
// grade-edit-history) and the breadcrumb labels answer only with a bearer
// session. A browser call with a plain fetch() carries no token and would be
// answered with 401, so every caller has to use authFetch
// (src/lib/authFetch.ts). This test reads the sources and fails for a plain
// fetch() whose url is one of these routes, including a url kept in a
// variable before the call. A new caller that forgets authFetch fails here.
//
// Not listed on purpose: /api/trainee/lernfelder (master data, open without a
// session) and /api/trainee/evaluations/softskills (the public list of the
// softskill criteria).

const PROTECTED =
  /\/api\/(notifications|trainer|admin|me\/catalog(?:s|-requests)|activity-reports|weekly-evaluations|grade-edit-history|breadcrumb\/label|trainee\/(school|annual-summary|courses|dashboard|enablers|evaluations(?!\/softskills(?![\w-]))|feedback|knowledge-notes|lesson-progress|lessons|progress|quizzes|use-case-hours|use-cases))(?![\w-])/;
const SRC = join(process.cwd(), 'src');
const API = join(SRC, 'app', 'api');
// The wrapper itself calls fetch() with the url it is given, and names a route
const WRAPPER = join(SRC, 'lib', 'authFetch.ts');

function sourceFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full === API || full === WRAPPER) continue; // route handlers do not call themselves
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** The text a plain fetch() call is aimed at, or '' when it cannot be read. */
function targetOf(source: string, argStart: number) {
  const first = source.slice(argStart, argStart + 400).trimStart();
  if (/^[`'"]/.test(first)) return first.slice(0, 200);
  const ident = first.match(/^[A-Za-z_]\w*/)?.[0];
  if (!ident) return '';
  const declared = source.lastIndexOf(`${ident} =`, argStart);
  return declared < 0 ? '' : source.slice(declared, declared + 200);
}

/** Plain fetch() calls (not authFetch, not x.fetch) aimed at a protected route. */
function plainFetchViolations(source: string) {
  const violations: string[] = [];
  const call = /(^|[^\w.])fetch\(/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(source))) {
    const target = targetOf(source, match.index + match[0].length);
    if (PROTECTED.test(target)) violations.push(target.split('\n')[0].trim());
  }
  return violations;
}

describe('plainFetchViolations (the scanner itself)', () => {
  it('flags a plain fetch to a protected route', () => {
    expect(
      plainFetchViolations('await fetch(`/api/notifications?userId=1`)')
    ).toHaveLength(1);
    expect(
      plainFetchViolations("fetch('/api/trainee/school/blocks', {})")
    ).toHaveLength(1);
  });

  it('flags a url kept in a variable', () => {
    const source =
      "let url = `/api/trainee/school/reports?x=1`;\nconst res = await fetch(url, { cache: 'no-store' });";
    expect(plainFetchViolations(source)).toHaveLength(1);
  });

  it('accepts authFetch and other routes', () => {
    expect(
      plainFetchViolations("authFetch('/api/notifications?limit=30')")
    ).toEqual([]);
    expect(
      plainFetchViolations("fetch('/api/trainee/lernfelder', {})")
    ).toEqual([]);
    expect(
      plainFetchViolations("fetch('/api/trainee/evaluations/softskills')")
    ).toEqual([]);
    expect(plainFetchViolations('window.fetch("/api/notifications")')).toEqual(
      []
    );
  });

  it('flags a plain fetch to every activity report route', () => {
    const urls = [
      '/api/activity-reports?userId=1&limit=500',
      '/api/activity-reports',
      '/api/activity-reports/r1',
      '/api/activity-reports/r1/entries',
      '/api/activity-reports/r1/skill-ratings',
      '/api/weekly-evaluations?activityReportId=r1',
      '/api/weekly-evaluations',
      '/api/grade-edit-history?entityType=USE_CASE_ENTRY&entityId=e1',
      '/api/breadcrumb/label?entity=module&id=m1',
    ];
    for (const url of urls) {
      expect(plainFetchViolations(`fetch('${url}')`)).toHaveLength(1);
      expect(plainFetchViolations(`fetch(\`${url}\`)`)).toHaveLength(1);
      expect(plainFetchViolations(`authFetch('${url}')`)).toEqual([]);
    }
  });

  it('flags the trainer routes of the same name as well, they need a token too', () => {
    expect(
      plainFetchViolations("fetch('/api/trainer/activity-reports/r1')")
    ).toHaveLength(1);
    expect(
      plainFetchViolations("authFetch('/api/trainer/activity-reports/r1')")
    ).toEqual([]);
    expect(
      plainFetchViolations("fetch('/api/trainee/school/reports')")
    ).toHaveLength(1);
  });

  it('flags a plain fetch to every other route of a trainee', () => {
    const urls = [
      '/api/trainee/annual-summary?traineeId=1',
      '/api/trainee/courses?traineeId=1',
      '/api/trainee/courses/c1?traineeId=1',
      '/api/trainee/dashboard?userId=1',
      '/api/trainee/enablers/e1/documents',
      '/api/trainee/enablers/e1/quiz/submit',
      '/api/trainee/evaluations?userId=1',
      '/api/trainee/evaluations/ev1',
      '/api/trainee/feedback?traineeId=1',
      '/api/trainee/knowledge-notes',
      '/api/trainee/knowledge-notes/n1?traineeId=1',
      '/api/trainee/lesson-progress?userId=1&lessonId=2',
      '/api/trainee/lessons?userId=1',
      '/api/trainee/progress',
      '/api/trainee/quizzes?userId=1',
      '/api/trainee/quizzes/q1',
      '/api/trainee/quizzes/q1/submit',
      '/api/trainee/use-case-hours?traineeId=1',
      '/api/trainee/use-cases/u1/submit',
    ];
    for (const url of urls) {
      expect(plainFetchViolations(`fetch('${url}')`)).toHaveLength(1);
      expect(plainFetchViolations(`authFetch('${url}')`)).toEqual([]);
    }
  });
});

describe('plainFetchViolations for the trainer, admin and me routes', () => {
  const urls = [
    '/api/trainer/dashboard',
    '/api/trainer/profile',
    '/api/trainer/trainees?x=1',
    '/api/trainer/trainees/with-stats',
    '/api/trainer/trainees/t1/overview',
    '/api/trainer/quiz-submissions?onlyPending=true',
    '/api/trainer/quiz-submissions/s1',
    '/api/trainer/evaluations?status=SUBMITTED',
    '/api/trainer/evaluations/e1',
    '/api/trainer/annual-overview',
    '/api/trainer/school/stats',
    '/api/trainer/school/exams?traineeId=t1',
    '/api/trainer/school/activity-reports',
    '/api/trainer/arbeitszeugnis/certificates/all',
    '/api/trainer/profiles?role=TRAINEE&q=a',
    '/api/trainer/reviews?onlyPending=true',
    '/api/trainer/reviews/enablers/s1',
    '/api/trainer/courses/c1/members',
    '/api/admin/users',
    '/api/admin/organizations/o1/catalogs',
    '/api/me/catalog-requests',
    '/api/me/catalogs',
  ];

  it('flags a plain fetch to each of them and accepts authFetch', () => {
    for (const url of urls) {
      expect(plainFetchViolations(`fetch('${url}')`)).toHaveLength(1);
      expect(plainFetchViolations(`fetch(\`${url}\`, {})`)).toHaveLength(1);
      expect(plainFetchViolations(`authFetch('${url}')`)).toEqual([]);
    }
  });

  it('flags a url kept in a variable before the call', () => {
    const source =
      "const url = `/api/trainer/quiz-submissions?onlyPending=${pending}`;\nconst res = await fetch(url, { cache: 'no-store' });";
    expect(plainFetchViolations(source)).toHaveLength(1);
  });

  it('leaves the public catalog list alone', () => {
    expect(plainFetchViolations("fetch('/api/catalogs')")).toEqual([]);
    expect(plainFetchViolations("fetch('/api/training-use-cases')")).toEqual(
      []
    );
  });
});

describe('plainFetchViolations for the content upload routes', () => {
  const urls = [
    '/api/trainer/content-upload/runs',
    '/api/trainer/content-upload/runs/r1',
    '/api/trainer/content-upload/runs/r1/files?offset=0',
    '/api/trainer/content-upload/runs/r1/upload-urls',
    '/api/trainer/content-upload/runs/r1/complete',
    '/api/trainer/content-upload/runs/r1/pump',
    '/api/trainer/content-upload/runs/r1/discard',
    '/api/trainer/content-upload/cleanup',
  ];

  it('flags a plain fetch to each of them and accepts authFetch', () => {
    for (const url of urls) {
      expect(plainFetchViolations(`fetch('${url}')`)).toHaveLength(1);
      expect(plainFetchViolations(`fetch(\`${url}\`, {})`)).toHaveLength(1);
      expect(plainFetchViolations(`authFetch('${url}')`)).toEqual([]);
    }
  });

  it('the browser helper of the upload calls every one of them with authFetch', () => {
    const source = readFileSync(
      join(SRC, 'lib', 'content-upload', 'staging', 'client.ts'),
      'utf8'
    );
    expect(source).toContain("from '@/lib/authFetch'");
    expect(source).toContain('/api/trainer/content-upload/runs');
    expect(plainFetchViolations(source)).toEqual([]);
  });
});

describe('browser code calls the protected routes with authFetch', () => {
  it('finds no plain fetch() to a protected route (notifications, trainee, trainer, admin, me, activity reports, breadcrumb labels)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const target of plainFetchViolations(readFileSync(file, 'utf8'))) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the trainee pages that read the new routes use authFetch', () => {
  const read = (...parts: string[]) =>
    readFileSync(join(SRC, 'app', ...parts), 'utf8');

  it('the global quiz page and the quiz component call the quiz routes with a token', () => {
    const page = read('trainee', 'quizzes', '[quizId]', 'page.tsx');
    expect(page).toMatch(/useApiQuery[^(]*\(/);
    expect(plainFetchViolations(page)).toEqual([]);
    const component = readFileSync(
      join(SRC, 'components', 'learning', 'Quiz.tsx'),
      'utf8'
    );
    expect(component).toContain('authFetch(`/api/trainee/quizzes/');
    expect(plainFetchViolations(component)).toEqual([]);
  });

  it('the enabler page of a trainee reads the documents from the trainee route, not the trainer route', () => {
    const page = read('trainee', 'enablers', '[enablerId]', 'page.tsx');
    expect(page).toContain('/api/trainee/enablers/${enablerId}/documents');
    expect(page).not.toContain('/api/trainer/');
  });
});
