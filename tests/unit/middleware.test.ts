/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const LONG = 'public, s-maxage=900, stale-while-revalidate=1800';
const PRIVATE = 'private, no-cache';

function cacheControl(path: string, method = 'GET') {
  const res = middleware(
    new NextRequest(`http://localhost${path}`, { method })
  );
  return res.headers.get('cache-control');
}

describe('middleware: Cache-Control of API responses', () => {
  describe('answers that depend on the session (the occupation) are never public', () => {
    it.each([
      '/api/trainee/lernfelder/11111111-1111-4111-8111-111111111111',
      '/api/trainee/lernfelder/abc?catalog=KFBM',
      '/api/trainee/lernfelder',
      '/api/trainee/school/lernfelder',
      '/api/trainer/lernfelder/11111111-1111-4111-8111-111111111111',
    ])('%s is private', path => {
      expect(cacheControl(path)).toBe(PRIVATE);
    });
  });

  describe('static reference data stays cacheable (unchanged)', () => {
    it.each([
      '/api/training-use-cases',
      '/api/training-use-cases?catalog=KFBM',
      '/api/training-components',
      '/api/softskill-criteria',
      '/api/trainee/evaluations/softskills',
      '/api/verify/ABC123',
    ])('%s is public for 15 minutes', path => {
      expect(cacheControl(path)).toBe(LONG);
    });
  });

  describe('everything else (unchanged)', () => {
    it.each([
      '/api/trainer/trainees',
      '/api/trainee/dashboard',
      '/api/me/catalogs',
      '/api/catalogs',
    ])('%s is private', path => {
      expect(cacheControl(path)).toBe(PRIVATE);
    });

    it('does not touch the answers of writes', () => {
      expect(cacheControl('/api/trainee/lernfelder/abc', 'POST')).toBeNull();
    });

    it.each(['/api/hai/chat', '/api/auth/login', '/api/register'])(
      'sets nothing for %s',
      path => {
        expect(cacheControl(path)).toBeNull();
      }
    );
  });
});
