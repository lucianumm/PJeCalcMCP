// pjecalc-mcp-skill · lib/execucao.mjs
// Fase de execução: pagamentos (depósitos, alvarás, bloqueios convertidos) e eventos da atualização (honorários,
// multas, pensão alimentícia e custas da execução) gravados no .PJC de um cálculo LIQUIDADO; o PJe-Calc faz o
// rateio e a imputação na "Liquidar Atualização". As regras das telas de pagamento do aplicativo são conferidas
// aqui antes de importar (a importação não as aplica).
//
// Especificação ("execucao"):
// {
//   "dataAtualizacao": "AAAA-MM-DD",            // data até a qual o saldo é atualizado
//   "identificacao": "fl. 350", "comentarios": "...", "cobrarEncargosIrpf": false,
//   "precatorio": { "tipo": "RPV"|"PRECATORIO", "esfera": "FEDERAL"|"ESTADUAL_MUNICIPAL", "periodoGraca": { "inicio", "fim" }, "ec136APartirDe": "AAAA-MM-DD" },
//   "pagamentos": [{
//     "data": "AAAA-MM-DD", "valor": 10000, "folha": "fl. 300", "origem": "...", "priorizarJuros": false, "precatorio": false,
//     "creditoReclamante": 10000,                 // padrão: valor − outrosDebitosReclamado − debitosCobrarReclamante
//     "credito": { "principal": "apurar"|valor, "fgts": ..., "multasReclamante": ..., "multasReclamado": "apurar" },
//     "recolher": { "custas", "depositoFgts", "contribuicaoSocial", "previdenciaPrivada", "pensao", "imposto": "apurar"|valor,
//                   "multas": [{ "descricao", "valor"|"apurar": true }], "honorarios": [{ "credor"|"descricao", "valor"|"apurar": true }] },
//     "outrosDebitosReclamado": 0,
//     "outros": { "custas", "inssSalariosDevidos", "inssSalariosPagos", "jurosPrevidenciaPrivada", "impostoRenda", "inss10", "inss05", "multas", "honorarios" },
//     "debitosCobrarReclamante": null,
//     "cobrar": { "custas", "multas", "honorarios" }
//   }],
//   "honorarios": [ ...como honorarios do cálculo, mais "dataEvento" e "folha" ],
//   "multas":     [ ...como multas do cálculo, mais "dataEvento" e "folha" ],
//   "pensao": { "dataEvento", "aliquota", "incidirSobreJuros", "folha", "verbas": "todas"|[nomes], "fgts", "multaFgts",
//               "principalTributavel", "principalNaoTributavel" },   // os dois últimos só no Cálculo Externo
//   "custas": { "folha", "fixas": [{ "vencimento", "atosUrbanos", ..., "recursoRevista" }],
//               "autos": [{ "tipo", "vencimento", "valor" }], "armazenamentos": [{ "inicio", "fim", "valor" }] }
// }

import { campo, itens, definir, objetos, dataMs } from './pjc.mjs';
import { dec, construirHonorario, construirMulta, ErroEspecificacao, CUSTAS_FIXAS } from './gerador.mjs';
import { carregarModelo } from './modelos.mjs';
import { conferirEsquema, ESQUEMA_EXECUCAO } from './esquema.mjs';

const c = (o, k) => (o ? campo(o, k) : null);
const it = (o, k) => (o ? itens(campo(o, k)).filter((x) => x && x.$classe) : []);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const erro = (msg) => { throw new ErroEspecificacao(msg); };
const fmt = (msv) => { if (msv == null) return '?'; const d = new Date(Number(msv) - 3 * 3600e3); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
function dataIso(v, ctx) {
  if (v == null || v === '') erro(`${ctx}: data obrigatória (AAAA-MM-DD).`);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  erro(`${ctx}: data inválida "${v}" (use AAAA-MM-DD).`);
}

/** Ids novos que não colidem com os do cálculo exportado. */
class Ids {
  constructor(raiz) {
    let max = 0;
    for (const o of objetos(raiz)) { const v = Number(c(o, 'id')); if (Number.isFinite(v) && v > max) max = v; }
    this.prox = max + 1000;
  }
  id() { return String(this.prox++); }
}

/** Objeto com todos os campos persistidos da entidade (padrões do aplicativo: Boolean false, coleções vazias). */
function novoObjeto(classe, valores) {
  const ent = carregarModelo('modelo-pjc').entidades[classe];
  if (!ent) erro(`Entidade ${classe} ausente do modelo.`);
  const campos = [];
  for (const f of ent.campos) {
    if ((f.anotacoes || []).some((a) => /@Transient/.test(a)) || /classeDoRepositorio|maquina/i.test(f.nome)) continue;
    let v = valores[f.nome];
    if (v === undefined) {
      if (/Set|List/.test(f.tipo)) v = { $colecao: /List/.test(f.tipo) ? 'List' : 'Set', itens: [] };
      else if (/Boolean/.test(f.tipo)) v = 'false';
      else v = null;
    }
    campos.push([f.nome, v]);
  }
  return { $classe: classe, campos };
}

const apurarOuValor = (x) => (x === undefined || x === null || x === false ? null : x === true || x === 'apurar' ? { apurar: true } : { valor: dec(x) });

// componente da especificação -> [campo apurar, campo valor] do Pagamento
const CREDITO = { principal: ['apurarValorPrincipal', 'valorParcelaPrincipal'], fgts: ['apurarValorFgts', 'valorParcelaFgts'], multasReclamante: ['apurarValorMultasDevidasReclamante', 'valorParcelaMultasDevidasReclamante'], multasReclamado: ['apurarValorMultasDevidasReclamado', null] };
const RECOLHER = { custas: ['apurarCustasJudiciais', 'custasJudiciais'], depositoFgts: ['apurarDepositoDeFgts', null], contribuicaoSocial: ['apurarDescontoDaContribuicaoSocial', 'descontoDaContribuicaoSocial'], previdenciaPrivada: ['apurarPrevidenciaPrivada', 'previdenciaPrivada'], pensao: ['apurarPensaoAlimenticia', 'pensaoAlimenticia'], imposto: ['apurarImpostoDoReclamante', 'impostoDoReclamante'] };
const OUTROS = { custas: ['apurarCustasJudiciaisOutrosDebitos', 'custasJudiciaisOutrosDebitos'], inssSalariosDevidos: ['apurarInssSobreSalariosDevidosOutrosDebitos', 'inssSobreSalariosDevidosOutrosDebitos'], inssSalariosPagos: ['apurarInssSobreSalariosPagosOutrosDebitos', 'inssSobreSalariosPagosOutrosDebitos'], jurosPrevidenciaPrivada: ['apurarJurosDePrevidenciaPrivadaOutrosDebitos', 'jurosDePrevidenciaPrivadaOutrosDebitos'], impostoRenda: ['apurarImpostoDeRendaDoReclamanteOutrosDebitos', 'impostoDeRendaDoReclamanteOutrosDebitos'], inss10: ['apurarInssDezPorcento', 'inssDezPorcento'], inss05: ['apurarInssMeioPorcento', 'inssMeioPorcento'] };
const COBRAR = { custas: ['apurarCustasJudiciaisDebitosCobrarDoReclamante', 'custasJudiciaisDebitosCobrarDoReclamante'] };
// vínculos de multas e honorários por parcela: [campo "pagar", coleção, tipoVinculo]
const VINC = {
  recolher: { multas: ['pagarMultasDevidasTerceiros', 'multasDevidasTerceiros', 'DEBITOSRECLAMANTE'], honorarios: ['pagarHonorariosBrutosDevidosReclamante', 'honorariosBrutosDevidosReclamante', 'DEBITOSRECLAMANTE'] },
  outros: { multas: ['pagarMultasDevidasTerceirosOutrosDebitos', 'multasDevidasTerceirosOutrosDebitos', 'OUTROSDEBITOSRECLAMADO'], honorarios: ['pagarHonorariosBrutosDevidosReclamadoOutrosDebitos', 'honorariosBrutosDevidosReclamadoOutrosDebitos', 'OUTROSDEBITOSRECLAMADO'] },
  cobrar: { multas: ['pagarMultasDevidasTerceirosDebitosCobrarDoReclamante', 'multasDevidasTerceirosDebitosCobrarDoReclamante', 'DEBITOSCOBRARRECLAMANTE'], honorarios: ['pagarHonorariosBrutosDevidosReclamanteDebitosCobrarDoReclamante', 'honorariosBrutosDevidosReclamanteDebitosCobrarDoReclamante', 'DEBITOSCOBRARRECLAMANTE'] },
};

// Custas por ato do art. 789-A da CLT: valor unitário da tabela de custas fixas do PJe-Calc, que tem uma só
// vigência, desde 27/09/2002. A tela grava esses valores em cada linha ao confirmar a data.
const INICIO_CUSTAS_FIXAS = Number(dataMs('2002-09-27'));
const ATOS = {
  atosUrbanos: ['11.06', 'ato(s) do oficial de justiça na zona urbana'], atosRurais: ['22.13', 'ato(s) do oficial de justiça na zona rural'],
  agravosDeInstrumento: ['44.26', 'agravo(s) de instrumento'], agravosDePeticao: ['44.26', 'agravo(s) de petição'],
  impugnacaoSentenca: ['55.35', 'impugnação(ões) à sentença de liquidação'], embargosArrematacao: ['44.26', 'embargos à arrematação'],
  embargosExecucao: ['44.26', 'embargos à execução'], embargosTerceiros: ['44.26', 'embargos de terceiros'], recursoRevista: ['55.35', 'recurso(s) de revista'],
};
const TETO_AUTO = 1915.38; // autos de arrematação, adjudicação e remição: 5% do valor do bem, até este teto
const TIPOS_AUTO = { REMICAO: 'remição', ADJUDICACAO: 'adjudicação', ARREMATACAO: 'arrematação' };
const DIA = 86400000;
const r2 = (x) => Math.round(x * 100) / 100;

/** Data de um evento da atualização com as regras das telas: obrigatória, não antes da liquidação nem no futuro. */
function dataDoEvento(v, ctx, rotulo, dataLiq, hoje) {
  if (v == null || v === '') erro(`${ctx}: Campo obrigatório: ${rotulo}. (MSG0003)`);
  const d = Number(dataMs(dataIso(v, ctx)));
  if (d < dataLiq) erro(`${ctx}: ${msg127(dataLiq)}`);
  if (d > hoje) erro(`${ctx}: A data de um evento de atualização do cálculo não pode ser posterior à data atual. (MSG0128)`);
  return d;
}

/**
 * Pensão alimentícia da atualização (tela Pagamento > Pensão Alimentícia): o cálculo tem uma só pensão, que passa a
 * valer a partir de "dataEvento". A base sai das incidências marcadas nas verbas ativas e no FGTS (no Cálculo
 * Externo, de percentuais do principal tributável e não tributável).
 */
function montarPensao(raiz, pa, dataLiq, hoje) {
  const ctx = 'execucao.pensao';
  const pen = c(raiz, 'pensaoAlimenticia');
  if (!pen) erro(`${ctx}: o cálculo exportado não traz o bloco de pensão alimentícia.`);
  if (c(pen, 'origemRegistro') !== 'ATUALIZACAO' && c(pen, 'apurarPensaoAlimenticia') === 'true') erro(`${ctx}: Já existe uma Pensão Alimentícia definida no cálculo. Para alterá-la verifique a Pensão Alimentícia no menu de cálculo. (MSG0126)`);
  if (pa.aliquota == null || pa.aliquota === '') erro(`${ctx}: Campo obrigatório: Alíquota. (MSG0003)`);
  const aliquota = dec(pa.aliquota);
  if (!(Number(aliquota) > 0 && Number(aliquota) <= 100)) erro(`${ctx}.aliquota: percentual maior que 0 e até 100.`);
  const d = dataDoEvento(pa.dataEvento, ctx, 'Data do Evento', dataLiq, hoje);
  if (pa.folha != null && String(pa.folha).length > 80) erro(`${ctx}.folha: até 80 caracteres (limite da tela).`);
  const externo = c(raiz, 'calculoExterno') === 'true';
  const fgts = c(raiz, 'fgts');
  // a tela lista as verbas ativas, com os reflexos ativos de cada uma
  const ativas = [...objetos(raiz)].filter((o) => o.$classe && o.$classe !== 'Fgts' && c(o, 'ativo') === 'true' && o.campos.some(([k]) => k === 'incidenciaPensaoAlimenticia'));
  if (pa.verbas != null) {
    if (externo) erro(`${ctx}.verbas: no Cálculo Externo a tela não lista verbas; use "principalTributavel" e "principalNaoTributavel".`);
    let marcar;
    if (pa.verbas === 'todas') marcar = new Set(ativas);
    else {
      if (!Array.isArray(pa.verbas)) erro(`${ctx}.verbas: use "todas" ou uma lista com os nomes das verbas e reflexos do cálculo.`);
      marcar = new Set();
      for (const nome of pa.verbas) {
        const achadas = ativas.filter((v) => norm(c(v, 'nome')) === norm(nome));
        if (!achadas.length) erro(`${ctx}.verbas: "${nome}" não é verba ativa do cálculo (ativas: ${ativas.map((v) => String(c(v, 'nome')).trim()).join('; ')}).`);
        for (const v of achadas) marcar.add(v);
      }
    }
    for (const v of ativas) definir(v, 'incidenciaPensaoAlimenticia', marcar.has(v) ? 'true' : 'false');
  }
  if (pa.fgts != null) {
    if (!fgts) erro(`${ctx}.fgts: o cálculo não tem FGTS.`);
    definir(fgts, 'incidenciaPensaoAlimenticia', pa.fgts ? 'true' : 'false');
    if (!pa.fgts) definir(fgts, 'incidenciaPensaoAlimenticiaSobreMulta', 'false');
  }
  if (pa.multaFgts != null) {
    if (pa.multaFgts && c(fgts, 'incidenciaPensaoAlimenticia') !== 'true') erro(`${ctx}.multaFgts: a tela só oferece a multa do FGTS com a incidência sobre o FGTS marcada ("fgts": true).`);
    if (pa.multaFgts && c(fgts, 'multa') !== 'true') erro(`${ctx}.multaFgts: o cálculo não apura a multa do FGTS.`);
    definir(fgts, 'incidenciaPensaoAlimenticiaSobreMulta', pa.multaFgts ? 'true' : 'false');
  }
  const principais = [['principalTributavel', 'incidirSobrePrincipalTributavel', 'percPrincipalTributavel', 'tributável'], ['principalNaoTributavel', 'incidirSobrePrincipalNaoTributavel', 'percPrincipalNaoTributavel', 'não tributável']];
  for (const [k, cInc, cPerc] of principais) {
    if (pa[k] == null) continue;
    if (!externo) erro(`${ctx}.${k}: só no Cálculo Externo; no cálculo comum a base vem das verbas marcadas em "verbas".`);
    if (pa[k] === false) { definir(pen, cInc, 'false'); definir(pen, cPerc, null); continue; }
    const p = dec(pa[k]);
    if (!(Number(p) > 0 && Number(p) <= 100)) erro(`${ctx}.${k}: percentual da base maior que 0 e até 100 (ou false).`);
    definir(pen, cInc, 'true'); definir(pen, cPerc, p);
  }
  if (externo) {
    for (const [k, cInc, cPerc, rot] of principais) if (c(pen, cInc) === 'true' && c(pen, cPerc) == null) erro(`${ctx}.${k}: a tela exige o percentual quando a incidência sobre o principal ${rot} está marcada (informe o percentual ou false).`);
  }
  const fgtsInc = c(fgts, 'incidenciaPensaoAlimenticia') === 'true';
  const verbasInc = ativas.filter((v) => c(v, 'incidenciaPensaoAlimenticia') === 'true');
  const temBase = externo ? principais.some(([, cInc]) => c(pen, cInc) === 'true') || fgtsInc : verbasInc.length > 0 || fgtsInc;
  if (!temBase) erro(`${ctx}: Para apurar Pensão Alimentícia, marque a incidência correspondente em pelo menos uma das verbas registradas no cálculo e/ou a incidência no FGTS ("verbas" ou "fgts"); sem base a pensão sai zerada.`);
  definir(pen, 'apurarPensaoAlimenticia', 'true');
  definir(pen, 'aliquota', aliquota);
  definir(pen, 'incidirSobreJuros', pa.incidirSobreJuros ? 'true' : 'false');
  definir(pen, 'dataEvento', String(d));
  definir(pen, 'folhaDoEvento', pa.folha ? String(pa.folha) : null);
  definir(pen, 'origemRegistro', 'ATUALIZACAO');
  const base = externo ? principais.filter(([, cInc]) => c(pen, cInc) === 'true').map(([, , cPerc, rot]) => `${c(pen, cPerc)}% do principal ${rot}`) : [`${verbasInc.length} verba(s)/reflexo(s)`];
  if (fgtsInc) base.push(c(fgts, 'incidenciaPensaoAlimenticiaSobreMulta') === 'true' ? 'FGTS e multa do FGTS' : 'FGTS');
  return `${fmt(d)}: ${aliquota}% sobre ${base.join(', ')}${pa.incidirSobreJuros ? ', com juros' : ''}`;
}

/**
 * Custas da execução (tela Pagamento > Custas Judiciais): custas por ato do art. 789-A da CLT (uma linha por
 * data), autos de arrematação, adjudicação e remição (5% do bem, até o teto) e armazenamento (0,1% do bem por dia).
 */
function montarCustas(raiz, cu, ids, dataLiq, hoje) {
  const ctx = 'execucao.custas';
  const custas = c(raiz, 'custasJudiciais');
  if (!custas) erro(`${ctx}: o cálculo exportado não traz o bloco de custas judiciais.`);
  const ref = { $ref: 'CustasJudiciais', id: c(custas, 'id') };
  const resumo = [];
  if (cu.folha != null) {
    if (String(cu.folha).length > 80) erro(`${ctx}.folha: até 80 caracteres (limite da tela).`);
    definir(custas, 'folhaDoEvento', String(cu.folha).toUpperCase()); // a tela grava os textos em maiúsculas
  }
  const datasFixas = new Set(it(custas, 'custasFixasAtualizacao').map((x) => Number(c(x, 'dataEvento'))));
  for (const [i, f] of (cu.fixas || []).entries()) {
    const cx = `${ctx}.fixas[${i}]`;
    for (const k of Object.keys(f || {})) if (k !== 'vencimento' && !CUSTAS_FIXAS[k]) erro(`${cx}: ato "${k}" desconhecido (aceitos: ${Object.keys(CUSTAS_FIXAS).join(', ')}).`);
    const d = dataDoEvento(f.vencimento, cx, 'Vencimento', dataLiq, hoje);
    if (d < INICIO_CUSTAS_FIXAS) erro(`${cx}: A data de vencimento das custas fixas deve ser posterior ao dia 27/09/2002. (MSG0145)`);
    if (datasFixas.has(d)) erro(`${cx}: já há custas por ato em ${fmt(d)}; a tela guarda uma linha por data (junte as quantidades numa só).`);
    datasFixas.add(d);
    const v = { id: ids.id(), custasJudiciais: ref, dataEvento: String(d) };
    const atos = [];
    let total = 0;
    for (const [k, [qtde, valor]] of Object.entries(CUSTAS_FIXAS)) {
      const [unitario, rotulo] = ATOS[k];
      v[valor] = unitario;
      if (f[k] == null || f[k] === '') continue;
      const n = Number(f[k]);
      if (!Number.isInteger(n) || n < 0 || n > 999) erro(`${cx}.${k}: quantidade inteira de 0 a 999.`);
      // campo em branco na tela = sem quantidade (o Resumo descreve a linha pelo primeiro ato preenchido)
      if (n > 0) { v[qtde] = String(n); atos.push(`${n} ${rotulo} × R$ ${unitario}`); total += n * Number(unitario); }
    }
    if (!atos.length) erro(`${cx}: informe ao menos uma quantidade maior que zero (sem quantidade a tela não guarda a linha).`);
    campo(custas, 'custasFixasAtualizacao').itens.push(novoObjeto('CustasFixasAtualizacao', v));
    resumo.push(`por ato em ${fmt(d)}: ${atos.join(', ')} = R$ ${r2(total).toFixed(2)}`);
  }
  for (const [i, a] of (cu.autos || []).entries()) {
    const cx = `${ctx}.autos[${i}]`;
    if (!a || !a.tipo) erro(`${cx}: Campo obrigatório: Tipo de Auto. (MSG0003)`);
    const tipo = norm(a.tipo);
    if (!TIPOS_AUTO[tipo]) erro(`${cx}.tipo: use ${Object.keys(TIPOS_AUTO).join(', ')}.`);
    if (a.valor == null || a.valor === '') erro(`${cx}: Campo obrigatório: Valor do Bem. (MSG0003)`);
    const valor = dec(a.valor);
    if (!(Number(valor) > 0)) erro(`${cx}.valor: o valor do bem deve ser maior que zero.`);
    const d = dataDoEvento(a.vencimento, cx, 'Vencimento', dataLiq, hoje);
    campo(custas, 'autosJudiciais').itens.push(novoObjeto('AutoJudicial', { id: ids.id(), versao: '0', custasJudiciais: ref, tipoDeAuto: tipo, valorAvaliacaoAuto: valor, dataVencimentoAuto: String(d), origemRegistro: 'ATUALIZACAO' }));
    resumo.push(`auto de ${TIPOS_AUTO[tipo]} em ${fmt(d)}: 5% de R$ ${valor} = R$ ${Math.min(r2(Number(valor) * 0.05), TETO_AUTO).toFixed(2)}${Number(valor) * 0.05 > TETO_AUTO ? ' (teto)' : ''}`);
  }
  for (const [i, a] of (cu.armazenamentos || []).entries()) {
    const cx = `${ctx}.armazenamentos[${i}]`;
    if (!a) erro(`${cx}: informe { inicio, fim, valor }.`);
    const ini = dataDoEvento(a.inicio, cx, 'Início', dataLiq, hoje);
    let fim = null;
    if (a.fim != null && a.fim !== '') {
      fim = Number(dataMs(dataIso(a.fim, `${cx}.fim`)));
      if (fim < ini) erro(`${cx}: o término (${fmt(fim)}) é anterior ao início (${fmt(ini)}).`);
      if (fim > hoje) erro(`${cx}: O valor do campo Término deve ser igual ou menor que a data de hoje. (MSG0010)`);
    }
    if (a.valor == null || a.valor === '') erro(`${cx}: Campo obrigatório: Valor do Bem. (MSG0003)`);
    const valor = dec(a.valor);
    if (!(Number(valor) > 0)) erro(`${cx}.valor: o valor do bem deve ser maior que zero.`);
    campo(custas, 'armazenamentos').itens.push(novoObjeto('Armazenamento', { id: ids.id(), versao: '0', custasJudiciais: ref, dataInicioArmazenamento: String(ini), dataTerminoArmazenamento: fim != null ? String(fim) : null, valorAvaliacaoArmazenamento: valor, qtdeDias: '0', origemRegistro: 'ATUALIZACAO' }));
    if (fim != null) { const dias = Math.round((fim - ini) / DIA) + 1; resumo.push(`armazenamento de ${fmt(ini)} a ${fmt(fim)}: 0,1% de R$ ${valor} × ${dias} dias = R$ ${r2(Number(valor) * 0.001 * dias).toFixed(2)}`); }
    else resumo.push(`armazenamento desde ${fmt(ini)}, sem término: 0,1% de R$ ${valor} por dia até a data da atualização`);
  }
  return resumo;
}

/**
 * Acrescenta à árvore de um cálculo LIQUIDADO os pagamentos e os eventos da execução. Devolve
 * { pagamentos, honorarios, multas, pensao, custas, premissas, avisos }. Lança ErroEspecificacao com as regras do
 * PJe-Calc.
 */
export function montarExecucao(raiz, execucao) {
  const ex = execucao || {};
  const errosEsquema = conferirEsquema(ex, ESQUEMA_EXECUCAO, 'execucao');
  if (errosEsquema.length) erro(errosEsquema.join(' | '));
  if (c(raiz, 'hashCalculoCorreto') !== 'true' || c(raiz, 'dataDeLiquidacao') == null) erro('O cálculo precisa estar liquidado (e sem alterações depois da liquidação) para receber pagamentos e ser atualizado (MSG0136/MSG0135). Liquide-o e exporte o .PJC liquidado.');
  const dataLiq = Number(c(raiz, 'dataDeLiquidacao'));
  const ids = new Ids(raiz);
  const idCalc = c(raiz, 'id');
  const refCalculo = () => ({ $ref: 'Calculo', id: idCalc });
  const premissas = []; const avisos = [];
  const hoje = Date.now();
  // eventos: honorários e multas da execução
  const colHon = campo(raiz, 'honorarios'); const colMul = campo(raiz, 'multas'); const colVerbas = campo(raiz, 'verbas');
  const novosHon = []; const novasMul = [];
  for (const [i, h] of (ex.honorarios || []).entries()) {
    const ctx = `execucao.honorarios[${i}]`;
    const { dataEvento, folha, ...resto } = h;
    const o = construirHonorario(resto, ctx, { doc: ids, refCalculo, colVerbas });
    const d = Number(dataMs(dataIso(dataEvento, `${ctx}.dataEvento`)));
    if (d < dataLiq) erro(`${ctx}: ${msg127(dataLiq)}`);
    if (d > hoje) erro(`${ctx}: A data de um evento de atualização do cálculo não pode ser posterior à data atual. (MSG0128)`);
    definir(o, 'origemRegistro', 'ATUALIZACAO'); definir(o, 'dataEvento', String(d)); definir(o, 'folhaDoEvento', folha ? String(folha) : null);
    colHon.itens.push(o); novosHon.push(o);
  }
  for (const [i, m] of (ex.multas || []).entries()) {
    const ctx = `execucao.multas[${i}]`;
    const { dataEvento, folha, ...resto } = m;
    const o = construirMulta(resto, ctx, { doc: ids, refCalculo });
    const d = Number(dataMs(dataIso(dataEvento, `${ctx}.dataEvento`)));
    if (d < dataLiq) erro(`${ctx}: ${msg127(dataLiq)}`);
    if (d > hoje) erro(`${ctx}: A data de um evento de atualização do cálculo não pode ser posterior à data atual. (MSG0128)`);
    definir(o, 'origemRegistro', 'ATUALIZACAO'); definir(o, 'dataEvento', String(d)); definir(o, 'folhaDoEvento', folha ? String(folha) : null);
    colMul.itens.push(o); novasMul.push(o);
  }
  // eventos: pensão alimentícia e custas da execução
  const pensao = ex.pensao ? montarPensao(raiz, ex.pensao, dataLiq, hoje) : null;
  const custas = ex.custas ? montarCustas(raiz, ex.custas, ids, dataLiq, hoje) : [];
  // pagamentos
  const colPag = campo(raiz, 'pagamentos');
  const datas = new Set(it(raiz, 'pagamentos').map((p) => Number(c(p, 'dataPagamento'))));
  const resumo = [];
  for (const [i, p] of (ex.pagamentos || []).entries()) {
    const ctx = `execucao.pagamentos[${i}]`;
    const v = {};
    const data = Number(dataMs(dataIso(p.data, `${ctx}.data`)));
    if (p.valor == null) erro(`${ctx}: O campo Valor do Pagamento é obrigatório. (MSG0003)`);
    const valor = Number(dec(p.valor));
    if (!(valor > 0)) erro(`${ctx}.valor deve ser maior que zero.`);
    if (data < dataLiq) erro(`${ctx}: ${msg127(dataLiq)}`);
    if (data > hoje) erro(`${ctx}: A data de um evento de atualização do cálculo não pode ser posterior à data atual. (MSG0128)`);
    if (datas.has(data)) erro(`${ctx}: Já existe pagamento cadastrado para esta data. (MSG0138)`);
    datas.add(data);
    const outrosVal = p.outrosDebitosReclamado != null ? Number(dec(p.outrosDebitosReclamado)) : 0;
    const cobrarVal = p.debitosCobrarReclamante != null ? Number(dec(p.debitosCobrarReclamante)) : null;
    const creditoVal = p.creditoReclamante != null ? Number(dec(p.creditoReclamante)) : Math.round((valor - outrosVal - (cobrarVal || 0)) * 100) / 100;
    if (Math.abs(creditoVal + outrosVal + (cobrarVal || 0) - valor) > 0.001) erro(`${ctx}: O valor total de pagamento informado está diferente da soma dos valores informados para pagamento de Créditos do Reclamante e de Outros Débitos do Reclamado. (MSG0125: ${creditoVal} + ${outrosVal}${cobrarVal != null ? ` + ${cobrarVal}` : ''} ≠ ${valor})`);
    const id = ids.id();
    Object.assign(v, { id, versao: '0', calculo: refCalculo(), dataCriacao: String(data), dataPagamento: String(data), valorPagamento: dec(valor), valorParcelaCreditoReclamante: dec(creditoVal), valorParcelaOutrosDebitos: dec(outrosVal), valorParcelaDebitosCobrarDoReclamante: dec(cobrarVal ?? 0), folhaDoEvento: p.folha ? String(p.folha) : null });
    v.pagarPrecatorio = p.precatorio ? 'true' : 'false';
    v.priorizarPagamentoDeJuros = p.priorizarJuros ? 'true' : 'false';
    if (p.priorizarJuros == null) premissas.push(`${ctx}: imputação proporcional entre juros e principal (padrão do PJe-Calc). O art. 354 do Código Civil imputa primeiro nos juros — informe "priorizarJuros" conforme a decisão.`);
    // componentes
    const aplicar = (mapa, spec, rot) => {
      const sel = { apurar: false, informado: 0, selecionados: [] };
      for (const [k, x] of Object.entries(spec || {})) {
        if (k === 'multas' || k === 'honorarios') continue;
        if (!mapa[k]) erro(`${ctx}.${rot}: componente "${k}" desconhecido (aceitos: ${Object.keys(mapa).join(', ')}, multas, honorarios).`);
        const av = apurarOuValor(x);
        if (!av) continue;
        const [cApurar, cValor] = mapa[k];
        if (av.apurar) { v[cApurar] = 'true'; sel.apurar = true; }
        else {
          if (!cValor) erro(`${ctx}.${rot}.${k}: este componente só aceita "apurar" (o PJe-Calc rateia).`);
          v[cValor] = av.valor; sel.informado += Number(av.valor);
        }
        sel.selecionados.push(k);
      }
      return sel;
    };
    const vincular = (rot, spec) => {
      const out = { apurar: false, informado: 0, n: 0 };
      for (const tipo of ['multas', 'honorarios']) {
        const lista = (spec || {})[tipo];
        if (!lista || !lista.length) continue;
        const [cPagar, cCol, tipoVinc] = VINC[rot][tipo];
        v[cPagar] = 'true';
        const col = { $colecao: 'Set', itens: [] };
        for (const [j, x] of lista.entries()) {
          const ctxV = `${ctx}.${rot}.${tipo}[${j}]`;
          const alvo = tipo === 'multas'
            ? it(raiz, 'multas').find((m) => norm(c(m, 'descricao')) === norm(x.descricao))
            : it(raiz, 'honorarios').find((h) => (x.credor && norm(c(h, 'nomeCredor')) === norm(x.credor)) || (x.descricao && norm(c(h, 'descricao')) === norm(x.descricao)));
          if (!alvo) erro(`${ctxV}: ${tipo === 'multas' ? `multa "${x.descricao}"` : `honorário de "${x.credor || x.descricao}"`} não existe no cálculo nem nos eventos da execução.`);
          if (c(alvo, 'dataEvento') != null && Number(c(alvo, 'dataEvento')) > data) erro(`${ctxV}: Existem registros de ${tipo === 'multas' ? 'Multas/Indenizações' : 'Honorários'} vinculados ao pagamento com Data de Evento posterior a Data do Pagamento. (MSG0181)`);
          const apurarV = x.apurar === true || x.valor == null;
          const obj = novoObjeto(tipo === 'multas' ? 'MultaDoPagamento' : 'HonorarioDoPagamento', {
            id: ids.id(), [tipo === 'multas' ? 'multa' : 'honorario']: { $ref: tipo === 'multas' ? 'Multa' : 'Honorario', id: c(alvo, 'id') }, pagamento: { $ref: 'Pagamento', id }, tipoVinculo: tipoVinc,
            [tipo === 'multas' ? 'apurarMulta' : 'apurarHonorario']: apurarV ? 'true' : 'false', [tipo === 'multas' ? 'valorMulta' : 'valorHonorario']: apurarV ? null : dec(x.valor),
          });
          col.itens.push(obj); out.n++;
          if (apurarV) out.apurar = true; else out.informado += Number(dec(x.valor));
        }
        v[cCol] = col;
      }
      return out;
    };
    // 1. créditos do reclamante
    const cred = aplicar(CREDITO, p.credito ?? { principal: 'apurar' }, 'credito');
    if (p.credito == null) premissas.push(`${ctx}: crédito do reclamante rateado só no principal (padrão do MCP). Informe "credito" (principal, fgts, multasReclamante) conforme a decisão.`);
    if (creditoVal === 0 && cred.selecionados.length) erro(`${ctx}: Há parcelas selecionadas para pagamento de Créditos do Reclamante, porém não há valor a ser pago. (MSG0131)`);
    if (creditoVal > 0 && !cred.selecionados.length && !p.precatorio) erro(`${ctx}: Há valor a ser pago para Créditos do Reclamante, porém não há parcelas selecionadas para pagamento. (MSG0132)`);
    if (creditoVal > 0 && cred.selecionados.length) {
      if (cred.informado > creditoVal + 0.001) erro(`${ctx}: O total de valores informados para pagamento de parcelas de Créditos do Reclamante ultrapassa o valor a ser pago. (MSG0133)`);
      if (cred.informado < creditoVal - 0.001 && !cred.apurar) erro(`${ctx}: O total de valores informados para pagamento de parcelas de Créditos do Reclamante é menor que o valor a ser pago e não há parcelas a serem apuradas. (MSG0134)`);
    }
    // recolhimentos dos débitos do reclamante (saem do crédito)
    if (p.recolher) {
      v.recolherDebitosReclamante = 'true';
      const r = aplicar(RECOLHER, p.recolher, 'recolher');
      const vr = vincular('recolher', p.recolher);
      if (!r.selecionados.length && !vr.n) erro(`${ctx}: Há valor a ser recolhido para Débitos do Reclamante, porém não há parcelas selecionadas para recolhimento. (MSG0132)`);
      if (r.informado + vr.informado > creditoVal + 0.001) erro(`${ctx}: O total de valores informados para recolhimento de parcelas de Débitos do Reclamante ultrapassa o valor a ser pago de Créditos do Reclamante. (MSG0133)`);
    }
    // 2. outros débitos do reclamado
    const out = aplicar(OUTROS, p.outros, 'outros');
    const vo = vincular('outros', p.outros);
    const selOutros = out.selecionados.length + vo.n;
    if (outrosVal === 0 && selOutros) erro(`${ctx}: Há parcelas selecionadas para pagamento de Outros Débitos do Reclamado, porém não há valor a ser pago. (MSG0131)`);
    if (outrosVal > 0) {
      if (!selOutros) erro(`${ctx}: Há valor a ser pago para Outros Débitos do Reclamado, porém não há parcelas selecionadas para pagamento. (MSG0132)`);
      if (out.informado + vo.informado > outrosVal + 0.001) erro(`${ctx}: O total de valores informados para pagamento de parcelas de Outros Débitos do Reclamado ultrapassa o valor a ser pago. (MSG0133)`);
      if (out.informado + vo.informado < outrosVal - 0.001 && !out.apurar && !vo.apurar) erro(`${ctx}: O total de valores informados para pagamento de parcelas de Outros Débitos do Reclamado é menor que o valor a ser pago e não há parcelas a serem apuradas. (MSG0134)`);
    }
    // 3. débitos a cobrar do reclamante
    const cob = aplicar(COBRAR, p.cobrar, 'cobrar');
    const vc = vincular('cobrar', p.cobrar);
    const selCob = cob.selecionados.length + vc.n;
    if (cobrarVal === 0 && selCob) erro(`${ctx}: Há parcelas selecionadas para pagamento de Débitos do Reclamante, porém não há valor a ser pago. (MSG0131)`);
    if (cobrarVal > 0) {
      if (!selCob) erro(`${ctx}: Há valor a ser pago para Débitos do Reclamante, porém não há parcelas selecionadas para pagamento. (MSG0132)`);
      if (cob.informado + vc.informado > cobrarVal + 0.001) erro(`${ctx}: O total de valores informados para pagamento de parcelas de Débitos do Reclamante ultrapassa o valor a ser pago. (MSG0133)`);
      if (cob.informado + vc.informado < cobrarVal - 0.001 && !cob.apurar && !vc.apurar) erro(`${ctx}: O total de valores informados para pagamento de parcelas de Débitos do Reclamante é menor que o valor a ser pago e não há parcelas a serem apuradas. (MSG0134)`);
    }
    if (p.precatorio && (p.priorizarJuros || (p.credito && (p.credito.multasReclamante || p.credito.multasReclamado)) || (p.recolher && (p.recolher.previdenciaPrivada || p.recolher.pensao || p.recolher.multas)) || cobrarVal || (p.outros && (p.outros.jurosPrevidenciaPrivada || p.outros.inss10 || p.outros.inss05 || p.outros.multas)))) {
      avisos.push(`${ctx}: com "precatorio" a tela do PJe-Calc desliga priorizar juros, multas, previdência privada, pensão, débitos a cobrar, juros da previdência privada e INSS 10%/0,5%.`);
    }
    colPag.itens.push(novoObjeto('Pagamento', v));
    resumo.push(`${fmt(data)}: R$ ${dec(valor)} (créditos ${dec(creditoVal)}${outrosVal ? `, outros débitos ${dec(outrosVal)}` : ''}${cobrarVal ? `, a cobrar do reclamante ${dec(cobrarVal)}` : ''})`);
  }
  if (!(ex.pagamentos || []).length && !novosHon.length && !novasMul.length && !pensao && !custas.length) avisos.push('execucao: nenhum pagamento ou evento; a atualização só corrige o saldo até a data pedida.');
  // "Cobrar encargos de IRPF" muda o resultado quando o cálculo apura IR: a tela vem marcada e o MCP envia o que
  // a especificação disser. Sem decisão, o valor dependeria de um padrão que ninguém escolheu.
  const irApurado = c(c(raiz, 'irpf'), 'apurarImpostoRenda') === 'true';
  const encargosIrpfSemDecisao = irApurado && ex.cobrarEncargosIrpf == null;
  if (encargosIrpfSemDecisao) avisos.push('execucao.cobrarEncargosIrpf: o cálculo apura imposto de renda e a especificação não diz se a atualização cobra os encargos de IRPF. A tela do PJe-Calc vem marcada; o MCP envia desmarcado. Informe true ou false conforme a decisão da execução.');
  const ev = eventosDaAtualizacao(raiz);
  if (ev.custas > ev.custasNoResumo) avisos.push(`execucao.custas: ${ev.custas - ev.custasNoResumo} lançamento(s) de custas depois do último pagamento, honorário, multa ou pensão entram no saldo, mas o Resumo da Atualização não os lista em "Eventos ocorridos" (comportamento do PJe-Calc).`);
  return { pagamentos: resumo, honorarios: novosHon.length, multas: novasMul.length, pensao, custas, premissas, avisos, irApurado, encargosIrpfSemDecisao };
}

/**
 * Eventos da atualização gravados no cálculo e quantos o Resumo da Atualização lista em "Eventos ocorridos": um
 * por pagamento, honorário, multa e pensão; as custas da execução entram sempre no saldo, mas só aparecem na
 * lista quando há pagamento, honorário, multa ou pensão na mesma data ou depois.
 */
export function eventosDaAtualizacao(raiz) {
  const daAtualizacao = (o) => c(o, 'origemRegistro') === 'ATUALIZACAO';
  const pen = c(raiz, 'pensaoAlimenticia');
  const comPensao = Boolean(pen && daAtualizacao(pen) && c(pen, 'apurarPensaoAlimenticia') === 'true' && c(pen, 'dataEvento') != null);
  const pagamentos = it(raiz, 'pagamentos').map((p) => Number(c(p, 'dataPagamento')));
  const honorarios = it(raiz, 'honorarios').filter(daAtualizacao).map((o) => Number(c(o, 'dataEvento')));
  const multas = it(raiz, 'multas').filter(daAtualizacao).map((o) => Number(c(o, 'dataEvento')));
  const principais = [...pagamentos, ...honorarios, ...multas, ...(comPensao ? [Number(c(pen, 'dataEvento'))] : [])];
  const cu = c(raiz, 'custasJudiciais');
  const custas = [
    ...it(cu, 'custasFixasAtualizacao').map((x) => Number(c(x, 'dataEvento'))),
    ...it(cu, 'autosJudiciais').filter(daAtualizacao).map((x) => Number(c(x, 'dataVencimentoAuto'))),
    ...it(cu, 'armazenamentos').filter(daAtualizacao).map((x) => Number(c(x, 'dataInicioArmazenamento'))),
  ];
  const ultimoPrincipal = Math.max(0, ...principais);
  return {
    pagamentos: pagamentos.length, honorarios: honorarios.length, multas: multas.length, pensao: comPensao ? 1 : 0,
    custas: custas.length, custasNoResumo: custas.filter((d) => d <= ultimoPrincipal).length,
    ultimoEvento: Math.max(ultimoPrincipal, ...custas),
  };
}

function msg127(dataLiq) { return `Não se pode lançar um evento de atualização do cálculo com data anterior à data de sua liquidação (${fmt(dataLiq)}). (MSG0127)`; }

/** Parâmetros da tela "Liquidar Atualização" a partir de `execucao` (validados). */
export function parametrosAtualizacao(raiz, execucao) {
  const ex = execucao || {};
  const data = dataIso(ex.dataAtualizacao, 'execucao.dataAtualizacao');
  const d = Number(dataMs(data));
  if (d < Number(c(raiz, 'dataDeLiquidacao'))) erro(`execucao.dataAtualizacao: a atualização precisa ser posterior à liquidação do cálculo (${fmt(c(raiz, 'dataDeLiquidacao'))}).`);
  const { ultimoEvento } = eventosDaAtualizacao(raiz);
  if (ultimoEvento && d < ultimoEvento) erro(`execucao.dataAtualizacao: a atualização (${fmt(d)}) é anterior ao último evento (${fmt(ultimoEvento)}); eventos depois da data não entram.`);
  const pr = ex.precatorio;
  let precatorio = null;
  if (pr) {
    const tipo = String(pr.tipo || 'RPV').toUpperCase();
    if (!['RPV', 'PRECATORIO', 'PRE'].includes(tipo)) erro('execucao.precatorio.tipo: use RPV ou PRECATORIO.');
    const esfera = String(pr.esfera || 'FEDERAL').toUpperCase();
    if (!['FEDERAL', 'ESTADUAL_MUNICIPAL', 'ESTADUAL', 'MUNICIPAL'].includes(esfera)) erro('execucao.precatorio.esfera: use FEDERAL ou ESTADUAL_MUNICIPAL.');
    const esf = esfera === 'FEDERAL' ? 'FEDERAL' : 'ESTADUAL_MUNICIPAL';
    if (!pr.periodoGraca || !pr.periodoGraca.inicio || !pr.periodoGraca.fim) erro('execucao.precatorio.periodoGraca: informe { inicio, fim } (a tela exige o período da graça, art. 100 §5º da CF).');
    precatorio = {
      tipo: tipo === 'RPV' ? 'RPV' : 'PRE', esfera: esf,
      inicioGraca: dataIso(pr.periodoGraca.inicio, 'execucao.precatorio.periodoGraca.inicio'), fimGraca: dataIso(pr.periodoGraca.fim, 'execucao.precatorio.periodoGraca.fim'),
      // EC 136/2025: padrão da tela (federal 01/09/2025; estadual/municipal 01/08/2025)
      ec136: pr.ec136APartirDe ? dataIso(pr.ec136APartirDe, 'execucao.precatorio.ec136APartirDe') : (esf === 'FEDERAL' ? '2025-09-01' : '2025-08-01'),
    };
  }
  return { data, identificacao: ex.identificacao ? String(ex.identificacao) : null, comentarios: ex.comentarios ? String(ex.comentarios) : null, cobrarEncargosIrpf: Boolean(ex.cobrarEncargosIrpf), precatorio };
}

const NUM = /^\(?-?[\d.]+,\d{2}\)?$/;
const numBr = (s) => { const t = String(s).trim(); const neg = /^\(.*\)$/.test(t) || t.startsWith('-'); const v = Number(t.replace(/[()\s-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? (neg ? -v : v) : null; };

/** Valores do relatório "Resumo da Atualização do Cálculo" (RESUMO_PAGAMENTO): saldo por credor e eventos. */
export function extrairResumoAtualizacao(texto) {
  const t = String(texto || '');
  const linhas = t.split('\n').map((x) => x.trim()).filter(Boolean);
  const ini = linhas.findIndex((x) => /^Descri[cç][aã]o do Saldo Devedor por Credor$/i.test(x));
  // dois quadros: o do reclamado ("Total Devido Pelo Reclamado") e, quando há débitos do reclamante, o dele
  const saldo = []; const saldoReclamante = [];
  let total = null; let totalReclamante = null;
  if (ini >= 0) {
    for (let i = ini + 1; i + 1 < linhas.length; i++) {
      if (/^Eventos ocorridos|^Atualiza[cç][aã]o liquidada|^P[aá]g\./i.test(linhas[i])) break;
      if (linhas[i] === 'Valor') continue;
      if (!NUM.test(linhas[i]) && NUM.test(linhas[i + 1])) {
        if (/^(Total Devido Pelo Reclamado|Total Requisitado)$/i.test(linhas[i])) total = numBr(linhas[i + 1]);
        else if (/^Total Devido Pelo Reclamante$/i.test(linhas[i])) totalReclamante = numBr(linhas[i + 1]);
        else (total == null ? saldo : saldoReclamante).push({ descricao: linhas[i], valor: numBr(linhas[i + 1]) });
        i++;
      }
    }
  }
  const pick = (re) => { const x = saldo.find((y) => re.test(y.descricao)); return x ? x.valor : null; };
  const periodos = [...t.matchAll(/Saldo Devedor em (\d{2}\/\d{2}\/\d{4})/gi)].map((m) => m[1]);
  const eventos = (t.match(/Eventos ocorridos:\s*([^\n]+)/) || [])[1] || null;
  return {
    atualizadoAte: periodos.length ? periodos[periodos.length - 1] : null,
    saldoPorCredor: saldo,
    liquidoDevidoAoReclamante: pick(/^L[IÍ]QUIDO DEVIDO AO RECLAMANTE$/i),
    depositoFgts: pick(/^DEP[OÓ]SITO FGTS$/i),
    pensaoAlimenticia: pick(/^PENS[AÃ]O ALIMENT[IÍ]CIA$/i),
    contribuicaoSocial: saldo.filter((y) => /^CONTRIBUI[CÇ][AÃ]O SOCIAL|^INSS (BENEFICI[AÁ]RIO|EXECUTADO)/i.test(y.descricao)).reduce((a, y) => (a ?? 0) + (y.valor || 0), null),
    custasReclamado: pick(/^CUSTAS JUDICIAIS (DEVIDAS PELO RECLAMADO|- EXECUTADO)/i),
    precatorio: /Precat[oó]rio \/ RPV/i.test(t),
    totalDevidoPeloReclamado: total,
    debitosDoReclamante: saldoReclamante.length ? saldoReclamante : null,
    totalDevidoPeloReclamante: totalReclamante,
    eventos: eventos ? eventos.replace(/\.$/, '').split(/;\s*/).filter(Boolean) : [],
    conferencia: total != null ? { somaDoSaldo: Math.round(saldo.reduce((a, x) => a + (x.valor || 0), 0) * 100) / 100, total } : null,
  };
}

