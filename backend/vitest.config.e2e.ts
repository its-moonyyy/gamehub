import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * E2E tests boot the real Nest app (AppModule), so the transform must emit
 * decorator metadata — TypeORM column types and Nest dependency injection
 * rely on it. That's why this config uses SWC instead of esbuild.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
