/**
 * Turning a raw error message into a signature.
 *
 * A signature is a short, stable string naming WHAT went wrong, so that the same fault occurring in
 * fifty runs aggregates into one row with a count of fifty rather than fifty rows of one.
 *
 * THE ORDER OF THE TIERS IS LOAD-BEARING.
 *
 * A transaction that ends in a downstream rejection and a poll that timed out waiting for that same
 * transaction are the SAME fault. If the poll is matched first, one outage splits across
 * STATE_REJECTED and POLL_TIMEOUT and neither count reveals that it hit every test. So the
 * downstream state is checked before the timeout, and the timeout before the generic assertion.
 */

/** Strip terminal colour codes and collapse the stack to one line so patterns can span it. */
function flatten(message) {
  return String(message ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Optional project-specific extractors, supplied via config. Each is
 * `{ pattern: string, signature: string, kind: string }` where `signature` may reference capture
 * groups as `$1`, `$2`. Checked before the built-in tiers, so a team can teach the classifier its
 * own domain vocabulary without editing this file.
 */
function applyCustom(msg, custom) {
  for (const rule of custom ?? []) {
    let re;
    try { re = new RegExp(rule.pattern, rule.flags ?? ''); } catch { continue; }
    const m = msg.match(re);
    if (!m) continue;
    const sig = String(rule.signature ?? '').replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
    return { signature: sig, kind: rule.kind ?? 'custom' };
  }
  return null;
}

/**
 * Classify one failure message.
 *
 * @param {string} message
 * @param {object} [opts]
 * @param {Array}  [opts.custom]    project-specific rules, checked first
 * @param {RegExp} [opts.sourceRe]  extracts the responsible module from a stack frame
 * @returns {{signature: string, kind: string}}
 */
export function classifyMessage(message, opts = {}) {
  const m = flatten(message);
  if (!m) return { signature: 'OTHER (no message)', kind: 'other' };

  const custom = applyCustom(m, opts.custom);
  if (custom) return custom;

  // Where in the caller's own code did this surface? Used to qualify HTTP and timeout signatures so
  // the same status code against two different endpoints stays two distinct faults.
  const sourceRe = opts.sourceRe ?? /at\s+.*?[\\/]((?:api|client|services|helpers)[\\/][\w\-./\\]+?)\.(?:ts|js|mjs|py|java)/;
  const whereMatch = m.match(sourceRe);
  const where = whereMatch ? whereMatch[1].replace(/\\/g, '/') : 'unknown';

  // Tier 1 - a downstream system explicitly reported a terminal or stalled state. Every call
  // returned OK; the transaction was refused or stalled afterwards.
  const state =
    m.match(/"(?:stateDetail|state|status)"\s*:\s*"([A-Z][A-Z0-9_]{2,})"/) ??
    m.match(/\bstate(?:Detail)?\s+"([A-Z][A-Z0-9_]{2,})"/) ??
    m.match(/expected\s+[A-Z_]+\s+but\s+got\s+([A-Z][A-Z0-9_]{2,})/);
  if (state) return { signature: `STATE_${state[1]}`, kind: 'downstream-state' };

  // Tier 2 - a non-2xx response.
  const code =
    m.match(/\bReceived:\s*(\d{3})\b/) ??
    m.match(/\bstatus code (?:was|is)[:\s]+(\d{3})\b/i) ??
    m.match(/\bresponded with (\d{3})\b/i) ??
    m.match(/\bHTTP\s+(\d{3})\b/);
  if (code) return { signature: `HTTP_${code[1]} ${where}`, kind: 'http' };

  // Tier 3 - waited for something that never became true. Distinct from an error: nothing failed,
  // it just never finished.
  if (/\b(?:poll|waitFor|waitUntil)[^:]*: ?condition not satisfied|timed out waiting|Timeout .* exceeded/i.test(m)) {
    return { signature: `POLL_TIMEOUT ${where}`, kind: 'timeout' };
  }
  if (/too many retry attempts|retries exhausted|max retries/i.test(m)) {
    return { signature: 'RETRY_EXHAUSTED', kind: 'timeout' };
  }

  // Tier 4 - the call worked and the value was wrong. The system disagreed with its own contract.
  const assertion = m.match(/Expected:?\s*(\S+)[\s\S]{0,40}?Received:?\s*(\S+)/);
  if (assertion) {
    return { signature: `ASSERT ${assertion[1]} != ${assertion[2]}`.slice(0, 80), kind: 'assertion' };
  }

  // Tier 5 - unrecognised. Deliberately keeps raw text rather than collapsing everything unknown
  // into one bucket, so a new fault is visible and can be classified later instead of disappearing.
  // normalise.mjs masks the volatile parts of this at read time; without that it would fragment.
  return { signature: `OTHER ${m.slice(0, 90)}`, kind: 'other' };
}

/**
 * Attribute a signature to a source, for the "what is to blame" view.
 *
 * Downstream state is checked first for the same reason it is checked first in the classifier: by
 * the time a downstream system refuses a transaction every call has already returned OK, so
 * charging it to the endpoint that merely read the state back would make the messenger look like
 * the worst component in the system.
 */
export const KINDS = {
  api: { label: 'API', cls: 'k-api' },
  downstream: { label: 'DOWNSTREAM', cls: 'k-down' },
  runner: { label: 'RUNNER', cls: 'k-run' },
  other: { label: 'UNATTRIBUTED', cls: 'k-other' },
};

export function sourceOf(signature, message) {
  const sig = String(signature ?? '');

  const state = sig.match(/^STATE_(.+)$/);
  if (state) return { kind: 'downstream', name: state[1] };

  if (/browserType\.launch|Target page, context or browser has been closed/i.test(sig)) {
    return { kind: 'runner', name: 'browser launch' };
  }
  if (/net::ERR_|ECONNRESET|EADDRINUSE/i.test(sig)) {
    return { kind: 'runner', name: 'runner host network' };
  }

  const ep = sig.match(/^HTTP_\d{3}\s+(.+)$/) ?? sig.match(/^POLL_TIMEOUT\s+(.+)$/);
  if (ep && ep[1] !== 'unknown') return { kind: 'api', name: ep[1] };

  // A poll that named no module still names the step that threw.
  const last = String(message ?? '').match(/Last error:\s*(?:Error:\s*)?(\w+):/);
  if (last) return { kind: 'api', name: last[1] };

  return { kind: 'other', name: 'no source identified' };
}

/**
 * Stable F-keys (F1, F2, ...) ranked by total occurrences.
 * Shared across reports so "F3" means the same failure in all of them - two reports that disagree
 * about what F3 is are worse than either omitting the key.
 */
export function buildReasonKeys(runs) {
  const totals = new Map();
  for (const r of runs) {
    for (const [sig, n] of Object.entries(r.failures ?? {})) {
      totals.set(sig, (totals.get(sig) ?? 0) + n);
    }
  }
  const signatures = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const reasonKey = new Map(signatures.map((s, i) => [s, `F${i + 1}`]));
  return { signatures, reasonKey, totalFor: (s) => totals.get(s) ?? 0 };
}
