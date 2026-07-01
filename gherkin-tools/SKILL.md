---
name: gherkin-tools
description: 'Run the automation-agent pipeline tools (analyze repo, fetch story, generate tests, coverage, deploy) directly from Claude Code without any MCP configuration. Invoke with a mode keyword or no argument for guided mode.'
argument-hint: 'Optional: "analyze" | "story <url>" | "generate" | "scenarios" | "coverage" | "contracts" | "deploy" | "status"'
user-invocable: true
---

# gherkin-tools Skill (`/gherkin-tools`)

Runs `automation-agent` CLI commands inline, streaming output back into the conversation.
No MCP server, no terminal pop-up - just results.

---

## Step 1 - Locate the agent binary

Look for the agent in this priority order:

1. `services/agent/dist/index.js` relative to the repo root (working directory).
   If found: run as `node <absolute-path-to>/services/agent/dist/index.js <command> [flags]`
2. `node_modules/.bin/automation-agent` in the working directory.
   If found: run as `node_modules/.bin/automation-agent <command> [flags]`
3. Fall back to: `npx automation-agent <command> [flags]`

Store the resolved invocation prefix. All commands below substitute `<agent>` with it.

If the dist folder is absent at path 1, check whether `services/agent/` exists but is unbuilt.
If so, pause and tell the user: "The agent is not built yet. Run `cd services/agent && npm run build` first, then retry."

---

## Step 2 - Detect mode from argument

| Argument starts with | Mode |
|----------------------|------|
| `analyze` or `baseline` | **analyze** |
| `story` | **story** (rest of arg = URL) |
| `generate` | **generate** |
| `scenarios` | **scenarios** |
| `coverage` | **coverage** |
| `contracts` | **contracts** |
| `deploy` | **deploy** |
| `status` | **status** |
| _(none)_ or unrecognized | **guided** |

---

## Mode: analyze

Scan the workspace repo for framework, language, composition pattern, and folder layout.

Resolve `repoPath`: use the current working directory (repo root).

Run:
```
<agent> analyze-repo --repoPath <repoPath>
```

---

## Mode: story

Fetch and enrich an ADO story graph with acceptance criteria and optional Figma flows.

Extract the ADO story URL from the argument (everything after `story `).
If no URL is present, ask the user: "Which ADO story URL should I fetch?"

Run:
```
<agent> get-story-context --azureStoryUrl "<url>"
```

If `FIGMA_TOKEN` is set and the user mentioned Figma URLs, append:
`--figmaFileOrFlowUrls "<url1>" "<url2>"`

---

## Mode: generate

Full pipeline: fetch story, analyze repo, compose BDD/E2E scenarios, generate step definitions.

Collect:
- `storyUrl`: look in the argument or conversation history for an ADO URL. If not found, ask.
- `repoPath`: the current working directory, or ask if the user specified a different target repo.

Run:
```
<agent> generate-tests --azureStoryUrl "<storyUrl>" --repoPath "<repoPath>"
```

---

## Mode: scenarios

Compose BDD/E2E scenarios from a story without generating step-definition code.

Collect `storyUrl` same as **generate** mode.

Run:
```
<agent> generate-scenarios --azureStoryUrl "<storyUrl>"
```

---

## Mode: coverage

Coverage analysis: service unit tests, BDD scenarios, and Postman collections vs declared API surface.

Resolve `repoPath` from the current working directory.

Run:
```
<agent> get-coverage-report --repoPath "<repoPath>"
```

---

## Mode: contracts

Extract the static API surface (declared endpoints, payloads, cross-reference) from a repo.

Resolve `repoPath` from the current working directory.

Run:
```
<agent> get-api-contracts --repoPath "<repoPath>"
```

---

## Mode: deploy

Copy generated artifacts into the target test repository.

Resolve `repoPath` from the current working directory.

Run:
```
<agent> deploy-tests --repoPath "<repoPath>"
```

---

## Mode: status

Show the last-run status and manifest.

Run:
```
<agent> show-status
```

---

## Mode: guided

No argument supplied. Ask the user one question:

"What would you like to do?
- **analyze** - scan a repo for its test framework and structure
- **story <url>** - fetch an ADO story with acceptance criteria
- **generate** - run the full pipeline (story + scenarios + step definitions)
- **scenarios** - compose BDD scenarios only
- **coverage** - run a coverage report
- **contracts** - extract API contracts
- **deploy** - deploy generated artifacts to the target repo
- **status** - show last-run status"

Then re-enter the appropriate mode with their answer.

---

## Step 3 - Execute and report

Run the resolved command using Bash (PowerShell on Windows). Stream stdout to the conversation as it arrives.

After the process completes:
- If exit code 0: summarize what was produced (artifact paths printed in stdout, key counts, etc.)
- If non-zero: show the last 20 lines of output and the exit code; do not retry automatically.

Generated artifacts land in `artifacts/` relative to `repoPath`. Point the user there.

---

## Rules

- Never mention MCP, mcpServer, or any MCP-related terminology in responses.
- Never auto-chain modes (e.g. do not auto-run `deploy` after `generate`). Stop and report; let the user decide what to do next.
- If `AZURE_DEVOPS_PAT` is missing and the command needs it, tell the user to set it: `$env:AZURE_DEVOPS_PAT = "your-pat"` (PowerShell) or `export AZURE_DEVOPS_PAT=your-pat` (bash).
- The agent uses Claude Code's existing login for LLM calls automatically. If Claude Code is not logged in, the agent falls back to `GITHUB_TOKEN`, `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY`, or `AI_API_KEY` + `AI_API_BASE_URL`. No `ANTHROPIC_API_KEY` is needed.
- Terse output: report artifact paths and counts, not narration.
