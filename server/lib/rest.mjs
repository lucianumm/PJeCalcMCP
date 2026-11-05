// pjecalc-mcp-skill · lib/rest.mjs
// Cliente HTTP para os serviços REST do PJe-Calc (RESTEasy/Seam).

import http from 'node:http';
import { readPorts, readServiceToken, authHeaderValue } from './env.mjs';

export function baseUrl() {
  const { http: port } = readPorts();
  return `http://127.0.0.1:${port || 9257}`;
}

export function restBase() {
  return `${baseUrl()}/pjecalc/servico/rest`;
}

function request(method, pathAndQuery, { body, headers = {}, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathAndQuery, baseUrl());
    const token = readServiceToken();
    const h = {
      Accept: 'application/json',
      ...(token ? { Authentication: authHeaderValue(token) } : {}),
      ...headers,
    };
    if (body != null) {
      h['Content-Type'] = h['Content-Type'] || 'application/json';
    }
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: h,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('latin1');
        resolve({ status: res.statusCode, headers: res.headers, text });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout após ${timeoutMs}ms`)));
    req.on('error', (e) => reject(e));
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function asJson(res) {
  if (res.status === 204 || !res.text) return {};
  try { return JSON.parse(res.text); } catch { return { raw: res.text }; }
}

// ---------------------------------------------------------------------------
// /servico/rest/atualizacao
// ---------------------------------------------------------------------------

/**
 * GET /atualizacao/selic?dataInicial=dd/MM/yyyy&dataFinal=dd/MM/yyyy
 * Retorna o fator SELIC acumulado do período (BigDecimal formatado).
 */
export async function selicPeriodo(dataInicial, dataFinal) {
  const res = await request('GET',
    `/pjecalc/servico/rest/atualizacao/selic?dataInicial=${encodeURIComponent(dataInicial)}&dataFinal=${encodeURIComponent(dataFinal)}`);
  return { status: res.status, body: asJson(res) };
}

/**
 * POST /atualizacao/precatorios — atualiza um precatório (AtualizacaoPrecatorioDTO).
 * O DTO é devolvido atualizado no corpo da resposta.
 */
export async function atualizarPrecatorio(dto) {
  const res = await request('POST', '/pjecalc/servico/rest/atualizacao/precatorios', { body: dto });
  return { status: res.status, body: asJson(res) };
}

/** POST /atualizacao/sip/precatorios — lista de AtualizacaoPrecatorioSIPDTO. */
export async function atualizarPrecatoriosSIP(lista) {
  const res = await request('POST', '/pjecalc/servico/rest/atualizacao/sip/precatorios', { body: lista });
  return { status: res.status, body: asJson(res) };
}

/** POST /atualizacao/sip/precatorios/indices — lista de AtualizacaoPrecatorioSIPIndicesDTO. */
export async function atualizarPrecatoriosSIPIndices(lista) {
  const res = await request('POST', '/pjecalc/servico/rest/atualizacao/sip/precatorios/indices', { body: lista });
  return { status: res.status, body: asJson(res) };
}

// ---------------------------------------------------------------------------
// /servico/rest/sincronizacao
// ---------------------------------------------------------------------------

/** GET /sincronizacao/nacionais/ultimaVersao → ControleAtualizacaoTabelasDTO | 404. */
export async function tabelasUltimaVersao() {
  const res = await request('GET', '/pjecalc/servico/rest/sincronizacao/nacionais/ultimaVersao');
  return { status: res.status, body: asJson(res) };
}

/** GET /sincronizacao/nacionais/versao/{hash} → ControleAtualizacaoTabelasDTO | 404. */
export async function tabelasVersao(hash) {
  const res = await request('GET', `/pjecalc/servico/rest/sincronizacao/nacionais/versao/${encodeURIComponent(hash)}`);
  return { status: res.status, body: asJson(res) };
}

/**
 * GET /sincronizacao/nacionais/{hash}?versao=X → SincronizacaoTabelasDTO
 * { tabelas: base64(gzip), hashServidor, mensagem? } · 404 = já atualizado.
 */
export async function sincronizarNacionais(hash, versao) {
  const q = versao != null ? `?versao=${encodeURIComponent(versao)}` : '';
  const res = await request('GET', `/pjecalc/servico/rest/sincronizacao/nacionais/${encodeURIComponent(hash)}${q}`);
  return { status: res.status, body: asJson(res) };
}

/** GET /sincronizacao/nacionaiseregionais/regional/{TRT}/hash/{hash}. */
export async function sincronizarRegionais(tribunal, hash) {
  const res = await request('GET',
    `/pjecalc/servico/rest/sincronizacao/nacionaiseregionais/regional/${encodeURIComponent(tribunal)}/hash/${encodeURIComponent(hash)}`);
  return { status: res.status, body: asJson(res) };
}

/** GET /sincronizacao/nacionaiseregionaisproxy/regional/{TRT}/hash/{hash} (via TRT raiz). */
export async function sincronizarRegionaisProxy(tribunal, hash) {
  const res = await request('GET',
    `/pjecalc/servico/rest/sincronizacao/nacionaiseregionaisproxy/regional/${encodeURIComponent(tribunal)}/hash/${encodeURIComponent(hash)}`);
  return { status: res.status, body: asJson(res) };
}

// ---------------------------------------------------------------------------
// Páginas web (sem REST)
// ---------------------------------------------------------------------------

/** GET simples em qualquer página do webapp. */
export async function getPage(pathAndQuery) {
  return request('GET', pathAndQuery);
}

export const STATUS_TEXT = {
  200: 'OK',
  400: 'Bad Request (parâmetro inválido — datas em dd/MM/yyyy; regional deve ser TRT1..TRT24)',
  401: 'Unauthorized (token inválido no header Authentication)',
  404: 'Not Found (ex.: tabelas já sincronizadas / versão inexistente)',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
};
