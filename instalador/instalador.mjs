// pjecalc-mcp-skill · instalador/instalador.mjs
// Instalação, conferência e desinstalação para quem não é técnico. Chamado pelos arquivos .bat da
// raiz (que garantem o Node.js). Uso: node instalador.mjs instalar|conferir|desinstalar [--sim]
//   --sim: responde "sim" a tudo (testes). As pastas dos agentes seguem APPDATA/LOCALAPPDATA/USERPROFILE.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const SERVIDOR = path.join(RAIZ, 'server', 'server.mjs');
const NODE = process.execPath;
const modo = process.argv[2] || 'instalar';
const SIM = process.argv.includes('--sim');
const loc = await import(pathToFileURL(path.join(RAIZ, 'server', 'lib', 'localizar.mjs')).href);

const rl = SIM ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
const perguntar = (q) => (SIM ? Promise.resolve('') : new Promise((r) => rl.question(q, (x) => r(x.trim()))));
const sim = async (q) => { if (SIM) { console.log(`${q} S (automático)`); return true; } return /^(s|sim|y|yes|)$/i.test(await perguntar(`${q} [S/n] `)); };
const titulo = (t) => console.log(`\n=== ${t} ===`);
const ok = (t) => console.log(`  [OK] ${t}`);
const aviso = (t) => console.log(`  [!]  ${t}`);

const appdata = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const localappdata = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function backup(arquivo) {
  if (fs.existsSync(arquivo)) {
    const b = `${arquivo}.bak-pjecalc-mcp-${carimbo()}`;
    fs.copyFileSync(arquivo, b);
    return b;
  }
  return null;
}
function lerJson(arquivo) {
  if (!fs.existsSync(arquivo)) return {};
  const t = fs.readFileSync(arquivo, 'utf-8').replace(/^﻿/, '');
  if (!t.trim()) return {};
  try { return JSON.parse(t); } catch { throw new Error(`o arquivo ${arquivo} não é um JSON válido (corrija ou apague-o e rode de novo)`); }
}
function gravarJson(arquivo, obj) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, `${JSON.stringify(obj, null, 2)}\n`);
}
const entrada = () => ({ command: NODE, args: [SERVIDOR] });

// ---------------------------------------------------------------------------
// Agentes: onde cada um guarda a lista de servidores MCP
// ---------------------------------------------------------------------------
function pastasClaudeDesktop() {
  const out = [path.join(appdata(), 'Claude')];
  try {
    const pk = path.join(localappdata(), 'Packages');
    for (const d of fs.readdirSync(pk)) if (/^Claude_/i.test(d)) out.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude'));
  } catch { /* sem versão da Microsoft Store */ }
  return out.filter((p) => fs.existsSync(p));
}
function temComando(cmd) {
  try { execFileSync('where.exe', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}
function jsonServidores(nome, arquivo, chave, comTipo = false) {
  return {
    nome, arquivo,
    registrado: () => { try { return Boolean((lerJson(arquivo)[chave] || {}).pjecalc); } catch { return false; } },
    registrar: () => {
      const j = lerJson(arquivo);
      const b = backup(arquivo);
      j[chave] = { ...(j[chave] || {}), pjecalc: comTipo ? { type: 'stdio', ...entrada() } : entrada() };
      gravarJson(arquivo, j);
      return b;
    },
    remover: () => {
      const j = lerJson(arquivo);
      if (!(j[chave] || {}).pjecalc) return null;
      const b = backup(arquivo);
      delete j[chave].pjecalc;
      gravarJson(arquivo, j);
      return b;
    },
  };
}
function agentes() {
  const casa = os.homedir();
  const lista = [];
  for (const p of pastasClaudeDesktop()) lista.push(jsonServidores('Claude Desktop', path.join(p, 'claude_desktop_config.json'), 'mcpServers'));
  if (!process.env.INSTALADOR_SEM_CLI && temComando('claude')) {
    lista.push({
      nome: 'Claude Code', arquivo: '(comando claude mcp)',
      registrado: () => { try { return /pjecalc/.test(execFileSync('claude', ['mcp', 'list'], { encoding: 'utf-8', shell: true, timeout: 60000 })); } catch { return false; } },
      registrar: () => {
        spawnSync('claude', ['mcp', 'remove', 'pjecalc', '--scope', 'user'], { shell: true, stdio: 'ignore' });
        const r = spawnSync('claude', ['mcp', 'add', 'pjecalc', '--scope', 'user', '--', `"${NODE}"`, `"${SERVIDOR}"`], { shell: true, encoding: 'utf-8' });
        if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'falha no claude mcp add').trim());
        return null;
      },
      remover: () => { spawnSync('claude', ['mcp', 'remove', 'pjecalc', '--scope', 'user'], { shell: true, stdio: 'ignore' }); return null; },
    });
  }
  if (fs.existsSync(path.join(casa, '.cursor'))) lista.push(jsonServidores('Cursor', path.join(casa, '.cursor', 'mcp.json'), 'mcpServers'));
  if (fs.existsSync(path.join(appdata(), 'Code', 'User'))) lista.push(jsonServidores('VS Code', path.join(appdata(), 'Code', 'User', 'mcp.json'), 'servers', true));
  if (fs.existsSync(path.join(casa, '.codeium', 'windsurf'))) lista.push(jsonServidores('Windsurf', path.join(casa, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers'));
  if (fs.existsSync(path.join(casa, '.codex'))) {
    const arquivo = path.join(casa, '.codex', 'config.toml');
    const tirar = (t) => t.replace(/\n?\[mcp_servers\.pjecalc\][\s\S]*?(?=\n\[|$)/, '');
    const q = (s) => `'${s}'`; // string literal TOML (sem escapes: barras do Windows ficam intactas)
    lista.push({
      nome: 'Codex', arquivo,
      registrado: () => fs.existsSync(arquivo) && /\[mcp_servers\.pjecalc\]/.test(fs.readFileSync(arquivo, 'utf-8')),
      registrar: () => {
        const t = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf-8') : '';
        const b = backup(arquivo);
        fs.writeFileSync(arquivo, `${tirar(t).replace(/\s*$/, '')}\n\n[mcp_servers.pjecalc]\ncommand = ${q(NODE)}\nargs = [${q(SERVIDOR)}]\n`);
        return b;
      },
      remover: () => {
        if (!fs.existsSync(arquivo)) return null;
        const t = fs.readFileSync(arquivo, 'utf-8');
        if (!/\[mcp_servers\.pjecalc\]/.test(t)) return null;
        const b = backup(arquivo);
        fs.writeFileSync(arquivo, `${tirar(t).replace(/\s*$/, '')}\n`);
        return b;
      },
    });
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Passos
// ---------------------------------------------------------------------------
async function passoPjeCalc() {
  titulo('1. Procurando o PJe-Calc no computador');
  let r = await loc.localizar();
  if (r.valida) { ok(`Encontrado: ${r.pasta} (versão ${r.versao || '?'}, ${r.origem})`); return r; }
  if (r.candidatas.length > 1) {
    console.log('  Encontrei mais de uma instalação:');
    r.candidatas.forEach((c, i) => console.log(`    ${i + 1}) ${c.pasta}  (versão ${c.versao || '?'})`));
    let n = SIM ? 1 : Number(await perguntar('  Qual usar? Digite o número: '));
    if (!(n >= 1 && n <= r.candidatas.length)) n = 1;
    r = loc.escolher(r.candidatas[n - 1].pasta);
    ok(`Usando: ${r.pasta}`);
    return r;
  }
  aviso('Não encontrei o PJe-Calc. Ele precisa estar baixado e extraído (a pasta tem "bin" e "tomcat").');
  aviso('Se ainda não tem, baixe o PJe-Calc Cidadão no site oficial do TRT da 8ª Região.');
  for (let tentativa = 0; tentativa < 3 && !SIM; tentativa++) {
    const p = (await perguntar('  Se já tem, cole aqui a pasta do PJe-Calc (ou Enter para pular): ')).replace(/^"|"$/g, '');
    if (!p) break;
    try { r = loc.escolher(p); ok(`Usando: ${r.pasta}`); return r; } catch (e) { aviso(e.message); }
  }
  aviso('Continuando sem o PJe-Calc: o agente vai procurar de novo quando você pedir um cálculo.');
  return r;
}

async function passoAgentes() {
  titulo('2. Registrando nos agentes de IA');
  const lista = agentes();
  if (!lista.length) {
    aviso('Não encontrei Claude Desktop, Claude Code, Codex, Cursor, VS Code nem Windsurf neste computador.');
    aviso('Instale um deles e rode este instalador de novo (ou veja mcp-config.json para registrar à mão).');
    return [];
  }
  const feitos = [];
  for (const a of lista) {
    if (!(await sim(`  Registrar no ${a.nome}?`))) continue;
    try {
      const b = a.registrar();
      ok(`${a.nome}: registrado${b ? ` (cópia de segurança: ${path.basename(b)})` : ''}`);
      feitos.push(a.nome);
    } catch (e) { aviso(`${a.nome}: não consegui registrar — ${e.message}`); }
  }
  return feitos;
}

async function passoTeste() {
  titulo('3. Testando');
  const { conectar } = await import(pathToFileURL(path.join(RAIZ, 'scripts', 'cliente-mcp.mjs')).href);
  const c = await conectar();
  try {
    const info = c.init.result && c.init.result.serverInfo;
    const tools = (await c.enviar('tools/list')).result.tools;
    ok(`Servidor MCP responde (${info && info.version}, ${tools.length} ferramentas)`);
    const ex = JSON.parse(fs.readFileSync(path.join(RAIZ, 'exemplos', 'calculo-referencia.json'), 'utf-8'));
    const v = await c.ferramenta('calculo_validar', { especificacao: ex });
    if (v.valido) ok('Um cálculo de exemplo foi validado'); else aviso(`Validação do exemplo falhou: ${v.erros.join(' | ')}`);
    return true;
  } catch (e) {
    aviso(`O teste falhou: ${e.message}`);
    return false;
  } finally { c.fechar(); }
}

async function instalar() {
  console.log('PJe-Calc MCP — instalação');
  console.log(`Node.js: ${process.version} (${NODE})`);
  const r = await passoPjeCalc();
  const feitos = await passoAgentes();
  const testado = await passoTeste();
  titulo('Pronto');
  if (feitos.length) console.log(`  Registrado em: ${feitos.join(', ')}. Feche e abra ${feitos.length > 1 ? 'esses programas' : 'o programa'} de novo.`);
  if (!r.valida) console.log('  Atenção: o PJe-Calc ainda não foi localizado — veja a mensagem acima.');
  console.log('  Depois é só pedir ao agente, por exemplo: "monte no PJe-Calc o cálculo desta sentença" (anexe a sentença e os documentos).');
  console.log('  Para conferir a instalação a qualquer momento: "Conferir PJe-Calc MCP.bat".');
  return testado;
}

async function conferir() {
  console.log('PJe-Calc MCP — conferência');
  titulo('Node.js');
  const maior = Number(process.versions.node.split('.')[0]);
  if (maior >= 20) ok(`${process.version} (${NODE})`); else aviso(`${process.version} é antigo: o MCP precisa do Node 20 ou mais novo.`);
  titulo('PJe-Calc');
  const r = await loc.localizar();
  if (r.valida) ok(`${r.pasta} (versão ${r.versao || '?'}, ${r.origem})`); else aviso(r.mensagem);
  const emExecucao = await loc.instalacoesEmExecucao();
  console.log(`  ${emExecucao.length ? 'Está aberto agora.' : 'Está fechado (o MCP abre sozinho quando precisar).'}`);
  titulo('Agentes de IA');
  const lista = agentes();
  if (!lista.length) aviso('Nenhum agente compatível encontrado.');
  for (const a of lista) console.log(`  ${a.registrado() ? '[OK]' : '[--]'} ${a.nome}${a.registrado() ? '' : ' (não registrado: rode "Instalar PJe-Calc MCP.bat")'}`);
  await passoTeste();
}

async function desinstalar() {
  console.log('PJe-Calc MCP — desinstalação (só tira o registro dos agentes; o PJe-Calc e os cálculos não são tocados)');
  for (const a of agentes()) {
    if (!a.registrado()) continue;
    if (!(await sim(`  Remover do ${a.nome}?`))) continue;
    try { const b = a.remover(); ok(`${a.nome}: removido${b ? ` (cópia de segurança: ${path.basename(b)})` : ''}`); } catch (e) { aviso(`${a.nome}: ${e.message}`); }
  }
  if (fs.existsSync(loc.arquivoConfig()) && await sim('  Esquecer a pasta do PJe-Calc guardada?')) { fs.rmSync(loc.arquivoConfig()); ok('Pasta esquecida'); }
  console.log('\nPronto. Pode apagar a pasta do PJe-Calc MCP se quiser.');
}

let codigo = 0;
try {
  if (modo === 'instalar') codigo = (await instalar()) ? 0 : 1;
  else if (modo === 'conferir') await conferir();
  else if (modo === 'desinstalar') await desinstalar();
  else { console.log('Uso: node instalador.mjs instalar|conferir|desinstalar'); codigo = 2; }
} catch (e) {
  console.log(`\nERRO: ${e.message}`);
  codigo = 1;
}
if (rl) { await perguntar('\nPressione Enter para fechar.'); rl.close(); }
process.exit(codigo);
