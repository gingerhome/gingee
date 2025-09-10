// jest.config.js
const path = require('path');

module.exports = {
  testEnvironment: 'node',
  verbose: true,
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  resetModules: true,
  forceExit: true,
  testTimeout: 30000, // 30 seconds timeout for tests
  testMatch: [
    "**/test/**/*.test.js"
  ],
  "reporters": [
    "default",
    [
      "./node_modules/jest-html-reporter",
      {
        "pageTitle": "Gingee Test Report",
        "outputPath": "./test/test-report.html"
      }
    ]
  ]
};
