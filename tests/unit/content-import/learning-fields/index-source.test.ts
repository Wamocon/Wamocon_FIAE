import { pathInfo } from '@/lib/content-import/path-info';
import {
  importIndexFromFiles,
  importIndexFromPlan,
} from '@/lib/content-import/learning-fields/index-source';

describe('importIndexFromPlan', () => {
  it('takes components, paragraphs and enabler codes from an apply plan', () => {
    expect(
      importIndexFromPlan(
        {
          components: [
            { code: 'K1', reference: '§ 4 Abs. 2 Nr. 1' },
            { code: 'K9', reference: null },
          ],
          enablers: [{ code: 'K1-a' }, { code: 'K1-b' }],
        },
        [18]
      )
    ).toEqual({
      components: [
        { code: 'K1', reference: '§ 4 Abs. 2 Nr. 1' },
        { code: 'K9', reference: null },
      ],
      enablers: ['K1-a', 'K1-b'],
      excludedNumbers: [18],
    });
  });

  it('tolerates a plan without lists', () => {
    expect(importIndexFromPlan({}, [])).toEqual({
      components: [],
      enablers: [],
      excludedNumbers: [],
    });
  });
});

describe('importIndexFromFiles', () => {
  const T2 = 'Komponente Teil 2 (16-36 Monate)';
  const files = [
    `${T2}/06.2 - Erfunden (§ 4 Abs. 2 Nr. 6)/Enablers/6d_Thema/6d_Thema.docx`,
    `${T2}/06.2 - Erfunden (§ 4 Abs. 2 Nr. 6)/Enablers/6e_Thema/6e_Thema.docx`,
    `${T2}/06.2 - Erfunden (§ 4 Abs. 2 Nr. 6)/Enablers/6d_Thema/Szenario/Szenario_6d.docx`,
    `${T2}/06.2 - Erfunden (§ 4 Abs. 2 Nr. 6)/Enablers/6d_Thema/Archiv/6d_Thema_v2.docx`,
  ].map(rel => ({ rel, info: pathInfo(rel) }));

  it('takes the enabler codes of the chosen enabler texts and the paragraph of the component', () => {
    const index = importIndexFromFiles(
      files,
      [files[0].rel, files[1].rel, files[2].rel],
      [18]
    );
    expect(index.enablers).toEqual(['K6.2-d', 'K6.2-e']);
    expect(index.components).toEqual([
      { code: 'K6.2', reference: '§ 4 Abs. 2 Nr. 6' },
    ]);
    expect(index.excludedNumbers).toEqual([18]);
  });

  it('leaves out files that are not chosen', () => {
    const index = importIndexFromFiles(files, [files[1].rel], []);
    expect(index.enablers).toEqual(['K6.2-e']);
  });
});
