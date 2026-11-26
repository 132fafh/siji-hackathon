'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'cloudflare-pages');
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(root, 'app'), output, { recursive: true });
execFileSync('npx --yes esbuild tools/cloudflare-worker-entry.js --bundle --format=esm --platform=neutral --target=es2022 --outfile=tools/cloudflare-pages/_worker.js', { cwd: root, stdio: 'inherit', shell: true });
console.log(`Cloudflare Pages 直传目录：${path.relative(root, output)}`);
