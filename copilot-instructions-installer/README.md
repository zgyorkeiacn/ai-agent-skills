# Copilot Instructions Installer

**Standalone tool** - no installation or git required. Just run with Node.js.

Hyper-lightweight cross-platform installer for GitHub Copilot optimization instructions.

## Quick Start

```bash
# Navigate to this folder
cd copilot-instructions-installer

# Run the installer
node install.js
```

Follow the prompts, then reload VS Code window to activate.

**No dependencies required** - works with native Node.js (v12+) on any platform.

## What It Does

Installs `.github/copilot-instructions.md` into your current workspace with rules that:

- **Cut token waste by 30-50%** - No conversational fluff
- **Enforce diff-based outputs** - Git-style diffs instead of full rewrites  
- **Prevent autonomous loops** - Hard iteration caps
- **Require syntax checks** - Mental validation before output

## Installation Options

### Option 1: Auto-install to current directory
```bash
node install.js
```

### Option 2: Specify target directory
```bash
node install.js /path/to/your/project
```

### Option 3: Manual copy
Copy `templates/copilot-instructions.md` to your project's `.github/` folder.

## After Installation

1. **Reload VS Code**: Cmd/Ctrl+Shift+P → "Developer: Reload Window"
2. **Verify**: Ask Copilot "What are your current token efficiency rules?"
3. **Customize**: Edit `.github/copilot-instructions.md` for project-specific rules

## Compatibility

- ✅ **Windows** (PowerShell, CMD, Git Bash)
- ✅ **macOS** (Terminal, iTerm)
- ✅ **Linux** (Bash, Zsh)
- ✅ **Node.js** 12+ (natively available on all platforms)

## Team Usage

Commit `.github/copilot-instructions.md` to your repo. All team members with GitHub Copilot will automatically inherit these rules.

## Uninstall

```bash
rm .github/copilot-instructions.md
```

Then reload VS Code window.

---

See [SKILL.md](SKILL.md) for detailed documentation.
