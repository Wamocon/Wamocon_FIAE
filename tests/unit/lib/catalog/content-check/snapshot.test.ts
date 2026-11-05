import { renderCondition } from '../../../../helpers/mockDb';
import { loadContentSnapshot } from '@/lib/catalog/content-check/snapshot';
import {
  gluedWords,
  hasBrokenEncoding,
  normalizeTitle,
} from '@/lib/catalog/content-check/title-rules';

const CATALOG = '00000000-0000-4000-8000-0000000000aa';

type Rows = Record<string, unknown[]>;

/** A database double: answers by the marker comment of the statement. */
function fakeDb(rows: Rows) {
  const seen: { name: string; sql: string; params: unknown[] }[] = [];
  const execute = jest.fn(async (statement: unknown) => {
    const rendered = renderCondition(statement);
    const name = /\/\* cc:(\w+) \*\//.exec(rendered.sql)?.[1] ?? '?';
    seen.push({ name, ...rendered });
    return rows[name] ?? [];
  });
  return { db: { execute } as never, execute, seen };
}

const catalogRow = {
  id: CATALOG,
  code: 'TEST',
  title: 'Testberuf',
  is_active: true,
  duration_years: 3,
  settings: { phase_months: [18, 18] },
};

describe('loadContentSnapshot', () => {
  it('answers null for a catalog that does not exist and reads nothing else', async () => {
    const { db, execute, seen } = fakeDb({ catalog: [] });
    expect(await loadContentSnapshot(db, CATALOG)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(seen[0].name).toBe('catalog');
  });

  it('reads one statement per group of rules', async () => {
    const { db, execute, seen } = fakeDb({ catalog: [catalogRow] });
    const snapshot = await loadContentSnapshot(db, CATALOG);
    expect(snapshot?.catalog).toMatchObject({ id: CATALOG, code: 'TEST' });

    // Ten statements for ten groups, never a statement per enabler or per quiz
    expect(execute).toHaveBeenCalledTimes(10);
    expect(seen.map(s => s.name)).toEqual([
      'catalog',
      'courses',
      'enablers',
      'use_cases',
      'quizzes',
      'questions',
      'documents',
      'learning_fields',
      'mappings',
      'components',
    ]);
  });

  it('every statement carries the catalog as a parameter and is read only', async () => {
    const { db, seen } = fakeDb({ catalog: [catalogRow] });
    await loadContentSnapshot(db, CATALOG);
    const names = new Set(seen.map(s => s.name));
    expect(names.size).toBe(seen.length);
    for (const statement of seen) {
      expect(statement.params).toContain(CATALOG);
      expect(statement.sql).toMatch(/^\s*\/\* cc:\w+ \*\/\s+select /);
      expect(statement.sql).not.toMatch(
        /\b(insert|update|delete|truncate|alter|drop)\b/i
      );
    }
    // The content tables are limited through their catalog column (or an
    // `exists` on a table that has one), the documents through their parents
    const sqlOf = (name: string) => seen.find(s => s.name === name)?.sql ?? '';
    expect(sqlOf('courses')).toContain('x.training_catalog_id =');
    expect(sqlOf('enablers')).toContain('e.training_catalog_id =');
    expect(sqlOf('use_cases')).toContain('u.training_catalog_id =');
    expect(sqlOf('quizzes')).toContain('z.training_catalog_id =');
    expect(sqlOf('questions')).toContain('z.training_catalog_id =');
    expect(sqlOf('learning_fields')).toContain('f.training_catalog_id =');
    expect(sqlOf('mappings')).toContain('m.training_catalog_id =');
  });

  it('maps the rows, with safe defaults for null and odd values', async () => {
    const { db } = fakeDb({
      catalog: [catalogRow],
      courses: [
        {
          id: 'c1',
          code: null,
          title: 'Kurs',
          description: null,
          training_component_id: null,
          is_active: null,
        },
      ],
      enablers: [
        {
          id: 'e1',
          course_id: 'c1',
          training_catalog_id: CATALOG,
          course_catalog_id: null,
          code: null,
          title: 'Enabler',
          order_index: '3',
          description_text: null,
          has_scenario_pdf: true,
          is_active: true,
        },
      ],
      quizzes: [
        {
          id: 'z1',
          code: null,
          title: 'Quiz',
          quiz_type: 'GLOBAL',
          is_active: false,
          training_catalog_id: CATALOG,
          enabler_id: null,
          enabler_catalog_id: null,
          difficulty: 'EXTREME',
          question_count: '4',
        },
      ],
      questions: [
        {
          id: 'f1',
          quiz_id: 'z1',
          question_type: 'TEXT',
          text: 'Frage',
          option_count: 0,
          correct_count: 0,
          empty_option_count: 0,
        },
      ],
      documents: [
        {
          id: 'd1',
          enabler_id: 'e1',
          use_case_id: null,
          course_id: null,
          title: 'Doku',
          document_type: 'THEORY',
          file_name: 'a.pdf',
          has_file: false,
          has_text: true,
          file_size: null,
          page_count: '7',
          content_sha256: 'A'.repeat(64),
        },
      ],
      components: [
        {
          id: 't1',
          code: 'T1',
          title: 'Komponente',
          total_weeks: '4.5',
          total_hours: 180,
          phase: null,
          kind: 'integrativ',
        },
      ],
    });
    const snapshot = await loadContentSnapshot(db, CATALOG);
    expect(snapshot?.courses[0]).toMatchObject({ code: null, isActive: false });
    expect(snapshot?.enablers[0]).toMatchObject({
      orderIndex: 3,
      courseCatalogId: null,
      hasScenarioPdf: true,
      description: null,
    });
    expect(snapshot?.quizzes[0]).toMatchObject({
      type: 'GLOBAL',
      difficulty: null,
      questionCount: 4,
      isActive: false,
    });
    expect(snapshot?.questions[0].type).toBe('TEXT');
    expect(snapshot?.documents[0]).toMatchObject({
      hasFile: false,
      hasText: true,
      fileSize: null,
      pageCount: 7,
      // not lower case hex: no checksum
      contentSha256: null,
    });
    expect(snapshot?.components[0]).toMatchObject({
      totalWeeks: 4.5,
      phase: null,
    });
  });
});

describe('title rules', () => {
  it('finds glued words and respects the exceptions', () => {
    expect(gluedWords('gestaltenInhaltsverzeichnis')).toEqual([
      'gestaltenInhaltsverzeichnis',
    ]);
    expect(gluedWords('Texte gestaltenInhalt und mehrWort')).toEqual([
      'gestaltenInhalt',
      'mehrWort',
    ]);
    expect(
      gluedWords('PostgreSQL MySQL GitHub javascript JavaScript DevOps')
    ).toEqual([]);
    expect(gluedWords('Normaler Titel mit IT-Sicherheit und TCP/IP')).toEqual(
      []
    );
    expect(gluedWords('')).toEqual([]);
  });

  it('finds broken encoding', () => {
    const latin1 = 'Pr' + String.fromCharCode(0xc3, 0xbc) + 'fung';
    expect(hasBrokenEncoding(latin1)).toBe(true);
    expect(hasBrokenEncoding('x' + String.fromCharCode(0xfffd))).toBe(true);
    expect(hasBrokenEncoding('Prüfung der Größe')).toBe(false);
  });

  it('normalizes titles for comparison', () => {
    expect(normalizeTitle('  Hallo   Welt: ')).toBe('hallo welt');
    expect(normalizeTitle('HALLO WELT')).toBe(normalizeTitle('hallo welt'));
  });
});
