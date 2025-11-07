import '@testing-library/jest-dom';

// Provide a safe mock for Next.js App Router hooks in tests
// This prevents "expected app router to be mounted" errors when components call useRouter/usePathname
jest.mock('next/navigation', () => {
	const actual = jest.requireActual('next/navigation');
	return {
		...actual,
		useRouter: () => ({
			push: jest.fn(),
			replace: jest.fn(),
			prefetch: jest.fn(),
			back: jest.fn(),
			forward: jest.fn(),
			refresh: jest.fn(),
		}),
		usePathname: () => '/',
		useSearchParams: () => new URLSearchParams(),
	};
});
