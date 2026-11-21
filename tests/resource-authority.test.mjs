import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadResources } from '../src/pi.mjs';
import { synchronize } from '../src/sync.mjs';
import { saveJSON } from '../src/common.mjs';

async function probe(scenario) {
  const home = process.env.HOME, data = path.join(home, 'agent'), state = path.join(data, 'shared-runtime');
  const loc = { home, data, state }, pkg = path.join(home, 'package'), workspace = path.join(home, 'workspace');
  const name = 'authority-probe', source = path.join(pkg, 'skills', name), target = path.join(home, '.agents/skills', name);
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\ncanonical marker\n`);
  saveJSON(path.join(pkg, 'package.json'), { name: 'authority-fixture', pi: { skills: ['skills'] } });
  const settings = path.join(data, 'settings.json'), project = path.join(workspace, '.pi/settings.json');
  saveJSON(settings, { packages: [pkg] });
  const found = async cwd => (await loadResources(cwd, loc)).loader.getSkills().skills.find(skill => skill.name === name);
  await synchronize({ cwd: home, loc });
  assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
  if (scenario === 'repeated') {
    for (let i = 0; i < 6; i++) {
      for (const cwd of [home, workspace]) {
        const skill = await found(cwd);
        assert.ok(skill, `enabled package survives generated links, iteration ${i}, cwd ${cwd}`);
        assert.equal(fs.realpathSync(skill.filePath), path.join(source, 'SKILL.md'));
      }
      const report = await synchronize({ cwd: home, loc });
      assert.ok(report.skills.some(skill => skill.name === name));
      assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
    }
  } else if (scenario === 'removed' || scenario === 'disabled') {
    saveJSON(settings, { packages: scenario === 'removed' ? [] : [{ source: pkg, skills: [] }] });
    for (let i = 0; i < 3; i++) {
      assert.equal(await found(home), undefined); assert.equal(await found(workspace), undefined);
      await synchronize({ cwd: home, loc }); assert.equal(fs.existsSync(target), false);
    }
  } else if (scenario === 'project-disabled') {
    saveJSON(project, { packages: [{ source: pkg, skills: [] }] });
    assert.equal(await found(workspace), undefined); assert.ok(await found(home));
    await synchronize({ cwd: home, loc }); assert.equal(await found(workspace), undefined);
  } else if (scenario === 'project-enabled') {
    saveJSON(settings, { packages: [{ source: pkg, skills: [] }] });
    saveJSON(project, { packages: [pkg] });
    assert.equal(await found(home), undefined); assert.ok(await found(workspace));
  } else if (scenario === 'user-replaced') {
    fs.unlinkSync(target);
    const external = path.join(home, 'external', name); fs.mkdirSync(external, { recursive: true });
    fs.writeFileSync(path.join(external, 'SKILL.md'), `---\nname: ${name}\ndescription: user-owned\n---\nuser marker\n`);
    fs.symlinkSync(external, target, 'dir');
    saveJSON(settings, { packages: [] });
    for (let i = 0; i < 3; i++) {
      assert.equal(fs.realpathSync((await found(home)).filePath), path.join(external, 'SKILL.md'));
      await synchronize({ cwd: home, loc });
      assert.equal(fs.readlinkSync(target), external, 'stale receipt must not claim a user replacement');
    }
  }
}

if (process.argv[2] === '--probe') await probe(process.argv[3]);
else for (const scenario of ['repeated','removed','disabled','project-disabled','project-enabled','user-replaced']) {
  test(`real SDK skill authority: ${scenario}`, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-authority-'));
    try {
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--probe', scenario], { cwd: home, env: { ...process.env, HOME: home, PI_SHARED_HOME: home, PI_SHARED_DATA_DIR: path.join(home, 'agent'), PI_SHARED_BRIDGE: '1' }, encoding: 'utf8', timeout: 60000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}
