#!/usr/bin/env node
/**
 * Build every selected report.
 *
 * All the selection logic lives here rather than in the PowerShell and shell runners, so the two
 * platforms cannot drift into building different report sets. The shell wrappers are one line each.
 *
 *   node build-all.mjs --config <path> [--env <name>]
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './_history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, t, i, arr) => (t.startsWith('--') ? [...a, [t.slice(2), arr[i + 1]]] : a), []),
);
const configPath = args.config ?? 'pipeline.config.json';
const cfg = loadConfig(configPath);
const envs = (cfg.environments ?? []).filter((e) => e.enabled !== false).map((e) => e.name);
const only = args.env ? [args.env] : envs;

/**
 * Run one generator and report whether it actually produced a file.
 *
 * Exit status alone is not enough. A generator with no history to work from exits 0 having
 * deliberately written nothing, so counting exit-0 as "built" reports a full set of reports that
 * do not exist - which is worse than reporting none, because it stops anyone looking.
 */
function run(script, extra, outPath) {
  const before = fs.existsSync(outPath) ? fs.statSync(outPath).mtimeMs : -1;
  const r = spawnSync(process.execPath, [path.join(here, script), '--config', configPath, ...extra], {
    stdio: 'inherit',
  });
  // One failing report must not take out the rest. A single broken generator should cost one
  // report, not the whole set - the others are still worth having.
  if (r.status !== 0) { console.error(`[reports] ${script} exited ${r.status}`); return 'failed'; }
  const after = fs.existsSync(outPath) ? fs.statSync(outPath).mtimeMs : -1;
  return after > before ? 'built' : 'skipped';
}

let built = 0, failed = 0, skipped = 0;
const tally = (r) => { if (r === 'built') built++; else if (r === 'failed') failed++; else skipped++; };

if (!envs.length) {
  console.log('[reports] no environments are enabled in the config - nothing to build.');
  console.log('[reports] enable one with "enabled": true, or run /test-pipeline init.');
  process.exit(0);
}

// Per-environment reports.
for (const envName of only) {
  const out = (n) => `${cfg.reportsDir}/${n}-${envName}.html`;
  if (cfg.reports?.perRun) tally(run('per-run.mjs', ['--env', envName, '--out', out('per-run')], out('per-run')));
  if (cfg.reports?.perScenario) tally(run('per-scenario.mjs', ['--env', envName, '--out', out('per-scenario')], out('per-scenario')));
  if (cfg.reports?.dailyOnePager) tally(run('one-pager.mjs', ['--env', envName, '--out', out('one-pager')], out('one-pager')));
}

// Cross-environment. Spans every environment, so it is not part of the loop, and it is silently
// skipped with one environment rather than producing a page comparing something to itself.
if (cfg.reports?.comparison && envs.length > 1) {
  const out = `${cfg.reportsDir}/comparison.html`;
  tally(run('comparison.mjs', ['--out', out], out));
}

// PDFs, if a browser is available. Optional by design: a missing browser should cost the PDFs, not
// the HTML, and plenty of CI hosts have no Chromium at all.
if (cfg.reports?.pdf) {
  const r = spawnSync(process.execPath, [path.join(here, 'render-pdf.mjs'), '--config', configPath], { stdio: 'inherit' });
  if (r.status !== 0) console.log('[reports] PDF rendering unavailable - HTML reports are unaffected');
}

console.log(`[reports] ${built} built${failed ? `, ${failed} failed` : ''} -> ${cfg.reportsDir}`);
process.exit(failed ? 1 : 0);
