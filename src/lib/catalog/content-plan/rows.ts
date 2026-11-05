import {
  COMPONENT_FIELDS,
  LEARNING_FIELD_FIELDS,
  PLAN_LIMITS,
  RELATION_TYPES,
  TOTAL_FIELDS,
  contentPlanSchema,
  fieldSchema,
  rowId,
  type ContentPlan,
  type PlanComponent,
  type PlanDraft,
  type PlanIssue,
  type PlanLearningField,
  type PlanMethod,
  type PlanRelation,
  type PlanRow,
  type PlanRowScope,
  type PlanRowValue,
  type RelationType,
} from '@/lib/catalog/content-plan/types';

/**
 * Plan and proposal rows, both directions, plus the collector the readers fill.
 * Pure. A plan is flattened into single fields (planToRows) so a person can
 * switch each one off, and the accepted fields are folded back (rowsToPlan).
 * Whatever comes out is checked against contentPlanSchema once more by the
 * caller that stores it.
 */

// ---------------------------------------------------------------------------
// Plan <-> rows
// ---------------------------------------------------------------------------

/** The plan as single fields, in a stable order. `quote` is set on every row. */
export function planToRows(plan: ContentPlan, quote = ''): PlanRow[] {
  const rows: PlanRow[] = [];
  const push = (
    scope: PlanRowScope,
    ref: string,
    field: string,
    value: PlanRowValue
  ) =>
    rows.push({
      id: rowId(scope, ref, field, value),
      scope,
      ref,
      field,
      value,
      quote,
    });
  const totals = plan.totals ?? {};
  for (const field of TOTAL_FIELDS) {
    const value = totals[field];
    if (value !== undefined) push('totals', '', field, value);
  }
  for (const c of plan.components ?? []) {
    const ref = c.code ?? c.title ?? '';
    for (const field of COMPONENT_FIELDS) {
      const value = c[field];
      if (value !== undefined) push('component', ref, field, value);
    }
  }
  for (const l of plan.learningFields ?? []) {
    const ref = l.code ?? l.title ?? '';
    for (const field of LEARNING_FIELD_FIELDS) {
      const value = l[field];
      if (value !== undefined) push('learningField', ref, field, value);
    }
  }
  for (const r of plan.relations ?? []) push('relation', r.type, r.from, r.to);
  for (const note of plan.notes ?? []) push('note', '', 'note', note);
  return rows;
}

/** The accepted rows as a plan. The last row of an id wins (a person edited it). */
export function rowsToPlan(rows: readonly PlanRow[]): ContentPlan {
  const byId = new Map<string, PlanRow>();
  for (const row of rows) byId.set(row.id, row);

  const totals: Record<string, PlanRowValue> = {};
  const components = new Map<string, Record<string, PlanRowValue>>();
  const learningFields = new Map<string, Record<string, PlanRowValue>>();
  const relations: PlanRelation[] = [];
  const notes: string[] = [];
  const group = (
    map: Map<string, Record<string, PlanRowValue>>,
    ref: string
  ) => {
    let entry = map.get(ref);
    if (!entry) {
      entry = {};
      map.set(ref, entry);
    }
    return entry;
  };

  for (const row of byId.values()) {
    if (row.scope === 'totals') totals[row.field] = row.value;
    else if (row.scope === 'component') {
      group(components, row.ref)[row.field] = row.value;
    } else if (row.scope === 'learningField') {
      group(learningFields, row.ref)[row.field] = row.value;
    } else if (row.scope === 'relation') {
      if (
        (RELATION_TYPES as readonly string[]).includes(row.ref) &&
        typeof row.value === 'string'
      ) {
        relations.push({
          type: row.ref as RelationType,
          from: row.field,
          to: row.value,
        });
      }
    } else if (typeof row.value === 'string') notes.push(row.value);
  }

  // A part whose code and title rows were both switched off keeps the name the
  // proposal gave it, so what was accepted does not lose its owner
  const withIdentity = (ref: string, entry: Record<string, PlanRowValue>) => {
    if (entry.code === undefined && entry.title === undefined) {
      if (ref.length <= PLAN_LIMITS.maxCodeChars) entry.code = ref;
      else entry.title = ref.slice(0, PLAN_LIMITS.maxTitleChars);
    }
    return entry;
  };

  const plan: ContentPlan = {};
  if (Object.keys(totals).length > 0) plan.totals = totals;
  if (components.size > 0) {
    plan.components = [...components].map(
      ([ref, entry]) => withIdentity(ref, entry) as PlanComponent
    );
  }
  if (learningFields.size > 0) {
    plan.learningFields = [...learningFields].map(
      ([ref, entry]) => withIdentity(ref, entry) as PlanLearningField
    );
  }
  if (relations.length > 0) plan.relations = relations;
  if (notes.length > 0) plan.notes = notes;
  return plan;
}

// ---------------------------------------------------------------------------
// Reading a single value: text of a cell or a typed value of a JSON file
// ---------------------------------------------------------------------------

type ValueKind = 'number' | 'boolean' | 'string' | 'list' | 'phase' | 'kind';

function valueKind(scope: PlanRowScope, field: string): ValueKind {
  if (scope === 'totals') return 'number';
  if (scope === 'component') {
    if (field === 'code' || field === 'title') return 'string';
    if (field === 'phase') return 'phase';
    if (field === 'kind') return 'kind';
    if (field === 'globalQuiz') return 'boolean';
    if (field === 'learningFields') return 'list';
    return 'number';
  }
  if (scope === 'learningField') return field === 'hours' ? 'number' : 'string';
  return 'string';
}

const UNIT = /\s*(?:std\.?|stunden|h|wochen|wo\.?)$/i;

/**
 * A number out of the text of a cell. `german` reads "1.200" as twelve hundred
 * (a text file written with German settings), otherwise a dot is a decimal point.
 * Null when the text is no plain number.
 */
export function parseNumber(raw: string, german = false): number | null {
  let text = raw.trim().replace(UNIT, '').replace(/\s+/g, '');
  if (text === '') return null;
  if (german && /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, '');
  }
  text = text.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const YES = new Set(['ja', 'yes', 'true', 'wahr', 'x', '1', 'j']);
const NO = new Set(['nein', 'no', 'false', 'falsch', '0', '-', 'n']);

/** The typed value of a raw value, or undefined when it cannot be one. */
export function coerceValue(
  kind: ValueKind,
  raw: unknown,
  german = false
): PlanRowValue | undefined {
  switch (kind) {
    case 'number':
      if (typeof raw === 'number') return raw;
      return typeof raw === 'string'
        ? (parseNumber(raw, german) ?? undefined)
        : undefined;
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const word = String(raw).trim().toLowerCase();
      if (YES.has(word)) return true;
      if (NO.has(word)) return false;
      return undefined;
    }
    case 'phase': {
      if (raw === 1 || raw === 2) return raw;
      const match = /(?<!\d)([12])(?!\d)/.exec(String(raw));
      return match ? Number(match[1]) : undefined;
    }
    case 'kind': {
      const word = String(raw).trim().toLowerCase();
      if (word.startsWith('pflicht')) return 'pflicht';
      if (word.startsWith('wahl')) return 'wahl';
      if (word.startsWith('integrativ')) return 'integrativ';
      return undefined;
    }
    case 'list': {
      const items = Array.isArray(raw)
        ? raw.map(String)
        : String(raw).split(/[,;\n]+/);
      const clean = items.map(item => item.trim()).filter(Boolean);
      return clean.length > 0 ? clean : undefined;
    }
    case 'string':
      return typeof raw === 'string' || typeof raw === 'number'
        ? String(raw).trim()
        : undefined;
  }
}

// ---------------------------------------------------------------------------
// The collector the readers fill
// ---------------------------------------------------------------------------

const MAX_ISSUES = 30;

/**
 * Collects the fields of a proposal. Every value is coerced and checked against
 * the schema of its field, a bad one becomes an issue with its place and is
 * dropped (never replaced by zero). An empty cell is "not stated" and silent.
 * The lists are bounded like the plan, so a hostile file cannot grow them.
 */
export class RowCollector {
  readonly rows: PlanRow[] = [];
  readonly issues: PlanIssue[] = [];
  readonly warnings: string[] = [];
  private readonly ids = new Set<string>();
  private readonly refs: Record<'component' | 'learningField', Set<string>> = {
    component: new Set(),
    learningField: new Set(),
  };
  private relationCount = 0;
  private noteCount = 0;
  private full = false;

  constructor(private readonly german = false) {}

  issue(where: string, message: string): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ where, message });
  }

  warn(code: string): void {
    if (!this.warnings.includes(code)) this.warnings.push(code);
  }

  private accept(row: PlanRow, where: string): boolean {
    if (this.ids.has(row.id)) {
      this.issue(where, 'duplicate');
      return false;
    }
    if (this.rows.length >= PLAN_LIMITS.maxRows) {
      if (!this.full) this.issue(where, 'too_many_fields');
      this.full = true;
      return false;
    }
    this.ids.add(row.id);
    this.rows.push(row);
    return true;
  }

  /** One field of totals, a component or a learning field. */
  add(
    scope: 'totals' | 'component' | 'learningField',
    ref: string,
    field: string,
    raw: unknown,
    quote: string,
    where = quote
  ): boolean {
    if (raw === undefined || raw === null) return false;
    if (typeof raw === 'string' && raw.trim() === '') return false;
    const schema = fieldSchema(scope, field);
    if (schema === null) {
      this.issue(where, 'unknown_field');
      return false;
    }
    const value = coerceValue(valueKind(scope, field), raw, this.german);
    const parsed = value === undefined ? null : schema.safeParse(value);
    if (parsed === null || !parsed.success) {
      this.issue(where, 'invalid_value');
      return false;
    }
    if (scope !== 'totals') {
      const owners = this.refs[scope];
      const limit =
        scope === 'component'
          ? PLAN_LIMITS.maxComponents
          : PLAN_LIMITS.maxLearningFields;
      if (!owners.has(ref) && owners.size >= limit) {
        this.issue(where, 'too_many_entries');
        return false;
      }
      if (ref === '') {
        this.issue(where, 'missing_name');
        return false;
      }
      owners.add(ref);
    }
    return this.accept(
      {
        id: rowId(scope, ref, field),
        scope,
        ref,
        field,
        value: parsed.data as PlanRowValue,
        quote: quote.slice(0, PLAN_LIMITS.maxQuoteChars),
      },
      where
    );
  }

  addRelation(
    type: RelationType,
    from: string,
    to: string,
    quote: string,
    where = quote
  ): boolean {
    const a = from.trim();
    const b = to.trim();
    if (a === '' || b === '') return false;
    const schema = fieldSchema('relation', 'from');
    if (!schema?.safeParse(a).success || !schema.safeParse(b).success) {
      this.issue(where, 'invalid_value');
      return false;
    }
    if (this.relationCount >= PLAN_LIMITS.maxRelations) {
      this.issue(where, 'too_many_entries');
      return false;
    }
    const ok = this.accept(
      {
        id: rowId('relation', type, a, b),
        scope: 'relation',
        ref: type,
        field: a,
        value: b,
        quote: quote.slice(0, PLAN_LIMITS.maxQuoteChars),
      },
      where
    );
    if (ok) this.relationCount += 1;
    return ok;
  }

  addNote(note: string, quote: string, where = quote): boolean {
    const clean = note.trim();
    if (clean === '') return false;
    const schema = fieldSchema('note', 'note');
    if (!schema?.safeParse(clean).success) {
      this.issue(where, 'invalid_value');
      return false;
    }
    if (this.noteCount >= PLAN_LIMITS.maxNotes) {
      this.issue(where, 'too_many_entries');
      return false;
    }
    const ok = this.accept(
      {
        id: rowId('note', '', 'note', clean),
        scope: 'note',
        ref: '',
        field: 'note',
        value: clean,
        quote: quote.slice(0, PLAN_LIMITS.maxQuoteChars),
      },
      where
    );
    if (ok) this.noteCount += 1;
    return ok;
  }

  draft(method: PlanMethod): PlanDraft {
    return {
      method,
      rows: this.rows,
      issues: this.issues,
      warnings: this.warnings,
    };
  }
}

// ---------------------------------------------------------------------------
// Confirming a proposal: the selected and edited fields
// ---------------------------------------------------------------------------

/** A value as the text a person edits: a list with commas, a boolean as ja or nein. */
export function valueToText(value: PlanRowValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  return String(value);
}

/**
 * The rows that are accepted: the selected ones, with the edited text where a
 * person changed it. Every value is read and checked again like in a reader,
 * so an edit cannot get around the bounds. An edit that is not valid is
 * reported by id and left out, an emptied field means "not stated".
 */
export function acceptRows(
  rows: readonly PlanRow[],
  selected: ReadonlySet<string>,
  edits: Readonly<Record<string, string>> = {}
): { rows: PlanRow[]; invalid: string[] } {
  const collector = new RowCollector(false);
  const invalid: string[] = [];
  for (const row of rows) {
    if (!selected.has(row.id)) continue;
    const raw = edits[row.id] ?? row.value;
    const text = typeof raw === 'string' ? raw.trim() : null;
    if (text === '') continue;
    let ok: boolean;
    if (row.scope === 'relation') {
      ok = collector.addRelation(
        row.ref as RelationType,
        row.field,
        String(raw),
        row.quote
      );
    } else if (row.scope === 'note') {
      ok = collector.addNote(String(raw), row.quote);
    } else {
      ok = collector.add(row.scope, row.ref, row.field, raw, row.quote);
    }
    if (!ok) invalid.push(row.id);
  }
  return { rows: collector.rows, invalid };
}
