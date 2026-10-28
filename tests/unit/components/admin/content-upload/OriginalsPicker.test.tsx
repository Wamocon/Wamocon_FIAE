import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../helpers/renderWithProviders';
import { OriginalsPicker } from '@/components/admin/content-upload/OriginalsPicker';
import {
  MAX_ORIGINALS,
  originalCandidates,
  pruneOriginals,
  toggleOriginal,
} from '@/lib/content-upload/review/originals';
import { rowDto } from '../../../../helpers/reviewUi';
import type { ReviewRowDto } from '@/lib/content-upload/review/types';

// The review list can mark the original PDF of an enabler text for the transfer (at most 25 per
// apply, only files that the transfer takes: an accepted PDF assigned as the original of an enabler).

const pdfRow = (
  name: string,
  over: Partial<ReviewRowDto> = {}
): ReviewRowDto => {
  const base = rowDto({
    fileName: name,
    effective: {
      docType: 'pdf_original',
      componentCode: 'K1',
      enablerCode: 'K1-a',
      quizLevel: null,
    },
    ...over,
  });
  return {
    ...base,
    ext: 'pdf',
    decision: {
      action: 'accept',
      dupChoice: null,
      decidedAt: '2026-10-27T10:00:00Z',
      docType: 'pdf_original',
      componentCode: 'K1',
      enablerCode: 'K1-a',
      quizLevel: null,
    },
    ...over,
  };
};

describe('originalCandidates', () => {
  it('takes an accepted PDF that is the original of an enabler text', () => {
    const rows = [pdfRow('1a.pdf')];
    expect(originalCandidates(rows).map(r => r.fileName)).toEqual(['1a.pdf']);
  });

  it('leaves out what the transfer would refuse anyway', () => {
    const rows = [
      pdfRow('open.pdf', { decision: null }),
      pdfRow('rejected.pdf', {
        decision: {
          action: 'reject',
          dupChoice: null,
          decidedAt: 'x',
          docType: 'pdf_original',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: null,
        },
      }),
      pdfRow('word.pdf', { ext: 'docx' }),
      pdfRow('no-enabler.pdf', {
        effective: {
          docType: 'pdf_original',
          componentCode: 'K1',
          enablerCode: null,
          quizLevel: null,
        },
      }),
      pdfRow('quiz.pdf', {
        effective: {
          docType: 'quiz',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: 'low',
        },
      }),
      pdfRow('skipped.pdf', { status: 'superseded' }),
    ];
    expect(originalCandidates(rows)).toEqual([]);
  });
});

describe('toggleOriginal', () => {
  it('adds, removes and stops at the limit', () => {
    let selected = new Set<string>();
    for (let i = 0; i < MAX_ORIGINALS; i += 1) {
      selected = toggleOriginal(selected, `id-${i}`, true);
    }
    expect(selected.size).toBe(25);
    expect(toggleOriginal(selected, 'one-more', true)).toEqual(selected);
    const fewer = toggleOriginal(selected, 'id-3', false);
    expect(fewer.size).toBe(24);
    expect(fewer.has('id-3')).toBe(false);
    expect(selected.has('id-3')).toBe(true);
  });
});

describe('OriginalsPicker', () => {
  it('shows nothing without a candidate and without a selection', () => {
    const { container } = renderWithProviders(
      <OriginalsPicker
        rows={[rowDto()]}
        selected={new Set()}
        onChange={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the candidates with their enabler and takes a mark', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const row = pdfRow('1a.pdf');
    renderWithProviders(
      <OriginalsPicker rows={[row]} selected={new Set()} onChange={onChange} />
    );
    const group = screen.getByRole('group', {
      name: 'Originale für die Azubis bereitstellen',
    });
    expect(group).toBeInTheDocument();
    expect(screen.getByText('0 von 25 gewählt')).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: /1a\.pdf/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect([...onChange.mock.calls[0][0]]).toEqual([row.id]);
  });

  it('disables the other boxes at the limit, and a marked one can still be taken back', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const rows = Array.from({ length: 26 }, (_, i) => pdfRow(`f${i}.pdf`));
    const selected = new Set(rows.slice(0, 25).map(r => r.id));
    renderWithProviders(
      <OriginalsPicker rows={rows} selected={selected} onChange={onChange} />
    );
    expect(screen.getByText('25 von 25 gewählt')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /f25\.pdf/ })).toBeDisabled();
    const marked = screen.getByRole('checkbox', { name: /f3\.pdf/ });
    expect(marked).toBeChecked();
    await user.click(marked);
    expect(onChange.mock.calls[0][0].size).toBe(24);
  });

  it('keeps the count of a selection whose files are on another page', () => {
    renderWithProviders(
      <OriginalsPicker
        rows={[]}
        selected={new Set(['a', 'b'])}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByText('2 von 25 gewählt')).toBeInTheDocument();
  });

  it('is disabled while the run cannot be decided', () => {
    renderWithProviders(
      <OriginalsPicker
        rows={[pdfRow('1a.pdf')]}
        selected={new Set()}
        onChange={jest.fn()}
        disabled
      />
    );
    expect(screen.getByRole('checkbox', { name: /1a\.pdf/ })).toBeDisabled();
  });
});

describe('pruneOriginals and the clear button', () => {
  it('drops the ids of rows on the page that can no longer be marked, keeps the others', () => {
    const keep = pdfRow('keep.pdf');
    const gone = pdfRow('gone.pdf', { decision: null });
    const selected = new Set([keep.id, gone.id, 'on-another-page']);
    const next = pruneOriginals(selected, [keep, gone]);
    expect([...next].sort()).toEqual([keep.id, 'on-another-page'].sort());
    // nothing to drop: the same set comes back
    expect(pruneOriginals(next, [keep, gone])).toBe(next);
  });

  it('clears the whole choice, also the ids of other pages', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderWithProviders(
      <OriginalsPicker
        rows={[]}
        selected={new Set(['a', 'b'])}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
    expect(onChange.mock.calls[0][0].size).toBe(0);
  });
});
