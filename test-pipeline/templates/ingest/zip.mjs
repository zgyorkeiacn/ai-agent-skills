/**
 * Minimal zip reader (central directory, stored + deflate) using only node:zlib.
 *
 * CI artifacts arrive as zip archives. The scaffolded pipeline has zero install-time dependencies,
 * so this reads just the subset that matters rather than pulling an archive package.
 * Entry names are sanitised: an entry that would land outside the target folder is refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip archive (no end-of-central-directory record).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory.');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lhName = buf.readUInt16LE(lho + 26);
    const lhExtra = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lhName + lhExtra;
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
    out.push({ name, data });
  }
  return out;
}

/** Extract into `dir`; returns the written absolute paths. */
export function extractZip(buf, dir) {
  const root = path.resolve(dir);
  const written = [];
  for (const e of readZipEntries(buf)) {
    const target = path.resolve(root, e.name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Refusing zip entry outside the target folder: ${e.name}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
    written.push(target);
  }
  return written;
}
