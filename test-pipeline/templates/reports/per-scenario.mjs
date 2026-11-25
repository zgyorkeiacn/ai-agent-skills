#!/usr/bin/env node
/**
 * Per-scenario breakdown.
 *
 * The inverse of the per-run report: organised by test rather than by time. It answers "what is
 * wrong with THIS test", where the per-run report answers "what went wrong today".
 *
 * Worst pass rate first, each row expanding into the distribution of its causes - because a test
 * failing 40% of the time for four unrelated reasons needs a different response from one failing
 * 40% of the time for a single reason.
 *
 *   node per-scenario.mjs --config <path> --env <name> --out <path>
 */

import { loadConfig, loadRuns, loadKnowledge, dayKey, dateRange, writeReport } from './_history.mjs';
import { page, esc, shortName, pct, band, kpi, barHtml } from './_html.mjs';
import { buildClassifier } from '../lib/classify.mjs';
import { buildReasonKeys, sourceOf, KINDS } from '../lib/signature.mjs';
import { classifyFlakes, explainFlake } from '../lib/flake.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, t, i, arr) => (t.startsWith('--') ? [...a, [t.slice(2), arr[i + 1]]] : a), []),
);
const cfg = loadConfig(args.config ?? 'pipeline.config.json');
const runs = loadRuns(cfg, { env: args.env ?? 'all' });

if (!runs.length) {
  console.log(`[per-scenario] no runs recorded for ${args.env ?? 'all'} - nothing to report yet`);
  process.exit(0);
}

const envName = args.env ?? 'all';
const knowledge = loadKnowledge(cfg);
const { classify, rationale, verified } = buildClassifier(runs, dayKey, knowledge);
const { reasonKey } = buildReasonKeys(runs);
const flakes = classifyFlakes(runs);

// Scope is the most recent run's test list: the current shape of the suite, not a frozen snapshot
// that quietly goes stale. Tests that existed once and were deleted drop out on their own.
const latest = runs[runs.length - 1];
const scope = new Set((latest.specs ?? []).map((s) => s.file));
for (const r of runs) for (const s of r.specs ?? []) scope.add(s.file);

const stats = new Map();
for (const file of scope) stats.set(file, { pass: 0, fail: 0, skip: 0, causes: new Map(), messages: new Map() });

for (const r of runs) {
  for (const s of r.specs ?? []) {
    const e = stats.get(s.file);
    if (!e) continue;
    if (s.status === 'skipped') e.skip++;
    else if (s.status === 'failed') e.fail++;
    else e.pass++;
  }
  for (const d of r.failureDetail ?? []) {
    const e = stats.get(d.spec);
    if (!e || d.transient) continue;
    e.causes.set(d.signature, (e.causes.get(d.signature) ?? 0) + 1);
    if (!e.messages.has(d.signature)) e.messages.set(d.signature, d.message);
  }
}

const rows = [...stats.entries()].map(([file, e]) => {
  const executed = e.pass + e.fail;
  return { file, e, executed, rate: executed ? pct(e.pass, executed) : null };
}).sort((a, b) => {
  if (a.rate === null) return 1;
  if (b.rate === null) return -1;
  return a.rate - b.rate;
});

const KIND_COLOUR = { api: 'var(--bad)', downstream: 'var(--warn)', runner: 'var(--accent)', other: 'var(--muted)' };

let out = '';
for (const { file, e, executed, rate } of rows) {
  const v = flakes.get(file) ?? { state: 'INSUFFICIENT', runs: 0 };
  const causes = [...e.causes.entries()].sort((a, b) => b[1] - a[1]);
  const totalCause = causes.reduce((a, [, n]) => a + n, 0);

  // A stacked bar of this test's causes, coloured by what is to blame. A single wide band means one
  // fault to chase; four thin ones mean this test is simply exposed to everything.
  const segments = causes.map(([sig, n]) => {
    const src = sourceOf(sig, e.messages.get(sig));
    const w = Math.round((n / (totalCause || 1)) * 100);
    return `<i style="width:${w}%;background:${KIND_COLOUR[src.kind]}" title="${esc(sig)} (${n})"></i>`;
  }).join('');

  const head = executed === 0
    ? '<span class="na">never executed</span>'
    : `<span class="${band(rate)}"><b>${rate}%</b></span>`;

  let detail;
  if (!causes.length) {
    detail = executed === 0
      ? '<p class="muted">This test has not executed in the recorded history. That is a coverage gap rather than a failure - something gated it before it could run.</p>'
      : '<p class="ok">This test has not failed once in the recorded history.</p>';
  } else {
    let tr = '';
    for (const [sig, n] of causes) {
      const src = sourceOf(sig, e.messages.get(sig));
      const owner = classify(sig);
      const k = KINDS[src.kind];
      const vk = verified(sig);
      tr += `<tr>
        <td class="mono">${esc(reasonKey.get(sig) ?? '')}</td>
        <td class="num">${Math.round((n / totalCause) * 100)}%</td>
        <td><span class="pill">${esc(k.label)}</span> ${esc(src.name)}</td>
        <td class="small">${esc(vk?.what ?? rationale(sig))}
          <div class="mono muted small" style="margin-top:4px">${esc(sig)}</div>
          ${vk?.fix ? `<div class="small" style="margin-top:4px"><b>Suggested fix:</b> ${esc(vk.fix)}</div>` : ''}
          ${vk?.probe ? `<div class="small muted">Evidence: <span class="mono">${esc(vk.probe)}</span></div>` : ''}
        </td>
        <td class="${owner === 'ENVIRONMENT' ? 'bad' : owner === 'TEST' ? 'warn' : 'na'}">${esc(owner)}</td>
      </tr>`;
    }
    detail = `<table><thead><tr><th>Key</th><th class="num">Share</th><th>Attributed to</th>
      <th>What it means</th><th>Owner</th></tr></thead><tbody>${tr}</tbody></table>`;
  }

  out += `<details>
    <summary>
      <span class="mono">${esc(shortName(file))}</span>
      &nbsp; ${head}
      <span class="muted small">&nbsp; ${e.pass} pass &middot; ${e.fail} fail${e.skip ? ` &middot; ${e.skip} gated` : ''}</span>
      &nbsp;<span class="bar" style="display:inline-block;width:160px;vertical-align:middle">${segments}</span>
      <span class="small ${v.state === 'FLAKY' ? 'warn' : v.state === 'BROKEN' ? 'bad' : 'muted'}">&nbsp;${esc(v.state)}</span>
    </summary>
    <p class="small muted">${esc(explainFlake(v))}</p>
    ${detail}
  </details>`;
}

const executedTotal = rows.reduce((a, r) => a + r.executed, 0);
const passTotal = rows.reduce((a, r) => a + r.e.pass, 0);

const body = `
<div class="kpis">
  ${kpi(rows.length, 'tests in scope')}
  ${kpi(rows.filter((r) => r.e.fail === 0 && r.executed > 0).length, 'never failed', 'ok')}
  ${kpi(rows.filter((r) => r.executed === 0).length, 'never executed', 'na')}
  ${kpi([...flakes.values()].filter((v) => v.state === 'FLAKY').length, 'flaky', 'warn')}
  ${kpi(pct(passTotal, executedTotal) + '%', 'pass rate', band(pct(passTotal, executedTotal)))}
</div>
<p class="sub">Worst pass rate first. Click any test to see why it fails. The bar splits that test's
failures by what was to blame, so one wide band is a single fault to chase and several thin ones
mean the test is simply exposed to everything.</p>
${out}
<div class="note"><b>Why a pass rate can look worse than the test is.</b> The rate counts executions,
not days. A test that ran thirty times during one bad afternoon and passed every time since will
still read poorly for a while - check the verdict column and the per-run grid before concluding a
test is broken.</div>
`;

writeReport(args.out ?? `${cfg.reportsDir}/per-scenario-${envName}.html`, page({
  title: `Per-scenario breakdown - ${envName}`,
  h1: `Scenario <em>failure breakdown</em>`,
  subtitle: `${rows.length} test(s) &middot; ${runs.length} run(s) &middot; ${esc(dateRange(runs))} &middot; environment <b>${esc(envName)}</b>`,
  body,
  branding: cfg.branding,
}));
