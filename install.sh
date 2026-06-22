#!/bin/bash
# AI Agent Skills Installer for Linux/Mac
# Automatically symlinks skills to AI agent directories

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}✓ $1${NC}"; }
info() { echo -e "${CYAN}ℹ $1${NC}"; }
warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
error() { echo -e "${RED}✗ $1${NC}"; }

# Parse arguments
UNINSTALL=false
SCOPE="user"
REPO_PATH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --uninstall)
            UNINSTALL=true
            shift
            ;;
        --scope)
            SCOPE="$2"
            shift 2
            ;;
        --repo-path)
            REPO_PATH="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--uninstall] [--scope user|repo] [--repo-path /path/to/repo]"
            exit 1
            ;;
    esac
done

# Get the absolute path to this script's directory
SKILLS_REPO_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${MAGENTA}═══════════════════════════════════════════════${NC}"
echo -e "${MAGENTA}  AI Agent Skills Installer${NC}"
echo -e "${MAGENTA}═══════════════════════════════════════════════${NC}"
echo ""

# Detect available skills (exclude standalone skills)
EXCLUDE_SKILLS=("copilot-instructions-installer")
SKILLS=()
for dir in "$SKILLS_REPO_PATH"/*; do
    if [[ -d "$dir" && -f "$dir/SKILL.md" ]]; then
        skill_name="$(basename "$dir")"
        # Check if skill is in exclude list
        if [[ ! " ${EXCLUDE_SKILLS[@]} " =~ " ${skill_name} " ]]; then
            SKILLS+=("$skill_name")
        fi
    fi
done

if [[ ${#SKILLS[@]} -eq 0 ]]; then
    error "No skills found in $SKILLS_REPO_PATH"
    exit 1
fi

info "Found ${#SKILLS[@]} skill(s): ${SKILLS[*]}"
echo ""

# Detect AI agent systems
declare -A AGENT_SYSTEMS

# GitHub Copilot
COPILOT_PATHS=()
if [[ "$SCOPE" == "user" ]]; then
    COPILOT_PATHS+=("$HOME/.copilot/skills")
fi
if [[ "$SCOPE" == "repo" && -n "$REPO_PATH" ]]; then
    COPILOT_PATHS+=("$REPO_PATH/.copilot/skills")
fi
for path in "${COPILOT_PATHS[@]}"; do
    parent="$(dirname "$path")"
    if [[ -d "$parent" ]]; then
        AGENT_SYSTEMS["GitHub Copilot"]+="$path "
    fi
done

# Gemini Antigravity
GEMINI_PATHS=()
if [[ "$SCOPE" == "user" ]]; then
    GEMINI_PATHS+=("$HOME/.gemini/antigravity/skills")
fi
if [[ "$SCOPE" == "repo" && -n "$REPO_PATH" ]]; then
    GEMINI_PATHS+=("$REPO_PATH/.gemini/antigravity/skills")
fi
for path in "${GEMINI_PATHS[@]}"; do
    parent="$(dirname "$path")"
    if [[ -d "$parent" ]]; then
        AGENT_SYSTEMS["Gemini Antigravity"]+="$path "
    fi
done

# Claude
CLAUDE_PATHS=()
if [[ "$SCOPE" == "user" ]]; then
    CLAUDE_PATHS+=("$HOME/.claude/skills")
fi
if [[ "$SCOPE" == "repo" && -n "$REPO_PATH" ]]; then
    CLAUDE_PATHS+=("$REPO_PATH/.claude/skills")
fi
for path in "${CLAUDE_PATHS[@]}"; do
    parent="$(dirname "$path")"
    if [[ -d "$parent" ]]; then
        AGENT_SYSTEMS["Claude"]+="$path "
    fi
done

if [[ ${#AGENT_SYSTEMS[@]} -eq 0 ]]; then
    warning "No AI agent systems detected."
    info "Supported locations:"
    echo "  - $HOME/.copilot/skills"
    echo "  - $HOME/.gemini/antigravity/skills"
    echo "  - $HOME/.claude/skills"
    echo ""
    info "To create directories manually:"
    echo '  mkdir -p "$HOME/.copilot/skills"'
    echo ""
    exit 1
fi

info "Detected AI systems: ${!AGENT_SYSTEMS[*]}"
echo ""

# Uninstall mode
if [[ "$UNINSTALL" == true ]]; then
    echo -e "${YELLOW}UNINSTALLING skills...${NC}"
    echo ""
    
    removed=0
    for system in "${!AGENT_SYSTEMS[@]}"; do
        for base_path in ${AGENT_SYSTEMS[$system]}; do
            if [[ ! -d "$base_path" ]]; then
                continue
            fi
            
            for skill in "${SKILLS[@]}"; do
                link_path="$base_path/$skill"
                if [[ -L "$link_path" ]]; then
                    rm "$link_path"
                    success "Removed $system: $skill"
                    ((removed++))
                fi
            done
        done
    done
    
    echo ""
    if [[ $removed -gt 0 ]]; then
        success "Uninstalled $removed symlink(s)"
    else
        info "No symlinks found to remove"
    fi
    exit 0
fi

# Install mode
echo -e "${GREEN}INSTALLING skills...${NC}"
echo ""

installed=0
for system in "${!AGENT_SYSTEMS[@]}"; do
    for base_path in ${AGENT_SYSTEMS[$system]}; do
        # Create base directory if needed
        if [[ ! -d "$base_path" ]]; then
            mkdir -p "$base_path"
            info "Created directory: $base_path"
        fi
        
        for skill in "${SKILLS[@]}"; do
            source_path="$SKILLS_REPO_PATH/$skill"
            link_path="$base_path/$skill"
            
            # Remove existing symlink/directory
            if [[ -L "$link_path" ]]; then
                rm "$link_path"
                info "Removed existing symlink: $link_path"
            elif [[ -d "$link_path" ]]; then
                warning "Skipping $link_path (not a symlink)"
                continue
            fi
            
            # Create symlink
            ln -s "$source_path" "$link_path"
            success "$system: $skill"
            ((installed++))
        done
    done
done

echo ""
echo -e "${MAGENTA}═══════════════════════════════════════════════${NC}"
success "Installation complete! ($installed symlink(s) created)"
echo -e "${MAGENTA}═══════════════════════════════════════════════${NC}"
echo ""

# Verification
info "Verification:"
for system in "${!AGENT_SYSTEMS[@]}"; do
    for base_path in ${AGENT_SYSTEMS[$system]}; do
        if [[ -d "$base_path" ]]; then
            echo -e "  ${CYAN}$system:${NC}"
            for item in "$base_path"/*; do
                if [[ -L "$item" ]]; then
                    target="$(readlink "$item")"
                    echo -e "    - $(basename "$item") -> $target"
                fi
            done
        fi
    done
done

echo ""
info "Skills are now available in your AI agent!"
echo ""
info "Usage examples:"
echo -e "  ${NC}@workspace /repo-dependency-analysis${NC}"
echo -e "  ${NC}@antigravity /repo-dependency-analysis${NC}"
echo ""
