/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_CHARS_PER_TOKEN,
  estimateEmbeddingCost,
  estimateTokens,
  formatCostReport,
  parseInventory,
  parsePricingConfig,
  type PricingConfig,
} from '@/lib/hai/embeddingCost';
import { TRAINER_SOLUTION_SOURCE_LABEL } from '@/lib/hai/trainerSolutions';

// Cost estimate of an embedding run (no network, no database, no model call).
// The prices are configuration: scripts/config/hai-embedding-pricing.json.

const CONFIG_PATH = path.join(
  process.cwd(),
  'scripts',
  'config',
  'hai-embedding-pricing.json'
);

/** A small config that the tests own, so the numbers are easy to check. */
const PRICING: PricingConfig = {
  defaultModel: 'model-a',
  eurPerUsd: null,
  models: {
    'model-a': {
      inputPerMillionUsd: 0.2,
      batchInputPerMillionUsd: 0.1,
      status: 'listed',
      source: 'test',
      asOf: '2026-01-01',
    },
    'model-b': {
      inputPerMillionUsd: 1,
      batchInputPerMillionUsd: null,
      status: 'upper-bound',
      source: 'test',
      asOf: '2026-01-01',
    },
  },
  assumptions: {
    charsPerToken: { optimistic: 4, base: 2, pessimistic: 1 },
    chunkChars: 400,
    charsPerPdfPage: 2000,
    pagesPerPdf: 5,
  },
};

describe('estimateTokens', () => {
  it('divides the characters by the characters per token', () => {
    expect(estimateTokens(350)).toBe(100);
    expect(estimateTokens(10, 4)).toBe(3);
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(-5)).toBe(0);
    expect(estimateTokens(Number.NaN)).toBe(0);
  });

  it('refuses a divisor that is not above zero', () => {
    expect(() => estimateTokens(10, 0)).toThrow();
  });

  it('uses the base case of the shipped configuration by default', () => {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    expect(DEFAULT_CHARS_PER_TOKEN).toBe(raw.assumptions.charsPerToken.base);
  });
});

describe('the shipped price configuration', () => {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  it('is valid and prices the model the index uses', () => {
    const config = parsePricingConfig(raw);
    expect(config.models['gemini-embedding-001']).toBeDefined();
    expect(config.defaultModel).toBe('gemini-embedding-001');
  });

  it('names source and date of every price', () => {
    const config = parsePricingConfig(raw);
    for (const entry of Object.values(config.models)) {
      expect(entry.source).toMatch(/^https:\/\//);
      expect(entry.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('parsePricingConfig', () => {
  const valid = JSON.parse(JSON.stringify(PRICING));

  it('accepts a complete config', () => {
    expect(parsePricingConfig(valid)).toEqual(PRICING);
  });

  it.each([
    ['not an object', 'x'],
    ['no models', { ...valid, models: {} }],
    ['default model without a price', { ...valid, defaultModel: 'nope' }],
    [
      'negative price',
      {
        ...valid,
        models: {
          'model-a': { ...valid.models['model-a'], inputPerMillionUsd: -1 },
        },
      },
    ],
    [
      'price as text',
      {
        ...valid,
        models: {
          'model-a': { ...valid.models['model-a'], inputPerMillionUsd: '0.2' },
        },
      },
    ],
    [
      'unknown status',
      {
        ...valid,
        models: {
          'model-a': { ...valid.models['model-a'], status: 'cheap' },
        },
      },
    ],
    [
      'characters per token in the wrong order',
      {
        ...valid,
        assumptions: {
          ...valid.assumptions,
          charsPerToken: { optimistic: 1, base: 2, pessimistic: 4 },
        },
      },
    ],
    [
      'chunk size zero',
      { ...valid, assumptions: { ...valid.assumptions, chunkChars: 0 } },
    ],
    ['exchange rate zero', { ...valid, eurPerUsd: 0 }],
  ])('refuses %s', (_name, raw) => {
    expect(() => parsePricingConfig(raw)).toThrow();
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'does not take the inherited name %s as the default model',
    name => {
      expect(() =>
        parsePricingConfig({ ...valid, defaultModel: name })
      ).toThrow();
    }
  );

  it('takes a positive exchange rate', () => {
    expect(parsePricingConfig({ ...valid, eurPerUsd: 0.9 }).eurPerUsd).toBe(
      0.9
    );
  });
});

describe('parseInventory', () => {
  it('reads hand written groups', () => {
    const groups = parseInventory({
      groups: [
        {
          label: 'Enabler',
          sourceType: 'enabler',
          catalog: 'KFBM',
          visibility: 'all',
          unit: 'chunks',
          chunks: 10,
          chars: 4000,
        },
        {
          sourceType: 'document',
          catalog: 'KFBM',
          visibility: 'all',
          unit: 'files',
          files: 3,
          pages: 18,
        },
      ],
    });
    expect(groups).toEqual([
      {
        label: 'Enabler',
        sourceType: 'enabler',
        catalog: 'KFBM',
        visibility: 'all',
        unit: 'chunks',
        count: 10,
        chars: 4000,
        pages: 0,
      },
      {
        label: 'document KFBM all',
        sourceType: 'document',
        catalog: 'KFBM',
        visibility: 'all',
        unit: 'files',
        count: 3,
        chars: 0,
        pages: 18,
      },
    ]);
  });

  it('reads the plan of the log of a dry run (changes by default)', () => {
    const row = (chunks: number) => ({
      sourceType: 'quiz',
      catalog: 'KFBM',
      visibility: 'all',
      unit: 'chunks',
      chunks,
      chars: chunks * 100,
      pages: 0,
    });
    const log = { plan: { inventory: [row(9)], changes: [row(4)] } };
    expect(parseInventory(log)[0].count).toBe(4);
    expect(parseInventory(log, 'inventory')[0].count).toBe(9);
  });

  it('reads the file rows of the plan (count is in chunks)', () => {
    const [group] = parseInventory({
      plan: {
        changes: [
          {
            sourceType: 'document (PDF files, not chunks)',
            catalog: 'KFBM',
            visibility: 'all',
            unit: 'files',
            chunks: 7,
            chars: 0,
            pages: 40,
          },
        ],
      },
    });
    expect(group).toMatchObject({ unit: 'files', count: 7, pages: 40 });
  });

  it('refuses input that is not an inventory', () => {
    expect(() => parseInventory(null)).toThrow();
    expect(() => parseInventory({})).toThrow();
    expect(() => parseInventory({ groups: [] })).toThrow(/no groups/);
    expect(() => parseInventory({ groups: [{ unit: 'chunks' }] })).toThrow();
    expect(() =>
      parseInventory({
        groups: [
          {
            sourceType: 'x',
            catalog: 'K',
            visibility: 'all',
            unit: 'chunks',
            chunks: -1,
          },
        ],
      })
    ).toThrow();
  });

  it.each([
    ['a control character', 'enabler\u001b[31m'],
    ['a line break', 'enabler\nKFBM'],
    ['too long', 'x'.repeat(81)],
    ['markup', '<script>'],
  ])('refuses a label with %s', (_name, bad) => {
    const group = {
      sourceType: 'enabler',
      catalog: 'KFBM',
      visibility: 'all',
      unit: 'chunks',
      chunks: 1,
    };
    for (const field of ['sourceType', 'catalog', 'visibility', 'label']) {
      expect(() =>
        parseInventory({ groups: [{ ...group, [field]: bad }] })
      ).toThrow(/plain label/);
    }
  });

  it('takes the labels of a dry run (letters, digits, brackets)', () => {
    const [group] = parseInventory({
      groups: [
        {
          sourceType: 'document (PDF files, not chunks)',
          catalog: '(no catalog)',
          visibility: 'trainer',
          unit: 'files',
          files: 1,
        },
      ],
    });
    expect(group.label).toBe(
      'document (PDF files, not chunks) (no catalog) trainer'
    );
  });

  it('never takes text from the input (numbers and labels only)', () => {
    const [group] = parseInventory({
      groups: [
        {
          sourceType: 'enabler',
          catalog: 'KFBM',
          visibility: 'all',
          unit: 'chunks',
          chunks: 1,
          text: 'SECRET CONTENT',
        },
      ],
    });
    expect(JSON.stringify(group)).not.toContain('SECRET');
  });
});

describe('estimateEmbeddingCost', () => {
  const chunks = (count: number, chars?: number) => ({
    label: 'g',
    sourceType: 'enabler',
    catalog: 'KFBM',
    visibility: 'all',
    unit: 'chunks' as const,
    count,
    chars: chars ?? 0,
    pages: 0,
  });

  it('uses measured characters when given', () => {
    const est = estimateEmbeddingCost([chunks(10, 4000)], PRICING);
    expect(est.totals.chunks).toBe(10);
    expect(est.totals.chars).toBe(4000);
    // 4000 chars: 1000 / 2000 / 4000 tokens
    expect(est.totals.tokens).toEqual({
      optimistic: 1000,
      base: 2000,
      pessimistic: 4000,
    });
    expect(est.groups[0].assumed).toEqual([]);
  });

  it('assumes the chunk size where nothing was measured, and says so', () => {
    const est = estimateEmbeddingCost([chunks(10)], PRICING);
    expect(est.totals.chars).toBe(4000); // 10 * chunkChars 400
    expect(est.groups[0].assumed).toContain('chars per chunk');
  });

  it('turns files into chunks from measured pages', () => {
    const est = estimateEmbeddingCost(
      [
        {
          label: 'pdf',
          sourceType: 'document',
          catalog: 'KFBM',
          visibility: 'all',
          unit: 'files',
          count: 2,
          chars: 0,
          pages: 10,
        },
      ],
      PRICING
    );
    // 10 pages * 2000 chars = 20000 chars -> 50 chunks of 400
    expect(est.totals.chars).toBe(20000);
    expect(est.totals.chunks).toBe(50);
    expect(est.totals.files).toBe(2);
    expect(est.groups[0].assumed).toContain('chars per page');
    expect(est.groups[0].assumed).not.toContain('pages per file');
  });

  it('assumes the pages per file where the pages are unknown', () => {
    const est = estimateEmbeddingCost(
      [
        {
          label: 'pdf',
          sourceType: 'document',
          catalog: 'KFBM',
          visibility: 'all',
          unit: 'files',
          count: 3,
          chars: 0,
          pages: 0,
        },
      ],
      PRICING
    );
    // 3 files * 5 pages * 2000 chars
    expect(est.totals.chars).toBe(30000);
    expect(est.groups[0].assumed).toEqual(
      expect.arrayContaining(['pages per file', 'chars per page'])
    );
  });

  it('turns measured characters of files into chunks (no page assumption)', () => {
    const est = estimateEmbeddingCost(
      [
        {
          label: 'pdf',
          sourceType: 'document',
          catalog: 'KFBM',
          visibility: 'all',
          unit: 'files',
          count: 3,
          chars: 8000,
          pages: 0,
        },
      ],
      PRICING
    );
    expect(est.totals.chunks).toBe(20);
    expect(est.groups[0].assumed).toEqual(['chars to chunks']);
  });

  it('prices the tokens with every model, standard and batch', () => {
    const est = estimateEmbeddingCost([chunks(10, 4000)], PRICING);
    const a = est.costs.find(c => c.model === 'model-a')!;
    // base: 2000 tokens at 0.2 USD per million
    expect(a.base.standardUsd).toBeCloseTo(0.0004, 10);
    expect(a.base.batchUsd).toBeCloseTo(0.0002, 10);
    expect(a.pessimistic.standardUsd).toBeCloseTo(0.0008, 10);
    expect(a.optimistic.standardUsd).toBeCloseTo(0.0002, 10);
    const b = est.costs.find(c => c.model === 'model-b')!;
    expect(b.base.standardUsd).toBeCloseTo(0.002, 10);
    expect(b.base.batchUsd).toBeNull();
    expect(est.costs[0].model).toBe('model-a'); // the default model first
  });

  it('multiplies by the number of runs (preview and production embed twice)', () => {
    const one = estimateEmbeddingCost([chunks(10, 4000)], PRICING);
    const two = estimateEmbeddingCost([chunks(10, 4000)], PRICING, {
      runs: 2,
    });
    expect(two.totals.requests).toBe(20);
    expect(two.costs[0].base.standardUsd).toBeCloseTo(
      one.costs[0].base.standardUsd * 2,
      12
    );
  });

  it('converts to euro only with an exchange rate', () => {
    const none = estimateEmbeddingCost([chunks(10, 4000)], PRICING);
    expect(none.costs[0].base.standardEur).toBeNull();
    const withRate = estimateEmbeddingCost([chunks(10, 4000)], {
      ...PRICING,
      eurPerUsd: 0.5,
    });
    expect(withRate.costs[0].base.standardEur).toBeCloseTo(0.0002, 10);
  });

  it('sums the groups and keeps a row per group', () => {
    const est = estimateEmbeddingCost(
      [chunks(10, 4000), chunks(5, 1000)],
      PRICING
    );
    expect(est.groups).toHaveLength(2);
    expect(est.totals.chunks).toBe(15);
    expect(est.totals.requests).toBe(15);
    expect(est.totals.chars).toBe(5000);
  });

  it('refuses a run count that is not a positive whole number', () => {
    for (const runs of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        estimateEmbeddingCost([chunks(1, 10)], PRICING, { runs })
      ).toThrow(/runs/);
    }
  });

  it('refuses an empty inventory', () => {
    expect(() => estimateEmbeddingCost([], PRICING)).toThrow();
  });
});

describe('formatCostReport', () => {
  it('lists the totals, the prices with source and date and the limits', () => {
    const est = estimateEmbeddingCost(
      [
        {
          label: 'enabler KFBM all',
          sourceType: 'enabler',
          catalog: 'KFBM',
          visibility: 'all',
          unit: 'chunks',
          count: 10,
          chars: 0,
          pages: 0,
        },
      ],
      PRICING
    );
    const report = formatCostReport(est, PRICING);
    expect(report).toContain('enabler KFBM all');
    expect(report).toContain('model-a');
    expect(report).toContain('model-b');
    expect(report).toContain('2026-01-01');
    expect(report).toContain('estimate');
    expect(report).toContain('chars per chunk');
    expect(report).toMatch(/no model call/i);
  });
});

// The model solutions of the private bucket go to the model provider only by a
// decision of the owner. The estimate shows what they cost on their own.
describe('trainer solutions in the estimate', () => {
  const quiz = {
    label: 'quiz KFBM all',
    sourceType: 'quiz',
    catalog: 'KFBM',
    visibility: 'all',
    unit: 'chunks' as const,
    count: 10,
    chars: 4000,
    pages: 0,
  };
  const solutions = {
    label: 'trainer solutions KFBM',
    sourceType: TRAINER_SOLUTION_SOURCE_LABEL,
    catalog: 'KFBM',
    visibility: 'trainer',
    unit: 'files' as const,
    count: 10,
    chars: 0,
    pages: 40,
  };

  it('shows their share apart, with the same runs', () => {
    const est = estimateEmbeddingCost([quiz, solutions], PRICING, { runs: 2 });
    const only = estimateEmbeddingCost([solutions], PRICING, { runs: 2 });
    expect(est.trainerSolutions).toBeDefined();
    expect(est.trainerSolutions?.totals).toEqual(only.totals);
    expect(est.trainerSolutions?.costs).toEqual(only.costs);
    expect(est.trainerSolutions?.runs).toBe(2);
    // 40 pages * 2000 chars at 2 chars per token (base), two runs
    expect(est.trainerSolutions?.totals.tokens.base).toBe(80000);
    // the total still holds everything
    expect(est.totals.tokens.base).toBeGreaterThan(
      est.trainerSolutions?.totals.tokens.base ?? 0
    );
  });

  it('has no share when the inventory holds none', () => {
    expect(estimateEmbeddingCost([quiz], PRICING).trainerSolutions).toBe(
      undefined
    );
  });

  it('names them in the report with the transfer to the provider', () => {
    const report = formatCostReport(
      estimateEmbeddingCost([quiz, solutions], PRICING),
      PRICING
    );
    expect(report).toMatch(/trainer solutions/i);
    expect(report).toContain('HAI_TRAINER_SOLUTIONS');
    expect(report).toMatch(/provider/i);
    const without = formatCostReport(
      estimateEmbeddingCost([quiz], PRICING),
      PRICING
    );
    expect(without).not.toContain('HAI_TRAINER_SOLUTIONS');
  });

  it('reads the separate count of a dry run (plan.trainerSolutions)', () => {
    const row = {
      sourceType: TRAINER_SOLUTION_SOURCE_LABEL,
      catalog: 'KFBM',
      visibility: 'trainer',
      unit: 'files',
      chunks: 12,
      chars: 0,
      pages: 60,
    };
    const log = {
      plan: { inventory: [], changes: [], trainerSolutions: [row] },
    };
    const [group] = parseInventory(log, 'trainerSolutions');
    expect(group).toMatchObject({
      unit: 'files',
      count: 12,
      pages: 60,
      sourceType: TRAINER_SOLUTION_SOURCE_LABEL,
    });
    // an old log without the part is no inventory of solutions
    expect(() =>
      parseInventory(
        { plan: { inventory: [row], changes: [row] } },
        'trainerSolutions'
      )
    ).toThrow();
  });
});
