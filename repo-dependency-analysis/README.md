# Cross-Repository Dependency Analysis Skill

AI-powered skill for analyzing and tracking dependencies between interconnected code repositories. Automatically detects ripple effects when development completes in one repo and surfaces impacts on all other configured repos.

## Quick Start

1. Run the installer once:
   ```powershell
   .\install.ps1
   ```
2. Add your interconnected repos via the interactive menu
3. Restart Claude Code
4. From any configured repo: invoke `/repo-dependency-analysis`

The skill will automatically run crosschecks when all todos complete in a session.

## Structure

```
repo-dependency-analysis/
├── SKILL.md                          # Main skill definition (loaded by AI)
├── install.ps1                       # Interactive installer: configure repos + register hook
├── hooks/
│   └── on-todo-complete.ps1          # PostToolUse hook: auto-crosscheck on todo completion
├── scripts/
│   ├── analyze-repos.js              # Dependency scanner
│   └── detect-ripple-effects.js      # Impact analyzer (diff-aware)
├── references/
│   └── dependency-types.md           # Pattern documentation
├── .analysis-cache/
│   └── .gitignore
└── README.md
```

**Runtime files (user-level, not in repo):**
```
~/.claude/
  repo-dependency-config.json         # Repo list (managed by install.ps1)
  repo-dependency-cache/
    repo-map.json                     # Dependency graph (generated)
    connection-report.md              # Human-readable report (generated)
  repo-dependency-skill-path.txt      # Sidecar used by hook to locate scripts
  scripts/
    on-repo-dep-todo-complete.ps1     # Installed hook script
```

## Installer Commands

```powershell
.\install.ps1              # Full interactive setup (configure repos + install hook)
.\install.ps1 add          # Add a repository to config
.\install.ps1 remove       # Remove a repository from config
.\install.ps1 list         # List configured repositories
.\install.ps1 -Uninstall   # Remove hook (config preserved)
```

## Auto-Crosscheck

When all todos in a Claude Code session complete and the working directory is under a configured repo, a background sub-agent automatically:

1. Captures a git diff snapshot (changed files, exported symbols, env keys, API endpoints)
2. Runs `detect-ripple-effects.js --diff-file <snapshot>` against all other configured repos
3. Reports CRITICAL and WARNING impacts in `%TEMP%\claude-repo-dep-analysis.log`

A 30-minute debounce prevents repeated triggers within the same session.

## Manual Usage

### Via AI Chat
```
/repo-dependency-analysis
/repo-dependency-analysis refresh
/repo-dependency-analysis status
```

### Via Command Line
```powershell
# Initial setup
node scripts/analyze-repos.js setup c:/repo1 c:/repo2 c:/repo3

# Refresh analysis
node scripts/analyze-repos.js refresh

# Check for ripple effects (auto-detects cwd)
node scripts/detect-ripple-effects.js

# Targeted analysis using a diff snapshot
node scripts/detect-ripple-effects.js --diff-file C:/path/to/snapshot.json

# CI/CD: exit 1 on CRITICAL impacts
node scripts/detect-ripple-effects.js --strict

# Legacy paths (backward compat)
node scripts/analyze-repos.js refresh --config .analysis-cache/config.json --cache-dir .analysis-cache/
```

## Supported Dependency Types

- npm `file:` dependencies
- Maven system dependencies
- Docker Compose services and `depends_on`
- Environment variables (`.env.example`)
- OpenAPI / GraphQL schemas
- TypeScript exported symbols

See [dependency-types.md](references/dependency-types.md) for detection details.

## Configuration

Managed by `install.ps1` and stored at `~/.claude/repo-dependency-config.json`:

```json
{
  "repositories": [
    { "name": "my-api", "path": "c:/repos/my-api", "type": "node" }
  ],
  "trackDependencies": {
    "npm": true, "maven": true, "docker": true,
    "envVars": true, "apiSchemas": true, "typeDefinitions": true
  },
  "ignorePatterns": ["**/node_modules/**", "**/target/**", "**/.git/**"]
}
```

Edit this file directly, or use `.\install.ps1 add` / `.\install.ps1 remove`.

## CI/CD Integration

```yaml
# .github/workflows/test.yml
- name: Check Ripple Effects
  run: node skills/repo-dependency-analysis/scripts/detect-ripple-effects.js --strict
```

## Troubleshooting

**"No connections found"** - Verify repo paths, check repos have shared dependencies, enable more dependency types.

**Stale analysis** - Run `/repo-dependency-analysis refresh` or `node scripts/analyze-repos.js refresh`.

**Hook not firing** - Confirm `~/.claude/settings.json` has the `on-repo-dep-todo-complete` TodoWrite entry and Claude Code was restarted.

**False positives** - Add patterns to `ignorePatterns` in config.

## Requirements

- Node.js 18+
- Git
- Claude Code with skill support
