import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

// 버그성 규칙만 전체 재포맷 없이 적용한다. 스타일 규칙은 의도적으로 비활성화한다.
const errorLevelRules = {
  ...js.configs.recommended.rules,
  // 기존 코드베이스에서 정당하게 쓰이는 패턴이라 끈다 (스타일/설계 취향이지 버그가 아님).
  'no-empty': 'off',
  'no-cond-assign': 'off',
  'no-case-declarations': 'off',
  'no-prototype-builtins': 'off',
};

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'data/**',
      'samples/**',
      'docs/**',
      'submission/**',
      // Bundled by desktop/scripts/build-renderer.mjs (esbuild output, includes react/three) —
      // not source, not meant to be linted.
      'desktop/src/renderer/atom-view.bundle.js',
    ],
  },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...errorLevelRules,
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-key': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'no-unused-vars': [
        'error',
        { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    // src/App.jsx는 13,000줄 규모의 레거시 파일로, 미사용 함수/훅 변수가 많다.
    // 여기서 일괄 삭제하면 Phase 5 훅 추출 리팩터링 전에 검증 없이 동작을 바꿀 위험이 크므로
    // 이 파일에 한해 no-unused-vars를 warn으로 낮춘다 (CI는 통과하되 계속 드러나게 유지).
    files: ['src/App.jsx'],
    rules: {
      'no-unused-vars': 'warn',
    },
  },
  prettierConfig,
];
