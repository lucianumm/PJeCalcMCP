// pjecalc-mcp-skill · lib/documentos.mjs
// Documentação necessária ao cálculo. Antes de gerar qualquer coisa, o agente precisa saber quais
// documentos o caso exige, se os recebidos cobrem todo o período e o que ainda falta pedir.
//
//   avaliarDocumentacao(spec) -> requisitos (obrigatórios e desejáveis) com a situação de cada um,
//                                cobertura mês a mês, perguntas ao usuário e a próxima rodada
//   textoPedido(avaliacao)    -> texto pronto para pedir os documentos ao usuário/cliente
//
// A situação de cada requisito: ok | inexistente_fundamentado | pendente | faltando |
// cobertura_incompleta | periodo_nao_informado. "pendente" é o que foi pedido e ainda não chegou (ou
// chegou incompleto/ilegível): vira incerteza aberta e só pode seguir num cenário declarado.

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
const lista = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** 'AAAA-MM', 'MM/AAAA', 'AAAA-MM-DD', 'DD/MM/AAAA' -> 'AAAA-MM'. */
export function mes(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[2]}-${m[1]}`;
  m = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[2]}-${m[1]}`;
  return null;
}
/** Meses de a até b, inclusive ('AAAA-MM'). */
export function mesesEntre(a, b) {
  const i = mes(a); const f = mes(b ?? a);
  if (!i || !f || f < i) return i && !f ? [i] : [];
  const out = [];
  let [y, m] = i.split('-').map(Number);
  for (let k = 0; k < 1200; k++) {
    const atual = `${y}-${String(m).padStart(2, '0')}`;
    out.push(atual);
    if (atual === f) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const mmaaaa = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
/** ['2014-03','2014-04','2014-06'] -> '03/2014 a 04/2014, 06/2014'. */
export function faixasDeMeses(meses) {
  const ord = [...new Set(meses)].sort();
  const out = [];
  for (let i = 0; i < ord.length;) {
    let j = i;
    while (j + 1 < ord.length && mesesEntre(ord[j], ord[j + 1]).length === 2) j++;
    out.push(i === j ? mmaaaa(ord[i]) : `${mmaaaa(ord[i])} a ${mmaaaa(ord[j])}`);
    i = j + 1;
  }
  return out.join(', ');
}

// Categorias de documento: reconhecidas pelo "tipo"; se o tipo não for reconhecido, pela identificação.
export const CATEGORIAS = {
  SENTENCA: { nome: 'sentença', re: /SENTENCA/ },
  DECISOES_POSTERIORES: { nome: 'embargos, acórdãos ou certidão de trânsito', re: /ACORDAO|EMBARGOS|TRANSITO|DECISAO DE LIQUIDACAO|HOMOLOGA/ },
  REGISTRO: { nome: 'CTPS ou ficha de registro', re: /CTPS|CARTEIRA DE TRABALHO|FICHA (DE )?REGISTRO|CONTRATO DE TRABALHO|ESOCIAL/ },
  RESCISAO: { nome: 'TRCT', re: /TRCT|TERMO DE RESCISAO|RESCISAO/ },
  SALARIOS: { nome: 'holerites ou ficha financeira', re: /HOLERIT|CONTRACHEQU|RECIBOS? DE (SALARIO|PAGAMENTO)|FOLHAS? DE PAGAMENTO|FICHA FINANCEIRA/ },
  CNIS: { nome: 'CNIS', re: /CNIS/ },
  JORNADA: { nome: 'cartões de ponto', re: /CARTO(ES|AO) DE PONTO|REGISTROS? DE PONTO|CONTROLES? DE (PONTO|JORNADA|FREQUENCIA)|ESPELHOS? DE PONTO|FOLHAS? DE PONTO/ },
  FERIAS: { nome: 'avisos e recibos de férias', re: /FERIAS/ },
  DECIMO: { nome: 'recibos de 13º', re: /\b13 ?(O|º)? ?SALARIO|DECIMO TERCEIRO|GRATIFICACAO NATALINA/ },
  FGTS: { nome: 'extrato do FGTS', re: /FGTS|GFIP|SEFIP|GRRF|\bGRF\b/ },
  CCT: { nome: 'convenção ou acordo coletivo', re: /CONVENCAO|ACORDO COLETIVO|\bCCT\b|\bACT\b|NORMA COLETIVA|SENTENCA NORMATIVA/ },
  // peças e atos de outros processos e da execução
  PETICAO_INICIAL: { nome: 'petição inicial', re: /PETICAO INICIAL|\bINICIAL\b|RECLAMACAO TRABALHISTA|RECLAMATORIA/ },
  DECISAO: { nome: 'decisão', re: /SENTENCA|ACORDAO|DECISAO|DESPACHO|HOMOLOGA|EMBARGOS/ },
  ARQUIVAMENTO: { nome: 'termo ou despacho de arquivamento', re: /ARQUIVAMENTO|ARQUIVAD/ },
  TERMO_ACORDO: { nome: 'termo de acordo', re: /TERMO DE ACORDO|ACORDO HOMOLOGADO|ACORDO JUDICIAL|ACORDO EXTRAJUDICIAL|CONCILIACAO/ },
  PROTESTO: { nome: 'petição de protesto', re: /PROTESTO/ },
  HABILITACAO: { nome: 'habilitação ou rol de substituídos', re: /HABILITACAO|SUBSTITUIDOS/ },
  GUIA_JUDICIAL: { nome: 'guia, extrato judicial ou alvará', re: /\bGUIAS?\b|DEPOSITO|ALVARA|EXTRATO JUDICIAL|COMPROVANTE DE (DEPOSITO|PAGAMENTO)|BLOQUEIO|SISBAJUD/ },
  CALCULO_HOMOLOGADO: { nome: 'cálculo homologado', re: /CALCULO|PLANILHA|LAUDO CONTABIL|CONTA DE LIQUIDACAO/ },
  CARTA_SENTENCA: { nome: 'carta de sentença', re: /CARTA DE SENTENCA|EXECUCAO PROVISORIA/ },
};

// Documentos exigidos de cada processo ligado, conforme a relação ([item, descrição, categorias, motivo]).
// '*' aceita qualquer documento daquele processo; 'DECISAO' também é satisfeito por contrato.decisoes do processo.
const REQ_RELACAO = {
  CONEXO: [['INICIAL', 'petição inicial', ['PETICAO_INICIAL'], 'pedidos e períodos'], ['DECISOES', 'decisões', ['DECISAO'], 'parcelas decididas em conjunto']],
  CONTINENCIA: [['INICIAL', 'petição inicial', ['PETICAO_INICIAL'], 'pedidos e períodos'], ['DECISOES', 'decisões', ['DECISAO'], 'parcelas decididas em conjunto']],
  LITISPENDENCIA: [['INICIAL', 'petição inicial', ['PETICAO_INICIAL'], 'pedidos idênticos'], ['DECISOES', 'decisões', ['DECISAO'], 'o que já foi decidido']],
  COISA_JULGADA: [['INICIAL', 'petição inicial', ['PETICAO_INICIAL'], 'pedidos idênticos'], ['DECISOES', 'decisões', ['DECISAO'], 'o que já foi decidido'], ['TRANSITO', 'certidão de trânsito em julgado', ['DECISOES_POSTERIORES'], 'coisa julgada']],
  ANTERIOR_ARQUIVADO: [['INICIAL', 'petição inicial', ['PETICAO_INICIAL'], 'pedidos idênticos (a interrupção da prescrição vale só para eles)'], ['ARQUIVAMENTO', 'termo ou despacho de arquivamento', ['ARQUIVAMENTO'], 'data do arquivamento']],
  PROTESTO_INTERRUPTIVO: [['PROTESTO', 'petição do protesto e despacho', ['PROTESTO'], 'marco da interrupção da prescrição']],
  COLETIVO: [['DECISOES', 'sentença coletiva e acórdãos', ['DECISAO'], 'é o título executivo'], ['TRANSITO', 'certidão de trânsito em julgado', ['DECISOES_POSTERIORES'], 'trânsito do título coletivo'], ['HABILITACAO', 'rol de substituídos ou habilitação', ['HABILITACAO'], 'prova de que o reclamante é beneficiário']],
  ACORDO: [['ACORDO', 'termo do acordo e homologação', ['TERMO_ACORDO'], 'alcance da quitação e valores pagos']],
  CONTRATO_ANTERIOR: [['DECISOES', 'decisão sobre unicidade ou períodos', ['DECISAO'], 'soma ou separação dos contratos']],
  CONSIGNACAO: [['GUIAS', 'guias de depósito', ['GUIA_JUDICIAL'], 'valores a abater'], ['DECISOES', 'decisões', ['DECISAO'], 'destino dos valores']],
  PROVA_EMPRESTADA: [['DOCUMENTO', 'o documento emprestado', ['*'], 'é a prova usada']],
  INQUERITO: [['DECISOES', 'decisão do inquérito', ['DECISAO'], 'justa causa ou reintegração e período']],
  RECUPERACAO_JUDICIAL: [['DECISOES', 'decisão de deferimento do processamento', ['DECISAO'], 'data-limite da atualização']],
  FALENCIA: [['DECISOES', 'decisão de decretação da falência', ['DECISAO'], 'data-limite da atualização']],
  EXECUCOES_REUNIDAS: [['DECISOES', 'despacho de reunião e rateio', ['DECISAO'], 'penhora compartilhada']],
  EMBARGOS_TERCEIRO: [['DECISOES', 'decisão dos embargos', ['DECISAO'], 'bens liberados ou penhorados']],
  CARTA_PRECATORIA: [['DOCUMENTO', 'carta e certidões', ['*'], 'atos praticados na outra vara']],
  RESCISORIA: [['INICIAL', 'petição inicial', ['PETICAO_INICIAL'], 'capítulos atacados'], ['DECISOES', 'decisões (inclusive liminar)', ['DECISAO'], 'efeito sobre o título']],
  MANDADO_SEGURANCA: [['INICIAL', 'petição inicial', ['PETICAO_INICIAL'], 'ato atacado'], ['DECISOES', 'decisões (inclusive liminar)', ['DECISAO'], 'efeito sobre o título']],
  RECLAMACAO_CONSTITUCIONAL: [['INICIAL', 'petição inicial', ['PETICAO_INICIAL'], 'ato atacado'], ['DECISOES', 'decisões (inclusive liminar)', ['DECISAO'], 'efeito sobre o título']],
  OUTRO: [['DOCUMENTO', 'documentos do processo', ['*'], 'efeito declarado no mapa']],
};

/** Requisitos que dependem do mapa do processo: documentos dos processos ligados e da fase atual. */
function requisitosDoMapa(x) {
  const out = [];
  for (const p of x.processos.filter((q) => q.id !== x.principalId)) {
    const rel = semAcento(p.relacao).replace(/ /g, '_');
    if (p.efeito && p.efeito.nenhum) continue;
    for (const [item, desc, aceita, motivo] of REQ_RELACAO[rel] || []) {
      out.push({ id: `REL:${p.id}:${item}`, descricao: `${desc[0].toUpperCase()}${desc.slice(1)} do processo ${p.numero || p.id} (${rel.toLowerCase().replace(/_/g, ' ')})`, motivo, aceita, processo: p.id, quando: () => true });
    }
  }
  const fase = semAcento(x.principal && x.principal.fase).replace(/ /g, '_');
  const trabalho = semAcento(x.principal && (x.principal.trabalho || 'CALCULO_NOVO')).replace(/ /g, '_');
  if (fase === 'EXECUCAO' || trabalho === 'ATUALIZACAO') {
    out.push({ id: 'FASE:CALCULO_HOMOLOGADO', descricao: 'Cálculo homologado (a conta que está sendo executada)', motivo: 'na execução, é o ponto de partida', aceita: ['CALCULO_HOMOLOGADO'], quando: () => true });
    out.push({ id: 'FASE:HOMOLOGACAO', descricao: 'Sentença de liquidação (decisão que homologou os cálculos) e decisões posteriores sobre ela', motivo: 'fixa os critérios da execução', aceita: [], tiposDecisao: ['SENTENCA_LIQUIDACAO', 'HOMOLOGACAO'], quando: () => true });
  }
  if (fase === 'EXECUCAO_PROVISORIA') out.push({ id: 'FASE:CARTA_SENTENCA', descricao: 'Carta de sentença ou peças da execução provisória', motivo: 'limites do que pode ser executado', aceita: ['CARTA_SENTENCA'], quando: () => true });
  return out;
}
export function categoriasDe(doc) {
  const porTipo = Object.entries(CATEGORIAS).filter(([, c]) => c.re.test(semAcento(doc.tipo))).map(([k]) => k);
  if (porTipo.length) return porTipo;
  return Object.entries(CATEGORIAS).filter(([, c]) => c.re.test(semAcento(`${doc.identificacao || ''} ${doc.descricao || ''}`))).map(([k]) => k);
}
/** Meses que um documento cobre: período declarado menos as lacunas. null = período não informado. */
export function mesesDoDocumento(doc) {
  if (!doc.periodo || !mes(doc.periodo.inicio)) return null;
  const lacunas = new Set(lista(doc.lacunas).flatMap((l) => (typeof l === 'object' ? mesesEntre(l.inicio, l.fim) : [mes(l)])));
  return mesesEntre(doc.periodo.inicio, doc.periodo.fim || doc.periodo.inicio).filter((m) => !lacunas.has(m));
}

const RE_JORNADA = /HORAS? EXTRA|ADICIONAL NOTURNO|HORAS? NOTURNA|INTERVALO|DOMINGOS? E FERIADOS|FERIADOS? TRABALHADOS?|FERIADOS? EM DOBRO|DOBRA DOS? (DOMINGOS?|FERIADOS?)|DOMINGOS? EM DOBRO|SOBREAVISO|PRONTIDAO/;
const RE_RESCISORIAS = /SALDO DE SALARIO|AVISO PREVIO|477|FERIAS|DECIMO|13/;

/** O que o caso contém, para decidir quais documentos são necessários. */
function contexto(spec) {
  const s = spec || {};
  const c = s.contrato || {};
  const calc = s.calculo || {};
  const parcelas = lista(c.parcelas).filter((p) => !/INDEFERIDA/.test(semAcento(p.situacao)));
  const nomeVerba = (v) => semAcento(v.nome || (v.personalizada && v.personalizada.nome) || v.verba);
  const rubricas = [...parcelas.map((p) => semAcento(p.rubrica)), ...lista(s.verbas).map(nomeVerba)];
  const parcPorId = new Map(lista(c.parcelas).map((p) => [p.id, p]));
  const contratoMeses = calc.admissao ? mesesEntre(calc.admissao, calc.demissao || calc.fim || calc.admissao) : [];

  const mesesSalario = new Set();
  for (const h of lista(s.historicosSalariais)) {
    for (const f of lista(h.valores)) mesesEntre(f.de ?? f.competencia, f.ate ?? f.de ?? f.competencia).forEach((m) => mesesSalario.add(m));
    for (const o of lista(h.ocorrencias)) { const m = mes(o.competencia); if (m) mesesSalario.add(m); }
  }
  // sem históricos (ainda), as bases salariais são as do contrato inteiro
  if (!mesesSalario.size && rubricas.length) contratoMeses.forEach((m) => mesesSalario.add(m));

  const verbasJornada = lista(s.verbas).filter((v) => RE_JORNADA.test(nomeVerba(v)));
  const parcelasJornada = [...parcelas.filter((p) => RE_JORNADA.test(semAcento(p.rubrica))),
    ...verbasJornada.flatMap((v) => lista(v.origem).map((id) => parcPorId.get(id)).filter(Boolean))];
  const mesesJornada = new Set();
  for (const v of verbasJornada) {
    const p = lista(v.origem).map((id) => parcPorId.get(id)).find((x) => x && x.periodo);
    const per = v.periodo || (p && p.periodo);
    (per ? mesesEntre(per.inicio, per.fim) : contratoMeses).forEach((m) => mesesJornada.add(m));
  }
  if (!verbasJornada.length) for (const p of parcelasJornada) (p.periodo ? mesesEntre(p.periodo.inicio, p.periodo.fim) : contratoMeses).forEach((m) => mesesJornada.add(m));
  for (const ap of lista(s.apuracaoCartaoPonto)) mesesEntre(ap.inicio, ap.fim).forEach((m) => mesesJornada.add(m));
  const docs = new Map(lista(c.documentos).map((d) => [d.id, d]));
  const prems = new Map(lista(c.premissas).map((p) => [p.id, p]));
  const decisoesDoc = (id) => { const d = docs.get(id); return d ? categoriasDe(d).some((k) => k === 'SENTENCA' || k === 'DECISOES_POSTERIORES') : false; };
  const jornadaFixada = parcelasJornada.some((p) => lista(p.premissas).some((id) => {
    const pr = prems.get(id);
    return pr && semAcento(pr.status) === 'CONFIRMADA' && decisoesDoc(pr.documento);
  }));

  const processos = lista(c.processos);
  const principal = processos.find((p) => semAcento(p.relacao) === 'PRINCIPAL') || null;
  // o título pode vir de outro processo (execução individual de sentença coletiva)
  const tituloIds = new Set(processos.filter((p) => p.efeito && p.efeito.titulo).map((p) => p.id));
  return {
    s, c, calc, rubricas, contratoMeses, processos, principal, principalId: principal ? principal.id : null, tituloIds,
    temRescisorias: Boolean(calc.demissao) && rubricas.some((r) => RE_RESCISORIAS.test(r)),
    mesesSalario: [...mesesSalario].sort(),
    temJornada: rubricas.some((r) => RE_JORNADA.test(r)) || lista(s.apuracaoCartaoPonto).length > 0 || lista(s.cartoesDePonto).length > 0,
    mesesJornada: [...mesesJornada].sort(),
    jornadaFixada,
    temFerias: rubricas.some((r) => /FERIAS/.test(r)),
    tem13: rubricas.some((r) => /DECIMO|\b13/.test(r)),
    temFgts: rubricas.some((r) => /FGTS/.test(r)) || Boolean(s.fgts),
    temNormaColetiva: rubricas.some((r) => /CONVENC|NORMATIV|PISO|CATEGORIA|PLR|PARTICIPACAO NOS LUCROS|REAJUSTE/.test(r)),
    temInss: Boolean(s.contribuicaoSocial) || lista(s.historicosSalariais).some((h) => h.inss),
  };
}

// Matriz parcela -> documentos. "aceita": categorias que satisfazem; "cobertura": meses que os documentos
// precisam cobrir; "alternativa": outra forma legítima de satisfazer (ex.: jornada fixada na decisão).
export const REQUISITOS = [
  { id: 'TITULO', descricao: 'Sentença inteira, com o dispositivo', motivo: 'define as parcelas deferidas, os períodos, as bases e os critérios', aceita: ['SENTENCA'], quando: () => true },
  { id: 'DECISOES_POSTERIORES', descricao: 'Embargos de declaração, acórdãos e certidão de trânsito em julgado (ou a informação de que não houve recurso)', motivo: 'a decisão que vale é a última do processo', aceita: ['DECISOES_POSTERIORES'], quando: () => true },
  { id: 'REGISTRO', descricao: 'CTPS, ficha de registro ou TRCT', motivo: 'fixa as datas de admissão e saída e a função', aceita: ['REGISTRO', 'RESCISAO'], quando: () => true },
  { id: 'RESCISAO', descricao: 'TRCT com os valores pagos na rescisão', motivo: 'mostra o que já foi pago, para não cobrar duas vezes', aceita: ['RESCISAO'], quando: (x) => x.temRescisorias },
  { id: 'SALARIOS', descricao: 'Holerites (ou ficha financeira) de todo o período das bases salariais', motivo: 'são as bases de cálculo mês a mês', aceita: ['SALARIOS'], cobertura: (x) => x.mesesSalario, quando: (x) => x.mesesSalario.length > 0 },
  { id: 'JORNADA', descricao: 'Cartões de ponto de todo o período das horas extras (ou a jornada fixada na decisão)', motivo: 'dão as quantidades de horas mês a mês', aceita: ['JORNADA'], cobertura: (x) => x.mesesJornada, alternativa: (x) => x.jornadaFixada && 'jornada ou quantidade fixada na decisão (premissa CONFIRMADA ligada à sentença/acórdão)', quando: (x) => x.temJornada },
  { id: 'FERIAS', descricao: 'Avisos e recibos de férias de cada período aquisitivo', motivo: 'mostram os períodos gozados e pagos', aceita: ['FERIAS'], quando: (x) => x.temFerias && x.contratoMeses.length >= 12 },
  { id: 'DECIMO', descricao: 'Recibos do 13º salário (ou holerites de novembro e dezembro)', motivo: 'mostram o que já foi pago de 13º', aceita: ['DECIMO', 'SALARIOS'], quando: (x) => x.tem13 },
  { id: 'FGTS', descricao: 'Extrato analítico do FGTS', motivo: 'mostra os depósitos feitos e a base da multa', aceita: ['FGTS'], quando: (x) => x.temFgts },
  { id: 'CCT', descricao: 'Convenção ou acordo coletivo da categoria, do período do contrato', motivo: 'pisos, adicionais e reajustes', aceita: ['CCT'], quando: (x) => x.temNormaColetiva },
  { id: 'INSS', descricao: 'CNIS ou holerites com as bases de contribuição', motivo: 'bases reais de INSS', aceita: ['CNIS', 'SALARIOS'], obrigatorio: false, quando: (x) => x.temInss },
  // parâmetros que só a decisão do processo pode fixar
  {
    id: 'ATUALIZACAO', tipo: 'decisao', descricao: 'Critério de correção monetária e juros fixado no título (ex.: ADC 58: IPCA-E e SELIC)', motivo: 'define a atualização por fase', quando: () => true,
    satisfeito: (x, ids) => {
      const cj = x.s.correcaoJuros;
      if (!cj) return 'informe "correcaoJuros" com o critério do título';
      if (!lista(cj.origem).length) return 'informe em "correcaoJuros.origem" a decisão que fixa o critério';
      const inexist = lista(cj.origem).filter((id) => !ids.has(id));
      if (inexist.length) return `"correcaoJuros.origem" cita ${inexist.join(', ')}, que não existe(m) no contrato`;
      if (!cj.indice && !lista(cj.combinacoesIndice).length) return 'o índice de correção não foi informado';
      return true;
    },
  },
  {
    id: 'HONORARIOS', tipo: 'decisao', descricao: 'Percentual e base dos honorários fixados no título', motivo: 'define credor, percentual e base', quando: (x) => lista(x.s.honorarios).length > 0,
    satisfeito: (x, ids) => {
      const sem = lista(x.s.honorarios).map((h, i) => (lista(h.origem).some((id) => ids.has(id)) ? null : `honorarios[${i}]`)).filter(Boolean);
      return sem.length ? `${sem.join(', ')} sem "origem" na decisão que os fixa` : true;
    },
  },
];

const PENDENTES = ['SOLICITADO', 'INCOMPLETO', 'ILEGIVEL', 'INEXISTENTE'];

// sinônimos aceitos em contrato.coleta[].requisito ("OUTROS" fica como pedido livre, sem requisito do caso)
const ALIAS_REQUISITO = {
  SENTENCA: 'TITULO', TITULO_EXECUTIVO: 'TITULO',
  ACORDAO: 'DECISOES_POSTERIORES', ACORDAO_TRT: 'DECISOES_POSTERIORES', ACORDAO_TST: 'DECISOES_POSTERIORES', EMBARGOS: 'DECISOES_POSTERIORES',
  EMBARGOS_DECLARACAO: 'DECISOES_POSTERIORES', TRANSITO: 'DECISOES_POSTERIORES', TRANSITO_EM_JULGADO: 'DECISOES_POSTERIORES', CERTIDAO_TRANSITO: 'DECISOES_POSTERIORES',
  CTPS: 'REGISTRO', FICHA_REGISTRO: 'REGISTRO', TRCT: 'RESCISAO', HOLERITES: 'SALARIOS', CONTRACHEQUES: 'SALARIOS', FICHA_FINANCEIRA: 'SALARIOS',
  CARTOES_DE_PONTO: 'JORNADA', CARTOES: 'JORNADA', CARTAO_PONTO: 'JORNADA', EXTRATO_FGTS: 'FGTS', NORMA_COLETIVA: 'CCT', ACT: 'CCT', CNIS: 'INSS',
};
export function aliasRequisito(r) {
  if (r == null || r === '') return r;
  const k = semAcento(String(r)).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return ALIAS_REQUISITO[k] || k;
}

/** Avalia a documentação da especificação (precisa de "contrato"; sem ele, tudo fica faltando). */
export function avaliarDocumentacao(spec) {
  const x = contexto(spec);
  const docs = lista(x.c.documentos);
  // o requisito do pedido aceita os nomes usuais dos documentos (SENTENCA, ACORDAO, TRANSITO, CTPS, TRCT...)
  const coleta = lista(x.c.coleta).map((e) => ({ ...e, requisito: aliasRequisito(e.requisito) }));
  const ids = new Set(['documentos', 'decisoes', 'parcelas', 'premissas'].flatMap((k) => lista(x.c[k]).map((r) => r.id)));
  // documentos do processo principal (e do processo cujo título é executado); os demais só valem para os
  // requisitos do próprio processo
  const doPrincipal = (d) => !d.processo || d.processo === x.principalId || x.tituloIds.has(d.processo);
  const decisoesDo = (pid) => lista(x.c.decisoes).filter((d) => (pid ? d.processo === pid : !d.processo || d.processo === x.principalId || x.tituloIds.has(d.processo)));
  const porCategoria = (cats, pid = null) => docs.filter((d) => (pid ? d.processo === pid : doPrincipal(d)) && (cats.includes('*') || categoriasDe(d).some((k) => cats.includes(k))));
  const todos = [...REQUISITOS, ...requisitosDoMapa(x)];
  const requisitos = [];
  for (const req of todos) {
    if (!req.quando(x)) continue;
    const r = { id: req.id, tipo: req.tipo || 'documento', descricao: req.descricao, motivo: req.motivo, obrigatorio: req.obrigatorio !== false, documentos: [] };
    const pedidos = coleta.filter((e) => e.requisito === req.id);
    // INEXISTENTE com fundamento não é pedido aberto (é o documento que não existe, com o motivo)
    const fundamentado = pedidos.find((e) => semAcento(e.status) === 'INEXISTENTE' && e.fundamento);
    const aberto = pedidos.find((e) => PENDENTES.includes(semAcento(e.status)) && e !== fundamentado);
    if (req.tipo === 'decisao') {
      const ok = req.satisfeito(x, ids);
      if (ok === true) r.status = 'ok';
      else if (fundamentado) Object.assign(r, { status: 'inexistente_fundamentado', detalhe: `${ok}; registrado como inexistente: ${fundamentado.fundamento}`, coleta: fundamentado.id });
      else if (aberto) Object.assign(r, { status: 'pendente', detalhe: `${ok}; pedido em contrato.coleta ${aberto.id} (${aberto.status})`, coleta: aberto.id });
      else Object.assign(r, { status: 'faltando', detalhe: ok });
      requisitos.push(r);
      continue;
    }
    if (req.processo) r.processo = req.processo;
    const alt = req.alternativa && req.alternativa(x);
    const encontrados = porCategoria(req.aceita, req.processo || null);
    // decisões registradas do processo também satisfazem o pedido de "decisões"
    if (req.aceita.includes('DECISAO') || req.tiposDecisao) {
      for (const d of decisoesDo(req.processo || null)) {
        if (req.tiposDecisao && !req.tiposDecisao.includes(semAcento(d.tipo).replace(/ /g, '_'))) continue;
        const doc = docs.find((k) => k.id === d.documento);
        if (doc && !encontrados.includes(doc)) encontrados.push(doc);
      }
    }
    r.documentos = encontrados.map((d) => d.id);
    if (alt) Object.assign(r, { status: 'ok', detalhe: alt });
    else if (encontrados.length && req.cobertura) {
      const precisa = req.cobertura(x);
      const comPeriodo = encontrados.filter((d) => mesesDoDocumento(d));
      const semPeriodo = encontrados.filter((d) => !mesesDoDocumento(d)).map((d) => d.id);
      const cobertos = new Set(comPeriodo.flatMap((d) => mesesDoDocumento(d)));
      const faltam = precisa.filter((m) => !cobertos.has(m));
      r.mesesFaltantes = faltam;
      if (!faltam.length) Object.assign(r, { status: 'ok', detalhe: `${precisa.length} mês(es) cobertos por ${comPeriodo.map((d) => d.id).join(', ')}` });
      else if (!comPeriodo.length) Object.assign(r, { status: 'periodo_nao_informado', detalhe: `informe "periodo" (e "lacunas") de ${semPeriodo.join(', ')} para conferir a cobertura de ${faixasDeMeses(precisa)}` });
      else if (aberto) Object.assign(r, { status: 'pendente', detalhe: `faltam ${faixasDeMeses(faltam)}; pedido em contrato.coleta ${aberto.id} (${aberto.status})`, coleta: aberto.id });
      else if (fundamentado) Object.assign(r, { status: 'inexistente_fundamentado', detalhe: `faltam ${faixasDeMeses(faltam)}; registrado como inexistente: ${fundamentado.fundamento}`, coleta: fundamentado.id });
      else Object.assign(r, { status: 'cobertura_incompleta', detalhe: `faltam ${faixasDeMeses(faltam)}${semPeriodo.length ? ` (sem "periodo" informado: ${semPeriodo.join(', ')})` : ''}` });
    } else if (encontrados.length) Object.assign(r, { status: 'ok', detalhe: encontrados.map((d) => d.id).join(', ') });
    else if (fundamentado) Object.assign(r, { status: 'inexistente_fundamentado', detalhe: `registrado como inexistente: ${fundamentado.fundamento}`, coleta: fundamentado.id });
    else if (aberto) Object.assign(r, { status: 'pendente', detalhe: `pedido em contrato.coleta ${aberto.id} (${aberto.status})`, coleta: aberto.id });
    else Object.assign(r, { status: 'faltando', detalhe: 'nenhum documento desse tipo no contrato e nenhum pedido registrado em contrato.coleta' });
    requisitos.push(r);
  }

  // registros ligados a documentos com período: o que eles afirmam precisa estar dentro do documento
  const registros = [];
  const docPorId = new Map(docs.map((d) => [d.id, d]));
  const dentro = (doc, meses, ctx) => {
    const cob = mesesDoDocumento(doc);
    if (!cob || !meses.length) return;
    const fora = meses.filter((m) => !cob.includes(m));
    if (fora.length) registros.push({ item: ctx, estado: 'falha', detalhe: `o documento ${doc.id} não cobre ${faixasDeMeses(fora)} (período ${mmaaaa(mes(doc.periodo.inicio))} a ${mmaaaa(mes(doc.periodo.fim || doc.periodo.inicio))}${lista(doc.lacunas).length ? ', com lacunas declaradas' : ''})` });
  };
  for (const r of lista(x.c.remuneracoes)) if (docPorId.has(r.documento)) dentro(docPorId.get(r.documento), mesesEntre(r.de, r.ate || r.de), `remuneração ${r.id}`);
  for (const a of lista(x.c.afastamentos)) if (docPorId.has(a.documento)) dentro(docPorId.get(a.documento), mesesEntre(a.inicio, a.fim || a.inicio), `afastamento ${a.id}`);
  for (const p of lista(x.c.pagamentos)) {
    if (!docPorId.has(p.documento)) continue;
    const meses = p.periodo ? mesesEntre(p.periodo.inicio, p.periodo.fim) : p.competencia ? [mes(p.competencia)] : [];
    dentro(docPorId.get(p.documento), meses.filter(Boolean), `pagamento ${p.id}`);
  }
  for (const e of coleta) {
    const st = semAcento(e.status);
    if (!['SOLICITADO', 'RECEBIDO', 'INCOMPLETO', 'ILEGIVEL', 'INEXISTENTE'].includes(st)) registros.push({ item: `coleta ${e.id}`, estado: 'falha', detalhe: `status "${e.status}" inválido (SOLICITADO, RECEBIDO, INCOMPLETO, ILEGIVEL ou INEXISTENTE)` });
    if (st === 'RECEBIDO' && e.recebidoComo && !docPorId.has(e.recebidoComo)) registros.push({ item: `coleta ${e.id}`, estado: 'falha', detalhe: `"recebidoComo" cita ${e.recebidoComo}, que não existe em contrato.documentos` });
    if ((st === 'INCOMPLETO' || st === 'ILEGIVEL') && !requisitos.some((r) => r.coleta === e.id)) registros.push({ item: `coleta ${e.id}`, estado: 'alerta', detalhe: `documento ${st === 'ILEGIVEL' ? 'ilegível' : 'incompleto'}: ${e.documento || e.requisito || ''} — confira o que dele foi usado no cálculo` });
    if (e.requisito && e.requisito !== 'OUTROS' && !todos.some((q) => q.id === e.requisito)) registros.push({ item: `coleta ${e.id}`, estado: 'alerta', detalhe: `requisito "${e.requisito}" desconhecido (${todos.map((q) => q.id).join(', ')})` });
    if (e.processo && !x.processos.some((p) => p.id === e.processo)) registros.push({ item: `coleta ${e.id}`, estado: 'falha', detalhe: `processo "${e.processo}" não está em contrato.processos` });
  }

  const perguntas = perguntasAbertas(x);
  const obrig = requisitos.filter((r) => r.obrigatorio);
  const falta = (r) => ['faltando', 'cobertura_incompleta', 'periodo_nao_informado', 'pendente'].includes(r.status);
  const proximaRodada = obrig.some((r) => (r.id === 'TITULO' || r.id === 'DECISOES_POSTERIORES') && falta(r)) || !lista(x.c.parcelas).length || !x.principal ? 1
    : obrig.some(falta) ? 2 : perguntas.length ? 3 : null;
  return { requisitos, registros, perguntas, proximaRodada, completa: !obrig.some(falta) && !registros.some((r) => r.estado === 'falha') };
}

/** Dados que só o usuário (ou o processo) responde e que ainda faltam na especificação. */
function perguntasAbertas(x) {
  const { s, c, calc } = x;
  const p = [];
  const proc = s.processo || {};
  if (!proc.numero) p.push('Qual é o número do processo (padrão CNJ)?');
  if (!(proc.reclamante && proc.reclamante.cpf)) p.push('Qual é o CPF do reclamante?');
  if (!(proc.reclamado && (proc.reclamado.cnpj || proc.reclamado.cpf))) p.push('Qual é o CNPJ (ou CPF) do reclamado?');
  if (!calc.admissao) p.push('Qual é a data de admissão?');
  if (!calc.demissao && !calc.fim) p.push('Qual é a data de saída (ou até quando o cálculo vai)?');
  if (!calc.ajuizamento) p.push('Qual é a data de ajuizamento da ação?');
  if (!calc.municipio) p.push('Em que município o trabalho era prestado (feriados locais)?');
  if (!c.dataLiquidacao) p.push('Em que data o cálculo deve ser liquidado (data-base da conta)?');
  if (x.temRescisorias && !calc.avisoPrevio) p.push('O aviso prévio foi trabalhado ou indenizado, e que prazo o título fixou?');
  if (!s.custas) p.push('Como o título tratou as custas (percentual ou valor, e quem paga)?');
  if (!s.irpf) p.push('Quantos dependentes o reclamante tem para o imposto de renda?');
  return p;
}

/** Texto para pedir os documentos e as respostas que faltam. */
export function textoPedido(av) {
  const linhas = [];
  const desc = (r) => `${r.descricao} — ${r.motivo}.${r.mesesFaltantes && r.mesesFaltantes.length && r.status !== 'periodo_nao_informado' ? ` Faltam: ${faixasDeMeses(r.mesesFaltantes)}.` : ''}${r.status === 'pendente' ? ' (já pedido; ainda não recebido por completo)' : ''}${r.status === 'periodo_nao_informado' ? ' (preciso saber quais meses o documento recebido abrange)' : ''}`;
  const abertos = av.requisitos.filter((r) => r.obrigatorio && r.status !== 'ok' && r.status !== 'inexistente_fundamentado');
  const obrig = abertos.filter((r) => r.tipo !== 'decisao');
  const defin = abertos.filter((r) => r.tipo === 'decisao');
  const desej = av.requisitos.filter((r) => !r.obrigatorio && r.status !== 'ok');
  if (!abertos.length && !desej.length && !av.perguntas.length) return 'A documentação está completa para o cálculo pedido.';
  linhas.push('Para montar o cálculo com segurança, preciso do seguinte:');
  if (obrig.length) { linhas.push('', 'Documentos obrigatórios'); obrig.forEach((r, i) => linhas.push(`${i + 1}. ${desc(r)}`)); }
  if (defin.length) { linhas.push('', 'Definições do título que preciso confirmar (indique o trecho da decisão)'); defin.forEach((r) => linhas.push(`- ${r.descricao} — ${r.motivo}.`)); }
  if (desej.length) { linhas.push('', 'Documentos que ajudam a conferir'); desej.forEach((r) => linhas.push(`- ${desc(r)}`)); }
  if (av.perguntas.length) { linhas.push('', 'Perguntas'); av.perguntas.forEach((q) => linhas.push(`- ${q}`)); }
  linhas.push('', 'Se algum documento não existir, me diga: a parcela fica registrada como pendência e o cálculo só sai como simulação, com a hipótese declarada.');
  return linhas.join('\n');
}

/**
 * Especificação mínima a partir de respostas rápidas (para usar antes de existir uma especificação):
 * parcelas deferidas, datas e documentos já recebidos.
 */
export function especificacaoMinima({ parcelas = [], admissao = null, demissao = null, documentos = [] } = {}) {
  return {
    calculo: { admissao, demissao },
    contrato: {
      parcelas: parcelas.map((rubrica, i) => ({ id: `P${i + 1}`, rubrica, situacao: 'DEFERIDA' })),
      documentos: documentos.map((d, i) => ({ id: d.id || `D${i + 1}`, tipo: d.tipo, identificacao: d.identificacao, periodo: d.periodo_inicio ? { inicio: d.periodo_inicio, fim: d.periodo_fim || d.periodo_inicio } : d.periodo, lacunas: d.lacunas })),
    },
  };
}
