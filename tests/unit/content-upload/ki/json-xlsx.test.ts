/**
 * @jest-environment node
 */
// A quiz JSON file and an Excel file never reach the model (package UP2): not their
// content, not an excerpt, not even the file name. A JSON file holds the correct answers
// and the explanations, so it also counts for the guard: what a teaching text repeats
// from it is cut out of that text's excerpt. Against a stand-in for Sokrates on localhost.
import { pumpReviewRun } from '@/lib/content-upload/review/steps';
import { KI_CODE_KEY, KI_STATE_KEY } from '@/lib/content-upload/ki/steps';

import {
  answers,
  startFakeSokrates,
  type FakeSokrates,
} from '../../../helpers/fakeSokrates';
import {
  GOOD_ANSWER,
  ambiguousQuiz,
  kiHarness,
} from '../../../helpers/kiFixtures';
import { lessonJsonSeed, mappingSeed } from '../../../helpers/jsonXlsxSeeds';
import { b, t } from '../../../helpers/uploadFixtures';

let fake: FakeSokrates;
beforeEach(async () => {
  fake = await startFakeSokrates(answers(() => GOOD_ANSWER));
});
afterEach(async () => {
  await fake.close();
});

const body = (seen: { raw?: string }) => seen.raw ?? '';

describe('the model stage and the files that are no Word files', () => {
  it('sends the unclear Word file and none of a JSON file or an Excel file next to it', async () => {
    const h = await kiHarness(fake, [
      await ambiguousQuiz(),
      lessonJsonSeed(),
      await mappingSeed(),
    ]);
    await h.rules();
    await h.pump();
    expect(fake.requests).toHaveLength(1);
    const sent = body(fake.requests[0]);
    for (const word of [
      'Erfundene Frage',
      'ZETA',
      'Begründung',
      'enabler-quizze',
      'Zuordnung',
      'Schuljahr',
      'schema_version',
      'difficulties',
    ]) {
      expect(sent).not.toContain(word);
    }
    const records = await h.ctx.review.listRecords(h.run.id);
    for (const name of ['enabler-quizze.json', 'Zuordnung.xlsx']) {
      const record = records.find(x => x.file.fileName === name)!;
      // decided by the rules alone, never handed to the model stage
      expect(record.file.status).toBe('proposed_rules');
      expect(record.file.parseSummary?.[KI_STATE_KEY]).toBeUndefined();
      expect(record.proposal?.source).toBe('content');
    }
    // the log names no call for them
    const jsonId = records.find(x => x.file.fileName.endsWith('.json'))!.file
      .id;
    const xlsxId = records.find(x => x.file.fileName.endsWith('.xlsx'))!.file
      .id;
    expect(
      h.ctx.ki.calls.filter(c => c.fileId === jsonId || c.fileId === xlsxId)
    ).toEqual([]);
  });

  it('settles a JSON or Excel file that somehow got to the model stage as not sent, without reading it', async () => {
    const h = await kiHarness(fake, [lessonJsonSeed(), await mappingSeed()]);
    await h.rules();
    // force the two files into the state the model stage takes, as a bug or a fault might
    for (const record of await h.ctx.review.listRecords(h.run.id)) {
      const stored = h.ctx.repo.files.get(record.file.id);
      if (stored) stored.status = 'ki_pending';
    }
    await h.pump({ rounds: 3 });
    expect(fake.requests).toEqual([]);
    for (const record of await h.ctx.review.listRecords(h.run.id)) {
      expect(record.file.parseSummary?.[KI_STATE_KEY]).toBe('not_sent');
      expect(record.file.parseSummary?.[KI_CODE_KEY]).toBe('FORMAT_NOT_SENT');
    }
  });

  it('cuts out of a teaching text what a JSON file of the run holds as an answer, and refuses a text with two', async () => {
    const quizOf = (name: string, first: string, second: string) =>
      ambiguousQuiz(name, {
        blocks: [
          t('6a) Thema'),
          t('Quiz, Schwierigkeitsgrad: leicht'),
          b(`1. ${first}`),
          t('A) erfunden eins'),
          t('B) erfunden zwei'),
          t('C) erfunden drei'),
          t('D) erfunden vier'),
          b('Richtige Antwort: A'),
          t(
            'Kurzbegründung: Das ist erfunden und lang genug für den Test hier.'
          ),
          b(`2. ${second}`),
          t('A) erfunden eins'),
          t('B) erfunden zwei'),
          t('C) erfunden drei'),
          t('D) erfunden vier'),
          b('Richtige Antwort: B'),
          t(
            'Kurzbegründung: Auch das ist erfunden und lang genug für den Test hier.'
          ),
          b('3. Eine harmlose Frage zum Thema Netzwerk?'),
          t('A) erfunden eins'),
          t('B) erfunden zwei'),
          t('C) erfunden drei'),
          t('D) erfunden vier'),
          b('Richtige Antwort: C'),
          t('Kurzbegründung: Auch das ist erfunden und lang genug hier.'),
        ],
      });
    // the explanations of the questions of the JSON file
    const e1 = 'Erfundene Begründung ZETA-1aLow1.';
    const e2 = 'Erfundene Begründung ZETA-1aLow2.';
    const words = async () => [
      await quizOf(
        'Quiz-1.docx',
        `${e1} Stimmt das?`,
        'Eine zweite harmlose Frage zum Thema Routing?'
      ),
      await quizOf('Quiz-2.docx', `${e1} Stimmt das?`, `${e2} Stimmt das?`),
    ];
    // control: without the JSON file nothing is known, and both texts go out with the line
    const control = await kiHarness(fake, await words());
    await control.rules();
    await control.pump();
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests.some(seen => body(seen).includes('ZETA'))).toBe(true);
    fake.requests.length = 0;

    const h = await kiHarness(fake, [lessonJsonSeed(), ...(await words())]);
    await h.rules();
    await h.pump();
    for (const seen of fake.requests) {
      expect(body(seen)).not.toContain('ZETA');
    }
    const records = await h.ctx.review.listRecords(h.run.id);
    const two = records.find(x => x.file.relPath.endsWith('Quiz-2.docx'))!;
    expect(two.file.parseSummary).toMatchObject({
      [KI_STATE_KEY]: 'not_sent',
      [KI_CODE_KEY]: 'GUARD_REFUSED',
    });
    // the other file went out, without the repeated line
    expect(fake.requests).toHaveLength(1);
    expect(body(fake.requests[0])).toContain('zweite harmlose Frage');
  });

  it('does not take a JSON file in the list of known solutions when it is broken (it is rejected and holds nothing)', async () => {
    const h = await kiHarness(fake, [
      lessonJsonSeed('kaputt.json', '{ nicht lesbar'),
      await ambiguousQuiz(),
    ]);
    await h.rules();
    await h.pump();
    expect(fake.requests).toHaveLength(1);
  });

  it('keeps the pump of the review from ever sending a mapping table, whatever its sheet says', async () => {
    const h = await kiHarness(fake, [await mappingSeed()], {
      limits: undefined,
    });
    await pumpReviewRun(
      h.ctx.reviewDeps,
      h.run.id,
      { closeUpload: true, retryDelaySeconds: 0 },
      h.env()
    );
    expect(fake.requests).toEqual([]);
  });
});
