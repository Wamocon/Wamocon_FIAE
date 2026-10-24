import { screen, waitFor, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { SeatCounter } from '@/components/admin/SeatCounter';
import { NewUserOccupationSelect } from '@/components/admin/NewUserOccupationSelect';
import { adminUserErrorMessage } from '@/components/admin/adminUserErrors';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

// The screens of KfBM S5: the seat counter of the organization card, the
// occupation field of the user form (only for an organization with more than
// one usable occupation), and the German messages for the answers 409
// SEATS_FULL, 403 ROLE_NOT_ASSIGNABLE and the occupation errors.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const THIRD = '44444444-4444-4444-8444-444444444444';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

const reply = (data: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => data }) as Response;

const entry = (
  id: string,
  code: string,
  isActive = true,
  isEnabled = true
) => ({
  trainingCatalogId: id,
  code,
  title: `Beruf ${code}`,
  isActive,
  isEnabled,
  traineeCount: 0,
});

describe('SeatCounter', () => {
  it('shows occupied of limit and no warning while seats are free', () => {
    renderWithProviders(
      <SeatCounter label="Auszubildende" occupied={4} limit={5} />
    );
    expect(screen.getByText('Auszubildende')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('/5')).toBeInTheDocument();
    expect(screen.queryByText('Voll')).toBeNull();
    expect(
      screen.getByLabelText('Auszubildende: 4 von 5 belegt')
    ).toBeInTheDocument();
  });

  it('says "Voll" when the last seat is taken', () => {
    renderWithProviders(
      <SeatCounter label="Ausbilder" occupied={3} limit={3} />
    );
    expect(screen.getByText('Voll')).toBeInTheDocument();
  });

  it('says "Über dem Limit" for an organization over its limit', () => {
    renderWithProviders(
      <SeatCounter label="Ausbilder" occupied={7} limit={3} />
    );
    expect(screen.getByText('Über dem Limit')).toBeInTheDocument();
    expect(screen.queryByText('Voll')).toBeNull();
  });
});

function Harness({ organizationId }: { organizationId: string }) {
  const [value, setValue] = useState('');
  return (
    <>
      <NewUserOccupationSelect
        organizationId={organizationId}
        value={value}
        onChange={setValue}
      />
      <output data-testid="chosen">{value}</output>
    </>
  );
}

const catalogsUrl = (org: string) => `/api/admin/organizations/${org}/catalogs`;

function mockCatalogs(byOrg: Record<string, unknown[] | 'fail'>) {
  (authFetch as jest.Mock).mockImplementation(async (url: string) => {
    const org = Object.keys(byOrg).find(o => url === catalogsUrl(o));
    if (!org) throw new Error(`unexpected request ${url}`);
    const entries = byOrg[org];
    if (entries === 'fail') return reply({ error: 'x' }, 500);
    return reply({ organizationId: org, catalogs: entries });
  });
}

describe('NewUserOccupationSelect', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows nothing and asks nothing without an organization', () => {
    renderWithProviders(<Harness organizationId="" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(authFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('chosen')).toHaveTextContent('');
  });

  it('shows nothing when the organization has one usable occupation, the default applies', async () => {
    mockCatalogs({ [ORG]: [entry(FIAE, 'FIAE')] });
    renderWithProviders(<Harness organizationId={ORG} />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('chosen')).toHaveTextContent('');
  });

  it('does not offer occupations that are inactive or not enabled', async () => {
    mockCatalogs({
      [ORG]: [
        entry(FIAE, 'FIAE'),
        entry(KFBM, 'KFBM', false, true),
        entry(THIRD, 'XYZ', true, false),
      ],
    });
    renderWithProviders(<Harness organizationId={ORG} />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('with several usable occupations it shows the field and preselects FIAE', async () => {
    mockCatalogs({ [ORG]: [entry(KFBM, 'KFBM'), entry(FIAE, 'FIAE')] });
    renderWithProviders(<Harness organizationId={ORG} />);
    const select = await screen.findByRole('combobox', { name: /Beruf/ });
    expect(select).toHaveValue(FIAE);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    // the form is told about the preselected occupation
    await waitFor(() =>
      expect(screen.getByTestId('chosen')).toHaveTextContent(FIAE)
    );
    expect(screen.getByText(/genau einem Beruf/)).toBeInTheDocument();
  });

  it('reports the occupation the admin picks', async () => {
    mockCatalogs({ [ORG]: [entry(FIAE, 'FIAE'), entry(KFBM, 'KFBM')] });
    renderWithProviders(<Harness organizationId={ORG} />);
    const select = await screen.findByRole('combobox', { name: /Beruf/ });
    await waitFor(() =>
      expect(screen.getByTestId('chosen')).toHaveTextContent(FIAE)
    );
    fireEvent.change(select, { target: { value: KFBM } });
    await waitFor(() =>
      expect(screen.getByTestId('chosen')).toHaveTextContent(KFBM)
    );
  });

  it('without FIAE among several it preselects the first and still shows the field', async () => {
    mockCatalogs({ [ORG]: [entry(KFBM, 'KFBM'), entry(THIRD, 'XYZ')] });
    renderWithProviders(<Harness organizationId={ORG} />);
    const select = await screen.findByRole('combobox', { name: /Beruf/ });
    expect(select).toHaveValue(KFBM);
  });

  it('a failing request shows nothing, the new user then gets the default', async () => {
    mockCatalogs({ [ORG]: 'fail' });
    renderWithProviders(<Harness organizationId={ORG} />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('chosen')).toHaveTextContent('');
  });

  it('reloads for another organization and forgets the old choice', async () => {
    mockCatalogs({
      [ORG]: [entry(FIAE, 'FIAE'), entry(KFBM, 'KFBM')],
      [OTHER_ORG]: [entry(FIAE, 'FIAE')],
    });
    const { rerender } = renderWithProviders(<Harness organizationId={ORG} />);
    await screen.findByRole('combobox', { name: /Beruf/ });
    rerender(<Harness organizationId={OTHER_ORG} />);
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(screen.getByTestId('chosen')).toHaveTextContent('');
  });
});

// A translate function that works like the one of the language context
const t = (key: string, data?: Record<string, string | number>) => {
  let text = (de as Record<string, string>)[key] || key;
  for (const [k, v] of Object.entries(data ?? {})) {
    text = text.replace(`{${k}}`, String(v));
  }
  return text;
};

describe('adminUserErrorMessage', () => {
  const message = (
    body: unknown,
    options = { isSuperAdmin: false },
    status = 409
  ) =>
    adminUserErrorMessage(
      reply(body, status),
      t,
      'admin.users.createFailed',
      options
    );

  it('explains full trainee seats with the numbers and who can raise them', async () => {
    const text = await message({
      code: 'SEATS_FULL',
      kind: 'trainee',
      occupied: 12,
      limit: 12,
    });
    expect(text).toBe(
      'Alle Azubi-Plätze Ihrer Organisation sind belegt (12 von 12). Der Superadmin kann die Plätze erhöhen.'
    );
  });

  it('tells the platform admin where to raise the seats instead', async () => {
    const text = await message(
      { code: 'SEATS_FULL', kind: 'trainee', occupied: 12, limit: 12 },
      { isSuperAdmin: true }
    );
    expect(text).toContain('12 von 12');
    expect(text).toContain('Erhöhen Sie die Plätze');
    expect(text).not.toContain('Der Superadmin kann');
  });

  it('says that admins count as trainers when trainer seats are full', async () => {
    const text = await message({
      code: 'SEATS_FULL',
      kind: 'trainer',
      occupied: 5,
      limit: 5,
    });
    expect(text).toContain('Ausbilder-Plätze');
    expect(text).toContain('Admins und Temp-Admins zählen als Ausbilder');
    expect(text).toContain('Der Superadmin kann die Plätze erhöhen');
  });

  it('explains a role the caller may not hand out', async () => {
    const text = await message(
      { code: 'ROLE_NOT_ASSIGNABLE', error: 'English text' },
      { isSuperAdmin: false },
      403
    );
    expect(text).toBe(de['admin.seats.error.ROLE_NOT_ASSIGNABLE']);
  });

  it('knows the occupation errors, also the new one for a missing choice', async () => {
    expect(await message({ code: 'CATALOG_REQUIRED' }, undefined, 400)).toBe(
      de['admin.userCreate.error.CATALOG_REQUIRED']
    );
    expect(await message({ code: 'CATALOG_NOT_ENABLED' }, undefined, 400)).toBe(
      de['admin.catalogs.error.CATALOG_NOT_ENABLED']
    );
  });

  it('keeps the text of the server for an answer it does not know, as before', async () => {
    expect(
      await message({ error: 'A user with this email already exists' })
    ).toBe('A user with this email already exists');
  });

  it('uses the fallback text when there is nothing to show', async () => {
    expect(await message({})).toBe(de['admin.users.createFailed']);
    const broken = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('no json');
      },
    } as unknown as Response;
    expect(
      await adminUserErrorMessage(broken, t, 'admin.users.createFailed', {
        isSuperAdmin: false,
      })
    ).toBe(de['admin.users.createFailed']);
  });
});
