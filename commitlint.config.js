// Commitlint Configuration
// Enforces Conventional Commits format
// https://www.conventionalcommits.org/

export default {
  extends: ['@commitlint/config-conventional'],

  rules: {
    // Type must be one of the specified values
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New feature
        'fix',      // Bug fix
        'docs',     // Documentation only
        'style',    // Code style (formatting, etc)
        'refactor', // Code refactoring
        'perf',     // Performance improvement
        'test',     // Adding/updating tests
        'build',    // Build system changes
        'ci',       // CI configuration
        'chore',    // Maintenance tasks
        'revert',   // Revert previous commit
      ],
    ],

    // Type must be lowercase
    'type-case': [2, 'always', 'lower-case'],

    // Type cannot be empty
    'type-empty': [2, 'never'],

    // Scope should be lowercase
    'scope-case': [2, 'always', 'lower-case'],

    // Subject cannot be empty
    'subject-empty': [2, 'never'],

    // Subject should not end with period
    'subject-full-stop': [2, 'never', '.'],

    // Subject should be sentence case
    'subject-case': [
      2,
      'never',
      ['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
    ],

    // Header max length
    'header-max-length': [2, 'always', 100],

    // Body max line length
    'body-max-line-length': [1, 'always', 200],

    // Footer max line length
    'footer-max-line-length': [1, 'always', 200],
  },

  // Custom help message
  helpUrl:
    'https://github.com/conventional-changelog/commitlint/#what-is-commitlint',
};
