import { traineeDisplayName } from '@/lib/trainer/trainee-name';
import { pickTraineeId } from '@/lib/trainer/calendar-selection';
import { examsAsBlocks } from '@/lib/trainer/calendar-exams';

describe('traineeDisplayName (WMCNL-3020: names written in small letters)', () => {
  it('prefers first and last name, then the full name', () => {
    expect(traineeDisplayName({ firstName: 'Leon', lastName: 'Moretz' })).toBe(
      'Leon Moretz'
    );
    expect(traineeDisplayName({ full_name: 'Yordan Krastev' })).toBe(
      'Yordan Krastev'
    );
    expect(traineeDisplayName({ fullName: 'Yordan Krastev' })).toBe(
      'Yordan Krastev'
    );
  });

  it('makes a name with capitals out of the e-mail address as a last resort', () => {
    expect(traineeDisplayName({ email: 'yordan.krastev@example.com' })).toBe(
      'Yordan Krastev'
    );
    expect(traineeDisplayName({ email: 'leon_moretz@example.com' })).toBe(
      'Leon Moretz'
    );
  });

  it('uses the fallback without any data', () => {
    expect(traineeDisplayName({}, 'Unbekannt')).toBe('Unbekannt');
    expect(traineeDisplayName({ firstName: ' ', email: '' }, 'X')).toBe('X');
  });
});

describe('pickTraineeId', () => {
  it('keeps the stored trainee when it is in the list, else the first', () => {
    expect(pickTraineeId(['a', 'b'], 'b')).toBe('b');
    expect(pickTraineeId(['a', 'b'], 'zzz')).toBe('a');
    expect(pickTraineeId(['a', 'b'], null)).toBe('a');
    expect(pickTraineeId([], 'a')).toBe('');
  });
});

describe('examsAsBlocks', () => {
  const label = (t: string | null | undefined) => (t ? `Typ ${t}` : '');
  it('turns an exam into a view only block of the type EXAM', () => {
    const [block] = examsAsBlocks(
      [
        {
          id: 'e1',
          examDate: '2026-11-10T09:00:00.000Z',
          subject: 'Netzwerktechnik',
          examTypeValue: 'TEST',
          isPersonal: true,
        },
      ],
      [],
      label
    );
    expect(block).toMatchObject({
      id: 'exam:e1',
      blockType: 'EXAM',
      title: 'Netzwerktechnik',
      description: 'Typ TEST',
      createdByTrainerId: null,
      isPersonal: true,
    });
  });

  it('leaves out an exam when an EXAM block starts the same day, and a broken date', () => {
    const out = examsAsBlocks(
      [
        { id: 'a', examDate: '2026-11-10T08:00:00.000Z', subject: 'A' },
        { id: 'b', examDate: '2026-11-11T08:00:00.000Z', subject: 'B' },
        { id: 'c', examDate: 'not a date', subject: 'C' },
      ],
      [{ blockType: 'EXAM', startDate: '2026-11-10T00:00:00.000Z' }],
      label
    );
    expect(out.map(b => b.title)).toEqual(['B']);
  });
});
