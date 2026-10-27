/**
 * @jest-environment node
 */
// What the code of the JSON and Excel kinds of the content upload (package UP2) may and
// may not do. The test reads the sources, so a later change cannot add a call without a
// failing test. The siblings sources-policy.test.ts (top folder), classify/sources-policy
// and ki/sources-policy cover the imports of those folders; this one covers what the new
// modules and the steps that use them do with a JSON or Excel file: no excerpt, no model,
// no network, no evaluation of what a file holds, nothing but the updates of the plan.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), 'src', 'lib', rel), 'utf8');

/** The code without comments: a comment may name what the code must not do. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NEW_MODULES = [
  'content-upload/read-json.ts',
  'content-upload/read-xlsx.ts',
  'content-upload/classify/json-rule.ts',
  'content-upload/classify/mapping-rule.ts',
  'content-upload/review/json-step.ts',
  'content-upload/review/xlsx-step.ts',
];

describe('the modules of the JSON and Excel kinds', () => {
  it.each(NEW_MODULES)(
    '%s reaches no network, no process, no file system and evaluates nothing',
    rel => {
      const source = code(rel);
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/\beval\s*\(|new Function\s*\(/);
      expect(source).not.toMatch(
        /from\s*['"](?:node:)?(?:fs|fs\/promises|http|https|net|tls|dns|child_process|vm|worker_threads)['"]/
      );
      expect(source).not.toMatch(/\bprocess\.env\b/);
      expect(source).not.toMatch(/XMLHttpRequest|WebSocket|navigator\./);
    }
  );

  it.each([
    'content-upload/review/json-step.ts',
    'content-upload/review/xlsx-step.ts',
    'content-upload/read-json.ts',
    'content-upload/read-xlsx.ts',
  ])('%s makes no excerpt and knows no model', rel => {
    const source = code(rel);
    expect(source).not.toMatch(/\/excerpt['"]|buildExcerpt|protectExcerpt/);
    expect(source).not.toMatch(/\/ki\/|Sokrates|sokrates|KiClient/);
    expect(source).not.toMatch(/chatWithFallback|getChatProvider/);
  });

  it('read-xlsx opens nothing a file points to: no template, link or connection is fetched', () => {
    const source = code('content-upload/read-xlsx.ts');
    // the references are only COUNTED (scanRelationships) and refused, never followed
    expect(source).toContain('scanRelationships');
    expect(source).not.toMatch(/Target\b.*\bfetch|new URL\(/);
    // the formulas are counted, not evaluated: no formula text is read into a value
    expect(source).toContain("'<f>'");
  });

  it('the JSON reader decodes strictly and takes no repair', () => {
    const source = code('content-upload/read-json.ts');
    expect(source).toContain("new TextDecoder('utf-8', { fatal: true })");
    expect(source).not.toMatch(/replace\(\s*\/\\uFFFD|\.replace\(\/\^\\uFEFF/);
    expect(source).toContain('JSON.parse(text)');
  });
});

describe('the steps and the transfer', () => {
  it('the extract step hands a JSON and an Excel file to their own reading before any Word or PDF reader', () => {
    const steps = code('content-upload/review/steps.ts');
    const jsonAt = steps.indexOf("file.ext === 'json'");
    const xlsxAt = steps.indexOf("file.ext === 'xlsx'");
    const docxAt = steps.indexOf("file.ext === 'docx'");
    expect(jsonAt).toBeGreaterThan(0);
    expect(xlsxAt).toBeGreaterThan(jsonAt);
    expect(docxAt).toBeGreaterThan(xlsxAt);
    expect(steps).toMatch(/return extractQuizJson\(/);
    expect(steps).toMatch(/return extractMappingXlsx\(/);
    // the folder tree comes from the paths of Word and PDF files only
    expect(steps).toMatch(/f\.ext === 'docx' \|\| f\.ext === 'pdf'/);
  });

  it('the model stage settles every file that is no Word file before it reads or sends one byte of it', () => {
    const steps = code('content-upload/ki/steps.ts');
    const guard = steps.indexOf("file.ext !== 'docx'");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(steps.indexOf('loadBytes()'));
    expect(guard).toBeLessThan(steps.indexOf('buildExcerpt('));
    expect(steps).toContain('FORMAT_NOT_SENT');
  });

  it('the guard of the excerpts knows the solutions of a JSON file and fails closed without a reader', () => {
    const corpus = code('content-upload/ki/corpus.ts');
    expect(corpus).toMatch(/file\.ext === 'docx' \|\| file\.ext === 'json'/);
    expect(corpus).toContain('this.deps.jsonSolutions?.(bytes) ?? null');
    const env = code('content-upload/ki/env.ts');
    expect(env).toContain('quizJsonSolutionTexts');
  });

  it('the learning field engine runs once, after the two others, and only adds', () => {
    const run = code('content-upload/transfer/run.ts');
    const calls = run.match(/executeLearningFieldPlan\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(run).toMatch(
      /executeLearningFieldPlan\(db, plan\.learningPlan, \{\s*updateExisting: false,\s*write: true,\s*\}\)/
    );
    expect(run.indexOf('executeUseCasePlan(')).toBeLessThan(
      run.indexOf('executeLearningFieldPlan(')
    );
    expect(run.indexOf('executePlan(db')).toBeLessThan(
      run.indexOf('executeUseCasePlan(')
    );
    // it goes through the recording db, so every row of it is in the protocol
    expect(run).toMatch(/const db = new RecordingDb\(/);
    expect(run).not.toMatch(/executeLearningFieldPlan\(engineDb/);
    const compare = code('content-upload/transfer/compare.ts');
    expect(compare).toMatch(
      /executeLearningFieldPlan\(\s*db,\s*plan\.learningPlan,\s*\{ updateExisting: false, write: false \}/
    );
    expect(compare).not.toMatch(/updateExisting:\s*true/);
  });

  it('the plan builder never reads a JSON or Excel file for anything but its own plan', () => {
    const plan = code('content-upload/transfer/plan.ts');
    expect(plan).toContain('readQuizJson(');
    expect(plan).toContain('readXlsx(');
    expect(plan).not.toMatch(/\bfetch\s*\(/);
    // every synthetic source of a JSON file is made unique by the id of its file
    expect(plan).toContain('`upload/${file.id}/json/`');
  });
});
