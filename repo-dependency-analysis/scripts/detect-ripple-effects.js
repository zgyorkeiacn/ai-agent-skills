#!/usr/bin/env node
/**
 * Ripple Effect Detector
 * Compares current workspace against baseline to detect breaking changes.
 * Accepts an optional --diff-file snapshot for targeted symbol-level analysis.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function resolveMapPath(arg) {
  return arg || path.join(os.homedir(), '.claude', 'repo-dependency-cache', 'repo-map.json');
}

function loadRepoMap(mapPath) {
  const resolved = resolveMapPath(mapPath);
  if (!fs.existsSync(resolved)) {
    console.error('No analysis found. Run analyze-repos.js setup first.');
    console.error(`Expected map at: ${resolved}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

// ── DIFF SNAPSHOT PARSING ─────────────────────────────────────────────────────

function parseDiffSnapshot(snapshotPath) {
  try {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const contracts = extractContracts(snap.changedFiles || [], snap.rawDiff || '');
    return {
      changedFiles: snap.changedFiles || [],
      contracts,
      rawDiff: snap.rawDiff || '',
      repo: snap.repo,
      repoPath: snap.repoPath
    };
  } catch (err) {
    console.warn(`Warning: Could not parse diff snapshot: ${err.message}`);
    return null;
  }
}

function extractContracts(files, rawDiff) {
  const contracts = {
    npm:           [],
    envVars:       [],
    exports:       [],
    apiEndpoints:  [],
    dockerServices: [],
    changedExports:   extractChangedExports(rawDiff),
    changedEnvKeys:   extractChangedEnvKeys(rawDiff),
    changedVersions:  extractChangedVersions(rawDiff),
    changedEndpoints: extractChangedEndpoints(rawDiff)
  };

  files.forEach(f => {
    if (!f) return;
    const lower = f.toLowerCase();
    if (lower.endsWith('package.json'))                              contracts.npm.push(f);
    if (lower.endsWith('.env.example') || lower.endsWith('.env'))   contracts.envVars.push(f);
    if (/\.(ts|js|mjs)$/.test(lower) && rawDiff.includes('export ')) contracts.exports.push(f);
    if (/openapi\.(json|ya?ml)$/.test(lower) || lower.endsWith('schema.graphql')) contracts.apiEndpoints.push(f);
    if (lower.endsWith('docker-compose.yml') || lower.endsWith('docker-compose.yaml')) contracts.dockerServices.push(f);
  });

  return contracts;
}

function extractChangedExports(rawDiff) {
  const symbols = new Set();
  const re = /^[+-].*\bexport\s+(?:function|class|const|let|var|type|interface|enum|default)\s+(\w+)/gm;
  let m;
  while ((m = re.exec(rawDiff)) !== null) symbols.add(m[1]);
  return [...symbols];
}

function extractChangedEnvKeys(rawDiff) {
  const keys = new Set();
  const re = /^[+-]\s*([A-Z_][A-Z0-9_]{2,})\s*=/gm;
  let m;
  while ((m = re.exec(rawDiff)) !== null) keys.add(m[1]);
  return [...keys];
}

function extractChangedVersions(rawDiff) {
  const versions = [];
  const re = /^[+-]\s*"version"\s*:\s*"([^"]+)"/gm;
  let m;
  while ((m = re.exec(rawDiff)) !== null) versions.push(m[1]);
  return versions;
}

function extractChangedEndpoints(rawDiff) {
  const endpoints = new Set();
  const re = /^[+-]\s*(get|post|put|delete|patch)\s*['"`]?(\/[\w/:{}.-]*)/gim;
  let m;
  while ((m = re.exec(rawDiff)) !== null) endpoints.add(`${m[1].toUpperCase()} ${m[2]}`);
  return [...endpoints];
}

// ── CHANGE DETECTION (git-based fallback) ─────────────────────────────────────

function detectChanges(repoPath) {
  try {
    const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf8' });
    return status.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return { status: parts[0], file: parts.slice(1).join(' ') };
      });
  } catch {
    return [];
  }
}

function detectContractChangesFromFiles(repoPath, files, rawDiff) {
  const contractChanges = [];

  files.forEach(file => {
    if (!file) return;
    const filePath = path.join(repoPath, file);
    const lower = file.toLowerCase();

    if (lower === 'package.json' || lower.endsWith('/package.json')) {
      const changedVersions = extractChangedVersions(rawDiff);
      const detail = changedVersions.length ? ` (versions: ${changedVersions.join(' -> ')})` : '';
      contractChanges.push({ type: 'npm-package', file, severity: 'critical', reason: `Package.json modified${detail}` });
    }

    if (lower === '.env.example' || lower.endsWith('/.env.example')) {
      const changedKeys = extractChangedEnvKeys(rawDiff);
      const detail = changedKeys.length ? `: ${changedKeys.join(', ')}` : '';
      contractChanges.push({ type: 'env-var', file, severity: 'warning', reason: `Environment variables modified${detail}` });
    }

    if (lower === 'docker-compose.yml' || lower.endsWith('/docker-compose.yml')) {
      contractChanges.push({ type: 'docker-service', file, severity: 'warning', reason: 'Docker services modified' });
    }

    if (/\.(ts|js|mjs)$/.test(lower)) {
      const changedExports = extractChangedExports(rawDiff).filter(sym => rawDiff.includes(sym));
      if (changedExports.length || rawDiff.includes('export interface') || rawDiff.includes('export type')) {
        const detail = changedExports.length ? `: ${changedExports.slice(0, 5).join(', ')}` : '';
        contractChanges.push({ type: 'typescript-type', file, severity: 'warning', reason: `Exported symbols modified${detail}` });
      }
    }

    if (/openapi\.(json|ya?ml)$/.test(lower) || lower.endsWith('schema.graphql')) {
      const changedEndpoints = extractChangedEndpoints(rawDiff);
      const detail = changedEndpoints.length ? `: ${changedEndpoints.slice(0, 3).join(', ')}` : '';
      contractChanges.push({ type: 'api-schema', file, severity: 'critical', reason: `API schema modified${detail}` });
    }
  });

  return contractChanges;
}

function detectContractChanges(repoPath, changes) {
  const contractChanges = [];

  changes.forEach(change => {
    const filePath = path.join(repoPath, change.file);

    if (change.file === 'package.json' && fs.existsSync(filePath)) {
      contractChanges.push({ type: 'npm-package', file: change.file, severity: 'critical', reason: 'Package.json modified - may affect dependencies' });
    }

    if (change.file === '.env.example' && fs.existsSync(filePath)) {
      contractChanges.push({ type: 'env-var', file: change.file, severity: 'warning', reason: 'Environment variables modified' });
    }

    if (change.file === 'docker-compose.yml' && fs.existsSync(filePath)) {
      contractChanges.push({ type: 'docker-service', file: change.file, severity: 'warning', reason: 'Docker services modified' });
    }

    if (change.file.endsWith('.ts') && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('export interface') || content.includes('export type')) {
        contractChanges.push({ type: 'typescript-type', file: change.file, severity: 'warning', reason: 'TypeScript interfaces/types modified' });
      }
    }

    if ((change.file.endsWith('openapi.json') || change.file.endsWith('openapi.yaml')) && fs.existsSync(filePath)) {
      contractChanges.push({ type: 'api-schema', file: change.file, severity: 'critical', reason: 'API schema modified' });
    }
  });

  return contractChanges;
}

// ── IMPACT ANALYSIS ───────────────────────────────────────────────────────────

function analyzeImpact(repoMap, changedRepo, contractChanges) {
  const impacts = [];

  const outgoingConnections = repoMap.connections.filter(c => c.from === changedRepo);

  outgoingConnections.forEach(conn => {
    const relevantChanges = contractChanges.filter(change => {
      if (conn.type === 'npm-file'       && change.type === 'npm-package')    return true;
      if (conn.type === 'env-var-shared' && change.type === 'env-var')        return true;
      if (conn.type === 'docker-service' && change.type === 'docker-service') return true;
      return false;
    });

    if (relevantChanges.length > 0) {
      const maxSeverity = relevantChanges.some(c => c.severity === 'critical') ? 'CRITICAL' : 'WARNING';
      impacts.push({
        affectedRepo:   conn.to,
        connectionType: conn.type,
        contract:       conn.contract,
        severity:       maxSeverity,
        changes:        relevantChanges,
        syncSteps:      generateSyncSteps(conn, relevantChanges)
      });
    }
  });

  return impacts;
}

function generateSyncSteps(connection, changes) {
  const steps = [];

  if (connection.type === 'npm-file') {
    steps.push(`Review changes in ${connection.contract} package`);
    steps.push(`Run: npm install in ${connection.to}`);
    steps.push(`Test integration with updated package`);
    steps.push(`Run: npm run typecheck`);
  } else if (connection.type === 'env-var-shared') {
    steps.push(`Update .env.example in ${connection.to}`);
    steps.push(`Update code references to ${connection.contract}`);
    steps.push(`Update documentation if variable renamed`);
  } else if (connection.type === 'docker-service') {
    steps.push(`Review docker-compose.yml changes`);
    steps.push(`Update service dependencies if needed`);
    steps.push(`Run: docker-compose config to validate`);
    steps.push(`Run: docker-compose up to test`);
  }

  return steps;
}

function printImpactReport(impacts, changedRepo, diffSummary) {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Ripple Effect Analysis');
  console.log('='.repeat(60));
  console.log('');

  if (diffSummary) {
    console.log('  Changed files analyzed:');
    diffSummary.changedFiles.slice(0, 10).forEach(f => console.log(`    - ${f}`));
    if (diffSummary.changedFiles.length > 10) console.log(`    ... and ${diffSummary.changedFiles.length - 10} more`);
    if (diffSummary.contracts.changedExports.length)   console.log(`  Changed exports:   ${diffSummary.contracts.changedExports.join(', ')}`);
    if (diffSummary.contracts.changedEnvKeys.length)   console.log(`  Changed env keys:  ${diffSummary.contracts.changedEnvKeys.join(', ')}`);
    if (diffSummary.contracts.changedEndpoints.length) console.log(`  Changed endpoints: ${diffSummary.contracts.changedEndpoints.join(', ')}`);
    console.log('');
  }

  if (impacts.length === 0) {
    console.log('  No ripple effects detected');
    console.log('');
    console.log('  Your changes appear to be internal to this repository.');
    console.log('  No downstream dependencies are affected.');
    return;
  }

  console.log(`  Potential Impact on ${impacts.length} Repositor${impacts.length > 1 ? 'ies' : 'y'}`);
  console.log('');

  impacts.forEach((impact, i) => {
    console.log(`  ${i + 1}. ${impact.affectedRepo.toUpperCase()}`);
    console.log(`     ${'─'.repeat(50)}`);
    console.log(`     Connection: ${impact.contract} (${impact.connectionType})`);
    console.log(`     Severity:   ${impact.severity === 'CRITICAL' ? '[CRITICAL]' : '[WARNING]'} ${impact.severity}`);
    console.log('');
    console.log('     Changed Files:');
    impact.changes.forEach(change => {
      console.log(`       - ${change.file} (${change.reason})`);
    });
    console.log('');
    console.log('     Recommended Sync Steps:');
    impact.syncSteps.forEach((step, idx) => {
      console.log(`       ${idx + 1}. ${step}`);
    });
    console.log('');
  });

  console.log('='.repeat(60));
  console.log('');
  console.log('  Next Steps:');
  console.log('    1. Complete changes in this repository');
  console.log('    2. Commit and push');
  console.log('    3. Update affected repositories following sync steps above');
  console.log('    4. Test each repository independently');
  console.log('    5. Run integration tests if available');
  console.log('');
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  // Parse flags
  const mapFlagIdx      = args.indexOf('--map');
  const mapPath         = mapFlagIdx      >= 0 ? args[mapFlagIdx      + 1] : null;
  const diffFlagIdx     = args.indexOf('--diff-file');
  const diffFilePath    = diffFlagIdx     >= 0 ? args[diffFlagIdx     + 1] : null;
  const strictMode      = args.includes('--strict');

  // Positional args (strip flags and their values)
  const positional = args.filter((a, i) =>
    !['--map', '--diff-file'].includes(a) &&
    args[i - 1] !== '--map' && args[i - 1] !== '--diff-file' &&
    a !== '--strict'
  );

  const repoMap = loadRepoMap(mapPath);

  // Determine target repository
  let targetRepo  = positional[0];
  let diffSummary = null;

  // Load diff snapshot if provided
  if (diffFilePath && fs.existsSync(diffFilePath)) {
    diffSummary = parseDiffSnapshot(diffFilePath);
    if (diffSummary && !targetRepo) {
      // Auto-resolve from snapshot
      const repo = repoMap.repositories.find(r =>
        diffSummary.repoPath && r.path && diffSummary.repoPath.startsWith(r.path)
      );
      if (repo) targetRepo = repo.name;
    }
  }

  if (!targetRepo) {
    // Fall back to cwd detection
    const cwd = process.cwd();
    const repo = repoMap.repositories.find(r => cwd.startsWith(r.path));
    if (repo) {
      targetRepo = repo.name;
    } else {
      console.error('Could not determine repository. Provide repo name as argument or use --diff-file.');
      process.exit(1);
    }
  }

  const repo = repoMap.repositories.find(r => r.name === targetRepo);
  if (!repo) {
    console.error(`Repository "${targetRepo}" not found in analysis.`);
    console.error(`Known repositories: ${repoMap.repositories.map(r => r.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`Checking ripple effects for: ${targetRepo}`);
  console.log(`Repository path: ${repo.path}`);

  let contractChanges;

  if (diffSummary) {
    // Use snapshot data - no git calls needed
    console.log(`Using diff snapshot: ${diffSummary.changedFiles.length} changed file(s) identified`);
    contractChanges = detectContractChangesFromFiles(repo.path, diffSummary.changedFiles, diffSummary.rawDiff);
  } else {
    // Fall back to live git status
    const changes = detectChanges(repo.path);
    if (changes.length === 0) {
      console.log('');
      console.log('  No uncommitted changes detected');
      console.log('');
      process.exit(0);
    }
    console.log(`Found ${changes.length} changed file(s)`);
    contractChanges = detectContractChanges(repo.path, changes);
  }

  if (contractChanges.length === 0) {
    console.log('');
    console.log('  No contract changes detected');
    console.log('');
    console.log('  Changed files do not appear to affect shared interfaces.');
    process.exit(0);
  }

  console.log(`Detected ${contractChanges.length} contract change(s)`);

  const impacts = analyzeImpact(repoMap, targetRepo, contractChanges);
  printImpactReport(impacts, targetRepo, diffSummary);

  const hasBlockingImpacts = impacts.some(i => i.severity === 'CRITICAL');
  process.exit(hasBlockingImpacts && strictMode ? 1 : 0);
}

module.exports = { analyzeImpact, detectChanges, detectContractChanges, parseDiffSnapshot, extractContracts };
