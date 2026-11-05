/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FIAE,
  KFBM,
  ORG,
  OTHER_ORG,
  T1,
  T2,
  loadScoped,
  scopeReq,
  selectsFrom,
  superAdminSession,
} from '../../../helpers/trainerScope';
import { traineeSession } from '../../../helpers/mockNext';
import {
  quizReviewedMessage,
  quizzesReviewedMessage,
} from '@/lib/notifications/quiz-reviewed';
import { BULK_REVIEW_MAX } from '@/lib/trainer/review-paging';

// WMCNL-3001: "Als bewertet markieren" for many quiz submissions in one step.
// The rights are those of the single route (organization, occupation, quiz in
// the occupation), a submission outside of them is skipped and counted, a
// submission that is reviewed already is counted as such, and every trainee
// gets one notification instead of one per quiz.

const BULK = 'trainer/quiz-submissions/bulk-review/route';
const URL_BULK = 'http://localhost/api/trainer/quiz-submissions/bulk-review';

const sid = (n: number) =>
  `bbbbbbb2-0000-4000-8000-${String(n).padStart(12, '0')}`;
const qid = (n: number) =>
  `bbbbbbb1-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** What the first query reads: the submission with the title of its quiz. */
const found = (n: number, over: Record<string, unknown> = {}) => ({
  id: sid(n),
  isReviewed: false,
  quizTitle: `Quiz ${n}`,
  ...over,
});
/** What the update gives back. */
const updated = (
  n: number,
  traineeId = T1,
  over: Record<string, unknown> = {}
) => ({
  id: sid(n),
  traineeId,
  quizId: qid(n),
  score: 80,
  trainerFeedback: null,
  ...over,
});

const post = (ids: unknown, header?: string) =>
  scopeReq(URL_BULK, { header, method: 'POST', body: { ids } });

async function run(
  ids: unknown,
  opts: {
    found?: any[];
    updated?: any[];
    header?: string;
    session?: any;
  } = {}
) {
  const { mod, mock } = await loadScoped(BULK, {
    session: opts.session,
    tables: {
      quizSubmissions: opts.found ?? [],
      profiles: [
        { id: T1, role: 'TRAINEE', organizationId: ORG },
        { id: T2, role: 'TRAINEE', organizationId: ORG },
      ],
    },
    returns: { quizSubmissions: opts.updated ?? [] },
  });
  const res = await mod.POST(post(ids, opts.header));
  return { res, body: await res.json(), mock };
}

const notificationsOf = (mock: any) =>
  (mock.writes('insert', 'notifications') as any[]).flat();

describe('POST /api/trainer/quiz-submissions/bulk-review: access', () => {
  beforeEach(() => jest.clearAllMocks());

  it('an anonymous caller is turned away (401)', async () => {
    const { mod } = await loadScoped(BULK, { session: null });
    expect((await mod.POST(post([sid(1)]))).status).toBe(401);
  });

  it('a trainee is turned away (403) without reading anything', async () => {
    const { mod, mock } = await loadScoped(BULK, {
      session: traineeSession('t1'),
    });
    expect((await mod.POST(post([sid(1)]))).status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
    expect(mock.db.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/trainer/quiz-submissions/bulk-review: the request', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['no ids', undefined],
    ['an empty list', []],
    ['ids that are no list', 'abc'],
    ['an id that is no uuid', [sid(1), 'nope']],
    ['an id that is no string', [sid(1), 7]],
  ])('refuses %s (400) and changes nothing', async (_name, ids) => {
    const { res, mock } = await run(ids);
    expect(res.status).toBe(400);
    expect(mock.db.update).not.toHaveBeenCalled();
    expect(mock.db.insert).not.toHaveBeenCalled();
    expect(selectsFrom(mock, 'quiz_submissions')).toHaveLength(0);
  });

  it('takes 100 ids and refuses 101 (400)', async () => {
    expect(BULK_REVIEW_MAX).toBe(100);
    const hundred = Array.from({ length: 100 }, (_, i) => sid(i + 1));
    const ok = await run(hundred);
    expect(ok.res.status).toBe(200);
    expect(ok.body.requested).toBe(100);

    const tooMany = await run([...hundred, sid(101)]);
    expect(tooMany.res.status).toBe(400);
    expect(tooMany.mock.db.update).not.toHaveBeenCalled();
    expect(selectsFrom(tooMany.mock, 'quiz_submissions')).toHaveLength(0);
  });

  it('counts an id that comes twice once', async () => {
    const { body } = await run([sid(1), sid(1), sid(1).toUpperCase()], {
      found: [found(1)],
      updated: [updated(1)],
    });
    expect(body.requested).toBe(1);
    expect(body.marked).toBe(1);
  });
});

describe('POST /api/trainer/quiz-submissions/bulk-review: the rights of the single route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads and writes only inside the organization, the role and the catalogs of the caller', async () => {
    const { res, mock } = await run([sid(1)], {
      found: [found(1)],
      updated: [updated(1)],
    });
    expect(res.status).toBe(200);
    for (const op of ['select', 'update'] as const) {
      const filter = mock.filters(op, 'quiz_submissions');
      expect(filter.sql).toContain(
        '"quiz_submissions"."trainee_id" in (select'
      );
      expect(filter.sql).toContain('"profiles"."organization_id" = $');
      expect(filter.params).toContain(ORG);
      expect(filter.params).toContain('TRAINEE');
      expect(filter.params).not.toContain(OTHER_ORG);
    }
    // the quiz has to lie inside the catalogs of the caller
    const read = mock.filters('select', 'quiz_submissions');
    expect(read.sql).toContain('"quizzes"."training_catalog_id" in ($');
    expect(read.params).toEqual(expect.arrayContaining([FIAE, KFBM]));
    // the write names only the open submissions and never touches a reviewed one
    const write = mock.filters('update', 'quiz_submissions');
    expect(write.sql).toContain('"quiz_submissions"."is_reviewed" = $');
    expect(write.params).toContain(sid(1));
  });

  it('with an occupation (x-catalog) only its trainees and its quizzes', async () => {
    const { res, mock } = await run([sid(1)], {
      header: 'KFBM',
      found: [found(1)],
      updated: [updated(1)],
    });
    expect(res.status).toBe(200);
    for (const op of ['select', 'update'] as const) {
      const filter = mock.filters(op, 'quiz_submissions');
      expect(filter.sql).toContain(
        'exists (select 1 from "trainee_enrollments"'
      );
      expect(filter.params).toContain(KFBM);
    }
    const read = mock.filters('select', 'quiz_submissions');
    expect(read.sql).toContain('"quizzes"."training_catalog_id" = $');
    expect(read.params).not.toContain(FIAE);
  });

  it('refuses an occupation the organization has not enabled (403) and reads nothing', async () => {
    const { mod, mock } = await loadScoped(BULK, {
      tables: {
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      },
    });
    const res = await mod.POST(post([sid(1)], 'KFBM'));
    expect(res.status).toBe(403);
    expect(selectsFrom(mock, 'quiz_submissions')).toHaveLength(0);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('skips what is outside of the scope, counts it, and never reports it as done', async () => {
    // three ids asked for, the scoped read finds one of them
    const { res, body, mock } = await run([sid(1), sid(2), sid(3)], {
      found: [found(1)],
      updated: [updated(1)],
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      requested: 3,
      marked: 1,
      alreadyReviewed: 0,
      skipped: 2,
    });
    expect(body.reviewedIds).toEqual([sid(1)]);
    // only the id that was found is written
    const write = mock.filters('update', 'quiz_submissions');
    expect(write.params).toContain(sid(1));
    expect(write.params).not.toContain(sid(2));
    expect(write.params).not.toContain(sid(3));
  });

  it('when nothing is inside the scope nothing is written and nothing is announced', async () => {
    const { res, body, mock } = await run([sid(1), sid(2)], { found: [] });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      requested: 2,
      marked: 0,
      alreadyReviewed: 0,
      skipped: 2,
      notified: 0,
    });
    expect(mock.db.update).not.toHaveBeenCalled();
    expect(mock.db.insert).not.toHaveBeenCalled();
  });

  it('the super admin reads every organization', async () => {
    const { res, mock } = await run([sid(1)], {
      session: superAdminSession(),
      found: [found(1)],
      updated: [updated(1)],
    });
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'quiz_submissions').sql).not.toContain(
      'organization_id'
    );
  });
});

describe('POST /api/trainer/quiz-submissions/bulk-review: idempotent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('counts a submission that is reviewed already and leaves it alone', async () => {
    const { body, mock } = await run([sid(1), sid(2)], {
      found: [found(1, { isReviewed: true }), found(2)],
      updated: [updated(2)],
    });
    expect(body).toMatchObject({
      requested: 2,
      marked: 1,
      alreadyReviewed: 1,
      skipped: 0,
    });
    // the reviewed one is not part of the write and gets no notification
    const write = mock.filters('update', 'quiz_submissions');
    expect(write.params).toContain(sid(2));
    expect(write.params).not.toContain(sid(1));
    expect(notificationsOf(mock)).toHaveLength(1);
  });

  it('a second request for the same ids changes and announces nothing', async () => {
    const { res, body, mock } = await run([sid(1), sid(2)], {
      found: [found(1, { isReviewed: true }), found(2, { isReviewed: true })],
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      marked: 0,
      alreadyReviewed: 2,
      skipped: 0,
      notified: 0,
    });
    expect(mock.db.update).not.toHaveBeenCalled();
    expect(mock.db.insert).not.toHaveBeenCalled();
  });

  it('counts a submission that another request reviewed in the meantime as already done', async () => {
    // both were open when read, the write only got one of them
    const { body, mock } = await run([sid(1), sid(2)], {
      found: [found(1), found(2)],
      updated: [updated(1)],
    });
    expect(body).toMatchObject({ marked: 1, alreadyReviewed: 1, skipped: 0 });
    expect(notificationsOf(mock)).toHaveLength(1);
  });
});

describe('POST /api/trainer/quiz-submissions/bulk-review: one notification per trainee', () => {
  beforeEach(() => jest.clearAllMocks());

  it('for exactly one quiz it is the text and the context of the single route', async () => {
    const { mock } = await run([sid(1)], {
      found: [found(1)],
      updated: [updated(1, T1, { trainerFeedback: 'Gut' })],
    });
    const [n] = notificationsOf(mock);
    expect(n).toMatchObject({
      userId: T1,
      type: 'QUIZ_REVIEWED',
      title: 'Quiz bewertet',
      linkUrl: '/trainee/trainer-feedback',
      organizationId: ORG,
    });
    expect(n.message).toBe(
      quizReviewedMessage({
        quizTitle: 'Quiz 1',
        score: 80,
        hasFeedback: true,
      })
    );
    expect(n.context).toEqual({
      submissionId: sid(1),
      quizId: qid(1),
      quizTitle: 'Quiz 1',
      score: 80,
    });
  });

  it('bundles the quizzes of one trainee in one notification with the titles', async () => {
    const { body, mock } = await run([sid(1), sid(2), sid(3)], {
      found: [found(1), found(2), found(3)],
      updated: [updated(1), updated(2), updated(3)],
    });
    expect(body).toMatchObject({ marked: 3, notified: 1 });
    const list = notificationsOf(mock);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      userId: T1,
      type: 'QUIZ_REVIEWED',
      title: 'Quiz bewertet',
      linkUrl: '/trainee/trainer-feedback',
    });
    expect(list[0].message).toBe(
      'Deine 3 Quizze wurden bewertet: „Quiz 1“, „Quiz 2“, „Quiz 3“'
    );
    expect(list[0].context).toMatchObject({
      count: 3,
      submissionIds: [sid(1), sid(2), sid(3)],
      quizTitles: ['Quiz 1', 'Quiz 2', 'Quiz 3'],
    });
  });

  it('gives every trainee their own notification, with only their quizzes', async () => {
    const { mock } = await run([sid(1), sid(2), sid(3)], {
      found: [found(1), found(2), found(3)],
      updated: [updated(1, T1), updated(2, T2), updated(3, T1)],
    });
    const list = notificationsOf(mock);
    expect(list).toHaveLength(2);
    const forT1 = list.find(n => n.userId === T1);
    const forT2 = list.find(n => n.userId === T2);
    expect(forT1.message).toBe(
      'Deine 2 Quizze wurden bewertet: „Quiz 1“, „Quiz 3“'
    );
    expect(forT2.message).toBe(
      quizReviewedMessage({ quizTitle: 'Quiz 2', score: 80 })
    );
  });

  it('is sent by the trainer who marked, for the organization of the trainee', async () => {
    const { mock } = await run([sid(1), sid(2)], {
      found: [found(1), found(2)],
      updated: [updated(1), updated(2)],
    });
    const [n] = notificationsOf(mock);
    expect(n.actorId).toBe('99999999-9999-4999-8999-999999999999');
    expect(n.organizationId).toBe(ORG);
  });

  it('marks as reviewed even when the notification cannot be written', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { mod, mock } = await loadScoped(BULK, {
      tables: {
        quizSubmissions: [found(1), found(2)],
        profiles: [{ id: T1, role: 'TRAINEE', organizationId: ORG }],
      },
      returns: { quizSubmissions: [updated(1), updated(2)] },
    });
    mock.db.insert.mockImplementationOnce(() => {
      throw new Error('notifications are down');
    });
    const res = await mod.POST(post([sid(1), sid(2)]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ marked: 2, notified: 0 });
  });
});

describe('quizzesReviewedMessage', () => {
  it('names the titles as far as they fit and marks the rest with an ellipsis', () => {
    const titles = Array.from({ length: 30 }, (_, i) => `Netzwerktechnik ${i}`);
    const text = quizzesReviewedMessage(30, titles);
    expect(
      text.startsWith('Deine 30 Quizze wurden bewertet: „Netzwerktechnik 0“')
    ).toBe(true);
    expect(text.endsWith(' …')).toBe(true);
    // the titles part stays short
    expect(text.length).toBeLessThan(220);
  });

  it('names a quiz that was handed in twice once and adds no ellipsis for it', () => {
    expect(quizzesReviewedMessage(2, ['Quiz A', 'Quiz A'])).toBe(
      'Deine 2 Quizze wurden bewertet: „Quiz A“'
    );
  });

  it('cuts one title that is longer than the room', () => {
    const text = quizzesReviewedMessage(2, ['x'.repeat(400), 'B']);
    expect(text.length).toBeLessThan(220);
    expect(text).toContain('…“');
    expect(text.endsWith(' …')).toBe(true);
  });

  it('without a title it still says how many', () => {
    expect(quizzesReviewedMessage(4, [null, ' '])).toBe(
      'Deine 4 Quizze wurden bewertet.'
    );
  });
});
