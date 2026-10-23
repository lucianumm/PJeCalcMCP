// pjecalc-mcp-skill · lib/precedentes.mjs
// Catálogo de precedentes com efeito no cálculo (vigência, modulação e como parametrizar no PJe-Calc) e
// as conferências que dependem deles. O catálogo é ponto de partida: cada item precisa ser conferido na
// fonte oficial e revisto quando surgir tese nova. Fora do catálogo, ou na dúvida sobre vigência e
// modulação, o agente consulta a fonte e pergunta — nunca decide de memória.

const lista = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const iso = (v) => {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};

// "conferir": o conteúdo resume o entendimento usual; confirme na fonte oficial antes de aplicar.
export const PRECEDENTES = [
  { id: 'ADC58', nome: 'ADC 58/59 e ADI 5867/6021 (STF)', tema: 'correção e juros dos créditos trabalhistas', vigencia: '2020-12-18',
    efeito: 'IPCA-E na fase pré-judicial (com os juros do art. 39, caput, da Lei 8.177/91) e SELIC a partir do ajuizamento (a SELIC já inclui os juros)',
    modulacao: 'pagamentos já feitos são válidos; decisões transitadas que fixaram critério expressamente são mantidas; processos em curso e decisões omissas aplicam a tese',
    parametrizacao: '"indice": "IPCAE", "combinacoesIndice": [{ "indice": "SELIC", "aPartirDe": "ajuizamento" }], juros TRD_SIMPLES na fase pré-judicial e SEM_JUROS a partir do ajuizamento', fonte: 'STF, ADC 58 (julg. 18/12/2020; embargos de declaração julgados em 2021)' },
  { id: 'LEI14905', nome: 'Lei 14.905/2024 (arts. 389 e 406 do Código Civil)', tema: 'correção e juros a partir de 30/08/2024', vigencia: '2024-08-30',
    efeito: 'na fase judicial, a partir de 30/08/2024: correção pelo IPCA e juros pela taxa legal (SELIC menos IPCA, sem resultado negativo), conforme aplicação adotada pelo TST',
    modulacao: 'aplica-se ao período a partir de 30/08/2024; períodos anteriores seguem a ADC 58',
    parametrizacao: 'combinação de índice IPCA a partir de 2024-08-30 e combinação de juros TAXA_LEGAL a partir de 2024-08-30', fonte: 'Lei 14.905/2024; TST, SDI-1, E-ED-RR-713-03.2010.5.04.0029 (2024)' },
  { id: 'TEMA810', nome: 'Tema 810 (STF, RE 870.947)', tema: 'Fazenda Pública: correção e juros', vigencia: '2017-09-20',
    efeito: 'correção pelo IPCA-E e juros da caderneta de poupança nas condenações da Fazenda Pública (até a EC 113/2021)',
    modulacao: 'conferir', parametrizacao: 'índice IPCAE e juros JUROS_POUPANCA ou FAZENDA_PUBLICA até 08/12/2021', fonte: 'STF, RE 870.947' },
  { id: 'EC113', nome: 'Emenda Constitucional 113/2021, art. 3º', tema: 'Fazenda Pública: SELIC única', vigencia: '2021-12-09',
    efeito: 'a partir de dezembro/2021, correção e juros pela SELIC, uma única vez, nas condenações da Fazenda Pública',
    modulacao: 'conferir', parametrizacao: 'combinação SELIC_FAZENDA (ou SELIC) a partir de 2021-12-09', fonte: 'EC 113/2021' },
  { id: 'EC136', nome: 'Emenda Constitucional 136/2025', tema: 'precatórios: juros', vigencia: null,
    efeito: 'regras de juros de precatórios; o PJe-Calc 2.16 oferece a opção JUROS_PRECATORIO_EC_136_2025',
    modulacao: 'conferir conteúdo e vigência na fonte oficial antes de usar', parametrizacao: 'juros JUROS_PRECATORIO_EC_136_2025, conforme a decisão', fonte: 'EC 136/2025' },
  { id: 'OJ394', nome: 'OJ 394 da SDI-1 do TST e incidente de recursos repetitivos que a alterou (2023)', tema: 'reflexos do repouso aumentado pelas horas extras', vigencia: '2023-03-20',
    efeito: 'para horas extras prestadas a partir de 20/03/2023, o aumento do repouso semanal pelas horas extras habituais repercute em férias, 13º, aviso e FGTS; antes, não repercute',
    modulacao: 'data de corte: horas extras a partir de 20/03/2023', parametrizacao: 'reflexos do RSR sobre horas extras (reflexo do reflexo) só para o período a partir de 2023-03-20, se a decisão não dispuser de outro modo', fonte: 'TST, IRR (Tema 9), 2023' },
  { id: 'SUM85', nome: 'Súmula 85 do TST', tema: 'compensação de jornada', vigencia: null, efeito: 'compensação irregular: nas horas destinadas à compensação, só o adicional; o banco de horas segue regras próprias', modulacao: 'conferir', parametrizacao: 'apuração do cartão com limite da Súmula 85 (limiteSumula85)', fonte: 'TST, Súmula 85' },
  { id: 'SUM338', nome: 'Súmula 338 do TST', tema: 'registro de jornada', vigencia: null, efeito: 'cartões com horários invariáveis não valem como prova; presume-se a jornada da inicial, salvo prova em contrário', modulacao: 'conferir', parametrizacao: 'jornada da decisão (programação), não a dos cartões', fonte: 'TST, Súmula 338' },
  { id: 'SUM366', nome: 'Súmula 366 do TST', tema: 'minutos residuais', vigencia: null, efeito: 'variações de até 5 minutos por marcação (máximo 10 por dia) não contam; ultrapassado o limite, conta todo o tempo', modulacao: 'conferir', parametrizacao: 'tolerância por turno e por dia na apuração do cartão', fonte: 'TST, Súmula 366' },
  { id: 'SUM437', nome: 'Súmula 437 do TST e art. 71, §4º, da CLT', tema: 'intervalo intrajornada', vigencia: null, efeito: 'até 10/11/2017, supressão parcial gera o pagamento do período integral com natureza salarial; a partir de 11/11/2017 (Lei 13.467), só o período suprimido, com natureza indenizatória', modulacao: 'data de corte: 11/11/2017', parametrizacao: 'intervaloIntrajornada com supressaoIntegral / supressaoReforma', fonte: 'TST, Súmula 437; Lei 13.467/2017' },
  { id: 'SUM264', nome: 'Súmula 264 do TST', tema: 'base das horas extras', vigencia: null, efeito: 'a hora extra é calculada sobre a remuneração (parcelas de natureza salarial) mais o adicional', modulacao: 'conferir', parametrizacao: 'base com os históricos das parcelas salariais', fonte: 'TST, Súmula 264' },
  { id: 'SUM347', nome: 'Súmula 347 do TST', tema: 'reflexos das horas extras', vigencia: null, efeito: 'reflexos pela média física das horas, multiplicada pelo valor da hora do mês do pagamento', modulacao: 'conferir', parametrizacao: 'reflexo com comportamento pela média das quantidades', fonte: 'TST, Súmula 347' },
  { id: 'SUM340', nome: 'Súmula 340 do TST', tema: 'comissionista', vigencia: null, efeito: 'sobre as comissões, só o adicional de horas extras, com divisor pelas horas efetivamente trabalhadas', modulacao: 'conferir', parametrizacao: 'verba só do adicional sobre o histórico de comissões; divisor pelas horas trabalhadas', fonte: 'TST, Súmula 340' },
  { id: 'SUM45', nome: 'Súmula 45 do TST', tema: 'horas extras no 13º', vigencia: null, efeito: 'horas extras habituais integram o 13º', modulacao: 'conferir', parametrizacao: 'reflexo em 13º', fonte: 'TST, Súmula 45' },
  { id: 'SUM63', nome: 'Súmula 63 do TST', tema: 'FGTS sobre horas extras e adicionais', vigencia: null, efeito: 'o FGTS incide sobre a remuneração, incluídas horas extras e adicionais eventuais', modulacao: 'conferir', parametrizacao: 'incidência de FGTS nas verbas', fonte: 'TST, Súmula 63' },
  { id: 'SUM60', nome: 'Súmula 60 do TST', tema: 'adicional noturno', vigencia: null, efeito: 'adicional noturno habitual integra o salário; cumprida a jornada noturna e prorrogada, o adicional incide também sobre as horas prorrogadas', modulacao: 'conferir', parametrizacao: 'prorrogacaoSumula60 na apuração do cartão', fonte: 'TST, Súmula 60' },
  { id: 'SUM132', nome: 'Súmula 132 do TST', tema: 'periculosidade', vigencia: null, efeito: 'o adicional de periculosidade integra a base das horas extras', modulacao: 'conferir', parametrizacao: 'base das horas extras com o histórico da periculosidade', fonte: 'TST, Súmula 132' },
  { id: 'SUM139', nome: 'Súmula 139 do TST', tema: 'insalubridade', vigencia: null, efeito: 'enquanto pago, o adicional de insalubridade integra a remuneração', modulacao: 'conferir', parametrizacao: 'base com o histórico da insalubridade', fonte: 'TST, Súmula 139' },
  { id: 'SUM291', nome: 'Súmula 291 do TST', tema: 'supressão de horas extras', vigencia: null, efeito: 'supressão de horas extras habituais por 1 ano ou mais: indenização de 1 mês por ano (média dos últimos 12 meses)', modulacao: 'conferir', parametrizacao: 'verba informada ou personalizada com a média', fonte: 'TST, Súmula 291' },
  { id: 'OJ415', nome: 'OJ 415 da SDI-1 do TST', tema: 'dedução de horas extras pagas', vigencia: null, efeito: 'a dedução das horas extras pagas é global (todo o período), não limitada ao mês', modulacao: 'conferir', parametrizacao: 'valor pago abatido pelo critério global', fonte: 'TST, OJ 415 da SDI-1' },
];
const PORID = new Map(PRECEDENTES.map((p) => [p.id, p]));
export const precedente = (id) => PORID.get(semAcento(id).replace(/[^A-Z0-9]/g, '')) || PORID.get(id) || null;

/**
 * Conferências dos critérios de atualização contra o título e os precedentes vinculantes.
 * capAtualizacao: linha "ATUALIZACAO" da matriz do título (null se o título é omisso).
 */
export function conferirPrecedentes(spec, { capAtualizacao = null, cenario = false } = {}) {
  const s = spec || {};
  const c = s.contrato || {};
  const out = [];
  const reg = (item, estado, detalhe) => out.push({ item, estado, detalhe, dimensao: 'titulo' });
  const premissas = new Set(lista(c.premissas).map((p) => p.id));
  // precedentes citados como critério nas decisões
  for (const d of lista(c.decisoes)) {
    for (const p of lista(d.precedentes)) {
      const id = typeof p === 'string' ? p : p.id;
      const uso = semAcento(typeof p === 'string' ? 'CRITERIO' : p.uso || 'CRITERIO');
      if (uso !== 'CRITERIO') continue;
      if (!precedente(id) && !premissas.has(id)) reg(`decisão ${d.id} / precedente ${id}`, 'alerta', 'precedente adotado como critério fora do catálogo: confira o conteúdo e a vigência na fonte oficial e registre-o como premissa (com fundamento)');
    }
  }
  const cj = s.correcaoJuros;
  if (!cj) return out;
  const citados = lista(cj.precedentes).map((x) => (precedente(x) || {}).id || x);
  for (const id of citados) if (!precedente(id) && !premissas.has(id)) reg(`correção e juros / precedente ${id}`, 'alerta', 'precedente fora do catálogo: confira na fonte oficial e registre como premissa');
  const devedorPublico = lista(c.devedores).some((d) => d.entePublico);
  if (devedorPublico && !citados.some((id) => ['TEMA810', 'EC113', 'EC136'].includes(id))) reg('correção e juros / ente público', 'falha', 'devedor é ente público: informe em "correcaoJuros.precedentes" o regime aplicado (TEMA810, EC113, EC136) e parametrize conforme a decisão');
  if (!capAtualizacao) {
    if (!citados.length) reg('correção e juros', 'falha', 'o título é omisso quanto à correção e aos juros (nenhuma decisão tem o capítulo ATUALIZACAO): aplique o precedente vinculante e informe-o em "correcaoJuros.precedentes" (ex.: ADC58)');
  } else if (!capAtualizacao.transitado) {
    reg('correção e juros', 'alerta', 'o critério fixado ainda pode mudar (sem trânsito): a ADC 58 e a Lei 14.905/2024 podem alterá-lo — confira antes de entregar');
  }
  const temSelic = semAcento(cj.indice) === 'SELIC' || lista(cj.combinacoesIndice).some((x) => /SELIC/.test(semAcento(x.indice)));
  if (citados.includes('ADC58') && !temSelic) reg('correção e juros / ADC 58', 'alerta', 'ADC 58 citada, mas sem SELIC a partir do ajuizamento nas combinações de índice: confira a parametrização');
  const dataLiq = iso(c.dataLiquidacao);
  if (citados.includes('ADC58') && dataLiq && dataLiq >= '2024-08-30' && !citados.includes('LEI14905')) reg('correção e juros / Lei 14.905/2024', 'alerta', `liquidação em ${dataLiq}, depois de 30/08/2024: confira a aplicação da Lei 14.905/2024 (IPCA + taxa legal) e informe "LEI14905" se aplicada`);
  if (citados.includes('LEI14905')) {
    const ipca = lista(cj.combinacoesIndice).some((x) => semAcento(x.indice) === 'IPCA');
    const taxa = lista(cj.combinacoesJuros).some((x) => semAcento(x.juros) === 'TAXA LEGAL' || semAcento(x.juros) === 'TAXA_LEGAL');
    if (!ipca || !taxa) reg('correção e juros / Lei 14.905/2024', 'alerta', 'Lei 14.905/2024 citada, mas faltam a combinação de índice IPCA e a de juros TAXA_LEGAL a partir de 2024-08-30');
  }
  return out;
}
