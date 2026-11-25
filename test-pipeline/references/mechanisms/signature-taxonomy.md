# Signature taxonomy and normalisation

A **signature** is a short, stable string naming what went wrong, so the same fault across fifty
runs aggregates into one row with a count of fifty rather than fifty rows of one.

Implemented in `templates/lib/signature.mjs` and `templates/lib/normalise.mjs`.

## The five tiers, in order

The order is load-bearing, not cosmetic.

| # | Kind | Signature form | What it means |
|---|---|---|---|
| 1 | `downstream-state` | `STATE_<NAME>` | Every call succeeded; a system further down refused or stalled the transaction. |
| 2 | `http` | `HTTP_<code> <where>` | A non-2xx response. `<where>` is the calling module, so one code against two endpoints stays two faults. |
| 3 | `timeout` | `POLL_TIMEOUT <where>` / `RETRY_EXHAUSTED` | Nothing errored; a condition never came true inside the window. |
| 4 | `assertion` | `ASSERT <exp> != <recv>` | The call worked and the value was wrong. |
| 5 | `other` | `OTHER <first 90 chars>` | Unrecognised. Keeps raw text deliberately. |

### Why the order matters

A transaction that ends in a downstream rejection and a poll that timed out waiting for that same
transaction are the SAME fault. Match the poll first and one outage splits across `STATE_REJECTED`
and `POLL_TIMEOUT`, and neither count reveals it hit every test.

### Why tier 5 keeps raw text

Collapsing everything unrecognised into one `OTHER` bucket hides new faults completely. Keeping the
text means a new failure is visible and can be classified later, instead of disappearing into a
catch-all that nobody reads.

## Normalisation

Tier 5 is also where fragmentation happens: an error carrying a UUID, an order id or a timestamp
produces a **new signature every run** and never aggregates. Recurring faults then present as a long
tail of one-offs, which is exactly backwards.

`normalise.mjs` masks volatile values: UUIDs, ISO timestamps (padded or not), dates, clock times,
URLs, long hex runs, digit runs of 6+, and absolute paths.

Thresholds are chosen so meaningful values survive: 6+ digits does not eat status codes, ports or
small counts; 16+ hex does not eat ordinary words.

### At read time, never at collect time

The signature is the join key across the whole history. Masking at collect time leaves every record
written before the change keyed on the raw string and everything after on the masked one - one
fault split across the deploy, which is the precise failure normalisation exists to prevent.

Masking on read applies the same rules uniformly to all history, and changing the rules re-groups
everything consistently. **Never write a normalised signature back into the history file.**

## Attribution

`sourceOf()` answers "what is to blame", separately from "who owns it":

| Kind | Meaning |
|---|---|
| `downstream` | A system behind the interface refused the transaction. |
| `api` | A named endpoint or module returned the error. |
| `runner` | The machine running the tests - browser launch, host network. |
| `other` | No single source identified. |

Downstream is checked first for the same reason it leads the classifier: by the time a downstream
system refuses, every call has already returned OK, so charging it to the endpoint that merely read
the state back would make the messenger look like the worst component in the system.

## Project-specific rules

`analysis.customSignatures` in the config takes `{pattern, signature, kind}` entries, checked before
the built-in tiers. This lets a team teach the classifier its own domain vocabulary without editing
the shared library.
