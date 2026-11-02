import React from 'react';
import {
  act,
  configure,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiProvider, useHai } from '@/components/hai/HaiProvider';
import {
  HaiQuizModeProvider,
  useHaiQuizMode,
} from '@/components/hai/HaiQuizMode';
import { HaiQuizModeButton, HaiQuizPanel } from '@/components/hai/HaiQuizPanel';
import { authFetch } from '@/lib/authFetch';

// The quiz mode in the chat: the button starts it (for the open enabler, else
// mixed), the chat answer to "Frag mich ab" starts it with the topic, the card
// walks through question, check, feedback, next question (with the history so
// nothing repeats) and summary. The routes are replaced by authFetch.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

// A cold run compiles the components on first use, the default of one second
// for findBy is too tight for that
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const ENABLER = '20000000-0000-4000-8000-000000000001';

const questionBody = (id: string, text: string) => ({
  status: 'ok',
  total: 2,
  remaining: 2,
  question: {
    id,
    text,
    multiple: false,
    options: [
      { id: `${id}-a`, text: 'Erste Option' },
      { id: `${id}-b`, text: 'Zweite Option' },
    ],
    enablerId: ENABLER,
    enablerTitle: 'SQL Grundlagen',
    courseTitle: null,
    enablerHref: `/trainee/enablers/${ENABLER}`,
  },
});

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const calls = (path: string) =>
  authFetchMock.mock.calls
    .filter(([url]) => String(url) === path)
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

let hai: ReturnType<typeof useHai>;
let quiz: ReturnType<typeof useHaiQuizMode>;
function Probe() {
  hai = useHai();
  quiz = useHaiQuizMode();
  return null;
}

/** A chat answer as the non streaming route sends it. */
const chatAnswer = (extra: Record<string, unknown> = {}) =>
  reply(200, {
    sessionId: 's1',
    response: 'Gern, ich frage dich ab.',
    citations: [],
    ...extra,
  });

function mount(context?: { enablerId?: string }) {
  return renderWithProviders(
    <HaiQuizModeProvider>
      <HaiProvider userId="u1" initialContext={context}>
        <Probe />
        <HaiQuizModeButton />
        <HaiQuizPanel />
      </HaiProvider>
    </HaiQuizModeProvider>
  );
}

describe('HaiQuizMode: start, run and finish', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authFetchMock.mockImplementation(async (url, init) => {
      const path = String(url);
      if (path === '/api/hai/quiz-mode/next') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        return reply(
          200,
          body.exclude?.length
            ? questionBody('q2', 'Zweite Frage?')
            : questionBody('q1', 'Erste Frage?')
        );
      }
      if (path === '/api/hai/quiz-mode/answer') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        return reply(200, {
          correct: body.optionIds[0].endsWith('-a'),
          selectedOptionIds: body.optionIds,
          correctOptionIds: [`${body.questionId}-a`],
          explanation: 'Weil die erste Option stimmt.',
          multiple: false,
          enablerId: ENABLER,
        });
      }
      return reply(200, {});
    });
  });

  it('shows nothing until the quiz mode starts', () => {
    mount();
    expect(screen.queryByTestId('hai-quiz-card')).toBeNull();
    expect(
      screen.getByTestId('hai-quiz-button').getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('starts mixed from the button without an enabler context', async () => {
    mount();
    fireEvent.click(screen.getByTestId('hai-quiz-button'));
    expect(await screen.findByText('Erste Frage?')).toBeTruthy();
    expect(calls('/api/hai/quiz-mode/next')).toEqual([{ exclude: [] }]);
    expect(
      screen.getByTestId('hai-quiz-button').getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('starts for the open enabler of the chat context', async () => {
    mount({ enablerId: ENABLER });
    fireEvent.click(screen.getByTestId('hai-quiz-button'));
    await screen.findByText('Erste Frage?');
    expect(calls('/api/hai/quiz-mode/next')).toEqual([
      { enablerId: ENABLER, exclude: [] },
    ]);
  });

  it('walks through check, feedback, the next question with the history, and the summary', async () => {
    mount();
    fireEvent.click(screen.getByTestId('hai-quiz-button'));
    await screen.findByText('Erste Frage?');

    // wrong: the second option
    fireEvent.click(screen.getByText('Zweite Option'));
    fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
    expect(await screen.findByText(/Leider falsch/)).toBeTruthy();
    expect(screen.getByText('Weil die erste Option stimmt.')).toBeTruthy();
    expect(calls('/api/hai/quiz-mode/answer')).toEqual([
      { questionId: 'q1', optionIds: ['q1-b'] },
    ]);

    // the next question carries the history
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Frage' }));
    expect(await screen.findByText('Zweite Frage?')).toBeTruthy();
    expect(calls('/api/hai/quiz-mode/next')[1]).toEqual({ exclude: ['q1'] });

    // right: the first option
    fireEvent.click(screen.getByText('Erste Option'));
    fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
    expect(await screen.findByText('Richtig!')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Quiz beenden' }));
    expect(await screen.findByText('1 von 2 richtig.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'SQL Grundlagen' });
    expect(link.getAttribute('href')).toBe(`/trainee/enablers/${ENABLER}`);

    // nothing but the two quiz routes was called
    expect(
      authFetchMock.mock.calls
        .map(([url]) => String(url))
        .filter(url => !url.startsWith('/api/hai/quiz-mode/'))
    ).toEqual([]);
  });

  it('starts another round with the same scope and an empty history', async () => {
    mount();
    fireEvent.click(screen.getByTestId('hai-quiz-button'));
    await screen.findByText('Erste Frage?');
    fireEvent.click(screen.getByRole('button', { name: 'Quiz beenden' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Noch eine Runde' })
    );
    await screen.findByText('Erste Frage?');
    expect(calls('/api/hai/quiz-mode/next')).toEqual([
      { exclude: [] },
      { exclude: [] },
    ]);
  });

  it('leaves the quiz mode with the button, and drops the session', async () => {
    mount();
    fireEvent.click(screen.getByTestId('hai-quiz-button'));
    await screen.findByText('Erste Frage?');
    fireEvent.click(screen.getByTestId('hai-quiz-button'));
    expect(screen.queryByTestId('hai-quiz-card')).toBeNull();
    expect(quiz.state.asked).toEqual([]);
    expect(quiz.active).toBe(false);
  });

  it('ignores a late answer of a question the person already left', async () => {
    let release: (value: unknown) => void = () => undefined;
    authFetchMock.mockImplementation(async (url, init) => {
      const path = String(url);
      if (path === '/api/hai/quiz-mode/answer') {
        return new Promise(resolve => {
          release = resolve;
        });
      }
      if (path === '/api/hai/quiz-mode/next') {
        return reply(200, questionBody('q1', 'Erste Frage?'));
      }
      return reply(200, {});
    });
    mount();
    fireEvent.click(screen.getByTestId('hai-quiz-button'));
    await screen.findByText('Erste Frage?');
    fireEvent.click(screen.getByText('Erste Option'));
    fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
    // the person closes the quiz while the check is on its way
    fireEvent.click(screen.getByTestId('hai-quiz-button'));
    await act(async () => {
      release(
        reply(200, {
          correct: true,
          correctOptionIds: ['q1-a'],
          explanation: null,
        })
      );
    });
    expect(screen.queryByTestId('hai-quiz-card')).toBeNull();
    expect(quiz.state.attempts).toEqual([]);
  });

  describe('failures', () => {
    it('shows a failed load as an error with a retry that tries again', async () => {
      let fail = true;
      authFetchMock.mockImplementation(async url => {
        if (String(url) === '/api/hai/quiz-mode/next') {
          return fail
            ? reply(403, { code: 'ENABLER_LOCKED' })
            : reply(200, questionBody('q1', 'Erste Frage?'));
        }
        return reply(200, {});
      });
      mount();
      fireEvent.click(screen.getByTestId('hai-quiz-button'));
      expect((await screen.findByRole('alert')).textContent).toMatch(
        /gesperrt/
      );
      fail = false;
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      expect(await screen.findByText('Erste Frage?')).toBeTruthy();
    });

    it('keeps the question when the check fails and lets the person try again', async () => {
      let fail = true;
      authFetchMock.mockImplementation(async (url, init) => {
        const path = String(url);
        if (path === '/api/hai/quiz-mode/next') {
          return reply(200, questionBody('q1', 'Erste Frage?'));
        }
        if (path === '/api/hai/quiz-mode/answer') {
          if (fail) throw new Error('offline');
          return reply(200, {
            correct: true,
            correctOptionIds: ['q1-a'],
            explanation: null,
          });
        }
        return reply(200, {});
      });
      mount();
      fireEvent.click(screen.getByTestId('hai-quiz-button'));
      await screen.findByText('Erste Frage?');
      fireEvent.click(screen.getByText('Erste Option'));
      fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(
        /Keine Verbindung/
      );
      expect(screen.getByText('Erste Frage?')).toBeTruthy();
      fail = false;
      fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
      expect(await screen.findByText('Richtig!')).toBeTruthy();
    });

    it('shows the empty notice for a topic without a match and starts mixed on request', async () => {
      authFetchMock.mockImplementation(async (url, init) => {
        if (String(url) === '/api/hai/quiz-mode/next') {
          const body = JSON.parse(String(init?.body ?? '{}'));
          return body.topic
            ? reply(200, {
                status: 'empty',
                question: null,
                reason: 'no_topic_match',
              })
            : reply(200, questionBody('q1', 'Erste Frage?'));
        }
        return reply(200, {});
      });
      mount();
      act(() => quiz.start({ topic: 'Kochen' }));
      expect(await screen.findByText(/keine Quizfragen/)).toBeTruthy();
      fireEvent.click(
        screen.getByRole('button', { name: 'Gemischt abfragen' })
      );
      expect(await screen.findByText('Erste Frage?')).toBeTruthy();
      expect(calls('/api/hai/quiz-mode/next')[1]).toEqual({ exclude: [] });
    });

    it('ends in the summary when everything is through', async () => {
      authFetchMock.mockImplementation(async (url, init) => {
        const path = String(url);
        if (path === '/api/hai/quiz-mode/next') {
          const body = JSON.parse(String(init?.body ?? '{}'));
          return body.exclude?.length
            ? reply(200, { status: 'exhausted', question: null, total: 1 })
            : reply(200, questionBody('q1', 'Erste Frage?'));
        }
        if (path === '/api/hai/quiz-mode/answer') {
          return reply(200, {
            correct: true,
            correctOptionIds: ['q1-a'],
            explanation: null,
          });
        }
        return reply(200, {});
      });
      mount();
      fireEvent.click(screen.getByTestId('hai-quiz-button'));
      await screen.findByText('Erste Frage?');
      fireEvent.click(screen.getByText('Erste Option'));
      fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
      await screen.findByText('Richtig!');
      fireEvent.click(screen.getByRole('button', { name: 'Nächste Frage' }));
      expect(
        await screen.findByText('Du hast alle Fragen dieser Auswahl durch.')
      ).toBeTruthy();
      expect(screen.getByText(/1 von 1 richtig\./)).toBeTruthy();
    });
  });
});

describe('HaiQuizMode: the start signal of the chat answer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the quiz card with the topic when the chat answers "Frag mich zu SQL ab"', async () => {
    authFetchMock.mockImplementation(async url => {
      const path = String(url);
      if (path === '/api/hai/chat') {
        return chatAnswer({ quizMode: { topic: 'SQL', enablerId: null } });
      }
      if (path === '/api/hai/quiz-mode/next') {
        return reply(200, questionBody('q1', 'Erste Frage?'));
      }
      return reply(200, {});
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Frag mich zu SQL ab');
    });
    expect(await screen.findByText('Erste Frage?')).toBeTruthy();
    expect(calls('/api/hai/quiz-mode/next')).toEqual([
      { topic: 'SQL', exclude: [] },
    ]);
    expect(screen.getByText('Thema: SQL')).toBeTruthy();
    // the chat answer itself is a normal message
    expect(hai.messages.find(m => m.role === 'assistant')?.content).toBe(
      'Gern, ich frage dich ab.'
    );
  });

  it('opens it for the enabler the server named', async () => {
    authFetchMock.mockImplementation(async url => {
      const path = String(url);
      if (path === '/api/hai/chat') {
        return chatAnswer({ quizMode: { topic: null, enablerId: ENABLER } });
      }
      if (path === '/api/hai/quiz-mode/next') {
        return reply(200, questionBody('q1', 'Erste Frage?'));
      }
      return reply(200, {});
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Quiz mich zu diesem Enabler');
    });
    await screen.findByText('Erste Frage?');
    expect(calls('/api/hai/quiz-mode/next')).toEqual([
      { enablerId: ENABLER, exclude: [] },
    ]);
  });

  it('does nothing for an ordinary answer or a malformed signal', async () => {
    authFetchMock.mockImplementation(async url => {
      if (String(url) === '/api/hai/chat') {
        return chatAnswer({ quizMode: 'oops' });
      }
      return reply(200, {});
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein JOIN?');
    });
    await waitFor(() => expect(hai.messages.length).toBe(2));
    expect(screen.queryByTestId('hai-quiz-card')).toBeNull();
    expect(calls('/api/hai/quiz-mode/next')).toEqual([]);
  });
});

describe('HaiQuizMode without a provider', () => {
  it('is a no-op, so a component can use it anywhere', () => {
    let api: ReturnType<typeof useHaiQuizMode> | undefined;
    function Lone() {
      api = useHaiQuizMode();
      return null;
    }
    renderWithProviders(<Lone />);
    expect(api?.active).toBe(false);
    expect(() => {
      api?.start({ topic: 'x' });
      api?.answer(['a']);
      api?.next();
      api?.finish();
      api?.restart();
      api?.close();
    }).not.toThrow();
  });
});
