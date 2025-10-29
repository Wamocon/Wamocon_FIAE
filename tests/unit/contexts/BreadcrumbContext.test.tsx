import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BreadcrumbProvider, useBreadcrumbs } from '@/contexts/BreadcrumbContext';

jest.mock('next/navigation', () => ({
  usePathname: () => '/trainee/dashboard',
}));

function Consumer() {
  const { breadcrumbs, addBreadcrumb, removeBreadcrumb, clearBreadcrumbs } = useBreadcrumbs();
  return (
    <div>
      <div data-testid="count">{breadcrumbs.length}</div>
      <button onClick={() => addBreadcrumb({ label: 'X', href: '/x' })}>add</button>
      <button onClick={() => removeBreadcrumb('/x')}>remove</button>
      <button onClick={() => clearBreadcrumbs()}>clear</button>
    </div>
  );
}

describe('BreadcrumbContext', () => {
  it('push adds a breadcrumb', async () => {
    const user = userEvent.setup();
    render(<BreadcrumbProvider><Consumer /></BreadcrumbProvider>);
    const initial = Number(screen.getByTestId('count').textContent);
    await user.click(screen.getByText('add'));
    expect(Number(screen.getByTestId('count').textContent)).toBe(initial + 1);
  });

  it('pop removes last breadcrumb', async () => {
    const user = userEvent.setup();
    render(<BreadcrumbProvider><Consumer /></BreadcrumbProvider>);
    await user.click(screen.getByText('add'));
    const afterAdd = Number(screen.getByTestId('count').textContent);
    await user.click(screen.getByText('remove'));
    expect(Number(screen.getByTestId('count').textContent)).toBe(afterAdd - 1);
  });

  it('reset clears breadcrumbs', async () => {
    const user = userEvent.setup();
    render(<BreadcrumbProvider><Consumer /></BreadcrumbProvider>);
    await user.click(screen.getByText('add'));
    await user.click(screen.getByText('add'));
    expect(Number(screen.getByTestId('count').textContent)).toBeGreaterThan(0);
    await user.click(screen.getByText('clear'));
    expect(Number(screen.getByTestId('count').textContent)).toBe(0);
  });
});
