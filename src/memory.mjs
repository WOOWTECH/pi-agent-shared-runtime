import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { locked } from './common.mjs';

const MAX_BYTES = 16384;
function failure(code) { return Object.assign(new Error(code), { code }); }
function validateKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(key)) throw failure('MEMORY_INVALID_KEY');
}
function validateRevision(revision) {
  if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9-]{36}$/.test(revision))) throw failure('MEMORY_INVALID_REVISION');
}
function directory(loc) {
  fs.mkdirSync(loc.data, { recursive: true, mode: 0o700 });
  let current = fs.realpathSync(loc.data);
  for (const part of ['shared-runtime', 'memory']) {
    current = path.join(current, part);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('MEMORY_UNSAFE_DIRECTORY');
  }
  return current;
}
function read(root, key) {
  let fd;
  try {
    const file = path.join(root, key + '.json');
    if (fs.lstatSync(file).isSymbolicLink()) throw failure('MEMORY_UNSAFE_FILE');
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES * 2) throw failure('MEMORY_CORRUPT');
    const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (value.version !== 1 || value.key !== key || typeof value.content !== 'string' || Buffer.byteLength(value.content) > MAX_BYTES || typeof value.updatedAt !== 'string') throw failure('MEMORY_CORRUPT');
    validateRevision(value.revision);
    if (value.revision === null) throw failure('MEMORY_CORRUPT');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw failure('MEMORY_CORRUPT');
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
async function serialize(root, action) {
  const lock = path.join(root, '.lock');
  const deadline = Date.now() + 5000;
  do {
    try {
      if (fs.existsSync(lock) && fs.lstatSync(lock).isSymbolicLink()) throw failure('MEMORY_UNSAFE_LOCK');
      const result = await locked(lock, action);
      if (!result?.busy) return result;
    } catch (error) {
      // Another writer can release the directory between the lock's metadata reads.
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw failure('MEMORY_BUSY');
}
export function memoryRead(loc, key) { validateKey(key); return read(directory(loc), key); }
export function memoryList(loc, prefix = '') {
  if (typeof prefix !== 'string' || prefix.length > 120 || !/^[a-zA-Z0-9._-]*$/.test(prefix)) throw failure('MEMORY_INVALID_KEY');
  const root = directory(loc);
  const keys = fs.readdirSync(root).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(key => key.startsWith(prefix)).sort();
  if (keys.length > 200) throw failure('MEMORY_LIST_TOO_LARGE');
  return keys.map(key => { validateKey(key); const value = read(root, key); return value && { key, revision: value.revision, updatedAt: value.updatedAt }; }).filter(Boolean);
}
export async function memoryWrite(loc, { key, content, expectedRevision }) {
  validateKey(key); validateRevision(expectedRevision);
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES) throw failure('MEMORY_INVALID_CONTENT');
  const root = directory(loc);
  return serialize(root, () => {
    const previous = read(root, key);
    if ((previous?.revision ?? null) !== expectedRevision) throw failure('MEMORY_CONFLICT');
    const value = { version: 1, key, content, revision: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    const tmp = path.join(root, '.' + crypto.randomUUID() + '.tmp');
    try {
      fs.writeFileSync(tmp, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, path.join(root, key + '.json'));
    } finally { fs.rmSync(tmp, { force: true }); }
    return value;
  });
}
export async function memoryDelete(loc, { key, expectedRevision }) {
  validateKey(key); validateRevision(expectedRevision);
  if (expectedRevision === null) throw failure('MEMORY_INVALID_REVISION');
  const root = directory(loc);
  return serialize(root, () => {
    const previous = read(root, key);
    if (!previous || previous.revision !== expectedRevision) throw failure('MEMORY_CONFLICT');
    fs.unlinkSync(path.join(root, key + '.json'));
    return { deleted: true, key };
  });
}
