import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import {
  HaiQuizCard,
  optionIndexForKey,
  type HaiQuizCardProps,
} from '@/components/hai/HaiQuizCard';
import {
  initialQuizState,
  type QuizSessionState,
} from '@/lib/hai/quizMode/session';
import type { QuizQuestionPublic } from '@/lib/hai/quizMode/logic';

// The quiz card of the HAI chat: one question at a time, options as buttons,
// keyboard (number or letter selects, Enter checks), feedback with the right
// solution and the explanation only AFTER the attempt, a summary at the end.
// Texts come from the German locale file, so the assertions read German.

const question = (
  over: Partial<QuizQuestionPublic> = {}
): QuizQuestionPublic => ({
  id: 'q1',
  text: 'Was ist ein Primärschlüssel?',
  multiple: false,
  options: [
    { id: 'o1', text: 'Ein eindeutiger Bezeichner' },
    { id: 'o2', text: 'Ein Index' },
    { id: 'o3', text: 'Ein Fremdschlüssel' },
  ],
  enablerId: 'e1',
  enablerTitle: 'SQL Grundlagen',
  courseTitle: 'Datenbanken',
  enablerHref: '/trainee/enablers/e1',
  ...over,
});

const state = (over: Partial<QuizSessionState> = {}): QuizSessionState => ({
  ...initialQuizState(),
  phase: 'question',
  question: question(),
  asked: ['q1'],
  total: 4,
  remaining: 4,
  ...over,
});

function setup(
  over: Partial<QuizSessionState> = {},
  handlers: Partial<HaiQuizCardProps> = {}
) {
  const props = {
    onAnswer: jest.fn(),
    onNext: jest.fn(),
    onFinish: jest.fn(),
    onRestart: jest.fn(),
    onClose: jest.fn(),
    onMixed: jest.fn(),
    ...handlers,
  };
  const view = renderWithProviders(
    <HaiQuizCard state={state(over)} {...props} />
  );
  return { ...view, props };
}

const optionButtons = () =>
  screen
    .getAllByRole('button')
    .filter(b => b.getAttribute('data-option-id') !== null);

describe('optionIndexForKey', () => {
  it.each([
    ['1', 3, 0],
    ['3', 3, 2],
    ['a', 3, 0],
    ['C', 3, 2],
    ['4', 3, -1],
    ['d', 3, -1],
    ['Enter', 3, -1],
    ['ab', 3, -1],
    ['0', 3, -1],
  ])('maps %s of %i options to %i', (key, count, index) => {
    expect(optionIndexForKey(key, count)).toBe(index);
  });
});

describe('HaiQuizCard: the question', () => {
  it('shows the text, the progress, the practice note and the options as buttons', () => {
    setup();
    expect(
      screen.getByRole('heading', { name: /Primärschlüssel/ })
    ).toBeTruthy();
    expect(screen.getByText('Frage 1 von 4')).toBeTruthy();
    expect(screen.getByText(/Übung ohne Wertung/)).toBeTruthy();
    expect(
      screen.getByText(
        'Gemischt aus den Enablern, die für dich freigeschaltet sind'
      )
    ).toBeTruthy();
    expect(optionButtons()).toHaveLength(3);
    expect(optionButtons().map(b => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
    ]);
  });

  it('gives the group a name and the options their shortcuts for assistive technology', () => {
    setup();
    const group = screen.getByRole('group', { name: /Primärschlüssel/ });
    expect(group.getAttribute('aria-describedby')).toBeTruthy();
    const first = optionButtons()[0];
    expect(first.getAttribute('aria-keyshortcuts')).toBe('1 A');
    expect(within(group).getAllByRole('button')).toHaveLength(3);
  });

  it('names the enabler or the topic as the scope', () => {
    setup({ scope: { enablerId: 'e1', topic: null } });
    expect(screen.getByText('Enabler: SQL Grundlagen')).toBeTruthy();
  });

  it('names the topic as the scope', () => {
    setup({ scope: { enablerId: null, topic: 'SQL' } });
    expect(screen.getByText('Thema: SQL')).toBeTruthy();
  });

  it('shows no solution and no explanation before the attempt', () => {
    setup();
    expect(screen.queryByText(/Richtige Antwort/)).toBeNull();
    expect(screen.queryByText('Erklärung')).toBeNull();
    expect(screen.queryByText('Richtig!')).toBeNull();
  });

  it('selects an option on click, only one for a choice question', () => {
    setup();
    fireEvent.click(optionButtons()[0]);
    fireEvent.click(optionButtons()[2]);
    expect(optionButtons().map(b => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
    ]);
  });

  it('keeps the check button off until an option is selected, then sends the attempt', () => {
    const { props } = setup();
    const check = screen.getByRole('button', { name: 'Antwort prüfen' });
    expect((check as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(optionButtons()[1]);
    expect((check as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(check);
    expect(props.onAnswer).toHaveBeenCalledWith(['o2']);
  });

  it('selects several options for a multiple question and says so', () => {
    const { props } = setup({
      question: question({ multiple: true }),
    });
    expect(screen.getByText(/Mehrere Antworten sind richtig/)).toBeTruthy();
    fireEvent.click(optionButtons()[0]);
    fireEvent.click(optionButtons()[2]);
    fireEvent.click(optionButtons()[0]);
    fireEvent.click(optionButtons()[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
    expect(props.onAnswer).toHaveBeenCalledWith(['o3', 'o2']);
  });

  it('puts the focus on the card so the keys work at once', () => {
    const { container } = setup();
    const card = container.querySelector('[tabindex="-1"]');
    expect(document.activeElement).toBe(card);
  });

  it('ends the quiz and closes it with their own buttons', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Quiz beenden' }));
    expect(props.onFinish).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole('button', { name: 'Quiz-Modus schließen' })
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a failed check as an alert and keeps the question', () => {
    setup({ errorKey: 'network' });
    expect(screen.getByRole('alert').textContent).toMatch(/Keine Verbindung/);
    expect(optionButtons()).toHaveLength(3);
  });
});

describe('HaiQuizCard: the keyboard', () => {
  const card = (container: HTMLElement) =>
    container.querySelector('[tabindex="-1"]') as HTMLElement;

  it('selects with a number or a letter', () => {
    const { container } = setup();
    fireEvent.keyDown(card(container), { key: '2' });
    expect(optionButtons()[1].getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(card(container), { key: 'c' });
    expect(optionButtons()[1].getAttribute('aria-pressed')).toBe('false');
    expect(optionButtons()[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores a key that matches no option and key combinations', () => {
    const { container } = setup();
    fireEvent.keyDown(card(container), { key: '9' });
    fireEvent.keyDown(card(container), { key: 'd' });
    fireEvent.keyDown(card(container), { key: 'a', ctrlKey: true });
    expect(
      optionButtons().every(b => b.getAttribute('aria-pressed') === 'false')
    ).toBe(true);
  });

  it('checks with Enter once something is selected, and not before', () => {
    const { container, props } = setup();
    fireEvent.keyDown(card(container), { key: 'Enter' });
    expect(props.onAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(card(container), { key: 'b' });
    fireEvent.keyDown(card(container), { key: 'Enter' });
    expect(props.onAnswer).toHaveBeenCalledWith(['o2']);
  });

  it('checks with Enter on a focused option, taking it if nothing is chosen', () => {
    const { props } = setup();
    fireEvent.keyDown(optionButtons()[2], { key: 'Enter' });
    expect(props.onAnswer).toHaveBeenCalledWith(['o3']);
  });

  it('does nothing while the answer is being checked', () => {
    const { container, props } = setup({ phase: 'checking' });
    fireEvent.keyDown(card(container), { key: 'a' });
    fireEvent.keyDown(card(container), { key: 'Enter' });
    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(optionButtons().every(b => (b as HTMLButtonElement).disabled)).toBe(
      true
    );
  });
});

describe('HaiQuizCard: the feedback', () => {
  const feedbackState = (
    correct: boolean,
    over: Partial<QuizSessionState> = {}
  ) =>
    state({
      phase: 'feedback',
      feedback: {
        correct,
        selectedOptionIds: correct ? ['o1'] : ['o2'],
        correctOptionIds: ['o1'],
        explanation: 'Er identifiziert eine Zeile eindeutig.',
      },
      ...over,
    });

  it('shows right with the explanation, and moves the focus to "Nächste Frage"', () => {
    const { props } = setup(feedbackState(true));
    expect(screen.getByText('Richtig!')).toBeTruthy();
    expect(
      screen.getByText('Er identifiziert eine Zeile eindeutig.')
    ).toBeTruthy();
    const next = screen.getByRole('button', { name: 'Nächste Frage' });
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('shows wrong, marks your answer and the right one, in words as well as colour', () => {
    setup(feedbackState(false));
    expect(screen.getByRole('status').textContent).toMatch(/Leider falsch/);
    const [right, wrong] = optionButtons();
    expect(right.textContent).toMatch(/Richtige Antwort/);
    expect(wrong.textContent).toMatch(/Deine Antwort/);
    expect(wrong.textContent).not.toMatch(/Richtige Antwort/);
    expect(optionButtons().every(b => (b as HTMLButtonElement).disabled)).toBe(
      true
    );
  });

  it('shows no explanation box when the author wrote none', () => {
    setup(
      feedbackState(true, {
        feedback: {
          correct: true,
          selectedOptionIds: ['o1'],
          correctOptionIds: ['o1'],
          explanation: null,
        },
      })
    );
    expect(screen.queryByText('Erklärung')).toBeNull();
  });

  it('goes on with Enter on the card and ends with the second button', () => {
    const { container, props } = setup(feedbackState(false));
    fireEvent.keyDown(container.querySelector('[tabindex="-1"]')!, {
      key: 'Enter',
    });
    expect(props.onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Quiz beenden' }));
    expect(props.onFinish).toHaveBeenCalledTimes(1);
  });
});

describe('HaiQuizCard: the summary', () => {
  const attempt = (
    id: string,
    enablerId: string,
    title: string,
    correct: boolean,
    href: string | null
  ) => ({
    questionId: id,
    enablerId,
    enablerTitle: title,
    enablerHref: href,
    correct,
  });

  it('shows x of y right and the enablers to repeat with a link', () => {
    const { props } = setup({
      phase: 'summary',
      question: null,
      attempts: [
        attempt('a', 'e1', 'SQL Grundlagen', false, '/trainee/enablers/e1'),
        attempt('b', 'e1', 'SQL Grundlagen', false, '/trainee/enablers/e1'),
        attempt('c', 'e2', 'Netzwerke', true, '/trainee/enablers/e2'),
      ],
    });
    expect(screen.getByText('1 von 3 richtig.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'SQL Grundlagen' });
    expect(link.getAttribute('href')).toBe('/trainee/enablers/e1');
    expect(screen.getByText('(2 falsch)')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Netzwerke' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Noch eine Runde' }));
    expect(props.onRestart).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent).toBe('Zusammenfassung');
  });

  it('praises a clean round and lists nothing to repeat', () => {
    setup({
      phase: 'summary',
      question: null,
      attempts: [attempt('a', 'e1', 'SQL', true, null)],
    });
    expect(screen.getByText(/1 von 1 richtig\./)).toBeTruthy();
    expect(screen.getByText(/Alles richtig/)).toBeTruthy();
    expect(screen.queryByText('Zum Wiederholen')).toBeNull();
  });

  it('shows a topic without a link as plain text (a trainer has no page of the enabler)', () => {
    setup({
      phase: 'summary',
      question: null,
      attempts: [attempt('a', 'e1', 'SQL Grundlagen', false, null)],
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('SQL Grundlagen')).toBeTruthy();
  });

  it('says so when everything of the selection is through, and when nothing was answered', () => {
    setup({
      phase: 'summary',
      question: null,
      reason: 'exhausted',
      attempts: [attempt('a', 'e1', 'SQL', true, null)],
    });
    expect(
      screen.getByText('Du hast alle Fragen dieser Auswahl durch.')
    ).toBeTruthy();
  });

  it('handles a session without an answer', () => {
    setup({ phase: 'summary', question: null, attempts: [] });
    expect(screen.getByText('Du hast keine Frage beantwortet.')).toBeTruthy();
  });
});

describe('HaiQuizCard: loading, empty and error', () => {
  it('shows the loading state as a status', () => {
    setup({ phase: 'loading', question: null });
    expect(screen.getByRole('status').textContent).toMatch(/nächste Frage/);
  });

  it('explains an empty result and offers the mixed quiz after a topic without a match', () => {
    const { props } = setup({
      phase: 'empty',
      question: null,
      reason: 'no_topic_match',
    });
    expect(screen.getByRole('status').textContent).toMatch(/keine Quizfragen/);
    fireEvent.click(screen.getByRole('button', { name: 'Gemischt abfragen' }));
    expect(props.onMixed).toHaveBeenCalledTimes(1);
  });

  it('offers no mixed quiz when there is no content at all', () => {
    setup({ phase: 'empty', question: null, reason: 'no_content' });
    expect(
      screen.queryByRole('button', { name: 'Gemischt abfragen' })
    ).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/freigeschaltet/);
  });

  it.each([
    ['locked', /noch gesperrt/],
    ['rateLimited', /zu schnell/],
    ['generic', /nicht geklappt/],
  ])('shows the error %s as an alert with a retry', (errorKey, text) => {
    const { props } = setup({ phase: 'error', question: null, errorKey });
    expect(screen.getByRole('alert').textContent).toMatch(text);
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });
});

describe('HaiQuizCard: reading aloud', () => {
  const original = (window as any).speechSynthesis;
  const originalUtterance = (window as any).SpeechSynthesisUtterance;

  afterEach(() => {
    (window as any).speechSynthesis = original;
    (window as any).SpeechSynthesisUtterance = originalUtterance;
  });

  it('offers no reading button where the browser has no speech output', () => {
    delete (window as any).speechSynthesis;
    setup();
    expect(screen.queryByRole('button', { name: 'Frage vorlesen' })).toBeNull();
  });

  it('reads the question with its letters and no solution, and stops on demand', () => {
    const spoken: string[] = [];
    const synth = {
      speak: jest.fn((u: any) => spoken.push(u.text)),
      cancel: jest.fn(),
    };
    (window as any).speechSynthesis = synth;
    (window as any).SpeechSynthesisUtterance = function (
      this: any,
      text: string
    ) {
      this.text = text;
    };
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Frage vorlesen' }));
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toContain('Was ist ein Primärschlüssel?');
    expect(spoken[0]).toContain('A: Ein eindeutiger Bezeichner');
    expect(spoken[0]).not.toMatch(/Lösung|richtig ist/);
    const stop = screen.getByRole('button', { name: 'Vorlesen beenden' });
    expect(stop.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      fireEvent.click(stop);
    });
    expect(synth.cancel).toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', { name: 'Frage vorlesen' })
        .getAttribute('aria-pressed')
    ).toBe('false');
  });
});
