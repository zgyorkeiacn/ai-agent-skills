/**
 * Multi-environment failure comparison.
 *
 * Answers the only question that matters when a test fails in more than one place: is this the
 * product, or is it that environment?
 *
 * THE RULE THAT IS EASY TO GET WRONG
 *
 * Comparing pass/fail alone overstates the shared case. Two environments can fail the same test for
 * completely unrelated reasons, and reporting that as "fails everywhere, therefore platform-wide"
 * sends someone hunting for a single root cause that does not exist. A shared failure is only
 * evidence of a shared cause if the CAUSE matches. That distinction is the whole point of this
 * module, and it is why `bothFailDifferent` is a separate bucket rather than being folded into
 * `bothFail`.
 */

import { normaliseSignature } from './normalise.mjs';

/**
 * The cause of a given test file's failure within one run, normalised for comparison.
 * Returns null when the test did not fail in that run.
 */
function causeOf(run, file, opts) {
  const d = (run.failureDetail ?? []).find((x) => x.spec === file);
  return d ? normaliseSignature(d.signature, opts) : null;
}

/** Map of test file -> status, for one run. */
function statusMap(run) {
  return new Map((run.specs ?? []).map((s) => [s.file, s.status]));
}

/**
 * Compare two runs from different environments.
 *
 * Only tests that RAN on both are compared. A test that ran on one environment and not the other
 * is a coverage gap, not a result, and averaging it in as either a pass or a failure would blame an
 * environment for a decision the harness made. Those are counted separately as `notShared`.
 *
 * @returns {{
 *   a: string, b: string,
 *   bothFail: string[],
 *   bothFailDifferent: Array<{file:string, causeA:string, causeB:string}>,
 *   onlyA: string[], onlyB: string[],
 *   notShared: number
 * }}
 */
export function comparePair(runA, runB, opts = {}) {
  const nameA = runA.env ?? 'a';
  const nameB = runB.env ?? 'b';
  const sa = statusMap(runA);
  const sb = statusMap(runB);

  const shared = [...sa.keys()].filter((f) => sb.has(f));
  const notShared = (sa.size - shared.length) + (sb.size - shared.length);

  const failedBoth = shared.filter((f) => sa.get(f) === 'failed' && sb.get(f) === 'failed');

  const bothFail = [];
  const bothFailDifferent = [];
  for (const f of failedBoth) {
    const ca = causeOf(runA, f, opts);
    const cb = causeOf(runB, f, opts);
    if (ca && cb && ca === cb) bothFail.push(f);
    else bothFailDifferent.push({ file: f, causeA: ca, causeB: cb });
  }

  return {
    a: nameA,
    b: nameB,
    bothFail,
    bothFailDifferent,
    onlyA: shared.filter((f) => sa.get(f) === 'failed' && sb.get(f) === 'passed'),
    onlyB: shared.filter((f) => sa.get(f) === 'passed' && sb.get(f) === 'failed'),
    notShared,
  };
}

/**
 * Compare N environments, using the most recent run of each.
 *
 * Generalises the pair logic: a test is attributed to the product when every environment that ran
 * it failed it for the same cause, and to an environment when it failed only there.
 *
 * @param {Array<{env:string, run:object}>} latest  one entry per environment
 * @returns {{
 *   product: Array<{file:string, cause:string, envs:string[]}>,
 *   divergent: Array<{file:string, byEnv:Record<string,string|null>}>,
 *   perEnv: Record<string, string[]>,
 *   coverageGaps: Array<{file:string, ranOn:string[], missingFrom:string[]}>
 * }}
 */
export function compareAll(latest, opts = {}) {
  const envs = latest.map((l) => l.env);
  const statuses = new Map(latest.map((l) => [l.env, statusMap(l.run)]));
  const runs = new Map(latest.map((l) => [l.env, l.run]));

  const allFiles = new Set();
  for (const m of statuses.values()) for (const f of m.keys()) allFiles.add(f);

  const product = [];
  const divergent = [];
  const perEnv = Object.fromEntries(envs.map((e) => [e, []]));
  const coverageGaps = [];

  for (const file of allFiles) {
    const ranOn = envs.filter((e) => statuses.get(e).has(file));
    if (ranOn.length !== envs.length) {
      coverageGaps.push({ file, ranOn, missingFrom: envs.filter((e) => !ranOn.includes(e)) });
    }
    if (ranOn.length < 2) continue;

    const failedOn = ranOn.filter((e) => statuses.get(e).get(file) === 'failed');
    if (!failedOn.length) continue;

    if (failedOn.length === 1) {
      perEnv[failedOn[0]].push(file);
      continue;
    }

    const causes = Object.fromEntries(failedOn.map((e) => [e, causeOf(runs.get(e), file, opts)]));
    const distinct = new Set(Object.values(causes).filter(Boolean));

    // Failed everywhere it ran, for one cause -> the product.
    if (failedOn.length === ranOn.length && distinct.size === 1) {
      product.push({ file, cause: [...distinct][0], envs: failedOn });
    } else {
      // Several environments, several causes. Deliberately NOT merged: these are separate faults
      // that happen to share a test, and presenting them as one sends the reader after a single
      // root cause that does not exist.
      divergent.push({ file, byEnv: causes });
    }
  }

  return { product, divergent, perEnv, coverageGaps };
}

/**
 * Cumulative pass rate per test per environment, across all history.
 *
 * Deliberately cumulative rather than comparing single runs against each other. Pairing individual
 * runs was tried in the pipeline this was extracted from and did not survive contact with the data:
 * on one recorded day, thirteen of twenty-five tests changed status between two runs ninety minutes
 * apart on the same environment, and another environment went from 19 passed / 6 failed to 0 / 25
 * within three hours as the platform degraded. A report pairing one run against another would have
 * presented that outage as a permanent characteristic of an environment.
 *
 * Pass rate over many runs survives that. `n` is returned alongside every rate so a reader can see
 * when a figure rests on two samples, and the renderer is expected to print it.
 */
export function cumulativeRates(runsByEnv) {
  const out = new Map();
  for (const [env, runs] of Object.entries(runsByEnv)) {
    for (const run of runs) {
      for (const s of run.specs ?? []) {
        // Gated / skipped tests are a data gap, not a result. Counting them as failures blames the
        // environment for a decision the harness made before the test ever started.
        if (s.status === 'skipped') continue;
        let e = out.get(s.file);
        if (!e) { e = {}; out.set(s.file, e); }
        let c = e[env];
        if (!c) { c = { pass: 0, fail: 0, n: 0, last: null, lastAt: null }; e[env] = c; }
        if (s.status === 'passed') c.pass++; else c.fail++;
        c.n++;
        // Track the most recent outcome separately: a test can sit at 2/44 cumulative and still be
        // passing right now, and a reader needs both facts.
        if (!c.lastAt || (run.startedAt ?? '') >= c.lastAt) {
          c.last = s.status;
          c.lastAt = run.startedAt ?? '';
        }
      }
    }
  }
  return out;
}
