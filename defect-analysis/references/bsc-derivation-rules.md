# BSC Tracker derivation rules (Excel mode)

In Excel mode the BSC Tracker (13 columns) is built **only from the DefectTracker (21 columns)**, with no ADO calls. Eleven of the thirteen columns are copied or mapped mechanically by `defect_tool.py build --mode excel`. You write the other two.

## Column sources

| BSC column | Source | Notes |
|---|---|---|
| ID | Defect Id | |
| Work Item Type | `Bug` | Uses the workbook's own column if it has one. |
| Title | not in the DefectTracker, so `-` | Uses the workbook's own column if it has one. |
| Assigned To | not in the DefectTracker, so `-` | Uses the workbook's own column if it has one. |
| State | not in the DefectTracker, so `-` | Uses the workbook's own column if it has one. |
| Tags | not in the DefectTracker, so `-` | Uses the workbook's own column if it has one. |
| Area Path | Corrected Area Path, else Area Path | |
| Iteration Path | PI + Iteration Path, in the team's ADO form | For example `Digital\Digital X\PI 42\42.5`. This is the sprint the bug was **raised** in. |
| Root Cause Analysis | Bug RCA Updated, else Bug RCA Actual | |
| Environment | Environment | |
| Raised By | Raised By | |
| Defect Analysis | **you write it** | Rules below. |
| Justification of defect leakage | **you write it** | Rules below. |

Tell the user, once per run, that Title, Assigned To, State and Tags are `-` because the DefectTracker does not hold them. The exception is when the workbook had those columns.

## What to read per bug

Run `python scripts/defect_tool.py show --data <tracker.json> --id <ID>`. It prints that bug's DefectTracker row:
- PI, Date and Iteration Path;
- Area Path and Corrected Area Path;
- Environment and POC;
- both RCA columns and the Sub-RCA;
- Priority and Area (FE/BE);
- Justification, Other Action Taken, Resolution, Mitigation, Bucket and Raised By.

## Output: one object per bug

Write them to `derived-<n>.json` as `{"tickets": [ ... ]}`:

```json
{ "id": "4696354", "defectAnalysis": "...", "leakage": "..." }
```

**defectAnalysis:** write 3 to 4 sentences in one paragraph: the symptom, the root cause and how it was resolved. Take them from:
- **Justification of missing defect:** the symptom and cause.
- **Resolution of missing defect:** the fix.
- **Other Action Taken:** the escalations, rollbacks and related work.
- **Sub-RCA** and **Area (FE/BE):** the kind of fault and the layer.
- **Environment:** where it was found.

**leakage:** write 2 to 3 sentences on why the defect was not caught earlier and how it escaped to the environment it was found in. Take them from:
- the "why it was not caught" part of the justification;
- the Bucket (Valid Miss, Limited Test Data, Reuirement Unclarity and so on);
- the Environment, where production means it escaped and SIT or QC means it was caught before release;
- the Mitigation Action, which usually names the missing test or check;
- Area Path versus Corrected Area Path, because a difference means it was first raised against another team.

## Rules

- **Use only what the row says.** Do not add services, causes, dates or numbers that are not in the DefectTracker row. If the row does not say why it leaked, write what the bucket and environment support, and say the reason is not recorded.
- **Rephrase rather than copy.** Do not paste the justification verbatim into both columns. Defect Analysis describes what happened. Leakage explains why it got through.
- British English and plain sentences. No bullet points, no line breaks inside a value, and no en or em dashes.
- No ADO work item or epic numbers in the text, and no credentials, usernames, account numbers, phone numbers or email addresses.
