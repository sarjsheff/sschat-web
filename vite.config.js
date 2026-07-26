import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const gitVersion = (() => {
  try { return execSync('git describe --tags --always --dirty', { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
})();
const buildTime = new Date().toISOString().slice(0, 19).replace('T', ' ');

// Пишем версию в файл — чтобы работало в dev и build без магии с define/globals
writeFileSync(
  new URL('./src/build-info.js', import.meta.url).pathname,
  `// Auto-generated.\nexport const BUILD_INFO = ${JSON.stringify({ version: gitVersion, built: buildTime })};\n`
);

export default defineConfig({
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  build: { target: 'es2021', minify: 'esbuild', sourcemap: false },
});