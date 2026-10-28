// Rows that were imported with the long descriptions (the whole Word text) get
// the short descriptions with --update-existing: only the description columns,
// never is_active, the code or a link, and the report names the lengths before
// and after. All texts are invented.
import { executePlan } from '@/lib/content-import/apply/engine';
import type { RunOptions } from '@/lib/content-import/apply/engine';
import { buildImportPlan } from '@/lib/content-import/apply/plan';
import { renderLengthChanges } from '@/lib/content-import/descriptions';
import { executeUseCasePlan } from '@/lib/content-import/use-cases/engine';
import { buildUseCasePlan } from '@/lib/content-import/use-cases/plan';

import { CREATOR_ID, MemoryImportDb } from '../../../helpers/memoryImportDb';
import { loadDecisions, sampleTree } from './fixtures';
import {
  loadDecisions as loadUseCaseDecisions,
  sampleTree as useCaseTree,
} from '../use-cases/fixtures';

const NOW = new Date('2026-10-28T12:00:00Z');
const LONG = 'Erfundener langer Lehrtext, Absatz eins. '.repeat(500);
const options = (patch: Partial<RunOptions> = {}): RunOptions => ({
  createdBy: CREATOR_ID,
  updateExisting: false,
  write: true,
  activate: false,
  scenarioSolutions: false,
  ...patch,
});
const plan = () => buildImportPlan(sampleTree(), loadDecisions(), { now: NOW });

/** The state after an import that wrote the whole text and the old descriptions. */
async function oldImport() {
  const db = new MemoryImportDb();
  await executePlan(db, plan(), options());
  for (const e of db.tables.enablers) e.description_text = LONG;
  for (const c of db.tables.courses) c.description = '§ 4 Abs. 2 Nr. 1';
  for (const c of db.tables.training_components) {
    c.description = '§ 4 Abs. 2 Nr. 1';
  }
  db.log.length = 0;
  return db;
}

describe('a run over rows with the long descriptions', () => {
  it('without --update-existing: reports the lengths, writes nothing', async () => {
    const db = await oldImport();
    const report = await executePlan(db, plan(), options());
    const enablers = report.differences.filter(d => d.table === 'enablers');
    expect(enablers).toHaveLength(6);
    for (const d of enablers) {
      expect(d.columns).toEqual(['description_text']);
      expect(d.lengths?.description_text.before).toBe(LONG.length);
      expect(d.lengths?.description_text.after).toBeLessThan(600);
    }
    expect(report.tables.enablers.update).toBe(0);
    expect(db.log).toEqual([]);
    expect(db.tables.enablers.every(e => e.description_text === LONG)).toBe(
      true
    );
  });

  it('with --update-existing: replaces the description columns and nothing else', async () => {
    const db = await oldImport();
    const before = db.tables.enablers.map(e => ({ ...e }));
    const report = await executePlan(
      db,
      plan(),
      options({ updateExisting: true })
    );
    expect(report.tables.enablers.update).toBe(6);
    expect(report.tables.courses.update).toBe(5);
    expect(report.tables.training_components.update).toBe(5);
    db.tables.enablers.forEach((e, i) => {
      expect((e.description_text as string).length).toBeLessThan(600);
      // nothing but the description changed: activation, code, links stay
      const { description_text: _a, updated_at: _b, ...rest } = e;
      const { description_text: _c, updated_at: _d, ...old } = before[i];
      expect(rest).toEqual(old);
    });
    const updated = db.log.filter(l => l.op === 'update');
    for (const entry of updated) {
      if (entry.table === 'enablers') {
        expect(entry.columns).toEqual(['description_text']);
      }
      if (entry.table === 'courses' || entry.table === 'training_components') {
        expect(entry.columns).toEqual(['description']);
      }
    }
    expect(db.tables.enablers.every(e => e.is_active === false)).toBe(true);
  });

  it('gives the course and the component a sentence with the title', async () => {
    const db = await oldImport();
    await executePlan(db, plan(), options({ updateExisting: true }));
    const k1 = db.tables.courses.find(c => c.code === 'K1');
    expect(k1?.description).toBe(
      'Komponente K1: Erfundenes Thema Eins (§ 4 Abs. 2 Nr. 1)'
    );
    expect(
      db.tables.training_components.find(c => c.code === 'K1')?.description
    ).toBe('Komponente K1: Erfundenes Thema Eins (§ 4 Abs. 2 Nr. 1)');
  });

  it('is idempotent: a second run changes nothing', async () => {
    const db = await oldImport();
    await executePlan(db, plan(), options({ updateExisting: true }));
    db.log.length = 0;
    const again = await executePlan(
      db,
      plan(),
      options({ updateExisting: true })
    );
    expect(again.differences).toEqual([]);
    expect(db.log).toEqual([]);
  });

  it('shows the number of rows and the lengths in the report text, numbers only', async () => {
    const db = await oldImport();
    const report = await executePlan(db, plan(), options());
    const text = renderLengthChanges(report.differences, false).join('\n');
    expect(text).toContain(
      `| enablers | description_text | 6 | ${LONG.length} |`
    );
    expect(text).toContain(
      `enablers K1-a description_text: ${LONG.length} auf `
    );
    expect(text).not.toContain('Erfundener lange');
  });
});

describe('a use case run over rows with the whole assignment as description', () => {
  const ucPlan = () =>
    buildUseCasePlan(useCaseTree(), loadUseCaseDecisions(), { now: NOW });

  async function oldUseCases() {
    const db = new MemoryImportDb();
    // courses and enablers of the content import
    await executePlan(db, plan(), options());
    await executeUseCasePlan(db, ucPlan(), {
      createdBy: CREATOR_ID,
      updateExisting: false,
      write: true,
      activate: false,
      solutions: false,
    });
    for (const u of db.tables.use_cases) u.description_text = LONG;
    db.log.length = 0;
    return db;
  }

  it('replaces only description_text with the title, with --update-existing', async () => {
    const db = await oldUseCases();
    expect(db.tables.use_cases.length).toBeGreaterThan(0);
    const before = db.tables.use_cases.map(u => ({ ...u }));
    const report = await executeUseCasePlan(db, ucPlan(), {
      createdBy: CREATOR_ID,
      updateExisting: false,
      write: true,
      activate: false,
      solutions: false,
    });
    expect(report.differences.length).toBe(before.length);
    for (const d of report.differences) {
      expect(d.columns).toEqual(['description_text']);
      expect(d.lengths?.description_text.before).toBe(LONG.length);
      expect(d.lengths?.description_text.after).toBeLessThanOrEqual(120);
    }
    expect(db.log).toEqual([]);

    const updated = await executeUseCasePlan(db, ucPlan(), {
      createdBy: CREATOR_ID,
      updateExisting: true,
      write: true,
      activate: false,
      solutions: false,
    });
    expect(updated.tables.use_cases.update).toBe(before.length);
    for (const u of db.tables.use_cases) {
      expect(u.description_text).toBe(u.title);
      expect(u.is_active).toBe(false);
    }
    db.tables.use_cases.forEach((u, i) => {
      const { description_text: _a, updated_at: _b, ...rest } = u;
      const { description_text: _c, updated_at: _d, ...old } = before[i];
      expect(rest).toEqual(old);
    });
  });
});
