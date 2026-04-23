module.exports = {
  testMatch: ['**/__tests__/**/*.test.js'],
  testEnvironment: 'node',
  verbose: true,
  collectCoverageFrom: [
    'api/*.js',
    'models/*.js',
    '!node_modules/**',
  ],
};
