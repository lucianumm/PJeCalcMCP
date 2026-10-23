// pjecalc-mcp-skill · lib/recalculo.mjs
// Conferência independente das contas do PJe-Calc a partir do .PJC liquidado (exportado do aplicativo).
//
// Cada ocorrência exportada traz o índice de correção e a taxa de juros que o PJe-Calc usou; com eles toda a
// aritmética seguinte é refeita aqui, com as mesmas regras do aplicativo (decimal exato, HALF_EVEN, arredondamento
// linha a linha): verbas, juros sobre verbas, FGTS e multa, contribuição social (segurado, empresa, SAT,
// terceiros), imposto de renda (inclusive rendimentos acumulados), honorários e custas. Depois o resultado é
// comparado com os relatórios impressos pelo próprio PJe-Calc (Resumo, Demonstrativos de FGTS e IR, Apuração
// de Juros). Divergência acima de 1 centavo é falha, com o item e os dois valores.

import fs from 'node:fs';
import { campo, itens } from './pjc.mjs';
import { D, soma, sub, mul, dividir, pct, max0, min, r2, arred, corrigir, txt, num } from './decimal.mjs';

const c = (o, k) => (o ? campo(o, k) : null);
const it = (o, k) => (o ? itens(campo(o, k)).filter((x) => x && x.$classe) : []);
const sim = (v) => v === 'true' || v === true;
// contribuição progressiva do segurado empregado (a partir de 03/2020), pela tabela da competência: cada faixa
// conta de (inicial − 0,01) até o final, por isso a 1ª faixa (que começa em 0,00) rende um centavo a mais
let TABELA_INSS = null;
const tabelaInss = () => {
  if (TABELA_INSS === null) {
    try { TABELA_INSS = JSON.parse(fs.readFileSync(new URL('../modelos/tabela-inss-segurado.json', import.meta.url), 'utf-8')).competencias || {}; } catch { TABELA_INSS = {}; }
  }
  return TABELA_INSS;
};
export function contribuicaoProgressiva(t, v) {
  const fx = t.faixas.map(([ini, fim, aliq]) => ({ ini, fim, aliq }));
  if (v <= fx[0].fim) return v * fx[0].aliq / 100;
  if (v >= t.tetoBeneficio) return v * (t.tetoMaximo / (t.tetoBeneficio / 100)) / 100;
  for (let i = fx.length - 1; i >= 1; i--) {
    if (v < fx[i].ini) continue;
    let total = (v - (fx[i].ini - 0.01)) * fx[i].aliq / 100;
    for (let j = i - 1; j >= 0; j--) total += (fx[j].fim - (fx[j].ini - 0.01)) * fx[j].aliq / 100;
    return total;
  }
  return v * fx[0].aliq / 100;
}

const comp = (msv) => { if (msv == null) return '?'; const d = new Date(Number(msv) - 3 * 3600e3); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const UM_CENTAVO = D('0.01');
const igual = (a, b, tol = UM_CENTAVO) => a != null && b != null && (a - b <= tol && b - a <= tol);

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

const ALIQ_FGTS = { OITO_POR_CENTO: '8', DOIS_POR_CENTO: '2', ONZE_VIRGULA_DOIS_POR_CENTO: '11.2' };

/** Refaz as contas a partir da árvore de um .PJC liquidado. */
export function recalcularPjc(raiz) {
  const verif = [];
  const reg = (item, ok, detalhe, estadoSeNaoOk = 'falha') => verif.push({ item, estado: ok === null ? 'nao_verificado' : ok ? 'ok' : estadoSeNaoOk, detalhe, dimensao: 'aritmetica' });

  // ---------------- verbas: diferença corrigida (r2 por ocorrência) ----------------
  const verbas = [];
  const corrigidoPorComp = new Map(); // competência + data inicial -> Σ das que compõem o principal
  for (const v of todasAsVerbas(raiz)) {
    if (!sim(c(v, 'ativo'))) continue;
    const zera = sim(c(v, 'zeraValorNegativo'));
    let corr = 0n; let nominal = 0n; let n = 0;
    for (const o of it(v, 'ocorrencias')) {
      if (!sim(c(o, 'ativo'))) continue;
      let dif = sub(D(c(o, 'devido')), D(c(o, 'pago')));
      if (dif < 0n && zera) dif = 0n;
      const x = corrigir(D(c(o, 'indiceAcumulado')), dif);
      corr += x; nominal += dif; n++;
      if (c(v, 'comporPrincipal') !== 'NAO' && c(o, 'comporPrincipal') !== 'NAO') {
        const k = comp(c(o, 'dataInicial'));
        corrigidoPorComp.set(k, (corrigidoPorComp.get(k) || 0n) + x);
      }
    }
    verbas.push({ nome: String(c(v, 'nome')).trim(), classe: v.$classe, ocorrencias: n, nominal, corrigido: corr, comporPrincipal: c(v, 'comporPrincipal') !== 'NAO', irpf: sim(c(v, 'incidenciaIRPF')) });
  }

  // ---------------- juros sobre verbas (ApuracaoDeJuros) ----------------
  let jurosVerbas = 0n; const apurPorComp = new Map(); let nApur = 0;
  for (const a of it(raiz, 'apuracoesDeJuros')) {
    const capital = r2(sub(sub(sub(D(c(a, 'valorCorrigido')), D(c(a, 'contribuicaoSocialNormal'))), D(c(a, 'contribuicaoSocialDecimoTerceiro'))), D(c(a, 'previdenciaPrivada'))));
    jurosVerbas += r2(pct(capital, D(c(a, 'taxaDeJuros'))) ?? 0n);
    const k = comp(c(a, 'competencia'));
    apurPorComp.set(k, (apurPorComp.get(k) || 0n) + (D(c(a, 'valorCorrigido')) ?? 0n));
    nApur++;
  }
  if (nApur) {
    const div = [...new Set([...corrigidoPorComp.keys(), ...apurPorComp.keys()])].filter((k) => !igual(corrigidoPorComp.get(k) ?? 0n, apurPorComp.get(k) ?? 0n, D('0.02')));
    reg('juros: valor corrigido de cada competência = soma das verbas do principal', !div.length, div.length ? div.slice(0, 6).map((k) => `${k}: verbas ${txt(corrigidoPorComp.get(k) ?? 0n)} × apuração ${txt(apurPorComp.get(k) ?? 0n)}`).join('; ') : `${apurPorComp.size} competência(s) conferidas`);
  }

  // ---------------- FGTS e multa ----------------
  const fg = c(raiz, 'fgts');
  const fgts = { corrigido: 0n, juros: 0n, devido: 0n, multa: null };
  const ocF = it(fg, 'ocorrencias');
  let totalSemAvisoCorr = 0n; let totalComAvisoCorr = 0n; let totalDifSemAvisoCorr = 0n; let totalDifComAvisoCorr = 0n;
  for (const o of ocF) {
    const aliq = D(ALIQ_FGTS[c(o, 'aliquotaDoFgtsEnum')] ?? '8');
    const devido = pct(soma(D(c(o, 'baseHistorico')), D(c(o, 'baseVerba'))), aliq);
    const devidoSemAviso = pct(soma(D(c(o, 'baseHistorico')), D(c(o, 'baseVerbaSemAvisoPrevio'))), aliq);
    const dep = D(c(o, 'depositado')) ?? 0n;
    const dif = max0(sub(devido, dep));
    const idx = D(c(o, 'indiceAcumulado'));
    const corr = corrigir(idx, dif);
    fgts.corrigido += corr;
    fgts.juros += r2(pct(corr, D(c(o, 'taxaDeJuros'))) ?? 0n);
    fgts.devido += devido;
    totalComAvisoCorr += corrigir(idx, devido);
    totalSemAvisoCorr += corrigir(idx, devidoSemAviso);
    totalDifComAvisoCorr += corr;
    totalDifSemAvisoCorr += corrigir(idx, max0(sub(devidoSemAviso, dep)));
  }
  const indiceMulta = D(c(fg, 'indiceMulta'));
  if (fg && sim(c(fg, 'multa')) && ocF.length && indiceMulta) {
    const percentual = c(fg, 'multaDoFgts') === 'VINTE_POR_CENTO' ? D('20') : D('40');
    const semAviso = sim(c(fg, 'excluirAvisoDaMulta'));
    let base;
    const inc = c(fg, 'incidenciaDoFgts');
    if (c(fg, 'tipoDoValorDaMulta') === 'INFORMADA') base = null;
    else if (inc === 'SOBRE_DIFERENCA') base = r2(dividir(semAviso ? totalDifSemAvisoCorr : totalDifComAvisoCorr, indiceMulta));
    else if (inc === 'SOBRE_O_TOTAL_DEVIDO' || !inc) base = r2(dividir(semAviso ? totalSemAvisoCorr : totalComAvisoCorr, indiceMulta));
    else base = undefined; // saque/saldo: depende das operações de FGTS (não refeito aqui)
    if (base !== undefined) {
      const valor = base == null ? D(c(fg, 'valorInformadoDaMulta')) : pct(base, percentual);
      const corrigida = corrigir(indiceMulta, valor);
      fgts.multa = { base, valor, corrigida, juros: r2(pct(corrigida, D(c(fg, 'taxaDeJurosParaDataDemissao'))) ?? 0n) };
    }
  }

  // ---------------- contribuição social ----------------
  const inss = { segurado: { corrigido: 0n, juros: 0n, multa: 0n }, empresa: { corrigido: 0n, juros: 0n, multa: 0n }, sat: { corrigido: 0n, juros: 0n, multa: 0n }, terceiros: { corrigido: 0n, juros: 0n, multa: 0n }, descontoReclamante: 0n };
  const sd = c(c(raiz, 'inss'), 'inssSobreSalariosDevidos');
  const errosInss = []; let nInss = 0;
  // com juros e multa previdenciários (correção previdenciária / Lei 11.941), os juros são truncados (DOWN)
  const par = c(raiz, 'parametrosDeAtualizacao');
  const depois = (a, b) => a != null && b != null && Number(a) > Number(b);
  const jurosPrevidenciario = (dOc) => {
    const prev = sim(c(par, 'correcaoPrevidenciariaDosSalariosDevidosDoINSS'));
    const trab = sim(c(par, 'correcaoTrabalhistaDosSalariosDevidosDoINSS'));
    const l = sim(c(par, 'lei11941'));
    const lim = c(par, 'apartirDeLei11941'); const limTrab = c(par, 'aplicarAteDosSalariosDevidosDoINSS');
    return (prev && (!trab || (l && depois(dOc, lim) && depois(dOc, limTrab)))) || (l && depois(dOc, lim) && trab);
  };
  const tipoAliqSegurado = c(c(raiz, 'inss'), 'tipoAliquotaSegurado');
  let nFaixas = 0; const semTabela = new Set();
  for (const o of it(sd, 'ocorrencias')) {
    nInss++;
    const k = `${comp(c(o, 'dataOcorrenciaInss'))}${sim(c(o, 'ocorrenciaDecimoTerceiro')) ? ' (13º)' : ''}`;
    const bv = D(c(o, 'valorBaseVerbas')) ?? 0n;
    const devVerbas = pct(bv, D(c(o, 'aliquotaDoTotalSegurado')) ?? 0n);
    // a partir de 03/2020 (EC 103/2019) a alíquota é progressiva: o PJe-Calc aplica às verbas a razão exata
    // contribuição(salário + verbas) / (salário + verbas), e grava a alíquota só com 2 casas — a diferença
    // admitida é a desse arredondamento (0,005 ponto percentual sobre a base das verbas)
    const progressivo = Number(c(o, 'dataOcorrenciaInss')) >= Date.UTC(2020, 2, 1);
    const tolAliquota = progressivo ? (pct(bv, D('0.005')) > D('0.0001') ? pct(bv, D('0.005')) : D('0.0001')) : D('0.0001');
    const gravadoVerbas = D(c(o, 'valorDevidoSeguradoVerbas'));
    if (gravadoVerbas != null && !igual(devVerbas, gravadoVerbas, tolAliquota)) errosInss.push(`${k} segurado sobre as verbas ${txt(devVerbas, 4)} × ${txt(gravadoVerbas, 4)}`);
    // faixas progressivas recalculadas pela tabela da competência, sem usar a alíquota que o PJe-Calc gravou
    if (progressivo && (tipoAliqSegurado == null || tipoAliqSegurado === 'SEGURADO_EMPREGADO')) {
      const chave = new Date(Number(c(o, 'dataOcorrenciaInss'))).toISOString().slice(0, 7);
      const tab = tabelaInss()[chave];
      if (!tab) semTabela.add(chave);
      else {
        const base = Number(c(o, 'valorBase') || 0); const bvN = Number(c(o, 'valorBaseVerbas') || 0);
        const tetoN = c(o, 'valorTetoSegurado') != null ? Number(c(o, 'valorTetoSegurado')) : Infinity;
        const gTot = c(o, 'valorTotalInssSegurado');
        if (gTot != null && base > 0) {
          const esp = Math.min(contribuicaoProgressiva(tab, base), tetoN);
          if (Math.abs(esp - Number(gTot)) > 0.0001) errosInss.push(`${k} segurado sobre o salário pelas faixas ${esp.toFixed(4)} × ${Number(gTot).toFixed(4)}`); else nFaixas++;
        }
        const gV = c(o, 'valorDevidoSeguradoVerbas');
        if (gV != null && bvN > 0) {
          const esp = bvN * contribuicaoProgressiva(tab, base + bvN) / (base + bvN);
          if (Math.abs(esp - Number(gV)) > 0.0001) errosInss.push(`${k} segurado sobre as verbas pelas faixas ${esp.toFixed(4)} × ${Number(gV).toFixed(4)}`); else nFaixas++;
        }
      }
    }
    const teto = D(c(o, 'valorTetoSegurado'));
    const totalBase = D(c(o, 'valorTotalInssSegurado'));
    const devidoVerbas = gravadoVerbas ?? devVerbas;
    const finalEsperado = teto != null && totalBase != null ? min(devidoVerbas, max0(sub(teto, totalBase))) : devidoVerbas;
    const final = D(c(o, 'valorDevidoSeguradoFinal'));
    if (final != null && !igual(finalEsperado, final, D('0.0001'))) errosInss.push(`${k} segurado final (teto) ${txt(finalEsperado, 4)} × ${txt(final, 4)}`);
    const emp = pct(bv, D(c(o, 'aliquotaEmpresa')) ?? 0n);
    if (c(o, 'valorDevidoEmpresaVerbas') != null && !igual(emp, D(c(o, 'valorDevidoEmpresaVerbas')), D('0.0001'))) errosInss.push(`${k} empresa ${txt(emp, 4)} × ${txt(D(c(o, 'valorDevidoEmpresaVerbas')), 4)}`);
    const indice = mul(D(c(o, 'indiceDeCorrecaoTrabalhistaUtilizado')) ?? D('1'), D(c(o, 'indiceDeCorrecaoPrevidenciariaUtilizado')) ?? D('1'));
    const truncar = jurosPrevidenciario(c(o, 'dataOcorrenciaInss'));
    const acumular = (alvo, valor) => {
      if (valor == null) return;
      const corr = corrigir(indice, valor);
      alvo.corrigido += corr;
      // o valor corrigido é arredondado; juros e multa não: os juros só são truncados quando previdenciários,
      // a multa nunca (a soma é arredondada no total)
      const j = pct(corr, D(c(o, 'taxaDeJuros')));
      alvo.juros += (j == null ? 0n : truncar ? arred(j, 2, 'DOWN') : j);
      alvo.multa += pct(corr, D(c(o, 'taxaDeMulta'))) ?? 0n;
    };
    acumular(inss.segurado, final);
    acumular(inss.empresa, D(c(o, 'valorDevidoEmpresaFinal')));
    acumular(inss.sat, D(c(o, 'valorDevidoSAT')));
    acumular(inss.terceiros, D(c(o, 'valorDevidoTerceiros')));
    if (final != null) inss.descontoReclamante += r2(mul(final, D(c(o, 'indiceDeCorrecaoDoReclamante')) ?? D('1')));
  }
  if (nInss) reg('contribuição social: segurado (alíquota e teto), empresa por ocorrência', !errosInss.length, errosInss.length ? errosInss.slice(0, 6).join('; ') : `${nInss} ocorrência(s) conferidas${nFaixas ? `; ${nFaixas} contribuição(ões) progressiva(s) recalculada(s) pelas faixas da tabela` : ''}${semTabela.size ? `; sem tabela embarcada (só alíquota gravada): ${[...semTabela].sort().join(', ')}` : ''}`);
  const totalComp = (x) => x.corrigido + x.juros + x.multa;
  inss.totalReclamado = r2(totalComp(inss.segurado) + totalComp(inss.empresa) + totalComp(inss.sat) + totalComp(inss.terceiros));

  // ---------------- imposto de renda ----------------
  // com "cobrar do reclamado" o Resumo lança o IR como débito do reclamado, não como desconto do reclamante
  const irpf = { ocorrencias: [], devido: 0n, cobrarDoReclamado: sim(c(c(raiz, 'irpf'), 'cobrarDoReclamado')) };
  const errosIr = [];
  for (const o of it(c(raiz, 'irpf'), 'ocorrencias')) {
    const tipo = c(o, 'tipo');
    const ded = soma(...['valorContribuicaoSocial', 'valorPrevidenciaPrivada', 'valorPensaoAlimenticia', 'valorHonorarios', 'valorDependentes', 'valorAposentadoMaiorQue65'].map((k) => D(c(o, k))));
    const simpl = D(c(o, 'valorDescontoSimplificado')) ?? 0n;
    const semDed = soma(D(c(o, 'valorVerbas')), D(c(o, 'valorJuros')));
    const base = max0(sub(semDed, simpl > ded ? simpl : ded));
    if (c(o, 'valorBase') != null && !igual(base, D(c(o, 'valorBase')))) errosIr.push(`${tipo} base ${txt(base)} × ${txt(D(c(o, 'valorBase')))}`);
    const inicial = D(c(o, 'valorInicialFaixa'));
    const tetoIsencao = D(c(o, 'valorTetoFaixaIsencao'));
    const isento = (inicial != null && inicial === 0n) || (tetoIsencao != null && semDed <= tetoIsencao);
    let devido = 0n;
    if (!isento) {
      const tetoRed = D(c(o, 'valorTetoFaixaReducao')); const parcelaRed = D(c(o, 'valorParcelaFaixaReducao'));
      let reducao = 0n;
      if (tetoIsencao != null && tetoRed != null && parcelaRed != null && semDed > tetoIsencao && semDed < tetoRed) reducao = sub(parcelaRed, mul(dividir(parcelaRed, tetoRed), semDed));
      devido = max0(sub(sub(pct(base, D(c(o, 'valorAliquota')) ?? 0n), D(c(o, 'valorDeducao'))), reducao));
    }
    if (c(o, 'valorDevido') != null && !igual(devido, D(c(o, 'valorDevido')))) errosIr.push(`${tipo} devido ${txt(devido)} × ${txt(D(c(o, 'valorDevido')))}`);
    irpf.ocorrencias.push({ tipo, base, devido, meses: c(o, 'quantidadeCompetencias') });
    irpf.devido += r2(D(c(o, 'valorDevido')) ?? devido);
  }
  if (irpf.ocorrencias.length) reg('imposto de renda: base (deduções ou desconto simplificado), faixa, isenção e redução', !errosIr.length, errosIr.length ? errosIr.join('; ') : irpf.ocorrencias.map((x) => `${x.tipo}${x.meses ? ` (${x.meses} meses)` : ''}: base ${txt(x.base)}, devido ${txt(x.devido)}`).join('; '));

  // ---------------- honorários e custas ----------------
  const honorarios = [];
  const errosHon = [];
  for (const h of it(raiz, 'honorarios')) {
    const nome = c(h, 'nomeCredor');
    if (c(h, 'tipoValor') === 'CALCULADO') {
      const base = D(c(h, 'baseHonorario'));
      const esperado = pct(base, D(c(h, 'aliquota')));
      if (c(h, 'valor') != null && !igual(esperado, D(c(h, 'valor')))) errosHon.push(`${nome}: ${txt(base)} × ${c(h, 'aliquota')}% = ${txt(esperado)} × ${txt(D(c(h, 'valor')))}`);
      if (c(h, 'baseParaApuracao') === 'VERBAS_QUE_NAO_COMPOE_O_PRINCIPAL') {
        const sel = it(h, 'verbasSelecionadas').map((x) => c(x, 'verbaDeCalculo')).filter(Boolean);
        const somaSel = sel.reduce((a, ref) => { const vb = todasAsVerbas(raiz).find((v) => v.$classe === ref.$ref && String(c(v, 'id')) === String(ref.id)); const r = vb && verbas.find((x) => x.nome === String(c(vb, 'nome')).trim()); return a + (r ? r.corrigido : 0n); }, 0n);
        if (base != null && !igual(somaSel, base)) errosHon.push(`${nome}: base ${txt(base)} × soma das verbas escolhidas ${txt(somaSel)}`);
      }
    }
    // honorário informado: o valor da data de vencimento é corrigido até a liquidação (e recebe juros, se pedido);
    // o calculado já sai da base corrigida
    let valor = r2(D(c(h, 'valor')));
    if (c(h, 'tipoValor') === 'INFORMADO' && valor != null) {
      valor = r2(mul(D(c(h, 'valor')), D(c(h, 'indiceCorrecaoHonorario')) ?? D('1')));
      if (sim(c(h, 'aplicarJuros'))) valor += r2(pct(valor, D(c(h, 'taxaJurosHonorario')) ?? 0n));
    }
    honorarios.push({ credor: nome, devedor: c(h, 'tipoDeDevedor'), valor, irrf: r2(D(c(h, 'valorImpostoRenda')) ?? 0n), base: c(h, 'baseParaApuracao') });
  }
  if (honorarios.length) reg('honorários: base × percentual', !errosHon.length, errosHon.length ? errosHon.join('; ') : honorarios.map((x) => `${x.credor}: ${txt(x.valor)}`).join('; '));
  const cu = c(raiz, 'custasJudiciais');
  const custas = {};
  if (cu) {
    const base = D(c(cu, 'valorBaseCustasCalculadas'));
    const indice = (k) => D(c(cu, k)) ?? D('1');
    // o Resumo mostra as custas do reclamado = conhecimento + liquidação (+ custas fixas), cada uma corrigida
    let total = 0n; let somavel = true;
    const tipoConh = c(cu, 'tipoDeCustasDeConhecimentoDoReclamado');
    if (tipoConh === 'CALCULADA_2_POR_CENTO' && base != null) {
      let esperado = pct(base, D('2'));
      const piso = D(c(cu, 'pisoCustasConhecimentoReclamado'));
      if (piso != null && esperado !== 0n && esperado < piso) esperado = piso;
      custas.conhecimentoReclamado = esperado;
      reg('custas de conhecimento do reclamado: 2% da base (piso)', igual(esperado, D(c(cu, 'valorConhecimentoDoReclamado'))), `${txt(base)} × 2% = ${txt(esperado)} (gravado ${txt(D(c(cu, 'valorConhecimentoDoReclamado')))})`);
      total += r2(mul(esperado, indice('indiceCorrecaoCustasConhecimentoReclamado')));
    } else if (tipoConh === 'INFORMADA') total += r2(mul(D(c(cu, 'valorConhecimentoDoReclamado')) ?? 0n, indice('indiceCorrecaoCustasConhecimentoReclamado')));
    else if (tipoConh && tipoConh !== 'NAO_SE_APLICA') somavel = false;
    const tipoLiq = c(cu, 'tipoDeCustasDeLiquidacao');
    if (tipoLiq === 'CALCULADA_MEIO_POR_CENTO' && base != null) {
      let esperado = pct(base, D('0.5'));
      const teto = D(c(cu, 'tetoCustasLiquidacao'));
      if (teto != null && teto !== 0n && esperado > teto) esperado = teto;
      custas.liquidacao = esperado;
      reg('custas de liquidação: 0,5% da base (teto)', igual(esperado, D(c(cu, 'valorCustasDeLiquidacao'))), `${txt(base)} × 0,5% = ${txt(esperado)}${teto != null ? ` (teto ${txt(teto)})` : ''} (gravado ${txt(D(c(cu, 'valorCustasDeLiquidacao')))})`);
      total += r2(mul(esperado, indice('indiceCorrecaoCustasLiquidacao')));
    } else if (tipoLiq === 'INFORMADA') total += r2(mul(D(c(cu, 'valorCustasDeLiquidacao')) ?? 0n, indice('indiceCorrecaoCustasLiquidacao')));
    else if (tipoLiq && tipoLiq !== 'NAO_SE_APLICA') somavel = false;
    // custas fixas (quantidade × valor da tabela de custas, corrigidas desde o vencimento), autos (5% da avaliação até
    // o teto) e armazenamentos (0,1% da avaliação por dia), cada um corrigido pelo seu índice
    const pares = [['qtdeAtosUrbanos', 'valorAtosUrbanos'], ['qtdeAtosRurais', 'valorAtosRurais'], ['qtdeAgravosDeInstrumento', 'valorAgravoInstrumento'], ['qtdeAgravosDePeticao', 'valorAgravoPeticao'],
      ['qtdeImpugnacaoSentenca', 'valorImpuganacaoSentenca'], ['qtdeEmbargosArrematacao', 'valorEmbargosArrematacao'], ['qtdeEmbargosExecucao', 'valorEmbargosExecucao'], ['qtdeEmbargosTerceiros', 'valorEmbargosTerceiros'], ['qtdeRecursoRevista', 'valorRecursoRevista']];
    const comQtde = pares.filter(([q]) => Number(c(cu, q) || 0) > 0);
    if (comQtde.length) {
      if (comQtde.some(([, u]) => D(c(cu, u)) == null)) somavel = false;
      else {
        custas.fixas = comQtde.reduce((a, [q, u]) => a + mul(D(String(Number(c(cu, q)))), D(c(cu, u))), 0n);
        total += r2(mul(custas.fixas, indice('indiceCorrecaoCustasFixas')));
      }
    }
    const doCalculo = (k) => it(cu, k).filter((x) => c(x, 'origemRegistro') !== 'ATUALIZACAO');
    const errosCustas = [];
    for (const a of doCalculo('autosJudiciais')) {
      const v = D(c(a, 'valorCustasAuto'));
      if (v == null) { somavel = false; continue; }
      const teto = D(c(a, 'valorTeto'));
      const esperado = pct(D(c(a, 'valorAvaliacaoAuto')), D('5'));
      if (!igual(teto != null && esperado > teto ? teto : esperado, v)) errosCustas.push(`auto ${c(a, 'tipoDeAuto')}: 5% de ${txt(D(c(a, 'valorAvaliacaoAuto')))}${teto != null ? ` (teto ${txt(teto)})` : ''} × ${txt(v)}`);
      if (D(c(a, 'taxaJuros'))) somavel = false;
      total += r2(mul(v, D(c(a, 'indiceCorrecao')) ?? D('1')));
    }
    for (const a of doCalculo('armazenamentos')) {
      const v = D(c(a, 'valorCustasArmazenamento'));
      if (v == null) { somavel = false; continue; }
      const esperado = mul(pct(D(c(a, 'valorAvaliacaoArmazenamento')), D('0.1')), D(String(Number(c(a, 'qtdeDias') || 0))));
      if (!igual(esperado, v)) errosCustas.push(`armazenamento: 0,1% de ${txt(D(c(a, 'valorAvaliacaoArmazenamento')))} × ${c(a, 'qtdeDias')} dia(s) × ${txt(v)}`);
      if (D(c(a, 'taxaJuros'))) somavel = false;
      total += r2(mul(v, D(c(a, 'indiceCorrecao')) ?? D('1')));
    }
    if (doCalculo('autosJudiciais').length || doCalculo('armazenamentos').length) reg('custas de autos (5% até o teto) e de armazenamento (0,1% ao dia)', !errosCustas.length, errosCustas.length ? errosCustas.join('; ') : 'conferidas');
    // custas da execução e juros das custas: fora do recálculo
    const daExecucao = it(cu, 'custasFixasAtualizacao').length || ['autosJudiciais', 'armazenamentos'].some((k) => it(cu, k).some((x) => c(x, 'origemRegistro') === 'ATUALIZACAO'));
    const juros = ['taxaJurosCustasConhecimentoReclamado', 'taxaJurosCustasLiquidacao', 'taxaJurosCustasFixas'].some((k) => { const x = D(c(cu, k)); return x != null && x !== 0n; });
    if (daExecucao || juros) somavel = false;
    if (somavel && (custas.conhecimentoReclamado != null || custas.liquidacao != null || tipoConh === 'INFORMADA' || tipoLiq === 'INFORMADA' || custas.fixas != null)) custas.totalReclamado = total;
  }

  return { verbas, jurosVerbas, fgts, inss, irpf, honorarios, custas, verificacoes: verif };
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const numBr = (s) => { if (s == null) return null; const t = String(s).trim(); const neg = /^\(.*\)$/.test(t) || t.startsWith('-'); const v = t.replace(/[()\s-]/g, '').replace(/\./g, '').replace(',', '.'); return /^\d+(\.\d+)?$/.test(v) ? D(neg ? `-${v}` : v) : null; };
/** Primeiro "Total" seguido de valores no texto de um demonstrativo (a partir de `desde`). */
function totaisDoTexto(texto, rotulo = 'Total', desde = null) {
  const t = String(texto || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const ini = desde ? Math.max(0, t.findIndex((x) => x.includes(desde))) : 0;
  const out = [];
  for (let i = ini; i < t.length; i++) {
    if (t[i] !== rotulo) continue;
    const vals = [];
    for (let j = i + 1; j < t.length && vals.length < 4; j++) { const v = numBr(t[j]); if (v == null) break; vals.push(v); }
    if (vals.length) out.push(vals);
  }
  return out;
}

/**
 * Compara o recálculo com os relatórios do PJe-Calc. `resumo`: saída de extrairResumo (Resumo do Cálculo);
 * `textos`: { DEMONSTRATIVO_FGTS, APURACAO_DE_JUROS, DEMONSTRATIVO_IRPF } (texto dos relatórios, opcionais).
 */
export function compararComRelatorios(rec, { resumo = null, textos = {} } = {}) {
  const verif = [];
  const reg = (item, esperado, lido, tol = UM_CENTAVO) => {
    if (esperado == null || lido == null) { verif.push({ item, estado: 'nao_verificado', detalhe: `recalculado ${txt(esperado) ?? '—'}, relatório ${txt(lido) ?? '—'}`, dimensao: 'aritmetica' }); return; }
    verif.push({ item, estado: igual(esperado, lido, tol) ? 'ok' : 'falha', detalhe: `recalculado ${txt(esperado)}, relatório do PJe-Calc ${txt(lido)}`, dimensao: 'aritmetica' });
  };
  if (resumo && Array.isArray(resumo.verbas)) {
    const linhas = resumo.verbas.map((x) => ({ ...x, n: norm(x.descricao) }));
    const div = []; let ok = 0;
    for (const v of rec.verbas) {
      const l = linhas.find((x) => x.n === norm(v.nome));
      if (!l) continue;
      const lido = D(String(l.valorCorrigido));
      if (igual(v.corrigido, lido)) ok++; else div.push(`${v.nome}: recalculado ${txt(v.corrigido)}, resumo ${txt(lido)}`);
    }
    verif.push({ item: 'verbas: diferença corrigida de cada verba = Resumo do Cálculo', estado: div.length ? 'falha' : ok ? 'ok' : 'nao_verificado', detalhe: div.length ? div.slice(0, 8).join('; ') : `${ok} verba(s) iguais ao centavo`, dimensao: 'aritmetica' });
    const fgtsLinha = linhas.find((x) => /^FGTS\b/.test(x.n) && !/MULTA/.test(x.n));
    if (fgtsLinha && rec.fgts.corrigido) { reg('FGTS corrigido = Resumo', rec.fgts.corrigido, D(String(fgtsLinha.valorCorrigido))); reg('juros do FGTS = Resumo', rec.fgts.juros, D(String(fgtsLinha.juros))); }
    const multaLinha = linhas.find((x) => /^MULTA SOBRE FGTS/.test(x.n));
    if (multaLinha && rec.fgts.multa) { reg('multa do FGTS corrigida = Resumo', rec.fgts.multa.corrigida, D(String(multaLinha.valorCorrigido))); reg('juros da multa do FGTS = Resumo', rec.fgts.multa.juros, D(String(multaLinha.juros))); }
    // juros das verbas: soma dos juros das linhas de verbas do resumo
    const jurosLinhas = linhas.filter((x) => rec.verbas.some((v) => norm(v.nome) === x.n)).reduce((a, x) => a + (D(String(x.juros)) ?? 0n), 0n);
    if (rec.jurosVerbas) reg('juros sobre verbas (soma das linhas do Resumo)', rec.jurosVerbas, jurosLinhas, D('0.05'));
    const comp = (re) => { const x = (resumo.composicao || []).find((y) => re.test(norm(y.descricao))); return x ? D(String(Math.abs(x.valor))) : null; };
    if (rec.inss.descontoReclamante) reg('dedução de contribuição social do reclamante = Resumo', rec.inss.descontoReclamante, comp(/^DEDUCAO DE CONTRIBUICAO SOCIAL/));
    if (rec.inss.totalReclamado && resumo.contribuicaoSocialSalariosDevidos != null) reg('contribuição social sobre salários devidos (segurado, empresa, SAT, terceiros, com juros e multa) = Resumo', rec.inss.totalReclamado, D(String(resumo.contribuicaoSocialSalariosDevidos)));
    if (rec.irpf.ocorrencias.length) {
      if (rec.irpf.cobrarDoReclamado) reg('IRPF devido pelo reclamado (cobrado do reclamado) = Resumo', rec.irpf.devido, comp(/^IRPF DEVIDO PELO RECLAMADO/));
      else reg('IRPF devido pelo reclamante = Resumo', rec.irpf.devido, comp(/^IRPF DEVIDO PELO RECLAMANTE/));
    }
    if (rec.custas.totalReclamado != null && resumo.custasReclamado != null) reg('custas do reclamado (conhecimento, liquidação, fixas, autos e armazenamento) = Resumo', rec.custas.totalReclamado, D(String(resumo.custasReclamado)));
    for (const h of rec.honorarios) {
      const linha = (resumo.composicao || []).find((y) => norm(y.descricao).startsWith('HONORARIOS') && norm(y.descricao).includes(norm(h.credor)));
      if (linha) reg(`honorários líquidos (${h.credor}) = Resumo`, sub(h.valor, h.irrf), D(String(Math.abs(linha.valor))));
    }
  }
  if (textos.DEMONSTRATIVO_FGTS && rec.fgts.corrigido) {
    const t = totaisDoTexto(textos.DEMONSTRATIVO_FGTS);
    if (t.length) { reg('FGTS corrigido = Demonstrativo de FGTS', rec.fgts.corrigido, t[0][0]); if (t[0][1] != null) reg('juros do FGTS = Demonstrativo de FGTS', rec.fgts.juros, t[0][1]); }
  }
  if (textos.APURACAO_DE_JUROS && rec.jurosVerbas) {
    const t = totaisDoTexto(textos.APURACAO_DE_JUROS);
    if (t.length) reg('juros sobre verbas = Apuração de Juros', rec.jurosVerbas, t[t.length - 1][0]);
  }
  if (textos.DEMONSTRATIVO_IRPF && rec.irpf.ocorrencias.length) {
    const t = totaisDoTexto(textos.DEMONSTRATIVO_IRPF, 'Total Devido');
    if (t.length) reg('IRPF devido = Demonstrativo de IR', rec.irpf.devido, t[t.length - 1][0]);
  }
  return verif;
}

export { num as numeroDe, txt as textoDe };
