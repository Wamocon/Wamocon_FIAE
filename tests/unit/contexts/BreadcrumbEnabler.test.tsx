import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  BreadcrumbProvider,
  useBreadcrumbs,
} from '@/contexts/BreadcrumbContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

// WMCNL-2933: the page of ONE Themenkreis is titled in the singular, the list
// segment keeps the plural.

jest.mock('next/navigation', () => ({
  usePathname: () => '/trainee/enablers/0b7e8a3e-4c1f-4c5e-9a53-2d6f1f9a1111',
}));

function Labels() {
  const { breadcrumbs } = useBreadcrumbs();
  return (
    <ul>
      {breadcrumbs.map(b => (
        <li key={b.href}>{b.label}</li>
      ))}
    </ul>
  );
}

describe('breadcrumb of the page of one Themenkreis', () => {
  it('names the page "Themenkreis", not "Themenkreise"', () => {
    render(
      <LanguageProvider>
        <BreadcrumbProvider>
          <Labels />
        </BreadcrumbProvider>
      </LanguageProvider>
    );
    const labels = screen.getAllByRole('listitem').map(li => li.textContent);
    expect(labels).toEqual(['Azubi', 'Themenkreise', 'Themenkreis']);
  });
});
