import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import { ContentManagement } from '@/components/trainer/ContentManagement';

// WMCNL-3025: names, grammar and presentation of the content management.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const texts = de as Record<string, string>;
const ID_COURSE = '3b2f6c1e-9d7a-4c3b-8e1f-0a1b2c3d4e5f';

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const course = (over: Record<string, unknown> = {}) => ({
  id: ID_COURSE,
  title: 'Telefonate führen (§ 4 Abs. 2 Nr. 2)',
  year: 1,
  chapter: 100,
  examPart: null,
  enablersCount: 2,
  useCasesCount: 1,
  trainersCount: 0,
  traineesCount: 1,
  ...over,
});

function load(courses: unknown[]) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role: 'super_admin' },
    isPlatformOwner: false,
    loading: false,
  });
  authFetchMock.mockImplementation(async () => json({ courses }));
}

beforeEach(() => jest.clearAllMocks());

describe('content management texts (WMCNL-3025)', () => {
  it('names the page the same way everywhere', () => {
    expect(texts['nav.contentManagement']).toBe('Inhaltsverwaltung');
    expect(texts['breadcrumb.contentManagement']).toBe('Inhaltsverwaltung');
    expect(texts['content.management.title']).toBe('Inhaltsverwaltung');
  });

  it('has no double space, no wrong plural form and no replacement spelling', () => {
    const keys = Object.keys(texts).filter(
      k =>
        k.startsWith('content.') ||
        k.startsWith('course.form.') ||
        k.startsWith('trainer.content.')
    );
    for (const key of keys) {
      const value = texts[key];
      expect(`${key}: ${value}`).not.toMatch(/ {2}/);
      expect(`${key}: ${value}`).not.toMatch(
        /Fragenkomplexe (suchen|bearbeiten)/
      );
      expect(`${key}: ${value}`).not.toMatch(
        /im Fragenkomplexe|Fragenkomplexe(details|titel)/i
      );
      expect(`${key}: ${value}`).not.toMatch(/ausgewaehlt|auswaehlen/);
    }
    expect(texts['content.searchModules']).toBe(
      'Nach Fragenkomplexen suchen...'
    );
    expect(texts['content.assignSelectedTraineesCount']).toBe(
      '{count} ausgewählt'
    );
    expect(texts['trainer.content.courseDetails']).toBe(
      'Fragenkomplex-Details'
    );
  });

  it('speaks to the person with "du" (no "Sie", "Ihr")', () => {
    for (const key of [
      'content.management.description',
      'content.createFirst',
      'content.tryOtherCriteria',
      'course.form.description',
    ]) {
      expect(texts[key]).not.toMatch(/\b(Sie|Ihr|Ihre|Ihren)\b/);
    }
  });

  it('has no occupation specific example in the skills placeholder', () => {
    for (const lang of [de, en] as Record<string, string>[]) {
      expect(lang['course.form.skillsPlaceholder']).not.toMatch(/Git|HTML|CSS/);
      expect(lang['trainer.content.skillsPlaceholder']).not.toMatch(/Git|HTML/);
    }
  });

  it('the list view is compact and shows no internal id', async () => {
    load([course()]);
    renderWithProviders(<ContentManagement />);
    await screen.findByText('Telefonate führen (§ 4 Abs. 2 Nr. 2)');
    fireEvent.click(
      screen.getByRole('button', { name: texts['content.listView'] })
    );
    expect(screen.queryByText(/3b2f6c1e/)).toBeNull();
    expect(screen.queryByText(/^ID 3b/)).toBeNull();
    // the whole title is available (tooltip), the row is no big card
    const title = screen.getByText('Telefonate führen (§ 4 Abs. 2 Nr. 2)');
    expect(title).toHaveAttribute(
      'title',
      'Telefonate führen (§ 4 Abs. 2 Nr. 2)'
    );
    expect(title.className).toContain('text-base');
  });

  it('counts "1 Azubi" and "0 Azubis"', async () => {
    load([
      course({ traineesCount: 1 }),
      course({ id: 'c2', title: 'Zwei', traineesCount: 0 }),
    ]);
    renderWithProviders(<ContentManagement />);
    await screen.findByText('Zwei');
    expect(screen.getByText('1 Azubi')).toBeInTheDocument();
    expect(screen.getByText('0 Azubis')).toBeInTheDocument();
  });

  it('shows no "Phase -" badge for a course without a phase', async () => {
    load([course({ year: null, chapter: null })]);
    renderWithProviders(<ContentManagement />);
    await screen.findByText('Telefonate führen (§ 4 Abs. 2 Nr. 2)');
    expect(screen.queryByText(/Phase -/)).toBeNull();
    expect(screen.queryByText(/ID -/)).toBeNull();
  });

  it('the assignment dialog names the missing trainee AND the missing course', async () => {
    load([course()]);
    renderWithProviders(<ContentManagement />);
    await screen.findByText('Telefonate führen (§ 4 Abs. 2 Nr. 2)');
    fireEvent.click(
      screen.getByRole('button', { name: texts['content.assignCourses'] })
    );
    await screen.findByRole('heading', {
      name: texts['content.assignCoursesTitle'],
    });
    fireEvent.click(
      screen.getByRole('button', { name: texts['content.assignNow'] })
    );
    expect(
      await screen.findByText(texts['content.assignSelectBoth'])
    ).toBeInTheDocument();
    expect(texts['content.assignSelectBoth']).toMatch(/Azubi.*Fragenkomplex/);
  });
});
