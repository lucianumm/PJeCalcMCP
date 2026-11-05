// pjecalc-mcp-skill · lib/titulo.mjs
// Composição do título executivo a partir de TODAS as decisões (vara, TRT, TST, STF, liquidação e
// execução), capítulo por capítulo (parcela ou critério), com as regras:
//   - o julgamento do recurso substitui a decisão recorrida no que foi objeto do recurso;
//   - recurso não conhecido ou prejudicado não substitui nada;
//   - embargos de declaração integram a decisão (e podem modificá-la);
//   - anulação com retorno: vale a nova decisão de origem;
//   - capítulo sem trânsito só entra antes do trânsito (cálculo provisório) ou em execução provisória;
//   - contradição entre dispositivo e fundamentação é conflito registrado, não escolha do agente.
//
//   comporTitulo(spec, { cenario, fase }) -> { capitulos, verificacoes, abertas, provisorio }

import { conferirPrecedentes } from './precedentes.mjs';
import { principalDe, FASES_ANTES_DO_TRANSITO } from './processo.mjs';

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const cod = (s) => semAcento(s).replace(/ /g, '_');
const lista = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const iso = (v) => {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};

export const INSTANCIAS = ['VARA', 'TRT_TURMA', 'TRT_PLENO', 'TST_TURMA', 'TST_SDI1', 'TST_SDI2', 'TST_ORGAO_ESPECIAL', 'TST_PLENO', 'STF', 'STJ'];
export const TIPOS_DECISAO = ['SENTENCA', 'EMBARGOS_DECLARACAO', 'ACORDAO', 'DECISAO_MONOCRATICA', 'AGRAVO_INTERNO', 'ADMISSIBILIDADE', 'JUIZO_RETRATACAO',
  'SENTENCA_LIQUIDACAO', 'HOMOLOGACAO', 'DECISAO_IMPUGNACAO', 'EMBARGOS_EXECUCAO', 'AGRAVO_PETICAO', 'RESCISORIA', 'MANDADO_SEGURANCA',
  'RECLAMACAO_CONSTITUCIONAL', 'HOMOLOGACAO_ACORDO', 'DESPACHO', 'OUTRA'];
// decisões que julgam recurso ou embargos de outra decisão: precisam de "recorrida" e "resultado"
const JULGAM_OUTRA = ['EMBARGOS_DECLARACAO', 'ACORDAO', 'DECISAO_MONOCRATICA', 'AGRAVO_INTERNO', 'JUIZO_RETRATACAO', 'AGRAVO_PETICAO', 'DECISAO_IMPUGNACAO', 'EMBARGOS_EXECUCAO'];
export const RESULTADOS = ['NAO_CONHECIDO', 'DESPROVIDO', 'PROVIDO', 'PARCIALMENTE_PROVIDO', 'ANULADO_COM_RETORNO', 'PREJUDICADO', 'ACOLHIDOS', 'REJEITADOS', 'ACOLHIDOS_EM_PARTE'];
const SEM_SUBSTITUICAO = ['NAO_CONHECIDO', 'PREJUDICADO'];
export const EFEITOS = ['DEFERE', 'INDEFERE', 'MANTEM', 'REFORMA', 'EXCLUI', 'ACRESCENTA', 'INTEGRA', 'ANULA'];
const ORDEM_INSTANCIA = { VARA: 1, TRT_TURMA: 2, TRT_PLENO: 3, TST_TURMA: 4, TST_SDI1: 5, TST_SDI2: 5, TST_ORGAO_ESPECIAL: 6, TST_PLENO: 6, STJ: 6, STF: 7 };

const transitoCobre = (d, chave) => {
  if (!d.transito) return null;
  if (typeof d.transito === 'string') return iso(d.transito);
  for (const t of lista(d.transito)) if (!lista(t.capitulos).length || lista(t.capitulos).includes(chave)) return iso(t.data);
  return null;
};

export function comporTitulo(spec, { cenario = false } = {}) {
  const s = spec || {};
  const c = s.contrato || {};
  const verificacoes = []; const abertas = [];
  let provisorio = false;
  const reg = (item, estado, detalhe) => verificacoes.push({ item, estado, detalhe, dimensao: 'titulo' });
  const decs = lista(c.decisoes);
  const porId = new Map(decs.map((d) => [d.id, d]));
  const parcs = new Map(lista(c.parcelas).map((p) => [p.id, p]));
  const principal = principalDe(c);
  const fase = cod(principal && principal.fase);
  const antesDoTransito = FASES_ANTES_DO_TRANSITO.includes(fase);

  // 1. cada decisão bem registrada
  for (const d of decs) {
    const ctx = `decisão ${d.id}`;
    const tipo = cod(d.tipo);
    if (!INSTANCIAS.includes(cod(d.instancia))) reg(ctx, 'falha', `"instancia" ${d.instancia ? `"${d.instancia}" inválida` : 'não informada'} (${INSTANCIAS.join(', ')})`);
    if (!TIPOS_DECISAO.includes(tipo)) reg(ctx, 'falha', `"tipo" ${d.tipo ? `"${d.tipo}" inválido` : 'não informado'} (${TIPOS_DECISAO.join(', ')})`);
    if (!iso(d.publicacao || d.data)) reg(ctx, 'falha', 'sem data de publicação ("publicacao"): a ordem da cadeia de decisões depende dela');
    if (JULGAM_OUTRA.includes(tipo)) {
      if (!d.recorrida || !porId.has(d.recorrida)) reg(ctx, 'falha', `julga recurso ou embargos, mas "recorrida" ${d.recorrida ? `cita ${d.recorrida}, que não existe` : 'não foi informada'}`);
      if (!RESULTADOS.includes(cod(d.resultado))) reg(ctx, 'falha', `"resultado" ${d.resultado ? `"${d.resultado}" inválido` : 'não informado'} (${RESULTADOS.join(', ')})`);
    }
    if (d.processo && !lista(c.processos).some((p) => p.id === d.processo)) reg(ctx, 'falha', `processo "${d.processo}" não está em contrato.processos`);
    for (const [i, cap] of lista(d.capitulos).entries()) {
      const cctx = `${ctx} / capítulo ${cap.parcela || cap.criterio || i}`;
      if (!cap.parcela && !cap.criterio) reg(cctx, 'falha', 'capítulo sem "parcela" (id) nem "criterio" (ex.: ATUALIZACAO, HONORARIOS, CUSTAS)');
      if (cap.parcela && !parcs.has(cap.parcela)) reg(cctx, 'falha', `parcela "${cap.parcela}" não existe em contrato.parcelas`);
      if (!EFEITOS.includes(cod(cap.efeito))) reg(cctx, 'falha', `efeito "${cap.efeito || ''}" inválido (${EFEITOS.join(', ')})`);
      if (cod(cap.efeito) === 'REFORMA' && !['DEFERIDA', 'INDEFERIDA', 'ALTERADA'].includes(cod(cap.situacao))) reg(cctx, 'falha', 'reforma sem a "situacao" resultante (DEFERIDA, INDEFERIDA ou ALTERADA, com o "detalhe" do que mudou)');
      if (SEM_SUBSTITUICAO.includes(cod(d.resultado)) && !['MANTEM'].includes(cod(cap.efeito))) reg(cctx, 'falha', `recurso ${cod(d.resultado) === 'NAO_CONHECIDO' ? 'não conhecido' : 'prejudicado'} não reforma nada: a decisão anterior continua valendo`);
    }
    for (const r of lista(d.recursos)) {
      const st = cod(r.situacao);
      if (!['PENDENTE', 'JULGADO'].includes(st)) reg(ctx, 'falha', `recurso ${r.tipo || ''} com "situacao" "${r.situacao || ''}" (PENDENTE ou JULGADO)`);
      if (st === 'JULGADO' && !(r.julgadoPor && porId.has(r.julgadoPor))) reg(ctx, 'falha', `recurso ${r.tipo || ''} JULGADO sem a decisão que o julgou ("julgadoPor") registrada`);
    }
    for (const cf of lista(d.conflitos)) {
      const resolvido = cf.resolucao && cf.decisao && porId.has(cf.decisao);
      if (resolvido) reg(ctx, 'alerta', `conflito "${cf.descricao || cf.id}" resolvido por ${cf.decisao}: "${cf.resolucao}"`);
      else {
        abertas.push({ id: `TIT:${d.id}:${cf.id || 'conflito'}`, descricao: `conflito na decisão ${d.id}: ${cf.descricao || cf.id}` });
        reg(ctx, cenario ? 'alerta' : 'falha', `conflito "${cf.descricao || cf.id}" (ex.: dispositivo × fundamentação) sem resolução fundamentada${cenario ? ' — precisa estar variado ou fixado no cenário' : ': registre "resolucao" + "decisao" (embargos, decisão posterior) ou declare um cenário'}`);
      }
    }
  }
  // recursos interpostos que já têm decisão de julgamento: a decisão de julgamento cita a recorrida
  const pendentesContra = (d, chave) => lista(d.recursos).some((r) => cod(r.situacao) === 'PENDENTE' && (!lista(r.objeto).length || lista(r.objeto).includes(chave)));

  // 2. cadeia por capítulo
  const chaves = [...new Set([...parcs.keys(), ...decs.flatMap((d) => lista(d.capitulos).map((x) => x.parcela || cod(x.criterio)).filter(Boolean))])];
  const ordenadas = [...decs].sort((a, b) => (iso(a.publicacao || a.data) || '').localeCompare(iso(b.publicacao || b.data) || '') || (ORDEM_INSTANCIA[cod(a.instancia)] || 0) - (ORDEM_INSTANCIA[cod(b.instancia)] || 0));
  const capitulos = [];
  const usadas = new Set(lista(s.verbas).flatMap((v) => lista(v.origem ?? (v.personalizada && v.personalizada.origem))));
  for (const chave of chaves) {
    const ehParcela = parcs.has(chave);
    const parcela = parcs.get(chave);
    const cadeia = []; let vigente = null; let fonte = null; let situacao = null; let anulada = false; let transito = null; let pendente = false;
    for (const d of ordenadas) {
      const cap = lista(d.capitulos).find((x) => (x.parcela || cod(x.criterio)) === chave);
      if (!cap) continue;
      const ef = cod(cap.efeito); const res = cod(d.resultado);
      cadeia.push({ decisao: d.id, instancia: d.instancia, tipo: d.tipo, resultado: d.resultado || null, efeito: ef, situacao: cap.situacao || null, folha: cap.folha || d.folha || null });
      if (SEM_SUBSTITUICAO.includes(res)) { transito = transitoCobre(d, chave) || transito; continue; }
      if (ef === 'ANULA') { vigente = null; fonte = null; situacao = null; anulada = true; continue; }
      vigente = d; anulada = false;
      if (ef === 'DEFERE' || ef === 'ACRESCENTA') { situacao = 'DEFERIDA'; fonte = d; }
      else if (ef === 'INDEFERE' || ef === 'EXCLUI') { situacao = 'INDEFERIDA'; fonte = d; }
      else if (ef === 'REFORMA') { situacao = cod(cap.situacao) === 'INDEFERIDA' ? 'INDEFERIDA' : 'DEFERIDA'; fonte = d; }
      else if (ef === 'INTEGRA') { if (cap.situacao) situacao = cod(cap.situacao) === 'INDEFERIDA' ? 'INDEFERIDA' : 'DEFERIDA'; fonte = d; }
      // MANTEM: substitui (é a decisão que vale), mas o conteúdo continua sendo o da fonte anterior
      transito = transitoCobre(d, chave) || transito;
    }
    // recurso pendente contra qualquer decisão da cadeia que ainda não foi substituída
    for (const e of cadeia) if (pendentesContra(porId.get(e.decisao), chave)) pendente = pendente || !ordenadas.some((d) => d.recorrida === e.decisao && lista(d.capitulos).some((x) => (x.parcela || cod(x.criterio)) === chave));
    if (vigente && transitoCobre(vigente, chave)) transito = transitoCobre(vigente, chave);
    const linha = { capitulo: chave, rubrica: parcela ? parcela.rubrica : null, cadeia, vigente: vigente ? vigente.id : null, fonte: fonte ? fonte.id : null, situacao, transito, transitado: Boolean(transito) && !pendente, pendente };
    capitulos.push(linha);
    const ctx = ehParcela ? `título / parcela ${chave} (${parcela.rubrica || '?'})` : `título / ${chave}`;
    if (!cadeia.length) {
      if (ehParcela && semAcento(parcela.situacao) !== 'INDEFERIDA') reg(ctx, 'falha', `nenhuma decisão lista este capítulo: registre em "capitulos" da decisão ${parcela.decisao || '?'} (e das que a mantiveram ou reformaram)`);
      continue;
    }
    if (anulada && !vigente) { reg(ctx, 'falha', 'capítulo anulado sem nova decisão: aguarde ou registre a decisão proferida após o retorno'); continue; }
    if (!vigente) { reg(ctx, 'falha', 'nenhuma decisão de mérito vigente (só recursos não conhecidos ou prejudicados)'); continue; }
    if (ehParcela) {
      if (parcela.decisao && parcela.decisao !== vigente.id && parcela.decisao !== (fonte && fonte.id)) reg(ctx, 'falha', `a parcela cita ${parcela.decisao}, mas a decisão que vale para ela é ${vigente.id}${fonte && fonte.id !== vigente.id ? ` (conteúdo de ${fonte.id})` : ''}`);
      const sitParcela = semAcento(parcela.situacao);
      if (situacao === 'INDEFERIDA' && ['DEFERIDA', 'REFORMADA'].includes(sitParcela)) reg(ctx, 'falha', `a cadeia de decisões termina INDEFERIDA (${vigente.id}), mas a parcela está ${parcela.situacao}${sitParcela === 'REFORMADA' ? ': parcela excluída por decisão posterior fica INDEFERIDA (REFORMADA é para a parcela que continua deferida com o conteúdo alterado; a reforma já aparece na cadeia)' : ''}`);
      if (situacao === 'DEFERIDA' && sitParcela === 'INDEFERIDA') reg(ctx, 'falha', `a cadeia de decisões termina DEFERIDA (${vigente.id}), mas a parcela está INDEFERIDA`);
    }
    const relevante = !ehParcela || usadas.has(chave) || chave === 'ATUALIZACAO' || chave === 'HONORARIOS';
    if (relevante && !linha.transitado) {
      const motivo = pendente ? 'há recurso pendente' : 'trânsito em julgado não informado';
      if (antesDoTransito) { provisorio = true; reg(ctx, 'alerta', `${motivo}: a decisão ainda pode mudar — cálculo provisório`); }
      else if (fase === 'EXECUCAO_PROVISORIA') { provisorio = true; reg(ctx, 'alerta', `${motivo}: entra só na execução provisória`); }
      else reg(ctx, 'falha', `${motivo}, mas o processo está em ${fase || 'fase não informada'}: registre o trânsito (por capítulo) ou trate como execução provisória`);
    }
  }
  // parâmetros ligados à decisão que vale
  const cap = (k) => capitulos.find((x) => x.capitulo === k) || null;
  const capAt = cap('ATUALIZACAO');
  const cj = s.correcaoJuros;
  if (capAt && cj && lista(cj.origem).length && !lista(cj.origem).some((id) => id === capAt.vigente || id === capAt.fonte)) reg('título / ATUALIZACAO', 'falha', `"correcaoJuros.origem" cita ${lista(cj.origem).join(', ')}, mas a decisão que vale para correção e juros é ${capAt.vigente}`);
  const capHon = cap('HONORARIOS');
  if (capHon) for (const [i, h] of lista(s.honorarios).entries()) if (lista(h.origem).length && !lista(h.origem).some((id) => id === capHon.vigente || id === capHon.fonte)) reg(`título / honorarios[${i}]`, 'alerta', `"origem" cita ${lista(h.origem).join(', ')}, mas a decisão que vale para honorários é ${capHon.vigente}`);
  verificacoes.push(...conferirPrecedentes(s, { capAtualizacao: capAt, cenario }));
  if (!verificacoes.some((v) => v.estado === 'falha')) reg('título executivo', 'ok', `${capitulos.length} capítulo(s) compostos a partir de ${decs.length} decisão(ões)`);
  return { capitulos, verificacoes, abertas, provisorio };
}
