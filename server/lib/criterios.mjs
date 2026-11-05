// pjecalc-mcp-skill · lib/criterios.mjs
// Critérios que o PJe-Calc diz ter aplicado (relatório JUSTIFICATIVA)
// conferidos com os parâmetros do cálculo: índice e regra de acumulação, combinações de índices, base dos juros,
// juros na fase pré-judicial, prescrição quinquenal, aviso prévio pela Lei 12.506 e tabela do imposto de renda.
// Uma frase ausente ou contrária ao que foi especificado (e aprovado no plano) é falha.

import { campo, itens } from './pjc.mjs';
import { carregarModelo } from './modelos.mjs';

const c = (o, k) => (o ? campo(o, k) : null);
const it = (o, k) => (o ? itens(campo(o, k)).filter((x) => x && x.$classe) : []);
const sim = (v) => v === 'true' || v === true;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase();
const fmt = (v) => { if (v == null) return null; const d = new Date(Number(v) - 3 * 3600e3); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const menos5anos = (v) => { if (v == null) return null; const d = new Date(Number(v) - 3 * 3600e3); d.setUTCFullYear(d.getUTCFullYear() - 5); return d.getTime() + 3 * 3600e3; };

function nomeDoEnum(nomeEnum, valor) {
  const lista = (carregarModelo('modelo-pjc').enums || {})[nomeEnum] || [];
  const e = lista.find((x) => x.nome === valor);
  return e ? ((e.info || '').match(/Nome=([^|]+)/) || [])[1]?.trim() || valor : valor;
}

const ACUMULACAO = {
  MES_SUBSEQUENTE_AO_VENCIMENTO: /acumulados? a partir do mes subsequente ao vencimento(?!\s+das verbas mensais)/,
  MES_DO_VENCIMENTO: /acumulados? a partir do mes de vencimento/,
  MES_SUBSEQUENTE_E_MES_DO_VENCIMENTO: /mes subsequente ao vencimento das verbas mensais e do mes de vencimento/,
};
const JUROS = {
  TRD_SIMPLES: /juros simples trd|trd juros simples/, TRD_COMPOSTOS: /trd juros compostos|juros compostos trd/, TAXA_LEGAL: /taxa legal/,
  SELIC: /selic/, SELIC_FAZENDA: /selic/, SELIC_BACEN: /selic/, SEM_JUROS: /sem incidencia de juros|sem juros/,
};

/**
 * `justificativa`: lista de frases (lerJustificativa); `arvore`: o .PJC exportado depois de liquidar.
 * Devolve verificações (dimensão transferencia).
 */
export function conferirCriterios(justificativa, arvore) {
  const verif = [];
  if (!Array.isArray(justificativa) || !justificativa.length || !arvore) return verif;
  const texto = norm(justificativa.join(' \n '));
  const par = c(arvore, 'parametrosDeAtualizacao');
  const achados = []; const faltas = [];
  const exigir = (descricao, re) => { if (re.test(texto)) achados.push(descricao); else faltas.push(descricao); };
  // índice trabalhista e combinações
  const indice = c(par, 'indiceTrabalhista');
  if (indice) exigir(`índice '${nomeDoEnum('IndiceMonetarioEnum', indice)}'`, new RegExp(`'${norm(nomeDoEnum('IndiceMonetarioEnum', indice)).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`));
  for (const x of it(par, 'listaDeCombinacaoDeIndices')) {
    const n = nomeDoEnum('IndiceMonetarioEnum', c(x, 'outroIndiceTrabalhista'));
    exigir(`índice '${n}' a partir de ${fmt(c(x, 'apartirDeOutroIndice'))}`, new RegExp(`'${norm(n).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`));
  }
  const acum = c(arvore, 'indicesAcumulados');
  if (ACUMULACAO[acum]) exigir(`acumulação ${acum.replace(/_/g, ' ').toLowerCase()}`, ACUMULACAO[acum]);
  // juros
  const baseJ = c(par, 'baseDeJurosDasVerbas');
  if (baseJ === 'VERBAS') exigir('juros antes da dedução da contribuição social', /juros de mora sobre verbas apurados antes da deducao/);
  if (baseJ === 'VERBA_INSS') exigir('juros após a dedução da contribuição social', /apurados apos a deducao da contribuicao social devida/);
  if (baseJ === 'VERBA_INSS_PP') exigir('juros após a dedução da contribuição social e da previdência privada', /apos a deducao da contribuicao social e da previdencia privada/);
  if (sim(c(par, 'aplicarJurosFasePreJudicial'))) exigir('juros na fase pré-judicial (ADC 58)', /fase pre-judicial/);
  const tabJuros = [c(par, 'juros'), ...it(par, 'listaDeCombinacaoDeJuros').map((x) => c(x, 'outroJuros'))].filter(Boolean);
  for (const j of tabJuros) if (JUROS[j]) exigir(`juros ${nomeDoEnum('JurosEnum', j)}`, JUROS[j]);
  // prescrição e aviso
  const verbasAtivas = it(arvore, 'verbas').filter((v) => sim(c(v, 'ativo')));
  if (sim(c(arvore, 'prescricaoQuinquenal')) && verbasAtivas.length) {
    const d = fmt(menos5anos(c(arvore, 'dataAjuizamento')));
    exigir(`prescrição quinquenal antes de ${d}`, new RegExp(`prescricao quinquenal[^\\n]*${d.replace(/\//g, '\\/')}`));
  }
  if (c(arvore, 'apuracaoPrazoDoAvisoPrevio') === 'APURACAO_CALCULADA' && verbasAtivas.some((v) => c(v, 'caracteristica') === 'AVISO_PREVIO')) exigir('aviso prévio pela Lei 12.506/2011', /12\.506\/2011/);
  // imposto de renda: tabela acumulada (RRA) para anos anteriores, mensal para o ano da liquidação
  const ir = c(arvore, 'irpf');
  const tipos = new Set(it(ir, 'ocorrencias').map((o) => c(o, 'tipo')));
  if (sim(c(ir, 'apurarImpostoRenda')) && tipos.size) {
    if (tipos.has('RRA_ANOS_ANTERIORES')) exigir('IR pela tabela progressiva acumulada (art. 12-A)', /tabela progressiva acumulada/);
    if ([...tipos].some((t) => t !== 'RRA_ANOS_ANTERIORES')) exigir('IR pela tabela progressiva mensal', /tabela progressiva mensal/);
  }
  verif.push({
    item: 'critérios aplicados pelo PJe-Calc (justificativa) = parâmetros do cálculo',
    estado: faltas.length ? 'falha' : achados.length ? 'ok' : 'nao_verificado',
    detalhe: faltas.length ? `não aparecem na justificativa: ${faltas.join('; ')}` : `${achados.length} critério(s) conferidos: ${achados.join('; ')}`,
    dimensao: 'transferencia',
  });
  return verif;
}
