import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { listComponentFolders } from '../../../scripts/import/fiae-component-folder.mjs';
import { FINAL_LISTING } from './fiae-listing.mjs';
import {
  LEFT_OUT,
  QUIZ_OF_FILE,
  keyOf,
  parseArgs,
  planQuiz,
  sameQuestion,
  sourceFolder,
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
    ['3', '07']
  );
});

test('--files keeps the tokens as typed (plain numbers resolve per scheme) and refuses an unknown value', () => {
  assert.deepEqual(
    parseArgs(['run', 'Ordner', '--target', 'preview', '--files', '2.1,2.2,9.2,7']).files,
    ['2.1', '2.2', '9.2', '7']
  );
  const bad = parseArgs(['run', 'Ordner', '--target', 'preview', '--files', '2.3']);
  assert.ok(bad.errors.some(e => /--files/.test(e) && /2\.3/.test(e)));
});

test('the tables work with the folder number: every key is a component, the left-out files are not in the quiz table', () => {
  const keys = [...Object.keys(QUIZ_OF_FILE), ...Object.keys(LEFT_OUT)].map(k => k.padStart(2, '0'));
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.ok(Number(key) >= 1 && Number(key) <= 26, key);
});

test('the Global_Quiz.docx is found by the old and the new folder name, a Vertiefung by 2.2_ as by 13_', () => {
  const rootOld = mkdtempSync(path.join(tmpdir(), 'fiae-gq-'));
  const rootNew = mkdtempSync(path.join(tmpdir(), 'fiae-gq-'));
  try {
    for (const [root, names] of [
      [rootOld, ['01_Planen', '02_Informieren', '09_Programmieren', '20_Programmieren (Vertiefung)']],
      [rootNew, ['01_Planen', '02.1_Informieren', '09.1_Programmieren', '09.2_Programmieren (Vertiefung)']],
    ])
      for (const n of names) mkdirSync(path.join(root, n));
    const rel = (root, nr) => {
      const { folders, problems } = listComponentFolders(root);
      assert.deepEqual(problems, []);
      const file = sourceFolder(folders, root, nr);
      return file && path.relative(root, file).split(path.sep);
    };
    assert.deepEqual(rel(rootOld, '02')?.slice(1), ['Global_Quiz', 'Global_Quiz.docx']);
    assert.deepEqual(rel(rootNew, '02')?.slice(1), ['Global_Quiz', 'Global_Quiz.docx']);
    assert.match(rel(rootOld, '20')[0], /^20_/);
    assert.match(rel(rootNew, '20')[0], /^09\.2_/);
    assert.equal(rel(rootNew, '13'), null);
  } finally {
    rmSync(rootOld, { recursive: true, force: true });
    rmSync(rootNew, { recursive: true, force: true });
  }
});

test('the final listing: the Global_Quiz.docx of the order index is found by the final folder name (19 is 13_, 13 is 02.2_)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-gq-'));
  try {
    for (const n of FINAL_LISTING) mkdirSync(path.join(root, n));
    const { folders, problems, scheme } = listComponentFolders(root);
    assert.deepEqual(problems, []);
    assert.equal(scheme, 'new');
    const dirOf = key => {
      const file = sourceFolder(folders, root, key);
      return file && path.relative(root, file).split(path.sep)[0];
    };
    assert.match(dirOf('19'), /^13_Inbetriebnehmen/);
    assert.match(dirOf('13'), /^02\.2_/);
    assert.match(dirOf('20'), /^09\.2_/);
    assert.match(dirOf('26'), /^17_Umweltschutz/);
    // every key of the tables (the order index) has a folder in the final listing
    for (const key of [...Object.keys(QUIZ_OF_FILE), ...Object.keys(LEFT_OUT)])
      assert.ok(dirOf(key.padStart(2, '0')), key);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
