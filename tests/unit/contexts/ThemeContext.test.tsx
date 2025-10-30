import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';

function Consumer() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

describe('ThemeContext', () => {
  it('toggles between dark and light and applies root class changes', async () => {
    const user = userEvent.setup();
    // Initial render
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    );

    // useEffect will run setting mounted and theme to dark
    // assert root class contains 'dark'
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByTestId('theme').textContent).toBe('dark');

    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);

    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
