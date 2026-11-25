#!/usr/bin/env node
/**
 * Environment comparison. Generated only when more than one environment is configured.
 *
 * CUMULATIVE, NOT PAIRED, AND N-ARY.
 *
 * The tempting design is to line up today's run on each environment and diff them. That was tried
 * in the pipeline this was extracted from and it does not survive contact with the data: on one
 * recorded day thirteen of twenty-five tests changed status between two runs ninety minutes apart
 * on the SAME environment, and another went from 19 passed / 6 failed to 0 / 25 within three hours
 * as the platform degraded. A paired report would have presented that outage as a permanent
 * property of an environment.
 *
 * Pass rate over many runs survives that. `n` is printed on every figure, because a rate over two
 * samples is not evidence and the report should not pretend otherwise.
 *
 * Nothing here is limited to two environments - columns are generated from the config.
 *
 *   node comparison.mjs --config <path> --out <path>
 */

import { loadConfig, loadRuns, byEnvironment, dateRange, writeReport } from './_history.mjs';
import { page, esc, shortName, pct, band, kpi } from './_html.mjs';
import { cumulativeRates, compareAll } from '../lib/cross-env.mjs';
import { sourceOf } from '../lib/signature.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, t, i, arr) => (t.startsWith('--') ? [...a, [t.slice(2), arr[i + 1]]] : a), []),
);
const cfg = loadConfig(args.config ?? 'pipeline.config.json');
const envs = (cfg.environments ?? []).filter((e) => e.enabled !== false).map((e) => e.name);

if (envs.length < 2) {
  console.log('[comparison] only one environment configured - nothing to compare');
  process.exit(0);
}

const all = loadRuns(cfg, { env: 'all' });
if (!all.length) { console.log('[comparison] no runs recorded yet'); process.exit(0); }

const grouped = byEnvironment(cfg, all);
const rates = cumulativeRates(grouped);

// Latest run per environment, for the current-state verdict.
const latest = envs
  .map((e) => ({ env: e, run: (grouped[e] ?? [])[grouped[e]?.length - 1] }))
  .filter((x) => x.run);
const split = compareAll(latest);

// ---- Main table ------------------------------------------------------------
const rows = [...rates.entries()].map(([file, per]) => {
  const values = envs.map((e) => (per[e] ? pct(per[e].pass, per[e].n) : null));
  const seen = values.filter((v) => v !== null);
  // Rank by spread: the tests where environments disagree most are the ones worth looking at.
  // A test nobody ran on some environment sorts last - a coverage gap, not a divergence.
  const divergence = seen.length === envs.length ? Math.max(...seen) - Math.min(...seen) : -1;
  return { file, per, values, divergence };
}).sort((a, b) => b.divergence - a.divergence);

const head = `<tr><th rowspan="2">Test</th>${envs.map((e) => `<th colspan="3">${esc(e)}</th>`).join('')}<th rowspan="2" class="num">Spread</th></tr>
<tr>${envs.map(() => '<th class="num">Now</th><th class="num">Rate</th><th class="num small">n</th>').join('')}</tr>`;

let tbody = '';
for (const r of rows) {
  tbody += `<tr><td class="mono small">${esc(shortName(r.file))}</td>`;
  for (const e of envs) {
    const c = r.per[e];
    if (!c) { tbody += '<td class="na small" colspan="3">not run</td>'; continue; }
    const rate = pct(c.pass, c.n);
    // "Now" and the cumulative rate are both shown because they answer different questions: a test
    // can sit at 2/44 cumulative and still be passing right now.
    tbody += `<td class="${c.last === 'passed' ? 'ok' : 'bad'} num small">${c.last === 'passed' ? 'PASS' : 'FAIL'}</td>`;
    tbody += `<td class="num ${band(rate)}">${rate}%</td>`;
    tbody += `<td class="num muted small">${c.n}</td>`;
  }
  tbody += r.divergence < 0
    ? '<td class="na num small">n/a</td>'
    : `<td class="num ${r.divergence >= 40 ? 'bad' : r.divergence >= 15 ? 'warn' : 'muted'}">${r.divergence}pp</td>`;
  tbody += '</tr>';
}

// ---- Causes per environment -------------------------------------------------
const causes = new Map();
for (const [envName, rs] of Object.entries(grouped)) {
  for (const r of rs) {
    for (const d of r.failureDetail ?? []) {
      if (d.transient) continue;
      if (!causes.has(d.spec)) causes.set(d.spec, {});
      const bucket = (causes.get(d.spec)[envName] ??= new Map());
      bucket.set(d.signature, (bucket.get(d.signature) ?? 0) + 1);
    }
  }
}

let causeRows = '';
for (const r of rows) {
  const per = causes.get(r.file);
  if (!per) continue;
  causeRows += `<tr><td class="mono small">${esc(shortName(r.file))}</td>`;
  for (const e of envs) {
    const m = per[e];
    if (!m) { causeRows += '<td class="na small">no failures recorded</td>'; continue; }
    const list = [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([sig, n]) => `<div class="mono small">${n}&times; ${esc(sig)}</div>`).join('');
    causeRows += `<td>${list}</td>`;
  }
  causeRows += '</tr>';
}

// ---- Verdict summary --------------------------------------------------------
const productList = split.product.length
  ? `<ul>${split.product.map((p) => `<li class="mono small">${esc(shortName(p.file))} &mdash; ${esc(p.cause)}</li>`).join('')}</ul>`
  : '<p class="ok">None - no test is failing everywhere for the same reason.</p>';

const divergentList = split.divergent.length
  ? `<ul>${split.divergent.map((d) => `<li class="mono small">${esc(shortName(d.file))}: ${
      Object.entries(d.byEnv).map(([e, c]) => `${esc(e)} &rarr; ${esc(c ?? 'passed')}`).join(' &middot; ')
    }</li>`).join('')}</ul>`
  : '<p class="muted">None.</p>';

const perEnvList = envs.map((e) => {
  const f = split.perEnv[e] ?? [];
  return `<li><b>${esc(e)}</b> only (${f.length})${f.length ? ': ' + f.map((x) => `<span class="mono small">${esc(shortName(x))}</span>`).join(', ') : ''}</li>`;
}).join('');

const body = `
<div class="kpis">
  ${kpi(envs.length, 'environments')}
  ${kpi(rows.length, 'tests compared')}
  ${kpi(split.product.length, 'failing everywhere', split.product.length ? 'bad' : 'ok')}
  ${kpi(split.divergent.length, 'same test, different causes', split.divergent.length ? 'warn' : '')}
  ${kpi(split.coverageGaps.length, 'coverage gaps', 'na')}
</div>

<div class="note"><b>Cumulative, not paired.</b> Each rate is every recorded run on that environment,
not today's. Individual runs swing far too much to compare directly - a single bad afternoon on one
environment would otherwise read as a permanent difference between the two. Sample sizes are printed
on every figure; a rate over two runs is not evidence, and this report will not pretend it is.</div>

<h2>Current verdict, from the most recent run on each environment</h2>
<h3>Failing everywhere, same cause &mdash; treat as the product</h3>
${productList}
<h3>Failing on several environments for <em>different</em> causes</h3>
<p class="small muted">These are separate faults that happen to share a test. Merging them into one
"fails everywhere" line sends somebody looking for a single root cause that does not exist.</p>
${divergentList}
<h3>Failing on one environment only &mdash; that environment's data or config</h3>
<ul>${perEnvList}</ul>

<h2>Cumulative pass rate per test</h2>
<p class="sub">Sorted by spread: the tests the environments most disagree about come first.
"Now" is the most recent run, which can differ from the cumulative rate.</p>
<div style="overflow-x:auto"><table><thead>${head}</thead><tbody>${tbody}</tbody></table></div>

<h2>Failure causes per environment</h2>
<p class="sub">The same test failing on two environments for different reasons is two faults, not
one. Compare the columns rather than the row.</p>
<div style="overflow-x:auto"><table><thead><tr><th>Test</th>${envs.map((e) => `<th>${esc(e)}</th>`).join('')}</tr></thead>
<tbody>${causeRows || `<tr><td colspan="${envs.length + 1}" class="ok">No failures recorded.</td></tr>`}</tbody></table></div>
`;

writeReport(args.out ?? `${cfg.reportsDir}/comparison.html`, page({
  title: `Environment comparison - ${envs.join(' vs ')}`,
  h1: `Environment <em>comparison</em>`,
  subtitle: `${envs.map((e) => `${esc(e)} ${(grouped[e] ?? []).length} run(s)`).join(' &middot; ')} &middot; ${esc(dateRange(all))}`,
  body,
  branding: cfg.branding,
}));
