// pjecalc-mcp-skill · scripts/cliente-mcp.mjs
// Cliente MCP mínimo (JSON-RPC sobre stdio) usado pelos testes: sobe o servidor como os agentes
// fazem (node server/server.mjs) e conversa pelo mesmo protocolo.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function conectar() {
  const serverPath = path.resolve(__dirname, '..', 'server', 'server.mjs');
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
  let buf = '';
  let prox = 1;
  const pend = new Map();
  const stderr = [];
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linha = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!linha) continue;
      let m;
      try { m = JSON.parse(linha); } catch { continue; }
      if (m.id != null && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    }
  });
  child.stderr.on('data', (d) => stderr.push(d.toString('utf8')));
  const enviar = (method, params, timeoutMs = 600000) => new Promise((resolve, reject) => {
    const id = prox++;
    const t = setTimeout(() => reject(new Error(`timeout em ${method}`)), timeoutMs);
    pend.set(id, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
  });
  const init = await enviar('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste-pjecalc', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return {
    init,
    stderr,
    enviar,
    async ferramenta(nome, args = {}, timeoutMs) {
      const r = await enviar('tools/call', { name: nome, arguments: args }, timeoutMs);
      if (r.error) throw new Error(`${nome}: ${JSON.stringify(r.error)}`);
      const txt = (r.result.content || []).map((c) => c.text).join('\n');
      if (r.result.isError) { const e = new Error(`${nome}: ${txt}`); e.texto = txt; throw e; }
      try { return JSON.parse(txt); } catch { return txt; }
    },
    fechar() { child.kill(); },
  };
}

export function verificar(cond, msg) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`  ok - ${msg}`);
}
