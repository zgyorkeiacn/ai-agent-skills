#!/usr/bin/env node
/**
 * CI intake: read a finished pipeline run's test results from Azure DevOps or GitHub Actions
 * instead of running the suite, and record it in the SAME history through the existing adapters.
 *
 *   node ci-intake.mjs --config <path> --environment <name> [--dry-run]
 *
 * An environment is a CI environment when it has `"source": "ci"` and a `ci` block (see
 * pipeline.config.json). Per poll: list the newest completed runs, skip any already seen, fetch
 * results for the rest (oldest first), hand each to collect-run.mjs. A run id is never ingested
 * twice: it is looked up in history.jsonl AND in <runsDir>/ci-state.json (the state also remembers
 * runs that had no results, so one is not retried forever).
 *
 * Exit codes: 0 ingested at least one run, 10 nothing new, 3 could not poll (no token, HTTP error).
 * Like a local skip, a non-poll goes to skipped.log and never to history.jsonl.
 * Credentials: environment variable only (ci.tokenEnv), never a file, argument or log line.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { providers, makeHttp, readToken } from './ci/providers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** Playwright's adapter reads one file: turn a glob-ish result path into a concrete file. */
function concretePlaywright(p) {
  if (!p.includes('*')) return p;
  const prefix = p.split('*')[0];
  const files = walk(/[\\/]$/.test(prefix) ? prefix : path.dirname(prefix)).filter((f) => f.endsWith('.json'));
  return files.find((f) => path.basename(f) === 'results.json') ?? files[0] ?? p;
}

function readHistoryIds(historyPath) {
  if (!fs.existsSync(historyPath)) return new Set();
  const ids = new Set();
  for (const line of fs.readFileSync(historyPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { ids.add(JSON.parse(line).runId); } catch { /* doctor reports unparseable lines */ }
  }
  return ids;
}

/**
 * Poll one CI environment. `deps.http` replaces the real client in tests; `deps.collect` replaces
 * the collect-run subprocess. Returns { ingested: [runKey], skipped: [{key, why}], error }.
 */
export async function intake(cfg, envName, deps = {}) {
  const envCfg = (cfg.environments ?? []).find((e) => e.name === envName);
  if (!envCfg) throw new Error(`'${envName}' is not in the config.`);
  const ci = envCfg.ci;
  if (envCfg.source !== 'ci' || !ci) throw new Error(`'${envName}' is not a CI environment (source must be "ci" with a ci block).`);
  const provider = providers[ci.provider];
  if (!provider) throw new Error(`Unknown ci.provider "${ci.provider}". Available: ${Object.keys(providers).join(', ')}.`);

  const runsDir = cfg.runsDir ?? 'test-pipeline/runs';
  const historyPath = path.join(runsDir, 'history.jsonl');
  const statePath = path.join(runsDir, 'ci-state.json');
  const skipLog = path.join(runsDir, 'skipped.log');
  fs.mkdirSync(runsDir, { recursive: true });
  const skip = (key, why) => fs.appendFileSync(skipLog, `${new Date().toISOString().replace('T', ' ').slice(0, 19)}  ${key}  ${envName}  SKIPPED - ${why}\n`);

  let http = deps.http;
  if (!http) {
    const tok = readToken(ci, deps.env ?? process.env);
    if (!tok.value) {
      skip('ci-poll', `no token in environment variable ${tok.name}`);
      return { ingested: [], skipped: [{ key: 'ci-poll', why: `no token in ${tok.name}` }], error: true };
    }
    http = makeHttp(ci.provider, tok.value, deps.fetch);
  }

  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { seen: {} };
  const seenHist = readHistoryIds(historyPath);
  const out = { ingested: [], skipped: [], error: false };

  let runs;
  try { runs = await provider.listRuns(ci, http, ci.maxRunsPerPoll ?? 5); }
  catch (e) { skip('ci-poll', e.message); return { ...out, error: true, skipped: [{ key: 'ci-poll', why: e.message }] }; }

  const fresh = runs.filter((r) => !seenHist.has(r.key) && !state.seen[`${envName}:${r.key}`]).reverse();
  const collect = deps.collect ?? ((args) => execFileSync(process.execPath, [path.join(here, 'collect-run.mjs'), ...args], { stdio: 'inherit', env: { PATH: process.env.PATH } }));

  for (const run of fresh) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-ci-'));
    try {
      const res = await provider.fetchResults(ci, http, run, dir);
      if (!res) {
        skip(run.key, 'completed run has no test results to read');
        out.skipped.push({ key: run.key, why: 'no results' });
        state.seen[`${envName}:${run.key}`] = { at: new Date().toISOString(), outcome: 'no-results' };
        continue;
      }
      const resultsPath = res.kind === 'playwright' ? concretePlaywright(res.path) : res.path;
      const args = ['--config', deps.configPath ?? 'pipeline.config.json', '--run-id', run.key, '--env', envName,
        '--runner-kind', res.kind, '--results', resultsPath];
      if (run.startedAt) args.push('--started', run.startedAt);
      if (run.finishedAt) args.push('--finished', run.finishedAt);
      if (deps.dryRun) args.push('--dry-run');
      try { collect(args); }
      catch (e) {
        skip(run.key, 'results could not be read');
        out.skipped.push({ key: run.key, why: 'unreadable results' });
        state.seen[`${envName}:${run.key}`] = { at: new Date().toISOString(), outcome: 'unreadable' };
        continue;
      }
      if (!deps.dryRun) state.seen[`${envName}:${run.key}`] = { at: new Date().toISOString(), outcome: 'ingested' };
      out.ingested.push(run.key);
    } catch (e) {
      // Transient (HTTP) failure: not marked seen, so the next poll retries it.
      skip(run.key, e.message);
      out.skipped.push({ key: run.key, why: e.message });
      out.error = true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (!deps.dryRun) fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  const configPath = get('config') ?? 'pipeline.config.json';
  const envName = get('environment');
  if (!envName) { console.error('[ci] --environment is required.'); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  try {
    const r = await intake(cfg, envName, { configPath, dryRun: a.includes('--dry-run') });
    console.log(`[ci] ${envName}: ingested ${r.ingested.length}, skipped ${r.skipped.length}`);
    process.exit(r.error && !r.ingested.length ? 3 : r.ingested.length ? 0 : 10);
  } catch (e) { console.error(`[ci] ${e.message}`); process.exit(3); }
}
