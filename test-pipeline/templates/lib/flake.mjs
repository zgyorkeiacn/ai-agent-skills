/**
 * Flake detection.
 *
 * Separates three states that a naive pass-rate column conflates:
 *
 *   BROKEN  - fails every time it runs. One fault, reproducible, fixable.
 *   FLAKY   - oscillates between pass and fail with no change in between. Costs more than it looks:
 *             it trains people to re-run rather than read, and it hides real regressions inside
 *             noise everyone has learned to ignore.
 *   HEALTHY - passes consistently.
 *
 * Two independent signals feed this:
 *
 *   1. RETRY FLAKE - the runner itself retried and the test then passed. This is the strongest
 *      possible evidence and requires no inference. It depends on the ingest adapter preserving the
 *      retry outcome as its own status rather than collapsing it to 'failed'; an adapter that
 *      reports "passed on retry" as a plain failure destroys this signal before it arrives.
 *   2. RUN-TO-RUN FLAKE - the outcome oscillates across consecutive runs. Inferred, so it needs a
 *      minimum sample and a transition count before it is worth asserting.
 */

export const BROKEN = 'BROKEN';
export const FLAKY = 'FLAKY';
export const HEALTHY = 'HEALTHY';
export const INSUFFICIENT = 'INSUFFICIENT';

/** Below this many executions, say so rather than guessing. */
const MIN_RUNS = 5;

/**
 * Transitions per execution above which oscillation is called flake rather than a state change.
 *
 * A test that breaks once and stays broken has exactly one transition, however long its history -
 * that is a regression, not a flake, and the rate keeps it out. A test alternating every other run
 * approaches 1.0. 0.25 sits comfortably between: roughly one flip per four runs.
 */
const FLAKE_RATE = 0.25;

/**
 * Classify every test across a set of runs.
 *
 * @param {object[]} runs  history records, oldest first
 * @returns {Map<string, {
 *   state: string, pass: number, fail: number, retryFlake: number,
 *   runs: number, transitions: number, rate: number, lastStatus: string|null
 * }>}
 */
export function classifyFlakes(runs) {
  const seq = new Map();

  for (const run of runs) {
    for (const s of run.specs ?? []) {
      // Gated tests never executed, so they are neither passing nor flaky.
      if (s.status === 'skipped') continue;
      let e = seq.get(s.file);
      if (!e) { e = { statuses: [], retryFlake: 0 }; seq.set(s.file, e); }
      // 'flaky' is the adapter's word for "the runner retried it and it then passed".
      if (s.status === 'flaky') e.retryFlake++;
      e.statuses.push(s.status === 'passed' || s.status === 'flaky' ? 'pass' : 'fail');
    }
  }

  const out = new Map();
  for (const [file, e] of seq) {
    const n = e.statuses.length;
    const pass = e.statuses.filter((x) => x === 'pass').length;
    const fail = n - pass;

    let transitions = 0;
    for (let i = 1; i < n; i++) if (e.statuses[i] !== e.statuses[i - 1]) transitions++;
    const rate = n > 1 ? transitions / (n - 1) : 0;

    let state;
    if (n < MIN_RUNS) state = INSUFFICIENT;
    // Any retry-flake is decisive: the runner proved the same code both failed and passed with
    // nothing changing in between. No amount of run-to-run stability argues that away.
    else if (e.retryFlake > 0) state = FLAKY;
    else if (fail === 0) state = HEALTHY;
    else if (pass === 0) state = BROKEN;
    else if (rate >= FLAKE_RATE) state = FLAKY;
    // Passed then broke and stayed broken: a regression, which reads as broken, not flaky.
    else state = e.statuses[n - 1] === 'fail' ? BROKEN : HEALTHY;

    out.set(file, {
      state, pass, fail, retryFlake: e.retryFlake,
      runs: n, transitions, rate: Math.round(rate * 100) / 100,
      lastStatus: e.statuses[n - 1] ?? null,
    });
  }
  return out;
}

/** One-line explanation of a verdict, for display beside it. */
export function explainFlake(v) {
  switch (v.state) {
    case INSUFFICIENT:
      return `Only ${v.runs} execution(s) recorded - not enough to say anything yet.`;
    case HEALTHY:
      return v.fail === 0
        ? `Passed all ${v.runs} times.`
        : `Failed ${v.fail} of ${v.runs} but has been stable since; reads as a fixed regression rather than a flake.`;
    case BROKEN:
      return v.pass === 0
        ? `Failed all ${v.runs} times - reproducible, so it should be the easiest to diagnose.`
        : `Passed ${v.pass} of ${v.runs} then broke and stayed broken; treat as a regression and look at what changed.`;
    case FLAKY:
      return v.retryFlake > 0
        ? `The runner retried it ${v.retryFlake} time(s) and it then passed - the same code both failed and passed with nothing changing.`
        : `Flipped between pass and fail ${v.transitions} time(s) across ${v.runs} runs (${Math.round(v.rate * 100)}% of consecutive pairs).`;
    default:
      return '';
  }
}
