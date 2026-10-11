// Bridge-only native adapter for Pi global MCP settings. Other Pi extensions may
// supply an inline adapter config that intentionally excludes these servers.
import { createMcpAdapter } from 'pi-mcp-adapter';
import { readJSON, locations } from '../src/common.mjs';
import path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function globalMcp(pi: ExtensionAPI) {
  if (process.env.PI_SHARED_BRIDGE !== '1') return;
  const config = readJSON(path.join(locations().data, 'mcp.json'));
  if (!Object.keys(config.mcpServers || {}).length) return;
  const rename = (s: string) => `pi_global_${s}`;
  const api = new Proxy(pi, {
    get(target, key) {
      if (key === 'registerTool') return (tool: any) => target.registerTool({ ...tool, name: rename(tool.name) });
      if (key === 'registerCommand') return (name: string, command: any) => target.registerCommand(rename(name), command);
      if (key === 'registerFlag') return (name: string, flag: any) => target.registerFlag(rename(name), flag);
      if (key === 'getFlag') return (name: string) => target.getFlag(rename(name));
      if (key === 'setActiveTools') return (names: string[]) => target.setActiveTools(names.map(n => n === 'mcp' || n === 'mcpScript' ? rename(n) : n));
      if (key === 'getActiveTools') return () => target.getActiveTools().map(n => n.startsWith('pi_global_') ? n.slice(10) : n);
      return Reflect.get(target, key);
    }
  });
  createMcpAdapter({ config })(api);
}
