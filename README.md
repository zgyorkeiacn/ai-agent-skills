# AI Agent Skills Collection

Reusable skills for AI coding agents (GitHub Copilot, Gemini, Claude, etc.) to enhance development workflows.

## 📦 Skills Included

### 🔗 repo-dependency-analysis
Analyze and track dependencies between interconnected code repositories. Detects ripple effects when changes are made to shared contracts, APIs, types, or configurations.

**Key Features:**
- Scans npm file: dependencies, Maven system paths, Docker services, env vars, OpenAPI schemas, TypeScript types
- Generates dependency graph and impact reports
- Warns about breaking changes before commits
- Suggests sync steps across affected repos

[📖 Full Documentation](repo-dependency-analysis/README.md)

### 🤝 agent-handoff
Structured templates for handing off work between AI agents or human developers.

**Use Cases:**
- Context preservation across sessions
- Clear communication between agents
- Standardized task documentation

[📖 Full Documentation](agent-handoff/SKILL.md)

### ⚡ copilot-instructions-installer (Standalone Tool)
Installs optimized GitHub Copilot instructions to enforce token efficiency and code quality.

**This is a standalone tool** - run directly, no installation needed:
```bash
cd copilot-instructions-installer
node install.js
```

**Key Features:**
- Cuts token waste by 30-50%
- Enforces diff-based code outputs
- Prevents autonomous loops
- Cross-platform (Windows/Mac/Linux)

[📖 Full Documentation](copilot-instructions-installer/README.md)

---

## 🚀 Quick Start

### Automatic Installation (Recommended)

**Standalone Installation:**

**Windows (PowerShell):**
```powershell
git clone https://github.com/zgyorkei/ai-agent-skills.git
cd ai-agent-skills
.\install.ps1
```

**Linux/Mac:**
```bash
git clone https://github.com/zgyorkei/ai-agent-skills.git
cd ai-agent-skills
chmod +x install.sh
./install.sh
```

**As Part of Gherkin Sandbox:**

If you cloned [gherkin-sandbox](https://github.com/zgyorkei/gherkin-sandbox), the skills are already included as a submodule:

```powershell
# Clone with submodules
git clone --recursive https://github.com/zgyorkei/gherkin-sandbox.git
cd gherkin-sandbox

# Run setup wizard and select option 7
.\setup-wizard.ps1
```

The installer will:
1. Detect your AI agent system(s)
2. Create symlinks to the appropriate locations
3. Verify installation

### Manual Installation

#### GitHub Copilot (VS Code)
```bash
# User-level (all workspaces)
ln -s /path/to/ai-agent-skills/repo-dependency-analysis ~/.copilot/skills/
ln -s /path/to/ai-agent-skills/agent-handoff ~/.copilot/skills/

# Repository-level (single workspace)
ln -s /path/to/ai-agent-skills/repo-dependency-analysis /path/to/workspace/.copilot/skills/
```

#### Gemini (Antigravity)
```bash
ln -s /path/to/ai-agent-skills/repo-dependency-analysis ~/.gemini/antigravity/skills/
ln -s /path/to/ai-agent-skills/agent-handoff ~/.gemini/antigravity/skills/
```

#### Claude (Windsurf, Claude Desktop)
```bash
ln -s /path/to/ai-agent-skills/repo-dependency-analysis ~/.claude/skills/
ln -s /path/to/ai-agent-skills/agent-handoff ~/.claude/skills/
```

---

## 📚 Usage

Once installed, skills are automatically available in your AI agent conversations:

**GitHub Copilot:**
```
@workspace /repo-dependency-analysis
```

**Gemini:**
```
@antigravity /repo-dependency-analysis
```

**Claude:**
```
Use the repo-dependency-analysis skill to check my changes
```

---

## 🛠️ Development

### Adding a New Skill

1. Create a new directory: `my-skill/`
2. Add `SKILL.md` with YAML frontmatter:
   ```markdown
   ---
   name: my-skill
   description: Brief description
   user-invocable: true
   ---
   
   # Skill Instructions
   
   Detailed workflow and examples...
   ```
3. Run installer to symlink the new skill

### Skill Structure

```
my-skill/
├── SKILL.md           # Main skill definition (required)
├── README.md          # User documentation (recommended)
├── scripts/           # Automation scripts (optional)
├── templates/         # Reusable templates (optional)
└── references/        # Documentation, examples (optional)
```

### Testing

After installation, verify the skill is loaded:

**VS Code Copilot:**
- Open Command Palette (Ctrl+Shift+P)
- Type "Copilot: List Available Skills"

**Terminal:**
```bash
# Check symlinks
ls -la ~/.copilot/skills/
ls -la ~/.gemini/antigravity/skills/
```

---

## 🔄 Updates

To update skills to the latest version:

```bash
cd ai-agent-skills
git pull
```

Symlinks will automatically reflect the updates.

---

## 🧹 Uninstallation

**Windows:**
```powershell
.\install.ps1 -Uninstall
```

**Linux/Mac:**
```bash
./install.sh --uninstall
```

Or manually remove symlinks:
```bash
rm ~/.copilot/skills/repo-dependency-analysis
rm ~/.copilot/skills/agent-handoff
# ... repeat for other locations
```

---

## 🤝 Contributing

Found a bug or want to add a skill?

1. Fork this repository
2. Create a feature branch: `git checkout -b my-new-skill`
3. Commit your changes: `git commit -am 'Add my-new-skill'`
4. Push to the branch: `git push origin my-new-skill`
5. Submit a pull request

---

## 📄 License

MIT License - feel free to use, modify, and distribute.

---

## 🔗 Related Projects

- [gherkin-sandbox](https://github.com/zgyorkei/gherkin-sandbox) - Docker-based BDD test generation sandbox
- [copilot-ado-figma-gherkin-agent](https://github.com/zgyorkei/copilot-ado-figma-gherkin-agent) - Transform Azure DevOps + Figma into BDD tests
- [playwright-be-fe-combined-tdd-framework](https://github.com/zgyorkei/playwright-be-fe-combined-tdd-framework) - Polyglot test automation framework

---

## 📧 Support

Issues and questions: [GitHub Issues](https://github.com/zgyorkei/ai-agent-skills/issues)
