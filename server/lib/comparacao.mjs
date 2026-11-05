// pjecalc-mcp-skill · lib/comparacao.mjs
// Comparação de um cálculo com uma conta de referência (perito, parte, outro cenário), na mesma data-base.
// Começa pelas quantidades e pelos valores nominais de cada ocorrência — antes de correção e juros, que
// escondem erros — e só então monta as pontes:
//   - por verba: nominal (devido − pago) -> corrigido -> juros -> total, e a soma das diferenças por
//     verba precisa fechar com a diferença do bruto (o resíduo é mostrado; nunca é absorvido);
//   - do bruto ao líquido: verbas, FGTS, depósito em conta vinculada, INSS da parte, IR e líquido.
// Igualdade de totais não substitui igualdade das ocorrências; diferença sem causa localizada fica visível.

import { campo, itens } from './pjc.mjs';
import { verbasAtivas, chaveOcorrencia } from './auditoria.mjs';

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const num = (x) => (x == null || x === '' ? 0 : Number(x));
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const msIso = (ms) => (ms == null ? null : new Date(Number(ms) - 3 * 3600e3).toISOString().slice(0, 10));
const CAMPOS = ['quantidade', 'base', 'divisor', 'multiplicador', 'pago', 'devido'];

/**
 * Conta comparável a partir da árvore de um .PJC exportado (liquidado) e, se houver, do Resumo do
 * Cálculo já extraído (servico-calculo.extrairResumo).
 */
export function contaDoPjc(arvore, { resumo = null, origem = null } = {}) {
  const verbas = new Map();
  for (const v of verbasAtivas(arvore)) {
    const nome = String(campo(v, 'nome')).trim();
    let chave = semAcento(nome);
    for (let k = 2; verbas.has(chave); k++) chave = `${semAcento(nome)} #${k}`;
    const ocorrencias = new Map();
    for (const x of itens(campo(v, 'ocorrencias'))) {
      if (!x.$classe || campo(x, 'ativo') !== 'true') continue;
      const o = { competencia: chaveOcorrencia(x) };
      for (const c of CAMPOS) o[c] = num(campo(x, c));
      const ind = campo(x, 'indiceAcumulado');
      o.indice = ind == null || ind === '' ? null : Number(ind);
      const ja = ocorrencias.get(o.competencia);
      if (ja) { for (const c of ['quantidade', 'pago', 'devido']) ja[c] += o[c]; ja.duplicada = true; } else ocorrencias.set(o.competencia, o);
    }
    const ocs = [...ocorrencias.values()];
    const soma = (f) => r2(ocs.reduce((a, o) => a + f(o), 0));
    verbas.set(chave, {
      nome, tipo: v.$classe, ocorrencias,
      quantidade: Math.round(ocs.reduce((a, o) => a + o.quantidade, 0) * 1e4) / 1e4,
      devido: soma((o) => o.devido), pago: soma((o) => o.pago), nominal: soma((o) => o.devido - o.pago),
      corrigidoEstimado: ocs.every((o) => o.indice != null) ? soma((o) => (o.devido - o.pago) * o.indice) : null,
    });
  }
  return {
    origem,
    dataLiquidacao: msIso(campo(arvore, 'dataDeLiquidacao')) || (resumo && resumo.dataLiquidacao) || null,
    versao: campo(arvore, 'versaoDoSistema') || null,
    hashLiquidacao: campo(arvore, 'hashCodeLiquidacao') || null,
    verbas,
    resumo,
  };
}

/** Linhas do resumo somadas por descrição (o quadro repete rubricas como "DEPÓSITO FGTS"). */
function porDescricao(linhas, chave = 'valor') {
  const m = new Map();
  for (const l of linhas || []) {
    const k = semAcento(l.descricao);
    const ja = m.get(k);
    m.set(k, { descricao: ja ? ja.descricao : l.descricao, valor: r2((ja ? ja.valor : 0) + num(l[chave])) });
  }
  return m;
}

/** Causa local de uma diferença de ocorrência: o primeiro parâmetro que difere. */
function causaDaOcorrencia(a, b, tol) {
  if (!a) return 'ocorrência só na referência';
  if (!b) return 'ocorrência só no cálculo';
  for (const c of ['quantidade', 'base', 'divisor', 'multiplicador', 'pago']) if (Math.abs(a[c] - b[c]) > (c === 'quantidade' ? 0.0001 : tol)) return c;
  if (Math.abs(a.devido - b.devido) > tol) return 'devido com os mesmos parâmetros (fórmula, dobra ou arredondamento)';
  return null;
}

/**
 * Compara `calculo` com `referencia` (contas de contaDoPjc). Devolve as verificações, a diferença por
 * verba (quantidade, nominal, corrigido, total) com as causas localizadas por ocorrência e as pontes.
 */
export function compararContas(calculo, referencia, { tolerancia = 0.01, exemplos = 5 } = {}) {
  const verif = [];
  const reg = (item, estado, detalhe) => verif.push({ item, estado, detalhe, dimensao: 'comparacao' });
  const dA = calculo.dataLiquidacao; const dB = referencia.dataLiquidacao;
  reg('mesma data-base', !dA || !dB ? 'nao_verificado' : dA === dB ? 'ok' : 'falha', !dA || !dB ? `data de liquidação desconhecida (cálculo ${dA || '?'}, referência ${dB || '?'})` : dA === dB ? dA : `cálculo em ${dA}, referência em ${dB}: liquide os dois na mesma data antes de discutir diferenças`);

  // 1. quantidades e valores nominais, ocorrência por ocorrência (só quando os dois lados têm ocorrências)
  const soResumo = Boolean(calculo.soResumo || referencia.soResumo);
  const nomes = soResumo ? [] : [...new Set([...calculo.verbas.keys(), ...referencia.verbas.keys()])];
  const verbas = [];
  let ocorrenciasDivergentes = 0; let ocorrenciasComparadas = 0;
  for (const k of nomes) {
    const a = calculo.verbas.get(k); const b = referencia.verbas.get(k);
    const linha = { verba: (a || b).nome };
    if (!a || !b) {
      linha.somenteEm = a ? 'calculo' : 'referencia';
      linha.nominal = { calculo: a ? a.nominal : 0, referencia: b ? b.nominal : 0, diferenca: r2((b ? b.nominal : 0) - (a ? a.nominal : 0)) };
      linha.causas = { [`verba só no ${a ? 'cálculo' : 'na referência'}`]: (a || b).ocorrencias.size };
      verbas.push(linha);
      continue;
    }
    const comps = [...new Set([...a.ocorrencias.keys(), ...b.ocorrencias.keys()])].sort();
    const causas = {}; const amostra = [];
    for (const c of comps) {
      ocorrenciasComparadas++;
      const oa = a.ocorrencias.get(c); const ob = b.ocorrencias.get(c);
      const causa = causaDaOcorrencia(oa, ob, tolerancia);
      if (!causa) continue;
      ocorrenciasDivergentes++;
      causas[causa] = (causas[causa] || 0) + 1;
      if (amostra.length < exemplos) amostra.push({ competencia: c, causa, calculo: oa ? Object.fromEntries(CAMPOS.map((f) => [f, oa[f]])) : null, referencia: ob ? Object.fromEntries(CAMPOS.map((f) => [f, ob[f]])) : null });
    }
    linha.quantidade = { calculo: a.quantidade, referencia: b.quantidade, diferenca: Math.round((b.quantidade - a.quantidade) * 1e4) / 1e4 };
    linha.nominal = { calculo: a.nominal, referencia: b.nominal, diferenca: r2(b.nominal - a.nominal) };
    if (a.corrigidoEstimado != null && b.corrigidoEstimado != null) linha.corrigidoPorIndice = { calculo: a.corrigidoEstimado, referencia: b.corrigidoEstimado, diferenca: r2(b.corrigidoEstimado - a.corrigidoEstimado) };
    if (Object.keys(causas).length) { linha.causas = causas; linha.exemplos = amostra; }
    if (Math.abs(linha.nominal.diferenca) > tolerancia && !Object.keys(causas).length) linha.causas = { 'não localizada nas ocorrências': 1 };
    verbas.push(linha);
  }
  const soVerba = verbas.filter((v) => v.somenteEm);
  if (soResumo) {
    reg('ocorrências iguais (quantidade, base, divisor, multiplicador, pago, devido)', 'nao_verificado', 'a referência não traz ocorrências (relatório em PDF, texto ou transcrição): só o resumo foi comparado — peça o .PJC ou o demonstrativo por ocorrência para localizar as causas');
  } else {
    reg('mesmas verbas ativas', soVerba.length ? 'falha' : 'ok', soVerba.length ? soVerba.map((v) => `${v.verba} (só ${v.somenteEm === 'calculo' ? 'no cálculo' : 'na referência'})`).join('; ') : `${nomes.length} verbas nos dois`);
    reg('ocorrências iguais (quantidade, base, divisor, multiplicador, pago, devido)', ocorrenciasDivergentes ? 'falha' : ocorrenciasComparadas ? 'ok' : 'nao_verificado', ocorrenciasDivergentes ? `${ocorrenciasDivergentes} de ${ocorrenciasComparadas} ocorrência(s) diferentes — veja "verbas[].causas"` : `${ocorrenciasComparadas} ocorrência(s) iguais`);
  }

  // 2. ponte por verba no resumo: nominal -> corrigido -> juros -> total; soma das diferenças = diferença do bruto
  const pontes = {};
  const rA = calculo.resumo; const rB = referencia.resumo;
  if (rA && rB) {
    const linhas = (r) => new Map((r.verbas || []).map((x) => [semAcento(x.descricao), x]));
    const la = linhas(rA); const lb = linhas(rB);
    const porVerba = [];
    let somaDif = 0;
    for (const k of [...new Set([...la.keys(), ...lb.keys()])]) {
      const a = la.get(k); const b = lb.get(k);
      const nomA = calculo.verbas.get(k); const nomB = referencia.verbas.get(k);
      const lado = (x, nominal) => (x ? { nominal: nominal ? nominal.nominal : null, correcao: nominal ? r2(num(x.valorCorrigido) - nominal.nominal) : null, corrigido: num(x.valorCorrigido), juros: num(x.juros), total: num(x.total) } : null);
      const pa = lado(a, nomA); const pb = lado(b, nomB);
      const dif = r2((pb ? pb.total : 0) - (pa ? pa.total : 0));
      somaDif += dif;
      const efeito = !pa || !pb ? 'rubrica só num lado'
        : pa.nominal != null && pb.nominal != null && Math.abs(pb.nominal - pa.nominal) > tolerancia ? 'nominal (ocorrências)'
          : Math.abs(pb.corrigido - pa.corrigido) > tolerancia ? 'correção monetária'
            : Math.abs(pb.juros - pa.juros) > tolerancia ? 'juros' : null;
      porVerba.push({ verba: (a || b).descricao, calculo: pa, referencia: pb, diferencaTotal: dif, efeito });
    }
    const difBruto = r2(num(rB.brutoDevidoAoReclamante) - num(rA.brutoDevidoAoReclamante));
    const residuo = r2(somaDif - difBruto);
    pontes.porVerba = porVerba.filter((x) => Math.abs(x.diferencaTotal) > tolerancia || x.efeito);
    pontes.reconciliacao = { somaDasDiferencasPorVerba: r2(somaDif), diferencaDoBruto: difBruto, residuo };
    reg('ponte por verba fecha com o bruto', Math.abs(residuo) <= tolerancia ? 'ok' : 'falha', `Σ diferenças por verba ${r2(somaDif)} x diferença do bruto ${difBruto}: resíduo ${residuo}${Math.abs(residuo) > tolerancia ? ' — há rubrica fora do quadro ou leitura incompleta do resumo' : ''}`);

    // 3. ponte do bruto ao líquido (cada conta precisa fechar sozinha; depois as linhas são comparadas)
    for (const [nome, r] of [['cálculo', rA], ['referência', rB]]) {
      const fecha = r.brutoDevidoAoReclamante != null && r.totalDescontos != null && r.liquidoDevidoAoReclamante != null;
      const res = fecha ? r2(num(r.brutoDevidoAoReclamante) + num(r.totalDescontos) - num(r.liquidoDevidoAoReclamante)) : null;
      reg(`ponte bruto -> líquido (${nome})`, !fecha ? 'nao_verificado' : Math.abs(res) <= tolerancia ? 'ok' : 'falha', !fecha ? 'resumo sem bruto, descontos ou líquido' : `bruto ${r.brutoDevidoAoReclamante} + descontos ${r.totalDescontos} = líquido ${r.liquidoDevidoAoReclamante}${Math.abs(res) > tolerancia ? ` (resíduo ${res})` : ''}`);
    }
    const ca = porDescricao(rA.composicao); const cb = porDescricao(rB.composicao);
    pontes.brutoLiquido = [...new Set([...ca.keys(), ...cb.keys()])].map((k) => {
      const a = ca.get(k); const b = cb.get(k);
      return { item: (a || b).descricao, calculo: a ? a.valor : null, referencia: b ? b.valor : null, diferenca: r2((b ? b.valor : 0) - (a ? a.valor : 0)) };
    });
    const totais = [['bruto', 'brutoDevidoAoReclamante'], ['líquido', 'liquidoDevidoAoReclamante'], ['total devido pelo reclamado', 'totalDevidoPeloReclamado']];
    pontes.totais = totais.map(([item, k]) => ({ item, calculo: rA[k] ?? null, referencia: rB[k] ?? null, diferenca: r2(num(rB[k]) - num(rA[k])) }));
  } else {
    reg('ponte por verba fecha com o bruto', 'nao_verificado', `sem o Resumo do Cálculo de ${!rA && !rB ? 'nenhuma das contas' : !rA ? 'o cálculo' : 'a referência'} (só as ocorrências foram comparadas)`);
  }

  const semCausa = verbas.filter((v) => v.causas && v.causas['não localizada nas ocorrências']).map((v) => v.verba);
  if (semCausa.length) reg('diferenças sem causa localizada', 'alerta', `${semCausa.join(', ')}: o nominal difere, mas nenhuma ocorrência explica — confira ocorrências inativas, duplicadas ou fora do período`);
  verbas.sort((x, y) => Math.abs((y.nominal || {}).diferenca || 0) - Math.abs((x.nominal || {}).diferenca || 0));
  const totaisIguais = pontes.totais ? pontes.totais.every((t) => Math.abs(t.diferenca) <= tolerancia) : null;
  return {
    calculo: { origem: calculo.origem, dataLiquidacao: dA, versao: calculo.versao },
    referencia: { origem: referencia.origem, dataLiquidacao: dB, versao: referencia.versao },
    // iguais = nada diverge no que foi comparado; completa = tudo foi comparado (inclusive as pontes do resumo)
    iguais: !verif.some((v) => v.estado === 'falha' || v.estado === 'alerta'),
    comparacaoCompleta: !verif.some((v) => v.estado === 'nao_verificado'),
    totaisIguais,
    observacao: totaisIguais && ocorrenciasDivergentes ? 'os totais coincidem, mas as ocorrências não: as diferenças se compensam — não trate como conta igual' : undefined,
    verificacoes: verif,
    verbas: verbas.filter((v) => v.somenteEm || v.causas || Math.abs((v.nominal || {}).diferenca || 0) > tolerancia),
    pontes,
  };
}

/** Conta comparável só com o Resumo (referência sem ocorrências: relatório em PDF, texto ou transcrição). */
export function contaDoResumo(resumo, { origem = null, dataLiquidacao = null } = {}) {
  const dl = dataLiquidacao || (resumo && resumo.dataLiquidacao ? String(resumo.dataLiquidacao).split('/').reverse().join('-') : null);
  return { origem, dataLiquidacao: dl, versao: null, hashLiquidacao: null, verbas: new Map(), resumo, soResumo: true };
}

const NUMBR = /^\(?-?\d{1,3}(\.\d{3})*,\d{2}\)?$/;
const numBr = (t) => { const neg = /^\(.*\)$/.test(t) || t.startsWith('-'); const v = Number(t.replace(/[()\s-]/g, '').replace(/\./g, '').replace(',', '.')); return neg ? -v : v; };

/**
 * Resumo do Cálculo a partir do texto de um relatório do PJe-Calc em PDF (ou copiado do PDF): em cada linha
 * "DESCRIÇÃO n1 n2 n3" do quadro o total é o número que soma os outros dois; o corrigido é o maior dos outros
 * dois (ordem inferida, marcada). Também lê bruto, líquido, total de descontos e total devido pelo reclamado.
 */
export function resumoDoTextoDoRelatorio(texto) {
  const linhas = String(texto || '').split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const verbas = []; const composicao = [];
  const valorDoRotulo = (re) => {
    for (let i = 0; i < linhas.length; i++) {
      if (!re.test(linhas[i])) continue;
      const resto = linhas[i].replace(re, '').trim().split(' ').filter((x) => NUMBR.test(x));
      if (resto.length) return numBr(resto[resto.length - 1]);
      for (const j of [i + 1, i - 1]) if (linhas[j] && NUMBR.test(linhas[j])) return numBr(linhas[j]);
    }
    return null;
  };
  let noQuadro = false;
  for (const l of linhas) {
    if (/Descri[cç][aã]o do Bruto Devido/i.test(l)) { noQuadro = true; continue; }
    if (/Percentual de Parcelas|Descri[cç][aã]o de Cr[eé]ditos/i.test(l)) noQuadro = false;
    const partes = l.split(' ');
    const nums = [];
    while (partes.length && NUMBR.test(partes[partes.length - 1])) nums.unshift(numBr(partes.pop()));
    const desc = partes.join(' ').trim();
    if (noQuadro && nums.length === 3 && desc && !/^Total$/i.test(desc)) {
      const [a, b, c] = nums;
      let total; let outros;
      if (Math.abs(a + b - c) < 0.011) { total = c; outros = [a, b]; } else if (Math.abs(a + c - b) < 0.011) { total = b; outros = [a, c]; } else if (Math.abs(b + c - a) < 0.011) { total = a; outros = [b, c]; } else continue;
      verbas.push({ descricao: desc, valorCorrigido: Math.max(...outros), juros: Math.min(...outros), total, _ordemInferida: true });
    } else if (!noQuadro && nums.length === 1 && desc && desc.length > 3) composicao.push({ descricao: desc, valor: nums[0] });
  }
  const data = (String(texto).match(/Data Liquida[cç][aã]o:?\s*(\d{2}\/\d{2}\/\d{4})/) || String(texto).match(/(\d{2}\/\d{2}\/\d{4})\s*\n\s*Data Liquida[cç][aã]o/) || [])[1] || null;
  return {
    verbas, composicao,
    brutoDevidoAoReclamante: valorDoRotulo(/Bruto Devido ao Reclamante/i),
    liquidoDevidoAoReclamante: valorDoRotulo(/L[ií]quido Devido ao Reclamante/i),
    totalDevidoPeloReclamado: valorDoRotulo(/Total Devido pelo Reclamado/i),
    totalDescontos: valorDoRotulo(/Total de Descontos/i),
    dataLiquidacao: data,
  };
}
