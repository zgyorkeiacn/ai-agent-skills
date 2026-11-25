/**
 * Playwright JSON-reporter adapter.
 *
 * Reads the file produced by `reporter: [['json', { outputFile: ... }]]` and normalises it into the
 * shape every downstream consumer expects.
 */

import fs from 'node:fs';
import { classifyMessage } from '../../lib/signature.mjs';

/**
 * Playwright status vocabulary -> ours.
 *
 *   expected   -> passed
 *   skipped    -> skipped
 *   flaky      -> flaky   (failed at least once, then passed on retry)
 *   unexpected -> failed
 *
 * THE 'flaky' MAPPING MATTERS. The obvious implementation treats anything that is not `expected` or
 * `skipped` as a failure, which silently throws away the single strongest flake signal available:
 * the runner already proved the same code both failed and passed with nothing changing in between.
 * Collapsing that to 'failed' makes a flaky test indistinguishable from one that has never passed,
 * and no amount of downstream cleverness recovers it.
 */
function mapStatus(s) {
  if (s === 'expected') return 'passed';
  if (s === 'skipped') return 'skipped';
  if (s === 'flaky') return 'flaky';
  return 'failed';
}

/** Walk the nested suites/specs/tests tree, which can be arbitrarily deep. */
function* walkSpecs(node) {
  for (const spec of node.specs ?? []) yield spec;
  for (const child of node.suites ?? []) yield* walkSpecs(child);
}

export function parse(resultsPath, opts = {}) {
  if (!fs.existsSync(resultsPath)) {
    throw new Error(`Playwright results not found at ${resultsPath}. Check runner.resultsPath in pipeline.config.json, and that the json reporter is enabled.`);
  }

  const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const suite = { passed: 0, failed: 0, skipped: 0, flaky: 0, total: 0, durationSec: 0 };
  const specs = [];
  const failureDetail = [];

  for (const root of raw.suites ?? []) {
    for (const spec of walkSpecs(root)) {
      const file = spec.file ?? root.file ?? 'unknown';

      for (const test of spec.tests ?? []) {
        const status = mapStatus(test.status);
        const results = test.results ?? [];
        const last = results[results.length - 1];

        suite.total++;
        suite[status] = (suite[status] ?? 0) + 1;

        specs.push({
          file,
          title: spec.title ?? null,
          status,
          durationSec: Math.round((last?.duration ?? 0) / 100) / 10,
          // Retry count is kept even on a pass: a test that needed two attempts is not the same as
          // one that passed first time, and only the ingest can still see the difference.
          attempts: results.length,
        });

        if (status !== 'failed' && status !== 'flaky') continue;

        // Take the errors from the last attempt that HAS any, not simply the last attempt.
        //
        // For a flake the final attempt is the one that passed and carries no errors at all, so
        // reading only `last` drops the cause of every flaky test - the exact population whose
        // cause is hardest to reproduce on demand and therefore most worth capturing.
        const errored = [...results].reverse().find((r) => (r.errors ?? []).length > 0) ?? last;
        const message = (errored?.errors ?? [])
          .map((e) => e.message ?? '')
          .filter(Boolean)
          .join(' ');
        if (!message) continue;

        const { signature, kind } = classifyMessage(message, opts);
        failureDetail.push({
          spec: file,
          title: spec.title ?? null,
          signature,
          kind,
          // A flake's failure is recorded so its cause is still analysable, flagged so it is not
          // counted as an outage.
          transient: status === 'flaky',
          message: message.replace(/\s+/g, ' ').slice(0, 600),
        });
      }
    }
  }

  suite.durationSec = Math.round((raw.stats?.duration ?? 0) / 100) / 10;
  return { suite, specs, failureDetail };
}
