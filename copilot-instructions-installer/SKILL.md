---
name: copilot-instructions-installer
description: Installs optimized GitHub Copilot instructions (.github/copilot-instructions.md) into the current workspace. These instructions enforce token efficiency, surgical code diffs, and strict scoping rules to reduce API costs and improve code quality.
---

# Copilot Instructions Installer Skill

## When to Apply

- When starting a new project that will use GitHub Copilot
- When you want to enforce strict token-efficiency rules across the team
- When code reviews show excessive AI-generated boilerplate or fluff
- When you need consistent, diff-based code outputs instead of full rewrites

## What This Skill Does

Installs a production-grade `copilot-instructions.md` file into the `.github` folder of your current workspace. This file configures GitHub Copilot Chat to:

1. **Eliminate token waste** - No conversational filler, pleasantries, or transitions
2. **Output surgical diffs only** - Git-style diff blocks instead of full file rewrites
3. **Enforce strict scoping** - No unnecessary directory scanning or context bloat
4. **Disable autonomous loops** - Hard iteration caps to prevent runaway API usage
5. **Require syntax verification** - Mental syntax checks before output

## Installation

### Automatic (Cross-Platform)

Run the installer script from the skill directory:

```bash
# From c:\newgit\skills\copilot-instructions-installer
node install.js
```

The script will:
1. Detect your current VS Code workspace root
2. Create `.github` folder if it doesn't exist
3. Copy `copilot-instructions.md` to `.github/`
4. Prompt you to reload the VS Code window to activate the instructions

### Manual Installation

If you prefer manual installation:

1. Copy `templates/copilot-instructions.md` from this skill folder
2. Paste it into `.github/copilot-instructions.md` in your project root
3. Reload VS Code window (Cmd/Ctrl+Shift+P → "Developer: Reload Window")

## Verification

After installation and window reload:

1. Open GitHub Copilot Chat
2. Ask: "What are your current token efficiency rules?"
3. Copilot should reference the instructions and summarize the rules

## What's Included

The installed instructions enforce:

### Token Efficiency Rules
- Direct answers only, no filler
- Tables for structured data
- Hyphen (`-`) instead of em-dash (`-`)
- No prompt repetition

### Code Output Rules
- Git-style unified diffs only
- No unchanged boilerplate
- No lengthy comments or JSDoc blocks
- Mental syntax checks required

### Scoping Rules
- Explicit file paths only
- Ignore unrelated tabs
- Skip lockfiles and generated code
- No autonomous web retrieval

### Autonomous Agent Restrictions
- 3-iteration hard cap
- No automated debug loops
- No blanket refactoring
- Require specific targets

## Customization

After installation, edit `.github/copilot-instructions.md` to:
- Add project-specific commands (e.g., `npm run typecheck`)
- Add custom architectural guidelines
- Add repo-specific file paths to reference (e.g., `AGENT_MODULE_INDEX.md`)
- Adjust iteration caps or scoping rules

## Team Usage

Commit `.github/copilot-instructions.md` to your repository. All team members with GitHub Copilot will automatically inherit these rules when they open the project.

## Compatibility

- **VS Code**: ✅ Fully supported (GitHub Copilot reads `.github/copilot-instructions.md`)
- **GitHub.com**: ✅ Supported in PR comments and Copilot Workspace
- **JetBrains**: ⚠️ Partial support (check IDE documentation)
- **Cross-platform**: ✅ Works on Windows, macOS, Linux

## Uninstallation

To remove the instructions:

```bash
rm .github/copilot-instructions.md
```

Then reload VS Code window.

---

## Why This Matters

**Cost Savings**: Reducing token waste by 30-50% can significantly lower GitHub Copilot API costs for large teams.

**Code Quality**: Diff-based outputs prevent accidental overwrites and make code reviews easier.

**Consistency**: Team-wide instructions ensure all developers get the same quality of AI assistance.

**Safety**: Hard iteration caps prevent runaway autonomous agents from burning through API quotas.
