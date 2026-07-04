import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
    ssr: true,
    target: 'node20',
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});