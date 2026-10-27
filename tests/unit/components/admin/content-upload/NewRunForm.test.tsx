import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../helpers/renderWithProviders';
import { NewRunForm } from '@/components/admin/content-upload/NewRunForm';
import { UploadApiError } from '@/lib/content-upload/staging/client';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    createRun: jest.fn(async () => ({ run: { id: 'run-1' } })),
    uploadFiles: jest.fn(),
    getRun: jest.fn(),
    processRun: jest.fn(),
    ...overrides,
  } as any;
}

const label = () => screen.getByLabelText(/Bezeichnung/);
const declaration = () =>
  screen.getByRole('checkbox', { name: /eigenes Lehrmaterial/ });
const ki = () => screen.getByRole('checkbox', { name: /an Sokrates senden/ });

beforeEach(() => push.mockClear());

describe('NewRunForm', () => {
  it('has the fields of the concept: name, occupation, declaration and the opt in for the model', () => {
    renderWithProviders(<NewRunForm client={fakeClient()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Neuer Lauf' })
    ).toBeInTheDocument();
    expect(label()).toBeRequired();
    const catalog = screen.getByLabelText(/Beruf/) as HTMLSelectElement;
    expect(catalog).toBeDisabled();
    expect(catalog.value).toBe('KFBM');
    expect(
      screen.getByText('In Version 1 ist nur KfBM möglich.')
    ).toBeInTheDocument();
    expect(declaration()).not.toBeChecked();
    expect(declaration()).toBeRequired();
    expect(
      screen.getByText(
        /Die Dateien sind eigenes Lehrmaterial und enthalten keine Kundendokumente/
      )
    ).toBeInTheDocument();
    // the opt in is on by default, as the concept says, and tells that it does nothing yet
    expect(ki()).toBeChecked();
    expect(ki()).toHaveAccessibleDescription(/noch nicht verfügbar/);
    expect(
      screen.getByRole('link', { name: 'Zurück zu den Läufen' })
    ).toHaveAttribute('href', '/trainer/admin/content-upload');
  });

  it('does not create a run without a name and without the declaration, and says what is missing', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderWithProviders(<NewRunForm client={client} />);
    await user.click(screen.getByRole('button', { name: 'Lauf anlegen' }));
    expect(client.createRun).not.toHaveBeenCalled();
    expect(label()).toHaveAttribute('aria-invalid', 'true');
    expect(label()).toHaveAccessibleDescription(
      /Bezeichnung mit 1 bis 120 Zeichen/
    );
    expect(declaration()).toHaveAttribute('aria-invalid', 'true');
    expect(declaration()).toHaveAccessibleDescription(/eigenes Lehrmaterial/);
  });

  it('does not take a name of only blanks', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderWithProviders(<NewRunForm client={client} />);
    await user.type(label(), '    ');
    await user.click(declaration());
    await user.click(screen.getByRole('button', { name: 'Lauf anlegen' }));
    expect(client.createRun).not.toHaveBeenCalled();
  });

  it('creates the run with the name and the opt in, then shows the choice of the files', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderWithProviders(<NewRunForm client={client} />);
    await user.type(label(), '  KfBM Teil 2 Wahl  ');
    await user.click(declaration());
    await user.click(ki());
    await user.click(screen.getByRole('button', { name: 'Lauf anlegen' }));
    await waitFor(() =>
      expect(client.createRun).toHaveBeenCalledWith({
        label: 'KfBM Teil 2 Wahl',
        kiEnabled: false,
      })
    );
    expect(
      await screen.findByText(
        'Der Lauf ist angelegt. Wählen Sie jetzt die Dateien.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Dateien hochladen' })
    ).toBeInTheDocument();
    // the data of the run cannot be changed any more
    expect(label()).toBeDisabled();
    expect(declaration()).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Lauf anlegen' })
    ).not.toBeInTheDocument();
  });

  it('goes to the review page of the run when the upload and the queue are done', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      uploadFiles: jest.fn(async () => ({
        announced: 1,
        merged: 0,
        existing: 0,
        alreadyPast: 0,
        rejected: [],
        uploaded: 1,
        failed: [],
        warnings: [],
      })),
      getRun: jest.fn(async () => ({
        run: {},
        progress: { counts: {}, totalFiles: 0, totalBytes: 0 },
        limits: {},
      })),
      processRun: jest.fn(async () => ({ done: true })),
    });
    renderWithProviders(<NewRunForm client={client} />);
    await user.type(label(), 'Lauf');
    await user.click(declaration());
    await user.click(screen.getByRole('button', { name: 'Lauf anlegen' }));
    await screen.findByRole('heading', { name: 'Dateien hochladen' });
    await user.upload(
      screen.getByTestId('files-input'),
      new File(['x'], 'a.docx')
    );
    await user.click(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/trainer/admin/content-upload/run-1')
    );
  });

  it.each([
    [
      new UploadApiError(429, 'x', 'TOO_MANY_ACTIVE_RUNS'),
      'schon drei Läufe aktiv',
    ],
    [new UploadApiError(429, 'x', 'RATE_LIMITED'), 'Zu viele Anfragen'],
    [new UploadApiError(404, 'x'), 'in dieser Umgebung nicht verfügbar'],
    [
      new UploadApiError(400, 'x', 'LABEL_INVALID'),
      'Bezeichnung mit 1 bis 120 Zeichen',
    ],
    [
      new UploadApiError(400, 'x', 'DECLARATION_REQUIRED'),
      'eigenes Lehrmaterial',
    ],
    [new Error('network'), 'konnte nicht angelegt werden'],
  ])('tells in words what went wrong (%#)', async (error, text) => {
    const user = userEvent.setup();
    const client = fakeClient({
      createRun: jest.fn(async () => {
        throw error;
      }),
    });
    renderWithProviders(<NewRunForm client={client} />);
    await user.type(label(), 'Lauf');
    await user.click(declaration());
    await user.click(screen.getByRole('button', { name: 'Lauf anlegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    // the form stays as it was, nothing is lost
    expect(label()).toHaveValue('Lauf');
    expect(screen.getByRole('button', { name: 'Lauf anlegen' })).toBeEnabled();
  });

  it('cannot be submitted twice while the run is being created', async () => {
    const user = userEvent.setup();
    let release!: (value: unknown) => void;
    const client = fakeClient({
      createRun: jest.fn(
        () =>
          new Promise(resolve => {
            release = resolve;
          })
      ),
    });
    renderWithProviders(<NewRunForm client={client} />);
    await user.type(label(), 'Lauf');
    await user.click(declaration());
    await user.click(screen.getByRole('button', { name: 'Lauf anlegen' }));
    const busy = screen.getByRole('button', { name: 'Lauf wird angelegt...' });
    expect(busy).toBeDisabled();
    release({ run: { id: 'run-1' } });
    await screen.findByText(/Der Lauf ist angelegt/);
    expect(client.createRun).toHaveBeenCalledTimes(1);
  });
});
