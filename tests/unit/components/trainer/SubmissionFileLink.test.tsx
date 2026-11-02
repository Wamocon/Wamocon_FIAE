import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { SubmissionFileLink } from '@/components/trainer/SubmissionFileLink';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { readLinkAnswers } from '@/lib/submission-file/readLink';

// "Anhang öffnen" on the review page (WMCNL-2998). The read link of the storage is
// opened by navigating to it. When the storage refused it (503), the request failed in
// the background and nothing happened on the page. The link is tried first, and a link
// that does not answer shows the message.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/lib/hooks/useApiQuery');
jest.mock('@/lib/submission-file/readLink', () => ({
  __esModule: true,
  readLinkAnswers: jest.fn(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;
const probe = readLinkAnswers as jest.MockedFunction<typeof readLinkAnswers>;

const LINK = 'https://proj.supabase.co/storage/v1/object/sign/x?token=t';
const assign = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  useApiQueryMock.mockReturnValue({
    data: { enabled: true },
    isLoading: false,
    error: null,
  } as any);
  authFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ file: { url: LINK } }),
  } as any);
  probe.mockResolvedValue(true);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});

const click = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Anhang öffnen' }));

describe('SubmissionFileLink', () => {
  it('opens the read link when the storage answers it', async () => {
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    click();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(LINK));
    expect(probe).toHaveBeenCalledWith(LINK);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when the storage refuses the link (503), and does not navigate', async () => {
    probe.mockResolvedValue(false);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    click();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Der Anhang konnte nicht geladen werden.'
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('says so when the route of the app answers with 503', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: 'STORAGE_ERROR' }),
    } as any);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    click();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(probe).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('says that there is no attachment, without trying a link', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ file: null }),
    } as any);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    click();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Es ist kein Anhang vorhanden.'
    );
    expect(probe).not.toHaveBeenCalled();
  });
});
