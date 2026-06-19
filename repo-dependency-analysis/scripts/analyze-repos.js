#!/usr/bin/env node
/**
 * Cross-Repository Dependency Analyzer
 * Scans multiple interconnected repos and builds dependency graph
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '.analysis-cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Load or initialize configuration
function loadConfig() {
  const configPath = path.join(CACHE_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return null;
}

// Interactive setup (called by AI agent)
function interactiveSetup(repos) {
  console.log('Repository Dependency Analysis - Initial Setup');
  console.log('='.repeat(50));
  
  const config = {
    repositories: repos.map((r, i) => ({
      name: path.basename(r),
      path: r,
      type: 'application', // Will be auto-detected
      primary: i === 0
    })),
    trackDependencies: {
      npm: true,
      maven: true,
      docker: true,
      envVars: true,
      apiSchemas: true,
      typeDefinitions: true
    },
    ignorePatterns: [
      '**/node_modules/**',
      '**/target/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**'
    ]
  };
  
  const configPath = path.join(CACHE_DIR, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`✅ Configuration saved to: ${configPath}`);
  
  return config;
}

// Detect repository type
function detectRepoType(repoPath) {
  if (fs.existsSync(path.join(repoPath, 'docker-compose.yml'))) {
    return 'orchestration';
  }
  if (fs.existsSync(path.join(repoPath, 'pom.xml'))) {
    return 'java';
  }
  if (fs.existsSync(path.join(repoPath, 'package.json'))) {
    return 'node';
  }
  return 'unknown';
}

// Scan package.json for file: dependencies
function scanNpmDependencies(repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = [];
    
    for (const section of ['dependencies', 'devDependencies']) {
      if (pkg[section]) {
        for (const [name, version] of Object.entries(pkg[section])) {
          if (version.startsWith('file:')) {
            deps.push({
              type: 'npm-file',
              name,
              path: version.replace('file:', ''),
              location: 'package.json'
            });
          }
        }
      }
    }
    
    return deps;
  } catch (err) {
    console.warn(`Warning: Failed to parse ${pkgPath}: ${err.message}`);
    return [];
  }
}

// Scan docker-compose.yml for service dependencies
function scanDockerDependencies(repoPath) {
  const composePath = path.join(repoPath, 'docker-compose.yml');
  if (!fs.existsSync(composePath)) return [];
  
  try {
    const content = fs.readFileSync(composePath, 'utf8');
    const deps = [];
    
    // Extract service names
    const serviceMatches = content.match(/^\s+([a-z-]+):/gm);
    if (serviceMatches) {
      serviceMatches.forEach(match => {
        const serviceName = match.trim().replace(':', '');
        deps.push({
          type: 'docker-service',
          name: serviceName,
          location: 'docker-compose.yml'
        });
      });
    }
    
    // Extract depends_on relationships
    const dependsOnRegex = /depends_on:\s*\n\s+-\s+([a-z-]+)/gm;
    let depMatch;
    while ((depMatch = dependsOnRegex.exec(content)) !== null) {
      deps.push({
        type: 'docker-depends',
        name: depMatch[1],
        location: 'docker-compose.yml'
      });
    }
    
    return deps;
  } catch (err) {
    console.warn(`Warning: Failed to parse ${composePath}: ${err.message}`);
    return [];
  }
}

// Scan for environment variable usage
function scanEnvVars(repoPath) {
  const envExamplePath = path.join(repoPath, '.env.example');
  if (!fs.existsSync(envExamplePath)) return [];
  
  try {
    const content = fs.readFileSync(envExamplePath, 'utf8');
    const vars = [];
    
    content.split('\n').forEach(line => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match) {
        vars.push({
          type: 'env-var',
          name: match[1],
          location: '.env.example'
        });
      }
    });
    
    return vars;
  } catch (err) {
    console.warn(`Warning: Failed to parse ${envExamplePath}: ${err.message}`);
    return [];
  }
}

// Main analysis function
function analyzeRepositories(config) {
  console.log('Analyzing repositories...');
  console.log('');
  
  const repoMap = {
    repositories: [],
    connections: [],
    timestamp: new Date().toISOString()
  };
  
  // Scan each repository
  for (const repo of config.repositories) {
    if (!fs.existsSync(repo.path)) {
      console.warn(`⚠️  Repository not found: ${repo.path}`);
      continue;
    }
    
    console.log(`📁 Scanning: ${repo.name}`);
    
    const repoData = {
      ...repo,
      type: detectRepoType(repo.path),
      dependencies: []
    };
    
    if (config.trackDependencies.npm) {
      repoData.dependencies.push(...scanNpmDependencies(repo.path));
    }
    if (config.trackDependencies.docker) {
      repoData.dependencies.push(...scanDockerDependencies(repo.path));
    }
    if (config.trackDependencies.envVars) {
      repoData.dependencies.push(...scanEnvVars(repo.path));
    }
    
    console.log(`  Found ${repoData.dependencies.length} dependencies`);
    repoMap.repositories.push(repoData);
  }
  
  console.log('');
  console.log('Building connection graph...');
  
  // Build connection graph
  repoMap.repositories.forEach(repo => {
    repo.dependencies.forEach(dep => {
      if (dep.type === 'npm-file') {
        // Resolve file: path to absolute
        const targetPath = path.resolve(repo.path, dep.path);
        const target = repoMap.repositories.find(r => 
          targetPath.startsWith(r.path)
        );
        
        if (target) {
          repoMap.connections.push({
            from: repo.name,
            to: target.name,
            type: dep.type,
            contract: dep.name,
            location: `${repo.name}/${dep.location}`,
            breakingChangePatterns: ['bin/*', 'exports.*', 'main']
          });
        }
      }
      
      // Cross-reference environment variables
      if (dep.type === 'env-var') {
        const consumers = repoMap.repositories.filter(r => 
          r.name !== repo.name &&
          r.dependencies.some(d => d.type === 'env-var' && d.name === dep.name)
        );
        
        consumers.forEach(consumer => {
          repoMap.connections.push({
            from: repo.name,
            to: consumer.name,
            type: 'env-var-shared',
            contract: dep.name,
            location: '.env.example'
          });
        });
      }
    });
  });
  
  // Save analysis results
  const mapPath = path.join(CACHE_DIR, 'repo-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(repoMap, null, 2));
  console.log(`\n✅ Analysis saved to: ${mapPath}`);
  
  return repoMap;
}

// Generate human-readable report
function generateReport(repoMap) {
  let report = '# Cross-Repository Dependency Analysis\n\n';
  report += `Generated: ${repoMap.timestamp}\n\n`;
  
  report += '## Repository Overview\n\n';
  report += '| Repository | Type | Dependencies |\n';
  report += '|---|---|---|\n';
  repoMap.repositories.forEach(repo => {
    report += `| ${repo.name} | ${repo.type} | ${repo.dependencies.length} |\n`;
  });
  
  report += '\n## Connection Points\n\n';
  
  if (repoMap.connections.length === 0) {
    report += '*No direct connections found between repositories.*\n\n';
    report += 'This could mean:\n';
    report += '- Repositories are independent\n';
    report += '- Connections use patterns not yet detected\n';
    report += '- Custom dependency rules needed\n';
  } else {
    repoMap.connections.forEach((conn, i) => {
      report += `### ${i + 1}. ${conn.from} → ${conn.to}\n\n`;
      report += `**Type:** ${conn.type}\n`;
      report += `**Contract:** ${conn.contract}\n`;
      report += `**Location:** ${conn.location}\n`;
      
      if (conn.breakingChangePatterns) {
        report += `**Breaking Change Patterns:** ${conn.breakingChangePatterns.join(', ')}\n`;
      }
      
      report += '\n';
    });
  }
  
  report += '## Change Impact Matrix\n\n';
  report += '| If You Change... | Affected Repos | Action Required |\n';
  report += '|---|---|---|\n';
  
  const impactMap = new Map();
  repoMap.connections.forEach(conn => {
    const key = `${conn.type}:${conn.contract}`;
    if (!impactMap.has(key)) {
      impactMap.set(key, { contract: conn.contract, type: conn.type, affected: [] });
    }
    impactMap.get(key).affected.push(conn.to);
  });
  
  impactMap.forEach((impact, key) => {
    const action = impact.type === 'npm-file' ? 'Run npm install' :
                   impact.type === 'env-var-shared' ? 'Update .env files' :
                   'Review and test';
    report += `| ${impact.contract} (${impact.type}) | ${impact.affected.join(', ')} | ${action} |\n`;
  });
  
  const reportPath = path.join(CACHE_DIR, 'connection-report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Report saved to: ${reportPath}`);
  
  return report;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args[0] === 'setup') {
    const repos = args.slice(1);
    if (repos.length === 0) {
      console.error('Usage: node analyze-repos.js setup <repo1> <repo2> ...');
      process.exit(1);
    }
    const config = interactiveSetup(repos);
    const repoMap = analyzeRepositories(config);
    generateReport(repoMap);
  } else if (args[0] === 'refresh') {
    const config = loadConfig();
    if (!config) {
      console.error('No configuration found. Run with "setup" first.');
      process.exit(1);
    }
    const repoMap = analyzeRepositories(config);
    generateReport(repoMap);
  } else {
    console.log('Usage:');
    console.log('  node analyze-repos.js setup <repo1> <repo2> ...');
    console.log('  node analyze-repos.js refresh');
  }
}

module.exports = { analyzeRepositories, generateReport };
