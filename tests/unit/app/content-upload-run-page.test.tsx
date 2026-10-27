import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';

// The page of one run. The id of the run comes from the address and goes into the
// path of requests that carry the token of the person, so anything that is no uuid
// is no run and never reaches a request.

let params: Record<string, unknown> = {};
jest.mock('next/navigation', () => ({
  useParams: () => params,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/admin/content-upload/AccessGate', () => ({
  AccessGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/admin/content-upload/ReviewView', () => ({
  ReviewView: ({ runId }: { runId: string }) => <p>review of {runId}</p>,
}));

import Page from '@/app/trainer/admin/content-upload/[runId]/page';

const ID = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';

describe('the page of a run', () => {
  it('opens the review for the id of a run', () => {
    params = { runId: ID };
    renderWithProviders(<Page />);
    expect(screen.getByText(`review of ${ID}`)).toBeInTheDocument();
  });

  it('takes the first segment when the router hands over a list', () => {
    params = { runId: [ID, 'x'] };
    renderWithProviders(<Page />);
    expect(screen.getByText(`review of ${ID}`)).toBeInTheDocument();
  });

  it.each([
    ['a path of another route', '../../x/pump'],
    ['text', 'nope'],
    ['a uuid with a tail', `${ID}/review`],
    ['nothing', undefined],
  ])('shows "not found" and no review for %s', (_name, value) => {
    params = { runId: value };
    renderWithProviders(<Page />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Dieser Lauf wurde nicht gefunden.'
    );
    expect(screen.queryByText(/review of/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zurück zu den Läufen' })
    ).toHaveAttribute('href', '/trainer/admin/content-upload');
  });
});
