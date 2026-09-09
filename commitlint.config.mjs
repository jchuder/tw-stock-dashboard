export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'breaking-change-exclamation-mark': [2, 'always'],
    'subject-case': [
      2,
      'always',
      ['sentence-case', 'start-case', 'pascal-case', 'lower-case'],
    ],
  },
};
