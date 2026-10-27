import { cloneElement, useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useCatalog } from '@/contexts/CatalogContext';
import { usePathname } from 'next/navigation';

jest.mock('next/navigation', () => ({ usePathname: jest.fn() }));
jest.mock('@/contexts/CatalogContext');
jest.mock('@/components/layout/Header', () => ({ Header: () => null }));
jest.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/catalog/CatalogTabs', () => ({
  CatalogTabs: () => <div data-testid="tabs" />,
}));

const mounts = jest.fn();
function Page() {
  useEffect(() => {
    mounts();
  }, []);
  return <p>page</p>;
}

function renderLayout(
  path: string,
  userRole: 'trainer' | 'trainee',
  tabs: unknown[],
  epoch = 0
) {
  (usePathname as jest.Mock).mockReturnValue(path);
  (useCatalog as jest.Mock).mockReturnValue({ tabs, epoch });
  const ui = (
    <MainLayout
      profile={null}
      onGoBack={() => {}}
      sidebarOpen={false}
      onToggleSidebar={() => {}}
      userRole={userRole}
    >
      <Page />
    </MainLayout>
  );
  return { ...render(ui), ui };
}

const TWO = [{ code: 'FIAE' }, { code: 'KFBM' }];

describe('MainLayout and the occupation tabs', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    '/trainer/dashboard',
    '/trainer/content-management',
    '/trainer/quiz-management',
    '/trainer/trainees',
  ])('shows the tabs above the content of %s', path => {
    renderLayout(path, 'trainer', TWO);
    const tabs = screen.getByTestId('tabs');
    expect(tabs).toBeInTheDocument();
    expect(
      tabs.compareDocumentPosition(screen.getByText('page')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it.each([
    ['a detail page', '/trainer/use-cases/abc', 'trainer', TWO],
    ['an admin page', '/trainer/admin/users', 'trainer', TWO],
    ['the profile', '/trainer/profile', 'trainer', TWO],
    [
      'one occupation (FIAE regression)',
      '/trainer/trainees',
      'trainer',
      [{ code: 'FIAE' }],
    ],
    ['no tabs', '/trainer/trainees', 'trainer', []],
    ['the trainee area', '/trainee/dashboard', 'trainee', TWO],
  ] as const)('shows no tabs on %s', (_label, path, role, tabs) => {
    renderLayout(path, role, [...tabs]);
    expect(screen.queryByTestId('tabs')).not.toBeInTheDocument();
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  it('mounts the page again when the epoch changes, and only then', () => {
    const { rerender, ui } = renderLayout(
      '/trainer/trainees',
      'trainer',
      TWO,
      0
    );
    expect(mounts).toHaveBeenCalledTimes(1);
    rerender(cloneElement(ui));
    expect(mounts).toHaveBeenCalledTimes(1);
    (useCatalog as jest.Mock).mockReturnValue({ tabs: TWO, epoch: 1 });
    rerender(cloneElement(ui));
    expect(mounts).toHaveBeenCalledTimes(2);
  });
});
