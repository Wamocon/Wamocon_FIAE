/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import nextConfig from '../../../next.config';

// KFB-1158: the view "Meine Fragenkomplexe" (/trainee/modules, a second list
// of the same courses that "Lernen" shows) is gone. The detail page of one
// course (/trainee/modules/<id>, the themes of the component) stays. An old
// link or bookmark goes to the overview "Lernen".

const ROOT = process.cwd();

describe('the list of all modules is removed (KFB-1158)', () => {
  it('has no page and no loading file for /trainee/modules', () => {
    expect(existsSync(join(ROOT, 'src/app/trainee/modules/page.tsx'))).toBe(
      false
    );
    expect(existsSync(join(ROOT, 'src/app/trainee/modules/loading.tsx'))).toBe(
      false
    );
  });

  it('keeps the page of one course (the themes of the component)', () => {
    expect(
      existsSync(join(ROOT, 'src/app/trainee/modules/[moduleId]/page.tsx'))
    ).toBe(true);
  });

  it('sends an old link to the overview of the courses', async () => {
    const redirects = await (nextConfig.redirects as () => Promise<any[]>)();
    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/trainee/modules',
          destination: '/trainee/courses',
        }),
      ])
    );
    // only the list, never the detail page of a course
    const rule = redirects.find(r => r.source === '/trainee/modules');
    expect(rule.source).not.toContain(':');
  });

  it('is not linked from the sidebar or the dashboard any more', () => {
    for (const file of [
      'src/components/layout/Sidebar.tsx',
      'src/components/dashboard/TraineeDashboard.tsx',
      'src/app/trainee/enablers/[enablerId]/page.tsx',
    ]) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source).not.toMatch(/['"`]\/trainee\/modules['"`]/);
    }
  });
});
