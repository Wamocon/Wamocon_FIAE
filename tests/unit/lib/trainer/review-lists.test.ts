import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  REVIEWS_MAX_PAGE_SIZE,
  REVIEWS_PAGE_SIZE,
  parsePaging,
  parseQuizType,
  parseSearch,
  parseStatusFilter,
} from '@/lib/trainer/review-paging';
import {
  FEEDBACK_REQUIRED,
  hasReviewFeedback,
} from '@/lib/trainer/review-feedback';
import {
  clearReviewListState,
  peekReviewListSearch,
  readReviewListState,
  saveReviewListState,
} from '@/lib/trainer/review-list-state';

const q = (s: string) => new URLSearchParams(s);

describe('parsePaging (WMCNL-2999)', () => {
  it('has a bounded default page', () => {
    expect(parsePaging(q(''))).toEqual({ limit: REVIEWS_PAGE_SIZE, offset: 0 });
    expect(REVIEWS_PAGE_SIZE).toBeLessThanOrEqual(REVIEWS_MAX_PAGE_SIZE);
  });

  it('takes limit and offset', () => {
    expect(parsePaging(q('limit=20&offset=40'))).toEqual({
      limit: 20,
      offset: 40,
    });
  });

  it('never goes above the largest page', () => {
    expect(parsePaging(q('limit=99999')).limit).toBe(REVIEWS_MAX_PAGE_SIZE);
  });

  it.each(['0', '-1', 'abc', '1.5', '1e3', '', '%20'])(
    'falls back to the defaults for %p',
    value => {
      expect(parsePaging(q(`limit=${value}&offset=${value}`))).toEqual({
        limit: REVIEWS_PAGE_SIZE,
        offset: 0,
      });
    }
  );

  it('takes an offset of 0 as it is', () => {
    expect(parsePaging(q('offset=0')).offset).toBe(0);
  });
});

describe('parseStatusFilter', () => {
  it.each(['pending', 'all', 'approved', 'rejected'] as const)(
    'knows %s',
    status => {
      expect(parseStatusFilter(q(`status=${status}`))).toBe(status);
    }
  );

  it('reads the older onlyPending of the dashboard link', () => {
    expect(parseStatusFilter(q('onlyPending=true'))).toBe('pending');
    expect(parseStatusFilter(q('onlyPending=false'))).toBe('all');
  });

  it('does not limit without a filter, and not for an unknown one', () => {
    expect(parseStatusFilter(q(''))).toBe('all');
    expect(parseStatusFilter(q('status=DROP'))).toBe('all');
  });

  it('prefers status over onlyPending', () => {
    expect(parseStatusFilter(q('status=approved&onlyPending=true'))).toBe(
      'approved'
    );
  });
});

describe('parseSearch and parseQuizType', () => {
  it('trims and bounds the search text', () => {
    expect(parseSearch(q('q=%20Anna%20'))).toBe('Anna');
    expect(parseSearch(q(`q=${'x'.repeat(500)}`))).toHaveLength(100);
  });

  it('has no search for an empty text', () => {
    expect(parseSearch(q(''))).toBeNull();
    expect(parseSearch(q('q=%20%20'))).toBeNull();
  });

  it('knows the two kinds of quiz only', () => {
    expect(parseQuizType(q('quizType=LESSON'))).toBe('LESSON');
    expect(parseQuizType(q('quizType=GLOBAL'))).toBe('GLOBAL');
    expect(parseQuizType(q('quizType=lesson'))).toBeNull();
    expect(parseQuizType(q(''))).toBeNull();
  });
});

describe('hasReviewFeedback (WMCNL-3000)', () => {
  it('is true for a text with a visible character', () => {
    expect(hasReviewFeedback('Bitte genauer beschreiben')).toBe(true);
  });

  it.each([undefined, null, '', '   ', '\n\t', 5, {}, []])(
    'is false for %p',
    value => {
      expect(hasReviewFeedback(value)).toBe(false);
    }
  );

  it('counts one feedback per scenario', () => {
    expect(
      hasReviewFeedback(undefined, [
        { scenarioIndex: 0, feedback: ' ' },
        { scenarioIndex: 1, feedback: 'Zu knapp' },
      ])
    ).toBe(true);
    expect(
      hasReviewFeedback(undefined, [{ scenarioIndex: 0, feedback: ' ' }])
    ).toBe(false);
    expect(hasReviewFeedback(undefined, [])).toBe(false);
    expect(hasReviewFeedback(undefined, 'no list')).toBe(false);
    expect(hasReviewFeedback(undefined, [null, {}])).toBe(false);
  });

  it('names the code of the refusal', () => {
    expect(FEEDBACK_REQUIRED).toBe('FEEDBACK_REQUIRED');
  });
});

describe('review list position (WMCNL-3002)', () => {
  beforeEach(() => window.sessionStorage.clear());
  const state = {
    search: 'view=quizzes&status=all&catalog=KFBM',
    key: 'quizzes|all|all||KFBM',
    scrollTop: 840,
    loaded: 150,
  };

  it('gives the position back for the same list', () => {
    saveReviewListState(state, 1000);
    expect(readReviewListState(state.key, 2000)).toMatchObject(state);
    expect(peekReviewListSearch(2000)).toBe(state.search);
  });

  it('does not give it for another list (another filter or occupation)', () => {
    saveReviewListState(state, 1000);
    expect(readReviewListState('quizzes|pending|all||KFBM', 2000)).toBeNull();
  });

  it('keeps it until it is cleared, so a page that loads twice finds it', () => {
    saveReviewListState(state, 1000);
    expect(readReviewListState(state.key, 2000)).not.toBeNull();
    expect(readReviewListState(state.key, 3000)).not.toBeNull();
    clearReviewListState();
    expect(readReviewListState(state.key, 4000)).toBeNull();
  });

  it('forgets a position that is too old', () => {
    saveReviewListState(state, 1000);
    expect(readReviewListState(state.key, 1000 + 16 * 60 * 1000)).toBeNull();
    expect(peekReviewListSearch(1000 + 16 * 60 * 1000)).toBeNull();
  });

  it('ignores a damaged entry', () => {
    window.sessionStorage.setItem('wmc.trainer.reviews.listState', '{nope');
    expect(readReviewListState(state.key)).toBeNull();
    window.sessionStorage.setItem(
      'wmc.trainer.reviews.listState',
      JSON.stringify({ key: state.key })
    );
    expect(readReviewListState(state.key)).toBeNull();
  });
});
