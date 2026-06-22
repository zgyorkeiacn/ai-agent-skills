#!/usr/bin/env node

/**
 * Copilot Instructions Installer
 * Cross-platform script to install optimized GitHub Copilot instructions
 * 
 * Usage: node install.js [target-directory]
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function detectWorkspaceRoot() {
  // Try to detect workspace root from environment variables or use current directory
  const possibleRoots = [
    process.env.VSCODE_WORKSPACE_FOLDER,
    process.env.PWD,
    process.cwd(),
  ];

  for (const root of possibleRoots) {
    if (root && fs.existsSync(root)) {
      return root;
    }
  }

  return process.cwd();
}

function main() {
  const args = process.argv.slice(2);
  const targetDir = args[0] || detectWorkspaceRoot();

  log('========================================', colors.cyan);
  log('  Copilot Instructions Installer', colors.cyan);
  log('========================================', colors.cyan);
  log('');

  // Resolve paths
  const skillDir = __dirname;
  const templatePath = path.join(skillDir, 'templates', 'copilot-instructions.md');
  const githubDir = path.join(targetDir, '.github');
  const targetPath = path.join(githubDir, 'copilot-instructions.md');

  log(`Target directory: ${targetDir}`, colors.cyan);
  log('');

  // Verify template exists
  if (!fs.existsSync(templatePath)) {
    log(`[ERROR] Template file not found: ${templatePath}`, colors.red);
    log('', colors.reset);
    log('Please ensure you are running this script from the skill directory.', colors.yellow);
    process.exit(1);
  }

  // Create .github directory if it doesn't exist
  if (!fs.existsSync(githubDir)) {
    log('[1/3] Creating .github directory...', colors.green);
    fs.mkdirSync(githubDir, { recursive: true });
    log('  [OK] Created .github folder', colors.green);
  } else {
    log('[1/3] .github directory exists', colors.green);
  }

  log('');

  // Check if file already exists
  if (fs.existsSync(targetPath)) {
    log('[2/3] File already exists', colors.yellow);
    log(`  ${targetPath}`, colors.yellow);
    log('');
    log('Overwrite? (y/n): ', colors.yellow);
    
    // Simple synchronous prompt (works cross-platform)
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data) => {
      const answer = data.toString().trim().toLowerCase();
      
      if (answer === 'y' || answer === 'yes') {
        copyFile(templatePath, targetPath);
      } else {
        log('Installation cancelled.', colors.yellow);
        process.exit(0);
      }
    });
    
    return;
  }

  // Copy file
  copyFile(templatePath, targetPath);
}

function copyFile(source, destination) {
  log('[2/3] Copying copilot-instructions.md...', colors.green);
  
  try {
    const content = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(destination, content, 'utf8');
    log('  [OK] File copied successfully', colors.green);
  } catch (error) {
    log(`[ERROR] Failed to copy file: ${error.message}`, colors.red);
    process.exit(1);
  }

  log('');
  log('[3/3] Activation required', colors.cyan);
  log('');
  log('To activate the instructions in VS Code:', colors.cyan);
  log('  1. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)', colors.cyan);
  log('  2. Type "Developer: Reload Window"', colors.cyan);
  log('  3. Press Enter', colors.cyan);
  log('');
  log('========================================', colors.green);
  log('  Installation complete!', colors.green);
  log('========================================', colors.green);
  log('');
  log('File location:', colors.cyan);
  log(`  ${destination}`, colors.cyan);
  log('');
  log('Verification:', colors.cyan);
  log('  1. Open GitHub Copilot Chat', colors.cyan);
  log('  2. Ask: "What are your current token efficiency rules?"', colors.cyan);
  log('  3. Copilot should reference the installed instructions', colors.cyan);
  log('');
  
  process.exit(0);
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  log('', colors.reset);
  log('Installation cancelled.', colors.yellow);
  process.exit(0);
});

main();
