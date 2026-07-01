# gherkin-tools

Claude Code skill for the automation-agent pipeline. Gives `/gherkin-tools` access to all pipeline
stages without registering an MCP server.

## Usage

```
/gherkin-tools                     # guided mode - prompts for what you want
/gherkin-tools analyze             # Stage 0: scan repo baseline
/gherkin-tools story <ado-url>     # fetch ADO story with AC + Figma
/gherkin-tools generate            # full pipeline: story + scenarios + step definitions
/gherkin-tools scenarios           # BDD scenario composition only
/gherkin-tools coverage            # coverage report (svc + BDD + Postman)
/gherkin-tools contracts           # extract API surface
/gherkin-tools deploy              # copy artifacts to target repo
/gherkin-tools status              # last-run summary
```

## Requirements

- `services/agent/dist/index.js` must exist (run `npm run build` in `services/agent/`)
- `AZURE_DEVOPS_PAT` env var set for ADO story access
- LLM for pipeline stages: automatically uses your Claude Code login if you are logged in.
  Fallback options: `GITHUB_TOKEN` (GitHub Models), `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY`, or `AI_API_KEY` + `AI_API_BASE_URL`
- `FIGMA_TOKEN` env var set for Figma flows (optional)

## Install

Via the installer at `localhost:7788` (Skills section), or copy/symlink this directory to
`~/.claude/skills/gherkin-tools/`.
