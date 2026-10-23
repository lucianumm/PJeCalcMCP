// pjecalc-mcp-skill · lib/validacao.mjs
// As regras de "Pendências do Cálculo" do PJe-Calc 2.16, reproduzidas sobre a árvore do .PJC.
//
// Momento "especificacao": a árvore gerada pelo MCP, antes de importar (as ocorrências ainda não existem).
//   As regras que só dependem dos parâmetros rodam aqui e antecipam o que o aplicativo vai acusar
//   depois de regerar. Um erro aqui é um erro que impediria a liquidação.
// Momento "ocorrencias": o .PJC exportado do PJe-Calc (com as ocorrências geradas). Roda também as regras
//   sobre as ocorrências de verbas, FGTS e contribuição social.
//
// Cada achado: { regra, tipo: 'erro'|'alerta', tela, mensagem }. O texto é o mesmo do aplicativo.

import { campo, itens } from './pjc.mjs';

const c = (o, k) => (o ? campo(o, k) : null);
const it = (o, k) => (o ? itens(campo(o, k)).filter((x) => x && x.$classe) : []);
const sim = (v) => v === 'true' || v === true;
const ms = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
// datas do .PJC: meia-noite de Brasília (GMT-3) em milissegundos
const ym = (v) => { const n = ms(v); if (n == null) return null; const d = new Date(n - 3 * 3600e3); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const compareCompetence = (a, b) => { const x = ym(a); const y = ym(b); return x == null || y == null ? null : Math.sign(x - y); };
const somarAnos = (v, anos) => { const n = ms(v); if (n == null) return null; const d = new Date(n - 3 * 3600e3); d.setUTCFullYear(d.getUTCFullYear() + anos); return d.getTime() + 3 * 3600e3; };
const fmt = (v) => { const n = ms(v); if (n == null) return '?'; const d = new Date(n - 3 * 3600e3); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const TREZE_NOV_2014 = Date.UTC(2014, 10, 13) + 3 * 3600e3;
const TREZE_NOV_2019 = Date.UTC(2019, 10, 13) + 3 * 3600e3;
const TREZE_NOV_1989 = Date.UTC(1989, 10, 13) + 3 * 3600e3;

/** Calculo.getDataPrescricaoQuinquenal: ajuizamento − 5 anos. */
export const dataPrescricaoQuinquenal = (raiz) => somarAnos(c(raiz, 'dataAjuizamento'), -5);
/** Calculo.getDataPrescricaoFgts: 30 anos, ou 5 anos (STF ARE 709.212, modulado) conforme ajuizamento e admissão. */
export function dataPrescricaoFgts(raiz) {
  const aj = ms(c(raiz, 'dataAjuizamento'));
  const adm = ms(c(raiz, 'dataAdmissao'));
  if (aj == null) return null;
  let anos = -30;
  if (aj >= TREZE_NOV_2014 && aj < TREZE_NOV_2019 && adm != null && adm > TREZE_NOV_1989) anos = -5;
  else if (aj >= TREZE_NOV_2019) anos = -5;
  return somarAnos(aj, anos);
}

/** Todas as verbas do cálculo (a principal aparece dentro dos reflexos: desduplica por classe e id). */
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

// ordem e nomes das incidências como o aplicativo os lista na mensagem
const NOMES_INCIDENCIA = [['incidenciaINSS', 'INSS'], ['incidenciaIRPF', 'IRPF'], ['incidenciaFGTS', 'FGTS'], ['incidenciaPrevidenciaPrivada', 'Previdência Privada'], ['incidenciaPensaoAlimenticia', 'Pensão Alimentícia']];
const listarIncidencias = (nomes) => `${nomes.length === 1 ? 'Apurou-se incidência de ' : 'Foram apuradas incidências de '}${nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0]}`;

/**
 * Aplica as regras do PJe-Calc à árvore. `momento`: 'especificacao' (antes de importar) ou 'ocorrencias'
 * (cálculo exportado com ocorrências). Devolve a lista de achados.
 */
export function validarArvore(raiz, { momento = 'especificacao' } = {}) {
  const out = [];
  const add = (regra, tipo, tela, mensagem) => { if (!out.some((x) => x.regra === regra && x.mensagem === mensagem)) out.push({ regra, tipo, tela, mensagem }); };
  const posGeracao = momento === 'ocorrencias';
  const admissao = c(raiz, 'dataAdmissao');
  const demissao = c(raiz, 'dataDemissao');
  const ajuizamento = c(raiz, 'dataAjuizamento');
  const inicioCalc = c(raiz, 'dataInicioCalculo');
  const fimCalc = c(raiz, 'dataTerminoCalculo');
  const prescQ = sim(c(raiz, 'prescricaoQuinquenal'));
  const prescF = sim(c(raiz, 'prescricaoFgts'));
  const verbas = todasAsVerbas(raiz);
  const ativas = verbas.filter((v) => sim(c(v, 'ativo')));
  const historicos = it(raiz, 'historicosSalariais');
  const fgts = c(raiz, 'fgts');
  const inss = c(raiz, 'inss');
  const devidos = c(inss, 'inssSobreSalariosDevidos');
  const pagos = c(inss, 'inssSobreSalariosPagos');
  const irpf = c(raiz, 'irpf');
  const pensao = c(raiz, 'pensaoAlimenticia');
  const prev = c(raiz, 'previdenciaPrivada');
  const sf = c(raiz, 'salarioFamilia');
  const sd = c(raiz, 'seguroDesemprego');
  const par = c(raiz, 'parametrosDeAtualizacao');
  const ocVerba = (v) => it(v, 'ocorrencias').filter((o) => sim(c(o, 'ativo')));
  // nas regras "ocorrencias.empty == false": antes de importar, conta como se a regeração fosse gerar ocorrências
  const teraOcorrencias = (v) => (posGeracao ? it(v, 'ocorrencias').length > 0 : true);
  const formula = (v) => c(v, 'formula');
  const baseTab = (v) => { const f = formula(v); const b = c(f, 'baseTabelada'); return b && b.$classe ? c(b, 'tipo') : null; };
  const valorPago = (v) => c(formula(v), 'valorPago');
  const ehInformada = (v) => (formula(v) || {}).$classe === 'FormulaInformada';
  const incFgtsHist = historicos.some((h) => sim(c(h, 'incidenciaFGTS')) || it(h, 'ocorrencias').some((o) => sim(c(o, 'incidenciaFGTS'))));
  const incInssHist = historicos.some((h) => sim(c(h, 'incidenciaINSS')));
  const incFgtsVerba = ativas.some((v) => sim(c(v, 'incidenciaFGTS')));
  const incInssVerba = ativas.some((v) => sim(c(v, 'incidenciaINSS')));

  // ---------------- parâmetros do cálculo ----------------
  // MSG0082 / MSG0081: a tela recusa, ao salvar os parâmetros, prescrição que começaria na admissão ou depois dela
  if (admissao != null && ajuizamento != null) {
    if (prescQ && ms(dataPrescricaoQuinquenal(raiz)) <= ms(admissao)) add('MSG0082', 'erro', 'Dados do Cálculo', 'A prescrição quinquenal não pode ser aplicada, pois a data da admissão é igual ou posterior a data inicial do período prescricional.');
    if (prescF && ms(dataPrescricaoFgts(raiz)) <= ms(admissao)) add('MSG0081', 'erro', 'Dados do Cálculo', 'A prescrição do FGTS não pode ser aplicada, pois a data da admissão é igual ou posterior a data inicial do período prescricional.');
  }
  // RN05: IR com incidência marcada sem apurar
  if (ativas.length && ativas.some((v) => sim(c(v, 'incidenciaIRPF'))) && irpf && !sim(c(irpf, 'apurarImpostoRenda'))) add('RN05', 'alerta', 'Imposto de Renda', 'Existem verbas com o campo incidência em imposto de renda marcado apesar do campo apurar imposto de renda não estar selecionado na página correspondente.');
  // RN06 / RN07: maior e última remuneração
  const usa = (tipo, campoCalc) => c(raiz, campoCalc) == null && (
    ativas.some((v) => v.$classe === 'Calculada' && baseTab(v) === tipo)
    || (sf && sim(c(sf, 'apurarSalarioFamilia')) && c(sf, 'tipoSalarioPago') === tipo)
    || (sd && sim(c(sd, 'apurarSeguroDesemprego')) && c(sd, 'tipoSalarioPago') === tipo));
  if (usa('MAIOR_REMUNERACAO', 'valorMaiorRemuneracao') || (c(raiz, 'valorMaiorRemuneracao') == null && ativas.some((v) => { const vp = valorPago(v); return vp && c(vp, 'tipo') === 'CALCULADO' && c(vp, 'baseTabelada') === 'MAIOR_REMUNERACAO'; }))) {
    add('RN06', 'erro', 'Dados do Cálculo', 'Falta informar o valor da Maior Remuneração na página de parâmetros do cálculo.');
  }
  if (usa('ULTIMA_REMUNERACAO', 'valorUltimaRemuneracao')) add('RN07', 'erro', 'Dados do Cálculo', 'Falta informar o valor da última remuneração na página de parâmetros do cálculo.');
  // RN09 / RN10: salário-família
  if (sf && sim(c(sf, 'apurarSalarioFamilia'))) {
    if (demissao != null && compareCompetence(c(sf, 'dataFinal'), demissao) > 0) add('RN09', 'erro', 'Salário-família', 'A competência final do salário-família não pode ser posterior à data de demissão.');
    if (compareCompetence(c(sf, 'dataInicial'), admissao) < 0) add('RN10', 'erro', 'Salário-família', 'A competência inicial do salário-família não pode ser anterior à data de admissão.');
  }
  // RN12 / RN37: seguro-desemprego
  if (sd && sim(c(sd, 'apurarSeguroDesemprego'))) {
    if (demissao == null) add('RN12', 'erro', 'Dados do Cálculo', 'Não pode haver registro de seguro-desemprego sem registro de data de demissão.');
    else if (fimCalc != null && ms(fimCalc) < ms(demissao)) add('RN37', 'erro', 'Dados do Cálculo', 'Não é possível apurar o seguro-desemprego, pois a data de fim do cálculo é anterior à data de demissão.');
  }
  // RN16: faltas fora do contrato
  for (const f of it(raiz, 'faltas')) {
    if (ms(c(f, 'dataInicioPeriodoFalta')) < ms(admissao) || (demissao != null && ms(c(f, 'dataTerminoPeriodoFalta')) > ms(demissao))) {
      add('RN16', 'erro', 'Faltas', 'Não pode haver registros de faltas em data anterior à admissão e/ou posterior à demissão.');
    }
  }
  // RN17: histórico antes da admissão
  if (historicos.some((h) => it(h, 'ocorrencias').some((o) => compareCompetence(c(o, 'dataOcorrencia'), admissao) < 0))) add('RN17', 'alerta', 'Histórico Salarial', 'Existe registro de base em competência anterior à admissão.');
  // RN18 / RN25 / RN26: previdência privada
  if (prev && sim(c(prev, 'apurarPrevidenciaPrivada'))) {
    if (it(prev, 'aliquotas').some((a) => compareCompetence(c(a, 'dataInicioPeriodo'), admissao) < 0)) add('RN18', 'erro', 'Previdência Privada', 'A competência inicial da previdência privada não pode ser anterior à data de admissão.');
    if (!ativas.some((v) => sim(c(v, 'incidenciaPrevidenciaPrivada')))) add('RN26', 'erro', 'Verbas', 'Para apurar Previdência Privada, marque a incidência correspondente em pelo menos uma das verbas registradas no cálculo.');
  } else if (prev && ativas.some((v) => sim(c(v, 'incidenciaPrevidenciaPrivada')))) {
    add('RN25', 'alerta', 'Previdência Privada', 'Existem verbas com o campo incidência em previdência privada marcado apesar do campo apurar previdência privada não estar selecionado na página correspondente.');
  }
  // RN22 / RN23 / RN24: pensão alimentícia
  if (pensao) {
    const apurarPensao = sim(c(pensao, 'apurarPensaoAlimenticia'));
    const incPensaoVerba = ativas.some((v) => sim(c(v, 'incidenciaPensaoAlimenticia')));
    if (!apurarPensao && incPensaoVerba) add('RN22', 'alerta', 'Pensão Alimentícia', 'Existem verbas com o campo incidência em pensão alimentícia marcado, apesar do campo apurar pensão alimentícia não estar.');
    if (!apurarPensao && fgts && sim(c(fgts, 'incidenciaPensaoAlimenticia'))) add('RN23', 'alerta', 'Pensão Alimentícia', 'Apesar do campo pensão alimentícia sobre o FGTS estar marcado, a parcela pensão alimentícia não está selecionada para apuração.');
    if (apurarPensao && !incPensaoVerba && !(fgts && sim(c(fgts, 'incidenciaPensaoAlimenticia')))) add('RN24', 'erro', 'Verbas', 'Para apurar Pensão Alimentícia, marque a incidência correspondente em pelo menos uma das verbas registradas no cálculo e/ou a incidência no FGTS.');
  }
  // RN49: juros da Fazenda Pública a partir de data anterior ao ajuizamento
  if (par && c(par, 'apertirDe') != null && ajuizamento != null && ms(c(par, 'apertirDe')) <= ms(ajuizamento)) add('RN49', 'erro', 'Correção, Juros e Multa', 'A data a partir da qual o sistema deve utilizar Juros Fazenda Pública deve ser posterior à Data de Ajuizamento do Cálculo.');
  // RN71: base de juros abatendo INSS que não é cobrado do reclamante
  if (par && devidos && demissao != null && ativas.length && c(par, 'baseDeJurosDasVerbas') && c(par, 'baseDeJurosDasVerbas') !== 'VERBAS'
    && (!sim(c(devidos, 'apurarInssSegurado')) || !sim(c(devidos, 'cobrarInssDoReclamante')))
    && ativas.some((v) => sim(c(v, 'incidenciaINSS')) && teraOcorrencias(v))) {
    add('RN71', 'erro', 'Correção, Juros e Multa', 'A contribuição segurado só pode ser abatida da base dos juros sobre verbas se for devida pelo reclamante. Escolha outra Base de Juros sobre Verbas na aba Dados Específicos ou marque o checkbox Cobrar do Reclamante na página Contribuição Social.');
  }
  // RN72: FGTS por JAM + trabalhista sem demissão
  if (demissao == null && par && c(par, 'indiceDeCorrecaoDoFGTS') === 'UTILIZAR_INDICE_JAM_E_TRABALHISTA') add('RN72', 'erro', 'Correção, Juros e Multa', 'No cálculo não há registro da data de demissão, desta forma, o índice JAM / Trabalhista não poderá ser utilizado para corrigir o FGTS.');
  // RN80: multa sobre o valor da causa sem o valor da causa
  const proc = c(raiz, 'processo');
  if ((!proc || c(proc, 'valorDaCausa') == null) && it(raiz, 'multas').some((m) => c(m, 'tipoBaseMulta') === 'VALOR_CAUSA')) add('RN80', 'alerta', 'Dados do Cálculo', 'Há multa cuja base é o valor da causa, mas este não está preenchido.');
  // RN73 (antecipada): doméstico com FGTS antes de 10/2015
  if (inss && c(inss, 'tipoAliquotaSegurado') === 'EMPREGADO_DOMESTICO') {
    const iniFgts = posGeracao ? it(fgts, 'ocorrencias').map((o) => c(o, 'ocorrencia')) : [c(fgts, 'periodoInicial')];
    if ((incFgtsHist || incFgtsVerba) && iniFgts.some((d) => d != null && ms(d) < Date.UTC(2015, 9, 1) + 3 * 3600e3)) add('RN73', 'alerta', 'FGTS', 'Existem ocorrências de FGTS anteriores à 01/10/2015, apesar do Reclamante ter sido identificado como Empregado Doméstico na tela de Contribuição Social.');
  }

  // ---------------- verbas (parâmetros) ----------------
  for (const v of ativas) {
    const nome = c(v, 'nome');
    const f = formula(v);
    // RN19: zerar valor negativo diferente do padrão do cálculo
    if (String(c(v, 'zeraValorNegativo')) !== String(c(raiz, 'zeraValorNegativo'))) add('RN19', 'alerta', 'Verbas', `O padrão para o campo Zerar Valor Negativo, estabelecido na página parâmetros de cálculo, diverge da marcação realizada nos parâmetros da verba ${nome}.`);
    // RN28: verba no desligamento sem demissão
    if (demissao == null && c(v, 'ocorrenciaDePagamento') === 'DESLIGAMENTO') add('RN28', 'erro', 'Dados do Cálculo', 'Não pode haver registro de verba com ocorrência no desligamento sem registro de data de demissão.');
    // RN51-53: base sem a tabela escolhida
    if (f && f.$classe === 'FormulaCalculada') {
      const bt = baseTab(v);
      if (bt === 'HISTORICO_SALARIAL' && !it(v, 'historicosDaVerbaDoValorDevido').length) add('RN51', 'erro', 'Verbas', `Falta selecionar pelo menos um Histórico Salarial para apurar o Valor Devido da Verba ${nome}.`);
      if (bt === 'VALE_TRANSPORTE' && !it(v, 'valesTransportesDoValorDevido').length) add('RN52', 'erro', 'Verbas', `Falta selecionar pelo menos um Vale Transporte para apurar o Valor Devido da Verba ${nome}.`);
      if (bt === 'SALARIO_DA_CATEGORIA' && c(v, 'salarioCategoriaValorDevido') == null) add('RN53', 'erro', 'Verbas', `Falta selecionar pelo menos um Piso Salarial para apurar o Valor Devido da Verba ${nome}.`);
    }
    // RN67-69: valor pago calculado sem a tabela escolhida
    const vp = valorPago(v);
    if (vp && c(vp, 'tipo') === 'CALCULADO') {
      const b = c(vp, 'baseTabelada');
      if (b === 'HISTORICO_SALARIAL' && !it(v, 'historicosDaVerbaDoValorPago').length) add('RN67', 'erro', 'Verbas', `Falta selecionar pelo menos um Histórico Salarial para apurar o Valor Pago da Verba ${nome}.`);
      if (b === 'VALE_TRANSPORTE' && !it(v, 'valesTransportesDoValorPago').length) add('RN68', 'erro', 'Verbas', `Falta selecionar pelo menos um Vale Transporte para apurar o Valor Pago da Verba ${nome}.`);
      if (b === 'SALARIO_DA_CATEGORIA' && c(v, 'salarioCategoriaValorPago') == null) add('RN69', 'erro', 'Verbas', `Falta selecionar pelo menos um Piso Salarial para apurar o Valor Pago da Verba ${nome}.`);
    }
    // RN56: incidências sobre verba que não compõe o principal
    if (c(v, 'comporPrincipal') === 'NAO') {
      const inc = NOMES_INCIDENCIA.filter(([k]) => sim(c(v, k))).map(([, n]) => n);
      if (inc.length) add('RN56', 'alerta', 'Verbas', `${listarIncidencias(inc)} sobre a verba ${nome}, apesar desta verba não compor o principal.`);
    }
    // RN78 / RN79: quantidade ou divisor do cartão sem cartão (antes de importar, os vínculos de colunas
    // apuradas são feitos depois: só vale para o arquivo exportado)
    if (posGeracao && teraOcorrencias(v) && f && f.$classe !== 'FormulaInformada') {
      const q = c(f, 'quantidade'); const d = c(f, 'divisor');
      if (q && c(q, 'tipo') === 'IMPORTADA_DO_CARTAO' && !it(v, 'cartoesDePontoDaVerbaQuantidade').length) add('RN78', 'erro', 'Verbas', `A quantidade da verba ${nome} deve ser importada do cartão de ponto, mas não há cartão de ponto selecionado.`);
      if (d && c(d, 'tipo') === 'IMPORTADA_DO_CARTAO' && !it(v, 'cartoesDePontoDaVerbaDivisor').length) add('RN79', 'erro', 'Verbas', `O divisor da verba ${nome} deve ser importado do cartão de ponto, mas não há cartão de ponto selecionado.`);
    }
    // RN70: reflexo pela média da quantidade com a principal informada
    if (v.$classe === 'Informada') {
      for (const r of verbas.filter((x) => x.$classe === 'Reflexo' && sim(c(x, 'ativo')) && c(x, 'comportamentoDoReflexo') === 'MEDIA_PELA_QUANTIDADE')) {
        const bv = c(c(r, 'formula'), 'baseVerba');
        const principais = it(bv, 'itens').map((x) => c(x, 'verbaDeCalculo')).filter(Boolean);
        if (principais.some((p) => p.$ref === v.$classe && String(p.id) === String(c(v, 'id')))) add('RN70', 'erro', 'Verbas', `A verba reflexa ${c(r, 'nome')} não pode ser apurada pela média da quantidade, visto que os valores devidos da verba principal ${nome} foram informados.`);
      }
    }
  }

  if (!posGeracao) return out;

  // ---------------- ocorrências (cálculo exportado) ----------------
  const dPrescQ = dataPrescricaoQuinquenal(raiz);
  for (const v of ativas) {
    const nome = c(v, 'nome');
    const ocs = ocVerba(v);
    if (!it(v, 'ocorrencias').length) continue;
    const pa = c(v, 'ocorrenciaDePagamento') === 'PERIODO_AQUISITIVO';
    // RN29: ocorrência depois da demissão sem data final do cálculo
    if (demissao != null && ocs.some((o) => ms(c(o, 'dataFinal')) > ms(demissao) && (fimCalc == null || ms(fimCalc) < ms(c(o, 'dataFinal'))))) {
      add('RN29', 'erro', 'Verbas', 'As ocorrências das verbas não podem ultrapassar a data da demissão, sem que haja registro de Data Final, na aba Parâmetros do Cálculo, igual ou posterior a Data Final da última ocorrência das verbas.');
    }
    // RN30 / RN58: antes da admissão ou da prescrição quinquenal
    const limite = prescQ && dPrescQ > ms(admissao) ? dPrescQ : ms(admissao);
    if (ocs.some((o) => ms(c(o, 'dataInicial')) < limite)) add(pa ? 'RN58' : 'RN30', 'erro', 'Verbas', `Não pode haver registro de ocorrência na verba ${nome} em data anterior a maior data entre a admissão e/ou a prescrição quinquenal.`);
    // RN45 / RN57: ocorrências fora do período da verba
    if (demissao != null) {
      const pi = ms(c(v, 'periodoInicial')); const pf = ms(c(v, 'periodoFinal'));
      const fora = pa ? ocs.some((o) => ms(c(o, 'dataFinal')) < pi || ms(c(o, 'dataFinal')) > pf) : ocs.some((o) => ms(c(o, 'dataInicial')) < pi || ms(c(o, 'dataFinal')) > pf);
      if (fora) add(pa ? 'RN57' : 'RN45', 'erro', 'Verbas', `Todas as ocorrências da verba ${nome} devem estar contidas no período estabelecido na página parâmetro da verba.`);
    }
    // RN38 / RN40: característica ou ocorrência de pagamento alteradas depois da geração
    if (ocs.some((o) => c(o, 'caracteristica') && c(o, 'caracteristica') !== c(v, 'caracteristica'))) add('RN38', 'erro', 'Verbas', `O parâmetro Característica foi alterado na página Verbas, após a geração das ocorrências da verba ${nome}.`);
    if (ocs.some((o) => c(o, 'ocorrenciaDePagamento') && c(o, 'ocorrenciaDePagamento') !== c(v, 'ocorrenciaDePagamento'))) add('RN40', 'erro', 'Verbas', `O parâmetro Ocorrência de Pagamento foi alterado na página Verbas, após a geração das ocorrências da verba ${nome}.`);
    // RN43: verba informada sem nenhum valor
    if (ehInformada(v) && !ocs.some((o) => c(o, 'devido') != null && c(o, 'pago') != null && (Number(c(o, 'devido')) > 0 || Number(c(o, 'pago')) > 0))) add('RN43', 'erro', 'Verbas', `Para apurar a verba informada ${nome} deve existir pelo menos uma ocorrência com valor devido ou valor pago diferente de zero.`);
    // RN50: quantidade sempre zero
    if (v.$classe === 'Calculada' && !ocs.some((o) => Number(c(o, 'quantidade') || 0) !== 0)) add('RN50', 'alerta', 'Verbas', `Todas as ocorrências da verba ${nome} foram salvas com quantidade igual a zero.`);
    // RN77: ocorrências desativadas por divisor zero
    if (v.$classe === 'Calculada' && it(v, 'ocorrencias').some((o) => !sim(c(o, 'ativo')) && c(o, 'divisor') != null && Number(c(o, 'divisor')) === 0)) add('RN77', 'alerta', 'Verbas', `Devido aos parâmetros da verba ${nome}, algumas ocorrências foram geradas com divisor zero. Como tais ocorrências não podem ser liquidadas, elas foram desativadas.`);
    // RN39: verba de período aquisitivo com todas as ocorrências na demissão e incidências marcadas
    if (pa && NOMES_INCIDENCIA.some(([k]) => sim(c(v, k))) && ocs.length && !ocs.some((o) => ms(c(o, 'dataFinal')) !== ms(demissao))) add('RN39', 'alerta', 'Verbas', `As incidências marcadas nas verbas com ocorrência de pagamento período aquisitivo não serão apuradas, uma vez que todas as ocorrências da verba ${nome} foram geradas na data da demissão.`);
  }
  // FGTS
  const ocFgts = it(fgts, 'ocorrencias');
  if (ocFgts.length && (incFgtsHist || incFgtsVerba)) {
    if (admissao != null && ocFgts.some((o) => compareCompetence(c(o, 'ocorrencia'), admissao) < 0)) add('RN13', 'erro', 'FGTS', 'A competência inicial do FGTS não pode ser anterior à data da admissão. Regere as ocorrências do FGTS.');
    if (demissao != null && ocFgts.some((o) => compareCompetence(c(o, 'ocorrencia'), demissao) > 0)) add('RN14', 'erro', 'FGTS', 'A competência final do FGTS não pode ser posterior à data da demissão. Regere as ocorrências do FGTS.');
    const dpf = dataPrescricaoFgts(raiz);
    if (prescF && dpf != null && ocFgts.some((o) => compareCompetence(c(o, 'ocorrencia'), dpf) < 0)) add('RN15', 'erro', 'FGTS', 'A competência inicial do FGTS não pode ser anterior à data de prescrição do FGTS. Regere as ocorrências do FGTS ou desmarque a prescrição do FGTS.');
    if (prescF && dpf != null && ms(dpf) > ms(admissao) && !ocFgts.some((o) => compareCompetence(c(o, 'ocorrencia'), dpf) === 0)) add('RN54', 'erro', 'FGTS', 'As ocorrências do FGTS iniciam em data posterior à prescrição do FGTS. Regere as ocorrências do FGTS ou desmarque a prescrição do FGTS.');
    if (demissao == null && fimCalc != null && ocFgts.some((o) => compareCompetence(c(o, 'ocorrencia'), fimCalc) > 0)) add('RN76', 'erro', 'FGTS', 'A Competência final do FGTS não pode ser posterior à data final do cálculo. Regere as ocorrências do FGTS.');
    // RN62: FGTS não começa na admissão ou não termina na demissão
    const terminaNaDemissao = demissao == null || ocFgts.some((o) => compareCompetence(c(o, 'ocorrencia'), demissao) === 0);
    const comecaNaAdmissao = admissao == null || ocFgts.some((o) => compareCompetence(c(o, 'ocorrencia'), admissao) === 0);
    if (!terminaNaDemissao || !comecaNaAdmissao) add('RN62', 'alerta', 'FGTS', 'As ocorrências do FGTS iniciam em data diferente da Data Inicial e/ou terminam em data diferente da Data Final da limitação do Cálculo.');
  }
  // contribuição social
  const ocDev = it(devidos, 'ocorrencias');
  const ocPag = it(pagos, 'ocorrencias');
  if (incInssHist || incInssVerba) {
    if (demissao != null && (fimCalc == null || ms(demissao) >= ms(fimCalc)) && ocDev.some((o) => compareCompetence(c(o, 'dataOcorrenciaInss'), demissao) > 0)) add('RN20', 'erro', 'Contribuição Social', 'Competência final da contribuição social sobre salários devidos não pode ser posterior à data de demissão. Regere as ocorrências da Contribuição Social.');
    if ([...ocDev, ...ocPag].some((o) => compareCompetence(c(o, 'dataOcorrenciaInss'), admissao) < 0)) add('RN21', 'erro', 'Contribuição Social', 'A competência inicial da contribuição social não pode ser anterior à data de admissão. Regere as ocorrências da Contribuição Social.');
    if (fimCalc != null && (demissao == null || ms(fimCalc) > ms(demissao)) && ocDev.some((o) => compareCompetence(c(o, 'dataOcorrenciaInss'), c(devidos, 'dataTerminoPeriodo')) > 0)) add('RN74', 'erro', 'Contribuição Social', 'Competência final da contribuição social sobre salários devidos não pode ser posterior à data final do período de incidência. Regere as ocorrências da Contribuição Social.');
    if (demissao != null && ocPag.some((o) => compareCompetence(c(o, 'dataOcorrenciaInss'), demissao) > 0)) add('RN75', 'erro', 'Contribuição Social', 'Competência final da contribuição social sobre salários pagos não pode ser posterior à data de demissão. Regere as ocorrências da Contribuição Social.');
  }
  // RN01-RN04: histórico sem valor em alguma competência usada
  const temComp = (h, d) => it(h, 'ocorrencias').some((o) => compareCompetence(c(o, 'dataOcorrencia'), d) === 0);
  for (const h of historicos) {
    const nomeH = c(h, 'nome');
    if (sim(c(h, 'incidenciaFGTS')) && ocFgts.length && ocFgts.some((o) => !temComp(h, c(o, 'ocorrencia')))) add('RN01', 'alerta', 'Histórico Salarial', `O Histórico Salarial ${nomeH} não possui valor cadastrado para todas as ocorrências do FGTS.`);
    if (sim(c(h, 'incidenciaINSS')) && ocDev.length && ocDev.some((o) => !temComp(h, c(o, 'dataOcorrenciaInss')))) add('RN02', 'alerta', 'Histórico Salarial', `O Histórico Salarial ${nomeH} não possui valor cadastrado para todas as ocorrências da Contribuição Social sobre Salários Devidos.`);
    if (sim(c(h, 'incidenciaINSS')) && ocPag.length && ocPag.some((o) => !temComp(h, c(o, 'dataOcorrenciaInss')))) add('RN03', 'alerta', 'Histórico Salarial', ` O Histórico Salarial ${nomeH} não possui valor cadastrado para todas as ocorrências da Contribuição Social sobre Salários Pagos.`);
  }
  for (const v of ativas) {
    for (const vh of it(v, 'historicosDaVerbaDoValorDevido')) {
      const ref = c(vh, 'historicoSalarial');
      const h = historicos.find((x) => ref && String(c(x, 'id')) === String(ref.id));
      if (h && ocVerba(v).some((o) => !temComp(h, c(o, 'dataInicial')))) add('RN04', 'alerta', 'Histórico Salarial', `O Histórico Salarial ${c(h, 'nome')} não possui valor cadastrado para todas as ocorrências da verba ${c(v, 'nome')}.`);
    }
  }
  return out;
}

/** Converte os achados em verificações da auditoria (erro do aplicativo = falha; alerta = alerta). */
export function verificacoesDaValidacao(achados, { momento = 'especificacao' } = {}) {
  const erros = achados.filter((x) => x.tipo === 'erro');
  const alertas = achados.filter((x) => x.tipo === 'alerta');
  return [{
    item: `regras de validação do PJe-Calc (${momento === 'ocorrencias' ? 'sobre o cálculo exportado' : 'antes de importar'})`,
    estado: erros.length ? 'falha' : alertas.length ? 'alerta' : 'ok',
    detalhe: erros.length || alertas.length
      ? [...erros, ...alertas].slice(0, 12).map((x) => `${x.regra} ${x.tipo} [${x.tela}] ${x.mensagem}`).join(' | ')
      : 'nenhuma regra do PJe-Calc acusa erro ou alerta',
    dimensao: 'transferencia',
  }];
}

export { fmt as formatarData };
