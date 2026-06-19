# Cross-Repository Dependency Analysis Skill

AI-powered skill for analyzing and tracking dependencies between interconnected code repositories.

## Structure

```
repo-dependency-analysis/
├── SKILL.md                      # Main skill definition (loaded by AI)
├── scripts/
│   ├── analyze-repos.js          # Dependency scanner
│   └── detect-ripple-effects.js  # Impact analyzer
├── references/
│   └── dependency-types.md       # Pattern documentation
├── .analysis-cache/              # Generated analysis results
│   ├── .gitignore                # Don't commit cache
│   ├── config.json               # User configuration (created on first run)
│   ├── repo-map.json             # Dependency graph (generated)
│   └── connection-report.md      # Human-readable report (generated)
└── README.md                     # This file
```

## How It Works

### 1. Discovery
When you type `@antigravity /repo-dependency-analysis`, the AI loads `SKILL.md` which contains:
- When to use the skill
- Workflow instructions
- Script references

### 2. Initial Setup
On first run, the AI prompts you for:
- Repository paths to analyze
- Which dependency types to track

Then runs: `node scripts/analyze-repos.js setup <paths>`

### 3. Analysis
The analyzer:
- Scans each repository for connection patterns
- Builds dependency graph
- Generates reports in `.analysis-cache/`

### 4. Impact Detection
When you modify code, run: `node scripts/detect-ripple-effects.js`

This compares your changes against the baseline and warns about ripple effects.

## Usage Examples

### Via AI Chat
```
@antigravity /repo-dependency-analysis

# First time:
> I'll analyze dependencies. Please provide repository paths:
c:/repos/api-service, c:/repos/frontend, c:/repos/docker-compose

# Later:
@antigravity Check if my changes will break other repos

> ⚠️ Potential Impact on frontend-app
> Changed: UserProfile interface - removed 'email' property
> Sync Steps:
>   1. Update frontend/types/user.ts
>   2. Run: npm test in frontend-app
```

### Via Command Line
```bash
# Initial setup
node scripts/analyze-repos.js setup c:/repo1 c:/repo2 c:/repo3

# Refresh analysis
node scripts/analyze-repos.js refresh

# Check for ripple effects
node scripts/detect-ripple-effects.js

# CI/CD integration (exit 1 on critical impacts)
node scripts/detect-ripple-effects.js --strict
```

## Supported Dependency Types

✅ npm file: dependencies  
✅ Maven system dependencies  
✅ Docker Compose services  
✅ Environment variables  
✅ OpenAPI/GraphQL schemas  
✅ TypeScript type imports  

See [dependency-types.md](references/dependency-types.md) for details.

## Configuration

After first run, edit `.analysis-cache/config.json` to:
- Add/remove repositories
- Enable/disable dependency types
- Add ignore patterns

```json
{
  "repositories": [
    {
      "name": "my-api",
      "path": "c:/repos/my-api",
      "type": "node",
      "primary": true
    }
  ],
  "trackDependencies": {
    "npm": true,
    "docker": true,
    "envVars": true
  }
}
```

## Custom Rules

Define custom dependency patterns in `.analysis-cache/custom-rules.json`:

```json
{
  "rules": [
    {
      "name": "Shared Config Schema",
      "sourceFile": "config/schema.json",
      "consumerRepos": ["service-a", "service-b"],
      "onBreakingChange": {
        "severity": "critical",
        "syncSteps": [
          "Update config files",
          "Run validation"
        ]
      }
    }
  ]
}
```

## Integration

### Pre-Commit Hook
```bash
# .git/hooks/pre-commit
#!/bin/bash
node .gemini/antigravity/skills/repo-dependency-analysis/scripts/detect-ripple-effects.js
if [ $? -ne 0 ]; then
  echo "❌ Breaking changes detected"
  exit 1
fi
```

### CI/CD Pipeline
```yaml
# .github/workflows/test.yml
- name: Check Ripple Effects
  run: |
    node .gemini/antigravity/skills/repo-dependency-analysis/scripts/detect-ripple-effects.js --strict
```

## Troubleshooting

**"No connections found"**
- Verify repository paths are correct
- Check repos actually have dependencies
- Try enabling more dependency types

**Stale analysis**
- Run `@antigravity /repo-dependency-analysis refresh`
- Or: `node scripts/analyze-repos.js refresh`

**False positives**
- Add patterns to `ignorePatterns` in config
- Define custom rules for complex cases

## Files Generated

**.analysis-cache/config.json**
- Your repository configuration
- Safe to commit (no secrets)

**.analysis-cache/repo-map.json**
- Complete dependency graph
- Machine-readable format
- Used by impact detector

**.analysis-cache/connection-report.md**
- Human-readable analysis
- Lists all connections
- Shows impact matrix

## Requirements

- Node.js 18+ (for scripts)
- Git (for change detection)
- AI agent with skill support (Gemini, Claude, etc.)

## License

Part of the gherkin-sandbox test automation project.
