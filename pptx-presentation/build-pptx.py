"""
Build PPTX walkthrough deck - universal, data-driven.
Default (no args): produces the Automation Agent deck unchanged.
With --config slides.json: builds a project-specific deck from JSON data.
"""

import argparse
import json
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

# ── Paths ──────────────────────────────────────────────────────────────────────
HERE  = Path(__file__).parent
SHOTS = HERE / "screenshots"
OUT   = HERE / "Automation-Agent-Walkthrough.pptx"

# ── Default project metadata (used when no --config is passed) ─────────────────
_DEFAULT_PROJECT  = "Automation Agent"
_DEFAULT_SUBTITLE = "Complete Product Walkthrough"
_DEFAULT_TAGLINE  = "AI-Driven BDD & E2E Test Generation  |  Work Item Planning  |  Coverage Analysis  |  Sprint Board"
_DEFAULT_PILLS    = ["ADO + Figma Import", "Gherkin Generation", "Coverage Analysis",
                     "Sprint Board", "Website Analysis", "MCP IDE Integration"]
_DEFAULT_FOOTER   = "Automation Agent  |  AI-Driven BDD/E2E Test Generation Platform"

# ── Palette ────────────────────────────────────────────────────────────────────
BG       = RGBColor(0x1E, 0x1F, 0x2E)
PANEL_BG = RGBColor(0x2D, 0x2E, 0x42)
BORDER   = RGBColor(0x3D, 0x3F, 0x5C)
ACCENT   = RGBColor(0x7C, 0x6A, 0xF7)   # purple
ACCENT2  = RGBColor(0x4E, 0xC9, 0xB0)   # teal  (inputs)
ACCENT3  = RGBColor(0xF5, 0xA6, 0x23)   # amber (outputs)
ACCENT4  = RGBColor(0xE8, 0x6D, 0x7D)   # rose  (new/enhanced badge)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT    = RGBColor(0xCC, 0xCC, 0xDD)
DIM      = RGBColor(0x88, 0x88, 0xAA)

_COLOR_MAP = {
    'accent': ACCENT, 'accent2': ACCENT2, 'accent3': ACCENT3, 'accent4': ACCENT4,
    'white': WHITE, 'light': LIGHT, 'dim': DIM,
}

W = Inches(13.33)
H = Inches(7.5)

# ── Total slide count (updated by build()) ─────────────────────────────────────
TOTAL = 22

# ── Low-level helpers ──────────────────────────────────────────────────────────
def set_bg(slide):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = BG

def add_rect(slide, l, t, w, h, fill=None, line=None):
    s = slide.shapes.add_shape(1, l, t, w, h)
    s.line.fill.background()
    if fill:
        s.fill.solid(); s.fill.fore_color.rgb = fill
    else:
        s.fill.background()
    if line:
        s.line.color.rgb = line; s.line.width = Pt(1.5)
    return s

def add_text(slide, text, l, t, w, h,
             size=Pt(11), bold=False, colour=WHITE, align=PP_ALIGN.LEFT):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame; tf.word_wrap = True
    p  = tf.paragraphs[0]; p.alignment = align
    run = p.add_run(); run.text = text
    run.font.size = size; run.font.bold = bold; run.font.color.rgb = colour
    return tb

def add_picture(slide, img, l, t, w, h):
    p = Path(img)
    if p.exists():
        slide.shapes.add_picture(str(p), l, t, w, h)
    else:
        add_rect(slide, l, t, w, h, fill=PANEL_BG, line=BORDER)
        add_text(slide, f"[screenshot pending]\n{p.name}",
                 l + Inches(0.15), t + Inches(0.15), w - Inches(0.3), h - Inches(0.3),
                 size=Pt(10), colour=DIM, align=PP_ALIGN.CENTER)

def footer(slide, n, total, footer_text=None):
    if footer_text is None:
        footer_text = _DEFAULT_FOOTER
    add_rect(slide, 0, H - Inches(0.35), W, Inches(0.35), fill=PANEL_BG)
    add_text(slide, footer_text,
             Inches(0.2), H - Inches(0.32), Inches(9), Inches(0.3), size=Pt(8.5), colour=DIM)
    add_text(slide, f"{n} / {total}",
             W - Inches(1.1), H - Inches(0.32), Inches(0.9), Inches(0.3),
             size=Pt(8.5), colour=DIM, align=PP_ALIGN.RIGHT)

# ── Content slide: screenshot left, description right ─────────────────────────
RIGHT_X = Inches(7.55)
PANEL_W = W - RIGHT_X

def content_slide(prs, n, total, title, shot_file, what, inputs, outputs,
                  tab="", new_badge=False, footer_text=None):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(s)

    # right panel
    add_rect(s, RIGHT_X - Inches(0.08), 0, PANEL_W + Inches(0.08), H, fill=PANEL_BG)

    # screenshot - resolve absolute path when shot_file contains separators or is absolute
    IMG_L = Inches(0.15); IMG_T = Inches(0.48)
    IMG_W = RIGHT_X - IMG_L - Inches(0.22); IMG_H = H - IMG_T - Inches(0.48)
    add_rect(s, IMG_L - Inches(0.04), IMG_T - Inches(0.04),
             IMG_W + Inches(0.08), IMG_H + Inches(0.08), line=BORDER)
    if shot_file:
        img_path = Path(str(shot_file))
        if not img_path.is_absolute() and '/' not in str(shot_file) and '\\' not in str(shot_file):
            img_path = SHOTS / shot_file
        add_picture(s, img_path, IMG_L, IMG_T, IMG_W, IMG_H)

    # tab badge
    if tab:
        badge_col = ACCENT4 if new_badge else ACCENT
        add_rect(s, RIGHT_X + Inches(0.12), Inches(0.16), Inches(1.9), Inches(0.28), fill=badge_col)
        add_text(s, ("NEW  " if new_badge else "") + tab,
                 RIGHT_X + Inches(0.17), Inches(0.17), Inches(1.8), Inches(0.26),
                 size=Pt(7.5), bold=True, colour=WHITE, align=PP_ALIGN.CENTER)

    # title
    add_text(s, title, RIGHT_X + Inches(0.15), Inches(0.52),
             PANEL_W - Inches(0.25), Inches(0.52),
             size=Pt(14.5), bold=True, colour=ACCENT)

    cy = Inches(1.12)
    def section(label, items, label_col):
        nonlocal cy
        add_text(s, label, RIGHT_X + Inches(0.15), cy, PANEL_W - Inches(0.25), Inches(0.21),
                 size=Pt(8), bold=True, colour=label_col)
        cy += Inches(0.21)
        for item in items:
            add_text(s, f"  {item}", RIGHT_X + Inches(0.18), cy,
                     PANEL_W - Inches(0.28), Inches(0.21), size=Pt(9), colour=LIGHT)
            cy += Inches(0.21)
        cy += Inches(0.1)

    section("WHAT YOU SEE", what,    DIM)
    section("INPUTS",        inputs,  ACCENT2)
    section("OUTPUTS / ACTIONS", outputs, ACCENT3)

    footer(s, n, total, footer_text)
    return s

# ════════════════════════════════════════════════════════════════════════════════
# Slide definitions — (kind, *args)
# kind: "title" | "overview" | "arch" | "whats-new" | "summary" |
#        "content" (title, shot, what[], inputs[], outputs[], tab, new_badge)
# ════════════════════════════════════════════════════════════════════════════════
SLIDES = [
# ── 1 Title ───────────────────────────────────────────────────────────────────
("title",),
# ── 2 Overview ────────────────────────────────────────────────────────────────
("overview",),
# ── 3 Architecture ────────────────────────────────────────────────────────────
("arch",),
# ── 4 Setup Tab ───────────────────────────────────────────────────────────────
("content",
 "Setup Tab — Environment Health & Installer",
 "02-setup.png",
 ["Environment health checklist (Node, Python, Git, Claude CLI, Playwright, Ports)",
  "Skills installer cards: Claude Code, GitHub Copilot, Gemini CLI, Cursor",
  "IDE Extensions section: VS Code + IntelliJ plugin cards",
  "Services section: Minerva, Mimir Academy, Agent WebUI — Install / Restart / Open",
  "Streaming install logs per card via SSE"],
 ["Select which AI tools to install skills into (modal with detected tool checkboxes)",
  "Click Install on any card; Stop cancels the install mid-stream"],
 ["Skills deployed to detected AI tool config directories",
  "MCP server entries written to VS Code / JetBrains settings",
  ".setup-complete marker written after repo path is configured",
  "Open button appears for running services"],
 "Setup"),
# ── 5 Settings: Env ───────────────────────────────────────────────────────────
("content",
 "Settings — Environment Variables",
 "03-settings-env.png",
 ["Key/value editor for all runtime env vars",
  "PAT-style keys (ADO_PAT, FIGMA_TOKEN, ANTHROPIC_API_KEY) auto-masked",
  "Ollama rows always shown (OLLAMA_HOST, OLLAMA_MODEL) for local LLM use",
  "Changes feed every pipeline command on the next run"],
 ["Key name (text)", "Value (text; auto-masked for PAT-pattern keys)",
  "+ Add Variable button adds a new editable row"],
 ["Save .env writes all values to the project .env file",
  "Values immediately available to the next pipeline invocation"],
 "Settings"),
# ── 6 Settings: Inputs ────────────────────────────────────────────────────────
("content",
 "Settings — Pipeline Inputs: Target & Sources",
 "04-settings-inputs.png",
 ["Full pipeline config form split into collapsible sections",
  "Pipeline Target: repo path, service root, test root, frontend repo",
  "Pipeline stage selector (0 / 1 / 2 / 3 / 4 / 5 / consistency)",
  "Sources: ADO story URL, Figma URLs (textarea), Website URL + test credentials",
  "Test style radio: BDD vs E2E",
  "API context: Postman collection, OpenAPI spec, LLD documents, additional docs"],
 ["Repo path (absolute path to test repo)",
  "ADO story URL", "Figma file / flow URLs (one per line)",
  "Website URL (url input)", "Test username + password",
  "Postman collection path / OpenAPI spec path"],
 ["Save sample-input.json persists config to disk",
  "Toggle Show raw JSON to edit config directly as a JSON blob",
  "Config consumed by every pipeline command on next run"],
 "Settings"),
# ── 7 Settings: Quality Gate ──────────────────────────────────────────────────
("content",
 "Settings — LLM Flags, Quality Gate & Advanced",
 "14-settings-quality-gate.png",
 ["LLM Flags section (collapsible): 7 toggles to disable specific AI steps",
  "Quality Gate card: configures release-readiness thresholds",
  "Advanced / Overrides: adapter profile, feature path, step path, cache TTL",
  "Browser Session: SSO fallback (CDP port, user data dir, headless flag)",
  "IDE Configuration card: VS Code + JetBrains MCP config JSON snippets"],
 ["Min pass rate (%) — release gate threshold",
  "Max failures (count) — release gate threshold",
  "LLM flag checkboxes: Disable AC extraction / alignment / journey discovery / etc.",
  "Story depth (0-5), Figma transition limit (number)"],
 ["Quality Gate result visible on Results tab after test run",
  "Save stores quality gate settings to sample-input.json",
  "LLM flags reduce AI calls for faster runs when specific steps are known",
  "Copy buttons in IDE Configuration card copy MCP JSON to clipboard"],
 "Settings"),
# ── 8 Generate Tab ────────────────────────────────────────────────────────────
("content",
 "Generate Tab — Run Options & Pipeline Commands",
 "05-generate.png",
 ["Left sidebar: Run Options card + grouped command list",
  "Right pane: live streaming job output with progress bar + phase label",
  "Job history panel (collapsible): up to 50 prior jobs with Reconnect buttons",
  "Checkpoint resume banner: shows N/total journeys complete + Clear link"],
 ["Test style: BDD / E2E (radio)",
  "Step scope: Both / Functional / Non-functional (radio)",
  "Test layer: Both / Frontend / Backend (radio)",
  "Journey workers: 1-8 parallel workers (number input)",
  "Checkboxes: Refresh baseline, Refresh coverage, Fresh run (ignore checkpoint)"],
 ["Click any command to launch the pipeline",
  "Progress bar decodes phase tokens: compose-bdd / compose-e2e / duplicate-gate / codegen",
  "Cancel button stops the running job",
  "Output streams in real-time to the scrollable console"],
 "Generate"),
# ── 9-12 Demo flows ───────────────────────────────────────────────────────────
("content",
 "Demo: Test Generation Flow",
 "06-demo-testgen.png",
 ["5-stage vertical pipeline diagram with collapsible stage cards",
  "Stage 0: Repo Analysis — framework detection, step catalog build",
  "Stage 1: Ingest + Generate — ADO/Figma/LLD -> Gherkin + step-defs",
  "Coverage Collection, optional Figma transitions, Deployment stages",
  "Each card shows input chips (live values from config) + sample stats"],
 ["Click 'Test Generation' flow button at top",
  "Expand any stage card to see inputs list, produces list, substeps"],
 ["Shows what inputs feed each stage and what each stage produces",
  "Live stats from last run (file counts, durations) populate each stage",
  "Substep drawer for Stage 1: ADO tree, Figma transitions, journey grouping"],
 "Demo"),
("content",
 "Demo: Coverage Report Flow",
 "06b-demo-coverage.png",
 ["4-stage pipeline: Repo Scan -> API Surface Extraction -> Coverage Collection -> Gap Analysis",
  "Shows how unit test coverage + BDD coverage + Postman are merged",
  "Per-endpoint matrix: covered / partial / untested / orphan"],
 ["Click 'Coverage Report' flow button",
  "Expand stage cards to see API surface extraction details"],
 ["Understand coverage gaps before running propose-coverage-scenarios",
  "Identifies orphan tests (tests that hit endpoints the service doesn't declare)"],
 "Demo"),
("content",
 "Demo: Website Analysis Flow",
 "06c-demo-website.png",
 ["4-stage pipeline: Website Crawl -> Interaction & API Discovery -> Journey Mapping -> BDD Generation",
  "Headless Playwright browser crawls a live URL",
  "Records all clicks, form submissions, navigation events, and XHR/fetch calls",
  "Maps interactions to API calls and groups into user journeys"],
 ["Click 'Website Analysis' flow button",
  "Website URL configured in Settings feeds this flow"],
 ["Produces journey map Markdown, E2E BDD feature files",
  "Generates unique journey IDs for traceability",
  "AC-to-page alignment written to the consistency report"],
 "Demo"),
("content",
 "Demo: Work Item Planner Flow",
 "06d-demo-planner.png",
 ["5-stage pipeline: LLD Analysis -> Hierarchy Generation -> AC Extraction -> Journey Sketches -> ADO Export",
  "Shows how LLD documents + Figma designs produce a full Epic/Feature/Story/Task tree",
  "AC extraction uses both structured fields and LLM enrichment",
  "Journey sketches provide BDD/E2E test hooks per story"],
 ["Click 'Planner' flow button",
  "LLD document paths + Figma folder configured in Plan tab"],
 ["Outputs: planner-hierarchical.json, planner-ado-batch.json, per-item JSON files",
  "Sprint plan Markdown written alongside the hierarchy",
  "ADO batch JSON ready for direct import into Azure DevOps"],
 "Demo"),
# ── 13 Planner: Generate ──────────────────────────────────────────────────────
("content",
 "Planner — Work Item Generation",
 "07-planner-generate.png",
 ["LLD document paths (textarea, one path/URL per line: .md, .docx, .xlsx, HTTPS)",
  "Figma design folder with live file listing (calls /api/planner-figma-designs)",
  "Sprint Configuration section (collapsible): count, length, velocity per discipline",
  "Per-sprint override table: editable BE/FE/TE capacity per sprint + Randomize button",
  "Resilience Settings: epic concurrency (1-6), epic timeout (minutes)",
  "Checkpoint resume banner: N/total epics complete + Clear link"],
 ["LLD document paths (one per line)",
  "Figma design folder path",
  "Sprint count (1-20), sprint length (days)",
  "Default velocity: Backend / Frontend / Testing SP/sprint"],
 ["Generate Work Items builds full Epic -> Feature -> Story -> Task hierarchy",
  "Progress bar + live console during generation; auto-switches to Sprint Plan on completion",
  "Stop button halts mid-run; checkpoint survives for resume"],
 "Plan", True),
# ── 14 Planner: View Output ───────────────────────────────────────────────────
("content",
 "Planner — Reviewing Output Files",
 "08-planner-view.png",
 ["Cards per output file: planner-hierarchical.json, planner-ado-batch.json, per-item files",
  "Each card shows filename, size, modified date",
  "Hierarchical JSON preview: structured summary of project name, epic/feature/story counts",
  "Other files show raw JSON preview"],
 ["Click Show preview / Hide preview to toggle lazy-loaded file content",
  "Click Download to save a file locally"],
 ["Download button saves any output file to disk",
  "Delete All Output removes all planner output files",
  "planner-ado-batch.json is the ADO-importable work items package"],
 "Plan", True),
# ── 15 Planner: Sprint Board ──────────────────────────────────────────────────
("content",
 "Planner — Interactive Sprint Board",
 "09-planner-sprint.png",
 ["Kanban board computed in-browser from hierarchical JSON (no server round-trip)",
  "One column per sprint + Overflow column; sprint headers show BE/FE/TE capacity chips",
  "Story cards: title, story points badge, discipline chips, complexity badge",
  "Over-capacity sprints highlighted with orange column outline",
  "Summary bar: sprints fitted, overflow count, total story points"],
 ["Tightness selector: 5 levels (60% / 80% / 100% / 120% / 140% of velocity)",
  "Drag story cards between sprint columns",
  "Click any story card to open full story detail modal"],
 ["Regenerate sprint plan recalculates when tightness changes",
  "Reset to auto-plan discards manual moves",
  "Story detail modal: user story, AC list, tasks, BDD/E2E journey sketches",
  "Board state persisted to /api/planner/board — manual moves survive page refresh"],
 "Plan", True),
# ── 16 Artifacts ──────────────────────────────────────────────────────────────
("content",
 "Artifacts — Reviewing Generated Files",
 "10-artifacts.png",
 ["Collapsible directory sections with file cards",
  "Each card: filename, directory, deploy badge (Not deployed / Deployed + target path)",
  "Click any card -> full file reader modal with metadata, Markdown or code preview",
  "Refresh + Delete All buttons in toolbar"],
 ["Show JSON checkbox includes/excludes JSON files from the list",
  "Click a file card to open the reader",
  "Refresh reloads the artifact list from disk"],
 ["Move to repo button deploys a file to the configured target repo path",
  "Delete removes a single artifact",
  "Markdown files render with full formatting in the modal preview"],
 "Artifacts"),
# ── 17 Execute ────────────────────────────────────────────────────────────────
("content",
 "Execute Tab — Test Scenario Selection",
 "11-execute.png",
 ["3-dimensional filter system over discovered test scenarios",
  "Row 1: BDD+E2E / BDD only / E2E only",
  "Row 2: All categories / Functional / Non-functional",
  "Row 3: Free-text search input",
  "Scenario list with per-item checkboxes"],
 ["Check individual scenarios or use Select all / Deselect all",
  "Combine type + category + text search to narrow the list",
  "Run selected executes checked scenarios"],
 ["Status label shows run progress",
  "Results written to the test output directory",
  "Results tab auto-refreshes after run completes"],
 "Execute"),
# ── 18 Results ────────────────────────────────────────────────────────────────
("content",
 "Results — Dashboard & Quality Gate",
 "12-results.png",
 ["Summary tiles: pass count, fail count, pass rate, duration",
  "Failures card: list of failed test cases by name",
  "Pass rate trend chart: inline SVG time series across successive runs",
  "Quality Gate panel: Release Ready (green) or Not Ready (red) badge",
  "Rule-by-rule breakdown: current value vs. configured threshold"],
 ["Refresh button reloads the latest results",
  "Quality gate thresholds configured in Settings -> Quality Gate card"],
 ["Clear pass/fail verdict against configured release thresholds",
  "Failure list links each failing scenario by name",
  "Trend chart shows pass rate improvement across runs"],
 "Results"),
# ── 19 Assistant Chat ─────────────────────────────────────────────────────────
("content",
 "Assistant Chat — Context-Aware In-App Help",
 "13-chat.png",
 ["Floating speech-bubble FAB (bottom-right) visible on every tab",
  "Slide-in chat panel: knows which tab is active, greets accordingly",
  "Context label shows current tab name",
  "Can parse action JSON from responses to apply UI actions automatically"],
 ["Type a question in the text input field",
  "Press Send or Enter to submit"],
 ["Answers questions about current tab, pipeline status, or config options",
  "Can change Execute tab filters automatically via action JSON in response",
  "Conversation history maintained within the page session",
  "Sends current tab context + conversation history to /api/assistant/chat"],
 "Assistant", True),
# ── 20 MCP Tools ──────────────────────────────────────────────────────────────
("content",
 "IDE Integration — MCP Tools for Agent Workflows",
 "15-mcp-tools.png",
 ["9 composable MCP tools callable from VS Code, JetBrains, GitHub Copilot, Gemini",
  "Tools give IDE agents granular access to pipeline stages (not just the monolith)",
  "MCP server config snippets available in Settings -> IDE Configuration card",
  "Named input profiles: save/load/delete named presets for sample-input.json"],
 ["MCP server configured once per IDE via the IDE Configuration card",
  "Tools invocable from any IDE chat agent supporting MCP"],
 ["get_story_context — ADO story graph + AC enrichment + Figma flows",
  "get_coverage_report — per-endpoint coverage matrix (3-4 evidence sources)",
  "generate_scenarios — Stage 1 Gherkin generation (no step-def code-gen)",
  "generate_step_definitions — Phase 2 step-def code from proposals",
  "plan_work_items — LLD + Figma -> Epic/Story hierarchy + ADO batch JSON",
  "get_repo_baseline, get_api_contracts, generate_test_data, save/list/delete_input_profile"],
 "Settings"),
# ── 21 Summary ────────────────────────────────────────────────────────────────
("summary",),
# ── 22 What's New ─────────────────────────────────────────────────────────────
("whats-new",),
]

TOTAL = len(SLIDES)

# ════════════════════════════════════════════════════════════════════════════════
# Special slide builders
# ════════════════════════════════════════════════════════════════════════════════
def build_title(prs, n, project_name=None, subtitle=None, tagline=None,
                pills=None, footer_text=None):
    project_name = project_name or _DEFAULT_PROJECT
    subtitle     = subtitle     or _DEFAULT_SUBTITLE
    tagline      = tagline      or _DEFAULT_TAGLINE
    pills        = pills        or _DEFAULT_PILLS

    s = prs.slides.add_slide(prs.slide_layouts[6]); set_bg(s)
    add_rect(s, 0, Inches(2.9), W, Inches(0.07), fill=ACCENT)
    add_text(s, project_name,
             Inches(0.8), Inches(1.2), Inches(11.73), Inches(1.2),
             size=Pt(52), bold=True, colour=WHITE, align=PP_ALIGN.CENTER)
    add_text(s, subtitle,
             Inches(0.8), Inches(2.45), Inches(11.73), Inches(0.6),
             size=Pt(22), colour=ACCENT, align=PP_ALIGN.CENTER)
    add_text(s, tagline,
             Inches(0.8), Inches(3.15), Inches(11.73), Inches(0.45),
             size=Pt(12), colour=DIM, align=PP_ALIGN.CENTER)
    px = Inches(1.1)
    pill_w = Inches(1.85)
    pill_step = Inches(1.98)
    # re-center pills dynamically
    total_w = len(pills) * pill_step - (pill_step - pill_w)
    px = (W - total_w) / 2
    for pill in pills:
        add_rect(s, px, Inches(4.05), pill_w, Inches(0.38), fill=PANEL_BG, line=BORDER)
        add_text(s, pill, px + Inches(0.05), Inches(4.08), pill_w - Inches(0.1), Inches(0.32),
                 size=Pt(8.5), colour=LIGHT, align=PP_ALIGN.CENTER)
        px += pill_step
    footer(s, n, TOTAL, footer_text)

def build_overview(prs, n, columns=None, footer_text=None):
    if columns is None:
        cols = [
            ("Core Purpose",
             ["Generates Gherkin .feature files + step definitions from ADO stories, Figma designs, and LLD documents",
              "Analyses existing test repos to understand the current step catalog and coverage gaps",
              "Deploys generated artifacts directly to the target test repo branch"]),
            ("Planning",
             ["Reads LLD + Figma to generate a full Epic > Feature > Story > Task hierarchy",
              "Produces ADO batch-import JSON ready for direct upload",
              "Interactive sprint board with drag-and-drop velocity planning"]),
            ("Coverage & Analysis",
             ["Per-endpoint coverage matrix (covered / partial / untested / orphan)",
              "Website headless crawl: records clicks, XHR, maps to journeys, generates BDD",
              "Propose + generate coverage scenarios for untested endpoints (2-phase workflow)"]),
            ("IDE & Agent Integration",
             ["MCP server exposes 9 composable tools to VS Code, JetBrains, GitHub Copilot, Gemini",
              "In-app chat assistant: context-aware help + UI action control",
              "Installable as Electron desktop app or headless server"]),
        ]
    else:
        cols = [(c['heading'], c['bullets']) for c in columns]

    overview_title = "What Is Automation Agent?" if columns is None else "Overview"
    s = prs.slides.add_slide(prs.slide_layouts[6]); set_bg(s)
    add_text(s, overview_title,
             Inches(0.5), Inches(0.28), Inches(12), Inches(0.6),
             size=Pt(28), bold=True, colour=ACCENT)
    add_rect(s, Inches(0.5), Inches(0.95), Inches(12.33), Inches(0.04), fill=BORDER)
    cx = Inches(0.28)
    col_w = Inches(3.0)
    col_step = Inches(3.2)
    if len(cols) != 4:
        available = W - Inches(0.56)
        col_w = available / len(cols) - Inches(0.2)
        col_step = available / len(cols)
    for heading, bullets in cols:
        add_rect(s, cx, Inches(1.1), col_w, Inches(5.7), fill=PANEL_BG)
        add_text(s, heading, cx + Inches(0.15), Inches(1.2), col_w - Inches(0.3), Inches(0.38),
                 size=Pt(11.5), bold=True, colour=ACCENT2)
        by = Inches(1.68)
        for b in bullets:
            add_text(s, f"  {b}", cx + Inches(0.12), by, col_w - Inches(0.24), Inches(0.55),
                     size=Pt(9.2), colour=LIGHT)
            by += Inches(0.62)
        cx += col_step
    footer(s, n, TOTAL, footer_text)

def build_arch(prs, n, arch_data=None, footer_text=None):
    if arch_data is None:
        title = "Architecture — Four Pipeline Flows"
        flows = [
            ("Test\nGeneration",  "Stage 0: Repo scan\nStage 1: ADO/Figma/LLD -> Gherkin\nStage 2: Deploy to repo branch", ACCENT),
            ("Coverage\nReport",  "Repo scan + API surface\nUnit test + BDD + Postman merge\nPer-endpoint coverage matrix", ACCENT2),
            ("Website\nAnalysis", "Playwright headless crawl\nInteraction + XHR recording\nJourney map + BDD features", RGBColor(0x56, 0xB4, 0xE9)),
            ("Work Item\nPlanner", "LLD + Figma -> Epic tree\nAC extraction + journey sketches\nADO batch JSON + sprint plan", ACCENT3),
        ]
        inputs  = ["ADO Story URL", "Figma File URLs", "LLD Documents", "Website URL", "OpenAPI / Postman"]
        outputs = [".feature files", "Step definitions", "Coverage matrix", "Journey maps", "ADO work-items JSON"]
        description = ("The Electron app wraps a local HTTP server (port 8788) and exposes all four flows via a browser-based SPA. "
                       "All flows are also callable from VS Code / JetBrains via MCP, or directly from the CLI.")
    else:
        title       = arch_data.get('title', 'Architecture')
        flows       = arch_data['flows']   # list of (label, desc, RGBColor)
        inputs      = arch_data.get('inputs', [])
        outputs     = arch_data.get('outputs', [])
        description = arch_data.get('description', '')

    s = prs.slides.add_slide(prs.slide_layouts[6]); set_bg(s)
    add_text(s, title,
             Inches(0.5), Inches(0.28), Inches(12), Inches(0.6),
             size=Pt(28), bold=True, colour=ACCENT)
    add_rect(s, Inches(0.5), Inches(0.95), Inches(12.33), Inches(0.04), fill=BORDER)

    n_flows = len(flows)
    available_w = W - Inches(0.64)
    flow_w    = available_w / n_flows - Inches(0.23)
    flow_step = available_w / n_flows
    bx = Inches(0.32)
    for lbl, desc, col in flows:
        add_rect(s, bx, Inches(1.5), flow_w, Inches(2.7), fill=PANEL_BG, line=col)
        add_text(s, lbl, bx + Inches(0.12), Inches(1.6), flow_w - Inches(0.24), Inches(0.55),
                 size=Pt(13), bold=True, colour=col)
        add_text(s, desc, bx + Inches(0.12), Inches(2.22), flow_w - Inches(0.24), Inches(1.1),
                 size=Pt(9.5), colour=LIGHT)
        bx += flow_step

    if inputs:
        add_text(s, "INPUTS",
                 Inches(0.32), Inches(4.38), Inches(1.2), Inches(0.28),
                 size=Pt(9), bold=True, colour=ACCENT2)
        n_inp = len(inputs)
        inp_step = (W - Inches(1.87)) / n_inp if n_inp else Inches(2.25)
        inp_w    = inp_step - Inches(0.15)
        for i, inp in enumerate(inputs):
            ix = Inches(1.55) + i * inp_step
            add_rect(s, ix, Inches(4.38), inp_w, Inches(0.28),
                     fill=RGBColor(0x1A, 0x3A, 0x2A), line=ACCENT2)
            add_text(s, inp, ix + Inches(0.05), Inches(4.4), inp_w - Inches(0.1), Inches(0.24),
                     size=Pt(8.5), colour=ACCENT2, align=PP_ALIGN.CENTER)

    if outputs:
        add_text(s, "OUTPUTS",
                 Inches(0.32), Inches(4.85), Inches(1.2), Inches(0.28),
                 size=Pt(9), bold=True, colour=ACCENT3)
        n_out = len(outputs)
        out_step = (W - Inches(1.87)) / n_out if n_out else Inches(2.25)
        out_w    = out_step - Inches(0.15)
        for i, out in enumerate(outputs):
            ox = Inches(1.55) + i * out_step
            add_rect(s, ox, Inches(4.85), out_w, Inches(0.28),
                     fill=RGBColor(0x3A, 0x28, 0x10), line=ACCENT3)
            add_text(s, out, ox + Inches(0.05), Inches(4.87), out_w - Inches(0.1), Inches(0.24),
                     size=Pt(8.5), colour=ACCENT3, align=PP_ALIGN.CENTER)

    if description:
        add_text(s, description,
                 Inches(0.32), Inches(5.45), Inches(12.7), Inches(0.6),
                 size=Pt(9.5), colour=DIM)
    footer(s, n, TOTAL, footer_text)

def build_summary(prs, n, summary_data=None, footer_text=None):
    if summary_data is None:
        summ_title    = "End-to-End Flow"
        summ_subtitle = "From ADO story to shipped tests in one pipeline"
        steps = [
            ("1. Configure", "Settings tab:\nset ADO URL, Figma URLs\nrepo path, quality gate"),
            ("2. Generate", "Generate tab:\nrun Stage 0 + Stage 1\n(scan -> scenarios)"),
            ("3. Review", "Artifacts tab:\npreview .feature files\nbefore deploy"),
            ("4. Deploy", "Generate tab:\nrun Stage 2 to push\nfiles to test repo"),
            ("5. Execute", "Execute tab:\nselect & run\ngenerated tests"),
            ("6. Results", "Results tab:\npass rate, quality gate\nRelease Ready verdict"),
        ]
        note = ("Planner flow runs in parallel: LLD + Figma -> Epic/Story hierarchy "
                "-> Sprint board -> ADO import JSON")
    else:
        summ_title    = summary_data.get('title', 'End-to-End Flow')
        summ_subtitle = summary_data.get('subtitle', '')
        steps         = summary_data.get('steps', [])   # list of (label, desc) tuples
        note          = summary_data.get('note', '')

    s = prs.slides.add_slide(prs.slide_layouts[6]); set_bg(s)
    add_rect(s, 0, Inches(3.25), W, Inches(0.07), fill=ACCENT)
    add_text(s, summ_title,
             Inches(1), Inches(0.9), Inches(11.33), Inches(0.7),
             size=Pt(32), bold=True, colour=WHITE, align=PP_ALIGN.CENTER)
    if summ_subtitle:
        add_text(s, summ_subtitle,
                 Inches(1), Inches(1.72), Inches(11.33), Inches(0.4),
                 size=Pt(14), colour=DIM, align=PP_ALIGN.CENTER)

    n_steps = len(steps)
    step_w    = Inches(1.95)
    step_step = (W - Inches(0.64)) / n_steps if n_steps else Inches(2.18)
    step_w    = step_step - Inches(0.23)
    bx = Inches(0.32)
    for i, item in enumerate(steps):
        if isinstance(item, (list, tuple)):
            step_label, step_desc = item[0], item[1]
        else:
            step_label = item.get('label', '')
            step_desc  = item.get('desc', '')
        col = ACCENT if i % 2 == 0 else ACCENT2
        add_rect(s, bx, Inches(3.55), step_w, Inches(2.55), fill=PANEL_BG, line=col)
        add_text(s, step_label, bx + Inches(0.1), Inches(3.65), step_w - Inches(0.2), Inches(0.35),
                 size=Pt(11), bold=True, colour=col)
        add_text(s, step_desc,  bx + Inches(0.1), Inches(4.05), step_w - Inches(0.2), Inches(0.9),
                 size=Pt(9), colour=LIGHT)
        if i < n_steps - 1:
            add_text(s, "->", bx + step_w + Inches(0.01), Inches(4.5),
                     Inches(0.22), Inches(0.3),
                     size=Pt(13), colour=DIM, align=PP_ALIGN.CENTER)
        bx += step_step
    if note:
        add_text(s, note,
                 Inches(0.4), Inches(6.4), Inches(12.53), Inches(0.35),
                 size=Pt(9.5), colour=DIM, align=PP_ALIGN.CENTER)
    footer(s, n, TOTAL, footer_text)

def build_whats_new(prs, n, items=None, footer_text=None):
    if items is None:
        items = [
            ("Plan Tab (3-mode suite)",
             "Generate mode: LLD + Figma -> Epic/Story/Task hierarchy with sprint config and checkpoint resume. "
             "View Output: per-file preview and ADO batch JSON download. "
             "Sprint Board: drag-and-drop Kanban with tightness control and story detail modal."),
            ("Demo Tab (4 flows)",
             "Visual pipeline explainer for Test Generation, Coverage Report, Website Analysis, and Planner. "
             "Each stage card shows live input values from config and sample stats from the last run."),
            ("Generate Tab — New Controls",
             "Step scope (Functional / Non-functional), Test layer (Frontend / Backend), Journey workers (1-8), "
             "Fresh run checkbox. Checkpoint resume banner with clear link. Job history panel."),
            ("Results Tab — Quality Gate",
             "Release Ready / Not Ready verdict badge with per-rule breakdown (pass rate vs. threshold, "
             "failure count vs. max). Thresholds configured in Settings."),
            ("Assistant Chat FAB",
             "Global context-aware chat panel. Knows which tab is active. Can apply UI actions automatically "
             "(e.g., set Execute tab filters) via action JSON parsed from responses."),
            ("9 New MCP Tools",
             "get_story_context, get_coverage_report, generate_scenarios, generate_step_definitions, "
             "plan_work_items, get_api_contracts, generate_test_data, save/list/delete_input_profile."),
            ("OpenAPI YAML/Swagger Support",
             "Full $ref resolution for OpenAPI YAML and Swagger specs. "
             "Lateral story-graph traversal for complex ADO work-item hierarchies."),
            ("Website Analysis Enhancements",
             "Unique journey IDs for full traceability. AC-to-page alignment in consistency reports. "
             "Improved crawler with interaction tracker and extractor."),
        ]
    else:
        # items may be list of (heading, desc) tuples or dicts
        items = [(it['heading'], it.get('desc', '')) if isinstance(it, dict) else it
                 for it in items]

    s = prs.slides.add_slide(prs.slide_layouts[6]); set_bg(s)
    add_text(s, "What's New — Recent Feature Highlights",
             Inches(0.5), Inches(0.28), Inches(12), Inches(0.6),
             size=Pt(28), bold=True, colour=ACCENT4)
    add_rect(s, Inches(0.5), Inches(0.95), Inches(12.33), Inches(0.04), fill=ACCENT4)
    cx = Inches(0.3); cy = Inches(1.1)
    for i, (heading, desc) in enumerate(items):
        col_x = cx + (i % 2) * Inches(6.55)
        col_y = cy + (i // 2) * Inches(1.45)
        add_rect(s, col_x, col_y, Inches(6.3), Inches(1.38), fill=PANEL_BG)
        add_rect(s, col_x, col_y, Inches(0.06), Inches(1.38), fill=ACCENT4)
        add_text(s, heading, col_x + Inches(0.15), col_y + Inches(0.06), Inches(6.1), Inches(0.28),
                 size=Pt(10), bold=True, colour=ACCENT4)
        add_text(s, desc, col_x + Inches(0.15), col_y + Inches(0.36), Inches(6.1), Inches(0.9),
                 size=Pt(8.5), colour=LIGHT)
    footer(s, n, TOTAL, footer_text)

# ════════════════════════════════════════════════════════════════════════════════
# Config loader
# ════════════════════════════════════════════════════════════════════════════════
def load_config(path):
    config_dir = Path(path).parent
    with open(path, encoding='utf-8') as f:
        data = json.load(f)

    project_name = data.get('project_name', _DEFAULT_PROJECT)
    subtitle     = data.get('subtitle',     _DEFAULT_SUBTITLE)
    tagline      = data.get('tagline',      _DEFAULT_TAGLINE)
    pills        = data.get('feature_pills', _DEFAULT_PILLS)
    footer_text  = data.get('footer_text',
                            f"{project_name}  |  {tagline[:60]}" if tagline else project_name)
    output       = data.get('output',
                            f"{project_name.replace(' ', '-')}-Walkthrough.pptx")

    slides = []
    for slide in data.get('slides', []):
        kind = slide['kind']
        if kind == 'title':
            slides.append(('title',))

        elif kind == 'overview':
            slides.append(('overview', slide.get('columns')))

        elif kind == 'arch':
            flows = []
            for f in slide.get('flows', []):
                color = _COLOR_MAP.get(f.get('color', 'accent'), ACCENT)
                flows.append((f['label'], f.get('desc', ''), color))
            arch_data = {
                'title':       slide.get('title', 'Architecture'),
                'flows':       flows,
                'inputs':      slide.get('inputs', []),
                'outputs':     slide.get('outputs', []),
                'description': slide.get('description', ''),
            }
            slides.append(('arch', arch_data))

        elif kind == 'content':
            shot = slide.get('shot') or None
            if shot:
                shot_path = Path(shot)
                if not shot_path.is_absolute():
                    shot_path = config_dir / shot
                shot = str(shot_path)
            slides.append((
                'content',
                slide.get('title', ''),
                shot,
                slide.get('what', []),
                slide.get('inputs', []),
                slide.get('outputs', []),
                slide.get('tab', ''),
                slide.get('new_badge', False),
            ))

        elif kind == 'summary':
            steps = [(s['label'], s.get('desc', '')) for s in slide.get('steps', [])]
            summary_data = {
                'title':    slide.get('title', 'End-to-End Flow'),
                'subtitle': slide.get('subtitle', ''),
                'steps':    steps,
                'note':     slide.get('note', ''),
            }
            slides.append(('summary', summary_data))

        elif kind == 'whats-new':
            items = [(it['heading'], it.get('desc', '')) for it in slide.get('items', [])]
            slides.append(('whats-new', items))

    return slides, project_name, subtitle, tagline, pills, footer_text, output

# ════════════════════════════════════════════════════════════════════════════════
# Build
# ════════════════════════════════════════════════════════════════════════════════
def parse_args():
    p = argparse.ArgumentParser(description='Build PPTX walkthrough deck')
    p.add_argument('--config', help='Path to JSON slide config (enables universal mode)')
    p.add_argument('--output', help='Output .pptx path (overrides config output field)')
    args = p.parse_args()
    return args.config, args.output

def build(config_path=None, output_override=None):
    global TOTAL

    if config_path:
        slides, project_name, subtitle, tagline, pills, footer_text, out_name = load_config(config_path)
        out = Path(config_path).parent / out_name
    else:
        slides       = SLIDES
        project_name = _DEFAULT_PROJECT
        subtitle     = _DEFAULT_SUBTITLE
        tagline      = _DEFAULT_TAGLINE
        pills        = _DEFAULT_PILLS
        footer_text  = _DEFAULT_FOOTER
        out          = OUT

    if output_override:
        out = Path(output_override)

    TOTAL = len(slides)

    prs = Presentation()
    prs.slide_width  = W
    prs.slide_height = H

    for n, spec in enumerate(slides, 1):
        kind = spec[0]
        if kind == 'title':
            build_title(prs, n, project_name, subtitle, tagline, pills, footer_text)
        elif kind == 'overview':
            cols = spec[1] if len(spec) > 1 else None
            build_overview(prs, n, cols, footer_text)
        elif kind == 'arch':
            arch = spec[1] if len(spec) > 1 else None
            build_arch(prs, n, arch, footer_text)
        elif kind == 'summary':
            summ = spec[1] if len(spec) > 1 else None
            build_summary(prs, n, summ, footer_text)
        elif kind == 'whats-new':
            itms = spec[1] if len(spec) > 1 else None
            build_whats_new(prs, n, itms, footer_text)
        elif kind == 'content':
            _, title, shot, what, inputs, outputs, tab, *rest = spec
            new_badge = rest[0] if rest else False
            content_slide(prs, n, TOTAL, title, shot, what, inputs, outputs,
                          tab, new_badge, footer_text)

    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    print(f"Saved: {out}")
    print(f"Total slides: {len(prs.slides)}")

if __name__ == "__main__":
    config_path, output_override = parse_args()
    build(config_path, output_override)
