// pjecalc-mcp-skill · lib/ocorrencias.mjs
// Valores mês a mês nas ocorrências das verbas (pago dos contracheques, quantidade apurada, devido informado...).
//
// As ocorrências só existem depois que o PJe-Calc regera as verbas. Cada ocorrência exportada traz uma cópia
// ("ocorrenciaOriginal") com os valores gerados; um campo diferente da cópia é uma alteração manual, e a
// regeração "mantendo alterações" preserva ativo, valor (calculado/informado), divisor, multiplicador,
// quantidade, dobra, devido (quando informado) e pago. O fluxo do MCP: importar, regerar, exportar, aplicar
// as edições aqui (sem tocar na cópia original), reimportar e regerar mantendo as alterações.
//
// O mesmo vale para as ocorrências do FGTS e da contribuição social (base, depositado e alíquota; bases dos
// salários devidos e pagos e contribuições recolhidas), com uma diferença: o Regerar das verbas não as cria. O
// MCP as gera pela tela de cada uma (Ocorrências > Regerar) antes de exportar. Aqui também ficam a conferência
// das custas fixas, dos autos e dos armazenamentos no cálculo liquidado.

import { campo, itens, definir, msParaData } from './pjc.mjs';
import { dec, CUSTAS_FIXAS } from './gerador.mjs';

const c = (o, k) => (o ? campo(o, k) : null);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const ymd = (ms) => { if (ms == null) return null; const d = new Date(Number(ms) - 3 * 3600e3); return d.toISOString().slice(0, 10); };

export const CAMPOS_EDITAVEIS = ['pago', 'quantidade', 'devido', 'divisor', 'multiplicador', 'dobra', 'ativo'];

function todasAsVerbas(raiz) {
  const vistos = new Set(); const out = [];
  const visitar = (no) => {
    if (!no || typeof no !== 'object') return;
    if (no.$classe) {
      if (['Calculada', 'Informada', 'Reflexo'].includes(no.$classe)) {
        const k = `${no.$classe}#${c(no, 'id')}`;
        if (!vistos.has(k)) { vistos.add(k); out.push(no); }
      }
      for (const [, v] of no.campos) visitar(v);
    } else if (no.$colecao) for (const x of no.itens) visitar(x);
  };
  for (const v of itens(campo(raiz, 'verbas'))) visitar(v);
  return out;
}

/** Descrição curta de uma ocorrência (para mensagens e listas de opções). */
function rotulo(o) {
  const ini = ymd(c(o, 'dataInicial'));
  const aq = c(o, 'dataInicialPeriodoAquisitivo');
  return `${ini}${aq ? ` (aquisitivo ${ymd(aq).slice(0, 4)}/${ymd(c(o, 'dataFinalPeriodoAquisitivo')).slice(0, 4)}${c(o, 'feriasIndenizadas') === 'true' ? ', indenizadas' : ''})` : ''}`;
}

/** Ocorrências da verba que casam com o seletor da edição (competencia AAAA-MM, data AAAA-MM-DD, aquisitivo AAAA/AAAA). */
function acharOcorrencias(verba, e) {
  let lista = itens(campo(verba, 'ocorrencias')).filter((o) => o && o.$classe);
  if (e.data) lista = lista.filter((o) => ymd(c(o, 'dataInicial')) === String(e.data).slice(0, 10));
  else if (e.competencia) lista = lista.filter((o) => ymd(c(o, 'dataInicial')).slice(0, 7) === String(e.competencia).slice(0, 7));
  if (e.aquisitivo) {
    const [a1, a2] = String(e.aquisitivo).split('/');
    lista = lista.filter((o) => c(o, 'dataInicialPeriodoAquisitivo') && ymd(c(o, 'dataInicialPeriodoAquisitivo')).slice(0, 4) === a1 && (!a2 || ymd(c(o, 'dataFinalPeriodoAquisitivo')).slice(0, 4) === a2));
  }
  if (e.indenizadas != null) lista = lista.filter((o) => (c(o, 'feriasIndenizadas') === 'true') === Boolean(e.indenizadas));
  return lista;
}

/**
 * Aplica as edições à árvore de um cálculo exportado (com ocorrências). `edicoes`: [{ verba: NOME, itens: [{
 * competencia|data|aquisitivo, pago, quantidade, devido, divisor, multiplicador, dobra, ativo }] }].
 * Lança erro (com as ocorrências disponíveis) quando um seletor não casa com exatamente uma ocorrência.
 */
export function aplicarEdicoes(raiz, edicoes) {
  const verbas = todasAsVerbas(raiz);
  const aplicadas = [];
  for (const ed of edicoes || []) {
    const v = verbas.find((x) => norm(c(x, 'nome')) === norm(ed.verba));
    if (!v) throw new Error(`ocorrências: a verba "${ed.verba}" não está no cálculo exportado.`);
    for (const [i, e] of (ed.itens || []).entries()) {
      const ctx = `${ed.verba}.ocorrencias[${i}]`;
      if (!e.competencia && !e.data && !e.aquisitivo) throw new Error(`${ctx}: informe "competencia" (AAAA-MM), "data" (AAAA-MM-DD) ou "aquisitivo" (AAAA/AAAA).`);
      const achadas = acharOcorrencias(v, e);
      if (achadas.length !== 1) {
        const todas = itens(campo(v, 'ocorrencias')).filter((o) => o && o.$classe).map(rotulo);
        throw new Error(`${ctx}: ${achadas.length ? `${achadas.length} ocorrências casam (${achadas.map(rotulo).join(' | ')}): use "data", "aquisitivo" ou "indenizadas" para escolher uma` : 'nenhuma ocorrência casa'}. Ocorrências geradas: ${todas.slice(0, 40).join(' | ')}${todas.length > 40 ? ' ...' : ''}`);
      }
      const o = achadas[0];
      const antes = {};
      for (const k of CAMPOS_EDITAVEIS) if (e[k] !== undefined) antes[k] = c(o, k);
      if (e.pago !== undefined) definir(o, 'pago', dec(e.pago, 25));
      if (e.quantidade !== undefined) definir(o, 'quantidade', dec(e.quantidade, 25));
      if (e.divisor !== undefined) definir(o, 'divisor', dec(e.divisor, 25));
      if (e.multiplicador !== undefined) definir(o, 'multiplicador', dec(e.multiplicador, 8));
      if (e.dobra !== undefined) definir(o, 'dobra', e.dobra ? 'true' : 'false');
      if (e.ativo !== undefined) definir(o, 'ativo', e.ativo ? 'true' : 'false');
      if (e.devido !== undefined) {
        // valor devido digitado: a ocorrência passa a "informado" (a regeração preserva o devido só nesse caso)
        definir(o, 'valor', 'INFORMADO');
        definir(o, 'devido', dec(e.devido, 25));
      }
      aplicadas.push({ verba: c(v, 'nome'), ocorrencia: rotulo(o), antes, depois: Object.fromEntries(CAMPOS_EDITAVEIS.filter((k) => e[k] !== undefined).map((k) => [k, e[k]])) });
    }
  }
  return aplicadas;
}

/** Confere, num cálculo exportado depois da regeração/liquidação, que cada edição continua lá. */
export function conferirEdicoes(raiz, edicoes) {
  const verbas = todasAsVerbas(raiz);
  const divergencias = []; let ok = 0;
  for (const ed of edicoes || []) {
    const v = verbas.find((x) => norm(c(x, 'nome')) === norm(ed.verba));
    for (const e of ed.itens || []) {
      const achadas = v ? acharOcorrencias(v, e) : [];
      if (achadas.length !== 1) { divergencias.push(`${ed.verba} ${e.competencia || e.data || e.aquisitivo}: ocorrência não encontrada`); continue; }
      const o = achadas[0];
      const difs = [];
      const numIgual = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0000001;
      for (const k of ['pago', 'quantidade', 'devido', 'divisor', 'multiplicador']) if (e[k] !== undefined && !numIgual(c(o, k), e[k])) difs.push(`${k} ${c(o, k)} (esperado ${e[k]})`);
      for (const k of ['dobra', 'ativo']) if (e[k] !== undefined && (c(o, k) === 'true') !== Boolean(e[k])) difs.push(`${k} ${c(o, k)} (esperado ${e[k]})`);
      if (difs.length) divergencias.push(`${ed.verba} ${rotulo(o)}: ${difs.join(', ')}`); else ok++;
    }
  }
  return {
    item: 'valores mês a mês nas ocorrências (edições preservadas pelo PJe-Calc)',
    estado: divergencias.length ? 'falha' : ok ? 'ok' : 'nao_verificado',
    detalhe: divergencias.length ? divergencias.slice(0, 10).join('; ') : `${ok} ocorrência(s) com os valores informados`,
    dimensao: 'transferencia',
  };
}

// ---------------------------------------------------------------------------
// Ocorrências do FGTS e da contribuição social
// ---------------------------------------------------------------------------
// Um valor digitado na tela (ou na alteração em lote) fica marcado como "informado". O Regerar "mantendo
// alterações" preserva as bases e os recolhimentos informados, mas não a alíquota do FGTS de uma competência.

// campo da especificação -> [campo da ocorrência, campo da marca, valor da marca]
const CAMPOS_ENCARGO = {
  fgts: {
    base: ['baseHistorico', 'tipoDeBaseDoFgts', 'INFORMADA'],
    depositado: ['depositado', 'tipoDeDepositadoDoFgts', 'INFORMADA'],
    aliquota: ['aliquotaDoFgtsEnum', null, null],
  },
  salariosDevidos: { base: ['valorBase', 'tipoValorDaBase', 'INFORMADO'] },
  salariosPagos: {
    base: ['valorBase', 'tipoValorDaBase', 'INFORMADO'],
    recolhidoSegurado: ['valorRecolhidoSegurado', 'tipoValorDoRecolhidoSegurado', 'INFORMADO'],
    recolhidoEmpresa: ['valorRecolhidoEmpresa', 'tipoValorDoRecolhidoEmpresa', 'INFORMADO'],
    recolhidoSat: ['valorRecolhidoSAT', 'tipoValorDoRecolhidoSAT', 'INFORMADO'],
    recolhidoTerceiros: ['valorRecolhidoTerceiros', 'tipoValorDoRecolhidoTerceiros', 'INFORMADO'],
  },
};
const NOMES_ENCARGO = { fgts: 'fgts.ocorrencias', salariosDevidos: 'contribuicaoSocial.ocorrencias.salariosDevidos', salariosPagos: 'contribuicaoSocial.ocorrencias.salariosPagos' };
const ALIQUOTAS_FGTS = { 2: 'DOIS_POR_CENTO', 8: 'OITO_POR_CENTO', DOIS_POR_CENTO: 'DOIS_POR_CENTO', OITO_POR_CENTO: 'OITO_POR_CENTO' };

/** Há alguma edição de FGTS ou de contribuição social? */
export const temEdicoesEncargos = (enc) => !!enc && Object.keys(CAMPOS_ENCARGO).some((k) => (enc[k] || []).length > 0);

function ocorrenciasDoEncargo(raiz, tipo) {
  const dono = tipo === 'fgts' ? campo(raiz, 'fgts') : c(campo(raiz, 'inss'), tipo === 'salariosDevidos' ? 'inssSobreSalariosDevidos' : 'inssSobreSalariosPagos');
  return itens(c(dono, 'ocorrencias')).filter((o) => o && o.$classe);
}
const compEncargo = (o, tipo) => ymd(c(o, tipo === 'fgts' ? 'ocorrencia' : 'dataOcorrenciaInss')).slice(0, 7);
const ehDecimoTerceiro = (o) => c(o, 'ocorrenciaDecimoTerceiro') === 'true';
const rotuloEncargo = (o, tipo) => `${compEncargo(o, tipo)}${tipo !== 'fgts' && ehDecimoTerceiro(o) ? ' (13º)' : ''}`;

/**
 * Ocorrências alcançadas por uma edição. `competencia`: a do mês (na contribuição social, a do 13º só com
 * `decimoTerceiro: true`); `de`/`ate`: todas as do intervalo, inclusive as do 13º, como o lote da tela
 * (`decimoTerceiro` true/false restringe).
 */
function alvosEncargo(lista, tipo, e) {
  const de = String(e.competencia || e.de).slice(0, 7);
  const ate = String(e.competencia || e.ate || e.de).slice(0, 7);
  return lista.filter((o) => {
    const k = compEncargo(o, tipo);
    if (k < de || k > ate) return false;
    if (tipo === 'fgts') return true;
    if (e.decimoTerceiro != null) return ehDecimoTerceiro(o) === Boolean(e.decimoTerceiro);
    return e.competencia ? !ehDecimoTerceiro(o) : true;
  });
}

const valorEncargo = (k, v) => (k === 'aliquota' ? ALIQUOTAS_FGTS[String(v).trim().toUpperCase()] : dec(v, 2));

/**
 * Valor final de cada campo em cada ocorrência alcançada. As edições valem na ordem, como alterações sucessivas
 * na tela. Lança erro (com as ocorrências geradas) quando um seletor não alcança nenhuma.
 */
function planejarEncargos(raiz, encargos) {
  const plano = new Map();
  for (const tipo of Object.keys(CAMPOS_ENCARGO)) {
    const edicoes = (encargos && encargos[tipo]) || [];
    if (!edicoes.length) continue;
    const lista = ocorrenciasDoEncargo(raiz, tipo);
    for (const [i, e] of edicoes.entries()) {
      const alvos = alvosEncargo(lista, tipo, e);
      if (!alvos.length) {
        throw new Error(`${NOMES_ENCARGO[tipo]}[${i}]: nenhuma ocorrência em ${e.competencia || `${e.de} a ${e.ate || e.de}`}${e.decimoTerceiro ? ' (13º)' : ''}. Ocorrências geradas: ${lista.map((o) => rotuloEncargo(o, tipo)).join(' | ') || 'nenhuma'}`);
      }
      for (const o of alvos) {
        if (!plano.has(o)) plano.set(o, { tipo, campos: {} });
        for (const k of Object.keys(CAMPOS_ENCARGO[tipo])) if (e[k] != null) plano.get(o).campos[k] = valorEncargo(k, e[k]);
      }
    }
  }
  return plano;
}

/**
 * Aplica à árvore exportada (com as ocorrências já geradas) as edições `encargos` = { fgts, salariosDevidos,
 * salariosPagos }, marcando cada campo como informado, sem tocar na cópia original.
 */
export function aplicarEdicoesEncargos(raiz, encargos) {
  const aplicadas = [];
  for (const [o, { tipo, campos }] of planejarEncargos(raiz, encargos)) {
    const antes = {};
    for (const [k, v] of Object.entries(campos)) {
      const [nome, marca, informado] = CAMPOS_ENCARGO[tipo][k];
      antes[k] = c(o, nome);
      definir(o, nome, v);
      if (marca) definir(o, marca, informado);
    }
    aplicadas.push({ ocorrencia: `${NOMES_ENCARGO[tipo]} ${rotuloEncargo(o, tipo)}`, antes, depois: campos });
  }
  return aplicadas;
}

/** Confere, num cálculo exportado depois da reimportação ou da liquidação, cada campo editado e a marca de informado. */
export function conferirEdicoesEncargos(raiz, encargos) {
  const item = 'ocorrências de FGTS e de contribuição social (edições preservadas pelo PJe-Calc)';
  let plano;
  try { plano = planejarEncargos(raiz, encargos); } catch (e) { return { item, estado: 'falha', detalhe: e.message, dimensao: 'transferencia' }; }
  const divergencias = []; let ok = 0;
  for (const [o, { tipo, campos }] of plano) {
    const difs = [];
    for (const [k, v] of Object.entries(campos)) {
      const [nome, marca, informado] = CAMPOS_ENCARGO[tipo][k];
      const atual = c(o, nome);
      const igual = k === 'aliquota' ? atual === v : atual != null && Math.abs(Number(atual) - Number(v)) < 0.005;
      if (!igual) difs.push(`${k} ${atual} (esperado ${v})`);
      else if (marca && c(o, marca) !== informado) difs.push(`${k} sem a marca de informado (${c(o, marca)})`);
    }
    if (difs.length) divergencias.push(`${NOMES_ENCARGO[tipo]} ${rotuloEncargo(o, tipo)}: ${difs.join(', ')}`); else ok++;
  }
  return {
    item,
    estado: divergencias.length ? 'falha' : ok ? 'ok' : 'nao_verificado',
    detalhe: divergencias.length ? divergencias.slice(0, 10).join('; ') : `${ok} ocorrência(s) com os valores informados`,
    dimensao: 'transferencia',
  };
}

// ---------------------------------------------------------------------------
// Custas fixas, autos e armazenamentos
// ---------------------------------------------------------------------------

const isoData = (v) => { const s = String(v ?? '').trim(); const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10); };
const diasCorridos = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const perto = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.01;

/**
 * Confere, no cálculo liquidado, as custas fixas, os autos e os armazenamentos pedidos em `custas` (bloco da
 * especificação): quantidades, datas e avaliações gravadas, e a conta do PJe-Calc (auto: 5% da avaliação,
 * limitado ao teto da tabela de custas; armazenamento: 0,1% da avaliação por dia, até o término ou a liquidação).
 */
export function conferirCustas(raiz, custas) {
  const item = 'custas fixas, autos e armazenamentos no cálculo liquidado';
  const s = custas || {};
  const cu = campo(raiz, 'custasJudiciais');
  const div = []; const feitos = [];
  // os valores da tabela de custas e as custas dos autos e armazenamentos só existem depois da liquidação
  const liquidado = campo(raiz, 'hashCalculoCorreto') === 'true' && campo(raiz, 'dataDeLiquidacao') != null;
  if (s.fixas) {
    const venc = msParaData(c(cu, 'dataVencimentoCustasFixas'));
    if (s.fixas.vencimento && venc !== isoData(s.fixas.vencimento)) div.push(`vencimento das custas fixas ${venc} (esperado ${isoData(s.fixas.vencimento)})`);
    for (const [k, [qtde, unit]] of Object.entries(CUSTAS_FIXAS)) {
      if (s.fixas[k] == null) continue;
      const n = Number(c(cu, qtde) || 0);
      if (n !== Number(s.fixas[k])) div.push(`${k}: ${n} (esperado ${s.fixas[k]})`);
      else if (n > 0 && liquidado && c(cu, unit) == null) div.push(`${k}: sem valor da tabela de custas em ${venc}`);
      else if (n > 0) feitos.push(`${k} ${n}${c(cu, unit) != null ? ` × ${Number(c(cu, unit)).toFixed(2)}` : ''}`);
    }
  }
  const liquidacao = msParaData(campo(raiz, 'dataDeLiquidacao'));
  const doCalculo = (k) => itens(c(cu, k)).filter((o) => o && o.$classe && c(o, 'origemRegistro') !== 'ATUALIZACAO');
  const autos = doCalculo('autosJudiciais');
  const usados = new Set();
  for (const [i, a] of (s.autos || []).entries()) {
    const o = autos.find((x) => !usados.has(x) && c(x, 'tipoDeAuto') === String(a.tipo).trim().toUpperCase()
      && msParaData(c(x, 'dataVencimentoAuto')) === isoData(a.vencimento) && perto(c(x, 'valorAvaliacaoAuto'), a.valor));
    if (!o) { div.push(`autos[${i}] ${a.tipo} ${isoData(a.vencimento)} ${a.valor}: não encontrado`); continue; }
    usados.add(o);
    const calculado = c(o, 'valorCustasAuto');
    if (calculado == null) { if (liquidado) div.push(`autos[${i}]: sem custas calculadas`); else feitos.push(`auto ${c(o, 'tipoDeAuto')} gravado`); continue; }
    const teto = c(o, 'valorTeto');
    const esperado = teto != null ? Math.min(Number(a.valor) * 0.05, Number(teto)) : Number(a.valor) * 0.05;
    if (!perto(calculado, esperado)) div.push(`autos[${i}]: custas ${Number(calculado).toFixed(2)} (5% da avaliação${teto != null ? `, teto ${Number(teto).toFixed(2)}` : ''} = ${esperado.toFixed(2)})`);
    else feitos.push(`auto ${c(o, 'tipoDeAuto')} ${Number(calculado).toFixed(2)}`);
  }
  if (s.autos && autos.length !== s.autos.length) div.push(`${autos.length} auto(s) no cálculo (esperado ${s.autos.length})`);
  const arm = doCalculo('armazenamentos');
  usados.clear();
  for (const [i, a] of (s.armazenamentos || []).entries()) {
    const fim = a.fim ? isoData(a.fim) : null;
    const o = arm.find((x) => !usados.has(x) && msParaData(c(x, 'dataInicioArmazenamento')) === isoData(a.inicio)
      && msParaData(c(x, 'dataTerminoArmazenamento')) === fim && perto(c(x, 'valorAvaliacaoArmazenamento'), a.valor));
    if (!o) { div.push(`armazenamentos[${i}] ${isoData(a.inicio)} a ${fim || 'liquidação'} ${a.valor}: não encontrado`); continue; }
    usados.add(o);
    const calculado = c(o, 'valorCustasArmazenamento');
    if (calculado == null) { if (liquidado) div.push(`armazenamentos[${i}]: sem custas calculadas`); else feitos.push(`armazenamento ${isoData(a.inicio)} gravado`); continue; }
    const dias = diasCorridos(isoData(a.inicio), fim || liquidacao);
    const esperado = Number(a.valor) * 0.001 * dias;
    if (Number(c(o, 'qtdeDias')) !== dias || !perto(calculado, esperado)) div.push(`armazenamentos[${i}]: ${c(o, 'qtdeDias')} dia(s), custas ${Number(calculado).toFixed(2)} (esperado ${dias} dia(s) × 0,1% = ${esperado.toFixed(2)})`);
    else feitos.push(`armazenamento ${dias} dia(s) ${Number(calculado).toFixed(2)}`);
  }
  if (s.armazenamentos && arm.length !== s.armazenamentos.length) div.push(`${arm.length} armazenamento(s) no cálculo (esperado ${s.armazenamentos.length})`);
  return {
    item,
    estado: div.length ? 'falha' : feitos.length ? 'ok' : 'nao_verificado',
    detalhe: div.length ? div.slice(0, 10).join('; ') : feitos.join('; ') || 'nada calculado',
    dimensao: 'transferencia',
  };
}
