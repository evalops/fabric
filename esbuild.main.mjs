import * as esbuild from 'esbuild';

// Bundle main process files with esbuild.
// This lets us use ESM-only packages (like @mariozechner/pi-ai) in Electron's
// CommonJS main process — esbuild handles the ESM→CJS conversion.

const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  sourcemap: true,
  minify: false,
  external: [
    'electron',
    'pg',           // native module — must be required at runtime
    'pg-native',
  ],
};

await Promise.all([
  // Main process entry
  esbuild.build({
    ...shared,
    entryPoints: ['src/main.ts'],
    outfile: 'dist/main.js',
  }),
  // Preload script (runs in renderer context but needs node)
  esbuild.build({
    ...shared,
    entryPoints: ['src/preload.ts'],
    outfile: 'dist/preload.js',
  }),
]);
