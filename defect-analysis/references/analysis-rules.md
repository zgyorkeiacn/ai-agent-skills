# Analysis rules (ADO mode)

The same rules the Defect Analyzer app gives its model (`src/core/spec.ts`). Follow them exactly so the skill and the app write the same thing.

## What to read per bug

Run `python scripts/defect_tool.py show --data <bugs.json> --id <ID>`. It prints:
- every field, with noise fields removed;
- the field history, whose first entry for a field is the value the bug was raised with;
- the relations;
- every comment.

Read all of it before writing anything. Test-account passwords are already redacted. Never repeat any credential you see.

## Output: one object per bug

Write them to `analyses-<n>.json` as `{"tickets": [ ... ]}`:

```json
{
  "id": "4753896",
  "rca": "Coding error",
  "rcaReason": "",
  "area": "BE",
  "justification": "...",
  "otherAction": "...",
  "resolution": "Code fix - ...",
  "mitigation": "...",
  "bucket": "Valid Miss",
  "defectAnalysis": "...",
  "leakage": "..."
}
```

**rca:** the verified root cause. It must be exactly one of these:
- `Coding error`: the default. ADO's "Code Defect" means the same thing.
- `Design gap`: the build matched the design, but the design (Figma, UX) was wrong, incomplete or changed afterwards.
- `Requirement gap`: the requirement or acceptance criteria did not cover the case, the product owner clarified or changed the expected behaviour, or a fix was reverted because the expected result was wrong.
- `External code issue`: the fault was in a shared or external library owned by another team (for example the shared `dal-core` library, or a source-web design-system component), or in a downstream system (TIL, UIM, PEGA, another team's catalogue). eCare's own packages, including the eCare Core packages in `lib-source-web`, are **not** external.

Only depart from the ADO value when the ticket's evidence is clear.

**rcaReason:** `""` when rca is `Coding error` and ADO says "Code Defect" or "Coding error". Otherwise, one sentence citing the evidence.

**area:** one of these:
- `FE`: UI, rendering, routing, analytics, accessibility, `web-ecare-*` services.
- `BE`: APIs, payloads, backend logic, `dal-*` services.
- `BE/FE`: both layers clearly changed.

**justification:** the DefectTracker's "Justification of missing defect". Write 3 to 4 sentences covering what the defect was, its root cause, why it was not caught earlier, and how it was resolved.

**otherAction:** concrete actions beyond the fix: a follow-up story or defect raised, a downstream defect, a duplicate, a rollback, a pen-test finding, or an escalation to another team. Use `""` when there were none.

**resolution:** one phrase following one of these patterns:
- `Code fix - <what changed>`
- `Design/Figma updated - <why>`
- `Downstream system fix - <team> to fix <what>`
- `Rollback applied - <what was restored>`
- `Test scenario updated - <what was corrected>`
- `Duplicate - resolved under <reference>`

**mitigation:** a preventive action that would stop this class of defect recurring, through tests, test data, monitoring or process. It must be distinct from the resolution.

**bucket:** exactly one of these:
- `Valid Miss`: a genuine implementation error that testing should have caught. The default for Coding error.
- `Reuirement Unclarity`: the requirement or design was unclear or incomplete. The default for Requirement gap and Design gap. **Keep this exact spelling.**
- `Digital_External defect`: caused by an external package or shared library change.
- `Downstream system`: caused by a downstream team's system.
- `Environment Issue`: only reproducible in one environment, not a code defect.
- `Limited Test Data`: could not be caught because the needed test data did not exist.
- `Content Issue`: wrong copy, labels or text, with no logic error.
- `Configuration`: a configuration value was wrong.

**defectAnalysis:** the BSC Tracker's "Defect Analysis". Write 3 to 4 sentences in one paragraph: the symptom (journey, environment), the root cause (which service or component, and why), and how it was resolved (fix, deployment, retest).

**leakage:** the BSC Tracker's "Justification of defect leakage". Write 2 to 3 sentences on why the defect was not caught earlier and how it escaped to the stage where it was found. Use the environment, test phase, found-by, tags (Release Regression, ST Miss, Production) and what the comments reveal. If it was caught in SIT before release, say that it did not reach production, and explain why it got past development and team testing.

## Writing rules

- British English and plain sentences.
- No bullet points, and no line breaks inside a value.
- No en or em dashes. Use commas, semicolons or a plain hyphen.
- Do not quote ADO work item or epic numbers in the text. Say "a related work item" or "a duplicate defect" instead. PR, plan and bundle numbers are fine.
- Never include passwords, usernames, account numbers, phone numbers or email addresses.
- Ground every statement in the ticket. Where the ticket does not say something, say it is not recorded.

## Example (a real, finished analysis)

```json
{
  "id": "4753896", "rca": "Coding error", "rcaReason": "", "area": "BE",
  "justification": "During CCS 26.10 release regression in QCX, updating the spend manager limit for a PAYM MBB customer showed the Something went wrong screen, with the service-group-detail API returning a 500 error. The response reported a TIL service fault, but reproduction showed the limit itself was saved and the failure came from the eCare backend: when building the success product purchase notification for MBB plans the product price was null, causing an unhandled null pointer exception. The null price case for MBB plans was not covered before release, so the defect was first caught by release regression testing. A fix was deployed to the lower environment and the retest passed on a newly created PAYM MBB user.",
  "otherAction": "Raised in the Intensive Care public collab channel and investigated in an internal analysis session; suspected downstream TIL fault ruled out once the developer reproduced the error; retest performed on a fresh PAYM MBB user on plan 111563 with backend validations and logs attached as evidence",
  "resolution": "Code fix - null product price handled when creating the successProductPurchaseNotification for MBB plans in care-manageservice; deployed to lower environment and retest passed",
  "mitigation": "Add unit tests for a null product price when building purchase notifications, and add a PAYM MBB spend manager update to the team regression pack so the segment is exercised before release regression; report eCare backend exceptions under their own error code rather than TIL_SERVICE_FAULT, which pointed the initial analysis at the downstream TIL services",
  "bucket": "Valid Miss",
  "defectAnalysis": "During CCS 26.10 release regression in QCX, updating the spend manager limit for a PAYM MBB customer showed the Something went wrong screen, with the service-group-detail API returning a 500 error. The response reported a TIL service fault, but reproduction showed the limit itself was saved and the failure came from the eCare backend: when building the success product purchase notification for MBB plans the product price was null, causing an unhandled null pointer exception. A fix was deployed to the lower environment and the retest passed on a newly created PAYM MBB user on plan 111563.",
  "leakage": "Caught in SIT release regression before the release, so it did not reach production (the ticket records ST Miss = No). It got past development testing because the null price only arises for PAYM MBB plans when the purchase notification is built, a combination that was not exercised before release regression. The TIL_SERVICE_FAULT error code in the response pointed the first analysis at the downstream TIL services, which slowed diagnosis until the developer reproduced the error."
}
```
