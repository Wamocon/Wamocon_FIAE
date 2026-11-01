import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  keyOf,
  parseArgs,
  planQuiz,
  sameQuestion,
} from '../../../scripts/import/fiae-global-quizzes.mjs';
import { parseGlobalQuiz } from '../../../scripts/import/fiae-global-quiz-parse.mjs';

const p = (text, bold = '') => ({ text, bold });

test('reads a numbered title, the question, the options and the bold right answer', () => {
  const r = parseGlobalQuiz([
    p('1. Software-Entwicklungszyklus (Phasen)'),
    p('Welche Phase umfasst die Entwicklung eines Modells?'),
    p('A) Analyse'),
    p('B) Entwurf (Design)', 'B) Entwurf (Design)'),
    p('C) Planung'),
    p('2. Projektmanagement: Kritischer Weg'),
    p('Was kennzeichnet den Kritischen Weg?'),
    p('A) Freier Puffer'),
    p('B) Gesamtpuffer ist Null', 'B) Gesamtpuffer ist Null'),
  ]);
  assert.deepEqual(r.issues, []);
  assert.equal(r.questions.length, 2);
  assert.equal(
    r.questions[0].text,
    'Welche Phase umfasst die Entwicklung eines Modells?'
  );
  assert.deepEqual(
    r.questions[0].options.map(o => o.correct),
    [false, true, false]
  );
});

test('reads a source marker, the right answer line and the reason', () => {
  const r = parseGlobalQuiz([
    p('[Quelle: Enabler FR-1] - Frage 1 (Schwierigkeit: Level 1 - Wissen)'),
    p('Welcher Begriff beschreibt die Echtheit von Daten?'),
    p('A) Integrität'),
    p('B) Authentizität'),
    p('Lösung: B'),
    p('Erklärung: Authentizität bedeutet echt.'),
    p('Weitere Zeile der Erklärung.'),
  ]);
  assert.deepEqual(r.issues, []);
  assert.equal(r.questions[0].options[1].correct, true);
  assert.equal(
    r.questions[0].options[1].explanation,
    'Authentizität bedeutet echt. Weitere Zeile der Erklärung.'
  );
  assert.equal(r.questions[0].options[0].explanation, null);
});

test('reads options on one line, a check mark and the topic line of the corrected layout', () => {
  const inline = parseGlobalQuiz([
    p('[Quelle: FR-2] - Frage 1 (Schwierigkeit: Level 1) Was ist ein SAN?'),
    p('A) Ein Dateiserver B) Ein Speichernetz C) Ein Switch'),
    p('Lösung: B'),
  ]);
  assert.deepEqual(inline.issues, []);
  assert.equal(inline.questions[0].text, 'Was ist ein SAN?');
  assert.equal(inline.questions[0].options[1].text, 'Ein Speichernetz');

  const check = parseGlobalQuiz([
    p('[Question 1]'),
    p('[CORRECTED QUESTION] (Topic: Cloud)'),
    p('Welches Modell liefert Software?'),
    p('A) IaaS'),
    p('B) SaaS ✅'),
  ]);
  assert.deepEqual(check.issues, []);
  assert.equal(check.questions[0].text, 'Welches Modell liefert Software?');
  assert.equal(check.questions[0].options[1].text, 'SaaS');
  assert.equal(check.questions[0].options[1].correct, true);
});

test('a letter with a bracket inside the question is not an option', () => {
  const r = parseGlobalQuiz([
    p('[Quelle: FR-3] - Frage 1'),
    p(
      'Sie ergänzen Tablets (Produktgruppe A) und Smartphones. Was ändert sich?'
    ),
    p('A) Die Tiefe'),
    p('B) Die Breite', 'B) Die Breite'),
  ]);
  assert.deepEqual(r.issues, []);
  assert.equal(
    r.questions[0].text,
    'Sie ergänzen Tablets (Produktgruppe A) und Smartphones. Was ändert sich?'
  );
});

test('a numbered question of a long line is kept as the question text', () => {
  const r = parseGlobalQuiz([
    p('Erste Frage?'),
    p('A) Eins', 'A) Eins'),
    p('B) Zwei'),
    p(
      '13. Distributionspolitik Die Distributionspolitik wird in zwei Hauptbestandteile unterteilt. Welcher Teil sorgt für den physischen Transport der Waren zum Kunden?'
    ),
    p('A) Akquisitorische Distribution'),
    p('B) Physische Distribution', 'B) Physische Distribution'),
  ]);
  assert.equal(r.questions.length, 2);
  assert.match(
    r.questions[1].text,
    /^Distributionspolitik Die Distributionspolitik/
  );
});

test('reports what is not clear and leaves a withdrawn question out', () => {
  const r = parseGlobalQuiz([
    p('[Question 1]'),
    p('Frage ohne markierte Antwort?'),
    p('A) Ja'),
    p('B) Nein'),
    p('[Question 2]'),
    p('Frage mit zwei Antworten?'),
    p('A) Ja', 'A) Ja'),
    p('B) Nein'),
    p('C) Vielleicht', 'C) Vielleicht'),
    p('[Question 3]'),
    p('Frage mit zwei Angaben?'),
    p('A) Ja'),
    p('B) Nein'),
    p('Lösung: A'),
    p('[Question 4]'),
    p('Frage mit kaputter Zeile?'),
    p('A) Ja'),
    p('B) Nein', 'B) Nein'),
    p('seC) Vielleicht'),
    p('[Question 5]'),
    p('Note: This topic is not in the files. I will replace it.'),
    p('A).'),
  ]);
  assert.deepEqual(
    r.issues.map(i => `${i.question}:${i.code}`),
    ['1:NO_ANSWER', '2:SEVERAL_ANSWERS', '4:BROKEN_OPTION']
  );
  assert.equal(r.questions.length, 1);
  assert.equal(r.questions[0].text, 'Frage mit zwei Angaben?');
});

test('a bold option and a right answer line that disagree are reported', () => {
  const r = parseGlobalQuiz([
    p('[Question 1]'),
    p('Welche Antwort?'),
    p('A) Ja', 'A) Ja'),
    p('B) Nein'),
    p('Lösung: B'),
  ]);
  assert.equal(r.questions.length, 0);
  assert.equal(r.issues[0].code, 'ANSWER_CONFLICT');
});

test('questions are compared by their first 60 letters and digits', () => {
  assert.equal(
    keyOf('Thema X\n\nWas ist  ein SAN?'),
    keyOf('Was ist ein SAN?')
  );
});

const q = (text, right, wrong = ['x', 'y']) => ({
  text,
  options: [
    { text: right, correct: true },
    ...wrong.map(w => ({ text: w, correct: false })),
  ],
});

test('planQuiz: same questions mean nothing to do', () => {
  const file = [q('Frage eins?', 'a'), q('Frage zwei?', 'b')];
  const existing = file.map((f, i) => ({ id: `q${i}`, ...f }));
  assert.equal(planQuiz(file, [], existing).status, 'same');
  assert.equal(sameQuestion(file[0], existing[0]), true);
});

test('planQuiz: a whole file that differs replaces the quiz', () => {
  const file = [q('Frage eins?', 'a'), q('Neue Frage?', 'c')];
  const existing = [
    { id: 'q0', ...q('Frage eins?', 'a') },
    { id: 'q1', ...q('Alte Frage?', 'z') },
  ];
  const r = planQuiz(file, [], existing);
  assert.equal(r.status, 'replace');
  assert.equal(r.added, 1);
  assert.equal(r.missing, 1);
});

test('planQuiz: a file with unreadable questions only changes and adds, nothing is removed', () => {
  const file = [q('Frage eins?', 'b'), q('Neue Frage?', 'c')];
  const existing = [
    { id: 'q0', ...q('Frage eins?', 'a', ['b', 'y']) },
    { id: 'q1', ...q('Nicht lesbar?', 'z') },
  ];
  const r = planQuiz(file, [{ code: 'NO_ANSWER' }], existing);
  assert.equal(r.status, 'patch');
  assert.deepEqual(
    r.changed.map(c => c.id),
    ['q0']
  );
  assert.equal(r.added.length, 1);
  assert.equal(r.missing, 1);
});

test('planQuiz: unreadable questions and nothing else different is the same quiz', () => {
  const file = [q('Frage eins?', 'a')];
  const existing = [
    { id: 'q0', ...q('Frage eins?', 'a') },
    { id: 'q1', ...q('Nicht lesbar?', 'z') },
  ];
  assert.equal(
    planQuiz(file, [{ code: 'NO_ANSWER' }], existing).status,
    'same'
  );
});

test('arguments: the target must be the preview and --apply does not belong to plan', () => {
  assert.deepEqual(
    parseArgs(['plan', 'Ordner', '--target', 'preview']).errors,
    []
  );
  assert.ok(parseArgs(['plan', 'Ordner']).errors.length);
  assert.ok(
    parseArgs(['plan', 'Ordner', '--target', 'preview', '--apply']).errors
      .length
  );
  assert.ok(
    parseArgs(['run', 'Ordner', '--target', 'production']).errors.length
  );
  assert.deepEqual(
    parseArgs(['run', 'Ordner', '--target', 'preview', '--files', '3,07'])
      .files,
    ['03', '07']
  );
});
