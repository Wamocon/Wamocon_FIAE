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

jest.mock('next/dynamic', () => ({
	__esModule: true,
	default: (importFunc: any, options: any) => {
		const MockDynamicComponent = () => null;
		MockDynamicComponent.displayName = 'LoadableComponent';
		return MockDynamicComponent;
	},
}));

// unstable_cache needs the Next.js incrementalCache request context, which does
// not exist in unit tests. Run the wrapped function directly instead.
jest.mock('next/cache', () => ({
	__esModule: true,
	unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
	revalidateTag: jest.fn(),
	revalidatePath: jest.fn(),
}));

// jsdom does not implement matchMedia, which ThemeContext relies on
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: jest.fn(),
			removeListener: jest.fn(),
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
			dispatchEvent: jest.fn(),
		}),
	});
}

// Mock process.env
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-key';

// Mock Supabase client globally to avoid strict instantiation issues
jest.mock('@supabase/supabase-js', () => ({
	createClient: () => ({
		auth: {
			onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
			getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
		},
		from: jest.fn(() => ({
			select: jest.fn().mockReturnThis(),
			insert: jest.fn().mockReturnThis(),
			update: jest.fn().mockReturnThis(),
			eq: jest.fn().mockReturnThis(),
			single: jest.fn(),
		})),
	}),
}));
