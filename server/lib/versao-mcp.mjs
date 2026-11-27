// pjecalc-mcp-skill · lib/versao-mcp.mjs
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Required Notice: Copyright (C) 2026 Lucianum (https://github.com/lucianumm)
// Uso comercial exige licença do titular: veja LICENSE e LICENCA-COMERCIAL.md.
// Aviso de versão desatualizada: consulta a última versão publicada no repositório oficial e avisa
// quando há uma mais nova. Só lê a página pública de versões do GitHub; não envia dados do usuário,
// do computador nem dos cálculos. Falha de rede é silenciosa (o MCP funciona sem internet).
// PJECALC_MCP_SEM_AVISO_VERSAO=1 desliga a consulta.

import { LICENCA } from './licenca.mjs';

export const REPOSITORIO_OFICIAL = 'https://github.com/lucianumm/PJeCalcMCP';
const API_ULTIMA = 'https://api.github.com/repos/lucianumm/PJeCalcMCP/releases/latest';
const TEMPO_LIMITE_MS = 5000;

/** "v2.16.0-mcp.19" -> [2, 16, 0, 19]; null se o formato não for reconhecido. */
export function partesVersao(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-mcp\.(\d+))?$/.exec(String(v || '').trim());
  return m ? [m[1], m[2], m[3], m[4] ?? 0].map(Number) : null;
}

/** < 0 se a for anterior a b, 0 se iguais, > 0 se posterior; null se alguma não for reconhecida. */
export function compararVersoes(a, b) {
  const pa = partesVersao(a);
  const pb = partesVersao(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Monta o resultado da comparação entre a versão instalada e a última publicada. */
export function situacaoVersao(instalada, ultima, url) {
  const dif = compararVersoes(instalada, ultima);
  const versaoUltima = String(ultima).replace(/^v/, '');
  const desatualizada = dif !== null && dif < 0;
  return {
    instalada,
    ultima: versaoUltima,
    desatualizada,
    url: url || `${REPOSITORIO_OFICIAL}/releases/latest`,
    mensagem: desatualizada
      ? `Há uma versão mais nova do PJe-Calc MCP: ${versaoUltima} (esta é ${instalada}). Versões antigas ficam sem correções `
        + `nem tabelas e regras novas e não têm suporte. Atualize pelo repositório oficial: ${url || `${REPOSITORIO_OFICIAL}/releases/latest`} `
        + `· ${LICENCA.nome}: ${LICENCA.uso_comercial}`
      : `PJe-Calc MCP ${instalada} está atualizado.`,
  };
}

/** Consulta a última versão publicada; devolve null sem internet, com a consulta desligada ou em erro. */
export async function verificarVersao(instalada, { fetchFn = globalThis.fetch } = {}) {
  if (process.env.PJECALC_MCP_SEM_AVISO_VERSAO === '1' || typeof fetchFn !== 'function') return null;
  try {
    const res = await fetchFn(API_ULTIMA, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `pjecalc-mcp/${instalada}` },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!res.ok) return null;
    const r = await res.json();
    if (!r || r.draft || r.prerelease || !partesVersao(r.tag_name)) return null;
    return situacaoVersao(instalada, r.tag_name, r.html_url);
  } catch {
    return null;
  }
}
