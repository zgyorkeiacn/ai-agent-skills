#!/usr/bin/env node
'use strict';
/*
 * check-module-index.js - deterministic drift check for CODEBASE_INDEX.md.
 * Part of the index-codebase skill (Mode 4 lint + CI gate). No dependencies.
 *
 * Exits non-zero when a source file has no row (missing) or a row points at a
 * file that no longer exists (orphan). Over-long role cells (> ROLE_MAX chars)
 * are reported as advisory warnings only and never fail the run.
 *
 * Run from the repo root:  node path/to/check-module-index.js
 */
const fs = require('fs');
const path = require('path');

const ROLE_MAX = 140;
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.java', '.py', '.go', '.rs']);
const EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'target', '.venv', 'venv',
  'vendor', '__pycache__', '.next', 'coverage', '__mocks__',
]);
const SOURCE_ROOTS = ['src', 'lib', 'app', 'main'];

const repoRoot = process.cwd();

function findIndex() {
  for (const rel of ['docs/CODEBASE_INDEX.md', 'CODEBASE_INDEX.md']) {
    const p = path.join(repoRoot, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isTestOrGenerated(rel) {
  const l = rel.toLowerCase();
  if (l.endsWith('.d.ts')) return true;
  if (/\.(test|spec)\.[a-z0-9]+$/.test(l)) return true;
  if (/(^|\/)(test|tests)\//.test(l)) return true;
  if (/(^|\/)test_[^/]*\.py$/.test(l)) return true;
  if (/_test\.(py|go)$/.test(l)) return true;
  if (/test\.java$/.test(l)) return true;
  if (/(^|\/)generated\//.test(l)) return true;
  return false;
}

function walk(absDir, acc) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(abs, acc);
    } else if (e.isFile()) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
      if (SOURCE_EXT.has(path.extname(e.name)) && !isTestOrGenerated(rel)) acc.push(rel);
    }
  }
}

function globSourceFiles() {
  const roots = SOURCE_ROOTS
    .map((r) => path.join(repoRoot, r))
    .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  const acc = [];
  if (roots.length === 0) walk(repoRoot, acc);
  else roots.forEach((r) => walk(r, acc));
  return acc;
}

function main() {
  const indexPath = findIndex();
  if (!indexPath) {
    console.error('check-module-index: no CODEBASE_INDEX.md found (looked in docs/ and repo root).');
    process.exit(2);
  }
  const indexDir = path.dirname(indexPath);
  const lines = fs.readFileSync(indexPath, 'utf-8').split(/\r?\n/);

  const indexed = new Set(); // repoRoot-relative source files that have a link in the index
  const orphans = new Set();
  const roleTooLong = [];
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;

  for (const line of lines) {
    if (!line.includes('](')) continue;

    // Every source-file link on the line (covers per-directory rows + the module map).
    let m;
    while ((m = linkRe.exec(line)) !== null) {
      const target = m[1].trim().split('#')[0];
      if (!target || !SOURCE_EXT.has(path.extname(target).toLowerCase())) continue;
      const candidates = [path.resolve(indexDir, target), path.resolve(repoRoot, target)];
      const hit = candidates.find((p) => fs.existsSync(p));
      if (hit) indexed.add(path.relative(repoRoot, hit).split(path.sep).join('/'));
      else orphans.add(target);
    }

    // Role-length: only genuine file rows (link in the first data cell, role in the second).
    const cells = line.split('|');
    if (cells.length >= 4) {
      const fm = /\(([^)]+)\)/.exec(cells[1] || '');
      const role = (cells[2] || '').trim();
      if (fm && SOURCE_EXT.has(path.extname(fm[1].trim().split('#')[0]).toLowerCase()) && role.length > ROLE_MAX) {
        roleTooLong.push({ len: role.length, preview: role.slice(0, 60) });
      }
    }
  }

  const sourceFiles = globSourceFiles();
  const missing = sourceFiles.filter((f) => !indexed.has(f));
  const orphanList = [...orphans];

  console.log(`check-module-index: ${path.relative(repoRoot, indexPath).split(path.sep).join('/')}`);
  console.log(`  source files: ${sourceFiles.length}, indexed source links: ${indexed.size}`);
  console.log(`  missing (source file with no row): ${missing.length}`);
  missing.slice(0, 50).forEach((f) => console.log(`    [missing] ${f}`));
  console.log(`  orphan (row -> nonexistent file): ${orphanList.length}`);
  orphanList.slice(0, 50).forEach((f) => console.log(`    [orphan]  ${f}`));
  if (roleTooLong.length) {
    console.log(`  warning: ${roleTooLong.length} role cell(s) over ${ROLE_MAX} chars (advisory, non-blocking):`);
    roleTooLong.slice(0, 20).forEach((r) => console.log(`    [role>${ROLE_MAX}] (${r.len}) ${r.preview}...`));
  }

  if (missing.length > 0 || orphanList.length > 0) {
    console.error('check-module-index: DRIFT DETECTED. Run `/index-codebase refresh` to fix.');
    process.exit(1);
  }
  console.log('check-module-index: OK (no missing/orphan rows).');
  process.exit(0);
}

main();
