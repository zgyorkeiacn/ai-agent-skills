#!/usr/bin/env node
/**
 * Append one run to the history file.
 *
 * Usage:
 *   node collect-run.mjs --config <path> --run-id <id> --env <name>
 *                        --started <iso> --finished <iso> [--results <path>] [--runner-kind playwright|junit]
 *
 * The history file is the pipeline's only durable output and the sole input to every report. It is
 * append-only, one JSON object per line, and is meant to be committed: it is small, it accumulates,
 * and it cannot be reconstructed from anything else once lost.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Parse argv.
 *
 * Tolerates `--flag value`, `--flag=value` and bare boolean flags, and REJECTS anything it does not
 * recognise rather than guessing. A naive pairwise loop silently mis-parses the moment an argument
 * is omitted - a boolean flag eats the next flag's name as its value and the run is recorded
 * against the wrong environment, which is worse than not being recorded at all.
 */
function parseArgs(argv, known) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) throw new Error(`Unexpected argument "${tok}" - expected a --flag.`);
    const eq = tok.indexOf('=');
    const name = (eq === -1 ? tok.slice(2) : tok.slice(2, eq));
    if (!(name in known)) throw new Error(`Unknown flag --${name}. Known: ${Object.keys(known).map((k) => '--' + k).join(', ')}`);
    if (known[name] === 'boolean') { out[name] = true; continue; }
    let value;
    if (eq !== -1) value = tok.slice(eq + 1);
    else {
      value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
    }
    out[name] = value;
  }
  return out;
}

const KNOWN = {
  config: 'string', 'run-id': 'string', env: 'string',
  started: 'string', finished: 'string', results: 'string',
  'base-url': 'string', 'dry-run': 'boolean', 'runner-kind': 'string',
};

let args;
try {
  args = parseArgs(process.argv.slice(2), KNOWN);
} catch (e) {
  console.error(`[collect] ${e.message}`);
  process.exit(2);
}

for (const required of ['config', 'run-id', 'env']) {
  if (!args[required]) { console.error(`[collect] --${required} is required.`); process.exit(2); }
}

const cfg = JSON.parse(fs.readFileSync(args.config, 'utf8'));
const runsDir = cfg.runsDir ?? 'test-pipeline/runs';
const historyPath = path.join(runsDir, 'history.jsonl');
const resultsPath = args.results ?? cfg.runner?.resultsPath;

// --runner-kind lets CI intake override the config: a CI pipeline may publish a different format
// than the local runner (and an environment may mix both).
const adapterName = (args['runner-kind'] ?? cfg.runner?.kind ?? 'playwright').toLowerCase();
const { parse } = await import(`./adapters/${adapterName}.mjs`)
  .catch(() => { throw new Error(`No adapter for runner.kind "${adapterName}". Available: playwright, junit.`); });

let parsed;
try {
  parsed = parse(resultsPath, {
    custom: cfg.analysis?.customSignatures,
    sourceRe: cfg.analysis?.sourcePattern ? new RegExp(cfg.analysis.sourcePattern) : undefined,
  });
} catch (e) {
  // A results file we cannot read means we do not know what happened. Recording a fabricated
  // "0 passed, 0 failed" would enter the history as a real datapoint and quietly drag every
  // average down, so refuse instead. The runner treats a non-zero exit here as a skip.
  console.error(`[collect] ${e.message}`);
  process.exit(3);
}

/**
 * Failure counts, keyed by signature.
 *
 * Counted in DISTINCT TEST FILES affected, and the same definition is used everywhere downstream.
 * The alternative - counting individual test cases - diverges from this the moment one file holds
 * several tests, and a report that rebuilds one definition from the other then disagrees with
 * itself about its own totals.
 */
const bySig = new Map();
for (const d of parsed.failureDetail) {
  if (d.transient) continue;  // a retry-flake is not an outage; flake.mjs accounts for it
  let s = bySig.get(d.signature);
  if (!s) { s = new Set(); bySig.set(d.signature, s); }
  s.add(d.spec);
}
const failures = Object.fromEntries(
  [...bySig.entries()].map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1]),
);

const record = {
  runId: args['run-id'],
  startedAt: args.started ?? null,
  finishedAt: args.finished ?? null,
  env: args.env,
  baseUrl: args['base-url'] ?? null,
  suite: parsed.suite,
  failures,
  failureDetail: parsed.failureDetail,
  specs: parsed.specs,
};

if (args['dry-run']) {
  console.log(JSON.stringify(record, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.appendFileSync(historyPath, JSON.stringify(record) + '\n', 'utf8');

const s = parsed.suite;
console.log(`[collect] ${record.runId} ${record.env}: ${s.passed} passed, ${s.failed} failed, ${s.flaky} flaky, ${s.skipped} skipped -> ${historyPath}`);
