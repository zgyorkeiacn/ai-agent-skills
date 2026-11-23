#!/usr/bin/env node
/**
 * git-manager - multi-account git credential registry and expiry watchdog.
 *
 * Two problems, one store:
 *   1. Several accounts on one host (three GitHub identities) collide, because git has no way
 *      to know which username a given repo wants. Solved by per-owner `credential.<url>.username`
 *      routes, which git matches by PATH PREFIX.
 *   2. A PAT expires silently. Nothing tells you until a script fails with a confusing 401.
 *      Solved by a scheduled `probe` that records state to a status file.
 *
 * Storage split by consumer:
 *   - metadata (id, username, host, repositories[]) -> accounts.json, plaintext, NEVER a secret
 *   - tokens                                        -> the OS credential store, written through
 *     `git credential approve` so git's own helper reads them natively and unattended
 *
 * Writing through git rather than to a platform keychain API is what makes this portable:
 * `manager` on Windows, `osxkeychain` on macOS, `libsecret` on Linux all speak the same protocol.
 *
 * A secret is NEVER accepted on argv - argv is visible to every process and lands in shell
 * history. Secrets arrive on stdin or via --from-env.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const HOME_DIR = process.env.GIT_MANAGER_HOME || join(homedir(), '.claude', 'credentials');
const ACCOUNTS_PATH = join(HOME_DIR, 'accounts.json');
const STATUS_PATH = join(HOME_DIR, 'pat-status.json');

/**
 * Synthetic host for API tokens that must NOT share a key with an account's git token.
 *
 * Learned the hard way: scoping a second secret by `path=` does not work. With useHttpPath off,
 * Git Credential Manager normalises the path away, so the second write silently OVERWRITES the
 * first under the same (host, username) key. `.invalid` is reserved by RFC 2606 and can never
 * be a real host, so git will never query this key during a genuine operation.
 */
const API_TOKEN_HOST = 'api-token.invalid';

/** Warn this far ahead of expiry. */
const EXPIRY_WARN_DAYS = 14;

// ---------------------------------------------------------------- store

function loadJson(path, fallback) {
  if (!existsSync(path)) return structuredClone(fallback);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { throw new Error(`${path} is not valid JSON: ${err.message}`); }
}

function saveJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const loadAccounts = () => loadJson(ACCOUNTS_PATH, { version: 2, accounts: [] });
const saveAccounts = (d) => saveJson(ACCOUNTS_PATH, d);

function findAccount(store, id) {
  const hit = store.accounts.find((a) => a.id === id);
  if (!hit) throw new Error(`no account "${id}". Known: ${store.accounts.map((a) => a.id).join(', ') || '(none)'}`);
  return hit;
}

// ---------------------------------------------------------------- process helpers

/**
 * Strip variables an editor or extension host injects that break spawned children, and force
 * prompting OFF so a missing credential FAILS rather than hanging on input nobody will type.
 */
function sanitizedEnv() {
  const env = { ...process.env };
  for (const k of ['ELECTRON_RUN_AS_NODE', 'NO_COLOR', 'GIT_ASKPASS', 'SSH_ASKPASS']) delete env[k];
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

function runGit(args, cwd) {
  return new Promise((res) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: sanitizedEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => res({ code: -1, out: '', err: 'git not found' }));
    child.on('close', (code) => res({ code, out: out.trim(), err: err.trim() }));
  });
}

function gitCredential(action, fields) {
  return new Promise((res, rej) => {
    const child = spawn('git', ['credential', action], { stdio: ['pipe', 'pipe', 'pipe'], env: sanitizedEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', rej);
    child.on('close', (code) => {
      if (code !== 0) return rej(new Error(`git credential ${action} failed (${code}): ${err.trim()}`));
      const parsed = {};
      for (const line of out.split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0) parsed[line.slice(0, i)] = line.slice(i + 1);
      }
      res(parsed);
    });
    const body = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${v}`).join('\n');
    child.stdin.end(body + '\n\n');
  });
}

const gitTokenFields = (a) => ({ protocol: 'https', host: a.host, username: a.username });
const apiTokenFields = (a) => ({ protocol: 'https', host: API_TOKEN_HOST, username: a.id });

/** Where an account's probe-able token lives. */
function tokenFieldsFor(account) {
  return account.authMode === 'credential-store' ? gitTokenFields(account) : apiTokenFields(account);
}

/**
 * Resolve an account's token, most authoritative source first.
 *
 *   1. the OS keychain
 *   2. a declared environment variable
 *   3. a declared .env FILE
 *
 * Step 3 exists because a scheduled task runs with a minimal environment: cron sets almost
 * nothing, and a Windows task inherits no interactive session. A token reachable only through
 * step 2 is therefore invisible to the daily probe, which reports it `absent` and silently
 * checks nothing - the exact blind spot the watchdog exists to remove.
 */
async function readToken(account) {
  try {
    const res = await gitCredential('fill', tokenFieldsFor(account));
    if (res.password) return { token: res.password, source: 'keychain' };
  } catch { /* nothing stored */ }

  const varName = account.apiToken?.envVar;
  if (varName && process.env[varName]) return { token: process.env[varName], source: `env:${varName}` };

  for (const file of envFileCandidates(account)) {
    const found = readEnvFile(file, varName);
    if (found) return { token: found, source: `file:${file}` };
  }
  return { token: null, source: null };
}

function envFileCandidates(account) {
  const declared = account.apiToken?.envFile;
  if (!declared) return [];
  return (Array.isArray(declared) ? declared : [declared]).filter(Boolean);
}

/**
 * Minimal .env reader: `KEY=value`, tolerating `export ` prefixes, surrounding quotes and
 * trailing comments. Deliberately not a full dotenv parser - this only has to find one key,
 * and a wrong-but-plausible parse of a secret is worse than not finding it.
 */
function readEnvFile(path, varName) {
  if (!varName || !existsSync(path)) return null;
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== varName) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      // Strip an unquoted trailing comment, but never inside a quoted value.
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (value) return value;
  }
  return null;
}

async function readSecretInput(label, fromEnv) {
  if (fromEnv) {
    const v = process.env[fromEnv];
    if (!v) throw new Error(`environment variable ${fromEnv} is empty or unset`);
    return v.trim();
  }
  if (!input.isTTY) {
    const chunks = [];
    for await (const c of input) chunks.push(c);
    const v = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    if (!v) throw new Error('no secret received on stdin');
    return v;
  }
  const rl = createInterface({ input, output });
  try {
    const v = (await rl.question(`${label}: `)).trim();
    if (!v) throw new Error('empty input');
    return v;
  } finally { rl.close(); }
}

// ---------------------------------------------------------------- remotes

function parseRemote(url) {
  let m = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/i);
  if (m) {
    const host = m[1];
    const segs = m[2].split('/').filter(Boolean);
    if (host.includes('dev.azure.com') || host.includes('visualstudio.com')) {
      const gi = segs.indexOf('_git');
      if (gi > 0) return { host, owner: segs.slice(0, gi).join('/'), name: segs[gi + 1] };
    }
    if (segs.length >= 2) return { host, owner: segs[0], name: segs.slice(1).join('/') };
  }
  m = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
  if (m) {
    const segs = m[2].split('/');
    return { host: m[1], owner: segs[0], name: segs.slice(1).join('/') };
  }
  return null;
}

const isAdoHost = (host) => host.includes('dev.azure.com') || host.includes('visualstudio.com');

/** Walk roots one level deep looking for git work trees. */
async function discoverRepos(roots) {
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries = [];
    try { entries = readdirSync(root); } catch { continue; }
    for (const entry of entries) {
      const dir = join(root, entry);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      const r = await runGit(['-C', dir, 'remote', 'get-url', 'origin']);
      if (r.code !== 0 || !r.out) continue;
      const parsed = parseRemote(r.out);
      if (parsed) found.push({ ...parsed, localPath: dir, url: r.out });
    }
  }
  return found;
}

/**
 * Conventional places people keep checkouts. Only ones that EXIST are offered, and onboarding
 * lets the user replace the list outright, so a miss here costs nothing. Deliberately no
 * machine-specific paths: this ships to other people's machines.
 */
function defaultRoots() {
  const home = homedir();
  const common = [join(home, 'source', 'repos'), join(home, 'git'), join(home, 'repos'),
                  join(home, 'src'), join(home, 'code'), join(home, 'projects'), join(home, 'dev')];
  const win = ['C:\\src', 'C:\\git', 'C:\\repos', 'C:\\dev'];
  return process.platform === 'win32' ? [...common, ...win] : common;
}

// ---------------------------------------------------------------- probe

/**
 * Check one token and classify it.
 *
 * THREE states, not two. A 200 with no expiry header means the token never expires, which is a
 * posture observation rather than an error - reporting it as "ok" hides it, and reporting it as
 * a failure cries wolf. Measured on a real classic PAT: GitHub simply omits the header.
 */
async function probeGitHub(token) {
  let res;
  try {
    res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'git-manager', Accept: 'application/vnd.github+json' },
    });
  } catch (err) {
    return { state: 'unreachable', detail: err.message };
  }
  if (res.status === 401) return { state: 'dead', detail: 'HTTP 401 - token revoked, expired or invalid' };
  if (!res.ok) return { state: 'unreachable', detail: `HTTP ${res.status}` };

  const scopes = res.headers.get('x-oauth-scopes') || '';
  const expHeader = res.headers.get('github-authentication-token-expiration');
  if (!expHeader) return { state: 'no-expiry', scopes, detail: 'valid, but no expiration is set on this token' };

  const expiresAt = new Date(expHeader.replace(' UTC', 'Z').replace(' ', 'T'));
  if (Number.isNaN(expiresAt.getTime())) return { state: 'valid', scopes, detail: `unparseable expiry "${expHeader}"` };
  const days = Math.floor((expiresAt - Date.now()) / 86400000);
  return {
    state: days < 0 ? 'dead' : days <= EXPIRY_WARN_DAYS ? 'expiring' : 'valid',
    scopes,
    expiresAt: expiresAt.toISOString(),
    daysRemaining: days,
    detail: days < 0 ? `expired ${-days} day(s) ago` : `expires in ${days} day(s)`,
  };
}

/**
 * Build the endpoints to try for an ADO account, narrowest-scope first.
 *
 * The org and project are recovered from the account's own `owners`, whose shape differs by host:
 *   dev.azure.com          -> owner is "<org>/<project>"; the org is NOT in the host
 *   <org>.visualstudio.com -> the org IS the host subdomain, and owner is just "<project>"
 */
function adoEndpointsFor(account) {
  const legacy = account.host.match(/^([^.]+)\.visualstudio\.com$/i);
  const base = legacy ? `https://${legacy[1]}.visualstudio.com` : null;

  const urls = [];
  for (const owner of account.owners ?? []) {
    if (legacy) {
      urls.push(`${base}/${owner}/_apis/wit/fields?api-version=7.1&$top=1`);
    } else {
      const [org, project] = owner.split('/');
      if (!org) continue;
      if (project) urls.push(`https://dev.azure.com/${org}/${project}/_apis/wit/fields?api-version=7.1&$top=1`);
      urls.push(`https://dev.azure.com/${org}/_apis/projects?api-version=7.1`);
    }
  }
  if (legacy) urls.push(`${base}/_apis/projects?api-version=7.1`);

  // Last resort only. This needs User Profile scope, which a work-items PAT legitimately lacks.
  urls.push('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1');
  return [...new Set(urls)];
}

/**
 * Validity check for an ADO PAT. No expiry is available: ADO exposes one only through an endpoint
 * that needs a scope these tokens do not carry.
 *
 * PROBE WHAT THE CREDENTIAL IS SCOPED FOR. The first version tested only the org-independent
 * profile endpoint, chosen so a wrong org name could not cause a false negative. That traded one
 * false negative for a far worse one: ADO answers 401 for insufficient scope exactly as it does
 * for a bad token, so a PAT correctly scoped to Work Items reported DEAD, and the advice that
 * follows a DEAD verdict is "regenerate it" - replacing a perfectly good credential. Measured on
 * a real Work-Items PAT: profile 401, work item 200, projects 200.
 *
 * So the account's OWN org and project are tried first, and the token is only declared dead when
 * every endpoint rejects it.
 */
async function probeAzureDevOps(token, account) {
  const auth = Buffer.from(`:${token}`).toString('base64');
  const urls = adoEndpointsFor(account);
  let sawAuthFailure = false;
  let lastDetail = '';

  for (const url of urls) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, redirect: 'manual' });
    } catch (err) {
      lastDetail = err.message;
      continue;
    }
    // ADO answers a bad PAT with 401, and sometimes 203 or a 302 to a sign-in page.
    if (res.status === 401 || res.status === 203 || res.status === 302) {
      sawAuthFailure = true;
      lastDetail = `HTTP ${res.status}`;
      continue;
    }
    if (res.ok) {
      const scope = url.includes('/_apis/wit/') ? 'work items' : url.includes('/_apis/projects') ? 'projects' : 'profile';
      return { state: 'valid', detail: `valid for ${scope} (ADO exposes no expiry date)` };
    }
    lastDetail = `HTTP ${res.status}`;
  }

  if (sawAuthFailure) return { state: 'dead', detail: `rejected by every endpoint tried (${lastDetail}) - revoked, expired, or lacking every scope checked` };
  return { state: 'unreachable', detail: lastDetail || 'no endpoint answered' };
}

async function cmdProbe(args) {
  const store = loadAccounts();
  const results = [];

  for (const account of store.accounts) {
    const { token, source } = await readToken(account);
    if (!token) {
      results.push({ id: account.id, host: account.host, state: 'absent', detail: 'no token found in the keychain, env var or declared .env file' });
      continue;
    }
    const probe = isAdoHost(account.host) ? await probeAzureDevOps(token, account) : await probeGitHub(token);
    results.push({ id: account.id, host: account.host, username: account.username, source, ...probe });
  }

  const status = { checkedAt: new Date().toISOString(), warnDays: EXPIRY_WARN_DAYS, results };
  saveJson(STATUS_PATH, status);

  if (args.json) { console.log(JSON.stringify(status, null, 2)); return; }
  renderStatus(status);
  if (results.some((r) => r.state === 'dead' || r.state === 'expiring')) process.exitCode = 1;
}

const STATE_LABEL = {
  dead: 'DEAD',
  expiring: 'EXPIRING',
  absent: 'NO TOKEN',
  'no-expiry': 'no expiry set',
  unreachable: 'unreachable',
  valid: 'ok',
};

function renderStatus(status) {
  const order = ['dead', 'expiring', 'absent', 'unreachable', 'no-expiry', 'valid'];
  const sorted = [...status.results].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  const age = Math.round((Date.now() - new Date(status.checkedAt)) / 60000);
  console.log(`checked ${age < 1 ? 'just now' : `${age} min ago`}\n`);
  for (const r of sorted) {
    console.log(`  ${(STATE_LABEL[r.state] ?? r.state).padEnd(14)} ${r.id.padEnd(22)} ${r.detail ?? ''}`);
    // Where a token came from is the first question when a probe disagrees with expectations,
    // and it is unrecoverable after the fact.
    if (r.source && r.source !== 'keychain') console.log(`  ${''.padEnd(14)} ${''.padEnd(22)} source: ${r.source}`);
  }
  // "all healthy" must not be printed over an account with no token, or over a probe that could
  // not reach the network. Neither is a failure, but neither is reassurance either.
  const bad = sorted.filter((r) => r.state === 'dead' || r.state === 'expiring');
  const unknown = sorted.filter((r) => r.state === 'absent' || r.state === 'unreachable');
  const notes = [];
  if (bad.length) notes.push(`${bad.length} credential(s) need attention`);
  if (unknown.length) notes.push(`${unknown.length} not checked (${[...new Set(unknown.map((r) => r.state))].join(', ')})`);
  console.log(`\n${notes.length ? notes.join('; ') : 'all credentials healthy'}`);
}

/** Fast, no network. This is what a session banner calls. */
async function cmdStatus(args) {
  if (!existsSync(STATUS_PATH)) {
    console.log('no probe has run yet - run:  node creds.mjs probe');
    return;
  }
  const status = loadJson(STATUS_PATH, null);
  const ageHours = (Date.now() - new Date(status.checkedAt)) / 3600000;

  if (args.quiet) {
    // Banner mode: print ONLY if something is wrong, so a healthy day stays silent.
    const bad = status.results.filter((r) => r.state === 'dead' || r.state === 'expiring');
    if (!bad.length) return;
    console.log(`git-manager: ${bad.length} credential(s) need attention`);
    for (const r of bad) console.log(`  ${STATE_LABEL[r.state]}  ${r.id}  ${r.detail ?? ''}`);
    if (ageHours > 48) console.log(`  (status is ${Math.round(ageHours / 24)} days old - the scheduled probe may not be running)`);
    return;
  }
  renderStatus(status);
  if (ageHours > 48) console.log(`warning: status is ${Math.round(ageHours / 24)} days old; the scheduled probe may not be running`);
}

// ---------------------------------------------------------------- onboarding

async function cmdOnboard(args) {
  const rl = createInterface({ input, output });
  const ask = async (q, dflt) => {
    const a = (await rl.question(dflt ? `${q} [${dflt}]: ` : `${q}: `)).trim();
    return a || dflt || '';
  };

  try {
    console.log('\ngit-manager onboarding\n');

    const rootsAnswer = await ask('Comma-separated roots to scan for clones', defaultRoots().filter(existsSync).join(','));
    const roots = rootsAnswer.split(',').map((s) => s.trim()).filter(Boolean);
    console.log('\nscanning...');
    const repos = await discoverRepos(roots);
    if (!repos.length) {
      console.log('no git repositories found in those roots. Re-run with different roots.');
      return;
    }

    // Group by (host, owner). Each group is a candidate identity boundary.
    const groups = new Map();
    for (const r of repos) {
      const key = `${r.host}\u0000${r.owner}`;
      if (!groups.has(key)) groups.set(key, { host: r.host, owner: r.owner, repos: [] });
      groups.get(key).repos.push(r);
    }
    console.log(`found ${repos.length} repo(s) across ${groups.size} host/owner group(s):\n`);
    const list = [...groups.values()];
    list.forEach((g, i) => console.log(`  ${String(i + 1).padStart(2)}. ${g.host}/${g.owner}  (${g.repos.length} repo${g.repos.length === 1 ? '' : 's'})`));

    const store = loadAccounts();
    console.log('\nFor each group, give the account id and the username that authenticates it.');
    console.log('Leave the id blank to skip a group, or type "merge:<id>" to attach it to an account already defined.\n');

    for (const g of list) {
      const ado = isAdoHost(g.host);
      const suggested = suggestAccountId(g, store);
      const idAnswer = await ask(`${g.host}/${g.owner} -> account id`, suggested);
      if (!idAnswer) { console.log('  skipped'); continue; }

      if (idAnswer.startsWith('merge:')) {
        const target = store.accounts.find((a) => a.id === idAnswer.slice(6).trim());
        if (!target) { console.log(`  no account "${idAnswer.slice(6).trim()}" - skipped`); continue; }
        target.owners.push(g.owner);
        attachRepos(target, g.repos);
        console.log(`  attached ${g.repos.length} repo(s) to "${target.id}"`);
        continue;
      }

      let account = store.accounts.find((a) => a.id === idAnswer);
      if (!account) {
        const username = await ask('  username that authenticates it', ado ? '' : g.owner);
        account = {
          id: idAnswer,
          host: g.host,
          username,
          description: '',
          // ADO git auth is owned by the credential helper's Azure AD flow; there is no PAT for
          // git to find. Its PAT is a REST API credential only.
          authMode: ado ? 'interactive-aad' : 'credential-store',
          owners: [],
          repositories: [],
        };
        if (ado) {
          const varName = await ask('  env var holding its REST API PAT', 'AZURE_DEVOPS_PAT');
          account.apiToken = { envVar: varName };
          // Without a file fallback a token reachable only through the shell environment is
          // invisible to the scheduled probe, which then reports it absent and checks nothing.
          const envFile = await ask('  optional .env file holding it (blank for none)', '');
          if (envFile) account.apiToken.envFile = envFile.split(',').map((s) => s.trim()).filter(Boolean);
        }
        store.accounts.push(account);
      }
      account.owners.push(g.owner);
      attachRepos(account, g.repos);
      console.log(`  ${account.id}: ${g.repos.length} repo(s)`);
    }

    saveAccounts(store);
    console.log(`\nwrote ${ACCOUNTS_PATH}`);

    // Routing must be configured BEFORE tokens are useful: without it git cannot tell which
    // identity a repo wants, which is the whole collision this skill exists to prevent.
    const routed = await applyRouting(store, { apply: true });
    console.log(`configured ${routed} owner route(s) in global gitconfig`);

    console.log('\nNow supply a token for each account. Blank skips.');
    for (const account of store.accounts) {
      const { token: existing, source } = await readToken(account);
      if (existing) { console.log(`  ${account.id}: token already available (${source}), skipping`); continue; }
      const kind = account.authMode === 'interactive-aad' ? 'REST API PAT' : 'PAT';
      const token = (await rl.question(`  ${account.id} (${kind}, input is visible): `)).trim();
      if (!token) { console.log('    skipped'); continue; }
      await storeToken(account, token);
      console.log('    stored');
    }

    console.log('\nprobing...');
    rl.close();
    await cmdProbe({});
    console.log(`\nNext: install the daily check with  node creds.mjs install-schedule`);
  } finally {
    rl.close();
  }
}

function suggestAccountId(group, store) {
  const base = isAdoHost(group.host) ? `ado-${group.owner.split('/')[0]}` : `github-${group.owner}`;
  const slug = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  return store.accounts.some((a) => a.id === slug) ? `${slug}-2` : slug;
}

function attachRepos(account, repos) {
  account.repositories ??= [];
  for (const r of repos) {
    const hit = account.repositories.find((x) => x.owner.toLowerCase() === r.owner.toLowerCase() && x.name.toLowerCase() === r.name.toLowerCase());
    if (hit) hit.localPath = r.localPath;
    else account.repositories.push({ owner: r.owner, name: r.name, localPath: r.localPath });
  }
}

async function storeToken(account, token) {
  await gitCredential('approve', { ...tokenFieldsFor(account), password: token });

  // An API-token write must never clobber the account's git token. The keys are deliberately
  // different, but that guarantee is silent when it breaks, so verify rather than assume.
  if (account.authMode === 'credential-store') return;
  const probe = await gitCredential('fill', gitTokenFields(account)).catch(() => ({}));
  if (probe.password && probe.password === token) {
    throw new Error('the API token overwrote the git token - refusing to leave git auth broken');
  }
}

// ---------------------------------------------------------------- routing

/**
 * A username route is only REQUIRED where several accounts compete for one host. With a single
 * account on a host git has nothing to disambiguate, so demanding a route there reports a
 * problem that does not exist.
 */
function contestedHosts(store) {
  const counts = new Map();
  for (const a of store.accounts) counts.set(a.host, (counts.get(a.host) ?? 0) + 1);
  return counts;
}

async function applyRouting(store, { apply }) {
  const counts = contestedHosts(store);
  let n = 0;
  for (const a of store.accounts) {
    if (a.authMode !== 'credential-store') continue;
    if ((counts.get(a.host) ?? 0) < 2) continue;
    for (const owner of a.owners ?? []) {
      const key = `credential.https://${a.host}/${owner}.username`;
      if (apply) await runGit(['config', '--global', key, a.username]);
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- commands

async function cmdList(args) {
  const store = loadAccounts();
  if (args.json) { console.log(JSON.stringify(store, null, 2)); return; }
  if (!store.accounts.length) { console.log('No accounts yet. Run:  node creds.mjs onboard'); return; }
  for (const a of store.accounts) {
    console.log(`\n${a.id}`);
    console.log(`  host       ${a.host}`);
    console.log(`  username   ${a.username || '(n/a)'}`);
    console.log(`  auth       ${a.authMode}`);
    if (a.description) console.log(`  note       ${a.description}`);
    console.log(`  owners     ${(a.owners ?? []).join(', ') || '(none)'}`);
    console.log(`  repos      ${a.repositories?.length ?? 0}`);
    for (const r of a.repositories ?? []) console.log(`               ${r.owner}/${r.name}${r.localPath ? `   [${r.localPath}]` : ''}`);
  }
  console.log('');
}

async function cmdDoctor() {
  const store = loadAccounts();
  const counts = contestedHosts(store);
  const problems = [];

  console.log(`accounts  ${store.accounts.length}\n`);
  for (const a of store.accounts) {
    const repos = a.repositories ?? [];
    const contested = (counts.get(a.host) ?? 0) > 1;
    const { token, source } = await readToken(a);

    if (a.authMode === 'interactive-aad') {
      console.log(`  ${a.id}`);
      console.log(`    git auth   interactive via the credential helper (Azure AD) - nothing to store`);
      console.log(`    api token  ${token ? `present (${source})` : 'MISSING'}`);
      console.log(`    repos      ${repos.length}`);
      if (!token) problems.push(`account "${a.id}" has no API token - run: creds set-token --id ${a.id}`);
      continue;
    }

    const routes = [];
    for (const owner of a.owners ?? []) {
      const r = await runGit(['config', '--get-urlmatch', 'credential', `https://${a.host}/${owner}/probe.git`]);
      const routed = r.out.match(/^credential\.username (.+)$/m)?.[1];
      routes.push({ owner, routed });
      if (!routed && contested) problems.push(`owner "${owner}" has no username route, and ${counts.get(a.host)} accounts share ${a.host} - git cannot tell which identity to use`);
      else if (routed && routed !== a.username) problems.push(`owner "${owner}" routes to "${routed}" but account "${a.id}" declares "${a.username}"`);
    }

    console.log(`  ${a.id}`);
    console.log(`    token  ${token ? 'present' : 'MISSING'}   repos ${repos.length}`);
    console.log(`    route  ${routes.map((r) => `${r.owner}->${r.routed ?? (contested ? 'UNROUTED' : 'n/a, sole account on host')}`).join(', ') || 'no owners'}`);
    if (!token) problems.push(`account "${a.id}" has no stored token - run: creds set-token --id ${a.id}`);
  }

  // A secret here would defeat the entire metadata/secret split.
  if (existsSync(ACCOUNTS_PATH)) {
    const raw = readFileSync(ACCOUNTS_PATH, 'utf8');
    for (const pat of [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/]) {
      if (pat.test(raw)) problems.push('accounts.json contains what looks like a plaintext token - it must hold metadata only');
    }
  }

  if (existsSync(STATUS_PATH)) {
    const status = loadJson(STATUS_PATH, null);
    const days = (Date.now() - new Date(status.checkedAt)) / 86400000;
    if (days > 2) problems.push(`last probe was ${Math.round(days)} days ago - the scheduled check may not be running`);
  } else {
    problems.push('no probe has ever run - install the daily check with: creds install-schedule');
  }

  console.log('');
  if (!problems.length) { console.log('no problems found'); return; }
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
}

async function cmdSetToken(args) {
  const store = loadAccounts();
  const account = findAccount(store, args.id);
  const token = await readSecretInput(`token for ${account.id}`, args['from-env']);
  await storeToken(account, token);
  console.log(`stored token for "${account.id}"`);
  console.log('it was not written to any file');
}

async function cmdGetToken(args) {
  const store = loadAccounts();
  const account = findAccount(store, args.id);
  const { token, source } = await readToken(account);
  if (!token) throw new Error(`no token for "${account.id}" in the keychain, env var or declared .env file`);
  if (args.reveal) { output.write(token + '\n'); return; }
  console.log(`source: ${source}`);
  const masked = token.length <= 8 ? '*'.repeat(token.length) : `${token.slice(0, 4)}${'*'.repeat(token.length - 8)}${token.slice(-4)}`;
  console.log(`${account.id}: ${masked}`);
  console.log('pass --reveal to print it in full');
}

async function cmdAddAccount(args) {
  const { id, host, username } = args;
  if (!id || !host) throw new Error('add-account requires --id and --host');
  const store = loadAccounts();
  if (store.accounts.some((a) => a.id === id)) throw new Error(`account "${id}" already exists`);
  const ado = isAdoHost(host);
  const account = {
    id, host, username: username || '',
    description: args.description || '',
    authMode: ado ? 'interactive-aad' : 'credential-store',
    owners: args.owners ? args.owners.split(',').map((s) => s.trim()) : [],
    repositories: [],
  };
  if (ado) account.apiToken = { envVar: 'AZURE_DEVOPS_PAT' };
  store.accounts.push(account);
  saveAccounts(store);
  await applyRouting(store, { apply: true });
  console.log(`added "${id}" and refreshed routing`);
}

async function cmdRemoveAccount(args) {
  const store = loadAccounts();
  const account = findAccount(store, args.id);
  for (const fields of [gitTokenFields(account), apiTokenFields(account)]) {
    try { await gitCredential('reject', fields); } catch { /* nothing stored */ }
  }
  for (const owner of account.owners ?? []) {
    await runGit(['config', '--global', '--unset', `credential.https://${account.host}/${owner}.username`]);
  }
  store.accounts = store.accounts.filter((a) => a.id !== account.id);
  saveAccounts(store);
  console.log(`removed "${account.id}", its tokens and its routes`);
}

async function cmdSyncRepos(args) {
  const store = loadAccounts();
  const roots = (args.roots ? args.roots.split(',') : defaultRoots()).map((s) => s.trim());
  const repos = await discoverRepos(roots);
  let attached = 0;
  const orphans = [];
  for (const repo of repos) {
    const account = store.accounts.find((a) => a.host === repo.host && (a.owners ?? []).some((o) => o.toLowerCase() === repo.owner.toLowerCase()));
    if (!account) { orphans.push(repo); continue; }
    const before = account.repositories?.length ?? 0;
    attachRepos(account, [repo]);
    if ((account.repositories?.length ?? 0) > before) attached++;
  }
  if (!args['dry-run']) saveAccounts(store);
  console.log(`scanned ${roots.length} root(s), found ${repos.length} repo(s), attached ${attached} new`);
  if (orphans.length) {
    console.log(`\n${orphans.length} repo(s) matched no account owner:`);
    for (const o of orphans) console.log(`  ${o.host}/${o.owner}/${o.name}`);
  }
  if (args['dry-run']) console.log('\n(dry run - nothing written)');
}

async function cmdWhoami(args) {
  const store = loadAccounts();
  let url = args.url;
  if (!url) {
    const target = resolve(args._[0] ?? process.cwd());
    const r = await runGit(['-C', target, 'remote', 'get-url', 'origin']);
    if (r.code !== 0) throw new Error(`not a git repo with an origin remote: ${target}`);
    url = r.out;
  }
  const p = parseRemote(url);
  if (!p) throw new Error(`could not parse remote: ${url}`);
  const hit = store.accounts.find((a) => a.host === p.host && (
    (a.repositories ?? []).some((r) => r.owner.toLowerCase() === p.owner.toLowerCase() && r.name.toLowerCase() === p.name.toLowerCase()) ||
    (a.owners ?? []).some((o) => o.toLowerCase() === p.owner.toLowerCase())));
  if (!hit) { console.log(`${p.host}/${p.owner}/${p.name} -> no registered account`); process.exitCode = 1; return; }
  console.log(`${p.host}/${p.owner}/${p.name} -> ${hit.id} (${hit.username})`);
}

async function cmdRepair() {
  const store = loadAccounts();
  const n = await applyRouting(store, { apply: true });
  console.log(`refreshed ${n} owner route(s)`);
}

// ---------------------------------------------------------------- context + exec

/**
 * Environment variables a consumer of this account's token expects.
 * `gh`, most GitHub Actions tooling and the REST docs all read GITHUB_TOKEN or GH_TOKEN.
 */
function envVarsFor(account) {
  if (isAdoHost(account.host)) return [account.apiToken?.envVar || 'AZURE_DEVOPS_PAT'];
  if (account.host === 'github.com') return ['GITHUB_TOKEN', 'GH_TOKEN'];
  return [account.apiToken?.envVar].filter(Boolean);
}

/**
 * Run a command with this account's token injected into the CHILD's environment only.
 *
 * This exists so a token can be USED without being SEEN. The alternative an agent reaches for
 * is `get-token --reveal`, which writes a live credential into the transcript, the scrollback
 * and any log that captures it. Here the value never leaves the child process.
 */
async function cmdExec(args) {
  const store = loadAccounts();
  const account = findAccount(store, args.id);
  const cmd = args._;
  if (!cmd.length) throw new Error('nothing to run. Usage: exec --id <id> -- <command> [args...]');

  const { token, source } = await readToken(account);
  if (!token) throw new Error(`no token for "${account.id}" - run: creds set-token --id ${account.id}`);

  const env = { ...sanitizedEnv() };
  const names = envVarsFor(account);
  for (const n of names) env[n] = token;
  console.error(`[git-manager] ${names.join(', ')} set for this command from ${source}`);

  // shell:false deliberately. With shell:true Node concatenates argv WITHOUT escaping (its own
  // DEP0190 warns about exactly this), which both mangles quoted arguments and turns any shell
  // metacharacter in them into injection - a bad property for the one command that carries a
  // token. For a shell builtin or a Windows .cmd, wrap it explicitly:
  //   exec --id X -- cmd /c npm view foo
  await new Promise((res) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env, shell: false });
    child.on('error', (err) => {
      console.error(`[git-manager] could not run "${cmd[0]}": ${err.message}`);
      if (err.code === 'ENOENT' && process.platform === 'win32') {
        console.error('[git-manager] if this is a .cmd or .bat (npm, npx), wrap it:  -- cmd /c ' + cmd.join(' '));
      }
      process.exitCode = 1;
      res();
    });
    child.on('close', (code) => { process.exitCode = code ?? 0; res(); });
  });
}

/**
 * Emit the credential context for the current working directory.
 *
 * Deliberately contains NO token. Injecting a live credential into conversation context would
 * copy it into every transcript, log and context window that request touches - the precise
 * exposure this store exists to prevent. What an agent actually needs is which identity applies,
 * whether it is healthy, and the one command that uses it without printing it.
 */
async function cmdContext(args) {
  const store = loadAccounts();
  if (!store.accounts.length) return;

  const lines = [];
  // fileURLToPath gives the platform-native form; the manual pathname strip leaves forward
  // slashes on win32, which reads as a typo in an emitted command.
  const scriptPath = fileURLToPath(import.meta.url);

  // Which account owns the repo we are standing in, if any.
  let current = null;
  const cwd = args.cwd || process.cwd();
  const r = await runGit(['-C', cwd, 'remote', 'get-url', 'origin']);
  if (r.code === 0 && r.out) {
    const p = parseRemote(r.out);
    if (p) {
      const hit = store.accounts.find((a) => a.host === p.host && (
        (a.repositories ?? []).some((x) => x.owner.toLowerCase() === p.owner.toLowerCase() && x.name.toLowerCase() === p.name.toLowerCase()) ||
        (a.owners ?? []).some((o) => o.toLowerCase() === p.owner.toLowerCase())));
      current = { repo: `${p.host}/${p.owner}/${p.name}`, account: hit };
    }
  }

  const status = existsSync(STATUS_PATH) ? loadJson(STATUS_PATH, null) : null;
  const stateOf = (id) => status?.results?.find((x) => x.id === id)?.state;

  lines.push('## git-manager: credentials for this request');
  lines.push('');
  if (current) {
    lines.push(current.account
      ? `Current repo \`${current.repo}\` belongs to account \`${current.account.id}\` (${current.account.username}). Git operations authenticate automatically.`
      : `Current repo \`${current.repo}\` is not registered to any account. Run \`/git-manager\` to add it.`);
    lines.push('');
  }

  lines.push('Tokens are deliberately NOT included here. To use one without printing it:');
  lines.push('');
  lines.push('```');
  for (const a of store.accounts) {
    const names = envVarsFor(a);
    if (!names.length) continue;
    lines.push(`node "${scriptPath}" exec --id ${a.id} -- <command>    # sets ${names.join(', ')}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('Never use `get-token --reveal` to pass a token to a command; it writes a live credential into the transcript.');

  const unhealthy = (status?.results ?? []).filter((x) => x.state === 'dead' || x.state === 'expiring');
  if (unhealthy.length) {
    lines.push('');
    lines.push('**Credential warnings:**');
    for (const u of unhealthy) lines.push(`- \`${u.id}\`: ${u.state.toUpperCase()} - ${u.detail ?? ''}`);
  }
  if (status) {
    const days = (Date.now() - new Date(status.checkedAt)) / 86400000;
    if (days > 2) lines.push(`\n(credential status is ${Math.round(days)} days old; the scheduled probe may have stopped)`);
  }

  void stateOf;
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------- scheduling

async function cmdInstallSchedule(args) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const at = args.at || '09:00';
  if (process.platform === 'win32') {
    const ps = join(scriptDir, 'install-schedule.ps1');
    console.log(`run this (it registers a Task Scheduler job at ${at}):\n`);
    console.log(`  powershell -NoProfile -File "${ps}" -Time ${at}`);
    console.log(`\nUnder RemoteSigned a local script runs as is. If this copy was downloaded (marked as from the internet), run Unblock-File on it first. Never use Bypass.`);
  } else {
    const sh = join(scriptDir, 'install-schedule.sh');
    console.log(`run this (it installs a cron entry at ${at}):\n`);
    console.log(`  bash "${sh}" --time ${at}`);
  }
  console.log('\nBoth just call:  node creds.mjs probe');
}

// ---------------------------------------------------------------- cli

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Everything after a bare `--` is the child command, including its own flags. Without this
    // `exec --id x -- curl -H ...` would have `-H` parsed as one of ours.
    if (a === '--') { args._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

const USAGE = `
git-manager - multi-account git credentials with an expiry watchdog

  onboard                      first run: scan clones, define accounts, route them, take tokens
  list [--json]                accounts and their repositories (no secrets)
  doctor                       routing, token and schedule health
  whoami [<repo-path>]         which account owns a repo

  probe [--json]               check every token now, write the status file
  status [--quiet]             read the last probe result; --quiet prints only if action is needed
  context [--cwd <dir>]        credential context for this directory (no secrets); used by the hook
  exec --id <id> -- <cmd>      run <cmd> with that account's token in ITS environment only
  install-schedule [--at HH:MM]   print the command that installs the daily check

  set-token --id <id> [--from-env VAR]
  get-token --id <id> [--reveal]
  add-account --id --host [--username] [--owners a,b]
  remove-account --id <id>
  sync-repos [--roots a,b] [--dry-run]
  repair                       re-apply owner routes to gitconfig

Secrets are never accepted on argv. Use --from-env VAR, or pipe on stdin.
`;

const COMMANDS = {
  onboard: cmdOnboard,
  list: cmdList,
  doctor: cmdDoctor,
  whoami: cmdWhoami,
  probe: cmdProbe,
  status: cmdStatus,
  context: cmdContext,
  exec: cmdExec,
  'install-schedule': cmdInstallSchedule,
  'set-token': cmdSetToken,
  'get-token': cmdGetToken,
  'add-account': cmdAddAccount,
  'remove-account': cmdRemoveAccount,
  'sync-repos': cmdSyncRepos,
  repair: cmdRepair,
};

const [, , cmd, ...rest] = process.argv;
if (!cmd || cmd === 'help' || cmd === '--help') { console.log(USAGE); process.exit(0); }
const handler = COMMANDS[cmd];
if (!handler) { console.error(`unknown command "${cmd}"`); console.log(USAGE); process.exit(1); }
handler(parseArgs(rest)).catch((err) => { console.error(`error: ${err.message}`); process.exit(1); });
