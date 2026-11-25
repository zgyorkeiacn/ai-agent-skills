#!/usr/bin/env node
/**
 * Daily one-pager. One page per day, newest first, written for somebody who will not read a stack
 * trace and should not have to.
 *
 * Two rules that shape every decision in this file:
 *   1. Nothing is collapsible. If it is worth including it is worth showing.
 *   2. No raw signatures in the prose. A signature is a grouping key, not an explanation.
 *
 * Explanations come from knowledge.yaml where a team has recorded one, and are otherwise derived
 * from the signature grammar. The derived version is deliberately plain rather than clever: it can
 * be shallow, but it must never be wrong, because a confident wrong sentence on a page like this
 * costs more than an honest vague one.
 *
 *   node one-pager.mjs --config <path> --env <name> --out <path>
 */

import { loadConfig, loadRuns, loadKnowledge, dayKey, writeReport } from './_history.mjs';
import { page, esc, pct, band } from './_html.mjs';
import { buildClassifier, ENVIRONMENT, TEST } from '../lib/classify.mjs';
import { sourceOf } from '../lib/signature.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, t, i, arr) => (t.startsWith('--') ? [...a, [t.slice(2), arr[i + 1]]] : a), []),
);
const cfg = loadConfig(args.config ?? 'pipeline.config.json');
const runs = loadRuns(cfg, { env: args.env ?? 'all' });

if (!runs.length) {
  console.log(`[one-pager] no runs recorded for ${args.env ?? 'all'} - nothing to report yet`);
  process.exit(0);
}

const envName = args.env ?? 'all';
const knowledge = loadKnowledge(cfg);
const { classify, verified } = buildClassifier(runs, dayKey, knowledge);

/**
 * Plain-English description of a failure, without using the signature itself.
 * Curated entry wins; otherwise derived from the grammar.
 */
function describe(sig) {
  const v = verified(sig);
  if (v?.title || v?.what) {
    return { title: v.title ?? 'Known issue', what: v.what ?? '', fix: v.fix ?? null, curated: true };
  }
  const src = sourceOf(sig, '');
  const http = sig.match(/^HTTP_(\d{3})/);
  if (http) {
    const code = http[1];
    const where = src.name === 'no source identified' ? 'a service' : src.name;
    if (code.startsWith('5')) {
      return { title: `${where} returned a server error`, what: `The call reached the platform and the platform failed to answer it (HTTP ${code}). Nothing the suite sends can cause this response.` };
    }
    return { title: `${where} rejected the request`, what: `The platform answered HTTP ${code}, meaning it understood the call and declined it. Either what we send has stopped being valid, or the platform changed what it accepts.` };
  }
  if (/^POLL_TIMEOUT|^RETRY_EXHAUSTED/.test(sig)) {
    return { title: 'Something never finished in the time allowed', what: 'No error was returned. The suite waited for a condition to become true and it never did inside the window, so this is slowness or a stall rather than a fault.' };
  }
  const state = sig.match(/^STATE_(.+)$/);
  if (state) {
    return { title: `A downstream system stopped the transaction at ${state[1].toLowerCase().replace(/_/g, ' ')}`, what: 'Every call succeeded; a system further down the chain then refused or stalled the transaction. The failure is behind the interface we test, not in it.' };
  }
  if (/^ASSERT/.test(sig)) {
    return { title: 'A value came back wrong', what: 'The call worked and returned something other than what was expected, so the platform disagreed with its own contract - or the expectation is out of date.' };
  }
  if (/TypeError|Cannot read prop/i.test(sig)) {
    return { title: 'The test suite hit its own bug', what: 'An unguarded read in the test code. Ours to fix, and it tells us nothing about the product.' };
  }
  if (/browserType\.launch|net::ERR_/i.test(sig)) {
    return { title: 'The machine running the tests had a problem', what: 'A browser or network fault on the runner host. Not the product, and not the tests.' };
  }
  return { title: 'An unrecognised failure', what: 'This one does not match any known pattern yet. Worth a look precisely because it is new.' };
}

// ---- Group by day ----------------------------------------------------------
const days = new Map();
for (const r of runs) {
  const k = dayKey(r.startedAt ?? r.runId);
  if (!days.has(k)) days.set(k, []);
  days.get(k).push(r);
}

let pages = '';
for (const [day, drs] of [...days].reverse()) {
  const totals = drs.reduce((a, r) => ({
    p: a.p + (r.suite?.passed ?? 0), f: a.f + (r.suite?.failed ?? 0), k: a.k + (r.suite?.flaky ?? 0),
  }), { p: 0, f: 0, k: 0 });
  const executed = totals.p + totals.f + totals.k;
  const rate = pct(totals.p + totals.k, executed);

  const bySig = new Map();
  const affected = new Map();
  for (const r of drs) {
    for (const d of r.failureDetail ?? []) {
      if (d.transient) continue;
      bySig.set(d.signature, (bySig.get(d.signature) ?? 0) + 1);
      if (!affected.has(d.signature)) affected.set(d.signature, new Set());
      affected.get(d.signature).add(d.spec);
    }
  }
  const ranked = [...bySig.entries()].sort((a, b) => b[1] - a[1]);
  const totalFails = ranked.reduce((a, [, n]) => a + n, 0);

  let envCount = 0, testCount = 0, unknownCount = 0;
  for (const [sig, n] of ranked) {
    const o = classify(sig);
    if (o === ENVIRONMENT) envCount += n;
    else if (o === TEST) testCount += n;
    else unknownCount += n;
  }
  const envShare = totalFails ? Math.round((envCount / totalFails) * 100) : 0;

  // Best hour, stated only when there is enough to say it. A "best window" stamped on a day where
  // nothing worked is worse than no advice at all.
  const hours = new Map();
  for (const r of drs) {
    const h = new Date(r.startedAt ?? '').getHours();
    if (Number.isNaN(h)) continue;
    const e = hours.get(h) ?? { p: 0, f: 0 };
    e.p += (r.suite?.passed ?? 0) + (r.suite?.flaky ?? 0);
    e.f += r.suite?.failed ?? 0;
    hours.set(h, e);
  }
  const hourList = [...hours.entries()].sort((a, b) => a[0] - b[0])
    .map(([h, e]) => ({ h, rate: pct(e.p, e.p + e.f) }));
  const best = hourList.filter((x) => x.rate !== null).sort((a, b) => b.rate - a.rate)[0];
  const worthSaying = best && best.rate >= 60 && hourList.length >= 3;

  const hourBand = hourList.map((x) => `
    <div style="text-align:center;min-width:44px">
      <div class="mono small muted">${String(x.h).padStart(2, '0')}</div>
      <div class="${band(x.rate)}" style="font-weight:600">${x.rate === null ? '-' : x.rate + '%'}</div>
    </div>`).join('');

  const top = ranked.slice(0, 5);
  const bars = top.map(([sig, n]) => {
    const d = describe(sig);
    const owner = classify(sig);
    const share = Math.round((n / (totalFails || 1)) * 100);
    return `<div style="margin:10px 0">
      <div style="display:flex;justify-content:space-between;gap:12px">
        <span><b>${esc(d.title)}</b>${d.curated ? ' <span class="pill ok small">known</span>' : ''}
          <span class="muted small">&nbsp;${affected.get(sig).size} test(s) &middot; ${owner === ENVIRONMENT ? 'platform' : owner === TEST ? 'our suite' : 'unattributed'}</span></span>
        <span class="num"><b>${n}</b> <span class="muted small">${share}%</span></span>
      </div>
      <span class="bar"><i style="width:${share}%;background:${owner === TEST ? 'var(--warn)' : 'var(--bad)'}"></i></span>
    </div>`;
  }).join('');

  const detail = top.slice(0, 4).map(([sig, n], i) => {
    const d = describe(sig);
    return `<div style="flex:1;min-width:210px">
      <h3><span class="pill">${i + 1}</span> ${esc(d.title)}</h3>
      <p class="small">${esc(d.what)}</p>
      ${d.fix ? `<p class="small"><b>Suggested fix.</b> ${esc(d.fix)}</p>` : ''}
      <p class="small muted">${n} occurrence(s) across ${affected.get(sig).size} test(s).</p>
    </div>`;
  }).join('');

  const headline = totalFails === 0
    ? 'Everything passed'
    : `${envShare}% of failures were the platform, not the tests`;

  pages += `<section style="page-break-after:always;border-bottom:1px solid var(--line);padding-bottom:28px;margin-bottom:28px">
    <h2 style="font-size:22px">${esc(new Date(day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}
      <span class="muted" style="font-weight:400">&mdash; ${esc(headline)}</span></h2>
    <p class="sub">${drs.length} run(s) on <b>${esc(envName)}</b> &middot; ${totalFails} failure(s)
      across ${new Set([...affected.values()].flatMap((s) => [...s])).size} test(s), from ${ranked.length} distinct cause(s).</p>

    <div class="kpis">
      <div class="kpi"><div class="v ${band(rate)}">${rate === null ? 'n/a' : rate + '%'}</div><div class="l">pass rate</div></div>
      <div class="kpi"><div class="v">${totalFails}</div><div class="l">failures</div></div>
      <div class="kpi"><div class="v bad">${envShare}%</div><div class="l">platform-caused</div></div>
      <div class="kpi"><div class="v warn">${totalFails ? Math.round((testCount / totalFails) * 100) : 0}%</div><div class="l">our suite</div></div>
      <div class="kpi"><div class="v">${ranked.length}</div><div class="l">distinct causes</div></div>
    </div>

    ${hourList.length ? `<h3>When it ran best</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${hourBand}</div>
      <p class="small muted">${worthSaying
        ? `Best hour was <b>${String(best.h).padStart(2, '0')}:00</b> at ${best.rate}%. Timing matters as much as the fix list when the platform is uneven through the day.`
        : 'No hour stands out as materially better on this day, so the timing tells us nothing useful here.'}</p>` : ''}

    ${totalFails ? `<h3>What failed, most first</h3>${bars}
      <h3 style="margin-top:22px">The biggest causes, in full</h3>
      <div style="display:flex;gap:22px;flex-wrap:wrap">${detail}</div>`
      : '<p class="ok">No failures recorded on this day.</p>'}
    ${unknownCount ? `<p class="small muted" style="margin-top:14px">${unknownCount} failure(s) could not be
      attributed to either the platform or the suite with confidence, and are excluded from the split above.</p>` : ''}
  </section>`;
}

writeReport(args.out ?? `${cfg.reportsDir}/one-pager-${envName}.html`, page({
  title: `Daily analysis - ${envName}`,
  h1: `Daily <em>failure analysis</em>`,
  subtitle: `${days.size} day(s) &middot; environment <b>${esc(envName)}</b> &middot; newest first`,
  body: pages,
  branding: cfg.branding,
}));
