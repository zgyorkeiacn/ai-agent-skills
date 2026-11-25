/**
 * JUnit XML adapter.
 *
 * Covers Cypress, pytest, Maven Surefire/Failsafe, Jest with a junit reporter, Gradle, NUnit's JUnit
 * output, and most CI runners - JUnit XML is the closest thing the ecosystem has to a lingua franca.
 *
 * Deliberately hand-parsed rather than pulling an XML dependency. The subset of the format that
 * matters here is small and stable, and the scaffolded pipeline having zero install-time
 * dependencies is worth more than perfect generality. If a runner emits something this cannot read,
 * that is a bug worth fixing here rather than a reason to add a package.
 */

import fs from 'node:fs';
import path from 'node:path';
import { classifyMessage } from '../../lib/signature.mjs';

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*'([^']*)'/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

/** Expand a glob-ish path into concrete files. Supports a trailing `*` and `**` only. */
function resolveInputs(spec) {
  if (!spec.includes('*')) return fs.existsSync(spec) ? [spec] : [];
  // A prefix ending in a separator IS the directory; dirname() would step up to its parent and walk
  // far too much (a CI intake extracting into <tmp>/x/ once scanned the whole temp folder).
  const prefix = spec.split('*')[0];
  const dir = /[\\/]$/.test(prefix) ? prefix : path.dirname(prefix);
  if (!fs.existsSync(dir)) return [];
  const rx = new RegExp('^' + path.basename(spec).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/\\\\]*') + '$');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return spec.includes('**') ? walk(p) : [];
    return rx.test(e.name) ? [p] : [];
  });
  return walk(dir);
}

export function parse(resultsPath, opts = {}) {
  const files = resolveInputs(resultsPath);
  if (!files.length) {
    throw new Error(`No JUnit XML found matching ${resultsPath}. Check runner.resultsPath in pipeline.config.json.`);
  }

  const suite = { passed: 0, failed: 0, skipped: 0, flaky: 0, total: 0, durationSec: 0 };
  const specs = [];
  const failureDetail = [];
  let totalTime = 0;

  for (const file of files) {
    const xml = fs.readFileSync(file, 'utf8');

    for (const ts of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
      const suiteAttrs = attrs(ts[1]);
      const body = ts[2];
      totalTime += Number(suiteAttrs.time ?? 0);

      // Self-closing and paired <testcase> both occur in the wild.
      const cases = [
        ...body.matchAll(/<testcase\b([^>]*?)\/>/g),
        ...body.matchAll(/<testcase\b([^>]*?)>([\s\S]*?)<\/testcase>/g),
      ];

      for (const c of cases) {
        const a = attrs(c[1]);
        const inner = c[2] ?? '';

        // Prefer an explicit file attribute; otherwise derive something stable from the class name,
        // because every report groups by this and it must not vary between runs.
        const specFile = a.file
          ?? (a.classname ? a.classname.replace(/\./g, '/') : suiteAttrs.name)
          ?? 'unknown';

        const isSkipped = /<skipped\b/.test(inner);
        const failTag = inner.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/)
          ?? inner.match(/<(failure|error)\b([^>]*)\/>/);
        // Some runners (notably Maven with rerunFailingTestsCount) record a retry that then passed.
        const isRetryFlake = /<(?:flakyFailure|rerunFailure|flakyError)\b/.test(inner);

        let status;
        if (isSkipped) status = 'skipped';
        else if (failTag) status = 'failed';
        else if (isRetryFlake) status = 'flaky';
        else status = 'passed';

        suite.total++;
        suite[status] = (suite[status] ?? 0) + 1;

        specs.push({
          file: specFile,
          title: a.name ?? null,
          status,
          durationSec: Math.round(Number(a.time ?? 0) * 10) / 10,
          attempts: isRetryFlake ? 2 : 1,
        });

        if (status !== 'failed' && status !== 'flaky') continue;

        const fa = failTag ? attrs(failTag[2] ?? '') : {};
        const message = [fa.message, decodeEntities((failTag?.[3] ?? '').replace(/<!\[CDATA\[|\]\]>/g, ''))]
          .filter(Boolean).join(' ').trim();
        if (!message) continue;

        const { signature, kind } = classifyMessage(message, opts);
        failureDetail.push({
          spec: specFile,
          title: a.name ?? null,
          signature,
          kind,
          transient: status === 'flaky',
          message: message.replace(/\s+/g, ' ').slice(0, 600),
        });
      }
    }
  }

  suite.durationSec = Math.round(totalTime * 10) / 10;
  return { suite, specs, failureDetail };
}
