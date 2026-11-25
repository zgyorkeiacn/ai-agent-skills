#!/usr/bin/env node
/**
 * Render each HTML report to PDF.
 *
 * Optional throughout. Playwright's bundled Chromium is reused when the target repo already has it,
 * because a pipeline that works should not also demand a second browser install. When there is no
 * browser at all this exits quietly with a note - the HTML reports are the product, PDFs are a
 * convenience for sharing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './_history.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, t, i, arr) => (t.startsWith('--') ? [...a, [t.slice(2), arr[i + 1]]] : a), []),
);
const cfg = loadConfig(args.config ?? 'pipeline.config.json');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    console.log('[pdf] no Playwright browser available - skipping PDFs');
    process.exit(0);
  }
}

const dir = cfg.reportsDir;
if (!fs.existsSync(dir)) { console.log('[pdf] no reports directory yet'); process.exit(0); }

const htmls = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
if (!htmls.length) { console.log('[pdf] no HTML reports to render'); process.exit(0); }

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.log(`[pdf] could not launch a browser (${e.message.split('\n')[0]}) - skipping PDFs`);
  process.exit(0);
}

let made = 0;
for (const f of htmls) {
  const src = path.resolve(dir, f);
  const out = src.replace(/\.html$/, '.pdf');
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  try {
    await page.goto('file:///' + src.replace(/\\/g, '/'), { waitUntil: 'load' });
    // Every collapsed section is opened first. A PDF of a report with its detail still folded away
    // is a picture of the headings, which is not what anyone wants from a document they cannot
    // click.
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => { d.open = true; });
    });
    await page.pdf({
      path: out,
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
    });
    made++;
    console.log(`[pdf] ${path.basename(out)}`);
  } catch (e) {
    console.log(`[pdf] ${f} failed: ${e.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(`[pdf] ${made} PDF(s) written to ${dir}`);
