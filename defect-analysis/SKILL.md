---
name: defect-analysis
description: 'eCare defect analysis in two modes. ADO mode asks which output format is wanted (DefectTracker 21 columns, BSC Tracker 13 columns, or both), then for a list of bug IDs; it fetches each bug from ADO (fields, history, comments), verifies the RCA, writes the analysis and returns copy-ready Excel rows, CSV files and the RCA changes vs ADO, with an optional gap analysis. Excel mode asks for DefectTracker (21-column) workbook(s) and bug IDs, derives the BSC Tracker rows from the existing DefectTracker data with no ADO calls, and adds a gap analysis with enhancement opportunities. Same formats and rules as the Defect Analyzer app.'
argument-hint: '"ado" | "excel" | "check" | "reset" | no-arg (asks which)'
user-invocable: true
---

# defect-analysis (`/defect-analysis`)

Produces the eCare defect analysis in the two sheet formats the team uses, plus a gap analysis.

| Format | Columns | Used for |
|---|---|---|
| **DefectTracker** | 21 (A to U) | eCare Defect Analysis Tracker |
| **BSC Tracker** | 12 | Defect leakage reporting |

This skill is part of the Defect Analyzer app (its `skills/defect-analysis` folder) and gives the same output. Everything that must be exact is done by `scripts/defect_tool.py`: fetching, column mapping, validation, the Excel paste rules, CSV files and the gap facts. It is a Python port of the app's `src/core`, and the app's test suite (`test/skill-parity.test.ts`) requires both to produce identical files. You write only the narrative, following the files in `references/`.

The skill needs Python 3 with openpyxl. It does **not** need Node, the app or the app's MCP server. The MCP server offers the same steps as tools for anyone who prefers it (see the app's README), but this skill never calls it.

## Modes

| Argument | Mode |
|---|---|
| `ado` | **ADO mode:** the user picks the output format, then supplies bug IDs. Bugs are fetched from ADO and analysed. The gap analysis is optional. |
| `excel` | **Excel mode:** the user supplies DefectTracker workbook(s) and bug IDs. BSC Tracker rows are derived from the DefectTracker with no ADO calls, plus the gap analysis and enhancement opportunities. |
| no argument | Ask which mode (Step 1). |
| `check` | Check the config, Python and openpyxl, the PAT (one ADO call) and the output folder. Nothing is written. |
| `reset` | Delete `config.json` and ask the config questions again. |

## Files

- `scripts/defect_tool.py`: deterministic helpers. Run `python "<skill-dir>/scripts/defect_tool.py" --help` to see them.
- `references/analysis-rules.md`: per-bug analysis rules (ADO mode).
- `references/bsc-derivation-rules.md`: how BSC rows are derived from DefectTracker rows (Excel mode).
- `references/gap-rules.md`: gap analysis and enhancement opportunity rules (both modes).

`<skill-dir>` is this skill's base directory, as given when the skill is launched: the folder that holds this `SKILL.md`.

## Running in GitHub Copilot

The same skill runs in VS Code Copilot Chat (agent mode), which reads personal skills from `~/.claude/skills`. Where these steps name a Claude Code tool, use the nearest equivalent:

- **AskUserQuestion:** ask the question in chat, listing the options, and wait for the answer.
- **Agent tool (subagents):** use `runSubagent` if it is available; otherwise do the batches yourself, one after another.
- **Commands:** run them in the terminal. On Windows that is PowerShell, so quote paths that contain spaces.

## On macOS

The skill works the same on a Mac, with these differences:

- Run `python3` wherever these steps say `python`. macOS has no `python` command.
- The default output folder is `~/Documents/defect-analysis`.
- The PAT is kept in the macOS Keychain, not a Windows user variable. See Step 0.5.
- `copy` uses the Mac clipboard (`pbcopy`).

---

## Step 0 - Config

The config lives in `<skill-dir>/config.json`:

```json
{
  "poc": "Zoltan",
  "ado_org": "vfuk-digital",
  "ado_project": "Digital",
  "output_dir": "%USERPROFILE%\\Documents\\defect-analysis",
  "last_tracker_files": []
}
```

- **Config missing, or mode is `reset`:** ask for the POC name (DefectTracker column H) and confirm the defaults for organisation, project and output folder. Then write the file. On macOS, write the output folder as `~/Documents/defect-analysis`, expanded to the full path.
- **Old config (it has `poc_names`, `pi_values` or `excel_path`):** migrate it silently. Take `poc` from the first entry of `poc_names`, keep `ado_org` and `ado_project`, add `output_dir`, and drop the rest.
- **The PAT is never written to `config.json`.**

Each run works in its own folder, `<output_dir>/<YYYY-MM-DD_HHmm>-<mode>`. Create it, and put every intermediate and output file there.

## Step 0.5 - ADO PAT (ADO mode only)

`defect_tool.py fetch` finds the PAT itself. It looks in the `AZURE_DEVOPS_PAT` environment variable, then (on Windows) the same variable in the Windows user environment (the registry), then a `.env` file in the current folder.

If the fetch reports that no PAT was found, ask the user for one. It needs Work Items Read, and Write only if they later want RCA patches. Offer to store it permanently:

- **Windows,** as a user variable:

  ```
  [Environment]::SetEnvironmentVariable('AZURE_DEVOPS_PAT', '<token>', 'User')
  ```

- **macOS,** in the Keychain. Ask the user to run these in Terminal themselves, so the token never passes through the chat. The first command prompts for the token. The second makes new terminals, VS Code and Claude Code pick it up; it holds no token itself.

  ```
  security add-generic-password -a "$USER" -s AZURE_DEVOPS_PAT -w
  echo 'export AZURE_DEVOPS_PAT="$(security find-generic-password -a "$USER" -s AZURE_DEVOPS_PAT -w 2>/dev/null)"' >> ~/.zshrc
  ```

  Then restart VS Code or Claude Code.

Never echo the PAT, never write it to any file, and never read it back out of a conversation transcript.

## Step 1 - Pick the mode (no argument only)

Ask with AskUserQuestion:

> What do you want to do?
> - **Analyse bugs from ADO:** fetch the bugs and write the DefectTracker and/or BSC Tracker rows.
> - **Build the BSC Tracker from a DefectTracker workbook:** no ADO; includes the gap analysis and enhancement opportunities.

---

## Mode A - ADO analysis

### A1. Ask the output format and the gap analysis

Ask both in one AskUserQuestion call:

1. **Which output format do you want?**
   - *Both* (Recommended): DefectTracker (21 columns) and BSC Tracker (13 columns).
   - *DefectTracker*: 21 columns, A to U.
   - *BSC Tracker*: 13 columns.
2. **Also run the gap analysis?** This finds process, testing and coverage gaps and proposes enhancement opportunities.
   - *Yes*
   - *No*

### A2. Ask for the bug IDs

Ask in chat, then stop and wait:

> Paste the bug IDs: one per line, or separated by spaces or commas. ADO links or a column copied from Excel also work.

Every 6 to 8 digit number counts once. Repeat the parsed count back to the user ("33 bugs, 1 duplicate ignored"). The gap analysis needs at least 2 bugs; if there is only 1, say so and skip it.

### A3. Fetch

```
python "<skill-dir>/scripts/defect_tool.py" fetch --ids "<ids>" --org <ado_org> --project <ado_project> --out "<run>/bugs.json"
```

Report any bug that failed to fetch (not found, PAT rejected) and carry on with the rest. If **every** fetch failed with "PAT rejected", go back to Step 0.5.

### A4. Analyse

Follow `references/analysis-rules.md` exactly.

- **Up to 8 bugs:**
  1. For each bug, run `defect_tool.py show --data "<run>/bugs.json" --id <ID>` and read the whole output, comments included.
  2. Write `"<run>/analyses-1.json"`.
- **More than 8 bugs:** split them into batches of up to 8.
  - If the Agent tool is available, start one subagent per batch, in parallel, with this prompt:

    > Analyse ADO bugs for the eCare defect tracker. Read `<skill-dir>/references/analysis-rules.md` and follow it exactly. For each of these IDs: `<ids>`, run `python "<skill-dir>/scripts/defect_tool.py" show --data "<run>/bugs.json" --id <ID>` and read everything. Write `{"tickets":[...]}` with one entry per ID to `<run>/analyses-<n>.json`. Do not call ADO or any network service. Reply only with the IDs written and any ticket whose rca differs from ADO's (counting "Code Defect" as "Coding error"), with its one-line reason.

  - Otherwise, do the batches one after another yourself.
- Review any RCA that differs from ADO before building. You are accountable for it.

### A5. Build the rows

```
python "<skill-dir>/scripts/defect_tool.py" build --mode ado --format <tracker|bsc|both> --data "<run>/bugs.json" --analyses "<run>/analyses-1.json" [...] --poc "<poc>" --outdir "<run>"
```

The script validates every analysis and reports `PROBLEM` lines for anything that is missing or uses a value outside the allowed lists. Fix those analyses and build again, until there are no problems or the remaining ones are explained.

The run writes:
- `defecttracker-21-columns.tsv` and `.csv`
- `bsc-tracker-13-columns.tsv` and `.csv`
- `rca-changes.tsv`

Then present the results as described in [Presenting results](#presenting-results).

### A6. Gap analysis (if chosen)

```
python "<skill-dir>/scripts/defect_tool.py" gap-input --mode ado --data "<run>/bugs.json" --analyses "<run>/analyses-*.json" --out "<run>/gap-input.json"
```

1. Read `gap-input.json` and follow `references/gap-rules.md`.
2. Write `"<run>/gaps.json"`.
3. Run:

   ```
   python "<skill-dir>/scripts/defect_tool.py" gap-report --input "<run>/gap-input.json" --report "<run>/gaps.json" --outdir "<run>"
   ```

4. If it prints `NOTE` lines about a gap with no action or a dropped gap, fix `gaps.json` and run it again.

### A7. ADO RCA patch (optional, never automatic)

ADO is **not** modified by default.

1. If there are rows marked **Changed** in the RCA changes, ask whether the user wants those written back to ADO's `VFDigitalAgile.RootCauseAnalysis` field. List them first. Never include *Wording only* rows.
2. Only after an explicit yes, patch each one:

   ```
   PATCH https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}?api-version=7.1
   Content-Type: application/json-patch+json
   [{"op": "add", "path": "/fields/VFDigitalAgile.RootCauseAnalysis", "value": "<new>"}]
   ```

3. Add an audit comment to each: `RCA updated as part of Defect Analysis Tracker review: '<old>' -> '<new>'.`
4. Report the result for each ticket.

---

## Mode B - BSC Tracker from DefectTracker workbook(s)

Only the **21-column DefectTracker** is accepted as input. The output is the **BSC Tracker (13 columns)**, derived entirely from the DefectTracker data, plus the gap analysis and enhancement opportunities. **No ADO calls are made, and no PAT is needed.**

### B1. Ask for the workbook(s)

Ask in chat and wait. If `last_tracker_files` is set, offer those as the default:

> Which DefectTracker workbook(s) should I read? Give the full path of each `.xlsx`, one per line. A sheet name is optional; I pick the sheet with the 21-column header otherwise.

Check that every path exists, then save the paths to `last_tracker_files`. Copy a workbook from SharePoint or OneDrive to a local path first if needed. **The workbooks are only read, never written.**

### B2. Ask for the bug IDs

Ask in chat and wait:

> Which bug IDs should I take from the DefectTracker? Paste them (one per line, or separated by spaces or commas), or type `all` for every row.

### B3. Read the DefectTracker

```
python "<skill-dir>/scripts/defect_tool.py" read-tracker --file "<path1>" [--file "<path2>"] [--sheet "<name>"] --ids "<ids or all>" --out "<run>/tracker.json"
```

The reader finds the header row and maps columns by name, so column order does not matter. It then checks the layout:

- **`REJECTED ... not the 21-column DefectTracker`:** the workbook or sheet is an older or different layout. Tell the user which file it was and which columns are missing, and do not continue with it. Ask whether there is another sheet or file.
- **`not found`:** those IDs are not in the workbook(s). List them.
- **Duplicates across files or sheets:** the most complete row is kept. Mention which IDs were affected.

### B4. Derive the two narrative columns

Follow `references/bsc-derivation-rules.md`.

- Read each row with `defect_tool.py show --data "<run>/tracker.json" --id <ID>`.
- Write `"<run>/derived-<n>.json"`, using the same batching and subagent approach as A4, but with the BSC derivation rules and the `show` command against `tracker.json`.
- Use **only** what the DefectTracker row says.

### B5. Build the BSC rows

```
python "<skill-dir>/scripts/defect_tool.py" build --mode excel --format bsc --data "<run>/tracker.json" --analyses "<run>/derived-1.json" [...] --outdir "<run>"
```

The run writes `bsc-tracker-13-columns.tsv` and `.csv`. Tell the user, once, that Title, Assigned To, State and Tags are `-` because the DefectTracker does not hold them, unless the workbook had those columns. Also tell them that Iteration Path is the sprint the bug was raised in.

### B6. Gap analysis and enhancement opportunities (always in this mode)

```
python "<skill-dir>/scripts/defect_tool.py" gap-input --mode excel --data "<run>/tracker.json" --analyses "<run>/derived-*.json" --out "<run>/gap-input.json"
```

Then follow the same steps as A6 (`gaps.json`, then `gap-report`). Excel mode has fewer facts than ADO mode (no ST Miss, no time to close), but adds the Sub-RCA, PI and owning-team splits. A DefectTracker with many rows, for example a whole PI, gives the strongest patterns.

---

## Presenting results

- Show each output in its own fenced block, **exactly as the `.tsv` file contains it**. Do not reformat, re-wrap or retype it, because the user pastes it straight into Excel. Read the file and paste its content.
- Above each block, say where it goes: "Paste under the header row of the DefectTracker" or "... of the BSC Tracker".
- Show the RCA changes (ADO mode) as a table with ID, ADO says, Verified, Change and Why. Also give the path of `rca-changes.tsv` for copying.
- For the gap analysis, show:
  - the summary;
  - the facts;
  - the gaps grouped as Process, Testing and Coverage, each with its evidence bug IDs;
  - the enhancement opportunities (improvement actions) as a table with Ref, Priority, Action, Addresses, Owner, Effort and Success measure.
- Offer one-step copying: "Say *copy defecttracker*, *copy bsc*, *copy rca* or *copy report* and I'll put it on your clipboard." Then run `defect_tool.py copy --file "<run>/<file>"`.
- Always list the run folder and its CSV files: `defecttracker-21-columns.csv`, `bsc-tracker-13-columns.csv` and `gap-analysis.csv`. The CSVs have a header row and open correctly in Excel.

### How the formats behave in Excel

- Empty cells are `-`, because Excel's paste drops empty columns and shifts the rest.
- In the pasted DefectTracker rows, iteration numbers such as `42.5` carry a leading `'`, so Excel keeps them as text rather than turning them into dates. Excel removes the apostrophe on paste. In the CSVs they are written as `="42.5"` instead.
- **DefectTracker (ADO mode):**
  - PI, Iteration Path and Area Path are the values the bug was **raised** with, from the ADO history. Corrected Area Path is the current one.
  - Bug RCA Actual is ADO's value, and Bug RCA Updated is the verified one.
  - BDD Added and Shared with team are `-`, for the team to fill in.
- **BSC Tracker (ADO mode):** the first 10 columns are ADO's current values, verbatim.

## Check mode

1. Load the config, or report that it is missing.
2. Run `python --version`, and `python -c "import openpyxl"` (`python3` on macOS).
3. Run `defect_tool.py fetch --ids <one known ID> --out <temp>`. This confirms the PAT works without printing it.
4. Confirm `output_dir` is writable.
5. Report pass or fail for each. Write nothing else.

## Rules

- **No fabrication.** Every statement comes from the ticket (ADO mode) or the DefectTracker row (Excel mode). If something is not recorded, say so.
- **Exact vocabularies.** Use the RCA, Area, Bucket, gap category, priority and effort values listed in the references, including the tracker's own spelling "Reuirement Unclarity".
- **No en or em dashes** in anything you write, and no line breaks inside a value.
- **Credentials.** Never repeat passwords, usernames, account numbers, phone numbers or email addresses, even if a ticket or row contains them. Never print or store the PAT.
- **Read-only by default.** Excel workbooks are never modified. ADO is only modified in A7, after an explicit yes.
- **Scripts do the exact parts.** Never hand-assemble TSV or CSV rows. Always build them with `defect_tool.py build`, and the gap outputs with `gap-report`.
