# automation-agent-standalone

Standalone BDD test generation skill for Claude Code and GitHub Copilot. Embeds the full automation-agent pipeline as AI instructions - no external CLI, no npm package, no project codebase required.

---

## What it does

| Mode | Command | What happens |
|---|---|---|
| `story` | `/automation-agent-standalone story <ado-url>` | Fetches an ADO work item graph and extracts acceptance criteria |
| `analyze` | `/automation-agent-standalone analyze` | Scans the current repo: framework, language, step catalog |
| `plan` | `/automation-agent-standalone plan` | Groups ACs into end-to-end customer journeys |
| `generate` | `/automation-agent-standalone generate <ado-url>` | Full pipeline: story -> plan -> BDD features -> step defs |
| `bdd` | `/automation-agent-standalone bdd` | BDD feature files only (paste requirements or provide story URL) |
| `steps` | `/automation-agent-standalone steps` | Step definitions for existing `.feature` files |
| `unit` | `/automation-agent-standalone unit` | TDD unit tests (Rule 14) from OpenAPI/LLD/Figma/ACs - red-first + spec-only when the module is absent; code-grounded on the real interface when it already exists |
| `visual` | `/automation-agent-standalone visual` | Spec-only Figma-driven visual-regression specs (Rule 15) - no app code |
| `coverage` | `/automation-agent-standalone coverage` | API endpoint coverage analysis |
| `log` | `/automation-agent-standalone log` | Work log + time-savings estimate for a run |
| `copilot` | `/automation-agent-standalone copilot` | Install Copilot instructions into this project |

---

## Prerequisites

- **Claude Code** (for skill-based use): any version
- **Node.js**: not required (no npm package is invoked)
- **Azure DevOps PAT**: required for `story` and `generate` modes

No `automation-agent` npm package installation is needed. Claude executes the pipeline using its own capabilities following the embedded rules.

---

## Installing the Claude Code skill

**Option A - symlink (recommended):**
```powershell
New-Item -ItemType SymbolicLink `
  -Path "$env:USERPROFILE\.claude\skills\automation-agent-standalone" `
  -Target (Resolve-Path .)
```

**Option B - copy:**
```powershell
Copy-Item -Recurse -Force . "$env:USERPROFILE\.claude\skills\automation-agent-standalone"
```

**Option C - from the gherkin-sandbox installer:**
Open the installer at `http://localhost:7788` and install "automation-agent-standalone" from the Skills tab.

After installing: restart Claude Code (or start a new conversation). The skill appears as `/automation-agent-standalone` in the skill list.

---

## Setting environment variables

```powershell
$env:AZURE_DEVOPS_PAT = "your-pat-token"
```

Or add to your shell profile (`$PROFILE`) for persistence.

LLM provider: Claude Code uses its existing session by default. No `ANTHROPIC_API_KEY` needed.

---

## Usage examples

**Fetch a story and see its ACs:**
```
/automation-agent-standalone story https://dev.azure.com/MyOrg/MyProject/_workitems/edit/12345
```

**Analyze the current test repo:**
```
/automation-agent-standalone analyze
```

**Generate BDD features + step defs from a story:**
```
/automation-agent-standalone generate https://dev.azure.com/MyOrg/MyProject/_workitems/edit/12345
```

**Generate BDD features only (no step defs), for frontend scenarios only:**
```
/automation-agent-standalone bdd
```
Then paste your requirements when prompted, and mention `testLayer=frontend` in your message.

**Generate step defs for an existing feature file:**
```
/automation-agent-standalone steps
```
Then provide the path to your `.feature` file when prompted.

**Generate TDD unit tests (red-first + spec-only when the module is absent; code-grounded on the real interface when it exists):**
```
/automation-agent-standalone unit
```
Then provide an OpenAPI spec, LLD doc(s), Figma file(s), or a story URL. Add `--unit-layer backend` (or `frontend`) to scope, `--no-llm` for deterministic skeletons.

**Generate Figma-driven visual-regression specs:**
```
/automation-agent-standalone visual
```
Then provide the Figma file/folder path(s). One Playwright `toHaveScreenshot` per declared Figma state.

**Full pipeline including the TDD inner loop:**
```
/automation-agent-standalone generate <ado-url> --tdd --visual-tests
```
Runs story -> plan -> BDD -> step defs, then adds spec-only unit tests (Rule 14) and visual-regression specs (Rule 15) from the same specs.

**Check API coverage:**
```
/automation-agent-standalone coverage
```

---

## Installing Copilot instructions

To get the same generation rules working as GitHub Copilot always-on context:

**Via the skill:**
```
/automation-agent-standalone copilot
```

**Manually:**
```powershell
New-Item -ItemType Directory -Force .github
Copy-Item copilot-instructions-template.md .github/copilot-instructions.md
```

The installed file encodes the same BDD composition rules, step parameterization rules, journey planning prompts, and quality gates as the skill - so Copilot Chat follows them automatically without needing the skill invoked.

---

## Configuration

No config file required. On first `generate` or `bdd` run, Claude will ask for:
- **Team tag** - your team's mandatory scenario tag (e.g. `MyTeam_BDD`). Defaults to `AutomationTeam_Test` if not specified.
- **Story number** - the `@US_<n>` number (extracted automatically from ADO when using `story` mode)

---

## Output structure

All generated artifacts land in an `artifacts/` folder relative to the working directory:

```
artifacts/
  US12345_journeys.md               # Journey map (human-readable)
  US12345_journeys.json             # Journey map (machine-readable)
  US12345_acceptance-criteria-map.md
  journeys/
    US12345_checkout-flow.feature   # One feature file per journey
    US12345_address-entry.feature
    _US12345_unmapped.feature       # Cross-cutting ACs
  step-defs/
    bdd/
      checkoutStepDefs.ts           # Generated step definitions
      addressStepDefs.ts
  unit-tests/                       # Spec-only TDD unit tests (Rule 14; unit / --tdd)
    backend/server/engine/validator.test.js
    frontend/client/src/pages/Login.test.jsx
    <slug>-unit-tests.md            # Traceability (import path, ACs covered, red vs green)
  visual-tests/                     # Figma-driven visual specs (Rule 15; visual / --visual-tests)
    login.visual.spec.ts            # One toHaveScreenshot per Figma state
    <slug>-visual-tests.md
  <repo>-baseline.json              # Stage 0 repo analysis (cached)
  <repo>-step-database.md           # Step catalog (human-readable)
  <repo>-orphan-resolution.md       # Orphans reconciled vs source: scan-gap / renamed / dead
  US12345-work-log-<run-id>.md      # Per-run work log (human), unique per run
  work-log/
    <run-id>_US12345.csv            # PowerBI-consumable (one row per stage)
    <run-id>_US12345.json           # PowerBI / programmatic
```

Every run also writes a **work log** (`--no-work-log` to skip): the operator (name / experience
/ area), what each stage achieved, the tool's wall-clock time, and an estimated engineer-time
equivalent (junior/medior/senior), complexity-weighted per artifact and by repo size/stack.
Emitted as a human `.md` plus PowerBI-consumable `.csv` + `.json` in a central `work-log/` folder
(PowerBI: Get Data -> Folder -> Combine). Uniquely named per run so logs accumulate. Operator
identity is asked once and saved to `~/.claude/bdd-authoring-operator.json`
(`--operator-name`/`--experience`/`--area` override). A planning estimate, not a controlled
benchmark.

---

## Differences from the gherkin-tools skill

| | `gherkin-tools` | `automation-agent-standalone` |
|---|---|---|
| Requires local codebase | Yes (looks for `services/agent/dist/`) | No |
| Requires npm package | Falls back to `npx automation-agent` | No - Claude executes the logic directly |
| Generation method | Spawns CLI subprocess | Claude follows embedded instructions |
| Copilot compatible | No | Yes (`copilot-instructions-template.md`) |
| Portable to other teams | Limited | Yes |

---

## Files in this skill

| File | Purpose |
|---|---|
| `SKILL.md` | Claude Code skill - all pipeline logic as AI instructions |
| `copilot-instructions-template.md` | Install to `.github/copilot-instructions.md` for Copilot compatibility |
| `README.md` | This file |
