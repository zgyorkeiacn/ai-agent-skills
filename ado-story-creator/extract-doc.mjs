#!/usr/bin/env node
/**
 * Extract plain text from a .docx, .xlsx/.xls file, or an HTTPS URL.
 * Outputs plain text to stdout so the ado-story-creator skill can read it.
 *
 * Usage:
 *   node extract-doc.mjs <file-path-or-https-url>
 *
 * On first use with .docx or .xlsx, installs mammoth and xlsx automatically.
 */

import { createWriteStream } from 'fs';
import { unlink, readFile } from 'fs/promises';
import { extname } from 'path';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const arg = process.argv[2];
if (!arg) {
  process.stderr.write('Usage: node extract-doc.mjs <file-path-or-url>\n');
  process.exit(1);
}

const require = createRequire(import.meta.url);

function ensurePackage(pkg) {
  try {
    require.resolve(pkg);
  } catch {
    process.stderr.write(`Installing ${pkg} (first-time setup)...\n`);
    execSync(`npm install ${pkg} --no-save`, { stdio: 'inherit' });
  }
}

async function extractDocx(filePath) {
  ensurePackage('mammoth');
  const { default: mammoth } = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  if (result.messages.length > 0) {
    result.messages.forEach(m => process.stderr.write(`mammoth: ${m.message}\n`));
  }
  return result.value;
}

async function extractXlsx(filePath) {
  ensurePackage('xlsx');
  const XLSX = await import('xlsx');
  const wb = XLSX.readFile(filePath);
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    return `--- Sheet: ${name} ---\n${XLSX.utils.sheet_to_csv(ws)}`;
  }).join('\n\n');
}

async function downloadUrl(url) {
  const ext = extname(new URL(url).pathname) || '.tmp';
  const tmpFile = join(tmpdir(), `ado-extract-${Date.now()}${ext}`);
  const proto = url.startsWith('https') ? (await import('https')).default : (await import('http')).default;

  await new Promise((resolve, reject) => {
    const file = createWriteStream(tmpFile);
    proto.get(url, res => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', resolve);
      file.on('error', reject);
    }).on('error', reject);
  });

  return { tmpFile, ext: ext.toLowerCase() };
}

async function main() {
  let filePath = arg;
  let tempFile = null;
  let ext = extname(arg).toLowerCase();

  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    const result = await downloadUrl(arg);
    filePath = result.tmpFile;
    tempFile = result.tmpFile;
    ext = result.ext;
  }

  try {
    let text;
    if (ext === '.docx') {
      text = await extractDocx(filePath);
    } else if (ext === '.xlsx' || ext === '.xls') {
      text = await extractXlsx(filePath);
    } else {
      text = await readFile(filePath, 'utf8');
    }
    process.stdout.write(text);
  } finally {
    if (tempFile) {
      await unlink(tempFile).catch(() => {});
    }
  }
}

main().catch(e => {
  process.stderr.write(`extract-doc error: ${e.message}\n`);
  process.exit(1);
});
