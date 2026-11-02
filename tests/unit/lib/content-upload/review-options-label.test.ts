/**
 * @jest-environment node
 */
import { optionsOf } from '@/lib/content-upload/review/service';
import type { CatalogComponentRow } from '@/lib/content-upload/review/types';

// The options of the review carry a label next to the code of a component:
// FIAE 2.1 and 2.2 (the code stays the key of every assignment), KfBM and the
// components the plan would create are shown by their code.

const row = (
  code: string,
  orderIndex: number | null,
  title = 'Erfundenes Thema'
): CatalogComponentRow => ({
  code,
  title,
  kind: 'pflicht',
  phase: 1,
  orderIndex,
  enablers: [],
});

describe('optionsOf: the label of a component', () => {
  it('derives the label of a FIAE pair and a single component from the code or the order index', () => {
    const options = optionsOf(
      [
        row('1-P1', 1),
        row('2-P1', 2),
        row('2-P2', 13),
        // a production code that differs from the Preview code: the order index decides
        row('§4.2.9', 20),
      ],
      { components: [] },
      'FIAE'
    );
    expect(options.components.map(c => [c.code, c.label])).toEqual([
      ['1-P1', '1'],
      ['2-P1', '2.1'],
      ['2-P2', '2.2'],
      ['§4.2.9', '9.2'],
    ]);
  });

  it('leaves KfBM and a run without a known catalog as it is: the label is the code', () => {
    const kfbm = optionsOf(
      [row('K24.1', 2), row('K24.2', 13)],
      { components: [] },
      null
    );
    expect(kfbm.components.map(c => [c.code, c.label])).toEqual([
      ['K24.1', 'K24.1'],
      ['K24.2', 'K24.2'],
    ]);
    const without = optionsOf([row('2-P2', 13)], { components: [] });
    expect(without.components[0].label).toBe('2-P2');
  });

  it('shows a component only the plan would create by its code', () => {
    const options = optionsOf(
      [row('2-P1', 2)],
      {
        components: [
          {
            code: 'K99',
            title: 'Neu',
            origin: 'plan',
            enablers: [],
          },
        ],
      } as any,
      'FIAE'
    );
    const added = options.components.find(c => c.code === 'K99')!;
    expect(added.isNew).toBe(true);
    expect(added.label).toBe('K99');
    expect(options.components.find(c => c.code === '2-P1')!.label).toBe('2.1');
  });
});
