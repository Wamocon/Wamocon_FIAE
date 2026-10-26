/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

// Cache-Control of API reads. A response that depends on the session (the
// occupation of the caller) must never be stored by a shared cache, because
// the URL is the same for every occupation (KfBM S4).

const LONG = 'public, s-maxage=900, stale-while-revalidate=1800';
const PRIVATE = 'private, no-cache';

function cacheControl(path: string, method = 'GET', headers = {}) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    headers,
  });
  return middleware(request).headers.get('Cache-Control');
}

describe('middleware Cache-Control for API reads', () => {
  describe('answers that depend on the occupation of the session', () => {
    it.each([
      '/api/trainee/lernfelder/9b2f6a7e-0000-4000-8000-000000000001',
      '/api/trainee/lernfelder/abc',
      '/api/trainee/lernfelder',
    ])('%s is private', path => {
      expect(cacheControl(path)).toBe(PRIVATE);
    });

    it('stays private with a Bearer token and with a catalog header', () => {
      expect(
        cacheControl('/api/trainee/lernfelder/abc', 'GET', {
          authorization: 'Bearer token',
          'x-catalog': 'KFBM',
        })
      ).toBe(PRIVATE);
    });
  });

  describe('static reference data stays cacheable', () => {
    it.each([
      '/api/training-components',
      '/api/training-components?catalog=KFBM',
      '/api/training-use-cases',
      '/api/training-use-cases?catalog=KFBM',
      '/api/softskill-criteria',
      '/api/trainee/evaluations/softskills',
      '/api/verify/abc123',
    ])('%s is public', path => {
      expect(cacheControl(path)).toBe(LONG);
    });
  });

  describe('everything else keeps its tier', () => {
    it.each([
      '/api/trainee/dashboard',
      '/api/trainee/use-case-hours',
      '/api/trainer/courses',
      '/api/me/catalogs',
      '/api/catalogs',
    ])('%s is private', path => {
      expect(cacheControl(path)).toBe(PRIVATE);
    });

    it.each(['/api/hai/chat', '/api/auth/session', '/api/register'])(
      '%s gets no Cache-Control',
      path => {
        expect(cacheControl(path)).toBeNull();
      }
    );

    it('does not touch writes', () => {
      expect(cacheControl('/api/trainee/lernfelder/abc', 'POST')).toBeNull();
    });
  });
});
