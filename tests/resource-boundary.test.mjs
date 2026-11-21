import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSkillSources } from '../src/pi.mjs';

test('SDK seam removes only owned skill aliases and restores the inherited method', async () => {
  const skills = new Map([['/managed/SKILL.md', { enabled: true }], ['/package/SKILL.md', { enabled: true }]]);
  const extensions = new Map([['/managed/SKILL.md', { enabled: true }]]);
  const original = function (accumulator) { assert.equal(this, manager); return accumulator; };
  const manager = Object.create({ toResolvedPaths: original });
  manager.resolve = async function () { return this.toResolvedPaths({ skills, extensions }); };
  const result = await resolveSkillSources(manager, new Set(['/managed/SKILL.md']));
  assert.deepEqual([...result.skills.keys()], ['/package/SKILL.md']);
  assert.equal(result.extensions, extensions);
  assert.equal(result.extensions.size, 1);
  assert.equal(Object.hasOwn(manager, 'toResolvedPaths'), false);
  assert.equal(manager.toResolvedPaths, original);
});

test('SDK seam rejects unknown shapes or bypassed boundaries and restores each instance', async () => {
  const owned = new Set(['/managed/SKILL.md']);
  await assert.rejects(resolveSkillSources({ resolve: async () => ({}) }, owned), /Unsupported Pi SDK skill resolution boundary/);
  for (const accumulator of [{ skills: [] }, { skills: new Map([[null, {}]]) }]) {
    const original = value => value;
    const manager = { toResolvedPaths: original, async resolve() { return this.toResolvedPaths(accumulator); } };
    await assert.rejects(resolveSkillSources(manager, owned), /Unsupported Pi SDK skill (accumulator|path)/);
    assert.equal(manager.toResolvedPaths, original);
  }
  const original = value => value;
  const manager = { toResolvedPaths: original, async resolve() { return { skills: [] }; } };
  await assert.rejects(resolveSkillSources(manager, owned), /Unsupported Pi SDK skill resolution flow/);
  assert.equal(manager.toResolvedPaths, original);
});

test('SDK resolution errors propagate and fresh installations need no private boundary', async () => {
  const failure = new Error('resolver failure');
  const original = value => value;
  const manager = { toResolvedPaths: original, async resolve() { throw failure; } };
  await assert.rejects(resolveSkillSources(manager, new Set(['/managed/SKILL.md'])), error => error === failure);
  assert.equal(manager.toResolvedPaths, original);
  const fresh = { skills: [] };
  assert.equal(await resolveSkillSources({ resolve: async () => fresh }, new Set()), fresh);
});
