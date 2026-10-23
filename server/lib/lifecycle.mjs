// pjecalc-mcp-skill · lib/lifecycle.mjs
// Iniciar/parar/status do PJe-Calc (Tomcat embutido).
//
// Dois modos de início:
//   - "sem-navegador" (padrão do MCP): roda a classe br.jus.pjecalcmcp.IniciarSemNavegador
//     (java/pjecalc-mcp-iniciar.jar), que repete os passos do launcher oficial (porta, banco,
//     persistence.xml, Tomcat) sem abrir o Firefox, sem janela e sem ícone na bandeja;
//   - "normal": exatamente como o iniciarPjeCalc.bat (javaw -jar bin/pjecalc.jar), com a
//     janela do sistema e o navegador.
//
// Parada: no modo "sem-navegador" o MCP cria .dados/pjecalc-mcp.parar e o Tomcat é encerrado
// de forma ordenada (o H2 fecha o arquivo corretamente). Para o launcher oficial, que não
// expõe a porta de shutdown, o processo java é encerrado.

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { home, javaExe, readPorts, readLauncherParams, logsDir, dadosDir } from './env.mjs';
import { ehInstalacao, localizar } from './localizar.mjs';
import { baseUrl } from './rest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JAR_INICIAR = path.resolve(__dirname, '..', '..', 'java', 'pjecalc-mcp-iniciar.jar');
const ARQUIVO_PARADA = () => path.join(dadosDir(), 'pjecalc-mcp.parar');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function isPortOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
    let done = false;
    const finish = (v) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.on('connect', () => finish(true));
    sock.on('error', () => finish(false));
    sock.on('timeout', () => finish(false));
  });
}

/** Processos java do PJe-Calc (launcher oficial ou iniciador do MCP), via PowerShell. */
async function findJavaProcs() {
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" | Where-Object { $_.CommandLine -like '*pjecalc.jar*' } | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"],
        { timeout: 20000, windowsHide: true }, (err, so, se) => (err ? reject(err) : resolve({ stdout: so, stderr: se })));
    });
    return String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf('|');
      const cmd = l.slice(i + 1);
      return { pid: Number(l.slice(0, i)), modo: /IniciarSemNavegador/.test(cmd) ? 'sem-navegador' : 'normal' };
    }).filter((p) => Number.isFinite(p.pid));
  } catch {
    return [];
  }
}

/** A aplicação web responde (página inicial renderizada, não só o HTML estático). */
async function appPronta() {
  try {
    const res = await fetch(`${baseUrl()}/pjecalc/pages/principal.jsf`, { signal: AbortSignal.timeout(8000) });
    const t = await res.text();
    return res.status === 200 && /Criar Novo|PJe-Calc/i.test(t);
  } catch {
    return false;
  }
}

/** Status completo do aplicativo. */
export async function status() {
  const inst = ehInstalacao(home());
  if (!inst) {
    const loc = await localizar();
    if (!loc.valida) return { rodando: false, instalacaoEncontrada: false, processos: [], mensagem: loc.mensagem, candidatas: loc.candidatas };
  }
  const ports = readPorts();
  const procs = await findJavaProcs();
  const httpOpen = await isPortOpen(ports.http);
  const pronta = httpOpen ? await appPronta() : false;
  let versao = null;
  if (httpOpen) {
    try {
      const res = await fetch(`${baseUrl()}/pjecalc/versao.html`, { signal: AbortSignal.timeout(5000) });
      const m = (await res.text()).match(/Vers[aã]o:\s*([\d.]+)/i);
      if (m) versao = m[1];
    } catch { /* ignore */ }
  }
  return {
    rodando: httpOpen && pronta,
    processos: procs,
    portaHttpAberta: httpOpen,
    aplicacaoRespondendo: pronta,
    versaoWeb: versao,
    bancoExiste: fs.existsSync(path.join(dadosDir(), 'pjecalc.h2.db')),
    portas: ports,
    url: `${baseUrl()}/pjecalc`,
  };
}

function argumentosJvm() {
  const p = readLauncherParams();
  return [
    `-Duser.timezone=${p.timezone || 'GMT-3'}`,
    `-Dfile.encoding=${p.fileEncoding || 'ISO-8859-1'}`,
    ...(p.tokenServicos ? [`-Dseguranca.pjecalc.tokenServicos=${p.tokenServicos}`] : []),
    ...(p.contextoPje ? [`-Dseguranca.pjekz.servico.contexto=${p.contextoPje}`] : []),
    `-Xms${p.xms || 1024}m`,
    `-Xmx${p.xmx || 2048}m`,
  ];
}

/**
 * Inicia o PJe-Calc e aguarda a aplicação responder.
 * modo "sem-navegador" (padrão) | "normal" (igual ao .bat oficial, abre janela e navegador).
 */
export async function start({ modo = 'sem-navegador', aguardarMs = 180000 } = {}) {
  const st = await status();
  if (st.instalacaoEncontrada === false) throw new Error(st.mensagem);
  if (st.rodando) return { ...st, mensagem: 'O PJe-Calc já está em execução.' };
  if (st.processos.length) {
    // processo existe mas o Tomcat ainda está subindo: só aguarda
    return aguardarPronto(aguardarMs, { mensagem: 'O PJe-Calc já estava iniciando; aguardando.' });
  }
  try { fs.unlinkSync(ARQUIVO_PARADA()); } catch { /* não existia */ }
  fs.mkdirSync(logsDir(), { recursive: true });
  let child;
  if (modo === 'normal') {
    const javaw = javaExe().replace(/java\.exe$/i, 'javaw.exe');
    child = spawn(javaw, ['-splash:pjecalc_splash.gif', ...argumentosJvm(), '-XX:MaxPermSize=512m', '-jar', 'bin/pjecalc.jar'],
      { cwd: home(), detached: true, stdio: 'ignore', windowsHide: false });
  } else {
    if (!fs.existsSync(JAR_INICIAR)) throw new Error(`Iniciador não encontrado: ${JAR_INICIAR}. Rode java/compilar.sh.`);
    const out = fs.openSync(path.join(logsDir(), 'mcp-headless.log'), 'a');
    const err = fs.openSync(path.join(logsDir(), 'mcp-headless.err.log'), 'a');
    const cp = [path.join('bin', 'pjecalc.jar'), JAR_INICIAR].join(path.delimiter);
    child = spawn(javaExe(), ['-cp', cp, ...argumentosJvm(), 'br.jus.pjecalcmcp.IniciarSemNavegador'],
      { cwd: home(), detached: true, stdio: ['ignore', out, err], windowsHide: true });
    fs.closeSync(out);
    fs.closeSync(err);
  }
  child.unref();
  return aguardarPronto(aguardarMs, { iniciado: true, pid: child.pid, modo });
}

async function aguardarPronto(aguardarMs, extra = {}) {
  const fim = Date.now() + aguardarMs;
  let pronto = false;
  while (Date.now() < fim) {
    if (await appPronta()) { pronto = true; break; }
    await esperar(2000);
  }
  const st = await status();
  return { ...extra, pronto, ...st, logs: [path.join(logsDir(), 'mcp-headless.log'), path.join(logsDir(), 'mcp-headless.err.log')] };
}

/** Para o PJe-Calc (ordenadamente quando iniciado pelo MCP; senão encerra o processo). */
export async function stop({ forcar = false, aguardarMs = 60000 } = {}) {
  let procs = await findJavaProcs();
  if (!procs.length) return { ...(await status()), mensagem: 'O PJe-Calc não está em execução.' };
  const metodo = [];
  if (!forcar && procs.some((p) => p.modo === 'sem-navegador')) {
    fs.writeFileSync(ARQUIVO_PARADA(), new Date().toISOString());
    metodo.push('arquivo de parada (.dados/pjecalc-mcp.parar)');
    const fim = Date.now() + aguardarMs;
    while (Date.now() < fim) {
      await esperar(1000);
      procs = await findJavaProcs();
      if (!procs.some((p) => p.modo === 'sem-navegador')) break;
    }
  }
  procs = await findJavaProcs();
  if (procs.length) {
    metodo.push('encerramento do processo java');
    await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Stop-Process -Id ${procs.map((p) => p.pid).join(',')} -Force -ErrorAction SilentlyContinue`],
      { timeout: 20000, windowsHide: true }, () => resolve());
    });
    await esperar(3000);
  }
  try { fs.unlinkSync(ARQUIVO_PARADA()); } catch { /* ok */ }
  const st = await status();
  return { ...st, encerrado: !st.processos.length, metodo };
}

/** Cauda dos logs do Tomcat/MCP. */
export function tailLogs({ linhas = 60, arquivo = null } = {}) {
  const dir = logsDir();
  let files;
  if (arquivo) {
    files = [path.isAbsolute(arquivo) ? arquivo : path.join(dir, arquivo)];
  } else {
    files = fs.readdirSync(dir).filter((f) => /\.(log|txt)$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t).slice(0, 4).map((x) => path.join(dir, x.f));
  }
  const out = {};
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'latin1');
    out[path.basename(f)] = text.split(/\r?\n/).filter((l) => l.trim()).slice(-linhas);
  }
  return out;
}

/**
 * Por que o PJe-Calc parou de responder, lido no log desde a última inicialização: falta de memória do Java
 * (o banco é fechado e a aplicação para de responder) ou banco fechado por outro motivo. null se nada consta.
 */
export function diagnosticoDoLog(texto) {
  const desde = texto.lastIndexOf('Server startup in');
  const t = desde >= 0 ? texto.slice(desde) : texto;
  if (/java\.lang\.OutOfMemoryError|Out of memory\./.test(t)) {
    return 'O PJe-Calc ficou sem memória (OutOfMemoryError) e o banco foi fechado: a aplicação não responde mais. Use pjecalc_parar e depois pjecalc_iniciar; os cálculos já gravados não se perdem. Se a falha veio durante a atualização das tabelas, rode tabelas_atualizar de novo depois de reiniciar.';
  }
  if (/The database has been closed|90098-/.test(t)) {
    return 'O banco do PJe-Calc foi fechado e a aplicação não responde mais. Use pjecalc_parar e depois pjecalc_iniciar.';
  }
  return null;
}

export function diagnosticoDeFalha() {
  const f = path.join(logsDir(), 'mcp-headless.err.log');
  if (!fs.existsSync(f)) return null;
  const tam = fs.statSync(f).size;
  const fd = fs.openSync(f, 'r');
  const n = Math.min(tam, 4 * 1024 * 1024);
  const buf = Buffer.alloc(n);
  fs.readSync(fd, buf, 0, n, tam - n);
  fs.closeSync(fd);
  return diagnosticoDoLog(buf.toString('latin1'));
}

/** Linhas de erro (GRAVE/SEVERE/Exception) recentes do log do Tomcat, para diagnóstico. */
export function errosRecentes({ desde = null, max = 40 } = {}) {
  const f = path.join(logsDir(), 'mcp-headless.err.log');
  if (!fs.existsSync(f)) return [];
  const linhas = fs.readFileSync(f, 'latin1').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (/^(GRAVE|SEVERE)|Caused by|Exception:|NegocioException|ValidacaoException/.test(l) && !/persisted sessions|loading sessions|InvalidClassException/.test(l)) {
      out.push(l.trim());
    }
  }
  return out.slice(-max);
}
