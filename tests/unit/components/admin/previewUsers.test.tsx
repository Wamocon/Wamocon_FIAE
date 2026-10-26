import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { PreviewAccountNotice } from '@/components/admin/PreviewAccountNotice';
import { deleteSuccessMessageKey } from '@/components/admin/adminUserErrors';
import de from '@/locales/de.json';
import en from '@/locales/en.json';

// The user administration in Preview: a notice that the accounts are for tests,
// and the toast after a delete that says when the auth account stayed.

const KEYS = [
  'admin.users.previewNotice',
  'admin.users.previewMailHint',
  'admin.users.userDeletedAccountShared',
  'admin.users.userDeletedAccountKept',
] as const;

describe('PreviewAccountNotice', () => {
  it('shows the German notice in Preview', () => {
    renderWithProviders(<PreviewAccountNotice isPreview />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/Preview: Konten/);
    expect(note).toHaveTextContent(/nur für Tests/);
    expect(note).toHaveTextContent(/Production erkennt sie nicht an/);
  });

  it('shows nothing outside of Preview', () => {
    renderWithProviders(<PreviewAccountNotice isPreview={false} />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows nothing by default in the test environment (no schema variable)', () => {
    renderWithProviders(<PreviewAccountNotice />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('deleteSuccessMessageKey', () => {
  it('keeps the usual message when the auth account went (Production and Preview)', () => {
    expect(deleteSuccessMessageKey({})).toBe('admin.users.userDeleted');
    expect(deleteSuccessMessageKey(null)).toBe('admin.users.userDeleted');
    expect(deleteSuccessMessageKey({ authAccountKept: false })).toBe(
      'admin.users.userDeleted'
    );
    expect(deleteSuccessMessageKey({ authAccountKept: 'true' })).toBe(
      'admin.users.userDeleted'
    );
  });

  it('says that a shared account stays', () => {
    expect(
      deleteSuccessMessageKey({
        authAccountKept: true,
        authAccountKeptReason: 'SHARED_ACCOUNT',
      })
    ).toBe('admin.users.userDeletedAccountShared');
  });

  it('says that an account that could not be checked or deleted stays', () => {
    for (const reason of ['CHECK_FAILED', 'DELETE_FAILED', 'NOT_CONFIGURED']) {
      expect(
        deleteSuccessMessageKey({
          authAccountKept: true,
          authAccountKeptReason: reason,
        })
      ).toBe('admin.users.userDeletedAccountKept');
    }
    expect(deleteSuccessMessageKey({ authAccountKept: true })).toBe(
      'admin.users.userDeletedAccountKept'
    );
  });
});

describe('texts of the Preview user administration', () => {
  it('exist in German and English, without dashes as punctuation', () => {
    for (const key of KEYS) {
      for (const text of [
        (de as Record<string, string>)[key],
        (en as Record<string, string>)[key],
      ]) {
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(10);
        expect(text).not.toMatch(/[–—]/);
        expect(text).not.toMatch(/ - /);
      }
    }
  });

  it('use real umlauts in German', () => {
    const all = KEYS.map(k => (de as Record<string, string>)[k]).join(' ');
    expect(all).toMatch(/für|geprüft|löschen|gelöscht|standardmäßig/);
    expect(all).not.toMatch(/fuer|loesch|geprueft|standardmaessig/i);
  });
});
