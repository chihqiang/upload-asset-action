import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  platform: 'node',
  target: 'node20',
  bundle: true,
  clean: true,
  noExternal: [/./],
});
