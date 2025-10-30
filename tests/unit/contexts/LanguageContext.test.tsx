import { describe, it, expect } from '@jest/globals';
import React, { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';

function Consumer() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="label">{t('nav.dashboard')}</span>
      <button onClick={() => setLanguage('en')}>EN</button>
      <button onClick={() => setLanguage('de')}>DE</button>
    </div>
  );
}

describe('LanguageContext', () => {
  it('defaults to expected locale', () => {
    render(
      <LanguageProvider>
        <Consumer />
      </LanguageProvider>
    );
    expect(screen.getByTestId('lang').textContent).toBe('de');
    expect(screen.getByTestId('label').textContent).toBe('Dashboard'); // both de/en have same term; sanity check t() returns a string
  });

  it('setLanguage updates consumers and labels', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Consumer />
      </LanguageProvider>
    );
    // Switch to EN and verify t() still returns label (in EN it's 'Dashboard')
    await user.click(screen.getByText('EN'));
    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(screen.getByTestId('label').textContent).toBe('Dashboard');
    // Switch back to DE
    await user.click(screen.getByText('DE'));
    expect(screen.getByTestId('lang').textContent).toBe('de');
  });
});
