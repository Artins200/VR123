#!/usr/bin/env node
/* Packs the release: the launcher plus licence and readme. Nothing from either game. */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'sheets', 'meta.json'), 'utf8'));
const exe = path.join(ROOT, 'dist', 'TerrorStrike.exe');
if (!fs.existsSync(exe)) { console.error('build first: bash tests/run_tests.sh'); process.exit(1); }

const stage = path.join(ROOT, 'dist', 'stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.copyFileSync(exe, path.join(stage, 'TerrorStrike.exe'));
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(stage, 'LICENSE.txt'));
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  .replace(/^# Yuri's Revenge: Terror Strike/, '# Yuri\'s Revenge: Terror Strike\n\n' + meta.tagline);
fs.writeFileSync(path.join(stage, 'README.txt'), readme);

const zip = path.join(ROOT, 'dist', `TerrorStrike-${meta.version}.zip`);
fs.rmSync(zip, { force: true });
execSync(`cd "${stage}" && zip -q -9 -X "${zip}" TerrorStrike.exe LICENSE.txt README.txt`);
const bytes = fs.readFileSync(zip);
console.log('package : ' + path.relative(ROOT, zip));
console.log('size    : ' + bytes.length);
console.log('sha256  : ' + crypto.createHash('sha256').update(bytes).digest('hex'));
console.log('entries :');
for (const f of ['TerrorStrike.exe', 'LICENSE.txt', 'README.txt']) console.log('  ' + f + '  ' + fs.statSync(path.join(stage, f)).size + ' bytes');
