// pjecalc-mcp-skill · lib/auditoria.mjs
// Auditoria separada da validação técnica. A validação técnica (gerador) diz se o PJe-Calc aceita a
// especificação; a auditoria confere se cada parâmetro tem origem na prova e nas decisões do processo
// (contrato de dados), procura incoerências conhecidas e confere os números que o PJe-Calc produziu.
//
//   auditarEspecificacao(spec)            -> antes de calcular: contrato, vínculos, identidade e saldo dos
//                                            pagamentos, eventos x título, cobertura dos cenários
//   conferenciaIndependente(arvore, ...)  -> depois de liquidar: aritmética, completude das ocorrências,
//                                            avos, aviso, quantidades do cartão
//   compararEspecificacaoResultado(...)   -> verbas pedidas x ocorrências finais x relatório
//   consolidarEstado(...)                 -> rascunho | aceito_pelo_aplicativo | calculado | simulacao | auditado
//
// Cada verificação: { item, estado: ok | falha | alerta | nao_verificado, detalhe, dimensao }.
// Dimensões: transferencia, aritmetica, completude, documentacao (a revisão interpretativa é humana).
// "nao_verificado" nunca conta como sucesso; alerta material precisa de revisão registrada.

import { campo, itens, objetos } from './pjc.mjs';
import { periodosDeFerias } from './gerador.mjs';
import { avaliarDocumentacao, textoPedido } from './documentos.mjs';
import { avaliarProcesso } from './processo.mjs';
import { comporTitulo } from './titulo.mjs';
import { verificarAprovacao } from './plano.mjs';
import { avaliarLeitura } from './leitura.mjs';

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const lista = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** 'AAAA-MM-DD' | 'DD/MM/AAAA' | 'AAAA-MM' | 'MM/AAAA' -> 'AAAA-MM-DD' (competência = dia 01). */
export function iso(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(s); if (m) return `${m[1]}-${m[2]}-01`;
  m = /^(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[2]}-${m[1]}-01`;
  return null;
}
const ehCompetencia = (v) => /^\d{4}-\d{2}$|^\d{2}\/\d{4}$/.test(String(v ?? '').trim());
const fimDe = (v) => { const i = iso(v); if (!i || !ehCompetencia(v)) return i; const [y, mo] = i.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const somarDias = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const sobrepoe = (a1, a2, b1, b2) => a1 && a2 && b1 && b2 && a1 <= b2 && b1 <= a2;

const DIMENSOES = [
  [/tabelas|justificativa|transfer|data de liquidação/i, 'transferencia'],
  [/aritmética|soma das rubricas|avos|aviso prévio|quantidades de/i, 'aritmetica'],
  [/ocorrência|cobertura|especificação x|zerad/i, 'completude'],
];
/** Dimensão de uma verificação (as conferências do serviço não a informam: deduz pelo item). */
export const dimensaoDe = (v) => v.dimensao || (DIMENSOES.find(([re]) => re.test(v.item)) || [null, 'documentacao'])[1];
function registrar(out, item, estado, detalhe, dimensao = null) {
  out.push({ item, estado, detalhe, dimensao: dimensao || dimensaoDe({ item }) });
}

// ---------------------------------------------------------------------------
// 1. Antes de calcular
// ---------------------------------------------------------------------------

// PAGAMENTO: o documento só prova que pagou; PREVISAO_GOZO: aviso/programação sem prova do gozo;
// GOZO_DOCUMENTADO / EVENTO_DOCUMENTADO: gozo ou falta registrados em documento (recibo assinado, cartão, atestado);
// RECONHECIDO_NO_PROCESSO: fato admitido pelas partes ou fixado na decisão.
const NATUREZAS_EVENTO = ['PAGAMENTO', 'PREVISAO_GOZO', 'GOZO_DOCUMENTADO', 'EVENTO_DOCUMENTADO', 'RECONHECIDO_NO_PROCESSO'];

/**
 * Confere a especificação contra o contrato de dados. Sem contrato, a auditoria fica "não verificada"
 * (o cálculo pode ser feito, mas nunca chega a "auditado").
 */
export function auditarEspecificacao(spec) {
  const s = spec || {};
  const c = s.contrato;
  const verificacoes = [];
  const cen = s.cenario || null;
  const cenario = Boolean(cen);
  if (!c) {
    registrar(verificacoes, 'contrato de dados', s.exigirContrato ? 'falha' : 'nao_verificado', 'A especificação não tem "contrato": nenhum parâmetro está ligado à prova. O cálculo pode ser feito, mas não será auditado.');
    return resumoAuditoria(verificacoes, { cenario, temContrato: false, incertezasAbertas: [] });
  }
  const porId = (col) => new Map(lista(c[col]).map((x) => [x.id, x]));
  const docs = porId('documentos'); const decs = porId('decisoes'); const parcs = porId('parcelas');
  const afast = lista(c.afastamentos); const rems = porId('remuneracoes'); const pags = porId('pagamentos'); const prems = porId('premissas');
  const calc = s.calculo || {};
  const admissao = iso(calc.admissao); const demissao = iso(calc.demissao || calc.fim);

  // incertezas materiais abertas (premissas controvertidas/desconhecidas, parcelas pendentes, conflitos de
  // eventos): cada uma precisa estar variada no cenário ou declarada como mantida fixa
  const abertas = new Map(); // id -> descrição
  const abrir = (id, desc) => { if (id && !abertas.has(id)) abertas.set(id, desc); };

  // ids únicos e documentos citados
  const colecoes = ['documentos', 'decisoes', 'parcelas', 'afastamentos', 'remuneracoes', 'pagamentos', 'premissas'];
  const todosIds = colecoes.flatMap((k) => lista(c[k]).map((x) => x.id));
  const repetidos = todosIds.filter((x, i) => x && todosIds.indexOf(x) !== i);
  registrar(verificacoes, 'ids do contrato', repetidos.length || todosIds.some((x) => !x) ? 'falha' : 'ok', repetidos.length ? `ids repetidos: ${[...new Set(repetidos)].join(', ')}` : todosIds.some((x) => !x) ? 'há registro sem "id"' : `${todosIds.length} registros`);
  const exigirDocumento = (reg, tipoReg, obrigatorio) => {
    const ctx = `${tipoReg} ${reg.id}`;
    if (!reg.documento) { if (obrigatorio) registrar(verificacoes, ctx, 'falha', 'sem "documento": o vínculo probatório não pode ser conferido'); return; }
    if (!docs.has(reg.documento)) registrar(verificacoes, ctx, 'falha', `documento "${reg.documento}" não existe em contrato.documentos`);
  };
  for (const d of decs.values()) {
    exigirDocumento(d, 'decisão', true);
    if (!d.trecho && !d.folha) registrar(verificacoes, `decisão ${d.id}`, 'falha', 'sem trecho nem folha: a decisão não pode ser conferida');
    for (const a of lista(d.altera)) if (!decs.has(a)) registrar(verificacoes, `decisão ${d.id}`, 'falha', `"altera" cita a decisão "${a}", que não existe`);
  }
  for (const a of afast) exigirDocumento(a, 'afastamento', true);
  for (const r of rems.values()) exigirDocumento(r, 'remuneração', !r.componentes);
  for (const p of pags.values()) exigirDocumento(p, 'pagamento', !p.derivadoDe);
  // leituras alternativas das premissas (contrato.posicao); comando expresso e coisa julgada prevalecem
  const posicao = semAcento((s.contrato && s.contrato.posicao) || 'RECLAMANTE');
  if (s.contrato && s.contrato.posicao && !['RECLAMANTE', 'RECLAMADA', 'NEUTRA'].includes(posicao)) registrar(verificacoes, 'contrato.posicao', 'falha', `posição "${s.contrato.posicao}" inválida (RECLAMANTE, RECLAMADA ou NEUTRA)`);
  const premissasVistas = new Set();
  const conferirLeitura = (p, ctx) => {
    if (premissasVistas.has(p.id) || posicao === 'NEUTRA') return;
    premissasVistas.add(p.id);
    const alts = lista(p.alternativas); const crit = semAcento(p.criterio);
    if (crit && !['MAIS_FAVORAVEL', 'COMANDO_EXPRESSO', 'ESCOLHA_DO_USUARIO'].includes(crit)) registrar(verificacoes, `premissa ${p.id}`, 'falha', `criterio "${p.criterio}" inválido (MAIS_FAVORAVEL, COMANDO_EXPRESSO ou ESCOLHA_DO_USUARIO)`);
    const favs = alts.filter((x) => x.favoravel);
    if (!alts.length) return;
    if (alts.length && favs.length !== 1) { registrar(verificacoes, `premissa ${p.id}`, 'alerta', `${favs.length ? 'mais de uma' : 'nenhuma'} alternativa marcada "favoravel": marque a leitura mais favorável ao ${posicao.toLowerCase()}`); return; }
    if (semAcento(favs[0].texto) === semAcento(p.texto)) return;
    if (crit === 'MAIS_FAVORAVEL') registrar(verificacoes, `premissa ${p.id}`, 'falha', `criterio MAIS_FAVORAVEL, mas a leitura adotada ("${p.texto || ''}") não é a marcada "favoravel" ("${favs[0].texto}")`);
    else {
      registrar(verificacoes, `premissa ${p.id}`, 'alerta', `a leitura adotada não é a mais favorável ao ${posicao.toLowerCase()} ("${favs[0].texto}"${favs[0].efeito ? `: ${favs[0].efeito}` : ''})${crit === 'COMANDO_EXPRESSO' || crit === 'ESCOLHA_DO_USUARIO' ? ` — motivo registrado (${crit}): ${p.fundamento || 'sem fundamento'}` : ' — registre em "criterio" o comando expresso que a afasta ou a escolha do usuário'}`);
    }
  };
  for (const p of prems.values()) {
    exigirDocumento(p, 'premissa', false);
    if (!p.fundamento && !p.folha && !p.documento) registrar(verificacoes, `premissa ${p.id}`, 'alerta', 'classificação sem fundamento, folha ou documento: o status não pode ser só uma etiqueta');
    conferirLeitura(p, `premissa ${p.id}`);
  }
  const conferirPremissas = (ids, ctx, { abatimento = false } = {}) => {
    for (const id of lista(ids)) {
      const p = prems.get(id);
      if (!p) { registrar(verificacoes, ctx, 'falha', `premissa "${id}" não existe em contrato.premissas`); continue; }
      conferirLeitura(p, ctx);
      const st = semAcento(p.status);
      if (st === 'CONFIRMADA') continue;
      if (st !== 'CONTROVERTIDA' && st !== 'DESCONHECIDA') { registrar(verificacoes, ctx, 'falha', `premissa ${id} com status "${p.status}" (use CONFIRMADA, CONTROVERTIDA ou DESCONHECIDA)`); continue; }
      abrir(id, `premissa ${id} ${st} ("${p.texto || ''}") usada em ${ctx}`);
      if (!cenario && (st === 'DESCONHECIDA' || abatimento)) registrar(verificacoes, ctx, 'falha', `apoia-se na premissa ${id} ${st} ("${p.texto || ''}")${abatimento ? ' — abatimento' : ''} fora de um cenário declarado: resolva a premissa ou declare um "cenario"`);
      else registrar(verificacoes, ctx, 'alerta', `apoia-se na premissa ${id} ${st} ("${p.texto || ''}") — hipótese a declarar ao usuário${st === 'CONTROVERTIDA' && posicao !== 'NEUTRA' && !lista(p.alternativas).length ? `; registre em "alternativas" as leituras que o título admite, com o efeito de cada uma, e marque a mais favorável ao ${posicao.toLowerCase()}` : ''}`);
    }
  };

  // decisão vigente de uma parcela: a última que não foi alterada por outra
  const alteradas = new Set([...decs.values()].flatMap((d) => lista(d.altera)));
  for (const p of parcs.values()) {
    const ctx = `parcela ${p.id} (${p.rubrica || '?'})`;
    if (!p.decisao || !decs.has(p.decisao)) registrar(verificacoes, ctx, 'falha', 'sem decisão do processo que a sustente (contrato.decisoes)');
    else if (alteradas.has(p.decisao)) registrar(verificacoes, ctx, 'falha', `a decisão ${p.decisao} foi alterada por outra decisão do processo: aponte a decisão vigente`);
    if (!['DEFERIDA', 'INDEFERIDA', 'PENDENTE', 'REFORMADA'].includes(semAcento(p.situacao))) registrar(verificacoes, ctx, 'falha', `situação "${p.situacao}" inválida (DEFERIDA, INDEFERIDA, PENDENTE ou REFORMADA)`);
    if (semAcento(p.situacao) === 'PENDENTE') abrir(p.id, `parcela ${p.id} PENDENTE (${p.rubrica || '?'})`);
    conferirPremissas(p.premissas, ctx);
  }

  // verbas -> parcelas
  const usadas = new Set();
  const origemDaVerba = new Map(); // índice -> ids de parcela
  for (const [i, v] of lista(s.verbas).entries()) {
    const nome = v.nome || (v.personalizada && v.personalizada.nome) || v.verba;
    const ctx = `verbas[${i}] ${nome}`;
    const orig = lista(v.origem ?? (v.personalizada && v.personalizada.origem));
    origemDaVerba.set(i, orig);
    if (!orig.length) { registrar(verificacoes, ctx, 'falha', 'sem "origem": aponte a parcela do contrato (contrato.parcelas) que a defere'); continue; }
    for (const id of orig) {
      const p = parcs.get(id);
      if (!p) { registrar(verificacoes, ctx, 'falha', `origem "${id}" não existe em contrato.parcelas`); continue; }
      usadas.add(id);
      const sit = semAcento(p.situacao);
      if (sit === 'INDEFERIDA') registrar(verificacoes, ctx, 'falha', `a parcela ${id} foi INDEFERIDA e está sendo calculada`);
      else if (sit === 'PENDENTE') registrar(verificacoes, ctx, cenario ? 'alerta' : 'falha', `a parcela ${id} está PENDENTE${cenario ? ' (cenário declarado)' : ': só pode entrar num cenário declarado ("cenario")'}`);
      if (p.periodo && v.periodo) {
        const vi = iso(v.periodo.inicio); const vf = iso(v.periodo.fim); const pi = iso(p.periodo.inicio); const pf = iso(p.periodo.fim);
        if ((vi && pi && vi < pi) || (vf && pf && vf > pf)) registrar(verificacoes, ctx, 'falha', `período ${vi} a ${vf} sai do deferido na parcela ${id} (${pi} a ${pf})`);
      }
      const deferidos = lista(p.reflexos).map(semAcento);
      const pedidos = v.reflexos === 'todos' ? ['(todos)'] : lista(v.reflexos).map((r) => (typeof r === 'string' ? r : r.nome));
      for (const r of pedidos) {
        if (r === '(todos)') { registrar(verificacoes, ctx, deferidos.length ? 'alerta' : 'falha', `"reflexos": "todos" — liste os reflexos deferidos (${deferidos.length ? lista(p.reflexos).join(', ') : 'a parcela não lista reflexos deferidos'})`); continue; }
        const nr = semAcento(r); const curto = nr.replace(/\s+SOBRE\s+.*$/, '');
        if (!deferidos.some((d) => d === nr || d === curto || nr.startsWith(`${d} SOBRE`))) registrar(verificacoes, `${ctx} / reflexo ${r}`, 'falha', `reflexo não consta como deferido na parcela ${id} (deferidos: ${lista(p.reflexos).join(', ') || 'nenhum'})`);
      }
    }
  }
  for (const p of parcs.values()) {
    if (semAcento(p.situacao) === 'DEFERIDA' && !usadas.has(p.id) && !p.naoCalcular) registrar(verificacoes, `parcela ${p.id} (${p.rubrica || '?'})`, 'falha', 'parcela DEFERIDA sem verba no cálculo (se não deve ser calculada, informe "naoCalcular" com o motivo)');
  }

  // pagamentos: identidade, prova, saldo de cobertura (um recibo pode ser fracionado; o consumo somado,
  // inclusive por ids derivados, não pode passar do valor do pagamento original)
  const raiz = (pg, visto = new Set()) => { let x = pg; while (x && x.derivadoDe && pags.has(x.derivadoDe) && !visto.has(x.id)) { visto.add(x.id); x = pags.get(x.derivadoDe); } return x; };
  for (const pg of pags.values()) if (pg.derivadoDe && !pags.has(pg.derivadoDe)) registrar(verificacoes, `pagamento ${pg.id}`, 'falha', `"derivadoDe" cita o pagamento "${pg.derivadoDe}", que não existe`);
  const consumo = new Map(); // id raiz -> [{ ctx, valor }]
  const limiteInicio = admissao ? somarDias(admissao, -31) : null; const limiteFim = demissao ? somarDias(demissao, 400) : null;
  const usarPag = (ids, ctx, { valor, parcelasAbatidas = [], periodoAbatido = null, fgts = false }) => {
    const idsL = lista(ids);
    for (const id of idsL) {
      const pg = pags.get(id);
      if (!pg) { registrar(verificacoes, ctx, 'falha', `pagamento "${id}" não existe em contrato.pagamentos`); continue; }
      const r = raiz(pg) || pg;
      const pgCtx = `${ctx} (pagamento ${id})`;
      conferirPremissas([...lista(pg.premissas), ...(r !== pg ? lista(r.premissas) : [])], pgCtx, { abatimento: true });
      // emitente
      const reclamado = s.processo && s.processo.reclamado;
      const emit = r.emitente || pg.emitente;
      if (emit && reclamado && reclamado.nome && semAcento(emit) !== semAcento(reclamado.nome) && !(reclamado.cnpj && String(emit).replace(/\D/g, '') === String(reclamado.cnpj).replace(/\D/g, ''))) {
        // pagamento de terceiro aceito como do reclamado: precisa do motivo e da decisão (ou premissa) que o aceita
        const aceito = pg.emitenteAceito || r.emitenteAceito;
        const decAceite = aceito && aceito.decisao ? decs.get(aceito.decisao) : null;
        if (aceito && aceito.motivo && (decAceite || lista(aceito.premissas).length)) {
          if (aceito.decisao && !decAceite) registrar(verificacoes, pgCtx, 'falha', `"emitenteAceito.decisao" cita ${aceito.decisao}, que não existe em contrato.decisoes`);
          conferirPremissas(lista(aceito.premissas), `${pgCtx} / emitente aceito`, { abatimento: true });
          registrar(verificacoes, pgCtx, 'alerta', `emitido por "${emit}", não pelo reclamado, e aceito como pagamento dele: ${aceito.motivo}${aceito.decisao ? ` (${aceito.decisao}${aceito.folha ? `, ${aceito.folha}` : ''})` : ''}`);
        } else registrar(verificacoes, pgCtx, 'falha', `emitido por "${emit}", que não é o reclamado ("${reclamado.nome}")${aceito ? ': "emitenteAceito" precisa de "motivo" e da "decisao" (ou "premissas") que aceita o pagamento' : ' — se a decisão aceita o pagamento feito por terceiro (outra empresa do grupo, tomador), registre "emitenteAceito": { motivo, decisao }'}`);
      }
      // identidade: o pagamento declara as parcelas que cobre
      const cobre = lista(pg.parcelas ?? r.parcelas);
      if (!fgts) {
        if (!cobre.length) registrar(verificacoes, pgCtx, 'falha', 'identidade não declarada: informe em "parcelas" quais parcelas do contrato o pagamento cobre (título, competência, avos)');
        else if (parcelasAbatidas.length && !parcelasAbatidas.some((p) => cobre.includes(p))) registrar(verificacoes, pgCtx, 'falha', `o pagamento cobre ${cobre.join(', ')}, mas abate a verba da parcela ${parcelasAbatidas.join(', ')}: natureza incompatível`);
      }
      // alcance (período/competência coberto) e data do pagamento são coisas diferentes: o recibo da
      // rescisão é pago depois da demissão, mas cobre competências do contrato
      const per = pg.periodo || (pg.competencia ? null : r.periodo) || {};
      const comp = pg.competencia || (pg.periodo ? null : r.competencia);
      const ai = iso(per.inicio) || iso(comp); const af = fimDe(per.fim) || fimDe(comp) || ai;
      const dt = iso(pg.data || r.data);
      if (ai) {
        if ((admissao && af < admissao) || (demissao && ai > somarDias(demissao, 120))) registrar(verificacoes, pgCtx, 'falha', `alcance ${ai} a ${af} fora do contrato (${admissao} a ${demissao})`);
        else if (periodoAbatido && !sobrepoe(ai, af, periodoAbatido[0], periodoAbatido[1])) registrar(verificacoes, pgCtx, 'falha', `alcance ${ai} a ${af} não chega ao período da verba abatida (${periodoAbatido[0]} a ${periodoAbatido[1]})`);
      } else registrar(verificacoes, pgCtx, 'alerta', `competência ou período coberto não informado${dt ? ' (só a data do pagamento)' : ''}: identidade incompleta`);
      if (dt && limiteInicio && dt < limiteInicio) registrar(verificacoes, pgCtx, 'falha', `pago em ${dt}, antes do contrato (${admissao} a ${demissao})`);
      else if (dt && limiteFim && dt > limiteFim) registrar(verificacoes, pgCtx, 'alerta', `pago em ${dt}, mais de um ano depois da demissão (${demissao}): confirme que o pagamento é deste contrato`);
      else if (!dt) registrar(verificacoes, pgCtx, 'alerta', 'data do pagamento não localizada: pendência identificada (não preencha data fictícia)');
      if (!fgts && !pg.comando && !r.comando) registrar(verificacoes, pgCtx, 'alerta', 'sem "comando": aponte a decisão que autoriza a dedução');
      if (fgts) {
        const doc = docs.get(pg.documento || r.documento);
        if (doc && !/EXTRATO|GUIA|GFIP|SEFIP|GRF|FGTS/.test(semAcento(`${doc.tipo} ${doc.identificacao || ''}`))) registrar(verificacoes, pgCtx, 'alerta', `o documento ${doc.id} (${doc.tipo}) não é extrato/guia do FGTS: holerite com FGTS informado não prova depósito`);
      }
      const v = idsL.length === 1 ? valor : null;
      consumo.set(r.id, [...(consumo.get(r.id) || []), { ctx, valor: v }]);
      if (pg !== r) consumo.set(pg.id, [...(consumo.get(pg.id) || []), { ctx, valor: v }]);
    }
  };
  // alocações derivadas não criam dinheiro: somadas, não passam do original
  for (const orig of pags.values()) {
    const filhos = [...pags.values()].filter((x) => x.derivadoDe === orig.id);
    const soma = filhos.reduce((a, x) => a + Number(x.valor || 0), 0);
    if (filhos.length && orig.valor != null && soma > Number(orig.valor) + 0.005) registrar(verificacoes, `pagamento ${orig.id}`, 'falha', `alocações derivadas (${filhos.map((x) => `${x.id} ${x.valor}`).join(' + ')} = ${soma.toFixed(2)}) acima do valor do pagamento (${Number(orig.valor).toFixed(2)})`);
  }
  for (const [i, v] of lista(s.verbas).entries()) {
    const vp = v.valorPago;
    if (!vp || typeof vp !== 'object' || vp.tipo === 'CALCULADO') continue;
    const ctx = `verbas[${i}] ${v.nome || v.verba} / valor pago`;
    if (vp.valor != null && !lista(vp.origem).length) { registrar(verificacoes, ctx, 'falha', 'abatimento sem "origem" em contrato.pagamentos'); continue; }
    if (!vp.origem) continue;
    const per = v.periodo ? [iso(v.periodo.inicio || v.data), iso(v.periodo.fim || v.data)] : v.data ? [iso(v.data), iso(v.data)] : (admissao && demissao ? [admissao, demissao] : null);
    usarPag(vp.origem, ctx, { valor: vp.valor, parcelasAbatidas: origemDaVerba.get(i) || [], periodoAbatido: per });
  }
  // pago informado mês a mês (verbas[].ocorrencias e reflexos): o mesmo crivo do valor pago da verba
  for (const [i, v] of lista(s.verbas).entries()) {
    const grupos = [[v.ocorrencias || (v.personalizada && v.personalizada.ocorrencias), `verbas[${i}] ${v.nome || v.verba}`],
      ...lista(v.reflexos).filter((r) => r && typeof r === 'object' && r.ocorrencias).map((r) => [r.ocorrencias, `verbas[${i}] ${v.nome || v.verba} / reflexo ${r.nome}`])];
    for (const [eds, ctxV] of grupos) {
      for (const e of lista(eds)) {
        if (e.pago == null) continue;
        const ctx = `${ctxV} / pago em ${e.competencia || e.data || e.aquisitivo}`;
        if (!lista(e.origem).length) { if (s.contrato) registrar(verificacoes, ctx, 'alerta', 'valor pago no mês sem "origem" em contrato.pagamentos'); continue; }
        const ini = e.competencia ? `${String(e.competencia).slice(0, 7)}-01` : iso(e.data);
        const fim = e.competencia ? fimDe(String(e.competencia).slice(0, 7)) : iso(e.data);
        usarPag(e.origem, ctx, { valor: Number(e.pago), parcelasAbatidas: origemDaVerba.get(i) || [], periodoAbatido: ini ? [ini, fim || ini] : null });
      }
    }
  }
  for (const [i, op] of lista(s.fgts && s.fgts.operacoes).entries()) {
    if (!op.origem) registrar(verificacoes, `fgts.operacoes[${i}]`, 'falha', 'depósito/saque sem "origem" em contrato.pagamentos');
    else usarPag(op.origem, `fgts.operacoes[${i}]`, { valor: op.valor, fgts: true });
  }
  for (const [id, usos] of consumo) {
    const pg = pags.get(id);
    if (usos.length > 1 && usos.some((u) => u.valor == null)) registrar(verificacoes, `pagamento ${id}`, 'falha', `usado ${usos.length} vezes sem valor em cada uso: o saldo não pode ser conferido (${usos.map((u) => u.ctx).join(' | ')})`);
    else if (pg && pg.valor != null) {
      const total = usos.reduce((a, u) => a + Number(u.valor || 0), 0);
      if (total > Number(pg.valor) + 0.005) registrar(verificacoes, `pagamento ${id}`, 'falha', `consumo de ${total.toFixed(2)} acima da cobertura do pagamento (${Number(pg.valor).toFixed(2)}) em ${usos.length} uso(s): ${usos.map((u) => `${u.ctx} = ${u.valor}`).join(' | ')}`);
      else if (usos.every((u) => u.valor != null) && Math.abs(total - Number(pg.valor)) > 0.005) registrar(verificacoes, `pagamento ${id}`, 'alerta', `abatido ${total.toFixed(2)} de ${Number(pg.valor).toFixed(2)}: saldo de ${(Number(pg.valor) - total).toFixed(2)} sem alocação`);
    } else if (usos.length > 1) registrar(verificacoes, `pagamento ${id}`, 'falha', `usado ${usos.length} vezes sem valor do pagamento original para conferir o saldo`);
  }

  // remunerações: valores dentro da vigência; bases derivadas recalculadas dos componentes
  for (const r of rems.values()) {
    conferirPremissas(r.premissas, `remuneração ${r.id}`);
    if (!r.componentes) continue;
    const comps = lista(r.componentes).map((id) => rems.get(id));
    if (comps.some((x) => !x)) { registrar(verificacoes, `remuneração ${r.id}`, 'falha', `componentes inexistentes: ${lista(r.componentes).filter((id) => !rems.has(id)).join(', ')}`); continue; }
    const vigentes = comps.filter((x) => iso(x.de) <= iso(r.de) && (fimDe(x.ate) || '9999') >= (fimDe(r.ate) || iso(r.de)));
    if (vigentes.length !== comps.length) registrar(verificacoes, `remuneração ${r.id}`, 'falha', `componentes sem vigência em ${r.de} a ${r.ate}: ${comps.filter((x) => !vigentes.includes(x)).map((x) => x.id).join(', ')}`);
    else if (r.formula) registrar(verificacoes, `remuneração ${r.id}`, 'alerta', `base derivada por fórmula ("${r.formula}"): recalcule a partir dos componentes antes de usar — a cópia do valor não é conferência`);
    else {
      const soma = comps.reduce((a, x) => a + Number(x.valor || 0), 0);
      registrar(verificacoes, `remuneração ${r.id}`, Math.abs(soma - Number(r.valor)) < 0.011 ? 'ok' : 'falha', `componentes ${comps.map((x) => `${x.id} ${x.valor}`).join(' + ')} = ${soma.toFixed(2)}; valor informado ${r.valor}`);
    }
  }
  for (const [i, h] of lista(s.historicosSalariais).entries()) {
    const ctx = `historicosSalariais[${i}] ${h.nome}`;
    const orig = lista(h.origem);
    if (!orig.length) { registrar(verificacoes, ctx, 'falha', 'sem "origem" em contrato.remuneracoes'); continue; }
    const vig = orig.map((id) => rems.get(id)).filter(Boolean);
    for (const id of orig) if (!rems.has(id)) registrar(verificacoes, ctx, 'falha', `remuneração "${id}" não existe em contrato.remuneracoes`);
    const faixas = [...lista(h.valores).map((f) => ({ de: iso(f.de ?? f.competencia), ate: iso(f.ate ?? f.de ?? f.competencia), valor: f.valor })), ...lista(h.ocorrencias).map((o) => ({ de: iso(o.competencia), ate: iso(o.competencia), valor: o.valor }))];
    for (const f of faixas) {
      const cobre = vig.filter((r) => iso(r.de) <= f.de && f.ate <= (iso(r.ate) || '9999'));
      if (!cobre.length) registrar(verificacoes, ctx, 'falha', `valor ${f.valor} em ${f.de.slice(0, 7)} a ${f.ate.slice(0, 7)} fora da vigência das remunerações ${orig.join(', ')}`);
      else if (!cobre.some((r) => r.valor == null || Math.abs(Number(r.valor) - Number(f.valor)) < 0.005)) registrar(verificacoes, ctx, 'falha', `valor ${f.valor} em ${f.de.slice(0, 7)} difere da remuneração documentada (${cobre.map((r) => `${r.id}: ${r.valor}`).join(', ')})`);
    }
  }

  // eventos (férias, redução do aviso, afastamentos) x título: conteúdo documental, fato reconhecido e
  // efeito no cálculo são coisas diferentes; um evento que exclui trabalho precisa de base suficiente
  const apur = lista(s.apuracaoCartaoPonto);
  // férias efetivas: as de "ferias.periodos" e, nos demais períodos, as que a regra automática do gerador cria
  const periodosFerias = lista(s.ferias && s.ferias.periodos);
  let feriasAuto = [];
  if (!(s.ferias && s.ferias.gerar === false) && admissao && demissao) {
    try { feriasAuto = periodosDeFerias({ admissao, demissao, faltas: lista(s.faltas).map((f) => ({ inicio: iso(f.inicio), fim: iso(f.fim ?? f.inicio), justificada: Boolean(f.justificada) })), regime: (s.calculo && s.calculo.regime) || 'INTEGRAL' }); } catch { feriasAuto = []; }
  }
  const gozosEfetivos = [];
  for (const p of periodosFerias) {
    const auto = feriasAuto.find((x) => x.relativa === p.relativa);
    const gozos = p.gozos ?? (/^GOZADAS/.test(semAcento(p.situacao)) && auto ? auto.gozos : []);
    for (const g of lista(gozos)) gozosEfetivos.push({ relativa: p.relativa, origem: lista(p.origem), inicio: iso(g.inicio), fim: iso(g.fim), automatico: !p.gozos });
  }
  for (const p of feriasAuto.filter((x) => !periodosFerias.some((y) => y.relativa === x.relativa))) {
    for (const g of p.gozos) gozosEfetivos.push({ relativa: p.relativa, origem: [], inicio: g.inicio, fim: g.fim, automatico: true });
    if (!p.gozos.length) registrar(verificacoes, `férias ${p.relativa}`, 'alerta', `situação ${p.situacao} decidida pela regra automática: confirme em "ferias.periodos" com o documento`);
  }
  // efeito no cálculo: o declarado ou, se ausente, "sem trabalho" (exceto a redução do aviso)
  const efeitoDe = (a) => (a.efeito ? semAcento(a.efeito) : semAcento(a.tipo) === 'AVISO_REDUZIDO' ? 'REDUZ_AVISO' : 'EXCLUI_TRABALHO');
  const cadastroExclui = (a) => {
    const ai = iso(a.inicio); const af = iso(a.fim);
    return lista(s.faltas).some((f) => sobrepoe(iso(f.inicio), iso(f.fim ?? f.inicio), ai, af)) || gozosEfetivos.some((g) => sobrepoe(g.inicio, g.fim, ai, af));
  };
  const excluiTrabalho = (a) => efeitoDe(a) === 'EXCLUI_TRABALHO' || cadastroExclui(a);
  // faltas e gozos de férias tiram dias do cálculo: cada um precisa de evento em contrato.afastamentos
  for (const [i, f] of lista(s.faltas).entries()) {
    const fi = iso(f.inicio); const ff = iso(f.fim ?? f.inicio);
    const ctx = `faltas[${i}] ${fi} a ${ff}`;
    const orig = lista(f.origem);
    if (!orig.length) { registrar(verificacoes, ctx, 'falha', 'sem "origem" em contrato.afastamentos: a falta tira dias do cálculo e precisa de evento documentado'); continue; }
    for (const id of orig) {
      const a = afast.find((x) => x.id === id);
      if (!a) registrar(verificacoes, ctx, 'falha', `afastamento "${id}" não existe em contrato.afastamentos`);
      else if (!(iso(a.inicio) <= fi && ff <= iso(a.fim))) registrar(verificacoes, ctx, 'falha', `fora das datas do afastamento ${id} (${iso(a.inicio)} a ${iso(a.fim)})`);
    }
  }
  for (const g of gozosEfetivos) {
    const ctx = `férias ${g.relativa} gozo ${g.inicio} a ${g.fim}${g.automatico ? ' (regra automática)' : ''}`;
    for (const id of g.origem) if (!afast.some((a) => a.id === id)) registrar(verificacoes, ctx, 'falha', `afastamento "${id}" não existe em contrato.afastamentos`);
    const evento = afast.find((a) => g.origem.includes(a.id)) || afast.find((a) => semAcento(a.tipo) === 'FERIAS' && sobrepoe(iso(a.inicio), iso(a.fim), g.inicio, g.fim));
    if (!evento) registrar(verificacoes, ctx, g.automatico ? 'alerta' : 'falha', g.automatico ? 'gozo presumido (últimos dias do período concessivo), sem evento em contrato.afastamentos: confirme com o documento ou informe a situação em "ferias.periodos"' : 'gozo cadastrado sem evento em contrato.afastamentos (tipo FERIAS): o cadastro de férias não pode decidir sozinho que não houve trabalho');
    else if (iso(evento.inicio) !== g.inicio || iso(evento.fim) !== g.fim) registrar(verificacoes, ctx, 'alerta', `datas diferentes do evento ${evento.id} (${iso(evento.inicio)} a ${iso(evento.fim)})`);
  }
  for (const a of afast) {
    const ctx = `afastamento ${a.id} (${a.tipo || a.motivo || ''} ${iso(a.inicio)} a ${iso(a.fim)})`;
    const nat = semAcento(a.natureza);
    if (!NATUREZAS_EVENTO.includes(nat)) registrar(verificacoes, ctx, 'falha', `natureza "${a.natureza || ''}" não informada ou inválida (${NATUREZAS_EVENTO.join(', ')}): distinga pagamento, previsão de gozo, gozo/evento documentado e fato reconhecido no processo`);
    conferirPremissas(a.premissas, ctx);
    if (efeitoDe(a) !== 'EXCLUI_TRABALHO' && cadastroExclui(a)) registrar(verificacoes, ctx, 'falha', `efeito declarado "${a.efeito || efeitoDe(a)}", mas faltas ou férias cadastradas tiram esses dias do cálculo`);
    if (excluiTrabalho(a)) {
      if (nat === 'PAGAMENTO' || nat === 'PREVISAO_GOZO') registrar(verificacoes, ctx, cenario ? 'alerta' : 'falha', `o evento exclui trabalho do cálculo, mas a prova é só de ${nat === 'PAGAMENTO' ? 'pagamento' : 'previsão de gozo'}: confronte com o título${cenario ? ' (cenário declarado)' : ' ou declare um cenário'}`);
      if (nat !== 'RECONHECIDO_NO_PROCESSO' && !a.decisao && !lista(a.premissas).some((id) => semAcento((prems.get(id) || {}).status) === 'CONFIRMADA')) registrar(verificacoes, ctx, 'falha', 'exclui trabalho sem decisão do processo ("decisao") nem premissa CONFIRMADA que sustente o efeito');
      if (a.decisao && (!decs.has(a.decisao) || alteradas.has(a.decisao))) registrar(verificacoes, ctx, 'falha', `"decisao" ${a.decisao} inexistente ou alterada por outra decisão`);
    }
    for (const cf of lista(a.conflitos)) {
      const resolvido = a.resolucao && a.decisao;
      if (!resolvido) abrir(`${a.id}:${typeof cf === 'string' ? cf : cf.id || 'conflito'}`, `conflito do ${ctx} com ${typeof cf === 'string' ? cf : cf.descricao || cf.id}`);
      registrar(verificacoes, ctx, resolvido ? 'alerta' : cenario ? 'alerta' : 'falha', resolvido ? `conflito com ${typeof cf === 'string' ? cf : cf.id} resolvido por ${a.decisao}: "${a.resolucao}"` : `conflito material com ${typeof cf === 'string' ? cf : cf.descricao || cf.id} sem resolução fundamentada${cenario ? ' — precisa estar variado ou fixado no cenário' : ': resolva ("resolucao" + "decisao") ou declare um cenário com a alternativa'}`);
    }
    const ai = iso(a.inicio); const af = iso(a.fim);
    for (const [k, ap] of apur.entries()) {
      for (const j of lista(ap.jornadas)) {
        const d = iso(j.data);
        if (d && d >= ai && d <= af && lista(j.turnos).length && excluiTrabalho(a)) registrar(verificacoes, `apuracaoCartaoPonto[${k}] jornada ${d}`, 'falha', `trabalho lançado durante o ${ctx}, cadastrado como sem trabalho`);
      }
      if ((ap.programacao || ap.escala) && efeitoDe(a) === 'EXCLUI_TRABALHO' && sobrepoe(iso(ap.inicio), iso(ap.fim), ai, af)) {
        const coberto = lista(s.faltas).some((f) => iso(f.inicio) <= ai && iso(f.fim ?? f.inicio) >= af)
          || gozosEfetivos.some((g) => g.inicio <= ai && g.fim >= af);
        if (!coberto) registrar(verificacoes, `apuracaoCartaoPonto[${k}]`, 'falha', `a programação/escala gera jornadas durante o ${ctx}, que exclui trabalho mas não está cadastrado como falta ou férias`);
      }
    }
  }

  // horas extras sobre afastamentos e ciclo das escalas
  for (const a of afast) {
    const ai = iso(a.inicio); const af = iso(a.fim);
    for (const [i, v] of lista(s.verbas).entries()) {
      if (/HORAS? EXTRA|ADICIONAL NOTURNO|INTERVALO/.test(semAcento(v.verba || v.nome)) && v.periodo && sobrepoe(iso(v.periodo.inicio), iso(v.periodo.fim), ai, af) && excluiTrabalho(a)) {
        registrar(verificacoes, `verbas[${i}] ${v.nome || v.verba}`, 'alerta', `o período cobre o afastamento ${a.id} (${ai} a ${af}): confira se as ocorrências desse período ficam zeradas`);
      }
    }
  }
  const FOLGAS = { CINCO_POR_UM: [6, 1], SEIS_POR_UM: [7, 1], OITO_DOIS: [10, 2] };
  for (const [k, ap] of apur.entries()) {
    const e = ap.escala;
    if (!e || !FOLGAS[e.tipo] || !Array.isArray(e.ciclo)) continue;
    const folgas = e.ciclo.filter((d) => !lista(d).length).length;
    const [dias, esperado] = FOLGAS[e.tipo];
    registrar(verificacoes, `apuracaoCartaoPonto[${k}].escala`, folgas === esperado && e.ciclo.length === dias ? 'ok' : 'falha', `${e.tipo}: ${e.ciclo.length} dias e ${folgas} folga(s) no ciclo (esperado ${dias} dias e ${esperado} folga(s))`);
  }

  // mesma parcela repetida na base / dupla integração
  for (const [i, v] of lista(s.verbas).entries()) {
    const b = (v.personalizada && v.personalizada.base) || v.base;
    if (!b) continue;
    const nomes = [...lista(b.historicos), ...lista(b.verbas).map((x) => (typeof x === 'string' ? x : x.nome))].map(semAcento);
    const rep = nomes.filter((x, j) => nomes.indexOf(x) !== j);
    if (rep.length) registrar(verificacoes, `verbas[${i}] ${v.nome || v.verba} / base`, 'falha', `entra mais de uma vez na base: ${[...new Set(rep)].join(', ')}`);
    for (const nv of lista(b.verbas).map((x) => (typeof x === 'string' ? x : x.nome))) {
      const outra = lista(s.verbas).find((o) => semAcento(o.nome || o.verba) === semAcento(nv));
      const hb = outra && ((outra.personalizada && outra.personalizada.base) || outra.base);
      const comuns = hb ? lista(hb.historicos).map(semAcento).filter((h) => lista(b.historicos).map(semAcento).includes(h)) : [];
      if (comuns.length) registrar(verificacoes, `verbas[${i}] ${v.nome || v.verba} / base`, 'alerta', `a verba "${nv}" usada na base já é calculada sobre ${comuns.join(', ')}, que também está nesta base: confira dupla integração`);
    }
  }

  // documentação: os documentos que o caso exige existem e cobrem todo o período? O que foi pedido e não
  // chegou é incerteza aberta (só segue num cenário); o que nem foi pedido trava o cálculo.
  const docAv = avaliarDocumentacao(s);
  const exigirDoc = s.exigirDocumentacaoCompleta !== false;
  let falhasDoc = 0;
  const regDoc = (item, estado, detalhe) => { if (estado === 'falha') falhasDoc++; registrar(verificacoes, item, estado, detalhe); };
  if (!exigirDoc) registrar(verificacoes, 'documentação', 'alerta', 'conferência da documentação desligada ("exigirDocumentacaoCompleta": false): o cálculo não pode ser tratado como completo');
  else {
    for (const r of docAv.requisitos.filter((x) => x.obrigatorio)) {
      const ctx = `documentação ${r.id}`;
      if (r.status === 'ok') regDoc(ctx, 'ok', r.detalhe || r.documentos.join(', '));
      else if (r.status === 'inexistente_fundamentado') regDoc(ctx, 'alerta', `${r.descricao}: ${r.detalhe}`);
      else if (r.status === 'pendente') {
        abrir(`DOC:${r.id}`, `documento pendente — ${r.descricao} (${r.detalhe})`);
        regDoc(ctx, cenario ? 'alerta' : 'falha', `${r.descricao}: ${r.detalhe}${cenario ? ' — pendência declarada; precisa estar variada ou fixada no cenário' : ': sem o documento o cálculo só pode ser uma simulação declarada ("cenario")'}`);
      } else regDoc(ctx, 'falha', `${r.descricao}: ${r.detalhe} — peça ao usuário (calculo_documentos_necessarios) e registre o pedido em contrato.coleta`);
    }
  }
  for (const g of docAv.registros) regDoc(g.item, g.estado, g.detalhe);

  // mapa do processo (fase, processos ligados, devedores, execução) e título composto por capítulo, a
  // partir de todas as decisões; o que fica em aberto vira incerteza (só segue num cenário)
  const proc = avaliarProcesso(s, { cenario });
  const tit = comporTitulo(s, { cenario });
  for (const v of [...proc.verificacoes, ...tit.verificacoes]) verificacoes.push(v);
  for (const a of [...proc.abertas, ...tit.abertas]) abrir(a.id, a.descricao);
  // leitura integral: todas as folhas de todos os documentos classificadas, fechamentos, confrontos, pedidos
  for (const v of avaliarLeitura(c)) verificacoes.push(v);

  // cenário: cada incerteza aberta precisa estar variada ou declarada como mantida fixa
  if (cen) {
    const variadas = new Set([...lista(cen.hipoteses), ...lista(cen.premissasAlteradas)].map((x) => (typeof x === 'string' ? x : x.id)));
    const fixas = new Map(lista(cen.premissasFixas).map((x) => (typeof x === 'string' ? [x, null] : [x.id, x.motivo || null])));
    if (!cen.nome) registrar(verificacoes, 'cenário', 'falha', 'cenário sem "nome"');
    for (const [id, desc] of abertas) {
      const base = id.split(':')[0];
      if (variadas.has(id) || variadas.has(base)) continue;
      if (fixas.has(id) || fixas.has(base)) {
        const motivo = fixas.get(id) ?? fixas.get(base);
        registrar(verificacoes, `cenário / ${id}`, motivo ? 'alerta' : 'falha', motivo ? `incerteza mantida fixa (${motivo}): o efeito dela não está medido neste cenário — ${desc}` : `incerteza mantida fixa sem "motivo": ${desc}`);
      } else registrar(verificacoes, `cenário / ${id}`, 'falha', `incerteza material não coberta pelo cenário — declare em "premissasAlteradas" (variada) ou "premissasFixas" (mantida, com motivo): ${desc}`);
    }
  }

  if (c.dataLiquidacao && !iso(c.dataLiquidacao)) registrar(verificacoes, 'contrato.dataLiquidacao', 'falha', `data inválida "${c.dataLiquidacao}"`);
  if (c.referencia) {
    const r = c.referencia;
    if (!r.dataBase || iso(r.dataBase) !== iso(c.dataLiquidacao)) registrar(verificacoes, 'conta de referência', 'falha', `a referência (${r.arquivo || '?'}) tem data-base ${r.dataBase || '?'} diferente da liquidação (${c.dataLiquidacao || '?'}): compare na mesma data`);
    if (!r.arquivo && !r.identificacao) registrar(verificacoes, 'conta de referência', 'falha', 'identifique a conta exata comparada (arquivo/hash ou identificação)');
  }
  const documentacao = { ...docAv, exigida: exigirDoc, bloqueia: falhasDoc > 0, pedido: textoPedido(docAv) };
  return resumoAuditoria(verificacoes, {
    cenario, temContrato: true, dataLiquidacao: iso(c.dataLiquidacao), incertezasAbertas: [...abertas.values()], revisoesDeAlerta: lista(c.revisoesDeAlerta),
    zerosJustificados: lista(c.zerosJustificados), documentacao, processo: proc.mapa, titulo: tit.capitulos, provisorio: proc.provisorio || tit.provisorio,
    aprovacao: verificarAprovacao(s),
  });
}

function resumoAuditoria(verificacoes, extra) {
  for (const v of verificacoes) if (!['processo', 'titulo', 'leitura'].includes(v.dimensao)) v.dimensao = 'documentacao';
  const falhas = verificacoes.filter((v) => v.estado === 'falha');
  const alertas = verificacoes.filter((v) => v.estado === 'alerta');
  const naoVerificados = verificacoes.filter((v) => v.estado === 'nao_verificado');
  return {
    ...extra,
    aprovada: extra.temContrato && falhas.length === 0,
    falhas: falhas.length, alertas: alertas.length, naoVerificados: naoVerificados.length,
    verificacoes,
  };
}

// ---------------------------------------------------------------------------
// 2. Depois de liquidar: conferência numérica independente (sobre o .PJC exportado do PJe-Calc)
// ---------------------------------------------------------------------------

const n = (x) => (x == null ? null : Number(x));
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const msIso = (ms) => (ms == null ? null : new Date(Number(ms) - 3 * 3600e3).toISOString().slice(0, 10));

export function verbasAtivas(arvore) {
  const vistas = new Set(); const out = [];
  for (const o of objetos(arvore)) {
    if (!['Calculada', 'Informada', 'Reflexo'].includes(o.$classe)) continue;
    const k = `${o.$classe}#${campo(o, 'id')}`;
    if (vistas.has(k) || campo(o, 'ativo') !== 'true') continue;
    vistas.add(k);
    out.push(o);
  }
  return out;
}

/** Meses com 15 dias ou mais trabalhados no ano, entre admissão e fim (avos de 13º). */
function avos13(admissao, fim, ano) {
  let avos = 0;
  for (let m = 1; m <= 12; m++) {
    const ini = new Date(Date.UTC(ano, m - 1, 1)); const ult = new Date(Date.UTC(ano, m, 0));
    const a = new Date(`${admissao}T00:00:00Z`); const f = new Date(`${fim}T00:00:00Z`);
    const de = a > ini ? a : ini; const ate = f < ult ? f : ult;
    if (ate >= de && Math.round((ate - de) / 86400000) + 1 >= 15) avos++;
  }
  return avos;
}

/** Identifica uma ocorrência: data inicial e, se houver, início do período aquisitivo. */
export function chaveOcorrencia(x) {
  const aq = campo(x, 'dataInicialPeriodoAquisitivo');
  return `${msIso(campo(x, 'dataInicial'))}${aq != null && typeof aq !== 'object' ? ` (aquisitivo ${msIso(aq)})` : ''}`;
}

const justificado = (nome, zeros) => lista(zeros).find((z) => semAcento(z.verba) === semAcento(nome) && z.motivo);

/**
 * Confere o que o PJe-Calc calculou, por conta própria:
 *  - aritmética de cada ocorrência calculada: devido = base ÷ divisor × multiplicador × quantidade (× 2 na dobra)
 *  - completude: verba ativa sem ocorrências, competência faltante ou ocorrência duplicada = falha (salvo
 *    zero justificado em contrato.zerosJustificados); verba toda zerada = alerta
 *  - avos de 13º por ano, dias de aviso prévio (Lei 12.506/2011), quantidades do cartão
 * Começa pelas quantidades e valores nominais, para que juros e correção não escondam erros.
 */
export function conferenciaIndependente(arvore, { cartao = null, tolerancia = 0.011, zerosJustificados = [] } = {}) {
  const verif = [];
  const admissao = msIso(campo(arvore, 'dataAdmissao'));
  const demissao = msIso(campo(arvore, 'dataDemissao'));
  const apurAviso = campo(arvore, 'apuracaoPrazoDoAvisoPrevio');
  const projeta = campo(arvore, 'projetaAvisoIndenizado') === 'true';
  let diasAviso = null;
  if (admissao && demissao && apurAviso === 'APURACAO_CALCULADA') {
    const a = new Date(`${admissao}T00:00:00Z`); const d = new Date(`${demissao}T00:00:00Z`);
    let anos = d.getUTCFullYear() - a.getUTCFullYear();
    if (d.getUTCMonth() < a.getUTCMonth() || (d.getUTCMonth() === a.getUTCMonth() && d.getUTCDate() < a.getUTCDate())) anos--;
    diasAviso = Math.min(90, 30 + 3 * Math.max(0, anos));
  }
  const fimProjetado = demissao && projeta && diasAviso ? somarDias(demissao, diasAviso) : demissao;
  let aritOk = 0; const aritFalhas = [];
  let completas = 0;
  const colunasCartao = cartao && cartao.linhas ? new Map(cartao.linhas.map((l) => [l.competencia, l.valores])) : null;
  for (const v of verbasAtivas(arvore)) {
    const nome = String(campo(v, 'nome')).trim();
    const todas = itens(campo(v, 'ocorrencias')).filter((x) => x.$classe);
    const oc = todas.filter((x) => campo(x, 'ativo') === 'true');
    const zj = justificado(nome, zerosJustificados);
    if (!oc.length) {
      registrar(verif, `ocorrências de ${nome}`, zj ? 'alerta' : 'falha', zj ? `sem ocorrências ativas — zero justificado: ${zj.motivo}` : 'verba ativa sem ocorrências ativas: o nome no cálculo não significa que ela foi calculada (justifique em contrato.zerosJustificados se o zero for correto)', 'completude');
      continue;
    }
    // duplicadas: duas ocorrências ativas na mesma data e no mesmo período aquisitivo (férias vencidas e
    // proporcionais pagas na rescisão têm a mesma data, mas períodos aquisitivos diferentes)
    const chaves = oc.map((x) => chaveOcorrencia(x));
    const dup = chaves.filter((d, i) => chaves.indexOf(d) !== i);
    if (dup.length) registrar(verif, `ocorrências de ${nome}`, 'falha', `ocorrência(s) duplicada(s) em ${[...new Set(dup)].join(', ')}`, 'completude');
    const somaDevido = oc.reduce((a, x) => a + (n(campo(x, 'devido')) || 0), 0);
    // pago maior que o devido num mês: sem "zerar negativo" (na verba ou no cálculo), a diferença negativa abate os
    // outros meses (dedução global, como na OJ 415 da SBDI-1 do TST). É uma escolha de interpretação: avise.
    const zera = campo(v, 'zeraValorNegativo') === 'true' || campo(arvore, 'zeraValorNegativo') === 'true';
    const negativos = oc.filter((x) => (n(campo(x, 'pago')) || 0) - (n(campo(x, 'devido')) || 0) > 0.005);
    if (negativos.length && !zera && oc.length > 1) {
      const total = negativos.reduce((a, x) => a + (n(campo(x, 'pago')) - n(campo(x, 'devido'))), 0);
      registrar(verif, `pago maior que o devido (${nome})`, 'alerta', `${negativos.map((x) => msIso(campo(x, 'dataInicial')).slice(0, 7)).join(', ')}: R$ ${total.toFixed(2)} pagos a mais abatem os demais meses (dedução global, OJ 415 da SBDI-1). Se o título manda deduzir mês a mês, marque "zerarNegativo": true na verba.`, 'completude');
    }
    if (Math.abs(somaDevido) < 0.005 && !zj) registrar(verif, `ocorrências de ${nome}`, 'alerta', 'todas as ocorrências ativas com devido zero: confirme a causa (base, quantidade ou período) ou justifique o zero', 'completude');
    else completas++;
    for (const x of oc) {
      if (campo(x, 'valor') !== 'CALCULADO') continue;
      const base = n(campo(x, 'base')); const div = n(campo(x, 'divisor')); const mult = n(campo(x, 'multiplicador')); const q = n(campo(x, 'quantidade')); const dev = n(campo(x, 'devido'));
      if ([base, div, mult, q, dev].some((y) => y == null || Number.isNaN(y)) || div === 0) continue;
      const esperado = r2((base / div) * mult * q * (campo(x, 'dobra') === 'true' ? 2 : 1));
      if (Math.abs(esperado - dev) <= tolerancia) aritOk++;
      else aritFalhas.push(`${nome} ${msIso(campo(x, 'dataInicial'))}: ${base} ÷ ${div} × ${mult} × ${q} = ${esperado}, PJe-Calc ${dev}`);
    }
    const carac = campo(v, 'caracteristica');
    if (carac === 'DECIMO_TERCEIRO_SALARIO' && v.$classe !== 'Reflexo' && admissao && fimProjetado) {
      // avos deferidos pelo título (quantidade INFORMADA): o número vem da decisão, não do contrato
      const qForm = campo(campo(v, 'formula'), 'quantidade');
      const informados = qForm && campo(qForm, 'tipo') === 'INFORMADA' ? n(campo(qForm, 'valorInformado')) : null;
      // a conta independente usa o período da própria verba (verbas do período sem registro, por exemplo)
      const iniV = msIso(campo(v, 'periodoInicial')); const fimV = msIso(campo(v, 'periodoFinal'));
      const deAvos = iniV && iniV > admissao ? iniV : admissao;
      // a projeção do aviso só vale quando a verba vai até a demissão
      const ateAvos = fimV && demissao && fimV < demissao ? fimV : fimProjetado;
      for (const x of oc) {
        const ano = Number(String(msIso(campo(x, 'dataInicial'))).slice(0, 4));
        if (informados != null) {
          const q = n(campo(x, 'quantidade'));
          registrar(verif, `avos de 13º ${ano} (${nome})`, q === informados ? 'ok' : 'alerta', `PJe-Calc ${q}, avos informados na especificação ${informados} (deferidos pelo título)`, 'aritmetica');
          continue;
        }
        const esperado = avos13(deAvos, ateAvos, ano);
        const q = n(campo(x, 'quantidade'));
        registrar(verif, `avos de 13º ${ano} (${nome})`, q === esperado ? 'ok' : 'alerta', `PJe-Calc ${q}, conta independente ${esperado} (meses com 15+ dias de ${deAvos} a ${ateAvos})${q === esperado ? '' : ' — confira faltas, limitação de avos, avos deferidos e a projeção do aviso'}`, 'aritmetica');
      }
    }
    if (carac === 'AVISO_PREVIO' && v.$classe !== 'Reflexo' && diasAviso != null) {
      const q = n(campo(oc[0], 'quantidade'));
      registrar(verif, `dias de aviso prévio (${nome})`, q === diasAviso ? 'ok' : 'alerta', `PJe-Calc ${q}, Lei 12.506/2011: ${diasAviso}`, 'aritmetica');
    }
    const vincQtd = itens(campo(v, 'cartoesDePontoDaVerbaQuantidade'));
    if (colunasCartao && vincQtd.length) {
      const nomeCol = (() => { const ref = campo(vincQtd[0], 'cartaoDePonto'); const alvo = ref && [...objetos(arvore)].find((o) => o.$classe === 'CartaoDePonto' && campo(o, 'id') === ref.id && campo(o, 'nome')); return alvo ? campo(alvo, 'nome') : null; })();
      if (nomeCol) {
        let ok = 0; const dif = [];
        for (const x of oc) {
          const comp = msIso(campo(x, 'dataInicial')).slice(0, 7).split('-').reverse().join('/');
          const linha = colunasCartao.get(comp);
          if (!linha || linha[nomeCol] == null) continue;
          if (Math.abs(n(campo(x, 'quantidade')) - linha[nomeCol]) <= 0.005) ok++; else dif.push(`${comp}: ocorrência ${campo(x, 'quantidade')}, cartão ${linha[nomeCol]}`);
        }
        registrar(verif, `quantidades de ${nome} = coluna "${nomeCol}"`, dif.length ? 'falha' : ok ? 'ok' : 'nao_verificado', dif.length ? dif.slice(0, 5).join('; ') : `${ok} competência(s) iguais ao cartão apurado`, 'aritmetica');
      }
    }
    if (campo(v, 'ocorrenciaDePagamento') === 'MENSAL' && v.$classe !== 'Reflexo') {
      const pi = msIso(campo(v, 'periodoInicial')); const pf = msIso(campo(v, 'periodoFinal'));
      const meses = pi && pf ? (Number(pf.slice(0, 4)) - Number(pi.slice(0, 4))) * 12 + Number(pf.slice(5, 7)) - Number(pi.slice(5, 7)) + 1 : null;
      if (meses != null) {
        const comps = new Set(todas.map((x) => String(msIso(campo(x, 'dataInicial'))).slice(0, 7)));
        const faltando = [];
        for (let k = 0; k < meses; k++) { const d = new Date(Date.UTC(Number(pi.slice(0, 4)), Number(pi.slice(5, 7)) - 1 + k, 1)).toISOString().slice(0, 7); if (!comps.has(d)) faltando.push(d); }
        registrar(verif, `cobertura do período de ${nome}`, faltando.length ? (zj ? 'alerta' : 'falha') : 'ok', faltando.length ? `competência(s) sem ocorrência: ${faltando.slice(0, 12).join(', ')}${faltando.length > 12 ? '...' : ''} (${todas.length} ocorrências para ${meses} meses)` : `${todas.length} ocorrência(s) para ${meses} mês(es) de ${pi} a ${pf}`, 'completude');
      }
    }
  }
  verif.unshift({ item: 'aritmética das ocorrências (base ÷ divisor × multiplicador × quantidade)', estado: aritFalhas.length ? 'falha' : aritOk ? 'ok' : 'nao_verificado', detalhe: aritFalhas.length ? aritFalhas.slice(0, 8).join('; ') : `${aritOk} ocorrência(s) conferidas`, dimensao: 'aritmetica' });
  return verif;
}

/** Verbas pedidas na especificação x verbas ativas no arquivo final x linhas do relatório. */
export function compararEspecificacaoResultado({ verbasEspecificacao = [], arvore = null, resultado = null, zerosJustificados = [] }) {
  const verif = [];
  const pedidas = new Set(verbasEspecificacao.map((x) => semAcento(String(x).replace(/\s*\(reflexo\)\s*$/, ''))));
  if (arvore) {
    const ativas = verbasAtivas(arvore);
    const noArquivo = new Set(ativas.map((v) => semAcento(campo(v, 'nome'))));
    const faltam = [...pedidas].filter((x) => !noArquivo.has(x));
    const sobram = [...noArquivo].filter((x) => !pedidas.has(x));
    registrar(verif, 'especificação x ocorrências finais (nomes)', faltam.length || sobram.length ? 'falha' : 'ok', faltam.length || sobram.length ? `faltam no PJe-Calc: ${faltam.join(', ') || '-'}; a mais no PJe-Calc: ${sobram.join(', ') || '-'}` : `${pedidas.size} verbas ativas iguais`, 'completude');
    // presença do nome não basta: cada verba pedida precisa ter ocorrências ativas
    const semOcorrencia = ativas.filter((v) => pedidas.has(semAcento(campo(v, 'nome'))) && !itens(campo(v, 'ocorrencias')).some((x) => x.$classe && campo(x, 'ativo') === 'true') && !justificado(campo(v, 'nome'), zerosJustificados));
    registrar(verif, 'especificação x ocorrências finais (ocorrências)', semOcorrencia.length ? 'falha' : 'ok', semOcorrencia.length ? `pedidas e ativas, mas sem ocorrências: ${semOcorrencia.map((v) => String(campo(v, 'nome')).trim()).join(', ')}` : 'todas as verbas pedidas têm ocorrências ativas', 'completude');
  } else registrar(verif, 'especificação x ocorrências finais', 'nao_verificado', 'arquivo final não disponível', 'completude');
  if (resultado && resultado.verbas) {
    const noRelatorio = new Map(resultado.verbas.map((x) => [semAcento(x.descricao), x]));
    // verbas que não compõem o principal ficam fora do quadro "Bruto Devido ao Reclamante" do Resumo
    const fora = new Set(arvore ? verbasAtivas(arvore).filter((v) => campo(v, 'comporPrincipal') === 'NAO').map((v) => semAcento(campo(v, 'nome'))) : []);
    const faltam = [...pedidas].filter((x) => !noRelatorio.has(x) && !fora.has(x));
    const noQuadro = [...pedidas].filter((x) => !fora.has(x)).length;
    registrar(verif, 'especificação x relatório', faltam.length ? 'falha' : 'ok', faltam.length ? `não aparecem no relatório: ${faltam.join(', ')}` : `${noQuadro} verbas no relatório${fora.size ? ` (${fora.size} fora do principal, conferidas pelo arquivo)` : ''}`, 'completude');
    const zeradas = [...pedidas].filter((x) => noRelatorio.has(x) && Math.abs(noRelatorio.get(x).total || 0) < 0.005 && !justificado(x, zerosJustificados));
    if (zeradas.length) registrar(verif, 'verbas zeradas no relatório', 'alerta', `total zero: ${zeradas.join(', ')} — confirme a causa de cada uma (ou justifique em contrato.zerosJustificados)`, 'completude');
  } else registrar(verif, 'especificação x relatório', 'nao_verificado', 'sem liquidação', 'completude');
  return verif;
}

// ---------------------------------------------------------------------------
// 3. Estado consolidado
// ---------------------------------------------------------------------------

/** Alertas sem revisão registrada em contrato.revisoesDeAlerta ({ item, conclusao, fundamento, responsavel }). */
export function alertasSemRevisao(verificacoes, revisoes = []) {
  const validas = lista(revisoes).filter((r) => r && r.item && r.conclusao && r.fundamento);
  return verificacoes.filter((v) => v.estado === 'alerta' && !validas.some((r) => semAcento(`${v.item} ${v.detalhe}`).includes(semAcento(r.item))));
}

/**
 * rascunho -> aceito_pelo_aplicativo (importado, sem pendências impeditivas) -> calculado (liquidado com
 * tabelas, justificativa, conferências, completude e comparação verificadas) -> auditado (calculado + contrato
 * sem falhas, sem incertezas abertas e com todos os alertas revisados) ou simulacao (o mesmo, mas com
 * cenário/incertezas abertas: não pode ser apresentado como conclusão definitiva). "Revisado para entrega"
 * nunca é declarado pelo MCP: a revisão interpretativa é humana.
 */
export function consolidarEstado({ importado = false, pendenciasErros = null, liquidado = false, verificacoes = [], auditoria = null }) {
  const bloqueios = [];
  let estado = 'rascunho';
  if (importado && pendenciasErros === 0) estado = 'aceito_pelo_aplicativo';
  else if (importado) bloqueios.push(`${pendenciasErros} pendência(s) do PJe-Calc impedem a liquidação`);
  const problemas = verificacoes.filter((v) => v.estado === 'falha' || v.estado === 'nao_verificado');
  if (estado === 'aceito_pelo_aplicativo' && liquidado) {
    if (problemas.length) bloqueios.push(...problemas.map((v) => `${v.item}: ${v.estado === 'nao_verificado' ? 'NÃO VERIFICADO' : 'FALHA'} — ${v.detalhe}`));
    else estado = 'calculado';
  } else if (estado === 'aceito_pelo_aplicativo') bloqueios.push('não liquidado: os números ainda não foram conferidos');
  const todas = [...verificacoes, ...((auditoria && auditoria.verificacoes) || [])];
  const semRevisao = auditoria && auditoria.temContrato ? alertasSemRevisao(todas, auditoria.revisoesDeAlerta) : [];
  if (estado === 'calculado') {
    if (!auditoria || !auditoria.temContrato) bloqueios.push('sem contrato de dados: os parâmetros não estão ligados à prova (não auditado)');
    else if (!auditoria.aprovada) bloqueios.push(...auditoria.verificacoes.filter((v) => v.estado === 'falha').map((v) => `${v.item}: ${v.detalhe}`));
    else if (semRevisao.length) bloqueios.push(`${semRevisao.length} alerta(s) sem revisão registrada em contrato.revisoesDeAlerta (conclusão + fundamento): ${semRevisao.slice(0, 5).map((v) => v.item).join('; ')}${semRevisao.length > 5 ? '...' : ''}`);
    else if (!auditoria.aprovacao || !auditoria.aprovacao.valida) bloqueios.push(`plano de interpretação: ${auditoria.aprovacao ? auditoria.aprovacao.motivo : 'não aprovado'}`);
    else if (auditoria.cenario || (auditoria.incertezasAbertas || []).length) {
      estado = 'simulacao';
      bloqueios.push(`simulação: ${auditoria.cenario ? 'cenário declarado' : 'incertezas abertas'} — ${(auditoria.incertezasAbertas || []).slice(0, 5).join('; ') || 'veja o cenário'}. Não apresente como conclusão definitiva.`);
    } else estado = 'auditado';
  }
  const dim = (nome) => {
    const vs = todas.filter((v) => dimensaoDe(v) === nome);
    if (!vs.length) return 'nao_verificado';
    if (vs.some((v) => v.estado === 'falha')) return 'falha';
    if (vs.some((v) => v.estado === 'nao_verificado')) return 'nao_verificado';
    return vs.some((v) => v.estado === 'alerta') ? 'ok_com_alertas' : 'ok';
  };
  const comContrato = Boolean(auditoria && auditoria.temContrato);
  const provisorio = Boolean(auditoria && auditoria.provisorio);
  return {
    estado,
    cenario: Boolean(auditoria && auditoria.cenario),
    provisorio,
    bloqueiosDeEntrega: bloqueios,
    dimensoes: {
      processo: comContrato ? dim('processo') : 'nao_verificado',
      titulo: comContrato ? dim('titulo') : 'nao_verificado',
      leitura: comContrato ? dim('leitura') : 'nao_verificado',
      documentacao: comContrato ? dim('documentacao') : 'nao_verificado',
      aprovacao: !comContrato ? 'nao_verificado' : auditoria.aprovacao && auditoria.aprovacao.valida ? 'ok' : 'pendente',
      transferencia: !importado ? 'nao_verificado' : pendenciasErros === 0 ? dim('transferencia').replace('nao_verificado', 'ok') : 'falha',
      aritmetica: liquidado ? dim('aritmetica') : 'nao_verificado',
      completude: liquidado ? dim('completude') : 'nao_verificado',
      revisaoInterpretativa: 'pendente — humana (leitura dos trechos citados)',
    },
    ...(provisorio ? { aviso: 'PROVISÓRIO: há capítulos sem trânsito em julgado (decisão ainda recorrível ou execução provisória); refaça o cálculo se as decisões pendentes mudarem.' } : {}),
    alertasSemRevisao: semRevisao.length,
    significado: {
      rascunho: 'especificação gerada; nada foi aceito nem calculado pelo PJe-Calc',
      aceito_pelo_aplicativo: 'o PJe-Calc importou e não aponta pendências impeditivas — aceitação técnica, não revisão',
      calculado: 'liquidado com tabelas, justificativa, aritmética e completude verificadas — falta a auditoria da prova',
      simulacao: 'calculado, auditado e com o plano aprovado, mas com cenário ou incertezas abertas — é uma simulação condicionada, não conclusão definitiva',
      auditado: 'calculado, com o mapa do processo, o título composto por capítulo e todos os parâmetros ligados a decisões e documentos, sem falhas, sem incertezas abertas, com os alertas revisados e o plano de interpretação aprovado pelo usuário — ainda exige a leitura humana dos trechos citados antes da entrega',
    }[estado],
    revisadoParaEntrega: false,
  };
}
