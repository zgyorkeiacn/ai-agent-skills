#!/usr/bin/env node
/**
 * Ripple Effect Detector
 * Compares current workspace against baseline to detect breaking changes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CACHE_DIR = path.join(__dirname, '..', '.analysis-cache');

function loadRepoMap() {
  const mapPath = path.join(CACHE_DIR, 'repo-map.json');
  if (!fs.existsSync(mapPath)) {
    console.error('❌ No analysis found. Run analyze-repos.js setup first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
}

function detectChanges(repoPath) {
  try {
    const status = execSync('git status --porcelain', { 
      cwd: repoPath,
      encoding: 'utf8'
    });
    
    return status.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return { 
          status: parts[0], 
          file: parts.slice(1).join(' ')
        };
      });
  } catch (err) {
    // Not a git repo or no git installed
    return [];
  }
}

function detectContractChanges(repoPath, changes) {
  const contractChanges = [];
  
  changes.forEach(change => {
    const filePath = path.join(repoPath, change.file);
    
    // Check for package.json changes
    if (change.file === 'package.json' && fs.existsSync(filePath)) {
      contractChanges.push({
        type: 'npm-package',
        file: change.file,
        severity: 'critical',
        reason: 'Package.json modified - may affect dependencies'
      });
    }
    
    // Check for .env.example changes
    if (change.file === '.env.example' && fs.existsSync(filePath)) {
      contractChanges.push({
        type: 'env-var',
        file: change.file,
        severity: 'warning',
        reason: 'Environment variables modified'
      });
    }
    
    // Check for docker-compose.yml changes
    if (change.file === 'docker-compose.yml' && fs.existsSync(filePath)) {
      contractChanges.push({
        type: 'docker-service',
        file: change.file,
        severity: 'warning',
        reason: 'Docker services modified'
      });
    }
    
    // Check for TypeScript interface changes
    if (change.file.endsWith('.ts') && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('export interface') || content.includes('export type')) {
        contractChanges.push({
          type: 'typescript-type',
          file: change.file,
          severity: 'warning',
          reason: 'TypeScript interfaces/types modified'
        });
      }
    }
    
    // Check for OpenAPI spec changes
    if ((change.file.endsWith('openapi.json') || change.file.endsWith('openapi.yaml')) 
        && fs.existsSync(filePath)) {
      contractChanges.push({
        type: 'api-schema',
        file: change.file,
        severity: 'critical',
        reason: 'API schema modified'
      });
    }
  });
  
  return contractChanges;
}

function analyzeImpact(repoMap, changedRepo, contractChanges) {
  const impacts = [];
  
  // Find connections where changedRepo is the provider
  const outgoingConnections = repoMap.connections.filter(c => c.from === changedRepo);
  
  outgoingConnections.forEach(conn => {
    // Check if any contract changes affect this connection
    const relevantChanges = contractChanges.filter(change => {
      if (conn.type === 'npm-file' && change.type === 'npm-package') return true;
      if (conn.type === 'env-var-shared' && change.type === 'env-var') return true;
      if (conn.type === 'docker-service' && change.type === 'docker-service') return true;
      return false;
    });
    
    if (relevantChanges.length > 0) {
      const maxSeverity = relevantChanges.some(c => c.severity === 'critical') ? 'CRITICAL' : 'WARNING';
      
      impacts.push({
        affectedRepo: conn.to,
        connectionType: conn.type,
        contract: conn.contract,
        severity: maxSeverity,
        changes: relevantChanges,
        syncSteps: generateSyncSteps(conn, relevantChanges)
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

function printImpactReport(impacts, changedRepo) {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Ripple Effect Analysis');
  console.log('='.repeat(60));
  console.log('');
  
  if (impacts.length === 0) {
    console.log('✅ No ripple effects detected');
    console.log('');
    console.log('Your changes appear to be internal to this repository.');
    console.log('No downstream dependencies are affected.');
    return;
  }
  
  console.log(`⚠️  Potential Impact on ${impacts.length} Repositor${impacts.length > 1 ? 'ies' : 'y'}`);
  console.log('');
  
  impacts.forEach((impact, i) => {
    console.log(`${i + 1}. ${impact.affectedRepo.toUpperCase()}`);
    console.log(`   ${'─'.repeat(50)}`);
    console.log(`   Connection: ${impact.contract} (${impact.connectionType})`);
    console.log(`   Severity:   ${impact.severity === 'CRITICAL' ? '🔴' : '🟡'} ${impact.severity}`);
    console.log('');
    console.log('   Changed Files:');
    impact.changes.forEach(change => {
      console.log(`     - ${change.file} (${change.reason})`);
    });
    console.log('');
    console.log('   Recommended Sync Steps:');
    impact.syncSteps.forEach((step, idx) => {
      console.log(`     ${idx + 1}. ${step}`);
    });
    console.log('');
  });
  
  console.log('='.repeat(60));
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Complete changes in this repository');
  console.log('  2. Commit and push');
  console.log('  3. Update affected repositories following sync steps above');
  console.log('  4. Test each repository independently');
  console.log('  5. Run integration tests if available');
  console.log('');
}

// CLI entry point
if (require.main === module) {
  const repoMap = loadRepoMap();
  const args = process.argv.slice(2);
  
  // Determine target repository
  let targetRepo = args[0];
  if (!targetRepo) {
    // Try to detect from current directory
    const cwd = process.cwd();
    const repo = repoMap.repositories.find(r => cwd.startsWith(r.path));
    if (repo) {
      targetRepo = repo.name;
    } else {
      console.error('Could not determine repository. Provide repo name as argument.');
      process.exit(1);
    }
  }
  
  // Find repo in map
  const repo = repoMap.repositories.find(r => r.name === targetRepo);
  if (!repo) {
    console.error(`Repository "${targetRepo}" not found in analysis.`);
    console.error(`Known repositories: ${repoMap.repositories.map(r => r.name).join(', ')}`);
    process.exit(1);
  }
  
  console.log(`Checking ripple effects for: ${targetRepo}`);
  console.log(`Repository path: ${repo.path}`);
  
  // Detect changes in the repository
  const changes = detectChanges(repo.path);
  
  if (changes.length === 0) {
    console.log('');
    console.log('✅ No uncommitted changes detected');
    console.log('');
    process.exit(0);
  }
  
  console.log(`Found ${changes.length} changed file(s)`);
  
  // Detect contract changes
  const contractChanges = detectContractChanges(repo.path, changes);
  
  if (contractChanges.length === 0) {
    console.log('');
    console.log('✅ No contract changes detected');
    console.log('');
    console.log('Changed files do not appear to affect shared interfaces.');
    process.exit(0);
  }
  
  console.log(`Detected ${contractChanges.length} contract change(s)`);
  
  // Analyze impact
  const impacts = analyzeImpact(repoMap, targetRepo, contractChanges);
  
  // Print report
  printImpactReport(impacts, targetRepo);
  
  // Exit with error code if impacts found (for CI/CD integration)
  const hasBlockingImpacts = impacts.some(i => i.severity === 'CRITICAL');
  process.exit(hasBlockingImpacts && args.includes('--strict') ? 1 : 0);
}

module.exports = { analyzeImpact, detectChanges, detectContractChanges };
