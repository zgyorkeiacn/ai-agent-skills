#!/usr/bin/env node
/**
 * Health check: is this pipeline actually running?
 *
 * The question nobody asks until the reports have been quietly stale for a week. A scheduled task
 * can be unregistered, disabled, failing to launch, or bailing before it reaches the code that
 * records anything - and every one of those looks identical from the outside: no new data, no
 * error, nobody notified.
 *
 * The check that matters most is #4. A firing that produced neither a history record NOR a skip-log
 * entry means something exited before it could report either, which is the failure mode that hides
 * indefinitely.
 *
 *   node doctor.mjs --config <path>
 *
 * Exits non-zero on any FAIL so it can be wired into monitoring.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadConfig, loadRuns, dayKey } from '../reports/_history.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, t, i, arr) => (t.startsWith('--') ? [...a, [t.slice(2), arr[i + 1]]] : a), []),
);
const configPath = args.config ?? 'pipeline.config.json';

const rows = [];
const add = (check, status, detail) => rows.push({ check, status, detail });

// ---- 1. Config ---------------------------------------------------------------
let cfg;
try {
  cfg = loadConfig(configPath);
  add('config', 'OK', `${configPath}, ${cfg.environments?.length ?? 0} environment(s)`);
} catch (e) {
  add('config', 'FAIL', `${configPath}: ${e.message}`);
  report();
  process.exit(1);
}

// Only enabled environments are checked. A disabled one has no task by design, so reporting it as
// a missing task would be a permanent false alarm - and a doctor that cries wolf gets ignored.
const envs = (cfg.environments ?? []).filter((e) => e.enabled !== false).map((e) => e.name);
const prefix = cfg.taskPrefix ?? 'TestPipeline';
const isWindows = os.platform() === 'win32';

// ---- 2 & 3. Scheduled tasks --------------------------------------------------
function windowsTask(name) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `$t=Get-ScheduledTask -TaskName '${name}' -ErrorAction SilentlyContinue; ` +
      `if(-not $t){'MISSING';exit}; $i=$t|Get-ScheduledTaskInfo; ` +
      `"$($t.State)|$($i.LastRunTime)|$($i.LastTaskResult)|$($i.NextRunTime)"`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out === 'MISSING' || !out) return null;
    const [state, last, result, next] = out.split('|');
    return { state, last, result, next };
  } catch { return null; }
}

function cronEntries() {
  try {
    return execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
}

const cron = isWindows ? '' : cronEntries();

for (const e of envs) {
  const name = `${prefix}-${e}`;
  if (isWindows) {
    const t = windowsTask(name);
    if (!t) { add(`task ${e}`, 'FAIL', `${name} is not registered - run install-schedule.ps1`); continue; }
    if (t.state === 'Disabled') { add(`task ${e}`, 'FAIL', `${name} is registered but DISABLED`); continue; }
    const resultNote = t.result === '0' ? 'last exit 0' : `last exit ${t.result}`;
    add(`task ${e}`, 'OK', `${t.state}, ${resultNote}, next ${t.next || 'unscheduled'}`);
  } else {
    const found = cron.split('\n').some((l) => l.includes(`--environment ${e}`) && !l.trim().startsWith('#'));
    add(`task ${e}`, found ? 'OK' : 'FAIL', found ? 'cron entry present' : `no cron entry - run install-schedule.sh`);
  }
}

// ---- 4. Recent activity, and the dangerous silent case -----------------------
const all = loadRuns(cfg, { env: 'all' });
const skipLogPath = path.join(cfg.runsDir, 'skipped.log');
const skipLog = fs.existsSync(skipLogPath) ? fs.readFileSync(skipLogPath, 'utf8') : '';

if (!all.length) {
  add('history', 'WARN', 'no runs recorded yet - expected if the pipeline was only just installed');
} else {
  const newest = all[all.length - 1];
  const ageH = (Date.now() - new Date(newest.startedAt ?? 0).getTime()) / 3.6e6;

  // A record dated in the future means a clock disagrees somewhere - the runner host, or a machine
  // that wrote into a shared history. Worth surfacing rather than rendering as a negative age,
  // because every day-grouping and every "last run" figure downstream inherits the error.
  if (ageH < -0.5) {
    add('clock', 'FAIL',
      `newest record is dated ${Math.abs(Math.round(ageH))}h in the FUTURE (${newest.runId}) - check the clock on the host that wrote it`);
  }
  // Tolerance is the schedule's own gap plus a margin, so a pipeline that runs daily is not
  // constantly reported as stale.
  const expectedGapH = Math.max(1, cfg.schedule?.everyHours ?? 1);
  const staleAfter = expectedGapH * 3 + 24;
  add('freshness',
    ageH > staleAfter ? 'FAIL' : ageH > expectedGapH * 3 ? 'WARN' : 'OK',
    `newest run ${Math.max(0, Math.round(ageH))}h ago (${newest.runId}, ${newest.env})`);

  for (const e of envs) {
    const mine = all.filter((r) => r.env === e);
    if (!mine.length) {
      // Distinguishing these two is the whole point: a logged skip is the pipeline working, an
      // absence of both is the pipeline failing silently.
      const skipped = skipLog.includes(` ${e} `);
      add(`activity ${e}`, skipped ? 'WARN' : 'FAIL',
        skipped
          ? 'never completed a run, but skips ARE being logged - the environment is being reached and declined'
          : 'never completed a run and never logged a skip - something is exiting before it can record either');
      continue;
    }
    const last = mine[mine.length - 1];
    const h = (Date.now() - new Date(last.startedAt ?? 0).getTime()) / 3.6e6;
    add(`activity ${e}`, h > staleAfter ? 'FAIL' : 'OK', `last run ${Math.max(0, Math.round(h))}h ago`);
  }

  // Days inside the schedule window with no record at all.
  const dayNames = new Set((cfg.schedule?.days ?? []).map((d) => d.toLowerCase()));
  const seen = new Set(all.map((r) => dayKey(r.startedAt ?? r.runId)));
  const gaps = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() - i * 864e5);
    const nm = d.toLocaleDateString('en-GB', { weekday: 'long' }).toLowerCase();
    if (dayNames.size && !dayNames.has(nm)) continue;
    const k = dayKey(d.toISOString());
    if (!seen.has(k)) gaps.push(k);
  }
  add('schedule gaps', gaps.length > 2 ? 'FAIL' : gaps.length ? 'WARN' : 'OK',
    gaps.length ? `no runs on: ${gaps.join(', ')}` : 'every scheduled day in the last week has runs');
}

// ---- 5. History integrity ----------------------------------------------------
const histPath = path.join(cfg.runsDir, 'history.jsonl');
if (fs.existsSync(histPath)) {
  let bad = 0, noEnv = 0, total = 0;
  for (const line of fs.readFileSync(histPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    total++;
    try {
      const r = JSON.parse(line);
      if (!r.env) noEnv++;
    } catch { bad++; }
  }
  add('history integrity',
    bad ? 'FAIL' : noEnv ? 'WARN' : 'OK',
    `${total} record(s)${bad ? `, ${bad} unparseable` : ''}${noEnv ? `, ${noEnv} with no environment` : ''}`);
} else {
  add('history integrity', 'WARN', 'no history file yet');
}

// ---- 6. Disk ------------------------------------------------------------------
function dirSize(d) {
  if (!fs.existsSync(d)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}
const mb = Math.round(dirSize(cfg.runsDir) / 1048576);
add('disk', mb > 2048 ? 'WARN' : 'OK', `${mb} MB in ${cfg.runsDir} (retention: ${cfg.retention?.runLogs ?? 200} logs)`);

// ---- Output --------------------------------------------------------------------
function report() {
  const w = Math.max(...rows.map((r) => r.check.length), 8);
  console.log('');
  console.log(`  ${'CHECK'.padEnd(w)}  STATUS  DETAIL`);
  console.log(`  ${'-'.repeat(w)}  ------  ${'-'.repeat(46)}`);
  for (const r of rows) {
    console.log(`  ${r.check.padEnd(w)}  ${r.status.padEnd(6)}  ${r.detail}`);
  }
  const fail = rows.filter((r) => r.status === 'FAIL').length;
  const warn = rows.filter((r) => r.status === 'WARN').length;
  console.log('');
  console.log(fail ? `  ${fail} FAIL, ${warn} WARN` : warn ? `  healthy, ${warn} warning(s)` : '  all checks healthy');
}

report();
process.exit(rows.some((r) => r.status === 'FAIL') ? 1 : 0);
