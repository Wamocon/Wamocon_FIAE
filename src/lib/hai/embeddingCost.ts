/**
 * Cost estimate of an embedding run (reindex of the HAI index).
 *
 * Pure functions, no network, no database, no file access, no model call: the
 * input is an inventory of numbers (sources, chunks, characters, pages) that a
 * dry run of scripts/reindex-gemini.ts measured or that a person typed in, the
 * prices come from a configuration (scripts/config/hai-embedding-pricing.json),
 * never from the code. The result is an ESTIMATE: tokens are derived from
 * characters with a range (optimistic, base, pessimistic), because counting
 * tokens exactly needs a model call.
 *
 * What is not included: the chat, the embedding of a user query, retries after
 * a rate limit, storage.
 *
 * @module lib/hai/embeddingCost
 */

export type CostScenario = 'optimistic' | 'base' | 'pessimistic';

export const COST_SCENARIOS: readonly CostScenario[] = [
  'optimistic',
  'base',
  'pessimistic',
];

export type PriceStatus = 'listed' | 'last-known' | 'upper-bound';

const PRICE_STATUSES: readonly PriceStatus[] = [
  'listed',
  'last-known',
  'upper-bound',
];

export interface PriceEntry {
  /** Standard price in USD per million input tokens. */
  inputPerMillionUsd: number;
  /** Batch price in USD per million input tokens, null if there is none. */
  batchInputPerMillionUsd: number | null;
  /**
   * listed: on the price page on the date of asOf. last-known: not on the page
   * any more, the last value that was. upper-bound: another model that is only
   * there to show a ceiling.
   */
  status: PriceStatus;
  source: string;
  /** Date (YYYY-MM-DD) of the check of the price. */
  asOf: string;
}

export interface PricingAssumptions {
  /** Characters per token, the optimistic case has the most (fewest tokens). */
  charsPerToken: Record<CostScenario, number>;
  /** Average characters of a chunk where no characters were measured. */
  chunkChars: number;
  /** Average characters of a PDF page where no characters were measured. */
  charsPerPdfPage: number;
  /** Average pages of a PDF where the pages are unknown. */
  pagesPerPdf: number;
}

export interface PricingConfig {
  defaultModel: string;
  /** USD to EUR, null = no conversion. */
  eurPerUsd: number | null;
  models: Record<string, PriceEntry>;
  assumptions: PricingAssumptions;
}

/** Base case of the characters per token (the shipped configuration says the same). */
export const DEFAULT_CHARS_PER_TOKEN = 3.5;

/** Rough token count of a number of characters (an estimate, no model call). */
export function estimateTokens(
  chars: number,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN
): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  if (!Number.isFinite(charsPerToken) || charsPerToken <= 0) {
    throw new Error('charsPerToken must be a number above zero');
  }
  return Math.round(chars / charsPerToken);
}

// ============================================================================
// Config
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a number above zero`);
  }
  return value;
}

function nonNegative(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a number of zero or more`);
  }
  return value;
}

/** Validates a price configuration (throws with the first problem). */
export function parsePricingConfig(raw: unknown): PricingConfig {
  if (!isRecord(raw)) throw new Error('The price configuration is no object');

  const rawModels = raw.models;
  if (!isRecord(rawModels) || Object.keys(rawModels).length === 0) {
    throw new Error('The price configuration has no models');
  }
  const models: Record<string, PriceEntry> = {};
  for (const [name, entry] of Object.entries(rawModels)) {
    if (name === '__proto__') throw new Error('models has a forbidden name');
    if (!isRecord(entry)) throw new Error(`models.${name} is no object`);
    const status = entry.status as PriceStatus;
    if (!PRICE_STATUSES.includes(status)) {
      throw new Error(
        `models.${name}.status must be one of listed, last-known, upper-bound`
      );
    }
    if (typeof entry.source !== 'string' || entry.source.trim() === '') {
      throw new Error(`models.${name}.source is missing`);
    }
    if (typeof entry.asOf !== 'string' || entry.asOf.trim() === '') {
      throw new Error(`models.${name}.asOf is missing`);
    }
    models[name] = {
      inputPerMillionUsd: nonNegative(
        entry.inputPerMillionUsd,
        `models.${name}.inputPerMillionUsd`
      ),
      batchInputPerMillionUsd:
        entry.batchInputPerMillionUsd === null ||
        entry.batchInputPerMillionUsd === undefined
          ? null
          : nonNegative(
              entry.batchInputPerMillionUsd,
              `models.${name}.batchInputPerMillionUsd`
            ),
      status,
      source: entry.source,
      asOf: entry.asOf,
    };
  }

  const defaultModel = raw.defaultModel;
  if (
    typeof defaultModel !== 'string' ||
    !Object.prototype.hasOwnProperty.call(models, defaultModel)
  ) {
    throw new Error('defaultModel has no price in models');
  }

  const eurPerUsd =
    raw.eurPerUsd === null || raw.eurPerUsd === undefined
      ? null
      : positive(raw.eurPerUsd, 'eurPerUsd');

  const a = raw.assumptions;
  if (!isRecord(a) || !isRecord(a.charsPerToken)) {
    throw new Error('assumptions.charsPerToken is missing');
  }
  const charsPerToken = {
    optimistic: positive(
      a.charsPerToken.optimistic,
      'assumptions.charsPerToken.optimistic'
    ),
    base: positive(a.charsPerToken.base, 'assumptions.charsPerToken.base'),
    pessimistic: positive(
      a.charsPerToken.pessimistic,
      'assumptions.charsPerToken.pessimistic'
    ),
  };
  if (
    !(
      charsPerToken.optimistic >= charsPerToken.base &&
      charsPerToken.base >= charsPerToken.pessimistic
    )
  ) {
    throw new Error(
      'assumptions.charsPerToken must fall from optimistic to pessimistic'
    );
  }

  return {
    defaultModel,
    eurPerUsd,
    models,
    assumptions: {
      charsPerToken,
      chunkChars: positive(a.chunkChars, 'assumptions.chunkChars'),
      charsPerPdfPage: positive(
        a.charsPerPdfPage,
        'assumptions.charsPerPdfPage'
      ),
      pagesPerPdf: positive(a.pagesPerPdf, 'assumptions.pagesPerPdf'),
    },
  };
}

// ============================================================================
// Inventory
// ============================================================================

export type InventoryUnit = 'chunks' | 'files';

/** One line of the inventory: numbers and labels, never text of a source. */
export interface InventoryGroup {
  label: string;
  sourceType: string;
  catalog: string;
  visibility: string;
  unit: InventoryUnit;
  /** Chunks, or files for the unit 'files'. */
  count: number;
  /** Measured characters (0 = not measured). */
  chars: number;
  /** Measured pages of the files (0 = unknown). */
  pages: number;
}

/**
 * A label is plain: letters, digits, spaces and a few signs, 80 characters at
 * most. It is printed unchanged, so nothing that could steer a terminal (control
 * characters, escape sequences) or carry text of a source may pass.
 */
const PLAIN_LABEL = /^[\p{L}\p{N} ()/.:,+_-]{1,80}$/u;

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is missing`);
  }
  if (!PLAIN_LABEL.test(value)) {
    throw new Error(`${name} is no plain label (letters, digits, up to 80)`);
  }
  return value;
}

function groupFrom(raw: unknown, index: number): InventoryGroup {
  const where = `groups[${index}]`;
  if (!isRecord(raw)) throw new Error(`${where} is no object`);
  const unit: InventoryUnit = raw.unit === 'files' ? 'files' : 'chunks';
  if (raw.unit !== undefined && raw.unit !== 'chunks' && raw.unit !== 'files') {
    throw new Error(`${where}.unit must be chunks or files`);
  }
  const sourceType = text(raw.sourceType, `${where}.sourceType`);
  const catalog = text(raw.catalog, `${where}.catalog`);
  const visibility = text(raw.visibility, `${where}.visibility`);
  const countValue = unit === 'files' ? (raw.files ?? raw.chunks) : raw.chunks;
  const count = nonNegative(
    countValue,
    `${where}.${unit === 'files' ? 'files' : 'chunks'}`
  );
  return {
    label:
      typeof raw.label === 'string' && raw.label.trim() !== ''
        ? text(raw.label, `${where}.label`)
        : `${sourceType} ${catalog} ${visibility}`,
    sourceType,
    catalog,
    visibility,
    unit,
    count,
    chars:
      raw.chars === undefined ? 0 : nonNegative(raw.chars, `${where}.chars`),
    pages:
      raw.pages === undefined ? 0 : nonNegative(raw.pages, `${where}.pages`),
  };
}

/**
 * Reads an inventory. Accepted: { groups: [...] } typed by hand, or the log of
 * a dry run of scripts/reindex-gemini.ts ({ plan: { inventory, changes } }),
 * of which `which` picks the part (default: what a real run would embed now).
 * Only labels and numbers are taken, any other field is ignored.
 */
export function parseInventory(
  raw: unknown,
  which: 'inventory' | 'changes' = 'changes'
): InventoryGroup[] {
  if (!isRecord(raw)) throw new Error('The inventory is no object');
  let rows: unknown;
  if (Array.isArray(raw.groups)) {
    rows = raw.groups;
  } else if (isRecord(raw.plan) && Array.isArray(raw.plan[which])) {
    rows = raw.plan[which];
  } else {
    throw new Error(
      'The inventory needs groups, or plan.inventory / plan.changes'
    );
  }
  const list = rows as unknown[];
  if (list.length === 0) throw new Error('The inventory has no groups');
  return list.map((row, i) => groupFrom(row, i));
}

// ============================================================================
// Estimate
// ============================================================================

export type Tokens = Record<CostScenario, number>;

export interface GroupEstimate {
  label: string;
  sourceType: string;
  catalog: string;
  visibility: string;
  unit: InventoryUnit;
  files: number;
  chunks: number;
  chars: number;
  tokens: Tokens;
  /** Which numbers were assumed (not measured). Empty = all measured. */
  assumed: string[];
}

export interface Cost {
  standardUsd: number;
  batchUsd: number | null;
  standardEur: number | null;
  batchEur: number | null;
}

export interface ModelCost extends Record<CostScenario, Cost> {
  model: string;
  status: PriceStatus;
}

export interface CostEstimate {
  runs: number;
  groups: GroupEstimate[];
  totals: {
    files: number;
    chunks: number;
    /** One embedding request per chunk, times the runs. */
    requests: number;
    chars: number;
    tokens: Tokens;
  };
  /** The default model first, then the other models of the configuration. */
  costs: ModelCost[];
}

function scenarioTokens(chars: number, config: PricingConfig): Tokens {
  const per = config.assumptions.charsPerToken;
  return {
    optimistic: Math.round(chars / per.optimistic),
    base: Math.round(chars / per.base),
    pessimistic: Math.round(chars / per.pessimistic),
  };
}

function estimateGroup(
  group: InventoryGroup,
  config: PricingConfig
): GroupEstimate {
  const { chunkChars, charsPerPdfPage, pagesPerPdf } = config.assumptions;
  const assumed: string[] = [];
  let chars = group.chars;
  let chunks = group.count;
  let files = 0;

  if (group.unit === 'chunks') {
    if (chars === 0) {
      chars = group.count * chunkChars;
      assumed.push('chars per chunk');
    }
  } else {
    files = group.count;
    if (chars === 0) {
      let pages = group.pages;
      if (pages === 0) {
        pages = group.count * pagesPerPdf;
        assumed.push('pages per file');
      }
      chars = pages * charsPerPdfPage;
      assumed.push('chars per page');
    } else {
      assumed.push('chars to chunks');
    }
    chunks = Math.ceil(chars / chunkChars);
  }

  return {
    label: group.label,
    sourceType: group.sourceType,
    catalog: group.catalog,
    visibility: group.visibility,
    unit: group.unit,
    files,
    chunks,
    chars,
    tokens: scenarioTokens(chars, config),
    assumed,
  };
}

function priceTokens(
  tokens: number,
  entry: PriceEntry,
  eurPerUsd: number | null
): Cost {
  const standardUsd = (tokens / 1_000_000) * entry.inputPerMillionUsd;
  const batchUsd =
    entry.batchInputPerMillionUsd === null
      ? null
      : (tokens / 1_000_000) * entry.batchInputPerMillionUsd;
  return {
    standardUsd,
    batchUsd,
    standardEur: eurPerUsd === null ? null : standardUsd * eurPerUsd,
    batchEur:
      eurPerUsd === null || batchUsd === null ? null : batchUsd * eurPerUsd,
  };
}

/**
 * Estimate of the embedding cost of an inventory. `runs` is the number of
 * times the whole inventory is embedded (a run in the Preview and one in
 * Production embed the same text twice).
 */
export function estimateEmbeddingCost(
  inventory: InventoryGroup[],
  config: PricingConfig,
  options: { runs?: number } = {}
): CostEstimate {
  const runs = options.runs ?? 1;
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('runs must be a whole number of 1 or more');
  }
  if (inventory.length === 0) throw new Error('The inventory has no groups');

  const groups = inventory.map(group => estimateGroup(group, config));
  const sum = (pick: (g: GroupEstimate) => number) =>
    groups.reduce((total, g) => total + pick(g), 0);
  const tokens: Tokens = {
    optimistic: sum(g => g.tokens.optimistic) * runs,
    base: sum(g => g.tokens.base) * runs,
    pessimistic: sum(g => g.tokens.pessimistic) * runs,
  };
  const chunks = sum(g => g.chunks);

  const names = [
    config.defaultModel,
    ...Object.keys(config.models).filter(name => name !== config.defaultModel),
  ];
  const costs: ModelCost[] = names.map(model => {
    const entry = config.models[model];
    return {
      model,
      status: entry.status,
      optimistic: priceTokens(tokens.optimistic, entry, config.eurPerUsd),
      base: priceTokens(tokens.base, entry, config.eurPerUsd),
      pessimistic: priceTokens(tokens.pessimistic, entry, config.eurPerUsd),
    };
  });

  return {
    runs,
    groups,
    totals: {
      files: sum(g => g.files),
      chunks,
      requests: chunks * runs,
      chars: sum(g => g.chars),
      tokens,
    },
    costs,
  };
}

// ============================================================================
// Report
// ============================================================================

const number = (value: number) => value.toLocaleString('en-US');
const usd = (value: number) => `$${value.toFixed(4)}`;

/** Plain text report of an estimate, with the source and date of every price. */
export function formatCostReport(
  estimate: CostEstimate,
  config: PricingConfig
): string {
  const lines: string[] = [];
  lines.push('Embedding cost estimate (an estimate: no model call was made,');
  lines.push('no network, no database; tokens are derived from characters).');
  lines.push('');
  lines.push(
    `Runs: ${estimate.runs} (the whole inventory is embedded this often)`
  );
  lines.push('');
  lines.push('Groups (before the runs):');
  for (const g of estimate.groups) {
    const unit =
      g.unit === 'files'
        ? `${number(g.files)} files -> ${number(g.chunks)} chunks`
        : `${number(g.chunks)} chunks`;
    const assumed =
      g.assumed.length > 0 ? `  [assumed: ${g.assumed.join(', ')}]` : '';
    lines.push(
      `  ${g.label}: ${unit}, ${number(g.chars)} chars, ~${number(g.tokens.base)} tokens${assumed}`
    );
  }
  const t = estimate.totals;
  lines.push('');
  lines.push(
    `Total (with runs): ${number(t.requests)} requests, ${number(t.chars * estimate.runs)} chars`
  );
  lines.push(
    `Tokens: optimistic ${number(t.tokens.optimistic)}, base ${number(t.tokens.base)}, pessimistic ${number(t.tokens.pessimistic)}`
  );
  lines.push('');
  lines.push(
    'Cost in USD (standard / batch), optimistic | base | pessimistic:'
  );
  for (const c of estimate.costs) {
    const entry = config.models[c.model];
    const cell = (s: CostScenario) =>
      `${usd(c[s].standardUsd)} / ${c[s].batchUsd === null ? 'no batch' : usd(c[s].batchUsd)}`;
    lines.push(`  ${c.model} (${c.status}, ${entry.asOf}, ${entry.source})`);
    lines.push(
      `    ${cell('optimistic')} | ${cell('base')} | ${cell('pessimistic')}`
    );
    if (c.base.standardEur !== null) {
      lines.push(
        `    EUR (standard): ${c.optimistic.standardEur!.toFixed(4)} | ${c.base.standardEur.toFixed(4)} | ${c.pessimistic.standardEur!.toFixed(4)}`
      );
    }
  }
  lines.push('');
  lines.push(
    'Not included: chat, the embedding of user questions, retries after a rate limit.'
  );
  lines.push(
    'Replace every "assumed" number by a measured one before you rely on the result.'
  );
  return lines.join('\n');
}
