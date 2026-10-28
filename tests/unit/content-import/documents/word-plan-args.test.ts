// Tests of the arguments of --from-word and of the rule of the plan for scenario PDFs: a scenario PDF
// is only taken when its text was checked on all pages and shows no solution part.
import { describe, expect, it } from '@jest/globals';

import {
  CONVERT_TIMEOUT_MAX,
  CONVERT_TIMEOUT_MIN,
  parseDocumentsArgs,
} from '@/lib/content-import/documents/args';
import {
  buildDocumentPlan,
  countPlan,
  renderPlanSummary,
  validateDocumentPlan,
} from '@/lib/content-import/documents/plan';
import type { ScannedPdf } from '@/lib/content-import/documents/types';

const K4 =
  '04 - Koordinations- und Organisationsaufgaben übernehmen (§ 4 Abs. 2 Nr. 4)';
const uuid = '11111111-2222-4333-8444-555555555555';

const scanned = (
  rel: string,
  heading: string,
  over: Partial<ScannedPdf> = {}
) =>
  ({
    rel,
    size: 1000,
    magicOk: true,
    sha256: 'a'.repeat(64),
    pageCount: 2,
    headText: heading,
    ...over,
  }) as ScannedPdf;

describe('scenario PDFs in the plan', () => {
  const scenario = (over: Partial<ScannedPdf>) =>
    buildDocumentPlan([
      scanned(`${K4}/Szenarien/Szenario_4a.pdf`, 'Szenario 4a) Titel', over),
    ]).items[0];

  it('takes a scenario whose text was checked and shows no solution', () => {
    expect(scenario({ solutionMarker: false })).toMatchObject({
      status: 'ok',
      kind: 'scenario',
    });
  });

  it('does not take a scenario PDF that shows a solution part', () => {
    const item = scenario({ solutionMarker: true });
    expect(item.status).toBe('solution-in-pdf');
    expect(item.reason).toMatch(/solution part/);
  });

  it('does not take a scenario PDF that was not checked (fail closed)', () => {
    const item = scenario({});
    expect(item.status).toBe('solution-in-pdf');
    expect(item.reason).toMatch(/not checked/);
  });

  it('asks nothing of the other kinds, and the plan stays valid and names the file', () => {
    const plan = buildDocumentPlan([
      scanned(`${K4}/Enabler/4a.pdf`, '4a) Titel'),
      scanned(`${K4}/Use-Cases/UC_4a.pdf`, '4a) Titel'),
      scanned(`${K4}/Szenarien/Szenario_4a.pdf`, 'Szenario 4a) Titel', {
        solutionMarker: true,
      }),
    ]);
    expect(plan.items.map(i => i.status).sort()).toEqual([
      'ok',
      'ok',
      'solution-in-pdf',
    ]);
    expect(validateDocumentPlan(plan)).toEqual([]);
    expect(countPlan(plan).byKind.scenario).toBe(0);
    expect(renderPlanSummary(plan)).toContain('solution-in-pdf: ');
  });
});

describe('parseDocumentsArgs with --from-word', () => {
  const ok = (argv: string[]) => {
    const parsed = parseDocumentsArgs(argv);
    expect(parsed).toMatchObject({ ok: true });
    return (parsed as any).args;
  };
  const refused = (argv: string[]) => {
    const parsed = parseDocumentsArgs(argv);
    expect(parsed.ok).toBe(false);
    return (parsed as any).errors.join(' | ');
  };
  const base = ['run', 'src', '--target', 'local', '--created-by', uuid];

  it('defaults to the PDF folder, without the Word mode', () => {
    expect(ok(base)).toMatchObject({
      fromWord: false,
      soffice: null,
      convertTimeoutSeconds: null,
    });
  });

  it('takes the Word mode with the program and the limit, also as name=value', () => {
    expect(
      ok([
        ...base,
        '--from-word',
        '--soffice',
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        '--convert-timeout',
        '90',
      ])
    ).toMatchObject({
      fromWord: true,
      soffice: 'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      convertTimeoutSeconds: 90,
    });
    expect(
      ok([
        'check',
        'src',
        '--target',
        'preview',
        '--created-by',
        uuid,
        '--from-word',
        '--soffice=/usr/bin/soffice',
        '--convert-timeout=30',
      ])
    ).toMatchObject({ soffice: '/usr/bin/soffice', convertTimeoutSeconds: 30 });
    expect(ok(['plan', 'src', '--from-word', '--hydrate'])).toMatchObject({
      command: 'plan',
      fromWord: true,
    });
  });

  it('keeps the real run locks of the PDF import', () => {
    expect(refused([...base, '--from-word', '--apply'])).toMatch(
      /--confirm-storage-host/
    );
    expect(
      refused([
        'check',
        'src',
        '--target',
        'production',
        '--created-by',
        uuid,
        '--from-word',
      ])
    ).toMatch(/Production/);
  });

  it('refuses the program and the limit without the Word mode and for plan', () => {
    expect(refused([...base, '--soffice', '/usr/bin/soffice'])).toMatch(
      /belong to check and run with --from-word/
    );
    expect(refused([...base, '--convert-timeout', '30'])).toMatch(
      /belong to check and run with --from-word/
    );
    expect(
      refused(['plan', 'src', '--from-word', '--convert-timeout', '30'])
    ).toMatch(/plan does not convert/);
  });

  it('checks the value of the limit and the path of the program', () => {
    for (const value of [
      'abc',
      '1.5',
      '-5',
      String(CONVERT_TIMEOUT_MIN - 1),
      String(CONVERT_TIMEOUT_MAX + 1),
    ]) {
      expect(
        refused([...base, '--from-word', `--convert-timeout=${value}`])
      ).toMatch(/needs whole seconds/);
    }
    expect(
      refused([...base, '--from-word', '--soffice', 'soffice.exe'])
    ).toMatch(/absolute path/);
    expect(refused([...base, '--from-word', '--soffice'])).toMatch(
      /--soffice needs one value/
    );
    expect(
      refused([
        ...base,
        '--from-word',
        '--convert-timeout',
        '30',
        '--convert-timeout',
        '40',
      ])
    ).toMatch(/needs one value/);
    expect(
      ok([
        ...base,
        '--from-word',
        '--convert-timeout',
        String(CONVERT_TIMEOUT_MIN),
      ])
    ).toMatchObject({ convertTimeoutSeconds: CONVERT_TIMEOUT_MIN });
  });
});
