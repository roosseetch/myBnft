// Minimal flat config: typescript-eslint recommended, nothing exotic.
import tseslint from 'typescript-eslint';

export default tseslint.config(...tseslint.configs.recommended, {
  rules: {
    // The camping.care API returns loosely-typed JSON; we validate at the edges.
    '@typescript-eslint/no-explicit-any': 'off',
  },
});
