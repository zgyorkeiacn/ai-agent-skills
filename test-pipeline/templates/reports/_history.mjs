/**
 * Loading and scoping the history.
 *
 * Every report goes through here, so they cannot disagree about which runs exist, which hours are
 * excluded, or how a signature is spelled. Two reports built from the same history that report
 * different totals are worse than either of them being wrong on its own - the reader stops trusting
 * both, and has no way to tell which one to believe.
 */

import fs from 'node:fs';
import path from 'node:path';
import { normaliseSignature } from '../lib/normalise.mjs';

export function loadConfig(configPath) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  cfg.runsDir ??= 'test-pipeline/runs';
  cfg.reportsDir ??= 'test-pipeline/reports';
  return cfg;
}

export function loadKnowledge(cfg) {
  const p = path.join(cfg.pipelineDir ?? 'test-pipeline', 'knowledge.yaml');
  if (!fs.existsSync(p)) return { signatures: {} };
  // Deliberately a minimal parser rather than a YAML dependency: the schema is two levels deep and
  // fixed, and the scaffolded pipeline having zero install-time dependencies is worth more than
  // supporting anchors and flow mappings nobody will write here. See knowledge-file.md.
  const out = { signatures: {} };
  let current = null;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = line.match(/^ {2}(?:"([^"]+)"|'([^']+)'|([^:]+)):\s*$/);
    if (top && /^ {2}\S/.test(line)) { current = top[1] ?? top[2] ?? top[3]; out.signatures[current] = {}; continue; }
    const kv = line.match(/^ {4}(\w+):\s*(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (kv && current) out.signatures[current][kv[1]] = (kv[2] ?? kv[3] ?? kv[4] ?? '').trim();
  }
  return out;
}

/** Local-time day key. Used by EVERY report - see the warning in classify.mjs. */
export function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startHour(run) {
  const d = new Date(run.startedAt ?? '');
  if (!Number.isNaN(d.getTime())) return d.getHours();
  return Number(String(run.runId ?? '').slice(11, 13));
}

/**
 * Read the history, scoped and normalised.
 *
 * @param {object} cfg
 * @param {object} [opts]
 * @param {string} [opts.env]  one environment name, or 'all'
 */
export function loadRuns(cfg, { env = 'all' } = {}) {
  const p = path.join(cfg.runsDir, 'history.jsonl');
  if (!fs.existsSync(p)) return [];

  const exclude = new Set((cfg.analysis?.excludeHours ?? []).map(Number));
  const normalise = cfg.analysis?.normaliseSignatures !== false;
  const want = String(env).toLowerCase();

  const runs = [];
  let bad = 0;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r;
    // A corrupt line is skipped and counted, never fatal. One truncated write - a machine losing
    // power mid-append - must not take out every report built from months of good records.
    try { r = JSON.parse(line); } catch { bad++; continue; }

    if (want !== 'all' && String(r.env ?? '').toLowerCase() !== want) continue;
    if (exclude.has(startHour(r))) continue;

    if (normalise) {
      r.failureDetail = (r.failureDetail ?? []).map((d) => ({
        ...d, signature: normaliseSignature(d.signature),
      }));
      // Rebuild the counts from the normalised detail so the two can never disagree, using the same
      // definition collect-run.mjs used: distinct test files affected.
      const bySig = new Map();
      for (const d of r.failureDetail) {
        if (d.transient) continue;
        let s = bySig.get(d.signature);
        if (!s) { s = new Set(); bySig.set(d.signature, s); }
        s.add(d.spec);
      }
      r.failures = Object.fromEntries([...bySig].map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1]));
    }
    runs.push(r);
  }

  if (bad) console.warn(`[reports] skipped ${bad} unparseable history line(s)`);
  runs.sort((a, b) => String(a.startedAt ?? a.runId).localeCompare(String(b.startedAt ?? b.runId)));
  return runs;
}

/** Group runs by environment, preserving config order. */
export function byEnvironment(cfg, runs) {
  const out = {};
  for (const e of (cfg.environments ?? []).filter((x) => x.enabled !== false)) out[e.name] = [];
  for (const r of runs) (out[r.env] ??= []).push(r);
  return out;
}

/** The environment label to print, taken from the data rather than from any constant. */
export function envLabel(runs, fallback = 'unknown') {
  const last = runs[runs.length - 1];
  return last?.env ?? fallback;
}

export function dateRange(runs) {
  if (!runs.length) return '';
  const a = dayKey(runs[0].startedAt ?? runs[0].runId);
  const b = dayKey(runs[runs.length - 1].startedAt ?? runs[runs.length - 1].runId);
  return a === b ? a : `${a} to ${b}`;
}

export function writeReport(outPath, html) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`[reports] ${outPath}`);
}
