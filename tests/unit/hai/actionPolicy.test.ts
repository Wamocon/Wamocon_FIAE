/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';
import {
  actionsForRole,
  describeAction,
  isActionAllowedForRole,
  isWriteAction,
  sanitizeActionParameters,
  WRITE_ACTION_TYPES,
} from '@/lib/hai/actionPolicy';

const ID = '20000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';

describe('HAI action policy', () => {
  it('knows exactly the writing actions that are implemented', () => {
    expect([...WRITE_ACTION_TYPES].sort()).toEqual(
      [
        'approve_report',
        'approve_submission',
        'complete_enabler',
        'create_activity_report',
        'grade_quiz',
        'mark_notification_read',
        'submit_activity_report',
      ].sort()
    );
    for (const type of [
      'reject_submission',
      'upload_document',
      'submit_quiz',
      'toString',
    ]) {
      expect(isWriteAction(type)).toBe(false);
    }
  });

  it('gives trainees only trainee actions and trainers only trainer actions', () => {
    expect(actionsForRole('TRAINEE')).not.toContain('grade_quiz');
    expect(actionsForRole('TRAINER')).not.toContain('complete_enabler');
    expect(isActionAllowedForRole('mark_notification_read', 'TRAINER')).toBe(
      true
    );
    expect(isActionAllowedForRole('mark_notification_read', 'TRAINEE')).toBe(
      true
    );
  });

  it('whitelists the parameters of an action', () => {
    expect(
      sanitizeActionParameters('complete_enabler', {
        enablerId: ID,
        traineeId: 'x',
      })
    ).toEqual({ ok: true, parameters: { enablerId: ID } });
    expect(
      sanitizeActionParameters('submit_activity_report', {
        reportId: ID,
        weekNumber: 3,
        year: 2026,
        other: 1,
      })
    ).toEqual({
      ok: true,
      parameters: { weekNumber: 3, year: 2026, reportId: ID },
    });
    expect(
      sanitizeActionParameters('create_activity_report', undefined)
    ).toEqual({ ok: true, parameters: {} });
    expect(
      sanitizeActionParameters('grade_quiz', { submissionId: ID, score: 75 })
    ).toEqual({ ok: true, parameters: { submissionId: ID, score: 75 } });
  });

  it('rejects wrong parameters with a German reason', () => {
    const bad = [
      sanitizeActionParameters('complete_enabler', {}),
      sanitizeActionParameters('complete_enabler', { enablerId: 'x' }),
      sanitizeActionParameters('grade_quiz', { submissionId: ID, score: 101 }),
      sanitizeActionParameters('mark_notification_read', {}),
      sanitizeActionParameters('submit_activity_report', { reportId: 'x' }),
      sanitizeActionParameters('create_activity_report', { year: 'x' }),
      sanitizeActionParameters('approve_report', 'text'),
    ];
    for (const result of bad) {
      expect(result.ok).toBe(false);
      expect((result as { message: string }).message).toMatch(/\S/);
    }
  });

  it('describes an action without free text of the model', () => {
    expect(
      describeAction('complete_enabler', {}, { enablerTitle: 'A "B" `c`' })
    ).toBe('Enabler "A  B   c" als abgeschlossen markieren');
    // No link or image syntax from a title
    const hostile = describeAction(
      'complete_enabler',
      {},
      { enablerTitle: '![x](https://evil.example/?c=1) <b>#</b>' }
    );
    expect(hostile).not.toMatch(/[[\]()!<>#]/);
    expect(describeAction('grade_quiz', { score: 80 })).toContain('80 %');
    expect(
      describeAction('create_activity_report', { weekNumber: 4 })
    ).toContain('KW 4');
    expect(
      describeAction('mark_notification_read', { markAll: true })
    ).toContain('Alle');
    for (const type of WRITE_ACTION_TYPES) {
      expect(describeAction(type, {})).toMatch(/\S/);
      expect(describeAction(type, {})).not.toMatch(/[–—]/);
    }
  });
});

describe('getUserOrgIdStrict', () => {
  async function load(rows: any[] | 'throws') {
    jest.resetModules();
    const rec = createTableDb({ profiles: rows === 'throws' ? [] : rows });
    if (rows === 'throws') {
      rec.db.select.mockImplementation(() => {
        throw new Error('db down');
      });
    }
    jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
    return (await import('@/lib/auth-helpers')) as typeof import('@/lib/auth-helpers');
  }

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('returns the organization of the profile', async () => {
    const { getUserOrgIdStrict } = await load([{ organizationId: 'org-1' }]);
    await expect(getUserOrgIdStrict(USER)).resolves.toBe('org-1');
  });

  it.each([
    ['a missing profile', []],
    ['a profile without an organization', [{ organizationId: null }]],
    ['a failing lookup', 'throws'],
  ] as const)(
    'does not fall back to the platform organization for %s',
    async (_n, rows) => {
      const { getUserOrgIdStrict, getUserOrgId, WAMOCON_ORG_ID } = await load(
        rows as any
      );
      await expect(getUserOrgIdStrict(USER)).rejects.toThrow();
      // The lenient variant still falls back, only writes use the strict one
      await expect(getUserOrgId(USER)).resolves.toBe(WAMOCON_ORG_ID);
    }
  );

  it('rejects an empty id', async () => {
    const { getUserOrgIdStrict } = await load([]);
    await expect(getUserOrgIdStrict('')).rejects.toThrow();
  });
});

describe('HAI proactive checks only use the data of the person', () => {
  async function run(role: 'TRAINEE' | 'TRAINER') {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const rec = createTableDb({
      profiles: [{ id: USER, role, fullName: 'X' }],
      ausbildungBlocks: [],
      activityReports: [],
      enablerSubmissions: [],
      courseMembers: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
    jest.doMock('@/lib/auth-helpers', () => ({
      __esModule: true,
      ...(jest.requireActual('@/lib/auth-helpers') as object),
      getUserOrgIdStrict: async () => 'org-1',
    }));
    const { runProactiveChecks } = await import('@/lib/hai/proactive');
    await runProactiveChecks(USER);
    return rec;
  }

  it('looks for exams of this trainee only', async () => {
    const rec = await run('TRAINEE');
    const where = rec.filters('select', 'ausbildungBlocks');
    expect(where.sql).toContain('"trainee_id"');
    expect(where.params).toContain(USER);
  });

  it('counts the pending reviews of the own organization only', async () => {
    const rec = await run('TRAINER');
    for (const table of ['enablerSubmissions', 'activityReports']) {
      const where = rec.filters('select', table);
      expect(where.sql).toContain('"organization_id"');
      expect(where.params).toContain('org-1');
    }
  });
});

describe('ids parsed from the message text', () => {
  const SUB = '30000000-0000-4000-8000-000000000001';

  it('become a clean proposal only, the catalog and organization checks run at execution', async () => {
    const { detectActionIntent } = await import('@/lib/hai/actions');
    const intent = detectActionIntent(
      `genehmige die abgabe submission: ${SUB}`,
      { userRole: 'TRAINER' }
    );
    expect(intent?.type).toBe('approve_submission');
    expect(intent?.requiresConfirmation).toBe(true);
    expect(
      sanitizeActionParameters('approve_submission', intent!.parameters)
    ).toEqual({ ok: true, parameters: { submissionId: SUB } });
  });

  it('a quiz id from the text can neither grade nor submit anything', async () => {
    const { detectActionIntent } = await import('@/lib/hai/actions');
    const grade = detectActionIntent(`bewerte quiz: ${SUB}`, {
      userRole: 'TRAINER',
    });
    expect(grade?.type).toBe('grade_quiz');
    // No submission and no score in the text: nothing to propose
    expect(sanitizeActionParameters('grade_quiz', grade!.parameters).ok).toBe(
      false
    );
    const submit = detectActionIntent(`reich das quiz: ${SUB} ein`, {
      userRole: 'TRAINEE',
    });
    // Submitting a quiz is not an executable action any more
    expect(submit?.type).toBe('submit_quiz');
    expect(isWriteAction(submit!.type)).toBe(false);
  });
});
