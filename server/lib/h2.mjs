// pjecalc-mcp-skill · lib/h2.mjs
// Acesso ao banco H2 embutido (.dados/pjecalc.h2.db) usando a JRE do próprio PJe-Calc
// e o driver org.h2.Driver (h2-1.3.154.jar) de bin/lib. Nenhuma dependência externa.
//
// ATENÇÃO: o PJe-Calc mantém o arquivo do banco bloqueado enquanto está em execução
// (modo embutido do H2). As ferramentas de banco funcionam com o aplicativo PARADO.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { javaExe, h2Jar, home, dadosDir, dbFile, readDatasource } from './env.mjs';

const SHELL_CLASS = 'org.h2.tools.Shell';
const SCRIPT_CLASS = 'org.h2.tools.Script';
const RUNSCRIPT_CLASS = 'org.h2.tools.RunScript';

/** URL JDBC efetiva (resolve caminhos relativos a partir da raiz do pjecalc). */
export function jdbcUrl() {
  const ds = readDatasource();
  let url = ds ? ds.url : 'jdbc:h2:.dados/pjecalc';
  if (url.startsWith('jdbc:h2:')) {
    const rest = url.slice('jdbc:h2:'.length).split(';')[0];
    if (!rest.includes(':')) {
      url = `jdbc:h2:${path.resolve(home(), rest).replace(/\\/g, '/')}`;
    }
  }
  return url;
}

export function dbCredentials() {
  const ds = readDatasource();
  if (!ds || !ds.username || !ds.password) {
    throw new Error('DataSource jdbc/pjeCalcDS não encontrado em tomcat/webapps/pjecalc/META-INF/context.xml');
  }
  return { user: ds.username, pass: ds.password };
}

/**
 * Executa uma classe de ferramenta do H2 e devolve { code, stdout, stderr }.
 * cwd = raiz do pjecalc (caminhos relativos do H2 resolvem contra o cwd).
 */
function runH2Tool(toolClass, args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaExe(), ['-cp', h2Jar(), toolClass, ...args], {
      cwd: home(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('latin1')));
    child.stderr.on('data', (d) => (stderr += d.toString('latin1')));
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function dbArgs(extra = []) {
  const { user, pass } = dbCredentials();
  return ['-url', jdbcUrl(), '-user', user, '-password', pass, ...extra];
}

/** Parser CSV simples (campos entre aspas, aspas duplicadas, vírgulas em aspas). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\r') {
      // ignora; o \n fecha a linha
    } else if (ch === '\n') {
      row.push(field); field = '';
      if (row.length === 1 && row[0] === '') { row = []; continue; }
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (!rows.length) return { header: null, data: [] };
  const header = rows[0];
  const data = rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => (obj[h] = r[i] ?? ''));
    return obj;
  });
  return { header, data };
}

/**
 * Executa um SELECT via CSVWRITE (arquivo CSV temporário) — robusto para
 * qualquer número de colunas — ou SQL direto no Shell para DML/DDL.
 */
export async function executeSql(sql, { timeoutMs = 60000 } = {}) {
  const clean = sql.trim().replace(/;+\s*$/, '');
  if (/^select\b/i.test(clean)) {
    const csvFile = path.join(osTmp(), `pjecalc-h2-${process.pid}-${Date.now()}.csv`);
    try {
      const escaped = clean.replace(/'/g, "''");
      const call = `CALL CSVWRITE('${csvFile.replace(/\\/g, '/')}', '${escaped}')`;
      const res = await runH2Tool(SHELL_CLASS, dbArgs(['-sql', call]), { timeoutMs });
      if (res.code !== 0) {
        const msg = (res.stderr || res.stdout || '').trim();
        if (/already in use|may be already|Database is locked/i.test(msg)) {
          throw new Error('O banco H2 está em uso pelo PJe-Calc em execução. Encerre o aplicativo antes de consultar o banco.');
        }
        if (/password|user name/i.test(msg)) {
          throw new Error(`Falha de credenciais do banco: ${msg}`);
        }
        throw new Error(`Erro H2: ${msg || `exit ${res.code}`}`);
      }
      if (!fs.existsSync(csvFile)) {
        throw new Error('CSVWRITE não gerou o arquivo de saída — verifique a consulta.');
      }
      const raw = fs.readFileSync(csvFile, 'latin1');
      return parseCsv(raw);
    } finally {
      try { fs.unlinkSync(csvFile); } catch { /* ignore */ }
    }
  }

  const res = await runH2Tool(SHELL_CLASS, dbArgs(['-sql', sql]), { timeoutMs });
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout || '').trim();
    if (/already in use|may be already|Database is locked/i.test(msg)) {
      throw new Error('O banco H2 está em uso pelo PJe-Calc em execução. Encerre o aplicativo antes de consultar o banco.');
    }
    if (/password|user name/i.test(msg)) {
      throw new Error(`Falha de credenciais do banco: ${msg}`);
    }
    throw new Error(`Erro H2: ${msg || `exit ${res.code}`}`);
  }
  return res.stdout;
}

function osTmp() {
  return process.env.TEMP || process.env.TMP || path.join(home(), '.dados');
}

/** Lista as tabelas (esquema PUBLIC). */
export async function listTables() {
  const out = await executeSql(
    "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='PUBLIC' ORDER BY TABLE_NAME"
  );
  return out.data;
}

/** Colunas de uma tabela. */
export async function describeTable(table) {
  const safe = table.replace(/[^A-Za-z0-9_]/g, '');
  const out = await executeSql(
    `SELECT COLUMN_NAME, TYPE_NAME, NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='PUBLIC' AND TABLE_NAME='${safe.toUpperCase()}' ORDER BY ORDINAL_POSITION`
  );
  return out.data;
}

/** Consulta genérica (somente leitura) com limite obrigatório. */
export async function select(sql, { maxRows = 200, timeoutMs = 90000 } = {}) {
  const clean = sql.trim().replace(/;+\s*$/, '');
  if (!/^select\b/i.test(clean)) {
    throw new Error('Apenas SELECT é permitido nesta ferramenta. Use db_executar para DML/DDL (exige permitir_escrita=true).');
  }
  const limited = /limit\b/i.test(clean) ? clean : `${clean} LIMIT ${maxRows}`;
  const out = await executeSql(limited, { timeoutMs });
  return out.data;
}

/** Executa DML/DDL — uso explícito e consciente. */
export async function executeWrite(sql, { timeoutMs = 90000 } = {}) {
  const out = await executeSql(sql, { timeoutMs });
  return out.trim();
}

/** Backup lógico completo (schema + dados) em SQL, usando org.h2.tools.Script. */
export async function backupToSqlFile(outputFile, { timeoutMs = 300000 } = {}) {
  const outPath = path.resolve(outputFile || path.join(dadosDir(), `pjecalc-backup-${Date.now()}.sql`));
  const res = await runH2Tool(SCRIPT_CLASS, dbArgs(['-script', outPath]), { timeoutMs });
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout || '').trim();
    throw new Error(`Falha no backup: ${msg || `exit ${res.code}`}`);
  }
  return outPath;
}

/** Backup físico do arquivo .h2.db (cópia exata, não exige abrir o banco). */
export function copyDbFile(outputFile) {
  const src = dbFile();
  const dst = path.resolve(outputFile || path.join(dadosDir(), `pjecalc.h2.db.bak-${Date.now()}`));
  fs.copyFileSync(src, dst);
  return dst;
}

/** Restaura o banco a partir de um arquivo SQL (RunScript). DESTRUTIVO. */
export async function restoreFromSqlFile(inputFile, { timeoutMs = 300000 } = {}) {
  const res = await runH2Tool(RUNSCRIPT_CLASS, dbArgs(['-script', path.resolve(inputFile)]), { timeoutMs });
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout || '').trim();
    throw new Error(`Falha na restauração: ${msg || `exit ${res.code}`}`);
  }
  return res.stdout.trim();
}
