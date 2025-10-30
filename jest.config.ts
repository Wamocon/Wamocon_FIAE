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
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  extensionsToTreatAsEsm: [],
  collectCoverage: true,
  collectCoverageFrom: [
    // Focus initial coverage on critical modules; expand progressively
    'src/lib/utils.ts',
    'src/app/api/trainee/enablers/[enablerId]/quiz/route.ts',
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
