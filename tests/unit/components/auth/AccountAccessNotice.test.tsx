import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { AccountAccessNotice } from '@/components/auth/AccountAccessNotice';
import { useAuth } from '@/contexts/AuthContext';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

// The page of a signed in person who is stopped at an area: the message, who is
// signed in (name only), the sign out button, no jump to /login. Module under
// test: src/components/auth/AccountAccessNotice.tsx (new, no older test).

jest.mock('@/contexts/AuthContext');
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

const signOut = jest.fn();
const refreshProfile = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  refreshProfile.mockResolvedValue(undefined);
  (useAuth as jest.Mock).mockReturnValue({ signOut, refreshProfile });
});

const REASONS = [
  'awaitingActivation',
  'deactivated',
  'organizationDeactivated',
  'wrongArea',
  'profileUnavailable',
  'noCatalog',
] as const;

describe('AccountAccessNotice', () => {
  it('tells a trainee who waits for the release what is the case', () => {
    renderWithProviders(
      <AccountAccessNotice
        reason="awaitingActivation"
        area="trainee"
        fullName="Nikolaj Schefner"
      />
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Ihr Konto wartet auf die Freigabe',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ihr Konto wurde angelegt und wartet auf die Freigabe durch Ihren Ausbilder oder Administrator.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Angemeldet als Nikolaj Schefner')).toBeVisible();
  });

  it('is a status for a wait and an alert for a block', () => {
    const { unmount } = renderWithProviders(
      <AccountAccessNotice reason="awaitingActivation" area="trainee" />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'wartet auf die Freigabe'
    );
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    renderWithProviders(
      <AccountAccessNotice reason="deactivated" area="trainee" />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('deaktiviert');
  });

  it('moves the focus to the heading, so a screen reader starts there', () => {
    renderWithProviders(
      <AccountAccessNotice reason="awaitingActivation" area="trainee" />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('shows no name line without a name and never an e-mail address', () => {
    renderWithProviders(
      <AccountAccessNotice
        reason="awaitingActivation"
        area="trainee"
        fullName="   "
      />
    );
    expect(screen.queryByText(/Angemeldet als/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it('signs out with the button and does not leave by itself', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AccountAccessNotice reason="awaitingActivation" area="trainee" />
    );
    await user.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('is reachable by keyboard: real buttons in a main landmark', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AccountAccessNotice reason="awaitingActivation" area="trainee" />
    );
    expect(screen.getByRole('main')).toHaveAccessibleName(
      'Ihr Konto wartet auf die Freigabe'
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Erneut prüfen' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('checks again and says when the account is still not released', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AccountAccessNotice reason="awaitingActivation" area="trainee" />
    );
    expect(screen.queryByText(/noch nicht freigegeben/)).toBeNull();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    });
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByText('Ihr Konto ist noch nicht freigegeben.')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Erneut prüfen' })).toBeEnabled();
  });

  it('keeps the notice and the button when the check fails', async () => {
    refreshProfile.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithProviders(
      <AccountAccessNotice reason="profileUnavailable" area="trainee" />
    );
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    });
    await waitFor(() =>
      expect(
        screen.getByText('Das Profil konnte weiterhin nicht geladen werden.')
      ).toBeInTheDocument()
    );
  });

  it('disables the button while it checks', async () => {
    let finish: () => void = () => undefined;
    refreshProfile.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      })
    );
    const user = userEvent.setup();
    renderWithProviders(
      <AccountAccessNotice reason="awaitingActivation" area="trainee" />
    );
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    });
    const busy = screen.getByRole('button', { name: 'Wird geprüft...' });
    // aria-disabled keeps the focus on the button
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).toHaveFocus();
    await act(async () => {
      busy.click();
    });
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    expect(screen.getByRole('button', { name: 'Erneut prüfen' })).toBeEnabled();
  });

  it('offers a check only where the state may change by itself', () => {
    for (const reason of REASONS) {
      const { unmount } = renderWithProviders(
        <AccountAccessNotice reason={reason} area="trainee" />
      );
      const retry = screen.queryByRole('button', { name: 'Erneut prüfen' });
      if (reason === 'awaitingActivation' || reason === 'profileUnavailable') {
        expect(retry).toBeInTheDocument();
      } else {
        expect(retry).toBeNull();
      }
      expect(screen.getByRole('button', { name: 'Abmelden' })).toBeVisible();
      unmount();
    }
  });

  it('names the other area for a wrong area and links to its dashboard', () => {
    const { unmount } = renderWithProviders(
      <AccountAccessNotice reason="wrongArea" area="trainee" />
    );
    expect(
      screen.getByRole('heading', {
        name: 'Dieser Bereich ist für Auszubildende',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zum Ausbilderbereich' })
    ).toHaveAttribute('href', '/trainer/dashboard');
    unmount();
    renderWithProviders(
      <AccountAccessNotice reason="wrongArea" area="trainer" />
    );
    expect(
      screen.getByRole('link', { name: 'Zum Azubi-Bereich' })
    ).toHaveAttribute('href', '/trainee/dashboard');
  });

  it('has no link away for the other reasons', () => {
    renderWithProviders(
      <AccountAccessNotice reason="awaitingActivation" area="trainee" />
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('every message exists in German and English, without a dash', () => {
    const keys = [
      'accessNotice.signedInAs',
      'accessNotice.retry',
      'accessNotice.checking',
      'accessNotice.awaitingActivation.hint',
      'accessNotice.wrongArea.trainee.go',
      'accessNotice.wrongArea.trainer.go',
      'accessNotice.wrongArea.trainee.text',
      'accessNotice.wrongArea.trainer.text',
      'accessNotice.wrongArea.trainee.title',
      'accessNotice.wrongArea.trainer.title',
      'accessNotice.awaitingActivation.stillSo',
      'accessNotice.profileUnavailable.stillSo',
      ...REASONS.filter(r => r !== 'wrongArea').flatMap(r => [
        `accessNotice.${r}.title`,
        `accessNotice.${r}.text`,
      ]),
      'auth.reason.signinRequired',
      'auth.reason.deactivated',
      'auth.reason.organizationDeactivated',
      'auth.blocked.deactivated',
      'auth.blocked.organizationDeactivated',
      'auth.blocked.profileUnavailable',
    ];
    const deMap = de as Record<string, string>;
    const enMap = en as Record<string, string>;
    for (const key of keys) {
      expect(typeof deMap[key]).toBe('string');
      expect(deMap[key].length).toBeGreaterThan(0);
      expect(typeof enMap[key]).toBe('string');
      expect(enMap[key].length).toBeGreaterThan(0);
      expect(deMap[key]).not.toMatch(/[–—]/);
      expect(enMap[key]).not.toMatch(/[–—]/);
    }
  });
});
