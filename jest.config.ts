import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/?(*.)+(test).[tj]s?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(lucide-react|react-markdown|rehype-highlight|remark-gfm|d3-|d3|redent|strip-indent|indent-string)/)',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    // Git worktrees of local agent sessions hold copies of every test file
    '<rootDir>/.claude/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  extensionsToTreatAsEsm: [],
  collectCoverage: true,
  collectCoverageFrom: [
    // Focus initial coverage on critical modules; expand progressively
    'src/lib/utils.ts',
    'src/app/api/trainee/enablers/[enablerId]/quiz/route.ts',
    // The files of the bucket content: signed addresses, the path check, the access rule
    'src/lib/storage/contentPath.ts',
    'src/lib/storage/contentUrl.ts',
    'src/lib/storage/contentRead.ts',
    'src/lib/storage/documentAccess.ts',
    'src/app/api/documents/[documentId]/file/route.ts',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/src/db/migrations/schemas/',
    '<rootDir>/src/db/index.ts',
    '<rootDir>/tests/',
  ],
  coverageThreshold: {
    global: {
      functions: 100,
      lines: 100,
    },
  },
};

export default config;
