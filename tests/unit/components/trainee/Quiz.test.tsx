import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import Quiz, { type QuizView } from '@/components/learning/Quiz';
import { authFetch } from '@/lib/authFetch';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

// The global quiz of a trainee. The questions carry texts only. The answers go
// to the submission route in one call, and the result (score, right or wrong,
// the right answer, the reasoning) is shown from the answer of that route. The
// component holds no key: before the submission nothing tells which option is
// right.

const quiz: QuizView = {
  id: 'quiz-1',
  title: 'Globales Quiz',
  questions: [
    {
      id: 'q-1',
      questionText: 'Was ist ein Primärschlüssel?',
      questionType: 'MCQ',
      options: [
        { id: 'o-1a', optionText: 'Eindeutiger Bezeichner' },
        { id: 'o-1b', optionText: 'Ein Index über alles' },
      ],
    },
    {
      id: 'q-2',
      questionText: 'Wofür steht SQL?',
      questionType: 'TEXT',
      options: [],
    },
  ],
};

const REASON = 'Der Primärschlüssel identifiziert eine Zeile eindeutig.';

function reply(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as Response;
}

const failedResult = {
  submissionId: 's1',
  score: 50,
  locked: false,
  feedback: [
    {
      questionId: 'q-1',
      correct: false,
      correctOptionId: 'o-1a',
      explanation: REASON,
      selectedOptionId: 'o-1b',
      selectedText: null,
      correctAnswerText: null,
    },
    {
      questionId: 'q-2',
      correct: true,
      correctOptionId: null,
      explanation: null,
      selectedOptionId: null,
      selectedText: 'Structured Query Language',
      correctAnswerText: 'Structured Query Language',
    },
  ],
};

const perfectResult = {
  ...failedResult,
  score: 100,
  feedback: failedResult.feedback.map(f => ({
    ...f,
    correct: true,
    selectedOptionId: f.questionId === 'q-1' ? 'o-1a' : null,
  })),
};

function fetchMock() {
  return authFetch as jest.Mock;
}

/** Answer both questions and press the last button. */
async function sitTheQuiz(optionText = 'Ein Index über alles') {
  fireEvent.click(screen.getByLabelText(optionText));
  fireEvent.click(screen.getByRole('button', { name: 'Nächste Frage' }));
  fireEvent.change(screen.getByPlaceholderText('Deine Antwort'), {
    target: { value: 'Structured Query Language' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Abschließen' }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Quiz (global quiz of a trainee)', () => {
  it('shows the first question and its options, with no hint of the right one', () => {
    renderWithProviders(<Quiz quiz={quiz} />);
    expect(screen.getByText('Globales Quiz')).toBeInTheDocument();
    expect(
      screen.getByText('Was ist ein Primärschlüssel?')
    ).toBeInTheDocument();
    expect(screen.getByText('Eindeutiger Bezeichner')).toBeInTheDocument();
    expect(screen.getByText('Ein Index über alles')).toBeInTheDocument();
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
    expect(screen.queryByText('Richtige Antwort')).not.toBeInTheDocument();
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('does not go on before the question is answered', () => {
    renderWithProviders(<Quiz quiz={quiz} />);
    expect(
      screen.getByRole('button', { name: 'Nächste Frage' })
    ).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Eindeutiger Bezeichner'));
    expect(
      screen.getByRole('button', { name: 'Nächste Frage' })
    ).not.toBeDisabled();
  });

  it('sends every answer to the submission route in one call', async () => {
    fetchMock().mockResolvedValue(reply(failedResult));
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz();

    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/trainee/quizzes/quiz-1/submit');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      answers: [
        { questionId: 'q-1', selectedOptionId: 'o-1b' },
        { questionId: 'q-2', textAnswer: 'Structured Query Language' },
      ],
    });
  });

  it('shows score, right or wrong, the right answer and the reasoning from the answer of the route', async () => {
    fetchMock().mockResolvedValue(reply(failedResult));
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz();

    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1 von 2 Fragen richtig')).toBeInTheDocument();
    expect(screen.getAllByText('Falsch')).toHaveLength(1);
    expect(screen.getAllByText('Richtig')).toHaveLength(1);
    // the wrong question: own answer, the right option and the reasoning
    expect(screen.getByText(`Begründung: ${REASON}`)).toBeInTheDocument();
    const wrong = screen
      .getByText('Was ist ein Primärschlüssel?')
      .closest('[data-testid="quiz-result-item"]') as HTMLElement;
    expect(wrong).toHaveTextContent('Deine Antwort: Ein Index über alles');
    expect(wrong).toHaveTextContent('Richtige Antwort: Eindeutiger Bezeichner');
    expect(wrong).toHaveTextContent(`Begründung: ${REASON}`);
    // the text question: the answer as typed
    const text = screen
      .getByText('Wofür steht SQL?')
      .closest('[data-testid="quiz-result-item"]') as HTMLElement;
    expect(text).toHaveTextContent('Deine Antwort: Structured Query Language');
  });

  it('shows the perfect result when every answer is right', async () => {
    fetchMock().mockResolvedValue(reply(perfectResult));
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz('Eindeutiger Bezeichner');

    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByText('2 von 2 Fragen richtig')).toBeInTheDocument();
    expect(screen.queryByText('Falsch')).not.toBeInTheDocument();
    expect(screen.getByText('Perfekt!')).toBeInTheDocument();
  });

  it('takes the result of the route, not a score of its own', async () => {
    // The component has no key, whatever the trainee chose, the route decides
    fetchMock().mockResolvedValue(reply(perfectResult));
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz('Ein Index über alles');
    expect(await screen.findByText('100%')).toBeInTheDocument();
  });

  it('allows another attempt with all questions again, and counts it', async () => {
    fetchMock()
      .mockResolvedValueOnce(reply(failedResult))
      .mockResolvedValueOnce(reply(perfectResult));
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz();
    await screen.findByText('50%');

    fireEvent.click(
      screen.getByRole('button', { name: 'Noch einmal versuchen' })
    );
    // back at the first question, nothing chosen, the old reasoning is gone
    expect(
      screen.getByText('Was ist ein Primärschlüssel?')
    ).toBeInTheDocument();
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Nächste Frage' })
    ).toBeDisabled();
    expect(
      (screen.getByLabelText('Ein Index über alles') as HTMLInputElement)
        .checked
    ).toBe(false);

    await sitTheQuiz('Eindeutiger Bezeichner');
    await screen.findByText('100%');
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock().mock.calls[1][1].body).answers[0]).toEqual({
      questionId: 'q-1',
      selectedOptionId: 'o-1a',
    });
    // two attempts are shown
    expect(screen.getByText('Versuche')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('offers no new attempt for a locked answer', async () => {
    fetchMock().mockResolvedValue(reply({ ...failedResult, locked: true }));
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz();
    await screen.findByText('50%');
    expect(
      screen.queryByRole('button', { name: 'Noch einmal versuchen' })
    ).not.toBeInTheDocument();
  });

  it('shows an error and keeps the answers when the submission fails', async () => {
    fetchMock()
      .mockResolvedValueOnce(reply({ error: 'x' }, 500))
      .mockResolvedValueOnce(reply(failedResult));
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz();

    expect(
      await screen.findByText(
        'Die Abgabe ist fehlgeschlagen. Bitte versuche es erneut.'
      )
    ).toBeInTheDocument();
    // still on the last question, the typed answer is still there
    expect(screen.getByPlaceholderText('Deine Antwort')).toHaveValue(
      'Structured Query Language'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abschließen' }));
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('shows an error when the call itself fails', async () => {
    fetchMock().mockRejectedValue(new Error('offline'));
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz();
    expect(
      await screen.findByText(
        'Die Abgabe ist fehlgeschlagen. Bitte versuche es erneut.'
      )
    ).toBeInTheDocument();
  });

  it('submits once, the button is locked while the call runs', async () => {
    let resolve!: (r: Response) => void;
    fetchMock().mockReturnValue(
      new Promise<Response>(r => {
        resolve = r;
      })
    );
    renderWithProviders(<Quiz quiz={quiz} />);
    await sitTheQuiz();
    const button = await screen.findByRole('button', {
      name: 'Wird abgegeben...',
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    resolve(reply(failedResult));
    await screen.findByText('50%');
  });

  it('can go back to a question and change the answer', async () => {
    fetchMock().mockResolvedValue(reply(failedResult));
    renderWithProviders(<Quiz quiz={quiz} />);
    fireEvent.click(screen.getByLabelText('Ein Index über alles'));
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Frage' }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Vorherige Frage' })[0]
    );
    fireEvent.click(screen.getByLabelText('Eindeutiger Bezeichner'));
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Frage' }));
    fireEvent.change(screen.getByPlaceholderText('Deine Antwort'), {
      target: { value: 'SQL' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Abschließen' }));
    await waitFor(() => expect(fetchMock()).toHaveBeenCalled());
    expect(JSON.parse(fetchMock().mock.calls[0][1].body).answers[0]).toEqual({
      questionId: 'q-1',
      selectedOptionId: 'o-1a',
    });
  });

  it('shows a note and no button for a quiz without questions', () => {
    renderWithProviders(<Quiz quiz={{ ...quiz, questions: [] }} />);
    expect(
      screen.getByText('Dieses Quiz enthält noch keine Fragen.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Abschließen' })
    ).not.toBeInTheDocument();
  });

  it('treats a question without options as a text question', () => {
    renderWithProviders(
      <Quiz
        quiz={{
          id: 'quiz-2',
          title: 'T',
          questions: [{ id: 'q', questionText: 'Frei?', options: [] }],
        }}
      />
    );
    expect(screen.getByPlaceholderText('Deine Antwort')).toBeInTheDocument();
  });
});
