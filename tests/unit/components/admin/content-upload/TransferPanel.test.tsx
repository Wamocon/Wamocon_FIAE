import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../helpers/renderWithProviders';
import { ReviewView } from '@/components/admin/content-upload/ReviewView';
import { TransferPanel } from '@/components/admin/content-upload/TransferPanel';
import { UploadApiError } from '@/lib/content-upload/staging/client';
import type { TransferReport } from '@/lib/content-upload/transfer/types';
import {
  fakeClient,
  listResponse,
  rowDto,
  uuid,
} from '../../../../helpers/reviewUi';

const RUN = uuid(900);

const upload = () =>
  ({
    getRun: jest.fn(),
    processRun: jest.fn(async () => ({ done: true })),
    uploadFiles: jest.fn(),
    discardRun: jest.fn(),
  }) as any;

const stock = (patch: Partial<TransferReport['stock']['counts']> = {}) => ({
  counts: {
    conflict: 0,
    differs: 0,
    extended: 0,
    new: 0,
    unchanged: 0,
    ...patch,
  },
  files: [] as TransferReport['stock']['files'],
});

function report(patch: Partial<TransferReport> = {}): TransferReport {
  return {
    mode: 'dry_run',
    status: 'ok',
    applyId: 'attempt-1',
    decisionsHash: 'abcdef0123456789'.repeat(4),
    decisionsVersion: 0,
    replaceFiles: [],
    stock: stock({ new: 2, extended: 1 }),
    extended: [{ quiz: 'K1-a-low', added: 2, moved: 1 }],
    tables: {
      enablers: { insert: 2, update: 0, unchanged: 0 },
      questions: { insert: 2, update: 0, unchanged: 8 },
    },
    conflicts: [],
    differences: [],
    skipped: [],
    excluded: [{ fileId: uuid(1), code: 'REJECTED', reason: 'x' }],
    useCasesSkippedInDb: [],
    originals: { published: 0, refused: [] },
    wrote: false,
    readyToApply: true,
    ...patch,
  };
}

const differing = (id: string, name: string) => ({
  fileId: id,
  fileName: name,
  status: 'differs' as const,
  added: 0,
  moved: 0,
});

function mount(
  props: Partial<React.ComponentProps<typeof TransferPanel>> = {},
  client = fakeClient()
) {
  const onChanged = jest.fn();
  const user = userEvent.setup();
  const view = renderWithProviders(
    <TransferPanel
      runId={RUN}
      status="review"
      version={3}
      accepted={4}
      client={client}
      onChanged={onChanged}
      {...props}
    />
  );
  return { client, onChanged, user, view };
}

const dryRunButton = () =>
  screen.getByRole('button', { name: 'Probelauf starten' });
const applyButton = () =>
  screen.getByRole('button', { name: 'In den Katalog übernehmen' });

describe('TransferPanel: the dry run', () => {
  it('starts only with accepted files and shows what the dry run found', async () => {
    const client = fakeClient();
    client.dryRun.mockResolvedValue(report());
    const { user, onChanged } = mount({}, client);
    expect(applyButton()).toBeDisabled();
    await user.click(dryRunButton());
    expect(client.dryRun).toHaveBeenCalledWith(RUN, { replaceFiles: [] });
    expect(
      await screen.findByText(/Gültig für den Entscheidungsstand 3/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Prüfsumme abcdef012345/)).toBeInTheDocument();
    expect(
      screen.getByText('Keine Konflikte. Die Übernahme ist möglich.')
    ).toBeInTheDocument();
    // the counts per status of the files and per table
    const statuses = screen.getByText('Dateien nach Bestand').parentElement!;
    expect(within(statuses).getByText('Neu').parentElement).toHaveTextContent(
      '2'
    );
    expect(
      within(statuses).getByText('Ergänzt').parentElement
    ).toHaveTextContent('1');
    expect(
      screen.getByRole('table', { name: /Zeilen je Tabelle/ })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 Fragen werden ergänzt, 1 bestehende Fragen rücken/)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 ×/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(applyButton()).toBeEnabled();
  });

  it('does not start without an accepted file', () => {
    mount({ accepted: 0 });
    expect(dryRunButton()).toBeDisabled();
    expect(screen.getByText(/Noch keine Datei angenommen/)).toBeInTheDocument();
  });

  it('does not allow the apply when the dry run has conflicts', async () => {
    const client = fakeClient();
    client.dryRun.mockResolvedValue(
      report({
        status: 'conflict',
        readyToApply: false,
        conflicts: [
          {
            table: 'quizzes',
            key: 'K1-a-low',
            reason: 'The quiz exists as GLOBAL',
          },
        ],
        stock: stock({ conflict: 1 }),
      })
    );
    const { user } = mount({}, client);
    await user.click(dryRunButton());
    expect(
      await screen.findByText(/1 Konflikte zwischen den Dateien/)
    ).toBeInTheDocument();
    expect(screen.getByText(/quizzes K1-a-low/)).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
  });

  it('says a dry run is no longer valid after a decision changed', async () => {
    const client = fakeClient();
    client.dryRun.mockResolvedValue(report());
    const { user, view } = mount({}, client);
    await user.click(dryRunButton());
    await screen.findByText(/Gültig für/);
    view.rerender(
      <TransferPanel
        runId={RUN}
        status="review"
        version={4}
        accepted={4}
        client={client}
        onChanged={jest.fn()}
      />
    );
    expect(
      screen.getByText(/Der Probelauf gilt nicht mehr/)
    ).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
  });

  it.each([
    [409, 'DRY_RUN_REQUIRED', /Probelauf ohne Konflikt/],
    [409, 'IMPORT_LOCKED', /andere Übernahme/],
    [422, 'PLAN_TOO_LARGE', /weniger Dateien/],
    [503, 'BUSY', /ausgelastet/],
    [500, 'COMMIT_UNCERTAIN', /unsicher/],
    [503, undefined, /nicht erreichbar oder ausgelastet/],
    [418, 'UNKNOWN', /Die Aktion ist fehlgeschlagen/],
  ])('explains %s %s in German', async (status, code, text) => {
    const client = fakeClient();
    client.dryRun.mockRejectedValue(new UploadApiError(status, 'x', code));
    const { user } = mount({}, client);
    await user.click(dryRunButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});

describe('TransferPanel: replacing what differs', () => {
  it('replaces nothing by default and only the files that are ticked', async () => {
    const client = fakeClient();
    const files = [
      differing(uuid(11), 'A.docx'),
      differing(uuid(12), 'B.docx'),
    ];
    client.dryRun.mockResolvedValue(
      report({ stock: { ...stock({ differs: 2 }), files } })
    );
    const { user } = mount({}, client);
    await user.click(dryRunButton());
    const first = await screen.findByRole('checkbox', {
      name: 'Bestehende Zeilen für A.docx aktualisieren',
    });
    const second = screen.getByRole('checkbox', {
      name: 'Bestehende Zeilen für B.docx aktualisieren',
    });
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
    // a choice makes the dry run invalid: a new one is needed
    await user.click(second);
    expect(
      screen.getByText(/Die Auswahl der zu ersetzenden Dateien/)
    ).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    client.dryRun.mockResolvedValue(
      report({
        stock: { ...stock({ differs: 2 }), files },
        replaceFiles: [uuid(12)],
      })
    );
    await user.click(dryRunButton());
    await waitFor(() =>
      expect(client.dryRun).toHaveBeenLastCalledWith(RUN, {
        replaceFiles: [uuid(12)],
      })
    );
    await waitFor(() => expect(applyButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Keine wählen' }));
    expect(
      screen.getByText(/Die Auswahl der zu ersetzenden Dateien/)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alle wählen' }));
    expect(
      screen.getByRole('checkbox', {
        name: 'Bestehende Zeilen für A.docx aktualisieren',
      })
    ).toBeChecked();
  });
});

describe('TransferPanel: the apply', () => {
  async function readyToApply(client = fakeClient()) {
    client.dryRun.mockResolvedValue(report());
    const mounted = mount({}, client);
    await mounted.user.click(dryRunButton());
    await screen.findByText(/Gültig für/);
    await mounted.user.click(applyButton());
    return { ...mounted, client };
  }

  it('asks for the catalog code, typed exactly, before it sends anything', async () => {
    const client = fakeClient();
    client.apply.mockResolvedValue(
      report({ mode: 'apply', wrote: true, readyToApply: false })
    );
    const { user, onChanged } = await readyToApply(client);
    const dialog = await screen.findByRole('dialog', {
      name: 'Übernahme bestätigen',
    });
    const confirm = within(dialog).getByRole('button', {
      name: 'Jetzt übernehmen',
    });
    expect(confirm).toBeDisabled();
    const field = within(dialog).getByLabelText(/Katalogcode KFBM/);
    await user.type(field, 'kfbm');
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, 'KFBM');
    expect(confirm).toBeEnabled();
    expect(client.apply).not.toHaveBeenCalled();
    await user.click(confirm);
    expect(client.apply).toHaveBeenCalledWith(RUN, {
      replaceFiles: [],
      confirm: 'KFBM',
    });
    expect(
      await screen.findByText('Übernahme abgeschlossen')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/4 Zeilen neu angelegt, 0 aktualisiert/)
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    // a finished apply needs a new dry run
    expect(applyButton()).toBeDisabled();
  });

  it('closes with Escape and sends nothing', async () => {
    const { user, client } = await readyToApply();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.apply).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'DRY_RUN_REQUIRED', /Probelauf ohne Konflikt/],
    [409, 'RUN_STATE', /nicht in der Prüfung/],
    [503, 'BUSY', /Es wurde nichts geschrieben/],
    [500, 'COMMIT_UNCERTAIN', /Wiederholen Sie sie nicht/],
  ])(
    'explains the failure %s %s and drops the dry run where it is void',
    async (status, code, text) => {
      const client = fakeClient();
      client.apply.mockRejectedValue(new UploadApiError(status, 'x', code));
      const { user } = await readyToApply(client);
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText(/Katalogcode/), 'KFBM');
      await user.click(
        within(dialog).getByRole('button', { name: 'Jetzt übernehmen' })
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      if (['DRY_RUN_REQUIRED', 'RUN_STATE'].includes(code)) {
        expect(applyButton()).toBeDisabled();
      }
    }
  );

  it('shows the conflicts of an apply that found some', async () => {
    const client = fakeClient();
    client.apply.mockResolvedValue(
      report({
        mode: 'apply',
        status: 'conflict',
        readyToApply: false,
        conflicts: [
          { table: 'enablers', key: 'K1-a', reason: 'exists elsewhere' },
        ],
        stock: stock({ conflict: 1 }),
      })
    );
    const { user } = await readyToApply(client);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Katalogcode/), 'KFBM');
    await user.click(
      within(dialog).getByRole('button', { name: 'Jetzt übernehmen' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/Konflikte/);
    expect(applyButton()).toBeDisabled();
  });
});

describe('TransferPanel: the rollback', () => {
  const answer = (patch = {}) => ({
    applyId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    startedAt: '2026-10-27T10:00:00.000Z',
    sql: 'begin;\n-- rollback text\nrollback;',
    deletes: { enablers: 2, quizzes: 1 },
    restores: { enablers: 1 },
    blockers: [],
    notes: ['A note of the server.'],
    objectPaths: [],
    ...patch,
  });

  it('only shows up for an applied run', () => {
    mount({ status: 'review' });
    expect(screen.queryByText('Rückbau')).not.toBeInTheDocument();
  });

  it('saves the SQL as a file, with the hint that it is run by hand', async () => {
    const client = fakeClient();
    client.rollbackSql.mockResolvedValue(answer() as any);
    const created: Blob[] = [];
    const saved: string[] = [];
    (URL as any).createObjectURL = jest.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:fake';
    });
    (URL as any).revokeObjectURL = jest.fn();
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        saved.push(this.download);
      });
    const { user } = mount({ status: 'applied' }, client);
    await user.click(
      screen.getByRole('button', { name: 'Rückbau-SQL erstellen' })
    );
    expect(
      await screen.findByText(/löscht 3 Zeilen und stellt 1 Zeilen/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nicht automatisch ausgeführt/)
    ).toBeInTheDocument();
    // the text itself is not shown on the page
    expect(screen.queryByText(/rollback text/)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Rückbau-SQL als Datei speichern' })
    );
    expect(saved).toEqual([`rueckbau-${RUN.slice(0, 8)}-aaaaaaaa.sql`]);
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]);
    });
    expect(text).toContain('rollback text');
    click.mockRestore();
  });

  it('names what stands in the way instead of a file', async () => {
    const client = fakeClient();
    client.rollbackSql.mockResolvedValue(
      answer({
        sql: null,
        blockers: [{ code: 'ACTIVATED_CONTENT', message: 'x' }],
      }) as any
    );
    const { user } = mount({ status: 'applied' }, client);
    await user.click(
      screen.getByRole('button', { name: 'Rückbau-SQL erstellen' })
    );
    expect(
      await screen.findByText(/aktiv oder veröffentlicht/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Rückbau-SQL als Datei speichern' })
    ).not.toBeInTheDocument();
  });

  it('explains a missing apply', async () => {
    const client = fakeClient();
    client.rollbackSql.mockRejectedValue(
      new UploadApiError(404, 'x', 'NO_APPLY')
    );
    const { user } = mount({ status: 'applied' }, client);
    await user.click(
      screen.getByRole('button', { name: 'Rückbau-SQL erstellen' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /keine Übernahme/
    );
  });
});

describe('ReviewView with the supply of content', () => {
  const rows = () => [
    rowDto({
      band: 'high',
      fileName: 'A_Quiz.docx',
      stock: {
        status: 'extended',
        added: 2,
        at: '2026-10-27T10:00:00Z',
        stale: false,
      },
    }),
    rowDto({
      band: 'high',
      fileName: 'B_Text.docx',
      stock: {
        status: 'new',
        added: 0,
        at: '2026-10-27T10:00:00Z',
        stale: false,
      },
    }),
    rowDto({
      band: 'medium',
      fileName: 'C_Szenario.docx',
      stock: {
        status: 'differs',
        added: 0,
        at: '2026-10-27T10:00:00Z',
        stale: true,
      },
    }),
    rowDto({ band: 'medium', fileName: 'D_Rest.docx' }),
  ];
  const counts = {
    stock: {
      conflict: 0,
      differs: 0,
      extended: 1,
      new: 1,
      unchanged: 0,
      none: 2,
    },
    acceptableStock: 2,
    mediumGroups: [
      { key: 'NEW_IN_PLAN', text: 'Die Komponente ist neu im Plan.', count: 2 },
    ],
  };

  async function open(client = fakeClient()) {
    client.review.mockResolvedValue(listResponse(rows(), { counts }));
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewView runId={RUN} client={client} uploadClient={upload()} />
    );
    await screen.findByRole('table');
    return { client, user };
  }

  it('shows the status of the supply as a column, stale and missing ones as such', async () => {
    await open();
    const cell = (name: string) =>
      screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;
    expect(within(cell('A_Quiz')).getByText('Ergänzt')).toBeInTheDocument();
    expect(
      within(cell('A_Quiz')).getByText('2 Fragen mehr')
    ).toBeInTheDocument();
    expect(within(cell('B_Text')).getByText('Neu')).toBeInTheDocument();
    expect(
      within(cell('C_Szenario')).getByText(/Veraltet/)
    ).toBeInTheDocument();
    expect(
      within(cell('D_Rest')).getByText('Nicht abgeglichen')
    ).toBeInTheDocument();
  });

  it('filters by the status of the supply with chips that carry the counts', async () => {
    const { client, user } = await open();
    const group = screen.getByRole('group', { name: 'Filter nach Bestand' });
    await user.click(within(group).getByRole('button', { name: /Ergänzt/ }));
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      expect.objectContaining({ stock: 'extended' }),
      expect.any(AbortSignal)
    );
    expect(
      within(group).getByRole('button', { name: /Nicht abgeglichen/ })
    ).toHaveTextContent('2');
  });

  it('compares with the stock and says what it found', async () => {
    const client = fakeClient();
    client.compare.mockResolvedValue({
      stock: {
        counts: { conflict: 0, differs: 1, extended: 2, new: 3, unchanged: 4 },
        files: [],
      },
      compared: 10,
      excluded: [],
      stored: 10,
    });
    const { user } = await open(client);
    await user.click(
      screen.getByRole('button', { name: 'Bestand abgleichen' })
    );
    expect(
      await screen.findByText(
        'Abgleich fertig, 10 Dateien: 3 neu, 2 ergänzt, 1 abweichend, 4 unverändert, 0 Konflikt.'
      )
    ).toBeInTheDocument();
    // the list is read again
    await waitFor(() =>
      expect(client.review.mock.calls.length).toBeGreaterThan(1)
    );
  });

  it('asks before it takes the new and added files, and sends the command', async () => {
    const client = fakeClient();
    const { user } = await open(client);
    await user.click(
      screen.getByRole('button', {
        name: 'Neues und Ergänzungen übernehmen (2)',
      })
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('2 Dateien werden angenommen');
    await user.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
        command: 'accept_stock',
      })
    );
  });

  it('confirms the likely proposals of one group of reasons', async () => {
    const client = fakeClient();
    const { user } = await open(client);
    await user.selectOptions(
      screen.getByLabelText('Wahrscheinliche mit gleicher Begründung'),
      'NEW_IN_PLAN'
    );
    await user.click(screen.getByRole('button', { name: 'Alle 2 bestätigen' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Die Komponente ist neu im Plan.');
    await user.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
        command: 'accept_medium',
        group: 'NEW_IN_PLAN',
      })
    );
  });

  it('shows the transfer panel under the list', async () => {
    await open();
    expect(
      screen.getByRole('heading', { name: 'Übernahme', level: 2 })
    ).toBeInTheDocument();
  });
});
