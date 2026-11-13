import eslintConfigPrettier from 'eslint-config-prettier/flat';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import base from './base.js';

/**
 * React + TypeScript 平面配置（浏览器环境），播放器与 Electron 渲染层共用。
 * @type {import('eslint').Linter.Config[]}
 */
export default tseslint.config(
  ...base,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // props 由 TypeScript 约束，无需运行时 prop-types
      'react/prop-types': 'off',
    },
  },
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  // base 中的 Prettier 配置在前，这里需再次放到末尾，覆盖 React 插件的格式规则
  eslintConfigPrettier,
);
