#!/usr/bin/env node
/**
 * Cross-Repository Dependency Analyzer
 * Scans multiple interconnected repos and builds dependency graph
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveConfigPath(arg) {
  return arg || path.join(os.homedir(), '.claude', 'repo-dependency-config.json');
}

function resolveCacheDir(arg) {
  return arg || path.join(os.homedir(), '.claude', 'repo-dependency-cache');
}

// Load or initialize configuration
function loadConfig(configPath) {
  const resolved = resolveConfigPath(configPath);
  if (fs.existsSync(resolved)) {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }
  return null;
}

// Interactive setup (called by AI agent)
function interactiveSetup(repos, configPath, cacheDir) {
  const resolvedConfig = resolveConfigPath(configPath);
  const resolvedCache  = resolveCacheDir(cacheDir);

  console.log('Repository Dependency Analysis - Initial Setup');
  console.log('='.repeat(50));

  const config = {
    repositories: repos.map((r, i) => ({
      name: path.basename(r),
      path: r,
      type: 'application',
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

  fs.mkdirSync(path.dirname(resolvedConfig), { recursive: true });
  fs.writeFileSync(resolvedConfig, JSON.stringify(config, null, 2));
  console.log(`Configuration saved to: ${resolvedConfig}`);

  return config;
}

// Detect repository type
function detectRepoType(repoPath) {
  if (fs.existsSync(path.join(repoPath, 'docker-compose.yml'))) return 'orchestration';
  if (fs.existsSync(path.join(repoPath, 'pom.xml')))            return 'java';
  if (fs.existsSync(path.join(repoPath, 'package.json')))       return 'node';
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

    const serviceMatches = content.match(/^\s+([a-z-]+):/gm);
    if (serviceMatches) {
      serviceMatches.forEach(match => {
        const serviceName = match.trim().replace(':', '');
        deps.push({ type: 'docker-service', name: serviceName, location: 'docker-compose.yml' });
      });
    }

    const dependsOnRegex = /depends_on:\s*\n\s+-\s+([a-z-]+)/gm;
    let depMatch;
    while ((depMatch = dependsOnRegex.exec(content)) !== null) {
      deps.push({ type: 'docker-depends', name: depMatch[1], location: 'docker-compose.yml' });
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
        vars.push({ type: 'env-var', name: match[1], location: '.env.example' });
      }
    });

    return vars;
  } catch (err) {
    console.warn(`Warning: Failed to parse ${envExamplePath}: ${err.message}`);
    return [];
  }
}

// Main analysis function
function analyzeRepositories(config, cacheDir) {
  const resolvedCache = resolveCacheDir(cacheDir);
  fs.mkdirSync(resolvedCache, { recursive: true });

  console.log('Analyzing repositories...');
  console.log('');

  const repoMap = {
    repositories: [],
    connections: [],
    timestamp: new Date().toISOString()
  };

  for (const repo of config.repositories) {
    if (!fs.existsSync(repo.path)) {
      console.warn(`  Repository not found: ${repo.path}`);
      continue;
    }

    console.log(`  Scanning: ${repo.name}`);

    const repoData = {
      ...repo,
      type: detectRepoType(repo.path),
      dependencies: []
    };

    if (config.trackDependencies.npm)     repoData.dependencies.push(...scanNpmDependencies(repo.path));
    if (config.trackDependencies.docker)  repoData.dependencies.push(...scanDockerDependencies(repo.path));
    if (config.trackDependencies.envVars) repoData.dependencies.push(...scanEnvVars(repo.path));

    console.log(`    Found ${repoData.dependencies.length} dependencies`);
    repoMap.repositories.push(repoData);
  }

  console.log('');
  console.log('Building connection graph...');

  repoMap.repositories.forEach(repo => {
    repo.dependencies.forEach(dep => {
      if (dep.type === 'npm-file') {
        const targetPath = path.resolve(repo.path, dep.path);
        const target = repoMap.repositories.find(r => targetPath.startsWith(r.path));
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

  const mapPath = path.join(resolvedCache, 'repo-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(repoMap, null, 2));
  console.log(`\nAnalysis saved to: ${mapPath}`);

  return repoMap;
}

// Generate human-readable report
function generateReport(repoMap, cacheDir) {
  const resolvedCache = resolveCacheDir(cacheDir);

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
      report += `### ${i + 1}. ${conn.from} -> ${conn.to}\n\n`;
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

  impactMap.forEach((impact) => {
    const action = impact.type === 'npm-file'        ? 'Run npm install' :
                   impact.type === 'env-var-shared'  ? 'Update .env files' :
                   'Review and test';
    report += `| ${impact.contract} (${impact.type}) | ${impact.affected.join(', ')} | ${action} |\n`;
  });

  const reportPath = path.join(resolvedCache, 'connection-report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`Report saved to: ${reportPath}`);

  return report;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  // Parse --config and --cache-dir flags
  const configFlagIdx = args.indexOf('--config');
  const configPath    = configFlagIdx >= 0 ? args[configFlagIdx + 1] : null;
  const cacheFlagIdx  = args.indexOf('--cache-dir');
  const cacheDir      = cacheFlagIdx  >= 0 ? args[cacheFlagIdx  + 1] : null;

  // Strip flag args to get positional commands
  const positional = args.filter((a, i) =>
    !['--config', '--cache-dir'].includes(a) &&
    args[i - 1] !== '--config' && args[i - 1] !== '--cache-dir'
  );

  if (positional[0] === 'setup') {
    const repos = positional.slice(1);
    if (repos.length === 0) {
      console.error('Usage: node analyze-repos.js setup <repo1> <repo2> ...');
      process.exit(1);
    }
    const config = interactiveSetup(repos, configPath, cacheDir);
    const repoMap = analyzeRepositories(config, cacheDir);
    generateReport(repoMap, cacheDir);
  } else if (positional[0] === 'refresh') {
    const config = loadConfig(configPath);
    if (!config) {
      const resolved = resolveConfigPath(configPath);
      console.error(`No configuration found at: ${resolved}`);
      console.error('Run install.ps1 to configure repositories, or pass --config <path>.');
      process.exit(1);
    }
    const repoMap = analyzeRepositories(config, cacheDir);
    generateReport(repoMap, cacheDir);
  } else {
    console.log('Usage:');
    console.log('  node analyze-repos.js setup <repo1> <repo2> ...');
    console.log('  node analyze-repos.js refresh');
    console.log('');
    console.log('Flags:');
    console.log('  --config <path>      Config file (default: ~/.claude/repo-dependency-config.json)');
    console.log('  --cache-dir <path>   Cache directory (default: ~/.claude/repo-dependency-cache/)');
  }
}

module.exports = { analyzeRepositories, generateReport };
