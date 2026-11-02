import {
  classifyShareFailure,
  courseHeading,
  difficultyTextKey,
  groupByCourse,
  initialsOf,
  isWebAddress,
  matchesEnablerFilter,
  nameProblem,
  submissionStatusTextKey,
} from '@/lib/trainer/trainee-detail-view';

// WMCNL-2985, 2987, 2988, 2989, 2990, 2992, 2994: the small rules of the
// detail page of a trainee.

describe('enabler filter and badge use one vocabulary (WMCNL-2988)', () => {
  const done = { completed: true, isActive: true, state: 'completed' as const };
  const open = { completed: false, isActive: true, state: 'open' as const };
  const locked = { completed: false, isActive: true, state: 'locked' as const };
  const off = { completed: false, isActive: false, state: null };

  it('Abgeschlossen, Offen and Gesperrt are the states of the badge', () => {
    expect(matchesEnablerFilter(done, 'completed')).toBe(true);
    expect(matchesEnablerFilter(open, 'completed')).toBe(false);
    expect(matchesEnablerFilter(open, 'open')).toBe(true);
    expect(matchesEnablerFilter(done, 'open')).toBe(false);
    expect(matchesEnablerFilter(locked, 'locked')).toBe(true);
    expect(matchesEnablerFilter(open, 'locked')).toBe(false);
  });

  it('Inaktiv is only the enabler that is switched off, Alle is everything', () => {
    expect(matchesEnablerFilter(off, 'inactive')).toBe(true);
    expect(matchesEnablerFilter(done, 'inactive')).toBe(false);
    expect(matchesEnablerFilter(off, 'open')).toBe(false);
    for (const e of [done, open, locked, off]) {
      expect(matchesEnablerFilter(e, 'all')).toBe(true);
    }
  });
});

describe('grouping by course (WMCNL-2989, 2992)', () => {
  const items = [
    { id: 1, courseId: 'c1', courseTitle: 'Kommunikation', courseCode: 'K1' },
    { id: 2, courseId: 'c2', courseTitle: 'Kommunikation', courseCode: 'K7' },
    { id: 3, courseId: 'c1', courseTitle: 'Kommunikation', courseCode: 'K1' },
    { id: 4, courseId: undefined, courseTitle: '' },
  ];

  it('keys the groups by the id of the course and keeps the order', () => {
    const groups = groupByCourse(items, 'Sonstige');
    expect(groups.map(g => g.key)).toEqual(['c1', 'c2', 'title:Sonstige']);
    expect(groups[0].items.map(i => i.id)).toEqual([1, 3]);
    expect(groups[2].title).toBe('Sonstige');
  });

  it('two courses with one title stay two groups, told apart by the code', () => {
    const groups = groupByCourse(items, 'Sonstige');
    expect(courseHeading(groups[0], groups)).toBe('Kommunikation (K1)');
    expect(courseHeading(groups[1], groups)).toBe('Kommunikation (K7)');
    expect(courseHeading(groups[2], groups)).toBe('Sonstige');
  });
});

describe('texts of levels and status values (WMCNL-2989, 2990)', () => {
  it('shows the levels in German words, not LOW, MEDIUM, HIGH', () => {
    expect(difficultyTextKey('LOW')).toBe('enablerPage.difficultyLow');
    expect(difficultyTextKey('medium')).toBe('enablerPage.difficultyMedium');
    expect(difficultyTextKey('HIGH')).toBe('enablerPage.difficultyHigh');
    expect(difficultyTextKey(null)).toBe('trainee.detail.difficultyUnknown');
  });

  it('maps APPROVED, REJECTED and PENDING to texts and none to "not submitted"', () => {
    expect(submissionStatusTextKey('APPROVED')).toBe(
      'trainee.detail.status.approved'
    );
    expect(submissionStatusTextKey('REJECTED')).toBe(
      'trainee.detail.status.rejected'
    );
    expect(submissionStatusTextKey('PENDING')).toBe(
      'trainee.detail.status.pending'
    );
    expect(submissionStatusTextKey(null)).toBe('trainee.detail.notSubmitted');
  });
});

describe('name and picture address (WMCNL-2985, 2994)', () => {
  it('an empty or blank name is refused, a normal one is not', () => {
    expect(nameProblem('')).toBe('empty');
    expect(nameProblem('   ')).toBe('empty');
    expect(nameProblem('Leon Moretz')).toBeNull();
    expect(nameProblem('x'.repeat(121))).toBe('tooLong');
  });

  it('a picture address is empty or http(s)', () => {
    expect(isWebAddress('')).toBe(true);
    expect(isWebAddress('https://example.com/a.png')).toBe(true);
    expect(isWebAddress('javascript:alert(1)')).toBe(false);
    expect(isWebAddress('kein Link')).toBe(false);
  });

  it('takes the initials for the picture instead of a trend symbol', () => {
    expect(initialsOf('Leon Moretz')).toBe('LM');
    expect(initialsOf('  anna  ')).toBe('A');
    expect(initialsOf('')).toBe('');
    expect(initialsOf(undefined)).toBe('');
  });
});

describe('a failed share (WMCNL-2987)', () => {
  it('"Permission denied" of the browser is a refusal, not an error text', () => {
    const denied = Object.assign(new Error('Permission denied'), {
      name: 'NotAllowedError',
    });
    expect(classifyShareFailure(denied)).toBe('denied');
    expect(classifyShareFailure(new Error('Permission denied'))).toBe('denied');
  });

  it('closing the share sheet is no failure at all', () => {
    const aborted = Object.assign(new Error('Share canceled'), {
      name: 'AbortError',
    });
    expect(classifyShareFailure(aborted)).toBe('cancelled');
  });

  it('anything else is a failure with the download as way out', () => {
    expect(classifyShareFailure(new Error('boom'))).toBe('other');
    expect(classifyShareFailure(undefined)).toBe('other');
  });
});
