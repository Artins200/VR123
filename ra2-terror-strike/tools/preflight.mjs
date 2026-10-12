#!/usr/bin/env node
/* Preflight: lay every sheet's rows and columns over each other.
   Reports every unfilled cell and every cross-sheet reference that does not resolve.
   Build only when this exits 0. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHEETS = path.join(ROOT, 'sheets');
const load = (n) => JSON.parse(fs.readFileSync(path.join(SHEETS, n), 'utf8'));

const problems = [];
const notes = [];
const sheets = {};
for (const f of fs.readdirSync(SHEETS).sort()) {
  const s = load(f);
  sheets[path.basename(f, '.json')] = s;
}

const idOf = (name) => new Set((sheets[name]?.rows ?? []).map((r) => r.id));

/* 1. every row x column crossing is filled */
for (const [name, sheet] of Object.entries(sheets)) {
  if (!Array.isArray(sheet.rows)) continue;
  if (!Array.isArray(sheet.columns)) {
    problems.push(`${name}: no "columns" list, cannot check the grid`);
    continue;
  }
  if (sheet.rows.length === 0) problems.push(`${name}: sheet has no rows`);
  for (const [i, row] of sheet.rows.entries()) {
    const label = row.id ?? `row ${i}`;
    for (const col of sheet.columns) {
      const v = row[col];
      if (v === undefined) problems.push(`${name}/${label}: column "${col}" is missing`);
      else if (v === null || v === '') problems.push(`${name}/${label}.${col} is empty`);
      else if (typeof v === 'string' && v.trim() === '') problems.push(`${name}/${label}.${col} is blank`);
    }
    for (const k of Object.keys(row)) {
      if (!sheet.columns.includes(k)) notes.push(`${name}/${label}: extra key "${k}" is not in columns`);
    }
  }
}

/* 2. every reference between sheets resolves */
const refs = [
  ['weapons', 'sound', 'sounds'], ['weapons', 'cameo', 'art'],
  ['operators', 'cameo', 'art'], ['operators', 'primary', 'weapons'],
  ['operators', 'secondary', 'weapons'],
  ['objectives', 'carrier', 'operators'], ['objectives', 'weapon', 'weapons'],
  ['objectives', 'plantSound', 'sounds'], ['objectives', 'beepSound', 'sounds'],
  ['objectives', 'boomSound', 'sounds'], ['objectives', 'defuseSound', 'sounds'],
];
for (const [from, col, to] of refs) {
  const have = idOf(to);
  for (const row of sheets[from]?.rows ?? []) {
    const v = row[col];
    if (v === undefined || v === '') continue;
    if (!have.has(v)) problems.push(`${from}/${row.id}.${col} -> "${v}" does not exist in ${to}.json`);
  }
}

/* 3. every RA2/YR identifier is legal for the host game's INI parser */
const ident = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;
for (const row of sheets.weapons?.rows ?? []) if (!ident.test(row.raName)) problems.push(`weapons/${row.id}.raName "${row.raName}" is not a legal RA2 identifier (max 12 chars)`);
for (const row of sheets.operators?.rows ?? []) if (!ident.test(row.raUid)) problems.push(`operators/${row.id}.raUid "${row.raUid}" is not a legal RA2 identifier`);
for (const row of sheets.sounds?.rows ?? []) if (!ident.test(row.raName)) problems.push(`sounds/${row.id}.raName "${row.raName}" is not a legal RA2 identifier`);
for (const row of sheets.art?.rows ?? []) if (!ident.test(row.raName)) problems.push(`art/${row.id}.raName "${row.raName}" is not a legal RA2 identifier`);

/* 4. unique identifiers inside each sheet */
for (const [name, sheet] of Object.entries(sheets)) {
  if (!Array.isArray(sheet.rows)) continue;
  const seen = new Map();
  for (const row of sheet.rows) {
    if (!row.id) continue;
    if (seen.has(row.id)) problems.push(`${name}: duplicate id "${row.id}"`);
    seen.set(row.id, true);
  }
}

/* 5. every system row points at a source file that exists */
for (const row of sheets.systems?.rows ?? []) {
  const m = String(row.implementedBy).match(/src\/[A-Za-z0-9_./]+/g) ?? [];
  if (!m.length) problems.push(`systems/${row.id}: implementedBy names no src/ file`);
  for (const f of m) if (!fs.existsSync(path.join(ROOT, f))) problems.push(`systems/${row.id}: ${f} does not exist`);
}

/* 6. meta has everything the listing needs */
const meta = sheets.meta;
for (const k of ['title', 'tagline', 'host', 'license', 'version']) {
  if (!meta[k]) problems.push(`meta.json: "${k}" is missing`);
}
if (!Array.isArray(meta.companions) || !meta.companions.length) problems.push('meta.json: no companion games, so this is not a mashup');

/* 7. hooks cover the host and every companion exactly once, with a folder env */
const hookRoles = new Map();
for (const row of sheets.hooks?.rows ?? []) {
  hookRoles.set(row.role, (hookRoles.get(row.role) ?? 0) + 1);
  if (!row.folderEnv) problems.push(`hooks/${row.id}: no folderEnv, Melty cannot hand the folder over`);
  if (!Array.isArray(row.markers) || !row.markers.length) problems.push(`hooks/${row.id}: no markers to identify the folder`);
  if (!Array.isArray(row.reads) || !row.reads.length) problems.push(`hooks/${row.id}: nothing is read from the game`);
}
if (hookRoles.get('primary') !== 1) problems.push(`hooks: exactly one row must have role "primary", found ${hookRoles.get('primary') ?? 0}`);
const companionCount = (meta.companions || []).length;
if ((hookRoles.get('companion') ?? 0) !== companionCount) problems.push(`hooks: ${companionCount} companions declared in meta.json but ${hookRoles.get('companion') ?? 0} companion hooks`);
if (sheets.hooks?.rows?.some((r) => r.role === 'secondary')) problems.push('hooks: role "secondary" is not a mashup, it means the game is only nodded to');
for (const slug of meta.companions ?? []) if (!sheets.hooks.rows.some((r) => r.slug === slug)) problems.push(`hooks: companion ${slug} from meta.json has no hook row`);
if (!sheets.hooks.rows.some((r) => r.slug === meta.host)) problems.push(`hooks: host ${meta.host} from meta.json has no hook row`);

/* 8. nothing that is only a placeholder survives */
for (const [name, sheet] of Object.entries(sheets)) {
  for (const row of sheet.rows ?? []) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && /^(todo|tbd|fixme|\?\?\?|xxx)$/i.test(v.trim())) problems.push(`${name}/${row.id}.${k} is still "${v}"`);
    }
  }
}


/* 9. every conversion row is clamped, and every donor body is a real host-game infantry name */
const DONOR_BODIES = ['E1','E2','GGI','SNIPE','SEAL','TERROR','INIT','BRUTE','TANY'];
for (const row of sheets.weapons?.rows ?? []) {
  if (!(row.minDamage > 0) || !(row.maxDamage > row.minDamage)) problems.push(`weapons/${row.id}: damage clamp ${row.minDamage}..${row.maxDamage} is not usable`);
  if (!(row.minRof > 0) || !(row.maxRof > row.minRof)) problems.push(`weapons/${row.id}: rof clamp ${row.minRof}..${row.maxRof} is not usable`);
  if (!(row.minRange > 0) || !(row.maxRange > row.minRange)) problems.push(`weapons/${row.id}: range clamp ${row.minRange}..${row.maxRange} is not usable`);
  if (!(row.damageScale > 0)) problems.push(`weapons/${row.id}: damageScale must be positive`);
  if (!(row.rofScale > 0)) problems.push(`weapons/${row.id}: rofScale must be positive`);
  if (!(row.rangeScale > 0)) problems.push(`weapons/${row.id}: rangeScale must be positive`);
  if (!DONOR_BODIES.includes(row.donorBody)) problems.push(`weapons/${row.id}: donorBody "${row.donorBody}" is not a known host-game infantry name`);
}
for (const row of sheets.operators?.rows ?? []) {
  if (!DONOR_BODIES.includes(row.bodyArt)) problems.push(`operators/${row.id}: bodyArt "${row.bodyArt}" is not a known host-game infantry name`);
  if (!DONOR_BODIES.includes(row.bodyArtFallback)) problems.push(`operators/${row.id}: bodyArtFallback "${row.bodyArtFallback}" is not a known host-game infantry name`);
}
for (const row of sheets.sounds?.rows ?? []) {
  if (row.enabled !== true && row.enabled !== false) problems.push(`sounds/${row.id}: enabled must be true or false`);
}
for (const row of sheets.art?.rows ?? []) {
  if (row.width <= 0 || row.height <= 0) problems.push(`art/${row.id}: cameo size must be positive`);
  if (row.fallback !== 'donor') problems.push(`art/${row.id}: fallback "${row.fallback}" is not a known fallback strategy`);
}

let cells = 0;
for (const sheet of Object.values(sheets)) cells += (sheet.rows?.length ?? 0) * (sheet.columns?.length ?? 0);

console.log(`preflight: ${Object.keys(sheets).length} sheets, ${cells} row x column cells, ${refs.length} cross-sheet reference kinds`);
for (const n of notes) console.log('  note: ' + n);
if (problems.length) {
  console.log(`\nUNRESOLVED (${problems.length}):`);
  for (const p of problems) console.log('  x ' + p);
  process.exit(1);
}
console.log('preflight clean: every cell filled, every reference resolves.');
