// pjecalc-mcp-skill · lib/processo.mjs
// Mapa do processo: o processo principal, a fase em que está, o tipo de trabalho que essa fase exige e
// todos os processos ligados a ele (conexos, ação anterior arquivada, coletiva, acordo, recuperação
// judicial...), com o efeito de cada um no cálculo. Também confere devedores, pagamentos feitos na
// execução e destinos do crédito.
//
//   avaliarProcesso(spec, { cenario }) -> { mapa, verificacoes, abertas, provisorio }
//
// As verificações vão para a dimensão "processo" da auditoria. Os documentos exigidos por relação e por
// fase são conferidos em lib/documentos.mjs (requisitos REL:<id>:<item> e FASE:<item>).

import { numeroCnj } from './gerador.mjs';

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const lista = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const iso = (v) => {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};
const digitos = (n) => String(n ?? '').replace(/\D/g, '');
const menosAnos = (d, n) => `${Number(d.slice(0, 4)) - n}${d.slice(4)}`;

export const FASES = ['PRE_PROCESSUAL', 'CONHECIMENTO', 'RECURSAL', 'LIQUIDACAO', 'EXECUCAO_PROVISORIA', 'EXECUCAO', 'ENCERRADO'];
export const TRABALHOS = ['CALCULO_NOVO', 'ATUALIZACAO', 'EXECUCAO_COLETIVA', 'HABILITACAO', 'ENTE_PUBLICO'];
export const RELACOES = ['PRINCIPAL', 'CONEXO', 'CONTINENCIA', 'LITISPENDENCIA', 'COISA_JULGADA', 'ANTERIOR_ARQUIVADO', 'PROTESTO_INTERRUPTIVO',
  'COLETIVO', 'ACORDO', 'CONTRATO_ANTERIOR', 'CONSIGNACAO', 'PROVA_EMPRESTADA', 'INQUERITO', 'RECUPERACAO_JUDICIAL', 'FALENCIA',
  'EXECUCOES_REUNIDAS', 'EMBARGOS_TERCEIRO', 'CARTA_PRECATORIA', 'RESCISORIA', 'MANDADO_SEGURANCA', 'RECLAMACAO_CONSTITUCIONAL', 'OUTRO'];
export const RESPONSABILIDADES = ['PRINCIPAL', 'SOLIDARIA', 'SUBSIDIARIA'];
export const TIPOS_PAGAMENTO_EXECUCAO = ['DEPOSITO_RECURSAL', 'DEPOSITO_JUDICIAL', 'BLOQUEIO', 'PENHORA', 'ALVARA', 'ACORDO', 'PAGAMENTO_DIRETO', 'PARCELAMENTO'];
export const TIPOS_DESTINO = ['HONORARIOS_CONTRATUAIS', 'PENHORA_NO_ROSTO', 'CESSAO', 'PENSAO_ALIMENTICIA', 'HERDEIROS', 'OUTRO'];
// fases em que a decisão ainda pode mudar: o cálculo é provisório por natureza
export const FASES_ANTES_DO_TRANSITO = ['PRE_PROCESSUAL', 'CONHECIMENTO', 'RECURSAL'];

/** Números de processo (padrão CNJ) citados em qualquer texto do contrato de dados. */
function numerosCitados(c) {
  const achados = [];
  const re = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
  const andar = (v, onde) => {
    if (v == null) return;
    if (typeof v === 'string') { for (const m of v.matchAll(re)) achados.push({ numero: m[0], onde }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => andar(x, `${onde}[${i}]`)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!(onde === 'contrato.processos' || /^contrato\.processos\[\d+\]$/.test(onde)) || k !== 'numero') andar(x, `${onde}.${k}`);
  };
  andar(c, 'contrato');
  return achados;
}

export function principalDe(c) {
  return lista(c && c.processos).find((p) => semAcento(p.relacao) === 'PRINCIPAL') || null;
}

export function avaliarProcesso(spec, { cenario = false } = {}) {
  const s = spec || {};
  const c = s.contrato || {};
  const verificacoes = []; const abertas = [];
  let provisorio = false;
  const reg = (item, estado, detalhe) => verificacoes.push({ item, estado, detalhe, dimensao: 'processo' });
  const incerteza = (id, item, detalhe) => {
    abertas.push({ id, descricao: `${item}: ${detalhe}` });
    reg(item, cenario ? 'alerta' : 'falha', `${detalhe}${cenario ? ' — precisa estar variada ou fixada no cenário' : ': só pode seguir numa simulação declarada ("cenario")'}`);
  };
  const procs = lista(c.processos);
  const principal = principalDe(c);
  if (!procs.length) {
    reg('mapa do processo', 'falha', 'contrato.processos vazio: registre o processo principal (relacao PRINCIPAL, fase, trabalho) e todos os processos ligados a ele — pjecalc://docs/modulos/processo');
    return { mapa: null, verificacoes, abertas, provisorio };
  }
  const ids = procs.map((p) => p.id);
  const rep = ids.filter((x, i) => x && ids.indexOf(x) !== i);
  if (rep.length || ids.some((x) => !x)) reg('mapa do processo', 'falha', rep.length ? `ids repetidos: ${[...new Set(rep)].join(', ')}` : 'processo sem "id"');
  const nPrincipais = procs.filter((p) => semAcento(p.relacao) === 'PRINCIPAL').length;
  if (nPrincipais !== 1) reg('mapa do processo', 'falha', `${nPrincipais} processo(s) com relacao PRINCIPAL: deve haver exatamente um`);
  const decs = new Map(lista(c.decisoes).map((d) => [d.id, d]));
  const docs = new Map(lista(c.documentos).map((d) => [d.id, d]));
  const parcs = new Map(lista(c.parcelas).map((p) => [p.id, p]));
  const pags = new Map(lista(c.pagamentos).map((p) => [p.id, p]));
  const calc = s.calculo || {};
  const dataLiq = iso(c.dataLiquidacao);

  for (const p of procs) {
    const ctx = `processo ${p.id || '?'} (${p.relacao || '?'})`;
    try {
      const n = numeroCnj(p.numero);
      if (!n.digitoCorreto) reg(ctx, 'falha', `número ${p.numero} com dígito verificador errado (esperado ${n.digitoEsperado})`);
    } catch { reg(ctx, 'falha', `número "${p.numero || ''}" fora do padrão CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO)`); }
    if (!RELACOES.includes(semAcento(p.relacao).replace(/ /g, '_'))) reg(ctx, 'falha', `relação "${p.relacao}" inválida (${RELACOES.join(', ')})`);
    for (const id of lista(p.documentos)) if (!docs.has(id)) reg(ctx, 'falha', `documento "${id}" não existe em contrato.documentos`);
  }

  // processo principal: fase e tipo de trabalho
  if (principal) {
    const ctx = `processo principal ${principal.id}`;
    if (s.processo && s.processo.numero && digitos(s.processo.numero) !== digitos(principal.numero)) reg(ctx, 'falha', `número ${principal.numero} diferente do informado em processo.numero (${s.processo.numero})`);
    const fase = semAcento(principal.fase).replace(/ /g, '_');
    const trabalho = semAcento(principal.trabalho || 'CALCULO_NOVO').replace(/ /g, '_');
    if (!FASES.includes(fase)) reg(ctx, 'falha', `fase "${principal.fase || ''}" não informada ou inválida (${FASES.join(', ')})`);
    if (!TRABALHOS.includes(trabalho)) reg(ctx, 'falha', `trabalho "${principal.trabalho}" inválido (${TRABALHOS.join(', ')})`);
    if (fase === 'EXECUCAO_PROVISORIA') { provisorio = true; reg(ctx, 'alerta', 'execução provisória: o resultado é provisório e precisa ser refeito se as decisões pendentes mudarem'); }
    if (fase === 'EXECUCAO' && trabalho === 'CALCULO_NOVO') {
      const j = principal.justificativaRecalculo || {};
      if (!j.decisao || !decs.has(j.decisao) || !j.motivo) reg(ctx, 'falha', 'na execução o ponto de partida é o cálculo homologado; recalcular do zero exige "justificativaRecalculo" com a decisão que manda recalcular (ou rescinde a liquidação) e o motivo');
    }
    if (trabalho === 'ATUALIZACAO' && !s.execucao) reg(ctx, 'falha', 'atualização de cálculo homologado: informe o bloco "execucao" (data da atualização, pagamentos, honorários e multas da execução, precatório) e use calculo_atualizar com o .PJC do cálculo homologado liquidado (ou calculo_externo_criar, se a conta homologada foi feita fora do PJe-Calc)');
    if (trabalho === 'EXECUCAO_COLETIVA' && !procs.some((p) => semAcento(p.relacao) === 'COLETIVO' && p.efeito && p.efeito.titulo)) reg(ctx, 'falha', 'execução individual de sentença coletiva sem o processo coletivo no mapa (relacao COLETIVO, efeito.titulo = true)');
    if (trabalho === 'HABILITACAO' && !procs.some((p) => ['RECUPERACAO_JUDICIAL', 'FALENCIA'].includes(semAcento(p.relacao).replace(/ /g, '_')))) reg(ctx, 'falha', 'habilitação de crédito sem o processo de recuperação judicial ou falência no mapa');
    if (trabalho === 'ENTE_PUBLICO' && !lista(c.devedores).some((d) => d.entePublico)) reg(ctx, 'falha', 'trabalho ENTE_PUBLICO sem devedor com "entePublico": true em contrato.devedores');
    if (Number(principal.reclamantes) > 1) reg(ctx, 'alerta', `${principal.reclamantes} reclamantes: faça um cálculo por reclamante (cada um com o próprio contrato de dados)`);
    for (const [i, f] of lista(c.fases).entries()) {
      if (!f.evento || !iso(f.data)) reg(`fases[${i}]`, 'falha', 'evento sem "evento" ou "data" válida');
      if (f.documento && !docs.has(f.documento)) reg(`fases[${i}]`, 'falha', `documento "${f.documento}" não existe`);
      if (f.processo && !ids.includes(f.processo)) reg(`fases[${i}]`, 'falha', `processo "${f.processo}" não está no mapa`);
    }
  }

  // processos ligados: cada relação declara o efeito no cálculo
  for (const p of procs.filter((x) => x !== principal)) {
    const rel = semAcento(p.relacao).replace(/ /g, '_');
    const ctx = `processo ${p.id} (${rel} ${p.numero || ''})`;
    const e = p.efeito;
    if (!e || typeof e !== 'object' || !Object.keys(e).length) { reg(ctx, 'falha', 'efeito no cálculo não declarado ("efeito": exclui, abate, prescricao, titulo, dataLimite, suspende — ou "nenhum": true com "motivo")'); continue; }
    if (e.nenhum && !e.motivo) reg(ctx, 'falha', '"efeito.nenhum" sem "motivo"');
    for (const id of lista(e.exclui)) {
      if (!parcs.has(id)) { reg(ctx, 'falha', `efeito.exclui cita a parcela "${id}", que não existe`); continue; }
      const usadas = lista(s.verbas).filter((v) => lista(v.origem ?? (v.personalizada && v.personalizada.origem)).includes(id));
      if (usadas.length) reg(ctx, 'falha', `a parcela ${id} já foi decidida ou quitada neste processo, mas está no cálculo (${usadas.map((v) => v.nome || v.verba).join(', ')}): retire-a ou troque "exclui" por "abate"`);
    }
    for (const id of lista(e.abate)) if (!pags.has(id)) reg(ctx, 'falha', `efeito.abate cita o pagamento "${id}", que não existe em contrato.pagamentos`);
    if (['LITISPENDENCIA', 'COISA_JULGADA'].includes(rel) && !lista(e.exclui).length && !e.nenhum) reg(ctx, 'falha', 'litispendência/coisa julgada sem as parcelas atingidas em "efeito.exclui"');
    if (['ANTERIOR_ARQUIVADO', 'PROTESTO_INTERRUPTIVO'].includes(rel) && !e.nenhum) {
      const marco = iso(e.prescricao);
      if (!marco) reg(ctx, 'falha', 'interrupção da prescrição sem a data do marco em "efeito.prescricao"');
      else {
        const limite = menosAnos(marco, 5);
        if (calc.prescricaoQuinquenal === true) reg(ctx, 'falha', `a prescrição quinquenal do PJe-Calc conta do ajuizamento; com o marco interruptivo em ${marco}, desligue "prescricaoQuinquenal" e comece o cálculo em ${limite} (ou na admissão, se posterior)`);
        else if (iso(calc.inicio) && iso(calc.inicio) < limite) reg(ctx, 'falha', `o cálculo começa em ${iso(calc.inicio)}, antes do limite prescricional com o marco de ${marco} (${limite})`);
        reg(ctx, 'alerta', `a interrupção vale só para os pedidos idênticos aos da ${rel === 'PROTESTO_INTERRUPTIVO' ? 'medida de protesto' : 'ação arquivada'} (Súmula 268 do TST): confira o período de cada parcela`);
      }
    }
    if (rel === 'COLETIVO' && e.titulo && principal && semAcento(principal.trabalho) !== 'EXECUCAO COLETIVA') reg(ctx, 'alerta', 'o título é a sentença coletiva: o trabalho do processo principal deveria ser EXECUCAO_COLETIVA');
    if (['RECUPERACAO_JUDICIAL', 'FALENCIA'].includes(rel)) {
      const lim = iso(e.dataLimite);
      if (!lim) reg(ctx, 'falha', `${rel === 'FALENCIA' ? 'falência' : 'recuperação judicial'} sem "efeito.dataLimite" (data do pedido ou da decretação, limite da atualização do crédito habilitado)`);
      else if (dataLiq && dataLiq > lim) reg(ctx, 'falha', `liquidação em ${dataLiq}, depois da data-limite ${lim}: o crédito habilitado é atualizado até a data-limite`);
    }
    if (rel === 'PROVA_EMPRESTADA' && (!e.admitidaPor || !decs.has(e.admitidaPor))) reg(ctx, 'falha', 'prova emprestada sem a decisão do processo principal que a admitiu ("efeito.admitidaPor")');
    if (['RESCISORIA', 'MANDADO_SEGURANCA', 'RECLAMACAO_CONSTITUCIONAL'].includes(rel)) {
      if (e.suspende) incerteza(`PROC:${p.id}`, ctx, 'decisão deste processo suspende ou pode desfazer o título');
      else reg(ctx, 'alerta', 'ação que pode desfazer ou cassar capítulos do título: acompanhe e refaça o cálculo se houver decisão');
    }
  }

  // números de processo citados nos documentos e decisões que não estão no mapa
  const registrados = new Set([...procs.map((p) => digitos(p.numero)), digitos(s.processo && s.processo.numero)]);
  const faltantes = new Map();
  for (const a of numerosCitados(c)) if (!registrados.has(digitos(a.numero)) && !faltantes.has(a.numero)) faltantes.set(a.numero, a.onde);
  for (const [numero, onde] of faltantes) reg('mapa do processo', 'falha', `o processo ${numero}, citado em ${onde}, não está em contrato.processos: registre a relação e o efeito (ou "efeito.nenhum" com motivo)`);

  // devedores
  const devedores = lista(c.devedores);
  for (const d of devedores) {
    const ctx = `devedor ${d.id || d.nome || '?'}`;
    const resp = semAcento(d.responsabilidade || 'PRINCIPAL');
    if (!RESPONSABILIDADES.includes(resp)) reg(ctx, 'falha', `responsabilidade "${d.responsabilidade}" inválida (${RESPONSABILIDADES.join(', ')})`);
    if (resp === 'SUBSIDIARIA' && !(d.periodo && iso(d.periodo.inicio))) reg(ctx, 'falha', 'responsável subsidiário sem "periodo" (a responsabilidade se limita ao período em que o reclamante trabalhou para ele)');
    if (d.documento && !docs.has(d.documento)) reg(ctx, 'falha', `documento "${d.documento}" não existe`);
    const lim = iso((d.recuperacaoJudicial || d.falencia || {}).dataLimite);
    if (lim && dataLiq && dataLiq > lim) reg(ctx, 'falha', `liquidação em ${dataLiq}, depois da data-limite do crédito habilitado (${lim})`);
  }
  if (devedores.filter((d) => d.periodo).length && devedores.length > 1) reg('devedores', 'alerta', 'devedores com períodos diferentes: faça um cálculo por devedor ou limite o período de cada um (o PJe-Calc calcula uma conta por vez)');

  // pagamentos feitos na execução e destinos do crédito
  for (const [i, pg] of lista(c.pagamentosExecucao).entries()) {
    const ctx = `pagamentosExecucao[${i}] ${pg.id || ''}`;
    if (!TIPOS_PAGAMENTO_EXECUCAO.includes(semAcento(pg.tipo).replace(/ /g, '_'))) reg(ctx, 'falha', `tipo "${pg.tipo}" inválido (${TIPOS_PAGAMENTO_EXECUCAO.join(', ')})`);
    if (!iso(pg.data)) reg(ctx, 'falha', 'sem data (a data define a atualização e a imputação)');
    if (!(Number(pg.valor) > 0)) reg(ctx, 'falha', 'sem valor');
    if (!pg.documento || !docs.has(pg.documento)) reg(ctx, 'falha', `documento "${pg.documento || ''}" não existe (guia, extrato judicial ou alvará)`);
  }
  if (lista(c.pagamentosExecucao).length) reg('pagamentos da execução', 'alerta', 'depósitos, bloqueios e alvarás são abatidos na atualização do cálculo homologado (Pagamento/Atualização), feita na tela até a versão que a cobre — informe-os ao usuário com a ordem de imputação (juros antes do principal)');
  for (const [i, d] of lista(c.destinosDoCredito).entries()) {
    const ctx = `destinosDoCredito[${i}] ${d.tipo || ''}`;
    if (!TIPOS_DESTINO.includes(semAcento(d.tipo).replace(/ /g, '_'))) reg(ctx, 'falha', `tipo "${d.tipo}" inválido (${TIPOS_DESTINO.join(', ')})`);
    if (!(d.documento && docs.has(d.documento)) && !(d.decisao && decs.has(d.decisao))) reg(ctx, 'falha', 'sem documento ou decisão que o fundamente');
    if (d.valor == null && d.percentual == null) reg(ctx, 'falha', 'sem valor nem percentual');
  }
  if (lista(c.destinosDoCredito).length) reg('destinos do crédito', 'alerta', `o líquido do PJe-Calc não desconta ${lista(c.destinosDoCredito).map((d) => d.tipo).join(', ')}: informe ao usuário o valor que efetivamente cabe ao reclamante`);

  if (principal && !verificacoes.some((v) => v.estado === 'falha')) reg('mapa do processo', 'ok', `processo ${principal.numero}, fase ${principal.fase}, trabalho ${principal.trabalho || 'CALCULO_NOVO'}; ${procs.length - 1} processo(s) ligado(s)`);
  const mapa = principal ? {
    principal: { id: principal.id, numero: principal.numero, fase: principal.fase, trabalho: principal.trabalho || 'CALCULO_NOVO' },
    relacionados: procs.filter((p) => p !== principal).map((p) => ({ id: p.id, numero: p.numero, relacao: p.relacao, fase: p.fase || null, efeito: p.efeito || null, documentos: lista(p.documentos) })),
    devedores: devedores.map((d) => ({ id: d.id, nome: d.nome, responsabilidade: d.responsabilidade || 'PRINCIPAL', periodo: d.periodo || null, entePublico: Boolean(d.entePublico) })),
    numerosCitadosNaoRegistrados: [...faltantes.keys()],
  } : null;
  return { mapa, verificacoes, abertas, provisorio };
}
