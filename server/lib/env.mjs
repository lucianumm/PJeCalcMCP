// pjecalc-mcp-skill · lib/env.mjs
// Descoberta de caminhos e leitura/escrita de configuração do PJe-Calc.
// Todos os arquivos de configuração do PJe-Calc são ISO-8859-1; lemos/gravamos em latin1.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pastaPjeCalc } from './localizar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raiz da instalação do PJe-Calc (pasta que contém bin/, tomcat/, .dados/). */
export function pjecalcHome() {
  // PJECALC_HOME, escolha guardada, pasta acima do MCP ou o que a localização automática achou
  // (lib/localizar.mjs); sem nada disso, a pasta acima do MCP (e as ferramentas explicam o que falta)
  return pastaPjeCalc() || path.resolve(__dirname, '..', '..', '..');
}

export function home() { return pjecalcHome(); }

export function javaExe() {
  return path.join(home(), 'bin', 'jre', 'bin', 'java.exe');
}

export function h2Jar() {
  return path.join(home(), 'bin', 'lib', 'h2-1.3.154.jar');
}

export function tomcatDir() { return path.join(home(), 'tomcat'); }
export function webappDir() { return path.join(tomcatDir(), 'webapps', 'pjecalc'); }
export function dadosDir() { return path.join(home(), '.dados'); }
export function dbFile() { return path.join(dadosDir(), 'pjecalc.h2.db'); }
export function logsDir() { return path.join(tomcatDir(), 'logs'); }
export function batNormal() { return path.join(home(), 'iniciarPjeCalc.bat'); }
export function batDebug() { return path.join(home(), 'iniciarPjeCalcDebug.bat'); }

/** Lê arquivo como latin1 (codificação real dos arquivos do PJe-Calc). */
export function readLatin1(p) { return fs.readFileSync(p, 'latin1'); }

/** Grava arquivo em latin1 criando backup .mcp-backup-<timestamp> ao lado. */
export function writeLatin1Backup(p, content) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${p}.mcp-backup-${stamp}`;
  fs.copyFileSync(p, backup);
  fs.writeFileSync(p, content, 'latin1');
  return backup;
}

// ---------------------------------------------------------------------------
// server.xml
// ---------------------------------------------------------------------------

export function serverXmlPath() { return path.join(tomcatDir(), 'conf', 'server.xml'); }

/** Remove blocos de comentário <!-- ... --> do XML para evitar matches em conectores comentados. */
function stripXmlComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** Portas do Tomcat embutido lidas de tomcat/conf/server.xml. */
export function readPorts() {
  const xml = stripXmlComments(readLatin1(serverXmlPath()));
  const grab = (re) => {
    const m = xml.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    http: grab(/<Connector[^>]*port="(\d+)"[^>]*protocol="HTTP\/1\.1"/) ?? grab(/<Connector[^>]*port="(\d+)"/),
    ajp: grab(/<Connector[^>]*port="(\d+)"[^>]*protocol="AJP\/1\.3"/),
    shutdown: grab(/<Server[^>]*port="(\d+)"/),
    shutdownCommand: (xml.match(/<Server[^>]*shutdown="([^"]+)"/) || [])[1] || 'SHUTDOWN',
    address: (xml.match(/<Connector[^>]*address="([^"]+)"/) || [])[1] || null,
  };
}

/**
 * Altera as portas no server.xml. Cria backup automático.
 * Conectores comentados (<!-- ... -->) são preservados intactos.
 */
export function writePorts({ http, ajp, shutdown }) {
  const p = serverXmlPath();
  const original = readLatin1(p);
  const lines = original.split(/\r?\n/);
  let inComment = false;
  let httpDone = !http, ajpDone = !ajp, shutdownDone = !shutdown;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inComment) {
      const open = line.indexOf('<!--');
      if (open >= 0) {
        // verifica se o comentário abre e fecha na mesma linha
        const close = line.indexOf('-->', open + 4);
        if (close < 0) {
          // comentário abre nesta linha: processa apenas o trecho antes dele
          const head = line.slice(0, open);
          const tail = line.slice(open);
          const replaced = applyPortEdits(head, { http, ajp, shutdown }, { httpDone, ajpDone, shutdownDone });
          if (replaced.changed) {
            lines[i] = replaced.text + tail;
            ({ httpDone, ajpDone, shutdownDone } = replaced);
          }
          inComment = true;
          continue;
        }
        // comentário completo na linha: processa antes e depois
        const head = line.slice(0, open);
        const after = line.slice(close + 3);
        const replaced = applyPortEdits(head, { http, ajp, shutdown }, { httpDone, ajpDone, shutdownDone });
        if (replaced.changed) {
          lines[i] = replaced.text + line.slice(open, close + 3) + after;
          ({ httpDone, ajpDone, shutdownDone } = replaced);
        }
        continue;
      }
      const replaced = applyPortEdits(line, { http, ajp, shutdown }, { httpDone, ajpDone, shutdownDone });
      if (replaced.changed) {
        lines[i] = replaced.text;
        ({ httpDone, ajpDone, shutdownDone } = replaced);
      }
    } else if (line.includes('-->')) {
      inComment = false;
    }
  }

  const backup = writeLatin1Backup(p, lines.join('\r\n'));
  return { backup, ports: readPorts() };
}

function applyPortEdits(text, { http, ajp, shutdown }, state) {
  let changed = false;
  let { httpDone, ajpDone, shutdownDone } = state;

  if (!shutdownDone && shutdown != null && /<Server[^>]*port="\d+"[^>]*shutdown="/.test(text)) {
    text = text.replace(/port="\d+"/, `port="${shutdown}"`);
    shutdownDone = true; changed = true;
  }
  if (!httpDone && http != null && /<Connector[^>]*protocol="HTTP\/1\.1"/.test(text)) {
    text = text.replace(/port="\d+"/, `port="${http}"`);
    httpDone = true; changed = true;
  }
  if (!ajpDone && ajp != null && /<Connector[^>]*protocol="AJP\/1\.3"/.test(text)) {
    text = text.replace(/port="\d+"/, `port="${ajp}"`);
    ajpDone = true; changed = true;
  }
  return { text, changed, httpDone, ajpDone, shutdownDone };
}

// ---------------------------------------------------------------------------
// context.xml do webapp (DataSource H2)
// ---------------------------------------------------------------------------

export function contextXmlPath() { return path.join(webappDir(), 'META-INF', 'context.xml'); }

export function readDatasource() {
  const xml = readLatin1(contextXmlPath());
  const m = xml.match(/<Resource[^>]*name="jdbc\/pjeCalcDS"[^>]*>/);
  if (!m) return null;
  const res = m[0];
  const attr = (name) => {
    const a = res.match(new RegExp(`${name}="([^"]*)"`));
    return a ? a[1] : null;
  };
  return {
    name: attr('name'),
    driverClassName: attr('driverClassName'),
    url: attr('url'),
    username: attr('username'),
    password: attr('password'),
    maxActive: attr('maxActive'),
    maxIdle: attr('maxIdle'),
    maxWait: attr('maxWait'),
    validationQuery: attr('validationQuery'),
  };
}

/** Altera url/username/password do DataSource. Cria backup automático. */
export function writeDatasource({ url, username, password }) {
  const p = contextXmlPath();
  let xml = readLatin1(p);
  const m = xml.match(/<Resource[^>]*name="jdbc\/pjeCalcDS"[^>]*>/);
  if (!m) throw new Error('DataSource jdbc/pjeCalcDS não encontrado em META-INF/context.xml');
  let res = m[0];
  const setAttr = (name, value) => {
    if (value == null) return;
    res = res.includes(`${name}="`)
      ? res.replace(new RegExp(`${name}="[^"]*"`), `${name}="${value}"`)
      : res.replace(/>$/, ` ${name}="${value}">`);
  };
  setAttr('url', url);
  setAttr('username', username);
  setAttr('password', password);
  xml = xml.replace(m[0], res);
  const backup = writeLatin1Backup(p, xml);
  return { backup, datasource: readDatasource() };
}

// ---------------------------------------------------------------------------
// Bat de inicialização (JVM, memória, token)
// ---------------------------------------------------------------------------

/** Extrai os parâmetros de JVM do iniciarPjeCalc.bat. */
export function readLauncherParams() {
  const bat = readLatin1(batNormal());
  const grab = (name) => {
    const m = bat.match(new RegExp(`-D${name}=([^\\s]+)`));
    return m ? m[1].replace(/^"(.*)"$/, '$1') : null;
  };
  const mem = (name) => {
    const m = bat.match(new RegExp(`-${name}(\\d+)[mMgG]`));
    return m ? m[1] : null;
  };
  const jar = (bat.match(/-jar\s+(\S+\.jar)/) || [])[1] || null;
  const java = (bat.match(/start\s+(\S*java\S*)/) || [])[1] || null;
  return {
    java,
    jar,
    timezone: grab('user.timezone'),
    fileEncoding: grab('file.encoding'),
    tokenServicos: grab('seguranca.pjecalc.tokenServicos'),
    contextoPje: grab('seguranca.pjekz.servico.contexto'),
    xms: mem('Xms'),
    xmx: mem('Xmx'),
  };
}

/** Altera Xms/Xmx/token nos dois .bat. Cria backups automáticos. */
export function writeLauncherParams({ xms, xmx, tokenServicos }) {
  const results = {};
  for (const file of [batNormal(), batDebug()]) {
    let bat = readLatin1(file);
    if (xms != null) bat = bat.replace(/-Xms\d+[mMgG]/, `-Xms${xms}m`);
    if (xmx != null) bat = bat.replace(/-Xmx\d+[mMgG]/, `-Xmx${xmx}m`);
    if (tokenServicos != null) {
      bat = bat.replace(/-Dseguranca\.pjecalc\.tokenServicos=[^\s"]+/,
        `-Dseguranca.pjecalc.tokenServicos=${tokenServicos}`);
    }
    results[path.basename(file)] = writeLatin1Backup(file, bat);
  }
  return { backups: results, params: readLauncherParams() };
}

// ---------------------------------------------------------------------------
// Diversos
// ---------------------------------------------------------------------------

/** Lê o token de serviços (segredo dos serviços REST) a partir do .bat. */
export function readServiceToken() {
  if (process.env.PJECALC_TOKEN) return process.env.PJECALC_TOKEN;
  return readLauncherParams().tokenServicos;
}

/** Token codificado como o app espera no header "Authentication" (Base64, ISO-8859-1). */
export function authHeaderValue(token) {
  return Buffer.from(String(token), 'latin1').toString('base64');
}

/** URLs dos tribunais (url_tribunal.properties). */
export function readTribunalUrls() {
  const p = path.join(webappDir(), 'WEB-INF', 'classes', 'url_tribunal.properties');
  if (!fs.existsSync(p)) return {};
  const text = readLatin1(p);
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^url\.(trt\d*|trt\.root)=(\S+)/i);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/** Versão/build do pjecalc.jar (META-INF/maven pom.properties) sem executar nada. */
export function readJarVersion() {
  // lê direto do zip: localiza o entry pom.properties
  const jarPath = path.join(home(), 'bin', 'pjecalc.jar');
  const buf = fs.readFileSync(jarPath);
  // busca assinatura de fim de diretório central
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  let count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entryName = 'META-INF/maven/br.jus.trt8/pjecalc-sa/pom.properties';
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.toString('latin1', off + 46, off + 46 + nameLen);
    if (name === entryName) {
      const csize = buf.readUInt32LE(off + 20);
      const lho = buf.readUInt16LE(off + 42);
      const data = buf.subarray(off + 46 + nameLen + extraLen + commentLen,
        off + 46 + nameLen + extraLen + commentLen + csize).toString('latin1');
      const out = {};
      for (const line of data.split(/\r?\n/)) {
        const m = line.match(/^([^=]+)=(.*)$/);
        if (m) out[m[1].trim()] = m[2].trim();
      }
      return out;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

export function listPageFiles() {
  const base = path.join(webappDir(), 'pages');
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.xhtml')) out.push(p.slice(base.length + 1).replace(/\\/g, '/'));
    }
  };
  walk(base);
  return out.sort();
}

export function templateCsvFiles() {
  const out = [];
  const base = path.join(webappDir());
  for (const dir of ['templateCartaoDePonto', 'templateFaltas', 'templateFerias', 'templateHistoricoSalarial']) {
    const d = path.join(base, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.toLowerCase().endsWith('.csv')) out.push(path.join(dir, f).replace(/\\/g, '/'));
    }
  }
  return out;
}
