// pjecalc-mcp-skill · lib/localizar.mjs
// Encontra a instalação do PJe-Calc no computador, sem o usuário precisar configurar nada.
//
// Ordem (para no primeiro que der certo):
//   1. variável PJECALC_HOME (quem quiser fixar o caminho)
//   2. pasta escolhida antes, guardada em %APPDATA%\pjecalc-mcp\config.json
//   3. PJe-Calc em execução: a pasta do java.exe do processo (bin\jre\bin\java.exe -> raiz)
//   4. pasta acima do MCP (repositório clonado dentro da pasta do PJe-Calc)
//   5. busca rasa nos lugares comuns (Downloads, Área de Trabalho, Documentos, OneDrive, Arquivos de
//      Programas e a raiz de cada disco)
// Uma instalação é reconhecida por bin\pjecalc.jar + tomcat\webapps\pjecalc (+ bin\jre).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PJECALC_HOME vazio ou com variável não substituída (configuração opcional de extensão) conta como ausente
const homeDaVariavel = () => { const t = String(process.env.PJECALC_HOME || '').trim(); return t && !t.includes('${') ? t : null; };

export function arquivoConfig() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'pjecalc-mcp', 'config.json');
}

export function lerConfig() {
  try { return JSON.parse(fs.readFileSync(arquivoConfig(), 'utf-8')); } catch { return {}; }
}

export function gravarConfig(dados) {
  const p = arquivoConfig();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...lerConfig(), ...dados, atualizadoEm: new Date().toISOString() }, null, 2));
}

/** A pasta é uma instalação do PJe-Calc? Devolve { pasta, versao, temBanco } ou null. */
export function ehInstalacao(pasta) {
  try {
    if (!pasta) return null;
    const p = path.resolve(pasta);
    if (!fs.existsSync(path.join(p, 'bin', 'pjecalc.jar'))) return null;
    if (!fs.existsSync(path.join(p, 'tomcat', 'webapps', 'pjecalc'))) return null;
    let versao = null;
    try {
      const html = fs.readFileSync(path.join(p, 'tomcat', 'webapps', 'pjecalc', 'versao.html'), 'latin1');
      versao = (/Vers[aã]o:\s*([\d.]+)/i.exec(html) || [])[1] || null;
    } catch { /* sem versão */ }
    return { pasta: p, versao, temJre: fs.existsSync(path.join(p, 'bin', 'jre', 'bin', 'java.exe')), temBanco: fs.existsSync(path.join(p, '.dados', 'pjecalc.h2.db')) };
  } catch {
    return null;
  }
}

/** Pastas do PJe-Calc em execução (pelo caminho do java.exe do processo). */
export function instalacoesEmExecucao() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" | Where-Object { $_.CommandLine -like '*pjecalc*' } | ForEach-Object { $_.ExecutablePath }"],
    { timeout: 20000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const pastas = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        .map((exe) => path.resolve(path.dirname(exe), '..', '..', '..'))
        .map(ehInstalacao).filter(Boolean);
      resolve(pastas);
    });
  });
}

const IGNORAR = /^(windows|\$recycle\.bin|system volume information|programdata|appdata|node_modules|\.git|recovery|perflogs|msocache|config\.msi|boot|intel|amd|nvidia)$/i;

function varrer(raiz, profundidade, achadas, limite = { dirs: 0 }) {
  if (profundidade < 0 || limite.dirs > 20000) return;
  let entradas;
  try { entradas = fs.readdirSync(raiz, { withFileTypes: true }); } catch { return; }
  limite.dirs++;
  const inst = ehInstalacao(raiz);
  if (inst) { achadas.set(inst.pasta.toLowerCase(), inst); return; }
  for (const e of entradas) {
    if (!e.isDirectory() || IGNORAR.test(e.name)) continue;
    varrer(path.join(raiz, e.name), profundidade - 1, achadas, limite);
  }
}

/** Busca rasa nos lugares onde as pessoas costumam extrair o PJe-Calc. */
export function buscarInstalacoes() {
  const casa = os.homedir();
  const achadas = new Map();
  const locais = [
    [path.join(casa, 'Downloads'), 4], [path.join(casa, 'Desktop'), 4], [path.join(casa, 'Área de Trabalho'), 4],
    [path.join(casa, 'Documents'), 4], [path.join(casa, 'Documentos'), 4], [casa, 2],
    [process.env.OneDrive, 4], [process.env.ProgramFiles, 3], [process.env['ProgramFiles(x86)'], 3],
    [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), 3],
  ].filter(([p]) => p && fs.existsSync(p));
  for (const [p, prof] of locais) varrer(p, prof, achadas);
  // raiz de cada disco (C:\PJeCalc, D:\pjecalc-windows64-2.16.0 ...)
  if (process.platform === 'win32') {
    for (const letra of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const raiz = `${letra}:\\`;
      if (fs.existsSync(raiz)) varrer(raiz, 3, achadas);
    }
  }
  return [...achadas.values()].sort((a, b) => String(b.versao).localeCompare(String(a.versao), undefined, { numeric: true }));
}

let cache = null; // { pasta, origem }

/** Caminho do PJe-Calc sem rodar processos (usado em todo o MCP). */
export function pastaPjeCalc() {
  if (homeDaVariavel()) return path.resolve(homeDaVariavel());
  if (cache) return cache.pasta;
  const cfg = lerConfig();
  if (cfg.pjecalc && ehInstalacao(cfg.pjecalc)) { cache = { pasta: path.resolve(cfg.pjecalc), origem: 'escolha guardada' }; return cache.pasta; }
  const acima = path.resolve(__dirname, '..', '..', '..');
  if (ehInstalacao(acima)) { cache = { pasta: acima, origem: 'pasta acima do MCP' }; return acima; }
  return null;
}

/**
 * Localiza o PJe-Calc (com processo em execução e busca no disco, se preciso). Guarda a escolha quando
 * há exatamente uma instalação. Devolve { pasta, origem, versao, candidatas[], mensagem? }.
 */
export async function localizar({ buscar = true, usarProcesso = true } = {}) {
  if (homeDaVariavel()) {
    const i = ehInstalacao(homeDaVariavel());
    return { pasta: path.resolve(homeDaVariavel()), origem: 'variável PJECALC_HOME', versao: i && i.versao, valida: !!i, candidatas: i ? [i] : [] };
  }
  const rapido = pastaPjeCalc();
  if (rapido) return { pasta: rapido, origem: cache.origem, versao: (ehInstalacao(rapido) || {}).versao, valida: true, candidatas: [ehInstalacao(rapido)] };
  const rodando = usarProcesso ? await instalacoesEmExecucao() : [];
  if (rodando.length === 1) return fixar(rodando[0], 'PJe-Calc em execução', rodando);
  const candidatas = buscar ? buscarInstalacoes() : [];
  for (const r of rodando) if (!candidatas.some((c) => c.pasta.toLowerCase() === r.pasta.toLowerCase())) candidatas.unshift(r);
  if (candidatas.length === 1) return fixar(candidatas[0], 'busca no computador', candidatas);
  if (!candidatas.length) {
    return { pasta: null, valida: false, candidatas: [], mensagem: 'Não encontrei o PJe-Calc neste computador. Se ele já está instalado, informe a pasta (a que contém "bin" e "tomcat") com pjecalc_localizar { pasta }. Se não está, baixe o PJe-Calc Cidadão no site oficial do TRT da 8ª Região, extraia o arquivo (por exemplo em Downloads) e tente de novo.' };
  }
  return { pasta: null, valida: false, candidatas, mensagem: `Encontrei ${candidatas.length} instalações do PJe-Calc. Pergunte ao usuário qual usar e chame pjecalc_localizar { pasta } com a escolhida: ${candidatas.map((c) => `${c.pasta} (versão ${c.versao || '?'})`).join('; ')}` };
}

function fixar(inst, origem, candidatas) {
  gravarConfig({ pjecalc: inst.pasta });
  cache = { pasta: inst.pasta, origem };
  return { pasta: inst.pasta, origem, versao: inst.versao, valida: true, candidatas };
}

/** O usuário escolheu (ou informou) a pasta. */
export function escolher(pasta) {
  const inst = ehInstalacao(pasta);
  if (!inst) throw new Error(`"${pasta}" não é uma instalação do PJe-Calc (não encontrei bin\\pjecalc.jar e tomcat\\webapps\\pjecalc). Informe a pasta que contém "bin" e "tomcat".`);
  return fixar(inst, 'escolha do usuário', [inst]);
}

/** Esquece o caminho guardado (ex.: a pasta foi movida). */
export function esquecer() {
  cache = null;
  const cfg = lerConfig();
  delete cfg.pjecalc;
  try { fs.writeFileSync(arquivoConfig(), JSON.stringify(cfg, null, 2)); } catch { /* sem config */ }
}
