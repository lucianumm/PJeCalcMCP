// pjecalc-mcp-skill · lib/tabelas.mjs
// Tabelas auxiliares e índices do PJe-Calc (correção monetária, juros, INSS, IR, salário mínimo...).
//
//   statusTabelas     -> lê na interface a competência/data mais recente de cada índice
//                        (Tabelas > Correção Monetária e Juros de Mora)
//   atualizarTabelas  -> Tabelas > Atualização de Tabelas e Índices > Online (o próprio PJe-Calc baixa
//                        do TRT e aplica)
//   avaliarDefasagem  -> diz se as tabelas cobrem uma data de liquidação.
//
// Online: o PJe-Calc baixa as tabelas do TRT escolhido (se ele recusar, pelo TRT8) e as aplica.
//   Os endpoints /servico/rest/sincronizacao/* do PJe-Calc LOCAL são o lado servidor (para outros
//   TRTs): chamá-los não atualiza nada (e nacionais/0 responde 500 numa instalação Cidadão).

import fs from 'node:fs';
import path from 'node:path';
import { SessaoPjeCalc, textoPuro } from './web.mjs';
import { dadosDir } from './env.mjs';

// O PJe-Calc não mostra qual TRT está carregado; o MCP anota a cada atualização que ele mesmo faz.
const arquivoEstado = () => path.join(dadosDir(), 'pjecalc-mcp-tabelas.json');
export function regionalCarregado() {
  try { return JSON.parse(fs.readFileSync(arquivoEstado(), 'utf-8')); } catch { return null; }
}

const INDICES = [
  // [aba, nome, periodicidade]
  ['tabUnicaJTMensal', 'Tabela Única JT mensal', 'mensal'],
  ['tabIPCAE', 'IPCA-E', 'mensal'],
  ['tabIPCA', 'IPCA', 'mensal'],
  ['tabINPC', 'INPC', 'mensal'],
  ['tabTR', 'TR', 'mensal'],
  ['tabSelicFazenda', 'SELIC simples (mensal)', 'mensal'],
  ['tabSelicDiaria', 'SELIC composta (diária)', 'diaria'],
  ['tabUnicaDebitoTrabalhista', 'Tabela Única de Débitos Trabalhistas (diária)', 'diaria'],
];
const JUROS = [['tabJurosTaxaLegal', 'Juros pela taxa legal (Lei 14.905/2024)']];
export const REGIONAIS = Array.from({ length: 24 }, (_, i) => `TRT${i + 1}`);

function primeiraData(texto, depoisDe) {
  const t = depoisDe && texto.includes(depoisDe) ? texto.split(depoisDe)[1] : texto;
  const m = /\b(\d{2})\/(\d{4})\b|\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(t);
  if (!m) return null;
  return m[1] ? `${m[2]}-${m[1]}` : `${m[5]}-${m[4]}-${m[3]}`;
}

async function abaPorServidor(s, aba) {
  const id = `formulario:${aba}_server_submit`;
  return s.enviar({ tipo: 'submit', formId: 'formulario', params: { [id]: id } });
}

/** Competência/data mais recente de cada índice, lida nas telas de tabelas do PJe-Calc em execução. */
export async function statusTabelas({ base = null } = {}) {
  const s = new SessaoPjeCalc(base);
  await s.inicio();
  const indices = [];
  let p = await s.menu('Correção Monetária');
  for (const [aba, nome, periodicidade] of INDICES) {
    p = await abaPorServidor(s, aba);
    // a primeira linha da lista é a mais recente; a coluna "Data" de publicação (dd/mm/aaaa) vem depois
    const corpo = textoPuro(p.html).split('Tabelas > Correção Monetária')[1] || '';
    const lista = corpo.slice(Math.max(0, corpo.search(/\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4}/)));
    indices.push({ indice: nome, ultima: primeiraData(lista), periodicidade });
  }
  p = await s.menu('Juros de Mora');
  for (const [aba, nome] of JUROS) {
    p = await abaPorServidor(s, aba);
    const corpo = textoPuro(p.html).split('Tabelas > Juros de Mora')[1] || '';
    const datas = [...corpo.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b|\b(\d{2})\/(\d{4})\b/g)].map((m) => (m[1] ? `${m[3]}-${m[2]}-${m[1]}` : `${m[5]}-${m[4]}`)).sort();
    indices.push({ indice: nome, ultima: datas.length ? datas[datas.length - 1] : null, periodicidade: 'mensal' });
  }
  return { indices, versao: await versaoTabelas(base) };
}

/** Texto da página pública versao-tabelas.jsf (versões nacional/regional sincronizadas). */
export async function versaoTabelas(base = null) {
  const s = new SessaoPjeCalc(base);
  try {
    const p = await s.get('/pjecalc/versao-tabelas.jsf');
    const t = textoPuro(p.html).replace(/\s+/g, ' ');
    const i = t.indexOf('Tabelas Nacionais');
    return i >= 0 ? t.slice(i, i + 300).trim() : null;
  } catch {
    return null;
  }
}

const mesesEntre = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };

/**
 * As tabelas cobrem a liquidação em `dataLiquidacao` (dd/mm/aaaa ou aaaa-mm-dd)? Índices mensais precisam
 * chegar ao menos ao mês anterior (o PJe-Calc repete o último índice nos meses sem publicação).
 */
export function avaliarDefasagem(status, dataLiquidacao) {
  let iso = String(dataLiquidacao || '');
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(iso);
  if (br) iso = `${br[3]}-${br[2]}-${br[1]}`;
  if (!/^\d{4}-\d{2}/.test(iso)) { const d = new Date(); iso = d.toISOString().slice(0, 10); }
  const mesLiq = iso.slice(0, 7);
  const atrasados = [];
  for (const x of status.indices) {
    if (!x.ultima) { atrasados.push({ ...x, mesesDeAtraso: null }); continue; }
    const atraso = mesesEntre(x.ultima.slice(0, 7), mesLiq);
    if (atraso > 2) atrasados.push({ ...x, mesesDeAtraso: atraso });
  }
  return { dataLiquidacao: iso, atualizadas: atrasados.length === 0, atrasados };
}

function resultadoDaTela(p) {
  const t = textoPuro(p.html);
  const ok = /(^|\n)\s*Sucesso\.?/.test(t) || /Opera[cç][aã]o realizada com sucesso/i.test(t);
  const erro = (/(^|\n)\s*Erro\.?\s*\n([^\n]+)/.exec(t) || [])[2]
    || (p.mensagens || []).find((m) => /obrigat|erro|inv[aá]lid|falha|tente novamente/i.test(m)) || null;
  return { ok: ok && !erro, erro, mensagens: p.mensagens };
}

/**
 * Atualiza as tabelas do PJe-Calc em execução pela própria tela (Atualização de Tabelas e Índices >
 * Online): o aplicativo baixa do TRT escolhido (ou, se ele recusar, pelo proxy nacional do TRT8) e
 * aplica. `regional` deve ser o TRT do processo: as tabelas regionais de outros TRTs são substituídas.
 *
 * Não há alternativa "via arquivo" automática: o pacote do serviço nacional não traz as tabelas de
 * SELIC diária/mensal e TUACDT, e aplicá-lo por arquivo as deixa vazias (testado). Só o caminho
 * online do próprio PJe-Calc as recompõe.
 */
export async function atualizarTabelas({ regional = 'TRT8', base = null } = {}) {
  if (!REGIONAIS.includes(regional)) throw new Error(`regional deve ser TRT1..TRT24 (recebido "${regional}").`);
  const s = new SessaoPjeCalc(base);
  await s.inicio();
  await s.menu('Atualização de Tabelas e Índices');
  const t0 = Date.now();
  const p = await s.clicar('atualizarOnline', { 'formulario:regional': regional });
  const r = resultadoDaTela(p);
  // "Você já possui as tabelas auxiliares nacionais e regionais mais recentes disponíveis" = nada a baixar
  if (!r.ok && (r.mensagens || []).some((m) => /j[aá] possui as tabelas/i.test(m))) { r.ok = true; r.jaEstavaAtualizado = true; }
  if (r.ok) {
    // "tabelasMudaramEm": última sincronização que trouxe tabelas novas (a biblioteca de verbas é refeita depois dela)
    const agora = new Date().toISOString();
    const antes = regionalCarregado() || {};
    const mudaram = !r.jaEstavaAtualizado || antes.regional !== regional;
    try { fs.writeFileSync(arquivoEstado(), JSON.stringify({ regional, atualizadoEm: agora, tabelasMudaramEm: mudaram ? agora : (antes.tabelasMudaramEm || antes.atualizadoEm || agora) }, null, 2)); } catch { /* só informativo */ }
  }
  return { atualizado: r.ok, jaEstavaAtualizado: Boolean(r.jaEstavaAtualizado), regional, segundos: Math.round((Date.now() - t0) / 1000), erro: r.ok ? null : r.erro, mensagens: r.mensagens };
}
