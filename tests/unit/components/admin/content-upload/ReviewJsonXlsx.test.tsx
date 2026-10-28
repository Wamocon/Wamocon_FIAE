import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ReviewView } from '@/components/admin/content-upload/ReviewView';
import { RunUploader } from '@/components/admin/content-upload/RunUploader';

import { renderWithProviders } from '../../../../helpers/renderWithProviders';
import {
  fakeClient,
  listResponse,
  rowDto,
  uuid,
} from '../../../../helpers/reviewUi';

// The review rows of a quiz JSON file and of the Excel mapping file (package UP2): what the
// page says about them, and that there is nothing to assign (they name their own codes).

const RUN = uuid(900);

const NO_CODES = {
  docType: 'quiz',
  componentCode: null,
  enablerCode: null,
  quizLevel: null,
};

const jsonRow = (over: Record<string, unknown> = {}) =>
  rowDto({
    fileName: 'enabler-quizze.json',
    ext: 'json',
    effective: NO_CODES,
    derived: null,
    contents: {
      kind: 'quiz_json',
      variant: 'lesson',
      numbers: { quizzes: 12, sets: 36, questions: 360, setsWithErrors: 0 },
    },
    ...over,
  });

const xlsxRow = () =>
  rowDto({
    fileName: 'Zuordnung.xlsx',
    ext: 'xlsx',
    effective: { ...NO_CODES, docType: 'other' },
    derived: null,
    contents: {
      kind: 'mapping_xlsx',
      variant: null,
      numbers: { positions: 71, blocks: 25 },
    },
  });

async function open(rows: ReturnType<typeof rowDto>[]) {
  const client = fakeClient();
  client.review.mockResolvedValue(listResponse(rows));
  const user = userEvent.setup();
  renderWithProviders(
    <ReviewView
      runId={RUN}
      client={client}
      uploadClient={
        {
          getRun: jest.fn(),
          processRun: jest.fn(),
          uploadFiles: jest.fn(),
          discardRun: jest.fn(),
        } as never
      }
    />
  );
  await screen.findByRole('table');
  return { client, user, rows };
}

const rowOf = (name: string) =>
  screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;

describe('the review of a JSON and an Excel file', () => {
  it('describes a quiz file by what it holds, in numbers', async () => {
    await open([
      jsonRow(),
      jsonRow({
        fileName: 'global.json',
        contents: {
          kind: 'quiz_json',
          variant: 'global',
          numbers: { quizzes: 5, sets: 5, questions: 100 },
        },
      }),
    ]);
    const lesson = within(rowOf('enabler-quizze.json'));
    expect(
      lesson.getByText(
        'Enabler-Quizze (JSON-Datei), 12 Quizze, 36 Sätze, 360 Fragen'
      )
    ).toBeInTheDocument();
    expect(
      within(rowOf('global.json')).getByText(
        'Global-Quizze (JSON-Datei), 5 Quizze, 5 Sätze, 100 Fragen'
      )
    ).toBeInTheDocument();
    // no component, enabler or level is invented for it
    expect(lesson.queryByText(/K1-a|leicht/)).toBeNull();
  });

  it('describes the mapping table by its positions and blocks', async () => {
    await open([xlsxRow()]);
    expect(
      within(rowOf('Zuordnung.xlsx')).getByText(
        'Lernfeld-Zuordnung (Excel-Datei), 71 Positionen in 25 Komponentenblöcken'
      )
    ).toBeInTheDocument();
  });

  it('accepts a quiz file with one click, without an assignment', async () => {
    const { user, client, rows } = await open([jsonRow()]);
    await user.click(
      within(
        screen.getByRole('group', {
          name: 'Entscheidung für enabler-quizze.json',
        })
      ).getByRole('button', { name: 'Übernehmen' })
    );
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'set',
      items: [
        { fileId: rows[0].id, action: 'accept', assignment: null, note: null },
      ],
    });
  });

  it('shows no editor for the assignment, only the reasons and a note that there is nothing to assign', async () => {
    const { user } = await open([jsonRow(), xlsxRow()]);
    for (const [name, note] of [
      [
        'enabler-quizze.json',
        /Komponente, Enabler und Stufe stehen in den Kennungen/,
      ],
      ['Zuordnung.xlsx', /Übernommen werden nur fehlende Lernfelder/],
    ] as const) {
      await user.click(
        screen.getByRole('button', { name: `Details zu ${name} anzeigen` })
      );
      const hide = screen.getByRole('button', {
        name: `Details zu ${name} ausblenden`,
      });
      const details = document.getElementById(
        hide.getAttribute('aria-controls')!
      )!;
      expect(within(details).getByTestId('fixed-kind-note')).toHaveTextContent(
        note
      );
      expect(within(details).queryByRole('combobox')).toBeNull();
      expect(
        within(details).queryByRole('button', { name: /Zuordnung speichern/ })
      ).toBeNull();
    }
  });

  it('says how many sets with errors are skipped', async () => {
    const { user } = await open([
      jsonRow({
        contents: {
          kind: 'quiz_json',
          variant: 'lesson',
          numbers: { quizzes: 12, sets: 36, questions: 360, setsWithErrors: 3 },
        },
      }),
    ]);
    await user.click(
      screen.getByRole('button', {
        name: 'Details zu enabler-quizze.json anzeigen',
      })
    );
    expect(
      screen.getByText(
        'Sätze mit Fehlern: 3. Sie werden bei der Übernahme übersprungen.'
      )
    ).toBeInTheDocument();
  });

  it('keeps the editor of a Word file as it was', async () => {
    const { user } = await open([rowDto({ fileName: 'A_Quiz.docx' })]);
    await user.click(
      screen.getByRole('button', { name: 'Details zu A_Quiz.docx anzeigen' })
    );
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
  });

  it('shows the code of a refused file in words', async () => {
    await open([
      rowDto({
        band: null,
        fileName: 'kaputt.json',
        ext: 'json',
        statusCode: 'NOT_QUIZ_JSON',
      }),
      rowDto({
        band: null,
        fileName: 'bombe.xlsx',
        ext: 'xlsx',
        statusCode: 'ZIP_BOMB',
      }),
    ]);
    expect(
      within(rowOf('kaputt.json')).getByText(
        'Die JSON-Datei ist keine Quiz-Datei (Schema 1.0).'
      )
    ).toBeInTheDocument();
    expect(
      within(rowOf('bombe.xlsx')).getByText(
        'Die Datei entpackt sich zu weit mehr, als sie enthält, und wird nicht verarbeitet.'
      )
    ).toBeInTheDocument();
  });
});

describe('the uploader and the limits of the kinds', () => {
  function file(name: string, size: number) {
    const f = new File(['x'], name);
    Object.defineProperty(f, 'size', { value: size });
    return f;
  }
  const MB = 1024 * 1024;

  it('takes a JSON file up to 32 MB, an Excel file up to 5 MB and says how many are too large', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RunUploader
        runId="r1"
        onFinished={jest.fn()}
        client={
          {
            uploadFiles: jest.fn(),
            getRun: jest.fn(),
            processRun: jest.fn(),
          } as never
        }
      />
    );
    await user.upload(screen.getByTestId('files-input'), [
      file('a.json', 31 * MB),
      file('b.json', 33 * MB),
      file('c.xlsx', 4 * MB),
      file('d.xlsx', 6 * MB),
      file('e.docx', 26 * MB),
      file('f.pdf', 24 * MB),
    ]);
    expect(screen.getByTestId('selection')).toHaveTextContent(
      '6 Dateien gewählt'
    );
    expect(
      screen.getByText(
        '3 Dateien sind größer als erlaubt und werden abgelehnt.'
      )
    ).toBeInTheDocument();
  });
});
