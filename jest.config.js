// jest.config.js
module.exports = {
  testEnvironment: 'node',
  verbose: true,
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  resetModules: true,
  forceExit: true,
  testTimeout: 30000, // 30 seconds timeout for tests
  testMatch: ['**/test/**/*.test.js'],
  // archiver@8 and http-proxy-middleware@4 are ESM-only; map to CJS mocks for Jest.
  moduleNameMapper: {
    '^archiver$': '<rootDir>/test/mocks/archiver.js',
    '^http-proxy-middleware$': '<rootDir>/test/mocks/http-proxy-middleware.js'
  },
  reporters: [
    'default',
    [
      './node_modules/jest-html-reporter',
      {
        pageTitle: 'Gingee Test Report',
        outputPath: './test/test-report.html'
      }
    ]
  ]
};
