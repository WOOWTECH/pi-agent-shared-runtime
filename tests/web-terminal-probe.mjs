// Live Pi Web terminal integration; opens and closes its own temporary terminals.
import crypto from 'node:crypto';
import path from 'node:path';
import { api } from '../src/host.mjs';
import { locations, saveJSON } from '../src/common.mjs';
const report = { date: new Date().toISOString(), terminals: [] };
for (const name of ['codex', 'claude']) {
  const id = crypto.randomBytes(16).toString('hex');
  let output = '';
  const abort = new AbortController();
  try {
    await api('/api/terminal', { id, cwd: path.join(locations().home, 'pi-cwd-20260817'), cols: 110, rows: 32 });
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 30141}/api/terminal/${id}/events`, { signal: abort.signal });
    const collect = (async () => {
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      try { while (true) { const v = await reader.read(); if (v.done) break; output += decoder.decode(v.value); } } catch {}
    })();
    await api(`/api/terminal/${id}`, { type: 'input', data: `${name}\r` });
    await new Promise(r => setTimeout(r, 14000));
    abort.abort(); await collect;
    report.terminals.push({ name, commandNotFound: /command not found/.test(output),
      tuiVisible: name === 'codex' ? /OpenAI Codex|codex-cli|gpt-5|Codex/.test(output) : /Claude Code|Welcome|trust this|workspace/i.test(output),
      outputBytes: output.length });
    console.log(JSON.stringify(report.terminals.at(-1)));
  } finally { abort.abort(); await api(`/api/terminal/${id}`, undefined, { method: 'DELETE' }); }
}
saveJSON(path.join(locations().state, 'web-terminal-probe.json'), report);
