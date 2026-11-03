/**
 * @jest-environment node
 */
import { loadPlanFindings } from '@/lib/catalog/content-check/plan-hook';

// The hook of the plan check: the module src/lib/catalog/content-plan/plan-check.ts
// is built separately. The loader is replaced here, so every case (module there,
// missing, broken, without the function) runs without that file.

const missing = (message: string, code?: string) =>
  Object.assign(new Error(message), code ? { code } : {});

describe('loadPlanFindings', () => {
  it('answers the function of the module when it exists', async () => {
    const planFindings = jest.fn(async () => []);
    const loaded = loadPlanFindings(() => ({ planFindings }));
    expect(loaded).toBe(planFindings);
    await loaded?.('x');
    expect(planFindings).toHaveBeenCalledWith('x');
  });

  it('answers null when the module has no such function', () => {
    expect(loadPlanFindings(() => ({ other: 1 }))).toBeNull();
    expect(loadPlanFindings(() => ({ planFindings: 'no' }))).toBeNull();
    expect(loadPlanFindings(() => null)).toBeNull();
  });

  it('answers null when the module is missing, in the wording of Node, the bundler and Jest', () => {
    for (const error of [
      missing(
        "Cannot find module '@/lib/catalog/content-plan/plan-check'",
        'MODULE_NOT_FOUND'
      ),
      missing("Cannot find module '@/lib/catalog/content-plan/plan-check'"),
      missing(
        'Configuration error: Could not locate module @/lib/catalog/content-plan/plan-check mapped as: x'
      ),
    ]) {
      expect(
        loadPlanFindings(() => {
          throw error;
        })
      ).toBeNull();
    }
  });

  it('does not swallow an error of the module itself, nor a missing other module', () => {
    expect(() =>
      loadPlanFindings(() => {
        throw new Error('plan module is broken');
      })
    ).toThrow('plan module is broken');
    // The plan module exists but one of ITS imports is missing: that is a bug
    expect(() =>
      loadPlanFindings(() => {
        throw missing("Cannot find module 'pdf-parse'", 'MODULE_NOT_FOUND');
      })
    ).toThrow('pdf-parse');
  });

  it('the default loader answers null or the function, never throws, until the plan module is merged', () => {
    const loaded = loadPlanFindings();
    expect(loaded === null || typeof loaded === 'function').toBe(true);
  });
});
