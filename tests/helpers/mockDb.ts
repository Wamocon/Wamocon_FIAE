// Pattern for mocking '@/db' in tests.
// Update per test to return the expected rows for each query chain.

export function mockDbOnce(impl: Partial<Record<string, any>>) {
  jest.doMock('@/db', () => ({ __esModule: true, default: impl }));
}

export function resetDbMock() {
  jest.dontMock('@/db');
}
