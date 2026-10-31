import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseArgs, sameQuiz } from '../../../scripts/import/fiae-quizzes.mjs';
import {
  norm,
  parseQuizLines,
  stemKey,
} from '../../../scripts/import/fiae-quiz-parse.mjs';

test('parses a block with the options in separate paragraphs and the reasons', () => {
  const r = parseQuizLines([
    'Dieses Dokument bezieht sich auf den Enabler FR-657',
    'Schwierigkeit: Leicht',
    'Frage [1] - [Schwierigkeit: Leicht] Thema: Scrum Welche drei Rollen definiert Scrum?',
    'A) Projektleiter, Team und Kunde',
    'B) Product Owner, Team und Scrum Master',
    'C) Manager, Programmierer und Tester',
    'D) Stakeholder, Product Owner und Teamleiter',
    'Richtige Antwort: B Erklärung:',
    'Warum B korrekt ist: Scrum kennt genau diese drei Rollen.',
    'Warum falsche Antworten inkorrekt sind: A, C und D gibt es nicht.',
  ]);
  assert.deepEqual(r.issues, []);
  assert.equal(r.questions.length, 1);
  const q = r.questions[0];
  assert.equal(q.text, 'Scrum Welche drei Rollen definiert Scrum?');
  assert.equal(q.options.length, 4);
  assert.deepEqual(
    q.options.map(o => o.correct),
    [false, true, false, false]
  );
  assert.equal(
    q.options[1].explanation,
    'Scrum kennt genau diese drei Rollen.'
  );
  assert.equal(q.options[0].explanation, null);
});

test('parses options written inline behind the question and lowercase letters', () => {
  const inline = parseQuizLines([
    'Frage [1] - [Schwierigkeit: Leicht] Thema: Organisation Was legt die Aufbauorganisation fest? A) Die Reihenfolge B) Die Hierarchie C) Das Recht D) Die IT',
    'Richtige Antwort: B Erklärung:',
  ]);
  assert.deepEqual(inline.issues, []);
  assert.equal(
    inline.questions[0].text,
    'Organisation Was legt die Aufbauorganisation fest?'
  );
  assert.equal(inline.questions[0].options[1].text, 'Die Hierarchie');
  assert.equal(inline.questions[0].options[1].correct, true);

  const lower = parseQuizLines([
    'Frage [5] - [Schwierigkeit: Mittel] Thema: Tests Was ist der Unterschied?',
    'a) Zeitlich [vgl: 4727].',
    'b) Der Code ist bekannt',
    'Richtige Antwort: b Erklärung:',
  ]);
  assert.deepEqual(lower.issues, []);
  assert.equal(lower.questions[0].options[0].text, 'Zeitlich.');
  assert.equal(lower.questions[0].options[1].correct, true);
});

test('the right option can be marked by a check mark instead of a line', () => {
  const r = parseQuizLines([
    'Frage: Was versteht man unter einem Verkäufermarkt?',
    'A) Nachfrage übersteigt Angebot ✅',
    'B) Angebot übersteigt Nachfrage',
    'Frage: Wofür steht HGB?',
    'A) Hauptgewerbebetrieb',
    'B) Handelsgesetzbuch ✅',
  ]);
  assert.deepEqual(r.issues, []);
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].options[0].correct, true);
  assert.equal(r.questions[0].options[0].text, 'Nachfrage übersteigt Angebot');
  assert.equal(r.questions[1].options[1].correct, true);
});

test('an unclear question is reported and not guessed', () => {
  const noAnswer = parseQuizLines(['Frage 1 - Text', 'A) x', 'B) y']);
  assert.deepEqual(
    noAnswer.issues.map(i => i.code),
    ['NO_ANSWER']
  );
  assert.equal(noAnswer.questions.length, 0);

  const mismatch = parseQuizLines([
    'Frage 1 - Text',
    'A) x ✅',
    'B) y',
    'Richtige Antwort: B',
  ]);
  assert.ok(mismatch.issues.some(i => i.code === 'ANSWER_MISMATCH'));

  const few = parseQuizLines(['Frage 1 - Text', 'A) x', 'Richtige Antwort: A']);
  assert.ok(few.issues.some(i => i.code === 'FEW_OPTIONS'));

  assert.deepEqual(
    parseQuizLines(['nur Text']).issues.map(i => i.code),
    ['NO_QUESTIONS']
  );
});

test('sameQuiz compares the questions and the right answers, not the order of the options', () => {
  const parsed = [
    {
      text: 'Scrum Welche drei Rollen definiert Scrum?',
      options: [
        { text: 'Team', correct: false },
        { text: 'Product Owner, Team und Scrum Master', correct: true },
      ],
    },
  ];
  const existing = [
    {
      key: stemKey('**Scrum**\n\nWelche drei Rollen definiert Scrum?'),
      right: [norm('Product Owner, Team und Scrum Master')],
    },
  ];
  assert.equal(sameQuiz(parsed, existing), true);
  assert.equal(sameQuiz(parsed, null), false);
  assert.equal(sameQuiz(parsed, [...existing, ...existing]), false);
  assert.equal(
    sameQuiz(parsed, [{ ...existing[0], right: [norm('Team')] }]),
    false
  );
});

test('the arguments allow only the Preview', () => {
  assert.deepEqual(parseArgs(['plan', 'src', '--target', 'preview']).errors, []);
  assert.ok(parseArgs(['plan', 'src', '--target', 'production']).errors.length);
  assert.ok(parseArgs(['plan', 'src']).errors.length);
  assert.ok(
    parseArgs(['plan', 'src', '--target', 'preview', '--apply']).errors.length
  );
  assert.deepEqual(
    parseArgs(['run', 'src', '--target', 'preview', '--components', '9,13'])
      .components,
    ['09', '13']
  );
});
