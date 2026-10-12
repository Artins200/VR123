#!/usr/bin/env node
/* Sheets -> generated/ts_data.h
   Every row of every sheet becomes exactly one C struct instance; every column becomes
   one field of that struct. The sheets are the source of truth: edit a sheet, re-run this. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHEETS = path.join(ROOT, 'sheets');
const OUT = path.join(ROOT, 'generated', 'ts_data.h');

const load = (n) => JSON.parse(fs.readFileSync(path.join(SHEETS, n), 'utf8'));

const CODEGEN = ['weapons', 'sounds', 'art', 'operators', 'objectives', 'economy', 'systems', 'hooks'];
const TYPE = { id: 'const char*', name: 'const char*' };

const cIdent = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_');
const cType = (col, v) => (TYPE[col] || (typeof v === 'boolean' ? 'int' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'double') : 'const char*'));
const cValue = (col, v) => {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
};

let out = '';
out += '/* GENERATED from sheets/ by tools/gen_data.mjs - do not edit by hand.\n';
out += '   One struct per sheet row, one field per sheet column. Change the sheet, then re-run:\n';
out += '       node tools/gen_data.mjs && node tools/preflight.mjs                              */\n';
out += '#ifndef TS_DATA_H\n#define TS_DATA_H\n\n';

const summary = [];
for (const name of CODEGEN) {
  const file = path.join(SHEETS, name + '.json');
  if (!fs.existsSync(file)) { console.error('missing sheet: ' + name); process.exit(1); }
  const sheet = load(name + '.json');
  const structName = 'ts_' + cIdent(name).replace(/s$/, '');
  const rows = sheet.rows ?? [];
  const cols = sheet.columns ?? Object.keys(rows[0] ?? {});

  out += `/* ---- sheets/${name}.json : ${rows.length} rows x ${cols.length} columns ---- */\n`;
  if (sheet.description) out += '/* ' + sheet.description.replace(/\*\//g, '* /') + ' */\n';
  out += `typedef struct ${structName} {\n`;
  for (const col of cols) {
    const sample = rows.find((r) => r[col] !== undefined)?.[col];
    out += `  ${cType(col, sample)} ${cIdent(col)};\n`;
  }
  out += '} ' + structName + ';\n\n';
  out += `static const ${structName} g_${cIdent(name)}[${rows.length}] = {\n`;
  for (const [i, row] of rows.entries()) {
    out += '  { ' + cols.map((c) => cValue(c, row[c])).join(', ') + ' }' + (i + 1 < rows.length ? ',' : '') + '\n';
  }
  out += '};\n';
  out += `#define TS_${cIdent(name).toUpperCase()}_COUNT ${rows.length}\n\n`;
  summary.push(`${name}: ${rows.length} rows -> g_${cIdent(name)}[]`);
}

const meta = load('meta.json');
out += '/* ---- sheets/meta.json ---- */\n';
out += '#define TS_TITLE ' + JSON.stringify(meta.title) + '\n';
out += '#define TS_TAGLINE ' + JSON.stringify(meta.tagline) + '\n';
out += '#define TS_VERSION ' + JSON.stringify(meta.version) + '\n';
out += '#define TS_HOST_SLUG ' + JSON.stringify(meta.host) + '\n';
out += '#define TS_CSS_SLUG ' + JSON.stringify(meta.companions[0]) + '\n';
out += '#define TS_MANIFEST_NAME "terrorstrike-manifest.json"\n';
out += '#define TS_MARK "TerrorStrike"\n\n';
out += '#endif /* TS_DATA_H */\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log('generated ' + path.relative(ROOT, OUT));
for (const s of summary) console.log('  ' + s);
