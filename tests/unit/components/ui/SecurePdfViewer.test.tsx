import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { SecurePdfViewer } from '@/components/ui/SecurePdfViewer';
import { authFetch } from '@/lib/authFetch';
import { loadPdfjs } from '@/lib/pdf/pdfjs';

// The reading view of a trainee. jsdom cannot render a PDF, so pdf.js is replaced by a
// small double: the tests check what the viewer asks for (the route of the app, with the
// session) and the locks (no link, no frame, no context menu, no drag, no keys for saving
// and printing, nothing printed). The drawing itself is checked in a real browser.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/lib/pdf/pdfjs', () => ({
  __esModule: true,
  loadPdfjs: jest.fn(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const loadPdfjsMock = loadPdfjs as jest.MockedFunction<typeof loadPdfjs>;

const ROUTE = '/api/trainee/documents/d1/content';
const PAGES = 3;

const render = jest.fn();
const cancel = jest.fn();
const destroy = jest.fn();
const getDocument = jest.fn();

function fakePdfjs() {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: (...args: unknown[]) => {
      render(...args);
      return { promise: Promise.resolve(), cancel };
    },
  };
  getDocument.mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: PAGES,
      getPage: async () => page,
    }),
    destroy,
  }));
  return { getDocument } as any;
}

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer; // %PDF-

beforeEach(() => {
  jest.clearAllMocks();
  loadPdfjsMock.mockResolvedValue(fakePdfjs());
  authFetchMock.mockResolvedValue({
    ok: true,
    arrayBuffer: async () => bytes,
  } as any);
  // jsdom has no canvas
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation((() => ({})) as any);
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).fetch;
});

async function open(src = ROUTE) {
  const view = renderWithProviders(
    <SecurePdfViewer src={src} title="Lehrtext" />
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll('canvas')).toHaveLength(PAGES)
  );
  return view;
}

const root = (container: HTMLElement) =>
  container.querySelector('[data-testid="secure-pdf-viewer"]') as HTMLElement;

describe('SecurePdfViewer: where the bytes come from', () => {
  it('asks the route of the app with the session, and nothing else', async () => {
    const fetchSpy = jest.fn();
    (globalThis as any).fetch = fetchSpy;
    await open();
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock.mock.calls[0][0]).toBe(ROUTE);
    expect(fetchSpy).not.toHaveBeenCalled();
    // the bytes go to pdf.js as data, there is no address for pdf.js to fetch
    const params = getDocument.mock.calls[0][0];
    expect(params.data).toBeInstanceOf(Uint8Array);
    expect(params.url).toBeUndefined();
    expect(params.enableScripting).toBe(false);
  });

  it('refuses a source that is not a route of the trainee area', async () => {
    for (const src of [
      'https://files.example/doc.pdf',
      '/api/trainer/documents/d1/content',
      '//evil.test/a.pdf',
      '/api/trainee/../trainer/x',
      'blob:abc',
      '',
    ]) {
      authFetchMock.mockClear();
      const view = renderWithProviders(<SecurePdfViewer src={src} title="X" />);
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(authFetchMock).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('says so when the route does not deliver the document', async () => {
    authFetchMock.mockResolvedValue({ ok: false, status: 404 } as any);
    renderWithProviders(<SecurePdfViewer src={ROUTE} title="X" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Das Dokument konnte nicht geladen werden'
    );
  });

  it('says so when pdf.js cannot read the file', async () => {
    getDocument.mockImplementation(() => ({
      promise: Promise.reject(new Error('bad pdf')),
      destroy,
    }));
    loadPdfjsMock.mockResolvedValue({ getDocument } as any);
    renderWithProviders(<SecurePdfViewer src={ROUTE} title="X" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('SecurePdfViewer: what is on the page', () => {
  it('draws one canvas per page and has no link, no frame, no embedded file', async () => {
    const { container } = await open();
    expect(container.querySelectorAll('canvas')).toHaveLength(PAGES);
    await waitFor(() => expect(render).toHaveBeenCalledTimes(PAGES));
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('a[download]')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('embed')).toBeNull();
    expect(container.querySelector('object')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    // no address of a file anywhere in the page
    // (the namespace of the icons is the only address that is allowed)
    const html = container.innerHTML.replace(
      /http:\/\/www\.w3\.org\/2000\/svg/g,
      ''
    );
    expect(html).not.toMatch(/https?:|supabase|storage\/v1|blob:/);
  });

  it('shows the page count and moves between pages', async () => {
    await open();
    expect(screen.getByTestId('secure-pdf-page')).toHaveTextContent(
      'Seite 1 von 3'
    );
    fireEvent.click(screen.getByLabelText('Nächste Seite'));
    expect(screen.getByTestId('secure-pdf-page')).toHaveTextContent(
      'Seite 2 von 3'
    );
    fireEvent.click(screen.getByLabelText('Vorherige Seite'));
    expect(screen.getByTestId('secure-pdf-page')).toHaveTextContent(
      'Seite 1 von 3'
    );
    expect(screen.getByLabelText('Vorherige Seite')).toBeDisabled();
  });

  it('zooms with the buttons and with the keys + and -', async () => {
    const { container } = await open();
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Vergrößern (+)'));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.keyDown(root(container), { key: '-' });
    fireEvent.keyDown(root(container), { key: '-' });
    expect(screen.getByText('75%')).toBeInTheDocument();
    fireEvent.keyDown(root(container), { key: '+' });
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('frees the document when it is closed', async () => {
    const view = await open();
    view.unmount();
    expect(destroy).toHaveBeenCalled();
  });
});

describe('SecurePdfViewer: the locks', () => {
  it('blocks the context menu on the whole viewer, not only on the canvas', async () => {
    const { container } = await open();
    expect(fireEvent.contextMenu(root(container))).toBe(false);
    expect(fireEvent.contextMenu(container.querySelector('canvas')!)).toBe(
      false
    );
    expect(fireEvent.contextMenu(screen.getByLabelText('Nächste Seite'))).toBe(
      false
    );
  });

  it('blocks dragging, copying and cutting', async () => {
    const { container } = await open();
    const canvas = container.querySelector('canvas')!;
    expect(canvas.getAttribute('draggable')).toBe('false');
    expect(fireEvent.dragStart(canvas)).toBe(false);
    expect(fireEvent.dragStart(root(container))).toBe(false);
    expect(fireEvent.copy(root(container))).toBe(false);
    expect(fireEvent.cut(root(container))).toBe(false);
  });

  it('does not let the text be selected', async () => {
    const { container } = await open();
    expect(root(container).style.userSelect).toBe('none');
    expect(root(container).className).toContain('select-none');
    expect(container.querySelector('canvas')!.className).toContain(
      'select-none'
    );
  });

  it('catches the keys for saving and printing', async () => {
    const { container } = await open();
    const target = container.querySelector('canvas')!;
    const keys: Array<Record<string, unknown>> = [
      { key: 's', ctrlKey: true },
      { key: 'S', ctrlKey: true, shiftKey: true },
      { key: 'p', ctrlKey: true },
      { key: 'P', ctrlKey: true, shiftKey: true },
      { key: 's', metaKey: true },
      { key: 'p', metaKey: true },
    ];
    for (const key of keys) {
      expect(fireEvent.keyDown(target, key)).toBe(false);
    }
  });

  it('leaves the other keys alone', async () => {
    const { container } = await open();
    const target = container.querySelector('canvas')!;
    expect(fireEvent.keyDown(target, { key: 's' })).toBe(true);
    expect(fireEvent.keyDown(target, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(target, { key: 'c', ctrlKey: true })).toBe(true);
  });

  it('prints nothing', async () => {
    const { container } = await open();
    expect(root(container).className).toContain('print:hidden');
  });
});
