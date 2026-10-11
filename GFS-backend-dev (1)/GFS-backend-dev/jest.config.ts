import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    // Strip .js from relative imports (node16 TS requires .js, Jest needs bare path)
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Path aliases with .js suffix (must come before the bare patterns)
    '^@config/(.*)\\.js$': '<rootDir>/src/config/$1',
    '^@features/(.*)\\.js$': '<rootDir>/src/features/$1',
    '^@workers/(.*)\\.js$': '<rootDir>/src/workers/$1',
    '^@db/(.*)\\.js$': '<rootDir>/src/db/$1',
    '^@infrastructure/(.*)\\.js$': '<rootDir>/src/infrastructure/$1',
    '^@shared/(.*)\\.js$': '<rootDir>/src/shared/$1',
    '^@repositories/(.*)\\.js$': '<rootDir>/src/repositories/$1',
    '^@services/(.*)\\.js$': '<rootDir>/src/services/$1',
    // Path aliases without suffix
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    '^@workers/(.*)$': '<rootDir>/src/workers/$1',
    '^@db/(.*)$': '<rootDir>/src/db/$1',
    '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@repositories/(.*)$': '<rootDir>/src/repositories/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/**/*.types.ts',
    '!src/db/models/**/*.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  coverageDirectory: 'coverage',
  testMatch: ['**/*.test.ts'],
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  // Give integration tests more time — they spin up in-memory MongoDB
  testTimeout: 30000,
  // Force exit after all tests complete — prevents hanging from express-rate-limit timers
  forceExit: true,
};

export default config;
