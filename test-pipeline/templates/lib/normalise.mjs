/**
 * Signature normalisation.
 *
 * A failure signature is the key every report groups by. If the signature carries a value that
 * changes each run - an order id, a UUID, a timestamp, a correlation id - then one recurring fault
 * produces a brand new signature every hour and never aggregates. The reports then show a long tail
 * of one-off failures where there is actually a single fault happening sixty times, which is
 * exactly backwards from what a reader needs.
 *
 * WHY THIS RUNS AT READ TIME AND NOT AT COLLECT TIME
 *
 * The signature is the join key across the whole recorded history. Normalising at collect time
 * would leave every record written before the change keyed on the raw string and every record after
 * it keyed on the masked one - one fault split into two, either side of the deploy, which is the
 * precise failure this module exists to prevent. Masking on read means the same rules are applied
 * uniformly to all history, old and new, and changing the rules re-groups everything consistently.
 *
 * Corollary: never persist a normalised signature back into the history file.
 */

/**
 * Ordered masking rules. Order matters where patterns overlap: the more specific pattern must run
 * first or the general one eats it. UUIDs before hex runs, ISO timestamps before bare digit runs.
 */
const RULES = [
  // RFC 4122 UUID in any case, hyphenated.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],

  // ISO-8601 timestamps, with or without offset or fractional seconds.
  //
  // The hour is \d{1,2}, not \d{2}. Plenty of loggers emit an unpadded hour, and requiring two
  // digits means "T9:00:00Z" survives masking while "T16:00:00Z" does not - so the same fault
  // fragments into a morning variant and an afternoon one, which is precisely the failure this
  // module exists to prevent.
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<timestamp>'],

  // Bare dates.
  [/\b\d{4}-\d{2}-\d{2}\b/g, '<date>'],

  // Clock times, likewise tolerant of an unpadded hour.
  [/\b\d{1,2}:\d{2}:\d{2}\b/g, '<time>'],

  // URLs. Keep the scheme and path shape, drop host and query - the host is usually the
  // environment, which is already recorded on the run, and the query is usually where the ids hide.
  [/\bhttps?:\/\/[^\s"'<>)]+/gi, '<url>'],

  // Long hex runs: tokens, hashes, trace ids. 16+ avoids eating ordinary words.
  [/\b[0-9a-f]{16,}\b/gi, '<hex>'],

  // Long digit runs: order numbers, account numbers, epoch millis. 6+ avoids eating status codes,
  // ports, counts and small quantities, all of which are meaningful in a signature.
  [/\b\d{6,}\b/g, '<n>'],

  // Windows and POSIX absolute paths, which differ per runner host.
  [/\b[A-Za-z]:\\[^\s"'<>)]+/g, '<path>'],
  [/(?:^|\s)(\/(?:usr|home|var|tmp|opt|Users)\/[^\s"'<>)]+)/g, ' <path>'],

  // Bracketed retry/attempt counters, which increment within one fault.
  [/\battempt\s+\d+\s*(?:of|\/)\s*\d+/gi, 'attempt <i>'],
  [/\bafter\s+\d+\s+attempts?\b/gi, 'after <i> attempts'],
];

/**
 * Apply the masking rules to an arbitrary string.
 * Exported for use on messages as well as signatures, so a knowledge-file lookup can match on a
 * masked message body rather than only on the signature.
 */
export function maskVolatile(text) {
  let out = String(text ?? '');
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Normalise a signature for grouping.
 *
 * Structured signatures - those produced by the classifier's recognised tiers - already discarded
 * their volatile parts when they were built, so masking them is a no-op and is skipped to avoid
 * surprises. The exception is the unstructured fallback, which by design carries raw message text
 * and is therefore where all the fragmentation happens.
 *
 * @param {string} signature  the signature as recorded
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]  when false, returns the signature untouched
 * @returns {string}
 */
export function normaliseSignature(signature, { enabled = true } = {}) {
  const sig = String(signature ?? '');
  if (!enabled) return sig;

  // Structured kinds carry no volatile payload; leave them exactly as-is so existing groupings and
  // any curated knowledge keys continue to match.
  if (/^(HTTP_\d{3}|POLL_TIMEOUT|RETRY_EXHAUSTED|STATE_)/.test(sig)) return sig;

  // ASSERT embeds the received value, which is frequently an id or a timestamp.
  if (sig.startsWith('ASSERT ')) return `ASSERT ${maskVolatile(sig.slice(7))}`;

  // OTHER is raw message text. This is the case that fragments without masking.
  if (sig.startsWith('OTHER ')) return `OTHER ${maskVolatile(sig.slice(6))}`;

  return maskVolatile(sig);
}

/**
 * Group a list of {signature, ...} records by normalised signature.
 * Returns a Map of normalised signature -> { signature, variants:Set, records:[] }, preserving the
 * first raw signature seen so a reader can still recognise the original text.
 */
export function groupByNormalised(records, opts = {}) {
  const out = new Map();
  for (const r of records) {
    const key = normaliseSignature(r.signature, opts);
    let e = out.get(key);
    if (!e) {
      e = { signature: key, raw: r.signature, variants: new Set(), records: [] };
      out.set(key, e);
    }
    e.variants.add(r.signature);
    e.records.push(r);
  }
  return out;
}
