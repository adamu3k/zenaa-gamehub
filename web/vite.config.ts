import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

/** Writes .br and .gz copies of the built files so the server can send them compressed (3–5× smaller). */
function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'zenaa-precompress',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (/\.(js|css|html|svg|json|webmanifest|txt)$/.test(f) && statSync(p).size > 1024) {
            const buf = readFileSync(p);
            writeFileSync(`${p}.gz`, gzipSync(buf, { level: 9 }));
            writeFileSync(`${p}.br`, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
          }
        }
      };
      walk(outDir);
    },
  };
}

export default defineConfig({
  plugins: [react(), precompress()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
});
