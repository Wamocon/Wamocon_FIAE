/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';

// Questions about files: recognition, file name variants, the answer from the
// database, access per role and occupation, the neutral answer, the lists with
// more than 20 files. The database is a mock that returns the fixture rows
// whatever the SQL says, so the second line of defense in code is tested; the
// SQL itself is rendered and checked for its conditions.

const mockExecute = jest.fn();
jest.mock('@/db/haiDb', () => ({
  __esModule: true,
  default: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

import {
  DOCUMENT_LIST_MARKER,
  DOCUMENT_LIST_MAX,
  answerDocumentQuestion,
  documentNotFoundText,
  documentOptionsFor,
  extractFileNameKeys,
  fileTypeOf,
  filterDocumentRows,
  formatDocumentList,
  isDocumentQuestion,
  matchNamedRecords,
  normalizeFileKey,
  pointsAtOneFile,
  type DocumentAccess,
  type DocumentRow,
} from '@/lib/hai/documentQuery';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const ENABLER = '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001';
const USE_CASE = '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0005';
const COURSE = '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0004';

const dialect = new PgDialect();
const sqlOf = (call: number) => {
  const q = dialect.sqlToQuery(mockExecute.mock.calls[call][0]);
  return { text: q.sql.replace(/\s+/g, ' '), params: q.params };
};

function row(extra: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'doc-1',
    title: 'Theorie Normalisierung',
    fileName: 'Normalisierung_Theorie.pdf',
    mimeType: 'application/pdf',
    documentType: 'THEORY',
    visibility: 'ALL',
    enablerId: ENABLER,
    enablerTitle: 'Normalisierung',
    useCaseId: null,
    useCaseTitle: null,
    courseId: null,
    courseTitle: null,
    courseYear: null,
    useCaseYears: null,
    useCaseStages: null,
    ...extra,
  };
}

/** The shape the database returns (snake case). */
function dbRow(r: DocumentRow) {
  return {
    id: r.id,
    title: r.title,
    file_name: r.fileName,
    mime_type: r.mimeType,
    document_type: r.documentType,
    visibility: r.visibility,
    enabler_id: r.enablerId,
    enabler_title: r.enablerTitle,
    use_case_id: r.useCaseId,
    use_case_title: r.useCaseTitle,
    course_id: r.courseId,
    course_title: r.courseTitle,
    course_year: r.courseYear,
    use_case_years: r.useCaseYears,
    use_case_stages: r.useCaseStages,
  };
}

const traineeAccess: DocumentAccess = {
  catalogIds: [FIAE],
  audience: 'trainee',
  organizationId: ORG,
};
const trainerAccess: DocumentAccess = { ...traineeAccess, audience: 'trainer' };

/** The mock database: documents for the file queries, records for the title query. */
function installDb(
  documents: DocumentRow[],
  records: Array<{ type: string; id: string; title: string }> = []
) {
  mockExecute.mockImplementation(async (query: unknown) => {
    const text = dialect.sqlToQuery(query as never).sql;
    if (text.includes("'enabler' AS type")) return records;
    return documents.map(dbRow);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('isDocumentQuestion', () => {
  it.each([
    'Welche Dateien hat dieser Enabler?',
    'Welche Dokumente gibt es zu Use Case 3?',
    'Wie heißt die Datei?',
    'Wie heisst die Datei zu dem Enabler',
    'Gibt es einen Anhang?',
    'Welche Anhänge hat der Kurs?',
    'Welche Unterlagen gibt es zur Normalisierung?',
    'Zeig mir das PDF',
    'Gibt es PDFs dazu?',
    'Was steht in Datenbank_Grundlagen.pdf?',
    'Öffne Folien.pptx',
    'Hat der Kurs eine Tabelle.xlsx dabei',
    'Was ist im Dokument Normalisierung Theorie?',
    // spoken: no capitals, no punctuation
    'welche dateien hat dieser enabler',
    'wie heisst die datei',
    // umlauts and folded
    'welche Dateien gehören zu dem Kurs',
    'Hast du Unterlagen zu SQL',
  ])('"%s" is a question about files', message => {
    expect(isDocumentQuestion(message)).toBe(true);
  });

  it.each([
    'Was ist Normalisierung?',
    'Wie ist mein Fortschritt?',
    'Wann habe ich Berufsschule?',
    'Wie dokumentiere ich meine Arbeit?',
    'Was ist ein Primärschlüssel?',
    // questions about submissions are the submission intent
    'Welche Dateien muss ich abgeben?',
    'Welche Abgaben sind offen?',
    'Welche Dateien hat Anna eingereicht?',
    'Hast du meine Datei abgegeben?',
  ])('"%s" is not', message => {
    expect(isDocumentQuestion(message)).toBe(false);
  });

  it('recognizes "diese Datei" and "das PDF" as a pointer', () => {
    expect(pointsAtOneFile('Worum geht es in dieser Datei?')).toBe(true);
    expect(pointsAtOneFile('Fasse das PDF zusammen')).toBe(true);
    expect(pointsAtOneFile('Welche Dateien gibt es?')).toBe(false);
  });
});

describe('file name keys', () => {
  it('normalizes underscore, hyphen, dots, space, case, umlauts and the extension', () => {
    const variants = [
      'Datenbank_Grundlagen.pdf',
      'datenbank grundlagen',
      'Datenbank-Grundlagen',
      'DATENBANK.GRUNDLAGEN.PDF',
      'Datenbank  Grundlagen.docx',
    ];
    for (const v of variants) {
      expect(normalizeFileKey(v)).toBe('datenbank grundlagen');
    }
    expect(normalizeFileKey('Prüfungsübersicht_Größe.pdf')).toBe(
      'pruefungsuebersicht groesse'
    );
  });

  it('finds the name with extension, without the question words around it', () => {
    const keys = extractFileNameKeys('Was steht in Datenbank_Grundlagen.pdf?');
    expect(keys[0]).toEqual({ key: 'datenbank grundlagen', partial: true });
  });

  it('finds a name with spaces and an extension', () => {
    const keys = extractFileNameKeys('Öffne bitte Datenbank Grundlagen.pdf');
    expect(keys.map(k => k.key)).toContain('datenbank grundlagen');
  });

  it('finds a quoted name without an extension', () => {
    const keys = extractFileNameKeys(
      'Wie heißt die Datei "Datenbank Grundlagen"?'
    );
    expect(keys[0].key).toBe('datenbank grundlagen');
  });

  it('finds a name with an underscore after "Datei", extension optional', () => {
    // the words after the name stay in the longest phrase, the exact key is there too
    expect(
      extractFileNameKeys(
        'Was steht in der Datei Datenbank_Grundlagen drin'
      ).map(k => k.key)
    ).toContain('datenbank grundlagen');
  });

  it('finds a name with several words after "Dokument"', () => {
    expect(
      extractFileNameKeys('Zeig mir das Dokument Datenbank Grundlagen Teil')[0]
        .key
    ).toContain('datenbank grundlagen');
  });

  it('takes no stop words and no single plain word for a name', () => {
    expect(extractFileNameKeys('Welche Dateien hat dieser Enabler?')).toEqual(
      []
    );
    expect(extractFileNameKeys('Wie heißt die Datei?')).toEqual([]);
    expect(extractFileNameKeys('Gibt es das Dokument Enabler')).toEqual([]);
  });

  it('lets only the longest phrase match in part, the shorter ones must be exact', () => {
    const keys = extractFileNameKeys('Was steht in Datenbank_Grundlagen.pdf?');
    const partial = keys.filter(k => k.partial).map(k => k.key);
    expect(partial).toEqual(['datenbank grundlagen']);
    expect(keys.filter(k => !k.partial).map(k => k.key)).toEqual(
      expect.arrayContaining(['datenbank', 'grundlagen'])
    );
  });
});

describe('titles that the question names', () => {
  const records = [
    { type: 'enabler', id: 'e1', title: 'Normalisierung' },
    { type: 'enabler', id: 'e2', title: 'Normalisierung und Denormalisierung' },
    { type: 'use_case', id: 'u1', title: 'Bestellsystem' },
    { type: 'course', id: 'c1', title: 'SQL' },
  ];

  it('takes the longest title that occurs as whole words', () => {
    expect(
      matchNamedRecords(
        'Welche Dateien hat der Enabler Normalisierung und Denormalisierung?',
        records
      ).map(r => r.id)
    ).toEqual(['e2']);
    expect(
      matchNamedRecords('Dateien zum Use Case Bestellsystem', records)
    ).toEqual([{ type: 'use_case', id: 'u1', title: 'Bestellsystem' }]);
  });

  it('ignores a part of a word and very short titles', () => {
    expect(
      matchNamedRecords('Dateien zur Normalisierungsfrage', records)
    ).toEqual([]);
    expect(matchNamedRecords('Dateien zu SQL', records)).toEqual([]);
  });
});

describe('access and format (second line of defense)', () => {
  const solution = row({
    id: 'doc-solution',
    title: 'Musterlösung Bestellsystem',
    fileName: 'Loesung_Bestellsystem.pdf',
    documentType: 'TRAINER_SOLUTION',
  });
  const trainerOnly = row({
    id: 'doc-trainer',
    fileName: 'Notizen.pdf',
    visibility: 'TRAINER_ONLY',
  });

  it('a trainee never gets a solution or a trainer-only file', () => {
    const kept = filterDocumentRows(
      [row(), solution, trainerOnly],
      traineeAccess
    );
    expect(kept.map(r => r.id)).toEqual(['doc-1']);
  });

  it('a trainer gets them', () => {
    const kept = filterDocumentRows(
      [row(), solution, trainerOnly],
      trainerAccess
    );
    expect(kept.map(r => r.id)).toEqual([
      'doc-1',
      'doc-solution',
      'doc-trainer',
    ]);
  });

  it('applies the training scope of the person', () => {
    const scope = {
      applies: true,
      allowedAusbildungsjahre: [1],
      allowedComponentPhases: [1],
    } as never;
    const kept = filterDocumentRows(
      [row({ id: 'y1', courseYear: 1 }), row({ id: 'y3', courseYear: 3 })],
      { audience: 'trainee', trainingScope: scope }
    );
    expect(kept.map(r => r.id)).toEqual(['y1']);
  });

  it('lists title, file name, type and the enabler or use case, one line each', () => {
    const text = formatDocumentList(
      [
        row(),
        row({
          id: 'd2',
          title: null,
          fileName: 'Aufgaben.docx',
          mimeType: null,
          enablerId: null,
          enablerTitle: null,
          useCaseId: USE_CASE,
          useCaseTitle: 'Bestellsystem',
        }),
      ],
      2
    );
    expect(text).toContain(`${DOCUMENT_LIST_MARKER} 2 Dateien gefunden.`);
    expect(text).toContain(
      '- Theorie Normalisierung | Datei: Normalisierung_Theorie.pdf | Typ: PDF | gehört zu: Enabler "Normalisierung"'
    );
    expect(text).toContain(
      '- Aufgaben.docx | Datei: Aufgaben.docx | Typ: DOCX | gehört zu: Use Case "Bestellsystem"'
    );
    expect(text).toContain('Nenne nur Dateien aus dieser Liste');
    expect(text).not.toMatch(/[–—]/);
  });

  it('knows the type from the extension, else from the mime type', () => {
    expect(fileTypeOf('a.xlsx')).toBe('XLSX');
    expect(fileTypeOf('a', 'application/pdf')).toBe('PDF');
    expect(fileTypeOf('a')).toBe('Datei');
  });

  it('writes at most 20 lines and names the number, for more than 20 files', () => {
    const rows = Array.from({ length: 35 }, (_, i) =>
      row({ id: `d${i}`, fileName: `Datei_${i}.pdf`, title: `Titel ${i}` })
    );
    const text = formatDocumentList(rows, 35);
    expect(text.split('\n').filter(l => l.startsWith('- '))).toHaveLength(
      DOCUMENT_LIST_MAX
    );
    expect(text).toContain('35 Dateien gefunden, die ersten 20 stehen hier');
    expect(text).toContain('Datei_19.pdf');
    expect(text).not.toContain('Datei_20.pdf');
  });

  it('keeps a line to one line: no break, no table or markup characters from the title', () => {
    const text = formatDocumentList(
      [row({ title: 'Titel\n**fett** | Spalte `x`' })],
      1
    );
    const line = text.split('\n').find(l => l.startsWith('- ')) as string;
    expect(line).not.toContain('\n');
    expect(line).not.toContain('**');
    expect(line).not.toContain('`');
  });

  it('builds the options for the data context from the access of the turn', () => {
    const options = documentOptionsFor(
      { catalogIds: [FIAE], audience: 'trainee', organizationId: ORG },
      undefined,
      [
        { type: 'enabler', id: ENABLER },
        { type: 'course', id: COURSE },
        { type: 'trainee', id: 'x' },
      ]
    );
    expect(options.documentAccess).toMatchObject({ catalogIds: [FIAE] });
    expect(options.page).toEqual({
      enablerIds: [ENABLER],
      useCaseIds: [],
      courseIds: [COURSE],
    });
    expect(documentOptionsFor(null, undefined, []).documentAccess).toBeNull();
  });
});

describe('answerDocumentQuestion', () => {
  const docs = [
    row({
      id: 'theory',
      title: 'Theorie',
      fileName: 'Datenbank_Grundlagen.pdf',
    }),
    row({
      id: 'exercise',
      title: 'Übung',
      fileName: 'Datenbank_Uebung.pdf',
      documentType: 'EXERCISE',
    }),
    row({
      id: 'solution',
      title: 'Musterlösung Datenbank',
      fileName: 'Loesung_Datenbank.pdf',
      documentType: 'TRAINER_SOLUTION',
    }),
    row({
      id: 'trainer-only',
      title: 'Trainerhinweise',
      fileName: 'Hinweise_fuer_Trainer.pdf',
      visibility: 'TRAINER_ONLY',
    }),
    row({
      id: 'docx',
      title: 'Aufgaben',
      fileName: 'Aufgaben.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  ];

  it('lists the files of the enabler of the page', async () => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message: 'Welche Dateien hat dieser Enabler?',
      access: traineeAccess,
      page: { enablerIds: [ENABLER], useCaseIds: [], courseIds: [] },
    });
    expect(answer.text).toContain('Datenbank_Grundlagen.pdf');
    expect(answer.text).toContain('Aufgaben.docx');
    expect(answer.total).toBe(3);
    expect(answer.documentIds).toEqual([]);
    // the SQL asks for the enabler of the page
    const call = sqlOf(1);
    expect(call.text).toContain('cd.enabler_id IN');
    expect(call.params).toContain(ENABLER);
  });

  it('asks the SQL for the occupations, the organization and, for a trainee, no trainer files', async () => {
    installDb(docs);
    await answerDocumentQuestion({
      message: 'Welche Dateien gibt es?',
      access: traineeAccess,
    });
    // second call: the first is the title lookup
    const call = sqlOf(1);
    expect(call.text).toContain('e.training_catalog_id IN');
    expect(call.text).toContain('uc.training_catalog_id IN');
    expect(call.text).toContain('co.training_catalog_id IN');
    expect(call.text).toContain(
      "cd.document_type IS DISTINCT FROM 'TRAINER_SOLUTION'"
    );
    expect(call.text).toContain(
      "cd.visibility IS DISTINCT FROM 'TRAINER_ONLY'"
    );
    expect(call.text).toContain(
      'cd.organization_id IS NULL OR cd.organization_id ='
    );
    expect(call.params).toContain(FIAE);
    expect(call.params).toContain(ORG);
    // a file without a link matches nobody
    expect(call.text).toContain(
      'cd.enabler_id IS NOT NULL OR cd.use_case_id IS NOT NULL OR cd.course_id IS NOT NULL'
    );
  });

  it('a trainer query does not exclude the trainer files in the SQL', async () => {
    installDb(docs);
    await answerDocumentQuestion({
      message: 'Welche Dateien gibt es?',
      access: trainerAccess,
    });
    expect(sqlOf(1).text).not.toContain('TRAINER_SOLUTION');
  });

  it('a trainee never gets the solution or a trainer-only file, not even its name or in the count', async () => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message: 'Welche Dateien gibt es zur Datenbank?',
      access: traineeAccess,
      page: { enablerIds: [ENABLER], useCaseIds: [], courseIds: [] },
    });
    expect(answer.total).toBe(3);
    for (const hidden of [
      'Loesung_Datenbank',
      'Musterlösung',
      'Hinweise_fuer_Trainer',
      'Trainerhinweise',
    ]) {
      expect(answer.text).not.toContain(hidden);
    }
    expect(answer.text).toContain('3 Dateien gefunden');
  });

  it('a trainer gets the solution file by name', async () => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message: 'Was steht in Loesung_Datenbank.pdf?',
      access: trainerAccess,
    });
    expect(answer.text).toContain('Loesung_Datenbank.pdf');
    expect(answer.documentIds).toEqual(['solution']);
  });

  it('a trainee asking for the solution file by name gets the neutral answer', async () => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message: 'Was steht in Loesung_Datenbank.pdf?',
      access: traineeAccess,
    });
    expect(answer.text).toBe(documentNotFoundText('loesung datenbank'));
    expect(answer.documentIds).toEqual([]);
    expect(answer.total).toBe(0);
    expect(answer.text).not.toContain('Musterlösung');
  });

  it('answers a file that does not exist and a file that is not visible in the same way', async () => {
    installDb(docs);
    const hidden = await answerDocumentQuestion({
      message: 'Was steht in Loesung_Datenbank.pdf?',
      access: traineeAccess,
    });
    installDb([]);
    const missing = await answerDocumentQuestion({
      message: 'Was steht in Loesung_Datenbank.pdf?',
      access: traineeAccess,
    });
    expect(hidden).toEqual(missing);
    expect(hidden.text).toContain(
      'keine passende Datei in deinen freigegebenen Inhalten'
    );
    // it does not say "not allowed", "protected" or "trainer"
    expect(hidden.text).not.toMatch(/darfst|geschützt|Trainer|Lösungsschutz/i);
  });

  it.each([
    'Was steht in Datenbank_Grundlagen.pdf?',
    'Was steht in datenbank_grundlagen.pdf?',
    'Was steht in Datenbank Grundlagen.pdf?',
    'Was steht in Datenbank-Grundlagen.PDF?',
    'Wie heißt die Datei "Datenbank Grundlagen"?',
    'Was steht in der Datei Datenbank_Grundlagen drin',
    'was steht in datenbank grundlagen pdf',
  ])('finds the file for the variant "%s"', async message => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message,
      access: traineeAccess,
    });
    expect(answer.text).toContain('Datenbank_Grundlagen.pdf');
    expect(answer.documentIds).toEqual(['theory']);
  });

  it('a name that matches only in part still finds the file (longest key)', async () => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message: 'Was steht in Datenbank_Grund.pdf?',
      access: traineeAccess,
    });
    // "datenbank grund" is part of "datenbank grundlagen"
    expect(answer.text).toContain('Datenbank_Grundlagen.pdf');
  });

  it('does not offer a file for a shorter piece of a name that does not exist', async () => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message: 'Was steht in Datenbank_Spezial.pdf?',
      access: traineeAccess,
    });
    // "datenbank" is a part of other files, but no file is called "datenbank"
    expect(answer.total).toBe(0);
    expect(answer.text).toContain('keine passende Datei');
    expect(answer.documentIds).toEqual([]);
  });

  it('a shorter piece of a name is asked for as the whole name, so it cannot fill the limit of the query', async () => {
    installDb([
      row({
        id: 'target',
        title: 'Szenario K14-i (PDF)',
        fileName: 'Szenario_14i.pdf',
      }),
    ]);
    const answer = await answerDocumentQuestion({
      message: 'Was steht in Szenario_14i.pdf?',
      access: traineeAccess,
    });
    expect(answer.documentIds).toEqual(['target']);
    // real data: "szenario" is in hundreds of titles, the 200 rows of the limit
    // were full of them and the file that was named was cut off
    const call = sqlOf(0);
    expect(call.params).toContain('%szenario 14i%');
    expect(call.params).not.toContain('%szenario%');
    expect(call.params).toContain('szenario');
    expect(call.text).toMatch(/= \$\d+ OR .* = \$\d+/);
  });

  it('loads the pages only of PDF files', async () => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message: 'Was steht in Aufgaben.docx?',
      access: traineeAccess,
    });
    expect(answer.text).toContain('Aufgaben.docx');
    expect(answer.documentIds).toEqual([]);
  });

  it('points at the one file of the page ("diese Datei")', async () => {
    installDb([docs[0]]);
    const answer = await answerDocumentQuestion({
      message: 'Worum geht es in dieser Datei?',
      access: traineeAccess,
      page: { enablerIds: [ENABLER], useCaseIds: [], courseIds: [] },
    });
    expect(answer.documentIds).toEqual(['theory']);
  });

  it('does not guess a file for "diese Datei" when the page has several', async () => {
    installDb(docs);
    const answer = await answerDocumentQuestion({
      message: 'Worum geht es in dieser Datei?',
      access: traineeAccess,
      page: { enablerIds: [ENABLER], useCaseIds: [], courseIds: [] },
    });
    expect(answer.documentIds).toEqual([]);
  });

  it('takes the enabler of the question (title) before the page', async () => {
    installDb(docs, [
      { type: 'enabler', id: ENABLER, title: 'Normalisierung' },
      { type: 'use_case', id: USE_CASE, title: 'Bestellsystem' },
    ]);
    await answerDocumentQuestion({
      message: 'Welche Dateien hat der Use Case Bestellsystem?',
      access: traineeAccess,
      page: {
        enablerIds: ['3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a00ee'],
        useCaseIds: [],
        courseIds: [],
      },
    });
    const call = sqlOf(1);
    expect(call.text).toContain('cd.use_case_id IN');
    expect(call.params).toContain(USE_CASE);
    expect(call.params).not.toContain('3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a00ee');
  });

  it('asks for the files of a course including its enablers and use cases', async () => {
    installDb(docs);
    await answerDocumentQuestion({
      message: 'Welche Dateien hat dieser Kurs?',
      access: traineeAccess,
      page: { enablerIds: [], useCaseIds: [], courseIds: [COURSE] },
    });
    const call = sqlOf(1);
    expect(call.text).toContain('cd.course_id IN');
    expect(call.text).toContain('e.course_id IN');
    expect(call.text).toContain('uc.course_id IN');
  });

  it('writes the first 20 for more than 20 files and names the number', async () => {
    installDb(
      Array.from({ length: 45 }, (_, i) =>
        row({ id: `d${i}`, fileName: `Datei_${i}.pdf`, title: `Titel ${i}` })
      )
    );
    const answer = await answerDocumentQuestion({
      message: 'Welche Dateien gibt es?',
      access: traineeAccess,
    });
    expect(answer.total).toBe(45);
    expect(
      answer.text.split('\n').filter(l => l.startsWith('- '))
    ).toHaveLength(20);
    expect(answer.text).toContain('45 Dateien gefunden, die ersten 20');
  });

  it('does not call the count of a read that stopped at its row limit "all files"', async () => {
    // the database returns at most 200 rows, a trainee of the real Preview sees about 1000
    installDb(
      Array.from({ length: 200 }, (_, i) =>
        row({ id: `d${i}`, fileName: `Datei_${i}.pdf`, title: `Titel ${i}` })
      )
    );
    const answer = await answerDocumentQuestion({
      message: 'Welche Dateien gibt es?',
      access: traineeAccess,
    });
    expect(answer.text).toContain('Mindestens 200 Dateien gefunden');
    expect(answer.text).toContain('Nenne keine genaue Gesamtzahl');
    expect(answer.text).not.toContain('200 Dateien gefunden, die ersten');
    expect(
      answer.text.split('\n').filter(l => l.startsWith('- '))
    ).toHaveLength(20);
  });

  it('names the exact count while the read stays below its limit', async () => {
    installDb(
      Array.from({ length: 199 }, (_, i) =>
        row({ id: `d${i}`, fileName: `Datei_${i}.pdf`, title: `Titel ${i}` })
      )
    );
    const answer = await answerDocumentQuestion({
      message: 'Welche Dateien gibt es?',
      access: traineeAccess,
    });
    expect(answer.text).toContain('199 Dateien gefunden, die ersten 20');
    expect(answer.text).not.toContain('Mindestens');
  });

  it('is neutral when nothing is visible', async () => {
    installDb([docs[2], docs[3]]);
    const answer = await answerDocumentQuestion({
      message: 'Welche Dateien gibt es?',
      access: traineeAccess,
    });
    expect(answer.text).toBe(documentNotFoundText());
    expect(answer.total).toBe(0);
  });

  it('is neutral without an access or without an occupation (fail closed), without a query', async () => {
    installDb(docs);
    for (const access of [
      null,
      undefined,
      { ...traineeAccess, catalogIds: [] },
    ]) {
      const answer = await answerDocumentQuestion({
        message: 'Welche Dateien gibt es?',
        access,
      });
      expect(answer.text).toBe(documentNotFoundText());
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('a trainee of another occupation: the query carries only the own occupation', async () => {
    installDb(docs);
    await answerDocumentQuestion({
      message: 'Welche Dateien gibt es?',
      access: { ...traineeAccess, catalogIds: [KFBM] },
    });
    const call = sqlOf(1);
    expect(call.params).toContain(KFBM);
    expect(call.params).not.toContain(FIAE);
  });

  it('the neutral text carries the requested name only as plain text', () => {
    expect(documentNotFoundText('x"\ninjected')).not.toContain('\n');
    expect(documentNotFoundText('a'.repeat(300)).length).toBeLessThan(400);
  });
});
