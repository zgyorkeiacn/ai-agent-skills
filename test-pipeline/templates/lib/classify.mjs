/**
 * Ownership: is this failure the environment's fault, or the suite's?
 *
 * Two tiers, and the order is the point:
 *
 *   1. CURATED - a verdict someone established by actually investigating. These are findings, not
 *      guesses, and they always win. They come from knowledge.yaml, which the team grows over time.
 *   2. HEURISTICS - priors. Useful for triage, wrong often enough that the output must never be
 *      presented as a conclusion.
 *
 * The heuristics below are deliberately shallow. A deeper rule set would be more often right and
 * far more dangerous, because a confident wrong answer costs more than an honest "unknown": it
 * sends someone to the wrong team, and they come back a day later having proved nothing.
 */

export const ENVIRONMENT = 'ENVIRONMENT';
export const TEST = 'TEST';
export const UNKNOWN = 'UNKNOWN';

/**
 * Build a classifier over a set of runs.
 *
 * @param {object[]} runs      history records, already scoped and normalised
 * @param {Function} dayKey    (isoString) => string, the day-grouping function
 * @param {object}   knowledge parsed knowledge.yaml, or {}
 *
 * IMPORTANT: dayKey must be the SAME function every report uses. One heuristic below keys off how
 * many distinct days a signature has been seen on, so two reports using different day boundaries
 * can reach opposite verdicts about the same failure. That has happened; it is not theoretical.
 */
export function buildClassifier(runs, dayKey, knowledge = {}) {
  const curated = knowledge.signatures ?? {};

  // signature -> sorted list of distinct days it appeared on
  const days = new Map();
  for (const r of runs) {
    const d = dayKey(r.startedAt ?? r.runId ?? '');
    for (const sig of Object.keys(r.failures ?? {})) {
      let s = days.get(sig);
      if (!s) { s = new Set(); days.set(sig, s); }
      s.add(d);
    }
  }

  const daysSeen = (sig) => [...(days.get(sig) ?? [])].sort();

  const verified = (sig) => {
    const e = curated[sig];
    if (!e) return null;
    return {
      owner: e.owner ?? UNKNOWN,
      title: e.title ?? null,
      what: e.what ?? null,
      probe: e.probe ?? null,
      fix: e.fix ?? null,
    };
  };

  const classify = (sig) => {
    const v = verified(sig);
    if (v && v.owner !== UNKNOWN) return v.owner;

    // 5xx, timeouts and downstream state rejections: the call reached the platform and the platform
    // did not hold up its end. Not something a test can cause.
    if (/^HTTP_5/.test(sig)) return ENVIRONMENT;
    if (/^POLL_TIMEOUT/.test(sig) || /^RETRY_EXHAUSTED/.test(sig)) return ENVIRONMENT;
    if (/^STATE_/.test(sig)) return ENVIRONMENT;

    // An unguarded property read or a type error is a defect in the suite's own code.
    if (/^OTHER/.test(sig)) {
      if (/TypeError|Cannot read prop|is not a function|undefined is not/i.test(sig)) return TEST;
      // Runner-host problems: the machine, not the product and not the test logic.
      if (/browserType\.launch|net::ERR_|ECONNREFUSED .*127\.0\.0\.1|EADDRINUSE/i.test(sig)) return TEST;
      return UNKNOWN;
    }

    // 4xx is the genuinely ambiguous one. A 4xx confined to a single day is usually the platform
    // having an incident; one recurring across days is usually pinned test data that has gone
    // stale, because a constant the suite sends cannot be wrong only on alternate afternoons.
    //
    // This prior has been observed to fail: a 4xx looked like a clean one-day burst, recurred four
    // days later, flipped itself to TEST, and was then proved to be the platform against a payload
    // that takes no arguments at all. Treat it as the start of an investigation, never the end.
    if (/^HTTP_4/.test(sig)) return daysSeen(sig).length > 1 ? TEST : ENVIRONMENT;

    if (/^ASSERT/.test(sig)) return UNKNOWN;

    return UNKNOWN;
  };

  /** Why the classifier said what it said, in one sentence, for display next to the verdict. */
  const rationale = (sig) => {
    const v = verified(sig);
    if (v && v.owner !== UNKNOWN) {
      return v.probe
        ? `Investigated; owner confirmed. Re-run the evidence: ${v.probe}`
        : 'Investigated; owner recorded in knowledge.yaml.';
    }
    if (/^HTTP_5/.test(sig)) return 'A 5xx is the server failing to answer; the suite cannot cause one.';
    if (/^POLL_TIMEOUT|^RETRY_EXHAUSTED/.test(sig)) return 'A condition never came true inside the wait window - slow or stuck rather than erroring.';
    if (/^STATE_/.test(sig)) return 'Every call succeeded and a downstream system then refused or stalled the transaction.';
    if (/^HTTP_4/.test(sig)) {
      const n = daysSeen(sig).length;
      return n > 1
        ? `Seen on ${n} separate days, which points at pinned data gone stale rather than an incident - but this prior has been wrong before.`
        : 'Confined to a single day so far, which points at an incident rather than stale data.';
    }
    if (/TypeError|Cannot read prop/i.test(sig)) return 'An unguarded property read is a defect in the suite itself.';
    return 'No rule matched with enough confidence to attribute this one.';
  };

  return { classify, daysSeen, verified, rationale };
}
