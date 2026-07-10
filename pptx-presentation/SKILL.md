---
name: pptx-presentation
description: 'Generate a dark-themed PPTX walkthrough deck for the current codebase - auto-discovers features, uses screenshots or code samples as visual content'
argument-hint: '"generate" | "build" | "capture"'
user-invocable: true
---

# pptx-presentation (`/pptx-presentation`)

Generates a dark-themed 16:9 PPTX walkthrough deck for the project open in the current working directory. Uses `presentation/build-pptx.py` as the rendering engine (python-pptx). All codebase analysis and config generation is done by Claude; the Python script handles only rendering.

---

## Mode Dispatch

Inspect the argument passed to this skill:

| Argument | Mode |
|---|---|
| `generate` or no argument | [generate mode](#mode-generate) - full pipeline: analyze codebase, build config, render |
| `build` | [build mode](#mode-build) - skip analysis, re-render from existing config |
| `capture` | [capture mode](#mode-capture) - refresh screenshots via Playwright (agent WebUI only) |

---

## Mode: generate {#mode-generate}

Full pipeline. Run this when invoked without an argument or with `generate`.

### Phase 1 - Ensure the rendering script is available

1. Check if `presentation/build-pptx.py` exists in CWD.
2. If absent, copy `~/.claude/skills/pptx-presentation/build-pptx.py` into `presentation/` (create the directory if needed).
3. Check `python-pptx` is installed: run `pip show python-pptx`. If not found, run `pip install python-pptx`.

### Phase 2 - Project discovery

Gather all available metadata about the current project:

1. **CODEBASE_INDEX.md** - if present, read it fully. It is the primary source for module names, roles, and key exports. Map each top-level section to a candidate slide.
2. **README.md** (or `README.rst`, `docs/README.md`) - read for project name, tagline, and high-level capability description.
3. **Project manifest** - read whichever is present: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `*.csproj`. Extract: project name, version, description, key dependencies.
4. **Top-level directory structure** - list source directories. Map major dirs to logical modules (e.g., `src/`, `services/`, `lib/`, `api/`, `ui/`, `cli/`).
5. **Git log** - run `git log --oneline -20` to identify recent additions. Use them for a "What's New" slide if there are 4+ distinct recent features.

Determine: project name, one-line tagline, project type (web app / CLI / library / API service / agent / full-stack), and 6-12 major features or modules to become individual content slides.

### Phase 3 - Feature mapping

For each major feature or module identified in Phase 2:

1. Read 1-3 key source files (entry point, main service class, or controller). Focus on function signatures, exported symbols, and class definitions - not full implementation bodies.
2. Extract:
   - **What it does** (2-4 bullets describing the UI or behaviour the user sees / experiences)
   - **Inputs** (what the user/caller provides)
   - **Outputs / Actions** (what it produces or changes)
   - **Tab or section label** (short name for the badge, e.g. "Auth", "API", "CLI", "Config")
3. Pick a representative code sample: 3-5 lines of the most expressive code (function signature, key call, data structure). These go into the "What you see" bullets when no screenshot is available.

### Phase 4 - Screenshot detection

Check for screenshots in these locations (in priority order):
1. `presentation/screenshots/`
2. `screenshots/`
3. `docs/screenshots/`
4. `docs/images/`
5. `assets/`
6. `media/`

For each feature slide: if an image file exists whose name loosely matches the feature name (fuzzy match on kebab-case module name), assign it as `shot`. Otherwise set `shot` to `null` and include 3-5 code snippet lines in the `what` bullets, formatted as inline code: `` `functionName(param): ReturnType` ``.

### Phase 5 - Generate config.json

Write `presentation/pptx-config.json` with the following structure. All fields are required unless marked optional.

```json
{
  "project_name": "<detected project name>",
  "subtitle": "Complete Walkthrough",
  "tagline": "<one-line description of what the project does>",
  "feature_pills": ["<6 short feature labels, max 20 chars each>"],
  "footer_text": "<project name>  |  <very short tagline>",
  "output": "<ProjectName>-Walkthrough.pptx",
  "slides": [
    { "kind": "title" },
    {
      "kind": "overview",
      "columns": [
        { "heading": "<column 1 title>", "bullets": ["<bullet>", "<bullet>", "<bullet>"] },
        { "heading": "<column 2 title>", "bullets": ["<bullet>", "<bullet>", "<bullet>"] },
        { "heading": "<column 3 title>", "bullets": ["<bullet>", "<bullet>", "<bullet>"] },
        { "heading": "<column 4 title>", "bullets": ["<bullet>", "<bullet>", "<bullet>"] }
      ]
    },
    {
      "kind": "arch",
      "title": "Architecture",
      "flows": [
        { "label": "<module name>", "desc": "<2-3 line description>", "color": "accent" },
        { "label": "<module name>", "desc": "<2-3 line description>", "color": "accent2" },
        { "label": "<module name>", "desc": "<2-3 line description>", "color": "accent3" },
        { "label": "<module name>", "desc": "<2-3 line description>", "color": "accent4" }
      ],
      "inputs": ["<input type 1>", "<input type 2>", "<input type 3>"],
      "outputs": ["<output type 1>", "<output type 2>", "<output type 3>"],
      "description": "<optional one-paragraph description of the overall system>"
    },
    {
      "kind": "content",
      "title": "<feature title>",
      "shot": "<relative path from presentation/ dir, or null>",
      "what": ["<bullet 1>", "<bullet 2>", "<bullet 3>"],
      "inputs": ["<input 1>", "<input 2>"],
      "outputs": ["<output/action 1>", "<output/action 2>"],
      "tab": "<tab badge label>",
      "new_badge": false
    },
    {
      "kind": "summary",
      "title": "End-to-End Flow",
      "subtitle": "<short subtitle>",
      "steps": [
        { "label": "1. <Step>", "desc": "<2-3 line description>" },
        { "label": "2. <Step>", "desc": "<2-3 line description>" }
      ],
      "note": "<optional footer note>"
    }
  ]
}
```

**Color tokens for arch flows:** `"accent"` (purple), `"accent2"` (teal), `"accent3"` (amber), `"accent4"` (rose). Cycle through them for each flow box.

**Guidelines for good slide content:**
- Aim for 1 title + 1 overview + 1 arch + 6-12 content slides + 1 summary = 10-16 slides total
- Keep each bullet under 90 characters
- `what` bullets describe what the user sees or experiences - not just internal implementation
- `inputs` are things the user/caller provides explicitly
- `outputs` are produced artifacts, state changes, or UI responses
- When no screenshot is available, start the first 2-3 `what` bullets with backtick-wrapped code: `` `export function foo(x: Bar): Baz` ``
- `tab` badge is 1-3 words, max 15 chars
- Omit `whats-new` slide unless there are 4+ distinct recent git features worth highlighting; if included, add it as the last slide

### Phase 6 - Render

Run the build script:

```
python presentation/build-pptx.py --config presentation/pptx-config.json
```

Report the full path to the output `.pptx` file. If the script fails with a python-pptx error, surface the error message verbatim and stop - do not loop.

---

## Mode: build {#mode-build}

Skip codebase analysis. Re-run the renderer with the existing config:

1. Check `presentation/pptx-config.json` exists. If absent, tell the user to run `/pptx-presentation generate` first.
2. Run `python presentation/build-pptx.py --config presentation/pptx-config.json`.
3. Report the output path.

---

## Mode: capture {#mode-capture}

Refresh screenshots by running the Playwright capture script. This only works for the Automation Agent project where the WebUI server can be started.

Run: `node presentation/capture-screenshots.js`

If `presentation/capture-screenshots.js` is absent, copy it from `~/.claude/skills/pptx-presentation/capture-screenshots.js` first.

Note prerequisites: the agent WebUI repo must be present at `c:/newgit/copilot-ado-figma-gherkin-agent` and a valid `.agent-webui-token` file must exist there.

---

## Prerequisites

- Python 3.x with `python-pptx` (auto-installed if missing)
- For `capture` mode only: Node.js, Playwright, and the agent WebUI repo
