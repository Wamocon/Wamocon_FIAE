import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import TrainerTraineesPage from '@/app/trainer/trainees/page';

// WMCNL-2997: the list of the trainees. The empty text names the filter (it
// said "no trainees assigned" for "Inaktiv" with five trainees assigned), the
// duration is not cut, there is a search, the address is "du".

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

const trainee = (id: string, name: string, extra: object = {}) => ({
  id,
  full_name: name,
  email: `${name.split(' ')[0].toLowerCase()}@example.com`,
  avatar_url: null,
  ausbildungDurationYears: 3,
  progress: 10,
  coursesCount: 3,
  isActive: true,
  trainerActivated: true,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'tr1', role: 'TRAINER' },
    user: { id: 'tr1' },
    loading: false,
  });
  authFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      trainees: [
        trainee('1', 'Leon Moretz'),
        trainee('2', 'Anna Berg'),
        trainee('3', 'Karl Stein'),
      ],
    }),
  } as Response);
});

async function renderList() {
  const view = renderWithProviders(<TrainerTraineesPage />);
  await screen.findByText('Leon Moretz');
  return view;
}

describe('trainee list (WMCNL-2997)', () => {
  it('names the filter in the empty text instead of "nobody is assigned"', async () => {
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Inaktiv' }));
    expect(
      await screen.findByText('Keine inaktiven Auszubildenden')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Es sind noch keine Auszubildenden zugewiesen.')
    ).toBeNull();
  });

  it('shows the whole duration, it is not cut off', async () => {
    await renderList();
    const chip = screen.getAllByText('3 Jahre (Regelausbildungszeit)')[0];
    expect(chip.className).not.toContain('truncate');
    expect(chip.parentElement?.className).toContain('flex-wrap');
    expect(chip.parentElement?.className).not.toContain('overflow-hidden');
  });

  it('searches by name or email', async () => {
    await renderList();
    const search = screen.getByLabelText('Auszubildende suchen');
    fireEvent.change(search, { target: { value: 'anna' } });
    expect(screen.getByText('Anna Berg')).toBeInTheDocument();
    expect(screen.queryByText('Leon Moretz')).toBeNull();
    fireEvent.change(search, { target: { value: 'KARL@EXAMPLE' } });
    expect(screen.getByText('Karl Stein')).toBeInTheDocument();
    expect(screen.queryByText('Anna Berg')).toBeNull();
    fireEvent.change(search, { target: { value: 'gibt es nicht' } });
    expect(await screen.findByText('Keine Treffer')).toBeInTheDocument();
  });

  it('speaks to the trainer with "du"', async () => {
    const { container } = await renderList();
    expect(container.textContent).toContain(
      'Verwalte deine Auszubildenden und verfolge ihren Fortschritt'
    );
    expect(container.textContent).not.toMatch(/\bSie\b|\bIhre\b/);
  });
});
