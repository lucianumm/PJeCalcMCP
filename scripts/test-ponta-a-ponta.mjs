// pjecalc-mcp-skill · scripts/test-ponta-a-ponta.mjs
// Teste COMPLETO com o PJe-Calc 2.16.0: para cada exemplo, gera o cálculo pelo MCP (calculo_criar:
// gerar .PJC, importar, passos pós-importação, regerar, pendências, exportar o "-PRONTO.PJC"),
// liquida em 30/06/2016 e compara os totais com o gabarito do MESMO cálculo montado à mão na interface.
// Inicia o PJe-Calc se estiver parado. Ao final exclui os cálculos de teste (--manter para manter).
//
// Uso (na pasta pjecalc-mcp-skill):
//   node scripts/test-ponta-a-ponta.mjs                 -> caso "referencia"
//   node scripts/test-ponta-a-ponta.mjs todos           -> todos os casos
//   node scripts/test-ponta-a-ponta.mjs completo cartao-ponto [--manter] [--sem-atualizar-tabelas]
// Atenção: o teste troca as tabelas regionais do PJe-Calc (TRT8 para os gabaritos; TRT18 no caso "recente").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conectar, verificar } from './cliente-mcp.mjs';
import { lerPjc, objetos } from '../server/lib/pjc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exemplo = (arq) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', arq), 'utf-8'));

// campos simples (texto, número, data, enum) do primeiro objeto da classe, sem identificadores nem textos informativos
// e os que o PJe-Calc só preenche ao liquidar (índices, taxas e datas de apuração)
const IGNORAR_CAMPOS = new Set(['id', 'versao', 'informacaoUltimoIndice', 'informacaoUltimoIndiceAtualizacao', 'indiceMulta', 'indiceAcumulado', 'indiceAcumuladoDaMulta',
  'taxaDeJuros', 'taxaDeJurosParaDataDemissao', 'dataInicioAnosAnteriores', 'dataFimAnosAnteriores', 'dataInicioAnoRecebimento', 'dataFimAnoRecebimento']);
function camposDe(arquivo, classe) {
  const { arvore } = lerPjc(fs.readFileSync(arquivo));
  for (const o of objetos(arvore)) {
    if (o.$classe !== classe) continue;
    return Object.fromEntries(o.campos.filter(([n, v]) => !IGNORAR_CAMPOS.has(n) && (v === null || typeof v !== 'object')));
  }
  return null;
}
const NUMERO = /^-?\d+(\.\d+)?$/;
// elemento vazio e ausente são o mesmo valor para o PJe-Calc (ex.: hora de início da escala que a tela limpou)
const mesmoValor = (a, b) => String(a ?? '') === String(b ?? '') || (NUMERO.test(String(a)) && NUMERO.test(String(b)) && Number(a) === Number(b));
function diferencasDeCampos(mcp, tela, classes) {
  const dif = [];
  for (const classe of classes) {
    const a = camposDe(mcp, classe); const b = camposDe(tela, classe);
    if (!a || !b) { dif.push(`${classe}: ausente no ${a ? 'gabarito' : 'cálculo do MCP'}`); continue; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!mesmoValor(a[k], b[k])) dif.push(`${classe}.${k}: MCP ${a[k]} × tela ${b[k]}`);
  }
  return dif;
}

// Gabaritos: o MESMO cálculo montado à mão na interface do PJe-Calc, exportado em exemplos/gabaritos-tela/.
// O teste importa esse arquivo, regera e liquida em 30/06/2016 com as MESMAS tabelas e compara com o
// cálculo gerado pelo MCP. Os valores fixos abaixo são os obtidos com as tabelas originais da instalação
// (2016, TRT8); com tabelas atualizadas eles mudam (ex.: feriados regionais, seguro-desemprego), e o
// que tem de continuar igual é MCP x tela.
const CASOS = {
  referencia: { arquivo: 'calculo-referencia.json', gabarito: 'A', tela: 'A-referencia.PJC', bruto: 31320.10, liquido: 23113.54, total: 40330.83, regeracao: [6, 4] },
  completo: { arquivo: 'calculo-completo.json', gabarito: 'C', tela: 'C-completo.PJC', bruto: 44107.03, liquido: 35869.97, total: 58523.05 },
  'inss-periodos': { arquivo: 'calculo-inss-periodos.json', gabarito: 'D', tela: 'D-inss-periodos.PJC', bruto: 31320.10, liquido: 23113.54, total: 39330.55 },
  'cartao-ponto': { arquivo: 'calculo-cartao-ponto.json', gabarito: 'E', tela: 'E-cartao-ponto.PJC', bruto: 42279.38, liquido: 32470.98, total: 55677.81, cartao: ['Hs Trabalhadas', 'Hs EXT', 'Dias Trabalhados'] },
  'cartao-ponto-escala': { arquivo: 'calculo-cartao-ponto-escala.json', gabarito: 'F', tela: 'F-cartao-ponto-escala.PJC', bruto: 44969.30, liquido: 35189.38, total: 59732.53, cartao: ['Hs Trabalhadas', 'Hs Noturnas', 'Hs EXT', 'Dias Trabalhados'] },
  // mesmo caso A com contrato de dados: tem de chegar a "auditado" e sobreviver a exportar/reimportar
  auditavel: { arquivo: 'calculo-auditavel.json', gabarito: 'A + contrato de dados', tela: 'A-referencia.PJC', bruto: 31320.10, liquido: 23113.54, total: 40330.83, estado: 'auditado', reimportar: true },
  diversos: { arquivo: 'calculo-diversos.json', gabarito: 'G', tela: 'G-diversos.PJC', bruto: 37753.53, liquido: 28473.07, total: 48420.97 },
  // caso A com ocorrências de FGTS e de contribuição social (células, lotes e 13º), salários pagos e custas fixas,
  // auto e armazenamento; gabarito H: os mesmos ajustes feitos à mão nas telas sobre a mesma base
  'ocorrencias-custas': { arquivo: 'calculo-ocorrencias-custas.json', gabarito: 'H', tela: 'H-ocorrencias-custas.PJC', bruto: 30799.67, liquido: 23057.73, total: 84496.28, exigir: [/ocorrências de FGTS e de contribuição social do cálculo liquidado/, /custas fixas, autos e armazenamentos no cálculo liquidado/] },
  // caso A com a aba Dados Específicos de Correção, Juros e Multa alterada na tela (gabarito I): base de juros,
  // FGTS pelo JAM, juros das custas e atualização da contribuição social (sem Lei 11.941, trabalhista até 12/2015,
  // multa previdenciária rural reduzida)
  'dados-especificos': { arquivo: 'calculo-dados-especificos.json', gabarito: 'I', tela: 'I-dados-especificos.PJC', bruto: 31017.28, liquido: 23124.33, total: 40756.54, entidades: ['ParametrosDeAtualizacao'] },
  // caso A com FGTS (pagar, sem compor o principal, multa de 20% menos o saque, art. 467, LC 110), correção do desconto
  // de contribuição social e IR (juros na base, tributação exclusiva, maior de 65 anos, 2 dependentes): gabarito J
  'fgts-cs-ir': { arquivo: 'calculo-fgts-cs-ir.json', gabarito: 'J', tela: 'J-fgts-cs-ir.PJC', bruto: 24276.43, liquido: 22888.50, total: 32356.74, entidades: ['Fgts', 'Inss', 'InssSobreSalariosDevidos', 'Irpf'] },
  // caso A com alíquota fixa do segurado (9%, limitada ao teto) e terceiros, multa do FGTS informada e IR em separado,
  // no regime de caixa e cobrado do reclamado (gabarito K)
  'aliquota-fixa-ir-caixa': { arquivo: 'calculo-aliquota-fixa-ir-caixa.json', gabarito: 'K', tela: 'K-aliquota-fixa-ir-caixa.PJC', bruto: 30371.65, liquido: 23249.07, total: 42849.01, entidades: ['Fgts', 'Inss', 'Irpf'] },
  // caso E com Súmula 85, tolerância, intervalos intra (acima de 6 h) e interjornadas e domingos trabalhados (gabarito L)
  'cartao-sumula85': { arquivo: 'calculo-cartao-sumula85.json', gabarito: 'L', tela: 'L-cartao-sumula85.PJC', bruto: 41899.08, liquido: 32148.82, total: 55146.29, cartao: ['Hs Trabalhadas', 'Hs EXT', 'Dias Trabalhados'], entidades: ['ApuracaoCartaoDePonto'] },
  // caso E com jornada semanal, sábado e domingo separados, horas noturnas rurais com prorrogação (Súmula 60) e art. 253 (gabarito M)
  'cartao-semanal-noturno': { arquivo: 'calculo-cartao-semanal-noturno.json', gabarito: 'M', tela: 'M-cartao-semanal-noturno.PJC', bruto: 26516.42, liquido: 19017.64, total: 33601.65, cartao: ['Hs Trabalhadas', 'Hs Noturnas', 'Hs EXT', 'Hs Insalubres', 'Dias Trabalhados'], entidades: ['ApuracaoCartaoDePonto'] },
  // caso A com verbas do Expresso lançadas e parametrizadas na tela: periculosidade, adicional noturno, horas extras 100%
  // com 4 reflexos (13º pela média do valor), intervalo intrajornada e dano moral (gabarito O)
  'verbas-expresso-valores': { arquivo: 'calculo-verbas-expresso-valores.json', gabarito: 'O', tela: 'O-verbas-expresso-valores.PJC', bruto: 213763.13, liquido: 201604.76, total: 259777.34 },
  // caso A com carga de 180 h, sábado não útil, sem projeção do aviso, sem feriados estaduais e municipais, zerar negativos,
  // INPC com IPCA a partir de 2015 e juros de 1% a.m. com SELIC a partir de 2016 (gabarito P)
  'indices-juros-parametros': { arquivo: 'calculo-indices-juros-parametros.json', gabarito: 'P', tela: 'P-indices-juros-parametros.PJC', bruto: 39525.25, liquido: 29801.72, total: 50896.48, entidades: ['ParametrosDeAtualizacao'] },
  // caso E com escala 12x12 a partir das 07:00 e horas extras pelo critério mais favorável (gabarito Q)
  'cartao-escala-12x12': { arquivo: 'calculo-cartao-escala-12x12.json', gabarito: 'Q', tela: 'Q-cartao-escala-12x12.PJC', bruto: 111247.19, liquido: 93147.22, total: 151303.74, cartao: ['Hs Trabalhadas', 'Hs EXT', 'Dias Trabalhados'], entidades: ['ApuracaoCartaoDePonto', 'PreenchimentoJornadaApuracaoCartao'] },
  // caso E com escala 12x24 a partir das 06:00 e a primeira hora extra em separado, que paga as horas extras 50% (gabarito R)
  'cartao-escala-12x24': { arquivo: 'calculo-cartao-escala-12x24.json', gabarito: 'R', tela: 'R-cartao-escala-12x24.PJC', bruto: 29759.19, liquido: 21782.27, total: 38143.80, cartao:['Hs Trabalhadas', 'Hs EXT', 'Primeiras Hs Ext em Separado', 'Dias Trabalhados'], entidades: ['ApuracaoCartaoDePonto', 'PreenchimentoJornadaApuracaoCartao'] },
  // caso E com escala 6x1, horas extras pela jornada mensal e fechamento do cartão no dia 20, com exceção (dia 25) de 01/2014
  // a 06/2014 (gabarito S)
  'cartao-escala-6x1-fechamento': { arquivo: 'calculo-cartao-escala-6x1-fechamento.json', gabarito: 'S', tela: 'S-cartao-escala-6x1-fechamento.PJC', bruto: 33765.18, liquido: 25189.94, total: 43784.89, cartao: ['Hs Trabalhadas', 'Hs EXT', 'Dias Trabalhados'], entidades: ['ApuracaoCartaoDePonto', 'PreenchimentoJornadaApuracaoCartao', 'ExcecaoDoFechamentoDeCartaoDePonto'] },
  // caso E com escala 8x2 (os 2 últimos dias do ciclo são folga) e horas extras excedentes da jornada diária (gabarito T)
  'cartao-escala-8x2': { arquivo: 'calculo-cartao-escala-8x2.json', gabarito: 'T', tela: 'T-cartao-escala-8x2.PJC', bruto: 51022.97, liquido: 39993.74, total: 67899.05, cartao: ['Hs Trabalhadas', 'Hs EXT', 'Dias Trabalhados'], entidades: ['ApuracaoCartaoDePonto', 'PreenchimentoJornadaApuracaoCartao'] },
  // caso A com TR, IGP-M a partir de 2014, IPCA-E/TR a partir de 2015 e Tabela JT mensal a partir de 2016; juros da poupança,
  // da Fazenda Pública a partir de 2014 e taxa legal a partir de 30/08/2024, liquidado em 2026 (gabarito U)
  'indices-juros-tr-poupanca': { arquivo: 'calculo-indices-juros-tr-poupanca.json', gabarito: 'U', tela: 'U-indices-juros-tr-poupanca.PJC', bruto: 49923.61, liquido: 37529.68, total: 65769.53, liquidarEm: '30/09/2026', entidades: ['ParametrosDeAtualizacao', 'CombinacaoDeIndice', 'CombinacaoDeJuros'] },
  // caso A em tempo parcial (férias de 18 dias), aviso prévio informado de 45 dias, férias 2013/2014 com abono de 6 dias e
  // gozo em dobro, 2014/2015 indenizadas em dobro e insalubridade de 20% sobre o salário mínimo (gabarito V)
  'parcial-aviso-ferias-minimo': { arquivo: 'calculo-parcial-aviso-ferias-minimo.json', gabarito: 'V', tela: 'V-parcial-aviso-ferias-minimo.PJC', bruto: 37930.07, liquido: 28783.12, total: 49232.65, entidades: ['Ferias'] },
  // caso A em regime de trabalho intermitente (gabarito W)
  intermitente: { arquivo: 'calculo-intermitente.json', gabarito: 'W', tela: 'W-intermitente.PJC', bruto: 31320.10, liquido: 23113.54, total: 40330.83, entidades: ['Ferias'] },
  // valores mês a mês nas ocorrências, alíquota do FGTS de uma competência (a tela não edita), valor pago em reflexo
  // e honorários sobre verba escolhida (tabelas TRT8 de 2016)
  'mes-a-mes': { arquivo: 'calculo-mes-a-mes.json', gabarito: 'MCP (conferências internas)', bruto: 29404.36, liquido: 21359.02, total: 38305.71, exigir: [/valores mês a mês nas ocorrências do cálculo liquidado/, /ocorrências de FGTS e de contribuição social do cálculo liquidado/, /FGTS corrigido = Demonstrativo de FGTS/, /honorários: base × percentual/] },
  // execução: pagamentos e eventos sobre o cálculo liquidado do fixture, atualização até 31/08/2016
  execucao: { tipo: 'execucao', arquivo: 'execucao-pagamentos.json', gabarito: 'atualização montada e conferida na tela', pjc: 'scripts/fixtures/calculo-liquidado-referencia.PJC', liquido: 13704.89, total: 29384.25 },
  // pensão alimentícia e custas da execução (por ato, auto, armazenamento) e um pagamento que recolhe a pensão;
  // gabarito: o mesmo conjunto lançado à mão nas telas de Pagamento sobre uma cópia do mesmo cálculo
  'execucao-pensao-custas': { tipo: 'execucao', arquivo: 'execucao-pensao-custas.json', gabarito: 'pensão e custas lançadas à mão na tela', pjc: 'scripts/fixtures/calculo-liquidado-referencia.PJC', liquido: 11649.75, total: 38698.67, pensao: 6704.74, custas: 3714.50, eventos: 5 },
  // honorários periciais da execução com IRRF e IR sobre juros, custas por ato ainda sem teste e dois pagamentos que recolhem
  // contribuição social e IR do reclamante e pagam custas, contribuição social patronal e honorários como outros débitos
  // do reclamado (gabarito X: o mesmo conjunto lançado à mão nas telas de Pagamento sobre uma cópia do mesmo cálculo)
  'execucao-recolhimentos': { tipo: 'execucao', arquivo: 'execucao-recolhimentos-honorarios.json', gabarito: 'X, lançado à mão na tela', pjc: 'scripts/fixtures/calculo-liquidado-referencia.PJC', liquido: 10873.35, total: 25026.51 },
  // Cálculo Externo (conta homologada fora do PJe-Calc) com um pagamento, atualizado até 31/08/2016
  externo: { tipo: 'externo', arquivo: 'calculo-externo.json', gabarito: 'externo montado na tela', liquido: 10790.92, total: 22090.75 },
  // Cálculo Externo com as parcelas menos comuns (CS até e após fev/2009 com multa, CS sobre salários pagos, previdência
  // privada e juros, pensão com base própria, CS de 10% e 0,5%, custas do reclamante, de liquidação e de execução, multa a
  // terceiro e débitos do reclamante) e um pagamento (gabarito Y: o mesmo conjunto lançado à mão nas telas)
  'externo-parcelas': { tipo: 'externo', arquivo: 'calculo-externo-parcelas.json', gabarito: 'Y, montado na tela', liquido: 3240.35, total: 13847.67, pensao: 1113.26, custas: 252.48, eventos: 1 },
  // caso atual (2023-2024, TRT18) liquidado numa data recente: exige tabelas atualizadas
  // (tabelas_atualizar). Sem gabarito fixo: os índices mudam a cada atualização das tabelas.
  recente: { arquivo: 'calculo-recente-trt18.json', gabarito: 'sem gabarito (tabelas atualizadas)', liquidarEm: '30/09/2026', atualizarTabelas: true },
};

const pedidos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const nomes = pedidos.includes('todos') ? Object.keys(CASOS) : (pedidos.length ? pedidos : ['referencia']);
for (const n of nomes) if (!CASOS[n]) { console.error(`Caso desconhecido: ${n}. Casos: ${Object.keys(CASOS).join(', ')}, todos`); process.exit(2); }

const c = await conectar();
const criados = [];
let falhas = 0;
try {
  for (const nome of nomes) {
    const caso = CASOS[nome];
    console.log(`\n=== caso "${nome}" (gabarito ${caso.gabarito}, exemplos/${caso.arquivo}) ===`);
    try {
      if (caso.tipo === 'execucao' || caso.tipo === 'externo') {
        const r = caso.tipo === 'execucao'
          ? await c.ferramenta('calculo_atualizar', { arquivo_pjc: path.resolve(__dirname, '..', caso.pjc), execucao: exemplo(caso.arquivo), destino: path.resolve(__dirname, '..', 'saida') })
          : await c.ferramenta('calculo_externo_criar', { calculoExterno: exemplo(caso.arquivo) });
        const at = caso.tipo === 'execucao' ? r : r.execucao;
        criados.push(r.idCalculo); if (caso.tipo === 'externo' && at) criados.push(at.idCalculo);
        verificar(Number.isInteger(r.idCalculo), `${caso.tipo === 'execucao' ? 'cópia do cálculo com os pagamentos importada' : 'Cálculo Externo criado pela interface'} (número ${r.idCalculo})`);
        const ruins = (r.verificacoes || []).filter((x) => x.estado !== 'ok');
        verificar(r.estado === 'calculado' && !ruins.length, `estado "${r.estado}" (${(r.verificacoes || []).length} verificações${ruins.length ? `: ${ruins.map((x) => `${x.item}: ${x.detalhe}`).join(' | ')}` : ''})`);
        verificar(Math.abs(at.resultado.liquidoDevidoAoReclamante - caso.liquido) < 0.005 && Math.abs(at.resultado.totalDevidoPeloReclamado - caso.total) < 0.005, `atualização até ${at.resultado.atualizadoAte}: líquido ${at.resultado.liquidoDevidoAoReclamante}, total ${at.resultado.totalDevidoPeloReclamado} (gabarito ${caso.liquido} / ${caso.total}); eventos: ${at.resultado.eventos.join('; ') || 'nenhum'}`);
        if (caso.pensao != null || caso.custas != null) {
          verificar(Math.abs(at.resultado.pensaoAlimenticia - caso.pensao) < 0.005 && Math.abs(at.resultado.custasReclamado - caso.custas) < 0.005 && at.resultado.eventos.length === caso.eventos, `pensão ${at.resultado.pensaoAlimenticia} e custas ${at.resultado.custasReclamado} (gabarito ${caso.pensao} / ${caso.custas}), ${at.resultado.eventos.length} eventos no Resumo`);
        }
        continue;
      }
      const liquidarEm = caso.liquidarEm || '30/06/2016';
      // atualizar_tabelas: se as tabelas carregadas forem de outro TRT (o processo diz qual), o PJe-Calc baixa as certas
      const r = await c.ferramenta('calculo_criar', { especificacao: exemplo(caso.arquivo), liquidar_em: liquidarEm, atualizar_tabelas: !process.argv.includes('--sem-atualizar-tabelas') });
      if (r.criado === false) throw new Error(`especificação recusada: ${r.erros.join(' | ')}`);
      criados.push(r.idCalculo);
      verificar(Number.isInteger(r.idCalculo), `cálculo importado com o número ${r.idCalculo} (${path.basename(r.arquivo)})`);
      if (caso.regeracao) verificar(r.regeracao.principais === caso.regeracao[0] && r.regeracao.reflexos === caso.regeracao[1], `ocorrências regeradas: ${caso.regeracao[0]} verbas + ${caso.regeracao[1]} reflexos`);
      if (caso.cartao) {
        const cols = (r.cartaoDePonto && r.cartaoDePonto.colunas) || [];
        verificar(caso.cartao.every((x) => cols.includes(x)), `cartão de ponto apurado: ${cols.join(', ')} (${r.cartaoDePonto.linhas.length} meses); vínculos: ${(r.vinculosCartao || []).join('; ')}`);
      }
      verificar(r.pendencias.totalErros === 0, `sem pendências impeditivas (${r.pendencias.totalAlertas} alerta(s))`);
      verificar(r.arquivoPronto && fs.existsSync(r.arquivoPronto), `arquivo final exportado: ${path.basename(r.arquivoPronto || '')}`);
      verificar(r.tabelas && r.tabelas.atualizadas === true, `tabelas de índices cobrem ${liquidarEm}${r.tabelas && r.tabelas.atualizacao ? ' (atualizadas agora)' : ''}`);
      verificar(r.liquidacaoDeTeste && r.liquidacaoDeTeste.liquidado, `liquidado em ${liquidarEm}${r.liquidacaoDeTeste && r.liquidacaoDeTeste.motivo ? `: ${r.liquidacaoDeTeste.motivo}` : ''}`);
      const t = r.resultado;
      verificar(t.conferencia && t.conferencia.somaConfere === true && t.conferencia.brutoIgualAoQuadro === true, `resumo conferido: soma das ${t.verbas.length} rubricas = ${t.conferencia.somaRubricas} = total do quadro = bruto`);
      verificar(Array.isArray(r.justificativa) && r.justificativa.length >= 3, `justificativa do PJe-Calc lida (${(r.justificativa || []).length} critérios)`);
      const falhas = (r.verificacoes || []).filter((v) => v.estado === 'falha' || v.estado === 'nao_verificado');
      verificar(r.estado === (caso.estado || 'calculado') && !falhas.length, `estado "${r.estado}"${falhas.length ? ` — ${falhas.map((v) => `${v.item}: ${v.detalhe}`).join(' | ')}` : ''} (${(r.verificacoes || []).length} verificações, ${(r.verificacoes || []).filter((v) => v.estado === 'alerta').length} alerta(s))`);
      verificar(r.registro && fs.existsSync(r.registro), `registro de reprodução: ${path.basename(r.registro || '')}`);
      // relatório completo em PDF ao lado do liquidado, só com as seções que se aplicam (cartão quando há cartão)
      const rc = r.relatorioCompleto || {};
      const pdfOk = rc.arquivo && fs.existsSync(rc.arquivo) && fs.readFileSync(rc.arquivo).subarray(0, 5).toString('latin1') === '%PDF-';
      const espCartao = exemplo(caso.arquivo); const temCartao = Boolean((espCartao.cartoesDePonto && espCartao.cartoesDePonto.length) || espCartao.apuracaoCartaoPonto);
      verificar(pdfOk && rc.secoes.includes('DEMONSTRATIVO_DE_CALCULO') && rc.secoes.includes('CARTAO_MENSAL') === temCartao, `relatório completo: ${rc.erro || `${path.basename(rc.arquivo || '')}, ${(rc.secoes || []).length} seções${temCartao ? ' (com cartão de ponto)' : ''}`}`);
      if (caso.reimportar) {
        // o arquivo exportado depois da liquidação, reimportado e liquidado de novo, dá o mesmo resultado
        const rei = await c.ferramenta('calculo_importar_pjc', { arquivo: r.arquivoLiquidado, regerar: false, exportar_final: false });
        criados.push(rei.idCalculo);
        const lr = await c.ferramenta('calculo_liquidar', { id_calculo: rei.idCalculo, data_liquidacao: liquidarEm, ignorar_tabelas: true });
        verificar(Math.abs(lr.resultado.totalDevidoPeloReclamado - t.totalDevidoPeloReclamado) < 0.005 && Math.abs(lr.resultado.brutoDevidoAoReclamante - t.brutoDevidoAoReclamante) < 0.005, `exportar e reimportar preserva o resultado (total ${lr.resultado.totalDevidoPeloReclamado})`);
      }
      const fmt = (x) => `bruto ${x.brutoDevidoAoReclamante}, líquido ${x.liquidoDevidoAoReclamante}, total ${x.totalDevidoPeloReclamado}`;
      for (const re of caso.exigir || []) verificar((r.verificacoes || []).some((x) => x.estado === 'ok' && re.test(x.item)), `verificação presente e ok: ${re.source}`);
      if (!caso.tela && caso.bruto) {
        const igualFixo = Math.abs(t.brutoDevidoAoReclamante - caso.bruto) < 0.005 && Math.abs(t.liquidoDevidoAoReclamante - caso.liquido) < 0.005 && Math.abs(t.totalDevidoPeloReclamado - caso.total) < 0.005;
        verificar(igualFixo, `MCP: ${fmt(t)} (esperado com as tabelas TRT8: bruto ${caso.bruto}, líquido ${caso.liquido}, total ${caso.total})`);
      } else if (!caso.tela) {
        verificar(t.brutoDevidoAoReclamante > 0 && t.totalDevidoPeloReclamado > t.brutoDevidoAoReclamante, `MCP: ${fmt(t)}`);
      } else {
        // o cálculo feito na tela, liquidado agora com as mesmas tabelas
        const imp = await c.ferramenta('calculo_importar_pjc', { arquivo: path.resolve(__dirname, '..', 'exemplos', 'gabaritos-tela', caso.tela), exportar_final: false });
        criados.push(imp.idCalculo);
        const lt = await c.ferramenta('calculo_liquidar', { id_calculo: imp.idCalculo, data_liquidacao: liquidarEm, ignorar_tabelas: true });
        const g = lt.resultado;
        const igual = (k) => Math.abs(t[k] - g[k]) < 0.005;
        verificar(igual('brutoDevidoAoReclamante') && igual('liquidoDevidoAoReclamante') && igual('totalDevidoPeloReclamado'), `MCP = tela (mesmas tabelas): ${fmt(t)}${igual('brutoDevidoAoReclamante') && igual('liquidoDevidoAoReclamante') && igual('totalDevidoPeloReclamado') ? '' : ` × tela ${fmt(g)}`}`);
        if (caso.entidades) {
          // além dos totais, cada opção escolhida na tela tem de chegar igual ao cálculo do MCP
          const dif = diferencasDeCampos(r.arquivoPronto, path.resolve(__dirname, '..', 'exemplos', 'gabaritos-tela', caso.tela), caso.entidades);
          verificar(!dif.length, `campos iguais aos da tela em ${caso.entidades.join(', ')}${dif.length ? `: ${dif.join(' | ')}` : ''}`);
        }
        if (caso.bruto == null) console.log(`    (gabarito ${caso.gabarito}: ${fmt(g)})`);
        else {
          const original = Math.abs(t.brutoDevidoAoReclamante - caso.bruto) < 0.005 && Math.abs(t.totalDevidoPeloReclamado - caso.total) < 0.005;
          console.log(`    (com as tabelas originais de 2016: bruto ${caso.bruto}, total ${caso.total}${original ? ' — igual' : ' — difere: tabelas carregadas são outras'})`);
        }
      }
      if (nome === nomes[0]) {
        const rel = await c.ferramenta('calculo_relatorio', { id_calculo: r.idCalculo });
        verificar(rel.totais.verbas.length >= 10, `relatório: ${rel.totais.verbas.length} linhas no resumo`);
      }
    } catch (e) {
      falhas++;
      console.error(`  FALHOU: ${e.message}`);
    }
  }
  console.log(falhas ? `\n${falhas} CASO(S) FALHARAM` : `\nTESTE DE PONTA A PONTA PASSOU (${nomes.join(', ')})`);
  if (falhas) process.exitCode = 1;
} finally {
  if (!process.argv.includes('--manter')) {
    for (const id of criados) {
      try { await c.ferramenta('calculo_excluir', { id_calculo: id, confirmacao: 'SIM, EXCLUIR' }); console.log(`(cálculo de teste ${id} excluído)`); } catch (e) { console.error(`não consegui excluir o cálculo ${id}: ${e.message}`); }
    }
  }
  c.fechar();
}
