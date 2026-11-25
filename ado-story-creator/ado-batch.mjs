#!/usr/bin/env node
/**
 * Submit a work-item hierarchy to the ADO batch API.
 * Reads the batch body JSON from stdin.
 * Writes a JSON array of { tempId, realId, title, code, error } to stdout.
 *
 * Exit codes:
 *   0 — all items created (some may have partial errors — check the output)
 *   1 — request-level failure (auth, network, malformed body)
 *   2 — batch endpoint not supported by this org (trigger sequential fallback)
 *
 * Usage:
 *   echo $batchJson | node ado-batch.mjs --org vfuk-digital --project Digital --pat <pat>
 */

import { request } from 'undici';

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1];
    }
  }
  return result;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const { org, project, pat } = parseArgs(process.argv);

  if (!org || !project || !pat) {
    process.stderr.write('Usage: node ado-batch.mjs --org <org> --project <project> --pat <pat>\n');
    process.exit(1);
  }

  const raw = await readStdin();
  let batchBody;
  try {
    batchBody = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`Invalid JSON on stdin: ${e.message}\n`);
    process.exit(1);
  }

  if (!Array.isArray(batchBody) || batchBody.length === 0) {
    process.stderr.write('Batch body must be a non-empty array.\n');
    process.exit(1);
  }

  const auth = Buffer.from(`:${pat}`).toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };

  let statusCode, responseBody;
  try {
    const resp = await request(
      `https://dev.azure.com/${org}/_apis/wit/$batch?api-version=7.1`,
      { method: 'POST', headers, body: JSON.stringify(batchBody) },
    );
    statusCode = resp.statusCode;
    responseBody = await resp.body.json();
  } catch (e) {
    process.stderr.write(`Network error: ${e.message}\n`);
    process.exit(1);
  }

  // 404 or explicit "batch not supported" message → exit 2 for sequential fallback
  if (statusCode === 404) {
    process.stderr.write('BATCH_NOT_SUPPORTED\n');
    process.exit(2);
  }
  if (responseBody?.message && /batch/i.test(responseBody.message)) {
    process.stderr.write('BATCH_NOT_SUPPORTED\n');
    process.exit(2);
  }

  if (statusCode >= 400) {
    process.stderr.write(JSON.stringify(responseBody, null, 2) + '\n');
    process.exit(1);
  }

  const items = Array.isArray(responseBody.value) ? responseBody.value : responseBody;

  // Map each response item back to its tempId using the batch body index
  const results = items.map((item, i) => {
    const bodyOps = batchBody[i]?.body ?? [];
    const tempIdOp = bodyOps.find(op => op.path === '/id');
    return {
      tempId: tempIdOp?.value ?? -(i + 1),
      realId: item.body?.id ?? null,
      title: item.body?.fields?.['System.Title'] ?? '',
      code: item.code ?? 0,
      error: (item.code >= 400) ? (item.body?.message ?? 'Unknown error') : null,
    };
  });

  process.stdout.write(JSON.stringify(results, null, 2) + '\n');

  // Exit 1 if any item failed, but still output results so caller can see which ones
  const anyFailed = results.some(r => r.code >= 400);
  process.exit(anyFailed ? 1 : 0);
}

main().catch(e => {
  process.stderr.write(`ado-batch error: ${e.message}\n`);
  process.exit(1);
});
