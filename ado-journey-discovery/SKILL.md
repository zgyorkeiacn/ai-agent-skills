---
name: ado-journey-discovery
description: 'Fetch an Azure DevOps epic and all child/related work items, then produce a full E2E journey map: narrative summary, in-scope scenario table, omitted/deferred scenario table, out-of-scope scenario table, and a parameterized domain expert question list. Accumulates a project-wide vocabulary across runs for cross-epic gap detection. Pass the epic ID or full ADO URL as the argument. Use "check" to verify PAT setup; "vocab show|clear|rebuild" to manage the vocabulary.'
argument-hint: '<epic-id> | <full-ADO-url> | "check" | "vocab show|clear|rebuild <ids>"'
user-invocable: true
---

# ado-journey-discovery Skill (`/ado-journey-discovery`)

Fetches an Azure DevOps epic and its full child/related work item hierarchy, then produces a
structured E2E journey map consisting of four deliverables:

- **Summary analysis** - epic overview, journey list, variation axes, data dimensions, error flows, integration points, gaps
- **Table A** - In-scope scenario table (Sno | Scenario | Scope | Variation)
- **Table B** - Omitted / deferred scenarios (same format, continued numbering)
- **Table C** - Out-of-scope scenarios (same format, continued numbering)
- **Domain expert questions** - parameterized question list derived from the analysis, grouped by theme, ready to hand to a product owner or BA

This skill does NOT look at any code repository. All input comes from ADO work items only.

---

## Mode detection

| Argument | Mode |
|----------|------|
| An epic ID (numeric) or full ADO URL | **Run** - full fetch + analysis + vocabulary update |
| `<epic-id> --no-vocab` | **Run (no vocab)** - full run, skip vocabulary load and update |
| `check` | **PAT check** - verify credentials only, no fetch |
| `vocab show` | **Vocab show** - print vocabulary summary: org, project, epic list, entity counts |
| `vocab clear` | **Vocab clear** - delete vocabulary files (asks for confirmation) |
| `vocab rebuild <id1,id2,...>` | **Vocab rebuild** - fetch listed epics, extract entity registers, build vocabulary without producing deliverables |
| No argument | **Prompt** - ask user for Epic ID / URL, then run |

---

## Step 0 - PAT verification

Before any API call, verify that `AZURE_DEVOPS_PAT` is available and non-trivial.

### How to find the PAT

Check in this order:

1. The shell environment: `$env:AZURE_DEVOPS_PAT` (PowerShell) or `$AZURE_DEVOPS_PAT` (bash)
2. A `.env` file at the repo root: look for `AZURE_DEVOPS_PAT=<value>`
3. A `.env` file at `<working-dir>/services/agent/.env` or any adjacent service directory

A PAT is valid if it exists and is not one of: `demo-mode`, `your-pat-here`, `<pat>`, empty string.

### If the PAT is missing or invalid

Stop and display this setup guide:

---

**ADO PAT not configured.** To use this skill you need a Personal Access Token with
**Work Items (Read)** scope for your Azure DevOps organization.

**To create a PAT:**
1. Go to `https://dev.azure.com/<your-org>` -> User Settings (top-right) -> Personal access tokens
2. Click **New Token**
3. Set scope: **Work Items** -> **Read**
4. Copy the generated token

**To configure it:** add this line to your `.env` file at the repo root:
```
AZURE_DEVOPS_PAT=<your-token-here>
```

Then re-run `/ado-journey-discovery <epic-id>`.

---

In `check` mode: report which `.env` files were found and whether a valid PAT was detected, then stop.

---

## Step 0.5 - Vocabulary load

Before resolving the epic ID, check whether a project vocabulary exists in the working directory.

Look for `artifacts/project-vocabulary.json` relative to CWD. If the file is not found there, also
check `artifacts/{org}-{project}-vocabulary.json` once `org` and `project` are known (after Step 1).

**If found:**
1. Parse the JSON and load the `org`, `project`, `epicsIncluded`, and `entities` fields into context.
2. Compare `org`/`project` against the current run's values (resolved in Step 1).
3. Match: report `Vocabulary loaded: {N} epics, {M} total entities.` and proceed.
4. Mismatch: warn `Vocabulary org/project mismatch — continuing without vocabulary.` and proceed
   as if no vocabulary exists.

**If not found:** continue silently. The vocabulary will be created in Step 4.5 after this run.

In `vocab show` mode: stop here after displaying the vocabulary summary. No ADO fetch needed.

---

## Step 1 - Epic ID and org/project resolution

### From a full ADO URL

Parse `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}`:
- `org` = second path segment after `dev.azure.com`
- `project` = third path segment
- `epicId` = the numeric ID after `edit/`

### From a bare numeric ID

If the argument is just a number, derive `org` and `project` as follows:
1. Check the `.env` file for `ADO_ORG` and `ADO_PROJECT` variables
2. If not present, look for an ADO URL pattern in recent git remote configs (`git remote -v`) or CLAUDE.md files
3. If still not resolved, ask the user:
   > "What is your ADO organization name and project name? (e.g., org=mycompany, project=MyProject)"

### Confirm before fetching

Display: `Fetching epic {epicId} from https://dev.azure.com/{org}/{project}` and proceed.

---

## Step 2 - ADO fetch (recursive)

### Authentication

Compute the Basic auth header value:

**PowerShell:**
```powershell
$enc = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat"))
# Header: "Authorization: Basic $enc"
```

**Constructed manually:** base64 of the string `:PAT` (colon + PAT value, no username).

### Fetch the root epic

```
GET https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{epicId}?$expand=all&api-version=7.1
Authorization: Basic <encoded>
```

A 3xx response or an HTML body (contains `<html`) means auth failure - report it and stop.

Extract from the response:
- `fields["System.Title"]`
- `fields["System.WorkItemType"]`
- `fields["System.State"]`
- `fields["System.Tags"]`
- `fields["System.Description"]` (HTML - strip per Step 3)
- `fields["Microsoft.VSTS.Common.AcceptanceCriteria"]` (HTML - strip per Step 3)
- `relations[]` array - collect all child and related IDs

### Collect child IDs from relations

From `relations[]`, extract IDs where `rel` contains `Hierarchy-Forward` or
`attributes.name` equals `Child`. ID = last segment of `url` split by `/`.

Also collect `Related` and `Dependency` link types for associated items.

### WIQL recursive query (catch stragglers)

```
POST https://dev.azure.com/{org}/{project}/_apis/wit/wiql?api-version=7.1
Content-Type: application/json
Body: {
  "query": "SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = {epicId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' MODE (Recursive)"
}
```

Union the IDs from this result with the IDs already collected. Deduplicate.

### Batch fetch all children

```
GET https://dev.azure.com/{org}/{project}/_apis/wit/workitems?ids={id1,id2,...}&$expand=all&api-version=7.1
```

Fetch in batches of up to 200 IDs. For each item, extract the same fields as the root epic and
collect any additional child IDs from its `relations[]`.

Repeat until no new IDs are discovered (BFS, max 4 levels deep). Skip any item that returns
404 or 401 - log a warning and continue.

### HTML stripping

For Description and AcceptanceCriteria fields:
1. Remove content inside `<s>`, `<strike>`, `<del>` tags (withdrawn content)
2. Replace `<br>`, `<p>`, `<div>`, `<li>`, `<tr>`, `<h1>`-`<h6>` with newlines
3. Strip all remaining HTML tags
4. Decode entities: `&nbsp;` -> space, `&amp;` -> `&`, `&lt;` -> `<`, `&gt;` -> `>`
5. Collapse multiple blank lines to one; trim leading/trailing whitespace

---

## Step 3 - Analysis

With all work items fetched and parsed, perform the full analysis below.
Read every acceptance criteria field carefully. Derive implicitly as well as explicitly stated
information - if an AC says "the 12-month plan appears first for student routes", that implies both
a student route and a non-student route exist as variants.

### A. Epic Overview

- What capability or feature this epic covers (plain English, 2-4 sentences)
- Commercial or strategic context if mentioned
- Go-live date or timeline if mentioned
- What is explicitly in scope
- What is explicitly out of scope

### B. Work Item Inventory

A markdown table with columns: `ID | Type | Title | State | Key Tags`
Include every fetched item. Group by type: Epics, Features, User Stories, Bugs, Enablers, Tasks.

### C. E2E Journeys

Derive every distinct end-to-end user journey that can be constructed from the work item
descriptions and acceptance criteria. Aim for 5-12 journeys. Include both happy paths and
the most important negative/error paths as separate journeys.

Present as a table using the same 4-column format as Tables A/B/C, with continuous Sno
starting at 1:

```
| Sno | Journey | Scope | Variation |
|-----|---------|-------|-----------|
| 1   | ...     | ...   | ...       |
```

**Column definitions:**
- `Sno` - sequential integer, starts at 1 (independent sequence from Tables A/B/C)
- `Journey` - concise end-to-end journey name (entry point + key decision or outcome)
- `Scope` - one of: `Acquisition`, `Secondline`, `Upgrade`
- `Variation` - what makes this journey distinct: entry route, coverage outcome, voucher mechanic,
  open bug reference, or flag state

### D. Variation Axes

For every axis of variation found (explicit or implicit in ACs):
- Technology type (e.g., indoor vs outdoor, FTTP vs FTTH vs SOGEA, FWA vs fixed)
- Acquisition vs upgrade vs secondline
- Plan/tariff tier and speed
- Contract length options
- Customer segment (new, existing, student, SoHo, consumer, business, etc.)
- Authentication state
- Channel (web, app, in-store, telesales, affiliate)
- Add-ons, bolt-ons, bundles
- Voucher / promotional code variants
- Feature flag states
- Any other axis found in the ACs

For each axis: list all values + which journeys it applies to.

### E. Scenario Matrix

A table mapping Journey x Variation: which combinations are explicitly or implicitly in scope.

### F. Data & Catalogue Dimensions

Every plan name, SKU/product ID, tariff, device, add-on, voucher prefix, feature flag, CMS
asset, affiliate, API endpoint, or catalogue item mentioned. Group by type.

### G. Error Flows & Edge Cases

Every failure path, validation error, or edge case mentioned in acceptance criteria or bug work
items. Group by journey. Note any open bugs with their current status.

### H. Integration Points

Every external system, API, or service referenced (billing, identity, order management, payment
gateway, CMS, feature flags, analytics, affiliates, etc.).

### I. Gaps & Ambiguities

Anything unclear, incomplete, or explicitly deferred. Number each gap. Note if any open or
unresolved bugs affect testability of a scenario.

If a vocabulary was loaded in Step 0.5, append a **Cross-Epic Context** sub-section after the
numbered gap list:
- For each `recurring` entity (present in both vocabulary and this epic): note which prior epic(s)
  introduced it and whether this epic's ACs describe the same or different behaviour.
- For each vocabulary-only entity that generated an `implicitGap[]` entry: note
  "Known from epic {X}: {entity} — not addressed in this epic's ACs."

---

## Step 3B - Entity register (feeds Deliverable 5)

After completing Step 3, extract a structured entity register from the analysis. This register
drives the parameterized question generation in Deliverable 5. Build it silently - do not output
it; use it only to inform which question categories apply and what specific items to name.

```
ENTITY REGISTER:
  planTypes[]         - every distinct plan / tariff found (name + key attributes: speed, tenure, SKU if known)
  addOns[]            - every add-on, bolt-on, or upgrade option mentioned (TV packages, hardware, wifi boosters, etc.)
  bundles[]           - any multi-product bundles found (e.g., mobile + broadband, broadband + TV)
  discounts[]         - every promotional discount or voucher mechanic found (name, type: fixed/%, eligible plans)
  voucherSources[]    - every affiliate or voucher-code source found (name, prefix/code format if mentioned)
  featureFlags[]      - every feature flag or A/B switch mentioned (name, controlling platform, what it gates)
  customerSegments[]  - every customer segment found (student, consumer, SoHo, existing, new, etc.)
  entryRoutes[]       - every distinct journey entry route found (standard, student, affiliate, in-store, etc.)
  oosItems[]          - every item explicitly out of scope (label + the reason stated in ADO, if given)
  openBugs[]          - every bug in Open, Retest, or New state (ID, title, affected plan/flow, current status)
  analyticsItems[]    - every analytics / reporting work item whose state is not Closed/Done
  implicitGaps[]      - combinations that logically should exist given the product type but are absent from ADO
                        (derive by comparing found planTypes x addOns x bundles against what ACs explicitly confirm)
```

### How to identify implicit gaps

For each found `planType`, check whether the ACs explicitly confirm or deny its compatibility with:
- every found `addOn`
- every found `bundle` type
- every found `discount`

If compatibility is neither confirmed nor denied, add an entry to `implicitGaps[]` describing the
unaddressed combination (e.g., "12-month FWA plan + TV add-on: no AC addresses this").

Also check whether the product category typically carries combinations that are entirely absent
from the epic (e.g., a broadband epic with no mention of any TV add-on whatsoever - that silence
itself is an implicit gap worth surfacing as a question).

### Cross-reference with loaded vocabulary (if any)

If a vocabulary was loaded in Step 0.5, perform the following after building the entity register:

1. **Tag each entity** from the current epic:
   - `recurring` - a matching entry already exists in the vocabulary (match by lowercase-trimmed
     `name`; for bugs, by `id`)
   - `new` - no match found

2. **Detect vocabulary-only entities**: for each entity in the vocabulary that has no match in the
   current epic's entity register, check whether the ACs explicitly exclude it or are simply silent.
   If silent: add an `implicitGap[]` entry: "Known from epic {prior-epic-id}: {entity.name} — no AC
   in this epic confirms or denies compatibility with this epic's plans."

3. **Enrich Deliverable 5 questions for recurring entities**: when generating a question about a
   `recurring` entity, prefix it with a cross-epic anchor where the prior behaviour is known:
   > "In epic {priorEpicId}, {entity.name} was {prior-known-behaviour}. Does the same apply here,
   > or has the rule changed?"

---

## Step 3C - Template instantiation

If a vocabulary was loaded and it contains a non-empty `scenarioTemplates[]`, instantiate every
template whose trigger conditions are met by the current epic's entity register.

**Trigger evaluation:** a template fires when all entity types listed in its `trigger[]` field have
at least one matching entity in the current run's register (e.g., trigger `["voucherSources","discounts"]`
fires only when both are non-empty).

**Instantiation:** for each fired template, substitute every `{placeholder}` with the corresponding
entity values from the current run. A template with multiple matching entities (e.g., four planTypes)
produces one instantiated row per entity combination. Collect all instantiated rows into a working
set for Step 3D.

**Net-new rows:** also add any `(Scenario, Scope, Variation)` rows derived from the analysis in
Step 3 that do not correspond to any template. Tag these as `net-new`. Net-new rows follow the same
classification rules in Step 3D.

**Template schema (stored in vocabulary `scenarioTemplates[]`):**
```json
{
  "name": "basket-voucher-plan-switch",
  "trigger": ["voucherSources", "discounts"],
  "scenario": "Basket",
  "scope": "Acquisition",
  "variation": "Eligible {Plan} -> Switch to Ineligible -> Voucher Re-applied",
  "sourceEpic": "3889235",
  "defaultClassification": "deferred",
  "note": "historically a bug-zone edge case; explicit AC rarely present"
}
```

`defaultClassification` values:
- `check-ac` (default) — run the full classification rules in Step 3D
- `deferred` — land in Table B unless an AC explicitly promotes it to Table A
- `oos` — land in Table C unless an AC explicitly overrides

---

## Step 3D - AC coverage check and auto-classification

For every row in the Step 3C working set, assign a classification using the rules below in
priority order (first match wins):

### Rule 1 → Table C (Out of Scope)
Classify as OOS if ANY of:
- The row's `Scenario` or `Variation` technology/plan type matches an entry in `oosItems[]`
- An AC or epic description explicitly excludes this scenario (keywords: "out of scope", "not in scope",
  "excluded", "not applicable")
- The user story covering this scenario has state **Rejected**
- The template's `defaultClassification` is `oos` and no AC explicitly overrides it

For Table C rows: append the exclusion reason to the `Variation` column in parentheses,
e.g. `Outdoor 5G 50 Mbps - 12 Month (OOS: upgrade journeys explicitly excluded)`.

### Rule 2 → Table A (In Scope)
Classify as In Scope if ANY of:
- An AC directly covers this `(Scenario, Scope, Variation)` combination
- An active/closed user story explicitly delivers this scenario
- The scenario is a logical implication of an AC (e.g., an AC confirming "all four SKUs" implies
  one Table A row per SKU)
- The template's `defaultClassification` is `check-ac` and AC coverage is confirmed

### Rule 3 → Table B (Deferred / Removed)
Classify as Deferred if ANY of:
- The covering user story has state **Removed** or **Deferred**
- AC or description language signals deferral: "future PI", "to be decided", "not this delivery",
  "planned for later", "deferred", "TBD"
- The template's `defaultClassification` is `deferred` and no AC explicitly promotes it to Table A
- **No AC, OOS statement, or story covers this row at all** → tag as:
  `(No AC found — defaulting to Deferred pending confirmation)`

For Table B rows: append the deferral reason to the `Variation` column in parentheses.

### Output of Step 3D
Three classified lists:
- `tableA[]` — in-scope rows, ready to emit as Deliverable 2
- `tableB[]` — deferred/removed rows, ready to emit as Deliverable 3
- `tableC[]` — out-of-scope rows, ready to emit as Deliverable 4

Apply continuous `Sno` across all three lists in order: tableA first (Sno 1…N), tableB next
(N+1…M), tableC last (M+1…P).

---

## Step 4 - Output

Produce the four deliverables in order, separated by `---`.

### Deliverable 1: Summary Analysis

Sections A through I from Step 3, in full.

### Deliverable 2: Table A - In-Scope Scenarios

Emit the `tableA[]` list from Step 3D in Sno order. Every row was classified as In Scope by
AC coverage check or direct story evidence. Format:

```
| Sno | Scenario | Scope | Variation |
|-----|----------|-------|-----------|
| 1   | ...      | ...   | ...       |
```

**Column definitions:**
- `Sno` - sequential integer, starts at 1, continuous across all three tables
- `Scenario` - technology or journey pathway (e.g., "FWA Indoor", "Student Route"). For upgrade
  journeys use "FROM - TO" format.
- `Scope` - one of: `Acquisition`, `Secondline`, `Upgrade`
- `Variation` - the specific plan, speed, tenure, voucher, flag, or route combination that makes
  this row distinct. For rows sourced from a template, the template's variation string with
  placeholders filled in.

After the table, add a **Notes** block listing: rows elevated from error-path to Table A,
rows that represent known-buggy flows (cite bug ID), and any net-new rows (not from a template).
Also note: `{N} rows from scenario templates ({K} templates fired); {M} net-new rows.`

### Deliverable 3: Table B - Deferred / Removed Scenarios

Emit the `tableB[]` list from Step 3D, continuing Sno from Table A. Every row was classified
as Deferred because: the covering story is Removed/Deferred, deferral language was found in the
ACs, or no AC/story/OOS statement addresses the row at all.

The `Variation` column includes the deferral reason in parentheses for every row, e.g.:
- `Outdoor 5G 150 Mbps - 30 Day Rolling (Deferred: no AC coverage — defaulting to Deferred)`
- `Student Route - 150 Mbps + Unidays Voucher (Deferred: story 4183671 Removed)`

Include all template-instantiated rows that did not reach Table A and were not excluded:
- Lower-priority variations not explicitly covered
- Granular affiliate/voucher permutations without individual ACs
- Secondline mirrors of acquisition scenarios without dedicated ACs
- Any template row whose `defaultClassification` is `deferred`

### Deliverable 4: Table C - Out-of-Scope Scenarios

Emit the `tableC[]` list from Step 3D, continuing Sno from Table B. Every row was classified
as OOS by explicit exclusion, matching `oosItems[]`, Rejected story state, or `defaultClassification: oos`.

The `Variation` column includes the exclusion reason in parentheses for every row, e.g.:
- `12 Month Re-contract from 24 Month (OOS: upgrade journeys explicitly excluded)`
- `Pro 5G Outdoor - 12 Month (OOS: no CMT entry exists)`

### Deliverable 5: Domain Expert Questions

A numbered question list grouped by theme, ready to hand verbatim to a product owner, BA, or
domain expert. Every question must name the specific items found in this epic - never use generic
placeholders like "the plan" or "the discount". Use the entity register from Step 3B to populate
names, SKUs, statuses, and values.

Only emit a category if at least one relevant entity from the register applies to it. Omit
categories entirely when they have no applicable entities (e.g., skip "Voucher mechanics" if no
`discounts[]` or `voucherSources[]` were found).

---

#### Category: Bundle & Add-on Coverage

Emit this category if `bundles[]` is non-empty OR `addOns[]` is non-empty OR `implicitGaps[]`
contains any bundle/add-on entry.

For each item in `implicitGaps[]` that involves a bundle or add-on:
> Can {planType.name} be purchased as part of a {bundle.name} bundle? If yes, which specific
> plan variants are eligible, and does {discount.name if any} still apply on the broadband component?

If `addOns[]` is non-empty but their eligibility with found plan types is not confirmed in ACs:
> Are {addOn.name} add-ons available with {planType.name} plans? If yes, which combinations are
> eligible and are there any contract-length or segment restrictions?

If `addOns[]` is empty and the product category is broadband:
> Are there any TV packages, hardware add-ons, or wifi bolt-ons that can be combined with the
> plans introduced by this epic? If yes, which plan variants are eligible?

---

#### Category: Plan Display & Ordering

Emit this category if `featureFlags[]` is non-empty OR the ACs describe any UI ordering rules.

For each `featureFlag` that controls display or ordering:
> When {featureFlag.name} is {featureFlag.offState}, what is the exact display order of
> {affectedPlanTypes} on the plan selection page? Does this differ by entry route?

For each `entryRoute` where plan ordering is described:
> On the {entryRoute.name} route, does {planType.name} appear in the pre-built "Choose a plan"
> tab as well as the "Build a plan" tab, or is it restricted to one tab only?

---

#### Category: Discount & Promotion Mechanics

Emit this category if `discounts[]` or `voucherSources[]` is non-empty.

For each item in `discounts[]` where monetary value is not stated in ADO:
> What is the exact value of the {discount.name} - is it a fixed monthly amount, a percentage,
> or a total contract reduction? Which of the {eligiblePlanTypes} does it apply to?

For each item in `discounts[]` where the display name is uncertain (flagged in `implicitGaps[]`):
> What is the final customer-facing display name of the {discount.name} as it appears on the
> plan card, in the basket, and in the order confirmation?

For each item in `voucherSources[]`:
> For {voucherSource.name} codes (prefix: {voucherSource.prefix if known}): what are the full
> validation rules - character length, allowed character set, expiry period, and maximum uses per code?

If multiple `voucherSources[]` exist:
> Is the voucher redemption mechanism identical across all affiliate sources
> ({voucherSources.names joined}), or does any source use a different integration
> (e.g., identity verification, SBP handshake, pre-population) before the code is issued?

For each `discount` where automatic pass-through is mentioned but deferred:
> Is automatic voucher pre-population from the URL parameter planned for a future release?
> If yes, which PI or release is it targeted for?

---

#### Category: Out-of-Scope Rationale & Timeline

Emit this category if `oosItems[]` is non-empty.

For each item in `oosItems[]` where the reason is not stated in ADO:
> What is the reason {oosItem.label} is out of scope for this epic - commercial decision,
> technical dependency, or prioritisation? Is there a planned PI or release to add it?

For each item in `oosItems[]` where the item is an upgrade journey:
> When upgrade journeys are added for {affectedPlanTypes}, will the same
> {discount.name if any} and eligibility rules apply, or will a separate eligibility model be defined?

For each item in `oosItems[]` where the item is a customer segment:
> Is {oosItem.label} served by a separate platform or journey? If so, will {epicTitle}'s
> changes need to be replicated there separately?

---

#### Category: Open Bugs - Test Impact

Emit this category if `openBugs[]` is non-empty.

For each item in `openBugs[]`:
> Bug {bug.id} ({bug.title}) is currently {bug.status}. What is the expected fix ETA,
> and should E2E tests for {affectedFlow} be written against the fixed behaviour now,
> or held until the fix is verified in the target environment?

For each open bug where the correct expected value is ambiguous (e.g., price discrepancy):
> For bug {bug.id}: what is the correct expected {affectedAttribute} for {affectedPlan}
> so that E2E assertions can be written against the right value?

---

#### Category: Coverage Gaps Needing Clarification

Emit this category if `implicitGaps[]` is non-empty after filtering out items already
covered by the Bundle/Add-on category above.

For each remaining item in `implicitGaps[]`:
> {implicitGap.description} - is this combination in scope, out of scope, or handled by
> a separate epic? If in scope, which acceptance criteria govern it?

For each `customerSegment` where behaviour in edge-case combinations is not addressed:
> When a {customerSegment.name} customer {edgeCaseDescription}, what is the expected
> behaviour? For example: {concreteExample derived from the gap}.

---

#### Category: Analytics & Tracking

Emit this category if `analyticsItems[]` is non-empty.

For each item in `analyticsItems[]` that is not Closed:
> Analytics story {item.id} ({item.title}) is currently {item.status}. Does its delivery
> block sign-off on the E2E journey, or will it be tracked separately post go-live?

> Which analytics events are mandatory to assert in E2E testing versus which are monitored
> independently by the analytics team after go-live?

---

## Step 4.5 - Vocabulary update

After producing all 5 deliverables, update the project vocabulary. **Skip this step if:**
- The run used `--no-vocab`
- The argument was a `vocab` command
- The vocabulary org/project mismatched (mismatch warning was shown in Step 0.5)

**Merge procedure:**

1. Load `artifacts/project-vocabulary.json` if it exists; otherwise initialise an empty structure
   with the current `org`, `project`, today's date, and empty `epicsIncluded[]` / `entities{}`.

2. For each entity type in the current run's entity register:
   - Match against existing vocabulary entries (lowercase-trimmed `name`; `id` for bugs).
   - **New entity** (no match): append to the vocabulary with `"epics": [currentEpicId]`.
   - **Existing entity** (match): union `epics[]`; update mutable fields from the current run
     (`status` for bugs; `gates`/`platform` for feature flags; `sku`/`attributes` for planTypes).

2b. For each net-new row in `tableA[]` (tagged as `net-new` in Step 3C), extract a reusable
    scenario template and append it to `scenarioTemplates[]` if no equivalent template already
    exists (match by normalized `scenario` + `scope` + `variation` with placeholders re-abstracted):
    - Replace specific entity values with their placeholder form
      (e.g., "5G Broadband 50 Mbps - 12 Month" → "{Plan} {Speed} - {Tenure}")
    - Set `trigger[]` to the entity types present in the row
    - Set `sourceEpic` to the current epic ID
    - Set `defaultClassification` to `check-ac`
    Also add templates for any net-new rows in `tableB[]` or `tableC[]` that represent a
    pattern worth reusing, with `defaultClassification` set to `deferred` or `oos` respectively.

3. Append the current epic to `epicsIncluded[]` if not already present (match by `id`).
4. Set `lastUpdated` to today's date.
5. Write `artifacts/project-vocabulary.json`.
6. Regenerate `artifacts/project-vocabulary.md`:
   - Header table: `Org | Project | Last Updated | Epics | Total Entities`
   - Epic list table: `Epic ID | Title | Added`
   - One section per entity type: all entities as a table with a `Epics` provenance column.
7. Report: `Vocabulary updated — {N} new entities, {M} updated, {T} total epics included.`

---

## Rules

- **ADO-only**: do not read any code repository, test files, or Figma designs. All input comes
  from ADO work items exclusively.
- **No PAT in output**: never echo the PAT value in any response or log line.
- **Derive implicitly**: if ACs imply a variation exists (e.g., "for non-student routes the
  24-month plan appears first"), include both the student and non-student paths even if only
  one is spelled out explicitly.
- **Bugs count**: open and retest bugs are informative - include their flows as scenarios in
  Table A or B, and flag their status in the Notes block.
- **Continued numbering**: Sno is a single continuous sequence across all three tables. Table B
  starts where Table A ended; Table C starts where Table B ended.
- **No row count target**: the number of rows is determined by the epic's actual scope.
  Do not pad or truncate to hit a round number.
- **Terse scenario names**: Scenario column is the technology/pathway label only, not a full
  sentence. Variation column carries the plan/config detail.
- **Questions are specific, never generic**: every question in Deliverable 5 must name the
  actual plan, discount, bug ID, flag name, or segment found in this epic. A question containing
  "the plan" or "the discount" without a specific name is a defect in the output.
- **Omit empty categories**: if no relevant entities exist for a question category, skip that
  category entirely. Do not emit empty or placeholder category headers.
- **Questions are answerable**: each question should be answerable with a single factual response
  by someone who knows the product. Avoid compound questions with more than two sub-parts.
- **Vocabulary is additive**: never delete or overwrite existing vocabulary entries or scenario
  templates based on absence in a new epic. Absence means "not mentioned here", not "no longer
  true". Only update mutable fields (status, attributes) with newer values.
- **Everything is listed**: every template that fires must produce a row in one of the three
  tables. A template row cannot be silently dropped — if it has no AC and no OOS reason,
  it goes to Table B with the "No AC found" tag. The user sees the full enumerated set.
- **Classification is derived, not assumed**: the Table A/B/C assignment comes from reading
  the ACs and work item states, not from the analyst's judgement. When evidence is ambiguous,
  Table B is the conservative default.
- **Cross-epic questions name the source epic**: any Deliverable 5 question that references a
  prior epic's behaviour must include the source epic ID so the domain expert has context.

---

## Vocab mode detail

### `vocab show`

Read `artifacts/project-vocabulary.json` (or check both naming variants). Display:
- Org, project, lastUpdated
- Number of epics included, with a table: `Epic ID | Title | Added`
- Entity count per type in a summary table

If no vocabulary file exists, report: `No vocabulary found for this project. Run
/ado-journey-discovery <epic-id> to create one.`

### `vocab clear`

Ask: `Delete vocabulary for {org}/{project}? This cannot be undone. (yes/no)`.
On confirmation: delete `artifacts/project-vocabulary.json` and `artifacts/project-vocabulary.md`.
Report the file paths deleted.

### `vocab rebuild <id1,id2,...>`

Build the vocabulary from scratch by re-fetching multiple epics without producing deliverables.

1. Parse the comma-separated epic IDs from the argument.
2. Resolve `org` and `project` via Step 1 logic using the first ID.
3. For each epic: run Step 2 (ADO fetch) and Step 3B entity register extraction only.
   Do **not** run Step 3 analysis sections A–I. Do **not** produce any deliverables.
4. Merge all entity registers into a fresh vocabulary (overwrite any existing file).
5. Write `artifacts/project-vocabulary.json` and regenerate `artifacts/project-vocabulary.md`.
6. Report: `Vocabulary rebuilt from {N} epics — {M} total entities across {K} entity types.`

If any epic fetch fails (404, auth error), log a warning and continue with the remaining epics.
