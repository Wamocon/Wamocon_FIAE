/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  CORRECT_MARKER,
  WRONG_MARKER,
  buildQuizTexts,
  type QuizQuestionInput,
} from '@/lib/hai/quizIndexText';
import { chunkDocument } from '@/lib/hai/chunker';

// The writers split a quiz into questions (visible to trainees) and answers
// (trainer only) BEFORE they chunk by size, so no chunk of the questions can
// hold the tail of an answer without a marker.

const LONG = 'Das ist eine ausführliche Begründung zur Antwort. '.repeat(40);

function quiz(count: number): QuizQuestionInput[] {
  return Array.from({ length: count }, (_, i) => ({
    orderIndex: i + 1,
    text: `Wie funktioniert Thema ${i + 1}?`,
    type: i % 2 === 0 ? 'MCQ' : 'TEXT',
    expectedAnswer: i % 2 === 0 ? null : `LÖSUNG-${i + 1} ${LONG}`,
    options:
      i % 2 === 0
        ? [
            {
              text: `Option richtig ${i + 1}`,
              isCorrect: true,
              explanation: `ERKLÄRUNG-RICHTIG-${i + 1} ${LONG}`,
            },
            {
              text: `Option falsch ${i + 1}`,
              isCorrect: false,
              explanation: `ERKLÄRUNG-FALSCH-${i + 1} ${LONG}`,
            },
          ]
        : [],
  }));
}

const ANSWER_MARKERS = [
  CORRECT_MARKER,
  WRONG_MARKER,
  'Erklärung:',
  'Erwartete Antwort:',
  'ERKLÄRUNG-',
  'LÖSUNG-',
];

function chunksOf(text: string) {
  return chunkDocument(text, 'Quiz', {
    maxChunkSize: 500,
    overlap: 50,
    preserveParagraphs: true,
    preserveSentences: true,
  }).map(chunk => chunk.content);
}

describe('buildQuizTexts', () => {
  it('puts no answer content into the questions text', () => {
    const { questions } = buildQuizTexts('Quiz: Test', quiz(6));
    for (const marker of ANSWER_MARKERS) {
      expect(questions).not.toContain(marker);
    }
    expect(questions).toContain('Wie funktioniert Thema 1?');
    // the trainee sees the option texts, not which one is right
    expect(questions).toContain('Option richtig 1');
    expect(questions).toContain('Option falsch 1');
  });

  it('puts every answer, explanation and expected answer into the answers text', () => {
    const { answers } = buildQuizTexts('Quiz: Test', quiz(4));
    expect(answers).toContain(`${CORRECT_MARKER} Option richtig 1`);
    expect(answers).toContain(`${WRONG_MARKER} Option falsch 1`);
    expect(answers).toContain('ERKLÄRUNG-RICHTIG-1');
    expect(answers).toContain('Erwartete Antwort: LÖSUNG-2');
    expect(answers).toContain('(Antworten)');
  });

  it('never leaves answer content in a chunk of the questions, however it is split by size', () => {
    const { questions, answers } = buildQuizTexts('Quiz: Test', quiz(12));
    const questionChunks = chunksOf(questions);
    const answerChunks = chunksOf(answers!);
    // the answers are long enough to need continuation chunks without a marker
    expect(answerChunks.length).toBeGreaterThan(5);
    expect(
      answerChunks.some(chunk => !ANSWER_MARKERS.some(m => chunk.includes(m)))
    ).toBe(true);
    for (const chunk of questionChunks) {
      for (const marker of ANSWER_MARKERS) {
        expect(chunk).not.toContain(marker);
      }
    }
    // everything that is an answer is in the answers part
    const allAnswers = answerChunks.join('\n');
    expect(allAnswers).toContain('ERKLÄRUNG-FALSCH-11');
  });

  it('has no answers part for a quiz without answer content', () => {
    const texts = buildQuizTexts('Quiz: Leer', [
      {
        orderIndex: 1,
        text: 'Frage ohne Antwort',
        type: 'TEXT',
        expectedAnswer: null,
        options: [],
      },
    ]);
    expect(texts.answers).toBeNull();
    expect(texts.questions).toContain('Frage ohne Antwort');
  });

  it('ignores options without a text', () => {
    const texts = buildQuizTexts('Quiz: X', [
      {
        orderIndex: 1,
        text: 'F',
        type: 'MCQ',
        expectedAnswer: null,
        options: [{ text: null, isCorrect: null, explanation: null }],
      },
    ]);
    expect(texts.answers).toBeNull();
    expect(texts.questions).not.toContain('- ');
  });

  it('writes a question without a number or type without gaps', () => {
    const { questions } = buildQuizTexts('Quiz: X', [
      {
        orderIndex: null,
        text: 'Ohne Nummer',
        type: null,
        expectedAnswer: 'x',
        options: [],
      },
    ]);
    expect(questions).toContain('Frage : Ohne Nummer');
  });
});
