import { findSolutionKeys } from '../../helpers/solutionKeys';

describe('findSolutionKeys (the scanner itself)', () => {
  it('finds a solution key at any depth', () => {
    expect(
      findSolutionKeys({
        quiz: {
          questions: [
            { options: [{ id: 'o1', optionText: 'A', is_correct: true }] },
            { options: [{ id: 'o2', explanation: 'x' }] },
          ],
        },
      })
    ).toEqual([
      '$.quiz.questions[0].options[0].is_correct',
      '$.quiz.questions[1].options[0].explanation',
    ]);
  });

  it('knows the spellings of the keys', () => {
    for (const key of [
      'isCorrect',
      'is_correct',
      'correct',
      'correctOptionId',
      'correctAnswerText',
      'correct_answer',
      'explanation',
      'rationale',
      'hint_text',
      'hintText',
      'expectedAnswer',
      'solutionText',
      'solutions',
    ]) {
      expect(findSolutionKeys({ [key]: 1 })).toEqual([`$.${key}`]);
    }
  });

  it('leaves the keys of a question without a solution alone', () => {
    expect(
      findSolutionKeys({
        quiz: {
          id: 'q1',
          title: 'T',
          difficulty: 'LOW',
          questions: [
            {
              id: 'x',
              questionText: 'Q',
              questionType: 'MCQ',
              options: [{ id: 'o', optionText: 'A' }],
            },
          ],
        },
      })
    ).toEqual([]);
  });
});
