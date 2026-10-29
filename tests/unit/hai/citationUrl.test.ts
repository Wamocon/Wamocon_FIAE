/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import { citationUrl } from '@/lib/hai/citationUrl';

// A link in a citation never shows a private reference, a signed address or an
// address into the private bucket of the model solutions.

const pageHit = (storageUrl: unknown) => ({
  id: 'pageindex-doc-p1',
  metadata: { sourceType: 'pageindex', storageUrl },
});

describe('citationUrl', () => {
  it('gives the public address of a page hit', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/content/a.pdf';
    expect(citationUrl(pageHit(url))).toBe(url);
  });

  it('gives nothing for a hit of the vector index, whatever its metadata holds', () => {
    expect(
      citationUrl({
        id: 'chunk-1',
        metadata: { storageUrl: 'https://x.example/a.pdf', url: 'https://x' },
      })
    ).toBeUndefined();
  });

  it.each([
    'private://content-solutions/kfbm/a.pdf',
    'PRIVATE://content-solutions/kfbm/a.pdf',
    'https://abc.supabase.co/storage/v1/object/sign/content-solutions/kfbm/a.pdf?token=abc',
    'https://abc.supabase.co/storage/v1/object/sign/content/a.pdf?token=abc',
    'https://abc.supabase.co/storage/v1/object/authenticated/content-solutions/kfbm/a.pdf',
    'https://abc.supabase.co/storage/v1/object/public/content-solutions/kfbm/a.pdf',
    'https://abc.supabase.co/storage/v1/object/public/content/a.pdf?token=abc',
    'https://abc.supabase.co/a.pdf?X-Amz-Signature=abc',
    'javascript:alert(1)',
    'data:application/pdf;base64,AAAA',
    'ftp://abc.supabase.co/a.pdf',
    '',
    undefined,
    null,
    42,
  ])('gives no link for %p', value => {
    expect(citationUrl(pageHit(value))).toBeUndefined();
  });
});
