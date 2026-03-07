import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/renderer/renderer.ts'],
  bundle: true,
  outfile: 'dist/renderer/renderer.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: false,
});
