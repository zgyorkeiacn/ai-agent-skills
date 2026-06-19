---
name: repo-dependency-analysis
description: 'Analyze and track dependencies between interconnected repositories (monorepos, multi-repo projects). Use for: detecting ripple effects when changing shared interfaces, finding cross-repo data flow, validating multi-repo changes, dependency mapping, impact analysis, cross-repository refactoring planning.'
argument-hint: 'Optional: repo paths or "refresh" to re-analyze'
user-invocable: true
---

# Cross-Repository Dependency Analysis

Analyzes connection points, data flow, and dependencies between interconnected code repositories to predict and manage ripple effects when making changes.

## When to Use

- **Before major refactoring**: Understand impact across multiple repos
- **When changing shared contracts**: APIs, data schemas, environment variables, configuration
- **Multi-repo projects**: Docker Compose setups, microservices, monorepo modules
- **Dependency validation**: Ensure changes won't break downstream consumers
- **Onboarding**: Understand how repositories interact

## Key Capabilities

✅ **Connection Point Detection**
- Shared npm/Maven dependencies (file: or git: references)
- Environment variable contracts (.env, config files)
- API contracts (OpenAPI specs, GraphQL schemas)
- Data schemas (JSON, TypeScript types, Java POJOs)
- Docker network dependencies (docker-compose services)
- File path references (relative imports, volume mounts)

✅ **Change Impact Analysis**
- Detects when edits affect interfaces used by other repos
- Identifies breaking vs non-breaking changes
- Proposes synchronization steps for dependent repos

✅ **Continuous Monitoring**
- Caches analysis results
- Auto-refreshes when repo structure changes
- Warns before committing breaking changes

## Workflow

### 1. Initial Setup (First Time)

When user invokes the skill for the first time, prompt them for:

**Required Information:**
1. **Repository paths** - Absolute paths to interconnected repos (comma-separated or array)
2. **Primary repo** - The repo they're currently working in (default to current workspace)
3. **Dependency types** - What to track (npm/Maven/Docker/env/APIs/types)

**Example prompt:**
```
I'll analyze dependencies between your repositories. Please provide:

1. Repository paths (comma-separated):
   Example: c:/repos/api-service, c:/repos/frontend, c:/repos/docker-compose

2. Primary repository (default: current workspace):
   Which repo are you actively working in?

3. Track these dependency types (default: all):
   - npm file dependencies
   - Maven dependencies
   - Docker Compose services
   - Environment variables
   - API schemas
   - TypeScript types
```

**After collecting inputs:**
1. Run [analyze-repos.js](./scripts/analyze-repos.js) to scan repos
2. Generate `.analysis-cache/repo-map.json` (dependency graph)
3. Generate `.analysis-cache/connection-report.md` (human-readable)
4. Display summary to user with connection count

### 2. View Current Analysis

When user asks "show dependencies" or "status":
- Load `.analysis-cache/connection-report.md`
- Display formatted output
- Show last scan timestamp

### 3. Refresh Analysis

When user says "refresh" or after detecting repo structure changes:
- Re-run analyzer
- Update cache
- Show diff of changes since last scan

### 4. Pre-Commit Impact Check

When user asks "will this break other repos?" or before committing:
1. Run [detect-ripple-effects.js](./scripts/detect-ripple-effects.js)
2. Compare current working tree against baseline
3. Identify changed interfaces:
   - Modified package.json exports
   - Changed TypeScript interfaces
   - Updated environment variables
   - Modified API schemas
4. List affected repos with severity (warning/critical)
5. Propose sync steps for each affected repo

**Example output:**
```
⚠️ Potential Ripple Effects Detected

1. Impact on: frontend-app
   Connection: shared-types package
   Severity: CRITICAL
   Changed: UserProfile interface - removed 'email' property
   
   Sync Steps:
   - Update frontend/types/user.ts to remove email references
   - Modify UserCard component (uses email for display)
   - Update API client calls
   - Run: npm test in frontend-app

2. Impact on: docker-compose
   Connection: API_BASE_URL environment variable
   Severity: WARNING
   Changed: Renamed to SERVICE_API_URL
   
   Sync Steps:
   - Update docker-compose.yml env section
   - Update .env.example in docker-compose repo
```

### 5. Propose Sync Steps

After identifying impacts, generate actionable TODO lists:
- Group by affected repository
- Prioritize by dependency criticality
- Include validation commands
- Link to relevant files

## Analysis Output Format

The skill generates two cache files:

### repo-map.json (Machine-Readable)
```json
{
  "repositories": [
    {
      "name": "gherkin-sandbox",
      "path": "c:/newgit/gherkin-sandbox",
      "type": "orchestration",
      "dependencies": [
        {
          "type": "docker-service",
          "name": "minerva",
          "location": "docker-compose.yml"
        }
      ]
    }
  ],
  "connections": [
    {
      "from": "framework",
      "to": "agent",
      "type": "npm-file",
      "contract": "copilot-ado-figma-gherkin-agent",
      "location": "framework/package.json",
      "breakingChangePatterns": ["bin/*", "exports.*"]
    }
  ],
  "timestamp": "2026-06-19T10:23:45Z"
}
```

### connection-report.md (Human-Readable)
See [report template](./references/report-template.md) for full format.

## Detection Algorithms

### npm File Dependencies
1. Parse `package.json` in each repo
2. Find dependencies matching `file:../` pattern
3. Resolve relative paths to absolute
4. Match against known repo paths
5. Record as connection

### Docker Service Dependencies
1. Parse `docker-compose.yml` YAML
2. Extract service names
3. Find `depends_on` relationships
4. Map volume mounts between services
5. Build service graph

### Environment Variable Contracts
1. Parse `.env.example` in each repo
2. Extract variable names (format: `VAR_NAME=`)
3. Search code for `process.env.VAR_NAME` or `System.getenv("VAR_NAME")`
4. Cross-reference to find shared variables
5. Track producers vs consumers

### API Schema Contracts
1. Locate OpenAPI/GraphQL schema files
2. Extract endpoint signatures or type definitions
3. Compute fingerprint (hash of contract)
4. Find imports/references in other repos
5. Flag when fingerprint changes

## Configuration

Stored in `.analysis-cache/config.json`:

```json
{
  "repositories": [
    {
      "name": "gherkin-sandbox",
      "path": "c:/newgit/gherkin-sandbox",
      "type": "orchestration",
      "primary": true
    }
  ],
  "trackDependencies": {
    "npm": true,
    "maven": true,
    "docker": true,
    "envVars": true,
    "apiSchemas": true,
    "typeDefinitions": true
  },
  "ignorePatterns": [
    "**/node_modules/**",
    "**/target/**",
    "**/.git/**"
  ]
}
```

## Workflow Implementation

When the skill is invoked, follow this decision tree:

1. **Check if config exists** (`.analysis-cache/config.json`)
   - **No**: Run initial setup → collect repo paths → analyze → save config
   - **Yes**: Continue to step 2

2. **Parse user intent** from argument or context:
   - No argument or "analyze": Show current report
   - "refresh": Re-scan all repos
   - "status": Display summary
   - Context includes file changes: Run impact check

3. **Execute appropriate script**:
   - Setup/Refresh: `node scripts/analyze-repos.js`
   - Impact check: `node scripts/detect-ripple-effects.js`

4. **Format and present results**:
   - Use tables for repo overview
   - Use numbered lists for impacts
   - Include file links for navigation
   - Provide copy-paste commands

## Advanced Features

### Custom Dependency Rules

User can define custom patterns in `.analysis-cache/custom-rules.json`:

```json
{
  "rules": [
    {
      "name": "Shared OpenAPI Spec",
      "sourceFile": "docs/openapi.json",
      "consumerRepos": ["agent", "framework"],
      "changeDetection": "hash",
      "onBreakingChange": {
        "severity": "critical",
        "syncSteps": [
          "Regenerate TypeScript client: npm run generate:api",
          "Update request/response types",
          "Run integration tests"
        ]
      }
    }
  ]
}
```

### CI/CD Integration

Export validation command for pre-commit hooks:

```bash
# .git/hooks/pre-commit
node .gemini/antigravity/skills/repo-dependency-analysis/scripts/detect-ripple-effects.js --strict
if [ $? -ne 0 ]; then
  echo "❌ Breaking changes detected. Sync other repos first."
  exit 1
fi
```

## Limitations

- **Static analysis only**: Does not execute code or tests
- **Known patterns**: Requires explicit configuration for custom dependency types
- **Local filesystem**: Cannot analyze remote repos (must be cloned locally)
- **No version control**: Does not integrate with git history (future enhancement)

## Error Handling

**Config not found**: Prompt for initial setup
**Repo path invalid**: Skip repo and warn user
**Parse error**: Log file path and continue
**No connections found**: Suggest checking repo paths or dependency types

## See Also

- [Dependency Types Reference](./references/dependency-types.md) - Supported patterns
- [Analysis Script](./scripts/analyze-repos.js) - Core dependency scanner
- [Impact Detector](./scripts/detect-ripple-effects.js) - Change analysis
