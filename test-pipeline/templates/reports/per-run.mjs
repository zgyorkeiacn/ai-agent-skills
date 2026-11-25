#!/usr/bin/env node
/**
 * Per-run detail report.
 *
 * Two views of the same history:
 *   1. one row per run - what happened, and how long it took
 *   2. a test-by-run grid - which is what separates a flaky test from a consistently broken one
 *
 * The grid is the reason this report exists. A pass-rate column alone cannot tell you whether 60%
 * means "fails every afternoon" or "fails at random", and those need completely different
 * responses.
 *
 *   node per-run.mjs --config <path> --env <name> --out <path>
 */

import { loadConfig, loadRuns, loadKnowledge, dayKey, dateRange, writeReport } from './_history.mjs';
import { page, esc, shortName, pct, band, kpi } from './_html.mjs';
import { buildClassifier } from '../lib/classify.mjs';
import { buildReasonKeys, sourceOf, KINDS } from '../lib/signature.mjs';
import { classifyFlakes, explainFlake } from '../lib/flake.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, t, i, arr) => (t.startsWith('--') ? [...a, [t.slice(2), arr[i + 1]]] : a), []),
);
const cfg = loadConfig(args.config ?? 'pipeline.config.json');
const runs = loadRuns(cfg, { env: args.env ?? 'all' });

if (!runs.length) {
  console.log(`[per-run] no runs recorded for ${args.env ?? 'all'} - nothing to report yet`);
  process.exit(0);
}

const envName = args.env ?? 'all';
const knowledge = loadKnowledge(cfg);
const { classify, rationale, verified } = buildClassifier(runs, dayKey, knowledge);
const { reasonKey, totalFor } = buildReasonKeys(runs);
const flakes = classifyFlakes(runs);

const totals = runs.reduce((a, r) => ({
  passed: a.passed + (r.suite?.passed ?? 0),
  failed: a.failed + (r.suite?.failed ?? 0),
  flaky: a.flaky + (r.suite?.flaky ?? 0),
  skipped: a.skipped + (r.suite?.skipped ?? 0),
}), { passed: 0, failed: 0, flaky: 0, skipped: 0 });
const executed = totals.passed + totals.failed + totals.flaky;
const rate = pct(totals.passed + totals.flaky, executed);

// ---- Runs table ------------------------------------------------------------
const days = new Map();
for (const r of runs) {
  const k = dayKey(r.startedAt ?? r.runId);
  if (!days.has(k)) days.set(k, []);
  days.get(k).push(r);
}

let runRows = '';
for (const [day, drs] of [...days].reverse()) {
  const d = drs.reduce((a, r) => ({
    p: a.p + (r.suite?.passed ?? 0), f: a.f + (r.suite?.failed ?? 0),
    k: a.k + (r.suite?.flaky ?? 0), s: a.s + (r.suite?.skipped ?? 0),
  }), { p: 0, f: 0, k: 0, s: 0 });
  const dRate = pct(d.p + d.k, d.p + d.f + d.k);
  runRows += `<tr><th colspan="2">${esc(day)}</th>
    <td class="num">${drs.length} run(s)</td>
    <td class="num ok">${d.p}</td><td class="num ${d.f ? 'bad' : ''}">${d.f}</td>
    <td class="num ${d.k ? 'warn' : ''}">${d.k}</td><td class="num na">${d.s}</td>
    <td class="num ${band(dRate)}">${dRate === null ? 'n/a' : dRate + '%'}</td></tr>`;
  for (const r of drs) {
    const t = new Date(r.startedAt ?? '');
    const hhmm = Number.isNaN(t.getTime()) ? String(r.runId).slice(11, 16).replace('-', ':') : t.toTimeString().slice(0, 5);
    const s = r.suite ?? {};
    const rr = pct((s.passed ?? 0) + (s.flaky ?? 0), (s.passed ?? 0) + (s.failed ?? 0) + (s.flaky ?? 0));
    runRows += `<tr><td class="muted"></td><td class="mono">${esc(hhmm)}</td>
      <td class="num muted">${s.durationSec ? Math.round(s.durationSec / 60) + 'm' : ''}</td>
      <td class="num">${s.passed ?? 0}</td><td class="num ${s.failed ? 'bad' : ''}">${s.failed ?? 0}</td>
      <td class="num ${s.flaky ? 'warn' : ''}">${s.flaky ?? 0}</td><td class="num na">${s.skipped ?? 0}</td>
      <td class="num ${band(rr)}">${rr === null ? 'n/a' : rr + '%'}</td></tr>`;
  }
}

// ---- Test-by-run grid ------------------------------------------------------
const files = [...new Set(runs.flatMap((r) => (r.specs ?? []).map((s) => s.file)))];
const statusOf = new Map(runs.map((r) => [r.runId, new Map((r.specs ?? []).map((s) => [s.file, s.status]))]));
const causeOf = new Map(runs.map((r) => [r.runId, new Map((r.failureDetail ?? []).map((d) => [d.spec, d.signature]))]));

const ranked = files.map((f) => {
  const v = flakes.get(f) ?? { pass: 0, fail: 0, runs: 0, state: 'INSUFFICIENT' };
  return { f, v, rate: v.runs ? pct(v.pass, v.runs) : null };
}).sort((a, b) => {
  // Never-executed sorts last: a coverage gap, not a failure, and it would otherwise sit at the top
  // forever looking like the worst thing in the suite.
  if (a.rate === null) return 1;
  if (b.rate === null) return -1;
  return a.rate - b.rate;
});

const STATE_CLS = { BROKEN: 'bad', FLAKY: 'warn', HEALTHY: 'ok', INSUFFICIENT: 'na' };

let gridHead = '<tr><th>Test</th>';
for (const r of runs) {
  const t = new Date(r.startedAt ?? '');
  gridHead += `<th class="num mono small" title="${esc(r.runId)}">${Number.isNaN(t.getTime()) ? '' : t.toTimeString().slice(0, 5)}</th>`;
}
gridHead += '<th class="num">Rate</th><th>Verdict</th></tr>';

let gridRows = '';
for (const { f, v, rate: rr } of ranked) {
  gridRows += `<tr><td class="mono small">${esc(shortName(f))}</td>`;
  for (const r of runs) {
    const st = statusOf.get(r.runId)?.get(f);
    if (st === undefined) { gridRows += '<td class="na"></td>'; continue; }
    if (st === 'passed') { gridRows += '<td class="ok num">&#10003;</td>'; continue; }
    if (st === 'skipped') { gridRows += '<td class="na num">&ndash;</td>'; continue; }
    if (st === 'flaky') { gridRows += '<td class="warn num" title="passed on retry">~</td>'; continue; }
    const key = reasonKey.get(causeOf.get(r.runId)?.get(f)) ?? 'F?';
    gridRows += `<td class="bad num mono" title="${esc(causeOf.get(r.runId)?.get(f) ?? '')}">${esc(key)}</td>`;
  }
  gridRows += `<td class="num ${band(rr)}">${rr === null ? 'n/a' : rr + '%'}</td>`;
  gridRows += `<td class="small ${STATE_CLS[v.state]}" title="${esc(explainFlake(v))}">${esc(v.state)}</td></tr>`;
}

// ---- Failure legend --------------------------------------------------------
const sigs = [...new Set(runs.flatMap((r) => Object.keys(r.failures ?? {})))]
  .sort((a, b) => totalFor(b) - totalFor(a));

let legend = '';
for (const sig of sigs) {
  const owner = classify(sig);
  const src = sourceOf(sig, '');
  const k = KINDS[src.kind];
  const v = verified(sig);
  legend += `<tr>
    <td class="mono">${esc(reasonKey.get(sig))}</td>
    <td class="mono small">${esc(sig)}</td>
    <td><span class="pill">${esc(k.label)}</span> ${esc(src.name)}</td>
    <td class="num">${totalFor(sig)}</td>
    <td class="${owner === 'ENVIRONMENT' ? 'bad' : owner === 'TEST' ? 'warn' : 'na'}">${esc(owner)}</td>
    <td class="small muted">${esc(v?.what ?? rationale(sig))}</td>
  </tr>`;
}

const body = `
<div class="kpis">
  ${kpi(runs.length, 'runs recorded')}
  ${kpi(rate === null ? 'n/a' : rate + '%', 'pass rate', band(rate))}
  ${kpi(totals.failed, 'failed executions', totals.failed ? 'bad' : '')}
  ${kpi(totals.flaky, 'passed on retry', totals.flaky ? 'warn' : '')}
  ${kpi([...flakes.values()].filter((v) => v.state === 'FLAKY').length, 'flaky tests', 'warn')}
</div>

<h2>Per run</h2>
<table><thead><tr><th>Day</th><th>Time</th><th class="num">Duration</th>
<th class="num">Pass</th><th class="num">Fail</th><th class="num">Retry-pass</th>
<th class="num">Skip</th><th class="num">Rate</th></tr></thead><tbody>${runRows}</tbody></table>

<h2>Per test, run by run</h2>
<p class="sub">A tick is a pass, a dash was not executed, a tilde passed on retry, and an
<span class="mono">F</span>-key is a failure pointing at its cause below. Reading across a row tells
you whether a test is flaky or consistently broken; reading down a column tells you whether one run
went wrong everywhere.</p>
<div style="overflow-x:auto"><table><thead>${gridHead}</thead><tbody>${gridRows}</tbody></table></div>

<h2>Failure causes</h2>
<table><thead><tr><th>Key</th><th>Signature</th><th>Attributed to</th>
<th class="num">Tests hit</th><th>Owner</th><th>Why</th></tr></thead><tbody>${legend || '<tr><td colspan="6" class="ok">No failures recorded.</td></tr>'}</tbody></table>
`;

writeReport(args.out ?? `${cfg.reportsDir}/per-run-${envName}.html`, page({
  title: `Per-run detail - ${envName}`,
  h1: `Per-run detail <em>${esc(envName)}</em>`,
  subtitle: `${runs.length} run(s) over ${days.size} day(s) &middot; ${esc(dateRange(runs))} &middot; environment <b>${esc(envName)}</b>`,
  body,
  branding: cfg.branding,
}));
