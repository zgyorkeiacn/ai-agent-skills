// Screenshot capture script for Automation Agent webui
// Starts a fresh webui server, authenticates, then screenshots every tab and sub-view.

const { chromium } = require('c:/newgit/copilot-ado-figma-gherkin-agent/node_modules/playwright');
const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');

const AGENT_ROOT = 'c:/newgit/copilot-ado-figma-gherkin-agent';
const TOKEN_FILE = path.join(AGENT_ROOT, '.agent-webui-token');
const OUT_DIR    = path.join(__dirname, 'screenshots');
const PORT       = 8789;   // use a fresh port so we own the server process
const BASE_URL   = `http://localhost:${PORT}`;
const VIEWPORT   = { width: 1440, height: 900 };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  return /^[a-f0-9]{32}$/.test(t) ? t : null;
}

async function waitForServer(maxMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${BASE_URL}/`);
      if (r.status < 500) return true;
    } catch { /* not yet */ }
    await sleep(400);
  }
  return false;
}

async function capture() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Starting fresh webui server on port', PORT, '...');
  const server = spawn('node', ['bin/automation-agent-webui.js'], {
    cwd: AGENT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AUTOMATION_AGENT_WEBUI_PORT: String(PORT) },
  });
  server.stdout.on('data', d => process.stdout.write('[srv] ' + d));
  server.stderr.on('data', d => process.stderr.write('[srv] ' + d));

  await sleep(2500);
  const up = await waitForServer();
  if (!up) { console.error('Server did not start'); server.kill(); process.exit(1); }

  const token = readToken();
  if (!token) { console.error('No token at', TOKEN_FILE); server.kill(); process.exit(1); }
  console.log('Token:', token.slice(0, 6) + '...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page    = await context.newPage();

  // Authenticate once — sets localStorage['webui-token'] and redirects to /?tab=setup
  await page.goto(`${BASE_URL}/welcome?token=${token}`, { waitUntil: 'networkidle' });
  await sleep(1500);

  // ── Utility: navigate and screenshot ────────────────────────────────────────
  async function shot(filename, url, action) {
    console.log(' ->', filename);
    if (url) {
      await page.goto(url, { waitUntil: 'networkidle' });
      await sleep(900);
    }
    if (action) { await action(); await sleep(700); }
    await page.screenshot({ path: path.join(OUT_DIR, filename) });
  }

  // ── Helper: evaluate a global function (app.js exposes these on window) ─────
  async function callGlobal(fn, ...args) {
    return page.evaluate(
      ([f, a]) => window[f]?.apply(null, a),
      [fn, args]
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 01 — Setup tab
  // ════════════════════════════════════════════════════════════════════════════
  await shot('02-setup.png', `${BASE_URL}/?tab=setup`, async () => {
    await page.waitForSelector('[data-panel="setup"]', { timeout: 5000 }).catch(() => {});
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 02 — Settings: env vars card (top of settings panel)
  // ════════════════════════════════════════════════════════════════════════════
  await shot('03-settings-env.png', `${BASE_URL}/?tab=settings`);

  // ════════════════════════════════════════════════════════════════════════════
  // 03 — Settings: pipeline inputs form (scroll down)
  // ════════════════════════════════════════════════════════════════════════════
  await shot('04-settings-inputs.png', null, async () => {
    await page.evaluate(() => {
      const el = document.querySelector('[data-tag="input"]') ||
                 document.querySelector('.settings-input-section') ||
                 Array.from(document.querySelectorAll('h3,h4')).find(h => /pipeline/i.test(h.textContent));
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      else window.scrollBy(0, 360);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 04 — Settings: quality gate card (scroll further down)
  // ════════════════════════════════════════════════════════════════════════════
  await shot('14-settings-quality-gate.png', null, async () => {
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.card-label, .card-hdr span, h3, h4'))
        .find(e => /quality.gate/i.test(e.textContent));
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      else window.scrollBy(0, 700);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 05 — Settings: IDE configuration card (MCP snippets)
  // ════════════════════════════════════════════════════════════════════════════
  await shot('15-mcp-tools.png', null, async () => {
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.card-label, .card-hdr span, h3, h4'))
        .find(e => /ide.config|mcp/i.test(e.textContent));
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      else window.scrollBy(0, 1100);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 06 — Generate tab
  // ════════════════════════════════════════════════════════════════════════════
  await shot('05-generate.png', `${BASE_URL}/?tab=run`, async () => {
    await page.waitForSelector('[data-panel="run"]', { timeout: 5000 }).catch(() => {});
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 07-10 — Demo tab: 4 flow variants
  // ════════════════════════════════════════════════════════════════════════════
  await page.goto(`${BASE_URL}/?tab=demo`, { waitUntil: 'networkidle' });
  await sleep(900);

  // Demo flow buttons are rendered by loadDemoFlow() — find them by text
  async function clickDemoFlow(labelPattern, filename) {
    const btn = await page.$(`button:has-text("${labelPattern}")`);
    if (btn) {
      await btn.click({ force: true });
      await sleep(800);
    }
    await page.screenshot({ path: path.join(OUT_DIR, filename) });
    console.log(' ->', filename);
  }

  await clickDemoFlow('Test Generation', '06-demo-testgen.png');
  await clickDemoFlow('Coverage Report', '06b-demo-coverage.png');
  await clickDemoFlow('Website Analysis', '06c-demo-website.png');
  await clickDemoFlow('Planner',          '06d-demo-planner.png');

  // ════════════════════════════════════════════════════════════════════════════
  // 11 — Planner: Generate mode
  // ════════════════════════════════════════════════════════════════════════════
  await shot('07-planner-generate.png', `${BASE_URL}/?tab=planner`, async () => {
    await page.waitForSelector('[data-panel="planner"]', { timeout: 5000 }).catch(() => {});
    // ensure Generate sub-tab is active (it is by default)
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 12 — Planner: View Output mode
  // ════════════════════════════════════════════════════════════════════════════
  await shot('08-planner-view.png', null, async () => {
    // Use evaluate to invoke the JS function directly (avoids click visibility issues)
    await page.evaluate(() => {
      if (typeof loadPlannerTab === 'function') return loadPlannerTab('view');
      // fallback: click the "View Output" button
      const btns = document.querySelectorAll('[data-panel="planner"] button, .planner-mode-bar button');
      for (const b of btns) {
        if (/view.output/i.test(b.textContent)) { b.click(); return; }
      }
    });
    await sleep(800);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 13 — Planner: Sprint Plan mode (empty state is a valid screenshot)
  // ════════════════════════════════════════════════════════════════════════════
  await shot('09-planner-sprint.png', null, async () => {
    await page.evaluate(() => {
      if (typeof loadPlannerTab === 'function') return loadPlannerTab('sprint');
      const btns = document.querySelectorAll('[data-panel="planner"] button, .planner-mode-bar button');
      for (const b of btns) {
        if (/sprint.plan/i.test(b.textContent)) { b.click(); return; }
      }
    });
    await sleep(800);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 14 — Artifacts tab
  // ════════════════════════════════════════════════════════════════════════════
  await shot('10-artifacts.png', `${BASE_URL}/?tab=artifacts`, async () => {
    await page.waitForSelector('[data-panel="artifacts"]', { timeout: 5000 }).catch(() => {});
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 15 — Execute tab (all 3 filter rows visible)
  // ════════════════════════════════════════════════════════════════════════════
  await shot('11-execute.png', `${BASE_URL}/?tab=test-execution`, async () => {
    await page.waitForSelector('[data-panel="test-execution"]', { timeout: 5000 }).catch(() => {});
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 16 — Results tab
  // ════════════════════════════════════════════════════════════════════════════
  await shot('12-results.png', `${BASE_URL}/?tab=results`, async () => {
    await page.waitForSelector('[data-panel="results"]', { timeout: 5000 }).catch(() => {});
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 17 — Assistant chat FAB open
  // ════════════════════════════════════════════════════════════════════════════
  await shot('13-chat.png', `${BASE_URL}/?tab=run`, async () => {
    const fab = await page.$('#assistantFab');
    if (fab) {
      await fab.click({ force: true });
      await sleep(700);
    }
  });

  await browser.close();
  server.kill();

  console.log('\nAll screenshots saved to:', OUT_DIR);
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png'));
  console.log('Files:', files.sort().join(', '));
}

capture().catch(e => { console.error(e); process.exit(1); });
