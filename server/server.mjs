// pjecalc-mcp-skill · server/server.mjs
// Servidor MCP (Model Context Protocol) do PJe-Calc Cidadão 2.16.0.
//
// Objetivo principal: permitir que agentes de IA montem o cálculo trabalhista INTEIRO no PJe-Calc
// (processo, parâmetros, históricos salariais, faltas, férias, verbas e reflexos, FGTS,
// contribuição social, IRPF, honorários, multas, custas, correção e juros), deixando-o pronto
// para o usuário apenas clicar em "Liquidar".
//
// Como funciona:
//   1. a especificação JSON do cálculo vira um arquivo .PJC — o MESMO formato que o PJe-Calc
//      exporta/importa (Exportar/Importar Cálculo) — montado a partir dos modelos de cálculo
//      do MCP (lib/gerador.mjs);
//   2. o .PJC é importado no PJe-Calc em execução pela própria interface (lib/operacoes.mjs);
//   3. passos que só o aplicativo faz (apuração do cartão de ponto por jornadas, vínculo das verbas às
//      colunas apuradas) são executados pela interface logo após a importação;
//   4. o PJe-Calc regera as ocorrências (botão Regerar) e mostra as pendências da liquidação;
//   5. o cálculo pronto é exportado de volta ("-PRONTO.PJC"): importável e liquidável em qualquer PJe-Calc.
//
// Também expõe: ciclo de vida do aplicativo, serviços REST, banco H2 (com o app parado),
// configuração, catálogos (verbas, municípios, assuntos CNJ, enums) e relatórios.
//
// Roda com Node >= 20 sem dependências externas (SDK MCP incluído em node_modules/).
// Uso: node server.mjs   (stdio)

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as env from './lib/env.mjs';
import * as h2 from './lib/h2.mjs';
import * as rest from './lib/rest.mjs';
import * as life from './lib/lifecycle.mjs';
import * as loc from './lib/localizar.mjs';
import * as svc from './lib/servico-calculo.mjs';
import { anotacoesDe } from './lib/anotacoes.mjs';
import * as docs from './lib/documentos.mjs';
import * as plano from './lib/plano.mjs';
import * as conv from './lib/conversores.mjs';
import { OperadorPjeCalc } from './lib/operacoes.mjs';
import { numeroCnj, cpfValido, cnpjValido, COLUNAS_APURACAO } from './lib/gerador.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const referencesDir = path.resolve(__dirname, '..', 'references');
const exemplosDir = path.resolve(__dirname, '..', 'exemplos');
const PACKAGE_VERSION = '2.16.0-mcp.17';
const TRTS = Array.from({ length: 24 }, (_, i) => `TRT${i + 1}`);

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'pjecalc-mcp',
  title: 'PJe-Calc Cidadão MCP',
  version: PACKAGE_VERSION,
}, {
  capabilities: { logging: {} },
  instructions: [
    'Servidor MCP do PJe-Calc Cidadão 2.16.0 (Justiça do Trabalho).',
    'Para montar um cálculo: (1) leia calculo_modelo_json; (2) consulte catalogo_verbas/catalogo_municipios/catalogo_enums;',
    '(3) monte o JSON a partir da sentença; (4) calculo_validar até não haver erros; (5) calculo_criar — gera o .PJC,',
    'importa no PJe-Calc, apura o cartão de ponto (se houver jornadas), regera as ocorrências, devolve as pendências e',
    'grava o arquivo final "-PRONTO.PJC". O usuário então só clica em Liquidar (ou importa o -PRONTO.PJC em outro PJe-Calc).',
    'Antes de liquidar datas recentes: tabelas_status; se desatualizadas, tabelas_atualizar com o TRT do processo (o próprio PJe-Calc baixa do TRT/TRT8).',
    'Documentos: documento_inventario (arquivos e páginas, escaneadas a ver como imagem) ou auditor_importar (a leitura feita pelo AuditorProcessual), documento_texto, documento_imagens (as páginas escaneadas em arquivos de imagem), e os conversores holerites_para_historicos, cartoes_para_jornadas, extrato_para_fgts e trct_para_pagamentos (conferem fechamentos; não substituem a leitura).',
    'Execução: calculo_atualizar (pagamentos, honorários, multas, pensão alimentícia e custas da execução, precatório/RPV sobre o cálculo homologado liquidado) e calculo_externo_criar (conta homologada feita fora do PJe-Calc). Vários reclamantes ou devedores: calculo_criar_lote.',
    'Conta de referência: calculo_comparar_referencia aceita outro cálculo, o relatório em PDF/HTML/texto ou a conta transcrita (referencia_manual).',
    'Não use rest_tabelas_* para atualizar índices: são o lado servidor do PJe-Calc local.',
    'Nunca escreva cálculos direto no banco H2: isso dessincroniza as sequências do Hibernate e impede o PJe-Calc de criar cálculos.',
  ].join(' '),
});

// cada ferramenta leva as anotações MCP de lib/anotacoes.mjs (só lê, altera, apaga ou acessa a internet)
const registrarFerramenta = server.registerTool.bind(server);
server.registerTool = (nome, config, cb) => registrarFerramenta(nome, { ...config, annotations: anotacoesDe(nome, config.title) }, cb);

function texto(text) {
  return { content: [{ type: 'text', text }] };
}

// a localização automática do PJe-Calc roda uma vez no início (pode varrer o disco); as ferramentas esperam
const localizacaoInicial = loc.localizar().catch((e) => ({ valida: false, mensagem: e.message }));

async function handler(fn) {
  try {
    await localizacaoInicial;
    const result = await fn();
    if (typeof result === 'string') return texto(result);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    const extra = [];
    if (e.mensagens && e.mensagens.length) extra.push(`Mensagens do PJe-Calc: ${e.mensagens.join(' | ')}`);
    if (e.errosDeCampo && e.errosDeCampo.length) extra.push(`Campos: ${e.errosDeCampo.map((x) => `${x.campo}: ${x.mensagem}`).join(' | ')}`);
    return { content: [{ type: 'text', text: `ERRO: ${e.message}${extra.length ? `\n${extra.join('\n')}` : ''}` }], isError: true };
  }
}

/** Aceita a especificação como objeto JSON ou como caminho de arquivo .json. */
function lerEspecificacao(args) {
  if (args.especificacao && typeof args.especificacao === 'object') return args.especificacao;
  if (args.arquivo_json) return JSON.parse(fs.readFileSync(path.resolve(String(args.arquivo_json)), 'utf-8'));
  if (typeof args.especificacao === 'string') return JSON.parse(args.especificacao);
  throw new Error('Informe "especificacao" (objeto JSON) ou "arquivo_json" (caminho de um .json).');
}

const ESPEC = {
  especificacao: z.record(z.string(), z.unknown()).optional().describe('Especificação do cálculo (JSON). Formato em calculo_modelo_json.'),
  arquivo_json: z.string().optional().describe('Alternativa: caminho de um arquivo .json com a especificação.'),
};

// ---------------------------------------------------------------------------
// Ferramentas — ciclo de vida
// ---------------------------------------------------------------------------

server.registerTool('pjecalc_localizar', {
  title: 'Localizar o PJe-Calc no computador',
  description: 'Mostra qual instalação do PJe-Calc o MCP está usando e como a encontrou (PJECALC_HOME, escolha guardada, PJe-Calc em execução, pasta acima do MCP ou busca em Downloads, Área de Trabalho, Documentos, Arquivos de Programas e raiz dos discos). Com "pasta", fixa a instalação escolhida pelo usuário (guardada para as próximas vezes). Com "procurar_de_novo", esquece a escolha e busca outra vez (use quando a pasta foi movida). Se houver várias instalações, pergunte ao usuário qual usar.',
  inputSchema: z.object({
    pasta: z.string().optional().describe('Pasta do PJe-Calc (a que contém "bin" e "tomcat").'),
    procurar_de_novo: z.boolean().optional().describe('Esquece a instalação guardada e procura o PJe-Calc de novo (use quando a pasta foi movida).'),
  }),
}, (args) => handler(async () => {
  if (args?.pasta) return loc.escolher(args.pasta);
  if (args?.procurar_de_novo) loc.esquecer();
  return loc.localizar();
}));

server.registerTool('pjecalc_status', {
  title: 'Status do PJe-Calc',
  description: 'Estado do PJe-Calc: processos java, porta HTTP, se a aplicação responde, versão e banco; quando não responde, o diagnóstico lido no log (por exemplo, falta de memória) e o que fazer. Não altera nada.',
  inputSchema: z.object({}),
}, () => handler(async () => { const st = await life.status(); if (!st.aplicacaoRespondendo) { const d = life.diagnosticoDeFalha(); if (d) st.diagnostico = d; } return st; }));

server.registerTool('pjecalc_iniciar', {
  title: 'Iniciar o PJe-Calc',
  description: 'Inicia o PJe-Calc e aguarda a aplicação responder (até 3 min). Modo "sem-navegador" (padrão): sobe o Tomcat como o launcher oficial, sem abrir janela/navegador (ideal para o agente). Modo "normal": igual ao iniciarPjeCalc.bat (janela + navegador). Em seguida o usuário pode abrir http://localhost:9257/pjecalc no navegador.',
  inputSchema: z.object({
    modo: z.enum(['sem-navegador', 'normal']).optional().describe('sem-navegador (padrão) ou normal.'),
  }),
}, (args) => handler(() => life.start({ modo: args?.modo || 'sem-navegador' })));

server.registerTool('pjecalc_parar', {
  title: 'Parar o PJe-Calc',
  description: 'Encerra o PJe-Calc. Se foi iniciado pelo MCP (sem-navegador), encerra o Tomcat de forma ordenada (o banco H2 fecha corretamente); caso contrário encerra o processo java, como o próprio launcher faria ao sair.',
  inputSchema: z.object({
    forcar: z.boolean().optional().describe('Encerra o processo java diretamente.'),
  }),
}, (args) => handler(() => life.stop({ forcar: Boolean(args?.forcar) })));

server.registerTool('pjecalc_abrir_interface', {
  title: 'Abrir a interface no navegador',
  description: 'Abre a interface web do PJe-Calc no navegador padrão do usuário (ou o Firefox portátil que acompanha o PJe-Calc). Requer o app em execução.',
  inputSchema: z.object({
    pagina: z.string().optional().describe('Caminho relativo (padrão: página inicial pages/principal.jsf).'),
    firefox_portatil: z.boolean().optional().describe('Usa navegador/windows/FirefoxPortable.exe.'),
  }),
}, (args) => handler(async () => {
  const st = await life.status();
  if (!st.rodando) throw new Error('O PJe-Calc não está em execução. Use pjecalc_iniciar primeiro.');
  const page = args?.pagina ? String(args.pagina).replace(/^\//, '') : 'pages/principal.jsf';
  const url = `${st.url}/${page}`;
  const { spawn, execFile } = await import('node:child_process');
  if (args?.firefox_portatil) {
    const ff = path.join(env.home(), 'navegador', 'windows', 'FirefoxPortable.exe');
    if (!fs.existsSync(ff)) throw new Error('Firefox portátil não encontrado em navegador/windows/FirefoxPortable.exe');
    spawn(ff, [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    await new Promise((resolve) => execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => resolve()));
  }
  return { aberto: url };
}));

server.registerTool('pjecalc_logs', {
  title: 'Ler logs do PJe-Calc',
  description: 'Últimas linhas dos logs do Tomcat/MCP (tomcat/logs). Com somente_erros=true, lista só exceções e linhas GRAVE — útil quando uma operação devolve "Erro Interno no Servidor".',
  inputSchema: z.object({
    linhas: z.number().int().min(1).max(500).optional().describe('Linhas por arquivo (padrão 60).'),
    arquivo: z.string().optional().describe('Arquivo específico dentro de tomcat/logs.'),
    somente_erros: z.boolean().optional().describe('Lista só exceções e linhas GRAVE/SEVERE.'),
  }),
}, (args) => handler(() => (args?.somente_erros ? life.errosRecentes({ max: args?.linhas || 40 }) : life.tailLogs({ linhas: args?.linhas || 60, arquivo: args?.arquivo }))));

// ---------------------------------------------------------------------------
// Ferramentas — CÁLCULO (gerar, validar, importar, liquidar, relatório)
// ---------------------------------------------------------------------------

const EXEMPLOS = {
  referencia: ['calculo-referencia.json', 'caso básico (rescisão + horas extras informadas) — liquidado em 30/06/2016: bruto R$ 31.320,10, líquido R$ 23.113,54, total do reclamado R$ 40.330,83'],
  completo: ['calculo-completo.json', 'quase todos os módulos (cartão mensal, diferenças salariais, dano moral, depósito de FGTS, pensão, previdência privada, salário-família, seguro-desemprego, honorários, multa, custas, SELIC) — 30/06/2016: bruto R$ 44.107,03, líquido R$ 35.869,97, total do reclamado R$ 58.523,05'],
  'cartao-ponto': ['calculo-cartao-ponto.json', 'apuração do cartão de ponto por programação semanal; horas extras pela coluna Hs EXT — 30/06/2016: bruto R$ 42.279,38, líquido R$ 32.470,98, total R$ 55.677,81 (idêntico ao montado na interface)'],
  'cartao-ponto-escala': ['calculo-cartao-ponto-escala.json', 'escala 12x36 noturna + jornadas lançadas dia a dia + adicional noturno pela coluna Hs Noturnas — 30/06/2016: bruto R$ 44.969,30, líquido R$ 35.189,38, total R$ 59.732,53 (idêntico ao montado na interface)'],
  diversos: ['calculo-diversos.json', 'INSS pela atividade econômica, verba personalizada com base composta (salário + horas extras), custas do reclamado e multa informadas, juros combinados, só o Carnaval como ponto facultativo — 30/06/2016: bruto R$ 37.753,53, líquido R$ 28.473,07, total R$ 48.420,97 (idêntico ao montado na interface)'],
  auditavel: ['calculo-auditavel.json', 'o caso de referência com o contrato de dados completo (documentos, decisão, parcelas com reflexos deferidos, remunerações com vigência, premissas) e "origem" em cada verba e histórico — chega ao estado "auditado"'],
  'recente-trt18': ['calculo-recente-trt18.json', 'contrato 2023-2024 no TRT18 com IPCA-E, IPCA e juros pela taxa legal a partir de 30/08/2024 (Lei 14.905/2024); liquidação em data recente — exige tabelas atualizadas (tabelas_atualizar)'],
  'inss-periodos': ['calculo-inss-periodos.json', 'o caso de referência com alíquotas da empresa, SAT e terceiros por período e opção pelo Simples — 30/06/2016: bruto R$ 31.320,10, total R$ 39.330,55 (idêntico ao montado na interface)'],
  'mes-a-mes': ['calculo-mes-a-mes.json', 'valores mês a mês nas ocorrências (verbas[].ocorrencias: pago de 03/2013 e quantidade de 06/2014 das horas extras; pago no reflexo de RSR), valor pago informado no reflexo de 13º, alíquota de 2% do FGTS só em 05/2014 (fgts.ocorrencias) e honorários periciais de 10% sobre a multa do art. 477 (honorarios[].verbas) — 30/06/2016: bruto R$ 29.404,36, líquido R$ 21.359,02, total R$ 38.305,71'],
  'ocorrencias-custas': ['calculo-ocorrencias-custas.json', 'o caso de referência com as ocorrências de FGTS (base e depositado por competência e em lote) e da contribuição social (salários devidos com 13º, salários pagos e contribuições recolhidas, por competência e em lote) e as custas fixas, um auto de arrematação e um armazenamento — 30/06/2016: bruto R$ 30.799,67, líquido R$ 23.057,73, total R$ 84.496,28 (idêntico ao montado na interface)'],
  execucao: ['execucao-pagamentos.json', 'bloco "execucao" para calculo_atualizar (sobre o cálculo de referência liquidado em 30/06/2016): dois pagamentos com imputação nos juros, recolhimento da contribuição social, honorários e multa da execução, atualização até 31/08/2016 — líquido R$ 13.704,89, total R$ 29.384,25 (conferido na tela)'],
  'execucao-pensao-custas': ['execucao-pensao-custas.json', 'bloco "execucao" para calculo_atualizar (sobre o mesmo cálculo de referência): pensão alimentícia de 30% a partir de 20/07/2016 sobre todas as verbas, FGTS e multa; custas da execução (atos do oficial de justiça e agravo de petição, auto de arrematação, armazenamento) e um pagamento que recolhe a pensão; atualização até 31/08/2016 — líquido R$ 11.649,75, pensão R$ 6.704,74, custas R$ 3.714,50, total R$ 38.698,67 (idêntico ao lançado à mão na tela)'],
  externo: ['calculo-externo.json', '"calculoExterno" para calculo_externo_criar: conta homologada feita fora do PJe-Calc (verbas tributáveis e não tributáveis, FGTS e multa, multa do art. 477, contribuição social, custas, honorários contratuais e sucumbenciais) na data-base 30/06/2016, atualizada até 31/08/2016 com um pagamento — líquido R$ 10.790,92, total R$ 22.090,75'],
};

server.registerTool('calculo_modelo_json', {
  title: 'Formato da especificação do cálculo',
  description: 'Devolve a documentação completa do JSON que descreve um cálculo (processo, calculo, historicosSalariais, faltas, ferias, cartoesDePonto, apuracaoCartaoPonto, verbas, fgts, contribuicaoSocial, irpf, pensaoAlimenticia, previdenciaPrivada, salarioFamilia, seguroDesemprego, honorarios, multas, custas, correcaoJuros...) e exemplos testados. LEIA ANTES de montar um cálculo.',
  inputSchema: z.object({
    exemplo: z.enum(['referencia', 'completo', 'cartao-ponto', 'cartao-ponto-escala', 'diversos', 'recente-trt18', 'auditavel', 'inss-periodos', 'mes-a-mes', 'ocorrencias-custas', 'execucao', 'execucao-pensao-custas', 'externo']).optional().describe('Devolve só este exemplo (JSON).'),
    somente_exemplo: z.boolean().optional().describe('Compatibilidade: devolve só o exemplo "referencia".'),
  }),
}, (args) => handler(() => {
  const ler = (k) => JSON.parse(fs.readFileSync(path.join(exemplosDir, EXEMPLOS[k][0]), 'utf-8'));
  if (args?.exemplo) return ler(args.exemplo);
  if (args?.somente_exemplo) return ler('referencia');
  const doc = fs.readFileSync(path.join(referencesDir, 'ESPECIFICACAO-CALCULO.md'), 'utf-8');
  const lista = Object.entries(EXEMPLOS).map(([k, [arq, d]]) => `- \`${k}\` (exemplos/${arq}): ${d}`).join('\n');
  return `${doc}\n\n## Exemplos testados (calculo_modelo_json com exemplo=<nome> devolve o JSON)\n\n${lista}\n\n## Exemplo completo (exemplos/calculo-completo.json)\n\n\`\`\`json\n${JSON.stringify(ler('completo'), null, 2)}\n\`\`\``;
}));

server.registerTool('processo_mapa', {
  title: 'Mapa do processo (fase e processos ligados)',
  description: 'Confere o mapa do processo em contrato.processos: o processo principal (fase: PRE_PROCESSUAL, CONHECIMENTO, RECURSAL, LIQUIDACAO, EXECUCAO_PROVISORIA, EXECUCAO, ENCERRADO; trabalho: CALCULO_NOVO, ATUALIZACAO, EXECUCAO_COLETIVA, HABILITACAO, ENTE_PUBLICO) e todos os processos ligados (conexo, litispendência, coisa julgada, ação anterior arquivada, protesto, coletiva, acordo, recuperação judicial, falência, prova emprestada, rescisória...), cada um com o efeito no cálculo e os documentos exigidos da relação. Acusa números de processo citados nos documentos e decisões que não estão no mapa, prescrição incompatível com o marco interruptivo, parcela já decidida em outro processo, data-limite de recuperação judicial, devedores, pagamentos da execução e destinos do crédito. Use logo no começo (etapa 0). Veja pjecalc://docs/modulos/processo.',
  inputSchema: z.object(ESPEC),
}, (args) => handler(() => {
  const spec = lerEspecificacao(args);
  const a = svc.validarEspecificacao(spec).auditoria;
  const docsDoMapa = a.documentacao ? a.documentacao.requisitos.filter((r) => /^(REL|FASE):/.test(r.id)) : [];
  return { mapa: a.processo, verificacoes: a.verificacoes.filter((v) => v.dimensao === 'processo'), documentosDoMapa: docsDoMapa, provisorio: a.provisorio };
}));

server.registerTool('titulo_compor', {
  title: 'Compor o título executivo (cadeia de decisões)',
  description: 'Monta a matriz de capítulos: para cada parcela e critério (ATUALIZACAO, HONORARIOS, CUSTAS...), a cadeia de decisões de todas as instâncias (vara, TRT, TST, STF, liquidação, execução), a decisão que vale (efeito substitutivo; recurso não conhecido não substitui; embargos integram; anulação com retorno), a situação e o trânsito por capítulo. Acusa capítulo sem decisão, decisão mal registrada, reforma por recurso não conhecido, capítulo anulado sem nova decisão, recurso pendente fora de execução provisória, conflito entre dispositivo e fundamentação, parcela que cita decisão superada e critério de correção que contraria precedente vinculante. Veja pjecalc://docs/modulos/titulo-executivo e pjecalc://docs/precedentes.',
  inputSchema: z.object(ESPEC),
}, (args) => handler(() => {
  const a = svc.validarEspecificacao(lerEspecificacao(args)).auditoria;
  return { capitulos: a.titulo, verificacoes: a.verificacoes.filter((v) => v.dimensao === 'titulo'), provisorio: a.provisorio };
}));

server.registerTool('calculo_plano_interpretacao', {
  title: 'Plano de interpretação (para o usuário aprovar)',
  description: 'Gera o plano de interpretação legível (markdown) a partir do contrato e da especificação: processo, fase e processos ligados; matriz do título; cada parcela com comando, folha, trecho, período, reflexos e como será calculada no PJe-Calc; critérios gerais; eventos, pagamentos e destinos do crédito; premissas; conflitos, alertas, pendências e perguntas. MOSTRE o plano ao usuário e peça a aprovação ANTES de calcular. Devolve o hash do contrato a ser aprovado.',
  inputSchema: z.object(ESPEC),
}, (args) => handler(() => {
  const spec = lerEspecificacao(args);
  return plano.planoInterpretacao(spec, svc.validarEspecificacao(spec).auditoria);
}));

server.registerTool('calculo_aprovar_plano', {
  title: 'Registrar a aprovação do plano pelo usuário',
  description: 'Use SOMENTE depois que o usuário aprovou o plano de interpretação na conversa. Devolve o objeto contrato.aprovacao (quem, quando, observações, hash do contrato aprovado) para gravar na especificação; com arquivo_json e gravar=true, grava no próprio arquivo. Recusa se a auditoria tiver falhas. Qualquer mudança posterior no contrato ou no cenário invalida a aprovação.',
  inputSchema: z.object({
    ...ESPEC,
    por: z.string().describe('Quem aprovou (nome do usuário).'),
    observacoes: z.string().optional().describe('Correções ou ressalvas feitas pelo usuário ao aprovar.'),
    gravar: z.boolean().optional().describe('Com arquivo_json: grava a aprovação no arquivo.'),
  }),
}, (args) => handler(() => {
  const spec = lerEspecificacao(args);
  const a = svc.validarEspecificacao(spec).auditoria;
  if (!a.temContrato) throw new Error('Sem contrato de dados não há plano a aprovar.');
  const falhas = a.verificacoes.filter((v) => v.estado === 'falha');
  if (falhas.length) throw new Error(`O plano tem ${falhas.length} falha(s) e não pode ser aprovado:\n- ${falhas.slice(0, 15).map((v) => `${v.item}: ${v.detalhe}`).join('\n- ')}`);
  const aprovacao = { por: String(args.por), em: new Date().toISOString(), observacoes: args.observacoes || undefined, hashContrato: plano.hashContrato(spec) };
  if (args.arquivo_json && args.gravar) {
    const arq = path.resolve(String(args.arquivo_json));
    spec.contrato.aprovacao = aprovacao;
    fs.writeFileSync(arq, `${JSON.stringify(spec, null, 2)}\n`);
    return { gravado: arq, aprovacao };
  }
  return { aprovacao, instrucao: 'Grave este objeto em contrato.aprovacao, sem mudar mais nada no contrato.' };
}));

server.registerTool('calculo_documentos_necessarios', {
  title: 'Documentos necessários ao cálculo (pedido ao usuário)',
  description: 'PRIMEIRO PASSO de todo cálculo. Diz quais documentos o caso exige (sentença, decisões posteriores, registro, TRCT, holerites de todo o período, cartões de ponto, recibos de férias e 13º, extrato do FGTS, norma coletiva...), confere se os recebidos cobrem todos os meses, lista as perguntas que só o usuário responde e devolve um texto pronto para pedir o que falta ("pedido"). Use com a especificação (mesmo parcial, com contrato.documentos e contrato.coleta) ou, antes dela, com respostas rápidas: parcelas deferidas, datas e documentos já recebidos. Repita a cada rodada até "completa": true. Veja pjecalc://docs/modulos/documentos.',
  inputSchema: z.object({
    ...ESPEC,
    parcelas: z.array(z.string()).optional().describe('Sem especificação: parcelas deferidas (ex.: ["HORAS EXTRAS 50%", "FGTS + 40%"]).'),
    admissao: z.string().optional().describe('Sem especificação: data de admissão.'),
    demissao: z.string().optional().describe('Sem especificação: data de saída.'),
    documentos_recebidos: z.array(z.object({
      tipo: z.string().describe('Ex.: SENTENCA, ACORDAO_TRT, TRCT, HOLERITES, CARTOES_DE_PONTO, EXTRATO_FGTS.'),
      identificacao: z.string().optional(),
      periodo_inicio: z.string().optional().describe('Primeiro mês coberto (AAAA-MM).'),
      periodo_fim: z.string().optional().describe('Último mês coberto (AAAA-MM).'),
      lacunas: z.array(z.string()).optional().describe('Meses faltantes dentro do período (AAAA-MM).'),
    })).optional().describe('Sem especificação: documentos já recebidos.'),
  }),
}, (args) => handler(() => {
  const spec = args.especificacao || args.arquivo_json ? lerEspecificacao(args)
    : docs.especificacaoMinima({ parcelas: args.parcelas || [], admissao: args.admissao || null, demissao: args.demissao || null, documentos: args.documentos_recebidos || [] });
  const av = docs.avaliarDocumentacao(spec);
  return {
    completa: av.completa,
    proximaRodada: av.proximaRodada,
    rodadas: { 1: 'título e decisões (para saber o que foi deferido)', 2: 'documentos de cada parcela e meses faltantes', 3: 'perguntas que só o usuário responde' },
    pedido: docs.textoPedido(av),
    requisitos: av.requisitos,
    inconsistencias: av.registros,
    perguntas: av.perguntas,
  };
}));

// ---------------------------------------------------------------------------
// Ferramentas — leitura e conversão de documentos (organizam e conferem; não substituem a leitura)
// ---------------------------------------------------------------------------

server.registerTool('documento_inventario', {
  title: 'Inventário dos documentos (arquivos e páginas)',
  description: 'Lista cada arquivo (PDF, imagem, texto): hash sha256, número de páginas, páginas com e sem texto (as sem texto são escaneadas e precisam ser VISTAS como imagem), páginas com imagem, tipo provável (sentença, TRCT, holerites, cartões, extrato do FGTS...) e números de processo citados. Devolve a sugestão de contrato.documentos e o esqueleto de contrato.leitura (classificar TODAS as páginas: usadas, irrelevantes com motivo, ilegíveis com pedido). Use logo que receber os documentos (etapa 2). Veja pjecalc://docs/modulos/leitura.',
  inputSchema: z.object({
    arquivos: z.array(z.string()).optional().describe('Caminhos dos arquivos.'),
    pasta: z.string().optional().describe('Alternativa: pasta com os documentos.'),
    processo: z.string().optional().describe('Id do processo de origem (contrato.processos) para as sugestões.'),
    prefixo: z.string().optional().describe('Prefixo dos ids sugeridos (padrão "D").'),
  }),
}, (args) => handler(() => conv.inventarioDocumentos({ arquivos: args.arquivos || [], pasta: args.pasta || null, processo: args.processo || null, prefixo: args.prefixo || 'D' })));

server.registerTool('auditor_importar', {
  title: 'Importar a leitura do AuditorProcessual',
  description: 'Lê a saída do AuditorProcessual (github.com/lucianumm/AuditorProcessual): as pastas do ingest_document.py (uma por arquivo: manifest.json, pages.jsonl, pendências) e, se houver, o livro-razão da jornada e da folha (labor_ledger), os eventos do contrato (labor_events) e a revisão com os fatos (página e trecho). Devolve sugestões para a especificação: contrato.documentos por peça (com o tipo provável), contrato.leitura (páginas sem texto nativo a ver como imagem, falhas de extração), o número do processo mais citado e os demais citados, apuracaoCartaoPonto.jornadas com as conferências do conversor de cartões, contrato.remuneracoes, contrato.pagamentos, contrato.afastamentos e datas do contrato, cada item com documento, folha e trecho quando os fatos os trazem. Sugestão não é leitura: confira cada página. Veja pjecalc://docs/modulos/leitura.',
  inputSchema: z.object({
    pastas: z.array(z.string()).describe('Pastas de saída do ingest_document.py do AuditorProcessual (uma por arquivo dos autos).'),
    ledger: z.string().optional().describe('Arquivo labor_ledger (jornada dia a dia e folha de pagamento), se houver.'),
    eventos: z.string().optional().describe('Arquivo labor_events (contratação, afastamentos, rescisão), se houver.'),
    revisao: z.string().optional().describe('Revisão do AuditorProcessual com os fatos (id, página e trecho), para ligar cada item ao documento e à folha.'),
    numero_processo: z.string().optional().describe('Número CNJ do processo, para conferir o que o AuditorProcessual identificou.'),
    processo: z.string().optional().describe('Id do processo em contrato.processos para as sugestões.'),
    prefixo: z.string().optional().describe('Prefixo dos ids de documento sugeridos (padrão "D").'),
  }),
}, (args) => handler(async () => {
  const { importarAuditor } = await import('./lib/auditor.mjs');
  return importarAuditor({ pastas: args.pastas, ledger: args.ledger || null, eventos: args.eventos || null, revisao: args.revisao || null, numeroProcesso: args.numero_processo || null, processo: args.processo || null, prefixo: args.prefixo || 'D' });
}));

server.registerTool('documento_texto', {
  title: 'Texto de um documento por página',
  description: 'Texto extraído página por página de um PDF (ou arquivo de texto), para localizar trechos e conferir números. Página sem texto próprio vem marcada (o carimbo de assinatura do PJe não conta): é escaneada, veja como imagem com documento_imagens (o MCP não faz OCR). O texto pode sair fora da ordem visual das colunas: confira sempre na página.',
  inputSchema: z.object({
    arquivo: z.string().describe('Caminho do PDF ou do arquivo de texto.'),
    paginas: z.string().optional().describe('Ex.: "1-3,7" (padrão: todas).'),
    max_caracteres: z.number().int().optional().describe('Padrão 60000.'),
  }),
}, (args) => handler(() => conv.textoDocumento({ arquivo: args.arquivo, paginas: args.paginas || null, maxCaracteres: args.max_caracteres || 60000 })));

server.registerTool('documento_imagens', {
  title: 'Imagens das páginas escaneadas de um PDF',
  description: 'Grava em arquivos as imagens das páginas de um PDF (JPEG como está; as demais em PNG), sem depender de programa externo, para você VER as páginas escaneadas: holerites, cartões de ponto, TRCT, recibos, atestados. Por página, a imagem "principal" (a maior) é em geral a página inteira; logotipos pequenos ficam de fora. Use nas páginas que documento_inventario marca sem texto (o carimbo de assinatura do PJe não conta como texto). Formatos CCITT, JBIG2 e JPEG 2000 não são convertidos e aparecem em "avisos". O MCP não faz OCR: leia a imagem e transcreva com a folha.',
  inputSchema: z.object({
    arquivo: z.string().describe('Caminho do PDF.'),
    paginas: z.string().optional().describe('Ex.: "24-39,56-92" (padrão: todas).'),
    destino: z.string().optional().describe('Pasta dos arquivos (padrão: "<nome do PDF>-paginas" ao lado do PDF).'),
  }),
}, (args) => handler(() => conv.imagensDocumento({ arquivo: args.arquivo, paginas: args.paginas || null, destino: args.destino || null })));

server.registerTool('holerites_para_historicos', {
  title: 'Holerites transcritos -> históricos salariais',
  description: 'Recebe a transcrição dos holerites (competência, rubricas com código, descrição, referência, valor e tipo P/D, totais e líquido, documento e folha) e o agrupamento das rubricas em históricos ({ nome, rubricas: [códigos ou descrições], fgts, inss }). Confere o fechamento de cada holerite (proventos − descontos = líquido), acusa competências faltantes no período, proventos que não entraram em histórico e meses sem a rubrica; devolve historicosSalariais (ocorrências com _origem) e contrato.remuneracoes (vigências).',
  inputSchema: z.object({
    holerites: z.array(z.record(z.string(), z.unknown())).describe('Holerites transcritos: { competencia, rubricas: [{ codigo, descricao, referencia, valor, tipo P|D }], totais, liquido, documento, folha }.'),
    historicos: z.array(z.record(z.string(), z.unknown())).optional().describe('Agrupamento das rubricas em históricos: [{ nome, rubricas: [códigos ou descrições], fgts, inss }].'),
    periodo: z.object({ inicio: z.string(), fim: z.string() }).optional().describe('Período do contrato (aaaa-mm), para acusar competências faltantes.'),
  }),
}, (args) => handler(() => conv.holeritesParaHistoricos({ holerites: args.holerites, historicos: args.historicos || [], periodo: args.periodo || null })));

server.registerTool('cartoes_para_jornadas', {
  title: 'Cartões de ponto transcritos -> jornadas',
  description: 'Recebe as marcações dia a dia ({ data, marcacoes: ["08:00","12:00",...] } ou { data, turnos } ou { data, ocorrencia: FOLGA|FERIAS|FALTA|ATESTADO|FERIADO|DSR }) e devolve apuracaoCartaoPonto.jornadas. Acusa dia do período sem registro, número ímpar de marcações, turnos impossíveis (sobrepostos, > 16 h, > 20 h no dia), interjornada < 11 h e horários invariáveis (Súmula 338, III, do TST).',
  inputSchema: z.object({
    dias: z.array(z.record(z.string(), z.unknown())).describe('Marcações dia a dia: { data, marcacoes: ["08:00", "12:00", ...] }, { data, turnos } ou { data, ocorrencia }.'),
    periodo: z.object({ inicio: z.string(), fim: z.string() }).optional().describe('Período a conferir (aaaa-mm-dd), para acusar dias sem registro.'),
    dias_sem_marcacao: z.array(z.number().int()).optional().describe('Dias da semana sem trabalho (0=domingo ... 6=sábado). Padrão [0].'),
  }),
}, (args) => handler(() => conv.cartoesParaJornadas({ dias: args.dias, periodo: args.periodo || null, diasSemMarcacao: args.dias_sem_marcacao || [0] })));

server.registerTool('extrato_para_fgts', {
  title: 'Extrato do FGTS -> depósitos (fgts.operacoes)',
  description: 'Recebe os lançamentos do extrato analítico do FGTS ({ competencia, data, valor, tipo: DEPOSITO|JAM|SAQUE|MULTA }) e o saldo final; devolve fgts.operacoes (depósitos e saques a deduzir), os depósitos por competência e as conferências: soma dos lançamentos = saldo; competências do período sem depósito.',
  inputSchema: z.object({
    lancamentos: z.array(z.record(z.string(), z.unknown())).describe('Lançamentos do extrato analítico: { competencia, data, valor, tipo DEPOSITO|JAM|SAQUE|MULTA }.'),
    saldo: z.number().optional().describe('Saldo final do extrato, para conferir a soma dos lançamentos.'),
    periodo: z.object({ inicio: z.string(), fim: z.string() }).optional().describe('Período do contrato (aaaa-mm), para acusar competências sem depósito.'),
    documento: z.string().optional().describe('Id do extrato em contrato.documentos (vira a origem das operações).'),
  }),
}, (args) => handler(() => conv.extratoParaFgts({ lancamentos: args.lancamentos, saldo: args.saldo ?? null, periodo: args.periodo || null, documento: args.documento || null })));

server.registerTool('trct_para_pagamentos', {
  title: 'TRCT transcrito -> pagamentos do contrato',
  description: 'Recebe os campos do TRCT ({ codigo, descricao, valor, tipo P/D }), os totais (bruto, descontos, líquido), a data do pagamento, o documento e a folha; devolve contrato.pagamentos (um por provento, com a parcela provável pelo código do campo — Portaria MTE 1.621/2010) e as conferências da soma dos campos com os totais. Ligue cada pagamento à parcela do contrato antes de abater.',
  inputSchema: z.object({
    campos: z.array(z.record(z.string(), z.unknown())).describe('Campos do TRCT: { codigo, descricao, valor, tipo P|D }.'),
    totais: z.object({ bruto: z.number().optional(), descontos: z.number().optional(), liquido: z.number().optional() }).optional().describe('Totais do TRCT (bruto, descontos, líquido), para conferir a soma dos campos.'),
    data: z.string().optional().describe('Data do pagamento das verbas rescisórias (aaaa-mm-dd).'),
    documento: z.string().optional().describe('Id do TRCT em contrato.documentos.'),
    folha: z.string().optional().describe('Folha do TRCT nos autos.'),
  }),
}, (args) => handler(() => conv.trctParaPagamentos({ campos: args.campos, totais: args.totais || {}, data: args.data || null, documento: args.documento || null, folha: args.folha || null })));

server.registerTool('calculo_validar', {
  title: 'Validar especificação do cálculo',
  description: 'Validação técnica + auditoria, SEM gerar arquivo nem tocar no PJe-Calc. A auditoria (campo "auditoria") confere o contrato de dados: cada verba, reflexo, histórico e abatimento ligado a decisões e documentos, pagamento usado duas vezes, salário fora da vigência, trabalho em afastamento, ciclo de escala, base duplicada etc.; sem contrato fica "não verificado". Validação técnica: datas, número CNJ (dígito verificador), CPF/CNPJ, município, nomes de verbas e reflexos do catálogo, históricos usados como base, enums. Devolve erros (impedem gerar), avisos e um resumo do que será montado (verbas ativas, férias calculadas etc.).',
  inputSchema: z.object(ESPEC),
}, (args) => handler(() => svc.validarEspecificacao(lerEspecificacao(args))));

server.registerTool('calculo_gerar_pjc', {
  title: 'Gerar arquivo .PJC',
  description: 'Gera o arquivo .PJC (formato oficial de exportação/importação do PJe-Calc) a partir da especificação. Não precisa do PJe-Calc aberto. O arquivo pode ser importado em qualquer PJe-Calc 2.16.x (Cálculo > Importar). Depois da importação é preciso clicar em Verbas > Regerar (ou usar calculo_importar_pjc, que faz isso). Com "apuracaoCartaoPonto" grava também <arquivo>.mcp.json com os passos pós-importação (apurar o cartão e ligar as verbas às colunas), que calculo_importar_pjc executa.',
  inputSchema: z.object({
    ...ESPEC,
    destino: z.string().optional().describe('Arquivo .PJC ou pasta de destino (padrão: pjecalc-mcp-skill/saida).'),
  }),
}, (args) => handler(() => svc.gerarArquivo(lerEspecificacao(args), args?.destino || null)));

server.registerTool('calculo_criar', {
  title: 'Criar cálculo completo no PJe-Calc',
  description: 'Fluxo completo e recomendado para montar um cálculo. Valida a especificação, gera o .PJC, inicia o PJe-Calc se preciso, importa, apura o cartão de ponto por jornadas e liga as verbas às colunas, regera as ocorrências de verbas e reflexos e devolve o número do cálculo, as pendências da tela de liquidação e o "-PRONTO.PJC" (importável em qualquer PJe-Calc 2.16.x). Com liquidar_em, liquida e confere: justificativa, soma do resumo, recálculo independente das ocorrências e dos encargos, especificação × arquivo × relatório; grava o -LIQUIDADO.PJC, o relatório completo -RELATORIO.pdf e o registro de reprodução. Devolve "estado" (rascunho, aceito_pelo_aplicativo, calculado, simulacao, auditado), "verificacoes" e "bloqueiosDeEntrega"; a revisão para entrega é sempre humana. Com contrato de dados, não gera nada enquanto faltar documento obrigatório, houver falha na auditoria ou o plano de interpretação não estiver aprovado: devolve as travas e o pedido de documentos.',
  inputSchema: z.object({
    ...ESPEC,
    destino: z.string().optional().describe('Onde gravar o .PJC (padrão: pjecalc-mcp-skill/saida).'),
    iniciar: z.boolean().optional().describe('Inicia o PJe-Calc se estiver parado (padrão true).'),
    liquidar_em: z.string().optional().describe('Opcional: data (dd/mm/aaaa ou aaaa-mm-dd) para uma liquidação de TESTE (o usuário pode liquidar de novo depois).'),
    exportar_final: z.boolean().optional().describe('Grava o "-PRONTO.PJC" exportado após a importação (padrão true).'),
    atualizar_tabelas: z.boolean().optional().describe('Se as tabelas de índices não cobrirem a liquidação, atualiza-as pelo TRT do processo (Atualização de Tabelas e Índices > Online). Padrão false: só avisa.'),
    ignorar_tabelas: z.boolean().optional().describe('Faz a liquidação de teste mesmo com tabelas desatualizadas (o resultado ficará errado).'),
  }),
}, (args) => handler(async () => {
  const spec = lerEspecificacao(args);
  const v = svc.validarEspecificacao(spec);
  if (!v.valido) return { criado: false, erros: v.erros, avisos: v.avisos };
  if (!v.prontoParaCalcular) {
    return {
      criado: false,
      motivo: 'O cálculo não foi gerado: resolva as travas abaixo (documentos, mapa do processo, título, falhas da auditoria) e obtenha a aprovação do plano de interpretação pelo usuário.',
      bloqueios: v.bloqueiosParaCalcular,
      pedidoDeDocumentos: v.pedidoDeDocumentos,
      pendencias: v.auditoria.documentacao ? v.auditoria.documentacao.requisitos.filter((r) => r.obrigatorio && r.status !== 'ok') : [],
      falhas: v.auditoria.verificacoes.filter((x) => x.estado === 'falha').map((x) => `${x.item}: ${x.detalhe}`),
      aprovacao: v.auditoria.aprovacao,
    };
  }
  return svc.criarCalculo(spec, { destino: args?.destino || null, iniciar: args?.iniciar !== false, liquidarEm: args?.liquidar_em || null, exportarFinal: args?.exportar_final !== false, atualizarTabelas: Boolean(args?.atualizar_tabelas), ignorarTabelas: Boolean(args?.ignorar_tabelas) });
}));

server.registerTool('calculo_importar_pjc', {
  title: 'Importar .PJC no PJe-Calc',
  description: 'Importa um arquivo .PJC (gerado pelo MCP ou exportado de outro PJe-Calc) no PJe-Calc em execução, executa os passos pós-importação de <arquivo>.mcp.json se existir (apuração do cartão de ponto e vínculos das verbas), regera as ocorrências (padrão) e devolve número do cálculo e pendências.',
  inputSchema: z.object({
    arquivo: z.string().describe('Caminho do .PJC.'),
    regerar: z.boolean().optional().describe('Regera as ocorrências após importar (padrão true).'),
    iniciar: z.boolean().optional().describe('Inicia o PJe-Calc se estiver parado (padrão true).'),
    exportar_final: z.boolean().optional().describe('Grava "<arquivo>-PRONTO.PJC" exportado depois da importação (padrão: só quando houve passos pós-importação).'),
  }),
}, (args) => handler(() => svc.importarArquivo(path.resolve(args.arquivo), { regerar: args.regerar !== false, iniciar: args.iniciar !== false, exportarFinal: args.exportar_final })));

server.registerTool('calculo_apurar_cartao_ponto', {
  title: 'Apurar o cartão de ponto (jornadas) de um cálculo',
  description: 'Para um cálculo já no PJe-Calc com apurações de cartão de ponto cadastradas: salva cada apuração (o PJe-Calc gera as jornadas pela programação/escala, respeitando feriados, férias e faltas), clica em Apurar Cartão de Ponto (cria as colunas Hs EXT, Hs Trabalhadas, Hs Noturnas...) e, se pedido, liga verbas às colunas (quantidade ou divisor importados do cartão). Devolve o quadro mensal apurado. O botão Apurar só existe enquanto o cálculo não tem cartões; para refazer, exclua os cartões em Cartão de Ponto > Visualizar Cartão.',
  inputSchema: z.object({
    id_calculo: z.number().int().describe('Número do cálculo no PJe-Calc.'),
    vinculos: z.array(z.object({
      verba: z.string().describe('Nome da verba no cálculo.'),
      cartao: z.string().describe('Coluna do cartão (ex.: "Hs EXT").'),
      tipo: z.enum(['QUANTIDADE', 'DIVISOR']).optional(),
    })).optional().describe('Verbas a ligar às colunas apuradas (quantidade ou divisor importados do cartão).'),
    regerar: z.boolean().optional().describe('Regera as ocorrências das verbas no fim (padrão true).'),
  }),
}, (args) => handler(async () => {
  await svc.garantirPjeCalc({ iniciar: false });
  let op = new OperadorPjeCalc();
  await op.abrirCalculo(args.id_calculo);
  const out = { cartaoDePonto: await op.apurarCartaoDePonto(), vinculos: [] };
  for (const v of args.vinculos || []) {
    await op.vincularCartaoNaVerba(v.verba, v.tipo || 'QUANTIDADE', v.cartao);
    out.vinculos.push(`${v.verba} <- ${v.cartao}`);
  }
  if (args.regerar !== false) {
    // sessão nova: na mesma conversa das telas de cartão/verba o Regerar deixa as outras verbas sem ocorrências
    op = new OperadorPjeCalc();
    await op.abrirCalculo(args.id_calculo);
    out.regeracao = await op.regerarOcorrencias({});
    out.pendencias = await op.pendencias();
  }
  return out;
}));

server.registerTool('calculo_ler_pjc', {
  title: 'Ler um arquivo .PJC',
  description: 'Resumo legível de um .PJC: processo, partes, datas, históricos salariais, verbas (base, quantidade, reflexos ativos), férias, faltas, FGTS, honorários, multas, correção e juros. Serve para conferir um arquivo gerado ou entender um cálculo exportado.',
  inputSchema: z.object({ arquivo: z.string().describe('Caminho do .PJC.') }),
}, (args) => handler(() => svc.lerArquivo(path.resolve(args.arquivo))));

server.registerTool('calculo_pendencias', {
  title: 'Pendências do cálculo (validação do PJe-Calc)',
  description: 'Abre o cálculo no PJe-Calc e lê o quadro "Pendências do Cálculo" da tela Liquidar, SEM liquidar: erros (impedem a liquidação) e alertas. É a validação oficial do aplicativo.',
  inputSchema: z.object({ id_calculo: z.number().int().describe('Número do cálculo no PJe-Calc.') }),
}, (args) => handler(async () => {
  await svc.garantirPjeCalc({ iniciar: false });
  const op = new OperadorPjeCalc();
  await op.abrirCalculo(args.id_calculo);
  return op.pendencias();
}));

server.registerTool('calculo_regerar_ocorrencias', {
  title: 'Regerar ocorrências das verbas',
  description: 'Verbas > selecionar todas (inclusive reflexos ativos) > Regerar. Necessário depois de importar ou de mudar parâmetros. manter_alteracoes=true preserva ocorrências editadas à mão.',
  inputSchema: z.object({
    id_calculo: z.number().int().describe('Número do cálculo no PJe-Calc.'),
    manter_alteracoes: z.boolean().optional().describe('Mantém as alterações feitas à mão nas ocorrências (padrão: regera tudo).'),
  }),
}, (args) => handler(async () => {
  await svc.garantirPjeCalc({ iniciar: false });
  const op = new OperadorPjeCalc();
  await op.abrirCalculo(args.id_calculo);
  return op.regerarOcorrencias({ manterAlteracoes: Boolean(args.manter_alteracoes) });
}));

server.registerTool('calculo_liquidar', {
  title: 'Liquidar cálculo (teste ou a pedido do usuário)',
  description: 'Liquida o cálculo no PJe-Calc (Operações > Liquidar) e devolve os totais do Resumo do Cálculo (bruto, líquido, total devido pelo reclamado, valores por verba). Normalmente quem liquida é o usuário; use para conferir o resultado ou quando ele pedir.',
  inputSchema: z.object({
    id_calculo: z.number().int().describe('Número do cálculo no PJe-Calc.'),
    data_liquidacao: z.string().optional().describe('dd/mm/aaaa ou aaaa-mm-dd (padrão: a sugerida pelo PJe-Calc).'),
    acumular_indices: z.enum(['MES_SUBSEQUENTE_AO_VENCIMENTO', 'MES_DO_VENCIMENTO', 'MES_SUBSEQUENTE_E_MES_DO_VENCIMENTO']).optional().describe('Desde quando acumular os índices de correção: mês subsequente ao vencimento, mês do vencimento ou a combinação dos dois (padrão: o da tela).'),
    regional: z.enum(TRTS).optional().describe('TRT do processo, usado se for preciso atualizar as tabelas.'),
    atualizar_tabelas: z.boolean().optional().describe('Atualiza as tabelas de índices (online, pelo TRT informado) se não cobrirem a data de liquidação.'),
    ignorar_tabelas: z.boolean().optional().describe('Liquida mesmo com tabelas desatualizadas (não recomendado).'),
    regerar: z.boolean().optional().describe('Regera as ocorrências (mantendo alterações manuais) antes de liquidar. Use depois de tabelas_atualizar; é automático quando a própria chamada atualiza as tabelas.'),
  }),
}, (args) => handler(() => svc.liquidarCalculo(args.id_calculo, { dataLiquidacao: args.data_liquidacao || null, acumularIndices: args.acumular_indices || null, regional: args.regional || null, atualizarTabelas: Boolean(args.atualizar_tabelas), ignorarTabelas: Boolean(args.ignorar_tabelas), regerar: Boolean(args.regerar) })));

server.registerTool('calculo_atualizar', {
  title: 'Atualizar cálculo homologado (execução: pagamentos e eventos)',
  description: 'Fase de execução: atualiza um cálculo LIQUIDADO (arquivo_pjc exportado depois de liquidar, ou id_calculo) com o bloco "execucao": dataAtualizacao, pagamentos (com a divisão entre crédito do reclamante, recolhimentos, outros débitos e débitos a cobrar), honorários e multas da execução, pensão alimentícia, custas da execução (fixas, autos e armazenamento), precatório ou RPV, cobrarEncargosIrpf. Todos os campos e exemplos em pjecalc://docs/modulos/execucao e em calculo_modelo_json (exemplos "execucao" e "execucao-pensao-custas"). Confere antes de importar as regras da tela de pagamento do PJe-Calc (MSG0125 a MSG0138, MSG0181, MSG0126, MSG0003), grava os eventos numa CÓPIA do cálculo, roda "Liquidar Atualização" (rateio e imputação do próprio PJe-Calc) e devolve o Resumo da Atualização (saldo por credor, total do reclamado, eventos), as verificações e o "-ATUALIZADO.PJC". O cálculo de origem não é alterado.',
  inputSchema: z.object({
    arquivo_pjc: z.string().optional().describe('.PJC do cálculo liquidado (exportado depois de liquidar).'),
    id_calculo: z.number().int().optional().describe('Alternativa: número do cálculo liquidado no PJe-Calc (é exportado e copiado).'),
    execucao: z.record(z.string(), z.unknown()).describe('Bloco "execucao" (formato em calculo_modelo_json e no módulo execução).'),
    destino: z.string().optional().describe('Pasta dos arquivos -EXECUCAO.PJC e -ATUALIZADO.PJC (padrão: ao lado do arquivo de origem ou saida/).'),
    iniciar: z.boolean().optional().describe('Inicia o PJe-Calc se estiver parado (padrão true).'),
  }),
}, (args) => handler(() => svc.atualizarCalculo({ arquivo: args.arquivo_pjc || null, idCalculo: args.id_calculo ?? null, execucao: args.execucao, destino: args.destino || null, iniciar: args.iniciar !== false })));

server.registerTool('calculo_externo_criar', {
  title: 'Cálculo Externo (conta homologada feita fora do PJe-Calc)',
  description: 'Cria no PJe-Calc um Cálculo Externo: a conta homologada feita fora do aplicativo (perito, contadoria, acordo), com os valores consolidados na data-base, para o PJe-Calc atualizar. Preenche pela interface as telas "Novo Cálculo Externo" (processo, partes, data-base, índice, juros, FGTS, IR, contribuição social, custas) e "Parcelas Atualizáveis" (creditos, descontos, outrosDebitos, debitosReclamante); ao salvar, o próprio PJe-Calc converte as parcelas num cálculo liquidado na data-base. Todos os campos e um exemplo em pjecalc://docs/modulos/execucao e em calculo_modelo_json (exemplo "externo"). Exporta o .PJC e, com "execucao", atualiza a cópia como calculo_atualizar.',
  inputSchema: z.object({
    calculoExterno: z.record(z.string(), z.unknown()).describe('Especificação do Cálculo Externo (processo, dataBase, parametros, creditos, descontos, outrosDebitos, debitosReclamante, execucao).'),
    destino: z.string().optional().describe('Pasta dos arquivos (padrão: saida/).'),
    iniciar: z.boolean().optional().describe('Inicia o PJe-Calc se estiver parado (padrão true).'),
  }),
}, (args) => handler(() => svc.criarCalculoExterno(args.calculoExterno, { destino: args.destino || null, iniciar: args.iniciar !== false })));

server.registerTool('tabelas_status', {
  title: 'Situação das tabelas de índices do PJe-Calc',
  description: 'Lê no PJe-Calc em execução a competência/data mais recente de cada índice (Tabela Única JT, IPCA-E, IPCA, INPC, TR, SELIC simples e composta, tabela diária de débitos, juros pela taxa legal). Com data_liquidacao diz se as tabelas cobrem a liquidação (até 2 meses de defasagem). Use antes de liquidar cálculos recentes.',
  inputSchema: z.object({
    data_liquidacao: z.string().optional().describe('dd/mm/aaaa (padrão: hoje).'),
  }),
}, (args) => handler(async () => {
  await svc.garantirPjeCalc({ iniciar: true });
  return svc.verificarTabelas({ dataLiquidacao: args?.data_liquidacao || null });
}));

server.registerTool('tabelas_atualizar', {
  title: 'Atualizar tabelas e índices do PJe-Calc',
  description: 'Executa Tabelas > Atualização de Tabelas e Índices > Online no PJe-Calc: o próprio aplicativo baixa as tabelas nacionais e as do TRT informado (se o TRT recusar, pelo proxy nacional do TRT8) e as aplica (10 a 60 s). Use o TRT do processo (o dígito TR do número CNJ: ...5.18.... = TRT18): as tabelas regionais de outros TRTs são substituídas. Requer internet. Devolve a situação das tabelas depois.',
  inputSchema: z.object({
    regional: z.enum(TRTS).describe('TRT do processo (TRT1..TRT24).'),
  }),
}, (args) => handler(async () => {
  await svc.garantirPjeCalc({ iniciar: true });
  const { atualizarTabelas } = await import('./lib/tabelas.mjs');
  const r = await atualizarTabelas({ regional: args.regional });
  if (!r.atualizado) {
    let erros = [];
    try { erros = await life.errosRecentes({ max: 10 }); } catch { /* sem log */ }
    return { ...r, errosRecentesDoServidor: erros, dica: 'Confira a conexão com https://pje.trt8.jus.br (o PJe-Calc usa a própria JRE). Se persistir, faça a atualização pela interface do PJe-Calc.' };
  }
  let bibliotecaDeVerbas = null;
  try { bibliotecaDeVerbas = await svc.alinharBibliotecaDeVerbas(); } catch (e) { bibliotecaDeVerbas = { atualizada: false, erro: e.message }; }
  return { ...r, situacao: await svc.verificarTabelas({}), ...(bibliotecaDeVerbas ? { bibliotecaDeVerbas } : {}), atencao: 'Cálculos que já estavam no PJe-Calc precisam ter as ocorrências regeradas com as tabelas novas: use calculo_liquidar com regerar=true (ou calculo_regerar_ocorrencias com manter_alteracoes=true) antes de liquidar.' };
}));

server.registerTool('calculo_relatorio', {
  title: 'Relatório do cálculo liquidado',
  description: 'Gera o relatório do PJe-Calc (Operações > Imprimir) de um cálculo já liquidado. Padrão: o relatório COMPLETO, com as seções que se aplicam ao cálculo (resumo, dados, faltas e férias, histórico salarial, cartão de ponto mensal e diário, demonstrativo das verbas com base, divisor, multiplicador e quantidade, juros, FGTS, contribuição social, eSocial, IR, multas, honorários, custas, justificativa). Formato HTML devolve o texto (e os totais extraídos do Resumo); formato PDF grava o arquivo. Tipos avulsos: RESUMO_DE_CALCULO, DADOS_DO_CALCULO, DEMONSTRATIVO_DE_CALCULO, APURACAO_DE_JUROS, DEMONSTRATIVO_FGTS, DEMONSTRATIVO_INSS, DEMONSTRATIVO_IRPF, DEMONSTRATIVO_HONORARIO, DEMONSTRATIVO_CUSTAS, DEMONSTRATIVO_MULTA, HISTORICO_SALARIAL, FALTAS_E_FERIAS, JUSTIFICATIVA, RESUMO_PRECATORIO, DEMONSTRATIVO_ESOCIAL_INSS_FGTS.',
  inputSchema: z.object({
    id_calculo: z.number().int().describe('Número do cálculo no PJe-Calc.'),
    tipos: z.array(z.string()).optional().describe('Padrão: ["COMPLETO"] (as seções que se aplicam ao cálculo). Ou a lista de seções avulsas.'),
    formato: z.enum(['HTML', 'PDF']).optional().describe('HTML devolve o texto; PDF grava o arquivo (padrão HTML).'),
    arquivo_pdf: z.string().optional().describe('Destino do PDF (formato PDF).'),
    max_caracteres: z.number().int().optional().describe('Corta o texto devolvido (padrão 20000).'),
  }),
}, (args) => handler(async () => {
  await svc.garantirPjeCalc({ iniciar: false });
  const op = new OperadorPjeCalc();
  await op.abrirCalculo(args.id_calculo);
  const pedidos = args.tipos && args.tipos.length ? args.tipos : ['COMPLETO'];
  const tipos = pedidos.includes('COMPLETO') ? await svc.secoesDoCalculoAberto(op) : pedidos;
  if (args.formato === 'PDF') {
    const r = await op.relatorio({ tipos, formato: 'PDF' });
    const destino = path.resolve(args.arquivo_pdf || path.join(svc.DIR_SAIDA, r.nome || `RELATORIO_CALCULO_${args.id_calculo}.pdf`));
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, r.bytes);
    return { arquivo: destino, bytes: r.bytes.length, secoes: tipos };
  }
  const r = await op.relatorio({ tipos });
  const max = args.max_caracteres || 20000;
  return { secoes: tipos, totais: tipos.includes('RESUMO_DE_CALCULO') ? svc.extrairResumo(r.texto) : undefined, texto: r.texto.length > max ? `${r.texto.slice(0, max)}\n[... cortado: ${r.texto.length} caracteres]` : r.texto };
}));

server.registerTool('calculo_comparar_referencia', {
  title: 'Comparar com uma conta de referência',
  description: 'Compara o cálculo com uma conta de referência (perito, parte, outro cenário) na mesma data-base. Cada lado é um cálculo do PJe-Calc (id) ou um .PJC exportado depois de liquidar (arquivo). Compara primeiro quantidades e valores nominais por ocorrência (com a causa local de cada diferença: quantidade, base, divisor, multiplicador, pago), depois a ponte por verba (nominal -> corrigido -> juros -> total, com o resíduo em relação ao bruto) e a ponte bruto -> FGTS/depósito/INSS/IR -> líquido. Não altera os cálculos. Igualdade de totais não substitui igualdade das ocorrências. Veja pjecalc://docs/modulos/referencia.',
  inputSchema: z.object({
    id_calculo: z.number().int().optional().describe('Cálculo a conferir (no PJe-Calc, já liquidado).'),
    arquivo_calculo: z.string().optional().describe('Alternativa: .PJC exportado do cálculo liquidado.'),
    id_referencia: z.number().int().optional().describe('Conta de referência no PJe-Calc (liquidada na mesma data).'),
    arquivo_referencia: z.string().optional().describe('Alternativa: .PJC da conta de referência, ou o relatório do PJe-Calc da referência em PDF, HTML ou texto copiado (só o resumo é comparado).'),
    referencia_manual: z.record(z.string(), z.unknown()).optional().describe('Alternativa: conta de referência transcrita (perito, planilha): { dataLiquidacao, verbas: [{ descricao, valorCorrigido, juros, total }], brutoDevidoAoReclamante, totalDescontos, liquidoDevidoAoReclamante, totalDevidoPeloReclamado, composicao: [{ descricao, valor }], origem }.'),
    data_base: z.string().optional().describe('Data-base da referência (AAAA-MM-DD) quando o relatório não a mostra.'),
    tolerancia: z.number().optional().describe('Tolerância em reais (padrão 0,01).'),
  }),
}, (args) => handler(() => svc.compararComReferencia({
  idCalculo: args.id_calculo ?? null, arquivoCalculo: args.arquivo_calculo || null,
  idReferencia: args.id_referencia ?? null, arquivoReferencia: args.arquivo_referencia || null,
  referenciaManual: args.referencia_manual || null, dataBase: args.data_base || null,
  tolerancia: args.tolerancia ?? 0.01,
})));

server.registerTool('calculo_criar_lote', {
  title: 'Criar vários cálculos (lote: um por reclamante ou por devedor)',
  description: 'Roda calculo_criar para cada especificação da lista (litisconsórcio ativo: um cálculo por reclamante; responsabilidade subsidiária ou sucessiva: um por devedor, com o período de cada um; cenários). Cada item passa pelas mesmas travas (documentos, mapa, título, aprovação). Devolve, por item, o número do cálculo, o estado, os totais e as falhas, e o consolidado (soma dos brutos, líquidos e totais dos itens liquidados). Um item com erro não interrompe os outros.',
  inputSchema: z.object({
    especificacoes: z.array(z.record(z.string(), z.unknown())).optional().describe('Lista de especificações completas.'),
    arquivos_json: z.array(z.string()).optional().describe('Alternativa: caminhos dos .json.'),
    liquidar_em: z.string().optional().describe('dd/mm/aaaa ou aaaa-mm-dd: liquidação de teste de todos os itens (mesma data-base).'),
    atualizar_tabelas: z.boolean().optional().describe('Se as tabelas de índices não cobrirem a liquidação, atualiza-as pelo TRT do processo (padrão false).'),
    ignorar_tabelas: z.boolean().optional().describe('Liquida mesmo com tabelas desatualizadas (o resultado fica errado).'),
  }),
}, (args) => handler(() => svc.criarLote({ especificacoes: [...(args.especificacoes || []), ...(args.arquivos_json || []).map((a) => JSON.parse(fs.readFileSync(path.resolve(a), 'utf-8')))], liquidarEm: args.liquidar_em || null, atualizarTabelas: Boolean(args.atualizar_tabelas), ignorarTabelas: Boolean(args.ignorar_tabelas) })));

server.registerTool('calculo_exportar_pjc', {
  title: 'Exportar cálculo do PJe-Calc (.PJC)',
  description: 'Exporta um cálculo do PJe-Calc como .PJC (Operações > Exportar) — útil para backup, para enviar a terceiros ou para conferir com calculo_ler_pjc.',
  inputSchema: z.object({
    id_calculo: z.number().int().describe('Número do cálculo no PJe-Calc.'),
    destino: z.string().optional().describe('Arquivo ou pasta (padrão: pjecalc-mcp-skill/saida).'),
  }),
}, (args) => handler(async () => {
  await svc.garantirPjeCalc({ iniciar: false });
  const op = new OperadorPjeCalc();
  await op.abrirCalculo(args.id_calculo);
  const r = await op.exportarPjc();
  let alvo = args.destino ? path.resolve(args.destino) : path.join(svc.DIR_SAIDA, r.nome || `CALCULO_${args.id_calculo}.PJC`);
  if (!/\.pjc$/i.test(alvo)) alvo = path.join(alvo, r.nome || `CALCULO_${args.id_calculo}.PJC`);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, r.bytes);
  return { arquivo: alvo, bytes: r.bytes.length };
}));

server.registerTool('calculo_excluir', {
  title: 'Excluir cálculo do PJe-Calc',
  description: 'Exclui um cálculo do PJe-Calc (Operações > Excluir). IRREVERSÍVEL: exige confirmacao = "SIM, EXCLUIR". Faça calculo_exportar_pjc antes se quiser guardar.',
  inputSchema: z.object({
    id_calculo: z.number().int().describe('Número do cálculo no PJe-Calc.'),
    confirmacao: z.string().describe('Deve ser exatamente "SIM, EXCLUIR".'),
  }),
}, (args) => handler(async () => {
  if (args.confirmacao !== 'SIM, EXCLUIR') throw new Error('Confirmação obrigatória: passe confirmacao = "SIM, EXCLUIR".');
  await svc.garantirPjeCalc({ iniciar: false });
  const op = new OperadorPjeCalc();
  await op.abrirCalculo(args.id_calculo);
  return op.excluirCalculo();
}));

server.registerTool('calculo_recentes', {
  title: 'Cálculos recentes no PJe-Calc',
  description: 'Lista "Abrir Cálculos Recentes" da tela inicial do PJe-Calc (número / processo / reclamante).',
  inputSchema: z.object({}),
}, () => handler(async () => {
  await svc.garantirPjeCalc({ iniciar: false });
  const op = new OperadorPjeCalc();
  const p = await op.inicio();
  return [...p.html.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)/g)].map((m) => ({ id: Number(m[1]), descricao: m[2].trim() }));
}));

// ---------------------------------------------------------------------------
// Ferramentas — catálogos (offline, extraídos do próprio PJe-Calc)
// ---------------------------------------------------------------------------

server.registerTool('catalogo_verbas', {
  title: 'Catálogo de verbas (Expresso)',
  description: 'Verbas do lançamento "Expresso" do PJe-Calc com seus parâmetros padrão (característica, ocorrência de pagamento, incidências, base, divisor, multiplicador, quantidade) e a lista de reflexos disponíveis para cada uma. Use os nomes exatamente como aparecem aqui em "verbas[].verba" e "verbas[].reflexos".',
  inputSchema: z.object({ filtro: z.string().optional().describe('Parte do nome (ex.: "horas extras", "férias").') }),
}, (args) => handler(() => svc.catalogoVerbas(args?.filtro)));

server.registerTool('catalogo_municipios', {
  title: 'Municípios do PJe-Calc',
  description: 'Procura municípios (nome/UF/id) da tabela do PJe-Calc, para preencher calculo.uf e calculo.municipio.',
  inputSchema: z.object({
    uf: z.string().optional().describe('Sigla da UF (ex.: PA).'),
    nome: z.string().optional().describe('Parte do nome.'),
  }),
}, (args) => handler(() => {
  const cat = svc.carregarModelo('catalogos');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return cat.municipios.filter((m) => (!args?.uf || norm(m.uf) === norm(args.uf)) && (!args?.nome || norm(m.nome).includes(norm(args.nome)))).slice(0, 100);
}));

server.registerTool('catalogo_assuntos_cnj', {
  title: 'Assuntos CNJ',
  description: 'Assuntos da Tabela Processual Unificada do CNJ cadastrados no PJe-Calc (código para verbas personalizadas: verbas[].personalizada.assuntoCnj).',
  inputSchema: z.object({ filtro: z.string().optional() .describe('Parte do nome ou do código do assunto.')}),
}, (args) => handler(() => {
  const cat = svc.carregarModelo('catalogos');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return cat.assuntos.filter((a) => !args?.filtro || norm(a.descricao).includes(norm(args.filtro)) || String(a.codigo) === String(args.filtro)).slice(0, 100);
}));

server.registerTool('catalogo_enums', {
  title: 'Valores aceitos (enums do PJe-Calc)',
  description: 'Constantes aceitas pelos campos do PJe-Calc (ex.: IndiceMonetarioEnum, JurosEnum, TipoHonorarioEnum, SituacaoDaFeriasEnum, BaseDeCalculoDoPrincipalEnum). Sem argumento lista os nomes dos enums; com "classe" lista os campos enum de uma entidade (ex.: Fgts, Honorario, ParametrosDeAtualizacao).',
  inputSchema: z.object({
    nome: z.string().optional().describe('Nome do enum.'),
    classe: z.string().optional().describe('Nome da entidade.'),
  }),
}, (args) => handler(() => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'modelos', 'modelo-pjc.json'), 'utf-8'));
  if (args?.nome) {
    const e = m.enums[args.nome];
    if (!e) throw new Error(`Enum desconhecido. Exemplos: ${Object.keys(m.enums).slice(0, 30).join(', ')}`);
    return e;
  }
  if (args?.classe) {
    const ent = m.entidades[args.classe];
    if (!ent) throw new Error('Entidade desconhecida.');
    return ent.campos.filter((c) => m.enums[c.tipo.split('.').pop()]).map((c) => ({ campo: c.nome, enum: c.tipo.split('.').pop(), valores: m.enums[c.tipo.split('.').pop()].map((x) => x.nome) }));
  }
  return Object.keys(m.enums);
}));

server.registerTool('catalogo_validar_documentos', {
  title: 'Validar número CNJ, CPF e CNPJ',
  description: 'Confere dígitos verificadores (o PJe-Calc recusa número de processo com dígito errado) e devolve o dígito CNJ correto.',
  inputSchema: z.object({
    numero_processo: z.string().optional().describe('Número CNJ do processo, com ou sem pontuação.'),
    cpf: z.string().optional().describe('CPF, com ou sem pontuação.'),
    cnpj: z.string().optional().describe('CNPJ, com ou sem pontuação.'),
  }),
}, (args) => handler(() => ({
  processo: args?.numero_processo ? numeroCnj(args.numero_processo) : undefined,
  cpfValido: args?.cpf ? cpfValido(args.cpf) : undefined,
  cnpjValido: args?.cnpj ? cnpjValido(args.cnpj) : undefined,
})));

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

server.registerTool('catalogo_pisos_vt', {
  title: 'Pisos salariais e vales-transporte cadastrados no PJe-Calc',
  description: 'Lista as tabelas "Pisos Salariais" e "Vale-transporte" do PJe-Calc do usuário (id, nome ou linha, UF, município, período), lidas do banco por modelos_atualizar com alvo "catalogos" (PJe-Calc parado). Use o id em verbas[].base { tipo: "SALARIO_DA_CATEGORIA", piso: id } ou { tipo: "VALE_TRANSPORTE", valesTransporte: [ids] } (e em valorPago). O piso ou a linha precisa ser do mesmo estado (e município, no vale-transporte) dos parâmetros do cálculo. Se a tabela não existir no PJe-Calc do usuário, informe o piso da norma coletiva como histórico salarial (base HISTORICO_SALARIAL), com a origem na cláusula.',
  inputSchema: z.object({ uf: z.string().optional().describe('Sigla da UF para filtrar.'), nome: z.string().optional().describe('Parte do nome do piso ou da linha.') }),
}, (args) => handler(() => {
  const cat = svc.carregarModelo('catalogos');
  const n = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const filtro = (x, campoNome) => (!args.uf || n(x.uf) === n(args.uf)) && (!args.nome || n(x[campoNome]).includes(n(args.nome)));
  if (!cat.pisos && !cat.valesTransporte) return { aviso: 'O catálogo ainda não tem pisos e vales-transporte: com o PJe-Calc parado, rode modelos_atualizar com alvo "catalogos".', pisos: [], valesTransporte: [] };
  const pisos = (cat.pisos || []).filter((x) => filtro(x, 'nome'));
  const vts = (cat.valesTransporte || []).filter((x) => filtro(x, 'linha'));
  return { atualizadoEm: cat.atualizadoEm, pisos, valesTransporte: vts, ...(pisos.length || vts.length ? {} : { aviso: 'Nenhum piso ou vale-transporte cadastrado com esse filtro: use o piso da norma coletiva como histórico salarial, ou cadastre a tabela em Tabelas > Pisos Salariais / Vale-transporte e atualize o catálogo.' }) };
}));

server.registerTool('catalogo_atividades', {
  title: 'Atividades econômicas (INSS por atividade)',
  description: 'Atividades econômicas da tabela do PJe-Calc (id e descrição), para contribuicaoSocial.atividadeEconomica (alíquotas do empregador pela atividade).',
  inputSchema: z.object({ filtro: z.string().optional().describe('Parte da descrição ou o id.') }),
}, (args) => handler(() => {
  const cat = svc.carregarModelo('catalogos');
  return (cat.atividadesEconomicas || []).filter((a) => !args?.filtro || String(a.id) === String(args.filtro) || semAcento(a.descricao).includes(semAcento(args.filtro))).slice(0, 100);
}));

server.registerTool('catalogo_feriados', {
  title: 'Feriados e pontos facultativos',
  description: 'Feriados (tipo F) e pontos facultativos (tipo P) do PJe-Calc: nacionais (abrangência F), estaduais (E) e municipais (M). Pontos facultativos são marcados no cálculo pelo nome em calculo.pontosFacultativos.',
  inputSchema: z.object({
    uf: z.string().optional().describe('Sigla da UF dos feriados estaduais e municipais.'),
    municipio: z.string().optional().describe('Nome do município (filtra os municipais).'),
    tipo: z.enum(['F', 'P', 'B']).optional().describe('F feriado, P ponto facultativo.'),
    filtro: z.string().optional().describe('Parte do nome.'),
  }),
}, (args) => handler(() => {
  const cat = svc.carregarModelo('catalogos');
  const mun = args?.municipio ? cat.municipios.filter((m) => semAcento(m.nome) === semAcento(args.municipio) && (!args.uf || semAcento(m.uf) === semAcento(args.uf))).map((m) => m.id) : null;
  return cat.feriados.filter((f) => (!args?.tipo || f.tipo === args.tipo)
    && (!args?.filtro || semAcento(f.nome).includes(semAcento(args.filtro)))
    && (f.abrangencia === 'F' || !args?.uf || semAcento(f.uf) === semAcento(args.uf))
    && (f.abrangencia !== 'M' || !mun || mun.includes(f.municipio)))
    .map((f) => ({ nome: f.nome.trim(), tipo: f.tipo, abrangencia: f.abrangencia, uf: f.uf, municipio: f.municipio, data: f.data, movel: f.movel }))
    .slice(0, 200);
}));

server.registerTool('catalogo_cartao_ponto', {
  title: 'Opções da apuração do cartão de ponto',
  description: 'Colunas criadas por "Apurar Cartão de Ponto" (nomes aceitos em verbas[].quantidade.cartao e divisor.cartao), critérios de horas extras, preenchimentos, tipos de escala e horários noturnos aceitos em apuracaoCartaoPonto.',
  inputSchema: z.object({}),
}, () => handler(() => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'modelos', 'modelo-pjc.json'), 'utf-8'));
  const e = (n) => (m.enums[n] || []).map((x) => x.nome);
  return {
    colunas: COLUNAS_APURACAO,
    criterio: e('FormaDeApuracaoCartaoEnum'),
    preenchimento: e('PreenchimentoJornadasCartaoEnum'),
    escala: e('TipoEscalaPreenchimentoJornadaCartaoEnum'),
    horarioNoturno: e('HorarioNoturnoApuracaroCartaoEnum'),
  };
}));

server.registerTool('modelos_atualizar', {
  title: 'Atualizar modelos extraídos do PJe-Calc',
  description: 'Refaz os modelos usados pelo gerador a partir da instalação: "verbas" (com o PJe-Calc em execução: lança todas as verbas do Expresso num cálculo temporário, exporta, monta a biblioteca e exclui o temporário) ou "catalogos" (com o PJe-Calc PARADO: lê municípios, assuntos CNJ e feriados do banco H2). O calculo_criar e o tabelas_atualizar já refazem a biblioteca sozinhos na primeira vez em cada PJe-Calc e depois de cada sincronização de tabelas (que muda as verbas do Expresso); use para forçar.',
  inputSchema: z.object({ alvo: z.enum(['verbas', 'catalogos']) .describe('"verbas": biblioteca das verbas do Expresso; "catalogos": municípios, feriados, pisos e demais catálogos.')}),
}, (args) => handler(() => (args.alvo === 'verbas' ? svc.atualizarBibliotecaVerbas() : svc.atualizarCatalogos())));

// ---------------------------------------------------------------------------
// Ferramentas — informações
// ---------------------------------------------------------------------------

server.registerTool('pjecalc_info', {
  title: 'Informações do PJe-Calc',
  description: 'Identidade completa da instalação: versão/build do pjecalc.jar, módulos (base/negocio/integracao), stack tecnológico, portas do Tomcat, DataSource H2, parâmetros de JVM dos .bat, token de serviços e URLs dos 24 TRTs para sincronização de tabelas.',
  inputSchema: z.object({}),
}, () => handler(() => {
  const jar = env.readJarVersion();
  return {
    produto: 'PJe-Calc Cidadão',
    versao: '2.16.0',
    build: jar?.buildDate || null,
    grupo_artefato: `${jar?.groupId ?? 'br.jus.trt8'}:${jar?.artifactId ?? 'pjecalc-sa'}`,
    versao_jar: jar?.version ?? '2.16.0',
    stack: {
      runtime: 'JRE embutida (bin/jre)',
      servidor: 'Apache Tomcat 7.0.67 embutido (org.apache.catalina.startup.Bootstrap)',
      web: 'Seam 2.2.0.GA + JSF 1.2 (Facelets) + RichFaces 3.3.4',
      regras: 'Drools 5.5.0.Final (motor de cálculo)',
      persistencia: 'Hibernate 3.3.2.GA + H2 1.3.154 (dialeto próprio DialetoH2)',
      relatorios: 'JasperReports 3.7.6 + iText 2.1.7',
      servicos: 'RESTEasy 2.2.0.GA (REST) + Bouncy Castle (certificados)',
      testes_ui: 'Selenium 2.21 + HtmlUnit',
    },
    portas: env.readPorts(),
    datasource: env.readDatasource(),
    launcher: env.readLauncherParams(),
    tribunais: env.readTribunalUrls(),
    diretorio: env.home(),
  };
}));

server.registerTool('pjecalc_paginas', {
  title: 'Listar páginas do webapp',
  description: 'Mapa completo das páginas .xhtml do webapp (calculos, índices, INSS, IRPF, FGTS, custas, pagamento, cartão de ponto etc.). Use pjecalc_abrir_interface com o caminho retornado para abrir cada uma.',
  inputSchema: z.object({}),
}, () => handler(() => env.listPageFiles()));

server.registerTool('pjecalc_template_csv', {
  title: 'Ler template CSV de importação',
  description: 'Conteúdo dos arquivos CSV de exemplo usados pela tela de importação (cartão de ponto, jornada, faltas, férias e histórico salarial). Use como referência para gerar arquivos de importação.',
  inputSchema: z.object({
    arquivo: z.string().optional().describe('Caminho relativo (ex.: templateCartaoDePonto/ExemploCartaoDePonto.csv). Deixe vazio para listar.'),
  }),
}, (args) => handler(() => {
  const files = env.templateCsvFiles();
  if (!args?.arquivo) return files;
  const p = path.join(env.webappDir(), String(args.arquivo));
  if (!fs.existsSync(p)) throw new Error(`Arquivo não encontrado. Disponíveis: ${files.join(', ')}`);
  return { arquivo: args.arquivo, conteudo: fs.readFileSync(p, 'latin1') };
}));

// ---------------------------------------------------------------------------
// Ferramentas — serviços REST
// ---------------------------------------------------------------------------

server.registerTool('rest_selic_periodo', {
  title: 'Calcular SELIC do período (REST)',
  description: 'GET /pjecalc/servico/rest/atualizacao/selic — devolve o fator SELIC acumulado entre duas datas. Datas no formato dd/MM/aaaa. Autenticação automática via header Authentication (Base64 do token dos .bat). Requer o app em execução.',
  inputSchema: z.object({
    dataInicial: z.string().describe('Data inicial dd/MM/aaaa.'),
    dataFinal: z.string().describe('Data final dd/MM/aaaa.'),
  }),
}, (args) => handler(async () => {
  const r = await rest.selicPeriodo(args.dataInicial, args.dataFinal);
  return { status: r.status, significado: rest.STATUS_TEXT[r.status] || '', corpo: r.body };
}));

server.registerTool('rest_precatorio_atualizar', {
  title: 'Atualizar precatório (REST)',
  description: 'POST /pjecalc/servico/rest/atualizacao/precatorios — envia um AtualizacaoPrecatorioDTO e recebe o precatório atualizado (correção por índices de precatórios). O DTO é um objeto JSON livre (campos como numeroPrecatorio, valor, dataBase, indices...). Consulte references/API-REST.md. Requer o app em execução.',
  inputSchema: z.object({
    dto: z.record(z.string(), z.unknown()).describe('Objeto AtualizacaoPrecatorioDTO (JSON).'),
  }),
}, (args) => handler(async () => {
  const r = await rest.atualizarPrecatorio(args.dto);
  return { status: r.status, significado: rest.STATUS_TEXT[r.status] || '', corpo: r.body };
}));

server.registerTool('rest_precatorios_sip', {
  title: 'Atualizar precatórios SIP (REST)',
  description: 'POST /pjecalc/servico/rest/atualizacao/sip/precatorios — atualiza em lote uma lista de AtualizacaoPrecatorioSIPDTO (precatórios do SIP) e devolve a lista processada. Requer o app em execução.',
  inputSchema: z.object({
    lista: z.array(z.record(z.string(), z.unknown())).describe('Lista de objetos AtualizacaoPrecatorioSIPDTO.'),
  }),
}, (args) => handler(async () => {
  const r = await rest.atualizarPrecatoriosSIP(args.lista);
  return { status: r.status, significado: rest.STATUS_TEXT[r.status] || '', corpo: r.body };
}));

server.registerTool('rest_precatorios_sip_indices', {
  title: 'Atualizar índices de precatórios SIP (REST)',
  description: 'POST /pjecalc/servico/rest/atualizacao/sip/precatorios/indices — atualiza em lote uma lista de AtualizacaoPrecatorioSIPIndicesDTO. Requer o app em execução.',
  inputSchema: z.object({
    lista: z.array(z.record(z.string(), z.unknown())).describe('Lista de objetos AtualizacaoPrecatorioSIPIndicesDTO.'),
  }),
}, (args) => handler(async () => {
  const r = await rest.atualizarPrecatoriosSIPIndices(args.lista);
  return { status: r.status, significado: rest.STATUS_TEXT[r.status] || '', corpo: r.body };
}));

server.registerTool('rest_tabelas_ultima_versao', {
  title: 'Última versão das tabelas nacionais (REST)',
  description: 'LADO SERVIDOR do PJe-Calc local (o serviço que ele oferece a outros TRTs): NÃO atualiza as tabelas deste PJe-Calc — para isso use tabelas_atualizar. GET /pjecalc/servico/rest/sincronizacao/nacionais/ultimaVersao — devolve ControleAtualizacaoTabelasDTO com a última versão das tabelas auxiliares nacionais (404 se não houver controle). Requer o app em execução.',
  inputSchema: z.object({}),
}, () => handler(async () => {
  const r = await rest.tabelasUltimaVersao();
  return { status: r.status, significado: rest.STATUS_TEXT[r.status] || '', corpo: r.body };
}));

server.registerTool('rest_tabelas_versao', {
  title: 'Buscar versão específica das tabelas (REST)',
  description: 'LADO SERVIDOR do PJe-Calc local (o serviço que ele oferece a outros TRTs): NÃO atualiza as tabelas deste PJe-Calc — para isso use tabelas_atualizar. GET /pjecalc/servico/rest/sincronizacao/nacionais/versao/{hash} — busca o registro de controle de uma versão pelo hash (MD5). 404 = versão inexistente. Requer o app em execução.',
  inputSchema: z.object({
    hash: z.string().describe('Hash da versão (hashSolicitante).'),
  }),
}, (args) => handler(async () => {
  const r = await rest.tabelasVersao(args.hash);
  return { status: r.status, significado: rest.STATUS_TEXT[r.status] || '', corpo: r.body };
}));

server.registerTool('rest_tabelas_sincronizar_nacionais', {
  title: 'Sincronizar tabelas nacionais (REST)',
  description: 'LADO SERVIDOR do PJe-Calc local (o serviço que ele oferece a outros TRTs): NÃO atualiza as tabelas deste PJe-Calc — para isso use tabelas_atualizar. GET /pjecalc/servico/rest/sincronizacao/nacionais/{hash}?versao=X — devolve SincronizacaoTabelasDTO com {tabelas: Base64(GZIP do SQL), hashServidor}. 404 = já está na versão mais recente. Com salvar_arquivo, grava o SQL descompactado no caminho indicado. Requer o app em execução.',
  inputSchema: z.object({
    hash: z.string().describe('Hash solicitante (ex.: 0 para forçar).'),
    versao: z.string().optional().describe('Versão desejada (opcional).'),
    salvar_arquivo: z.string().optional().describe('Caminho para gravar o SQL descompactado (opcional).'),
  }),
}, (args) => handler(async () => {
  const r = await rest.sincronizarNacionais(args.hash, args.versao);
  let salvo = null;
  if (r.status === 200 && args.salvar_arquivo && r.body && r.body.tabelas) {
    const gz = Buffer.from(r.body.tabelas, 'base64');
    const { gunzipSync } = await import('node:zlib');
    const sql = gunzipSync(gz).toString('latin1');
    const outPath = path.resolve(String(args.salvar_arquivo));
    fs.writeFileSync(outPath, sql, 'latin1');
    salvo = { arquivo: outPath, bytes: sql.length };
  }
  return {
    status: r.status,
    significado: rest.STATUS_TEXT[r.status] || '',
    corpo: r.body && { ...r.body, tabelas: r.body.tabelas ? `<base64 gzip, ${r.body.tabelas.length} chars>` : undefined },
    salvo,
  };
}));

server.registerTool('rest_tabelas_sincronizar_regionais', {
  title: 'Sincronizar tabelas regionais (REST)',
  description: 'LADO SERVIDOR do PJe-Calc local (o serviço que ele oferece a outros TRTs): NÃO atualiza as tabelas deste PJe-Calc — para isso use tabelas_atualizar. GET /pjecalc/servico/rest/sincronizacao/nacionaiseregionais/regional/{TRT}/hash/{hash} (ou ...proxy... para passar pelo TRT raiz). Tribunal deve ser TRT1..TRT24 (maiúsculo). Devolve SincronizacaoTabelasDTO regional. Requer o app em execução.',
  inputSchema: z.object({
    tribunal: z.enum(TRTS).describe('TRT1..TRT24.'),
    hash: z.string().describe('Hash solicitante.'),
    proxy: z.boolean().optional().describe('Usa o endpoint nacionaiseregionaisproxy (via TRT responsável).'),
  }),
}, (args) => handler(async () => {
  const r = args.proxy
    ? await rest.sincronizarRegionaisProxy(args.tribunal, args.hash)
    : await rest.sincronizarRegionais(args.tribunal, args.hash);
  return {
    status: r.status,
    significado: rest.STATUS_TEXT[r.status] || '',
    corpo: r.body && { ...r.body, tabelas: r.body.tabelas ? `<base64 gzip, ${r.body.tabelas.length} chars>` : undefined },
  };
}));

// ---------------------------------------------------------------------------
// Ferramentas — banco de dados H2 (exigem o aplicativo PARADO)
// ---------------------------------------------------------------------------

const DB_WARN = 'O PJe-Calc mantém o banco bloqueado enquanto está em execução. Encerre o aplicativo (pjecalc_parar) antes de usar as ferramentas de banco.';

server.registerTool('db_tabelas', {
  title: 'Listar tabelas do banco H2',
  description: `Tabelas do esquema PUBLIC do banco embutido (.dados/pjecalc.h2.db, 151 tabelas: cálculo, verbas, fórmulas, índices, INSS, IRPF, FGTS, precatórios etc.). ${DB_WARN}`,
  inputSchema: z.object({}),
}, () => handler(async () => {
  const tabelas = await h2.listTables();
  return { total: tabelas.length, tabelas: tabelas.map((t) => t.TABLE_NAME).sort() };
}));

server.registerTool('db_esquema', {
  title: 'Esquema de uma tabela H2',
  description: `Colunas (nome, tipo, nulidade, default) de uma tabela do banco H2. ${DB_WARN}`,
  inputSchema: z.object({
    tabela: z.string().describe('Nome da tabela (ex.: TBSELICDIARIA, TBVERBA, TBCALCULO).'),
  }),
}, (args) => handler(() => h2.describeTable(args.tabela)));

server.registerTool('db_consultar', {
  title: 'Consultar o banco H2 (SELECT)',
  description: `Executa um SELECT no banco H2 (somente leitura) e devolve até max_linhas registros. Use db_tabelas/db_esquema para descobrir nomes. Ex.: SELECT * FROM TBSELICDIARIA ORDER BY DDTDIAINDICE DESC. ${DB_WARN}`,
  inputSchema: z.object({
    sql: z.string().describe('Comando SELECT.'),
    max_linhas: z.number().int().min(1).max(1000).optional().describe('Limite de linhas (padrão 200).'),
  }),
}, (args) => handler(() => h2.select(args.sql, { maxRows: args.max_linhas || 200 })));

server.registerTool('db_executar', {
  title: 'Executar DML/DDL no banco H2',
  description: `Executa INSERT/UPDATE/DELETE/DDL no banco H2. PERIGOSO: exige confirmacao = "SIM, EXECUTAR" e cria backup do arquivo .h2.db antes. NÃO use para criar ou alterar cálculos: inserções diretas não avançam as sequências do Hibernate e o PJe-Calc passa a falhar com "Registro duplicado" ao criar cálculos (aconteceu nesta instalação). Para cálculos use calculo_criar. ${DB_WARN}`,
  inputSchema: z.object({
    sql: z.string().describe('Comando SQL (DML/DDL).'),
    confirmacao: z.string().describe('Deve ser exatamente "SIM, EXECUTAR".'),
  }),
}, (args) => handler(async () => {
  if (args.confirmacao !== 'SIM, EXECUTAR') {
    throw new Error('Confirmação obrigatória: passe confirmacao = "SIM, EXECUTAR".');
  }
  const backup = h2.copyDbFile(path.join(env.dadosDir(), `pjecalc.h2.db.antes-de-write-${Date.now()}`));
  const out = await h2.executeWrite(args.sql);
  return { backup_criado: backup, saida: out };
}));

server.registerTool('db_backup_sql', {
  title: 'Backup lógico do banco (SQL)',
  description: `Gera backup completo (schema + dados, ~9 MB) em SQL usando org.h2.tools.Script com a JRE do próprio PJe-Calc. ${DB_WARN}`,
  inputSchema: z.object({
    arquivo: z.string().optional().describe('Caminho do .sql de saída (padrão: .dados/pjecalc-backup-<timestamp>.sql).'),
  }),
}, (args) => handler(async () => {
  const file = await h2.backupToSqlFile(args?.arquivo);
  return { arquivo: file, bytes: fs.statSync(file).size };
}));

server.registerTool('db_backup_arquivo', {
  title: 'Backup físico do banco (cópia do .h2.db)',
  description: `Copia o arquivo .dados/pjecalc.h2.db byte a byte. Funciona mesmo com o app em execução? Não — copie sempre com o app parado para garantir consistência. ${DB_WARN}`,
  inputSchema: z.object({
    arquivo: z.string().optional().describe('Caminho de destino (padrão: .dados/pjecalc.h2.db.bak-<timestamp>).'),
  }),
}, (args) => handler(async () => {
  const file = h2.copyDbFile(args?.arquivo);
  return { arquivo: file, bytes: fs.statSync(file).size };
}));

server.registerTool('db_restaurar', {
  title: 'Restaurar banco a partir de SQL',
  description: `Restaura o banco executando um arquivo SQL (gerado por db_backup_sql) via org.h2.tools.RunScript. DESTRUTIVO: exige confirmacao = "SIM, RESTAURAR" e faz backup do .h2.db atual antes. ${DB_WARN}`,
  inputSchema: z.object({
    arquivo: z.string().describe('Caminho do .sql a executar.'),
    confirmacao: z.string().describe('Deve ser exatamente "SIM, RESTAURAR".'),
  }),
}, (args) => handler(async () => {
  if (args.confirmacao !== 'SIM, RESTAURAR') {
    throw new Error('Confirmação obrigatória: passe confirmacao = "SIM, RESTAURAR".');
  }
  const backup = h2.copyDbFile(path.join(env.dadosDir(), `pjecalc.h2.db.antes-de-restore-${Date.now()}`));
  const out = await h2.restoreFromSqlFile(args.arquivo);
  return { backup_criado: backup, saida: out };
}));

// ---------------------------------------------------------------------------
// Ferramentas — configuração
// ---------------------------------------------------------------------------

const CONFIG_FILES = {
  'server.xml': env.serverXmlPath(),
  'context.xml': env.contextXmlPath(),
  'catalina.properties': path.join(env.tomcatDir(), 'conf', 'catalina.properties'),
  'iniciarPjeCalc.bat': env.batNormal(),
  'iniciarPjeCalcDebug.bat': env.batDebug(),
  'url_tribunal.properties': path.join(env.webappDir(), 'WEB-INF', 'classes', 'url_tribunal.properties'),
  'persistence.xml': path.join(env.webappDir(), 'WEB-INF', 'classes', 'META-INF', 'persistence.xml'),
  'web.xml': path.join(env.webappDir(), 'WEB-INF', 'web.xml'),
};

server.registerTool('config_ler', {
  title: 'Ler arquivo de configuração',
  description: 'Conteúdo de um arquivo de configuração do PJe-Calc (server.xml, context.xml, catalina.properties, .bat de inicialização, url_tribunal.properties, persistence.xml, web.xml). Arquivos são ISO-8859-1.',
  inputSchema: z.object({
    arquivo: z.enum(Object.keys(CONFIG_FILES)).describe('Nome do arquivo.'),
  }),
}, (args) => handler(() => {
  const p = CONFIG_FILES[args.arquivo];
  return { arquivo: p, conteudo: fs.readFileSync(p, 'latin1') };
}));

server.registerTool('config_portas', {
  title: 'Ler/alterar portas do Tomcat',
  description: 'Sem argumentos: lê as portas atuais. Com argumentos: altera http/ajp/shutdown no tomcat/conf/server.xml (apenas conectores ativos; comentários preservados; backup automático .mcp-backup-<timestamp>). O launcher usa a porta HTTP para abrir a interface e troca de porta automaticamente se estiver ocupada.',
  inputSchema: z.object({
    http: z.number().int().min(1024).max(65535).optional().describe('Nova porta HTTP (padrão 9257).'),
    ajp: z.number().int().min(1024).max(65535).optional().describe('Nova porta AJP (padrão 9258).'),
    shutdown: z.number().int().min(1024).max(65535).optional().describe('Nova porta de shutdown (padrão 9256).'),
  }),
}, (args) => handler(() => {
  if (!args || (args.http == null && args.ajp == null && args.shutdown == null)) {
    return { portas: env.readPorts(), arquivo: env.serverXmlPath() };
  }
  return env.writePorts({ http: args.http, ajp: args.ajp, shutdown: args.shutdown });
}));

server.registerTool('config_memoria', {
  title: 'Ler/alterar memória da JVM',
  description: 'Sem argumentos: lê Xms/Xmx dos .bat. Com argumentos: altera -Xms/-Xmx nos dois .bat (backup automático). Valores em MB. Reinicie o app para aplicar.',
  inputSchema: z.object({
    xms: z.number().int().min(256).max(16384).optional().describe('Heap inicial em MB.'),
    xmx: z.number().int().min(256).max(32768).optional().describe('Heap máximo em MB.'),
  }),
}, (args) => handler(() => {
  if (!args || (args.xms == null && args.xmx == null)) return { params: env.readLauncherParams() };
  return env.writeLauncherParams({ xms: args.xms, xmx: args.xmx });
}));

server.registerTool('config_token', {
  title: 'Ler/alterar token dos serviços REST',
  description: 'Sem argumentos: mostra o token atual (seguranca.pjecalc.tokenServicos dos .bat). Com novo_token: substitui nos dois .bat (backup automático). O token protege os endpoints /servico/rest/*; o header HTTP é Authentication: Base64(token).',
  inputSchema: z.object({
    novo_token: z.string().optional().describe('Novo token (opcional).'),
  }),
}, (args) => handler(() => {
  if (!args?.novo_token) return { token: env.readServiceToken(), header_esperado: env.authHeaderValue(env.readServiceToken()) };
  return env.writeLauncherParams({ tokenServicos: args.novo_token });
}));

server.registerTool('config_datasource', {
  title: 'Ler/alterar DataSource H2',
  description: 'Sem argumentos: lê o DataSource jdbc/pjeCalcDS de META-INF/context.xml. Com argumentos: altera url/username/password (backup automático). ATENÇÃO: mudar a url pode apontar para outro banco.',
  inputSchema: z.object({
    url: z.string().optional().describe('Nova URL JDBC.'),
    usuario: z.string().optional().describe('Novo usuário.'),
    senha: z.string().optional().describe('Nova senha.'),
  }),
}, (args) => handler(() => {
  if (!args || (args.url == null && args.usuario == null && args.senha == null)) {
    return { datasource: env.readDatasource(), arquivo: env.contextXmlPath() };
  }
  return env.writeDatasource({ url: args.url, username: args.usuario, password: args.senha });
}));

// ---------------------------------------------------------------------------
// Recursos (documentação)
// ---------------------------------------------------------------------------

const RESOURCES = [
  { uri: 'pjecalc://docs/contrato-de-dados', file: 'CONTRATO-DE-DADOS.md', title: 'Contrato de dados auditável', desc: 'Documentos, decisões, parcelas, afastamentos, remunerações, pagamentos e premissas; vínculos "origem"; o que a auditoria detecta; cenários.' },
  { uri: 'pjecalc://docs/modulos/processo', file: 'modulos/PROCESSO.md', title: 'Módulo: processo completo', desc: 'Mapa do processo: fases (pré-processual a execução), processos ligados e seus efeitos, situações especiais (devedores, ente público, recuperação judicial, destinos do crédito).' },
  { uri: 'pjecalc://docs/modulos/leitura', file: 'modulos/LEITURA.md', title: 'Módulo: leitura integral', desc: 'Protocolo de leitura de documentos, textos e imagens: inventário, página por página, extração por tipo, dupla leitura, fechamentos, confronto entre documentos, pedidos × decisão.' },
  { uri: 'pjecalc://docs/modulos/plano', file: 'modulos/PLANO.md', title: 'Módulo: plano de interpretação e aprovação', desc: 'Estrutura do plano mostrado ao usuário, aprovação com hash do contrato e revisão plano × resultado.' },
  { uri: 'pjecalc://docs/precedentes', file: 'PRECEDENTES.md', title: 'Catálogo de precedentes', desc: 'Precedentes com efeito no cálculo (ADC 58, Lei 14.905/2024, Fazenda Pública, OJ 394, súmulas do TST), com vigência, modulação e parametrização no PJe-Calc.' },
  { uri: 'pjecalc://docs/modulos/documentos', file: 'modulos/DOCUMENTOS.md', title: 'Módulo: documentos necessários', desc: 'Rodadas de coleta, matriz parcela -> documentos, cobertura mês a mês, contrato.coleta e a trava antes de calcular.' },
  { uri: 'pjecalc://docs/modulos/titulo-executivo', file: 'modulos/TITULO-EXECUTIVO.md', title: 'Módulo: título executivo', desc: 'Cadeia de decisões, alcance, reflexos, contradições.' },
  { uri: 'pjecalc://docs/modulos/jornada', file: 'modulos/JORNADA.md', title: 'Módulo: jornada', desc: 'Ciclos, limites, domingos, feriados, compensações e afastamentos.' },
  { uri: 'pjecalc://docs/modulos/remuneracao-reflexos', file: 'modulos/REMUNERACAO-REFLEXOS.md', title: 'Módulo: remuneração e reflexos', desc: 'Vigências, componentes, médias e duplicidades.' },
  { uri: 'pjecalc://docs/modulos/pagamentos', file: 'modulos/PAGAMENTOS.md', title: 'Módulo: pagamentos', desc: 'Identidade, abrangência e alocação dos abatimentos.' },
  { uri: 'pjecalc://docs/modulos/fgts-tributos', file: 'modulos/FGTS-TRIBUTOS.md', title: 'Módulo: FGTS e tributos', desc: 'Bases, depósitos, multa, incidências e destino.' },
  { uri: 'pjecalc://docs/modulos/atualizacao', file: 'modulos/ATUALIZACAO.md', title: 'Módulo: atualização', desc: 'Marcos, índices, juros, tabelas e data de comparação.' },
  { uri: 'pjecalc://docs/modulos/execucao', file: 'modulos/EXECUCAO.md', title: 'Módulo: execução', desc: 'Pagamentos da execução (parcelas e componentes, imputação nos juros), honorários, multas, pensão alimentícia e custas da execução, precatório/RPV, Cálculo Externo, regras do aplicativo conferidas antes de importar e a conferência do Resumo da Atualização.' },
  { uri: 'pjecalc://docs/modulos/referencia', file: 'modulos/REFERENCIA.md', title: 'Módulo: conta de referência', desc: 'Comparação com a conta exata na mesma data-base, pontes por verba e bruto -> líquido, causas das diferenças.' },
  { uri: 'pjecalc://docs/auditoria-pericial', file: 'AUDITORIA-PERICIAL.md', title: 'Auditoria pericial integral', desc: 'Roteiro de perito calculista: mapa processual e trânsito, matriz da coisa julgada pedido a pedido, auditoria financeira mês a mês, cartões dia a dia em minutos, parametrização aba por aba e relatório de inconsistências, tudo ligado às ferramentas e ao contrato de dados.' },
  { uri: 'pjecalc://docs/controles-interpretacao', file: 'CONTROLES-INTERPRETACAO.md', title: 'Controles de interpretação e prova', desc: 'Matriz por rubrica, classificação de premissas, componentes da remuneração, conciliação de pagamentos, bases de INSS, juros por fase e reconciliação final — obrigatórios antes de entregar.' },
  { uri: 'pjecalc://docs/especificacao-calculo', file: 'ESPECIFICACAO-CALCULO.md', title: 'Especificação JSON do cálculo', desc: 'Todos os campos aceitos pelo gerador, com exemplos.' },
];

for (const r of RESOURCES) {
  server.registerResource(`doc-${r.file.replace(/\.md$/, '').replace(/\//g, '-').toLowerCase()}`, r.uri, {
    title: r.title,
    description: r.desc,
    mimeType: 'text/markdown',
  }, async (uri) => {
    const p = path.join(referencesDir, r.file);
    if (!fs.existsSync(p)) throw new Error(`Documento não encontrado: ${r.file}`);
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: fs.readFileSync(p, 'utf8') }] };
  });
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

server.registerPrompt('montar-calculo-da-sentenca', {
  title: 'Montar o cálculo a partir da sentença',
  description: 'Roteiro para o agente transformar sentença/acórdão + dados do contrato num cálculo pronto para liquidar no PJe-Calc.',
}, () => ({
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: `Monte o cálculo trabalhista no PJe-Calc seguindo este roteiro:
Siga as etapas da skill (SKILL.md), sem misturá-las:
0. MAPA DO PROCESSO: processo principal, fase e trabalho (cálculo novo, atualização do homologado, execução coletiva, habilitação, ente público); TODOS os processos ligados (conexos, coisa julgada, ação anterior arquivada, coletiva, acordo, recuperação judicial, rescisória...) com o efeito no cálculo; devedores, pagamentos da execução e destinos do crédito (pjecalc://docs/modulos/processo; processo_mapa). Procure números de processo em todas as peças e pergunte se há outros.
1. DOCUMENTOS: peça os documentos em rodadas (título e decisões; documentos de cada parcela e de cada processo ligado; complementos e perguntas) com calculo_documentos_necessarios, até completa=true (pjecalc://docs/modulos/documentos).
2. LEITURA INTEGRAL: documento_inventario (páginas com e sem texto), todas as páginas de todos os documentos, imagens vistas como imagem (documento_imagens), extração com folha e trecho (documento_texto; holerites, cartões, extrato do FGTS e TRCT pelos conversores, que conferem os fechamentos), dupla leitura, confronto entre documentos, pedidos × decisão, registrados em contrato.leitura, contrato.confrontos e contrato.pedidos (pjecalc://docs/modulos/leitura).
3. TÍTULO: todas as decisões (vara, TRT, TST, STF, liquidação, execução) por capítulo, com efeito substitutivo, trânsito por capítulo, recursos pendentes, conflitos e precedentes vinculantes (pjecalc://docs/modulos/titulo-executivo, pjecalc://docs/precedentes; titulo_compor).
4. CONTRATO DE DADOS: decisões, parcelas, eventos, remunerações, pagamentos e premissas com fundamento (pjecalc://docs/contrato-de-dados). Desconhecido vira pergunta ou cenário, nunca zero ou padrão.
5. PLANO E APROVAÇÃO: calculo_plano_interpretacao, mostre o plano INTEIRO ao usuário, resolva as falhas e, quando ele aprovar, calculo_aprovar_plano (pjecalc://docs/modulos/plano).
6. PARAMETRIZAÇÃO: calculo_modelo_json (exemplo=auditavel) e catálogos; especificação com "origem" em tudo; calculo_validar até valido=true e prontoParaCalcular=true; cada alerta revisado em contrato.revisoesDeAlerta.
7. CÁLCULO: calculo_criar com liquidar_em = contrato.dataLiquidacao (tabelas do TRT do processo); valores mês a mês em verbas[].ocorrencias. Na execução: calculo_atualizar sobre o cálculo homologado liquidado, ou calculo_externo_criar para a conta feita fora do PJe-Calc (pjecalc://docs/modulos/execucao). Vários reclamantes ou devedores: calculo_criar_lote.
8. CONFERÊNCIA E ENTREGA: estado, dimensões, provisório, verificações e plano × resultado; volte aos documentos (quantidades e nominais primeiro); conta de referência com calculo_comparar_referencia (outro cálculo, relatório em PDF ou a conta transcrita). Entregue número do cálculo, -PRONTO.PJC, -LIQUIDADO.PJC, o relatório completo -RELATORIO.pdf, .registro.json, plano aprovado, premissas e cada dimensão separada; "revisadoParaEntrega" é sempre false.
Não invente dados: quando algo essencial faltar, pergunte ao usuário.
Não escreva no banco H2 diretamente.`,
    },
  }],
}));

server.registerPrompt('auditoria-pericial-integral', {
  title: 'Auditoria pericial integral do processo',
  description: 'Roteiro de perito calculista: lê o processo inteiro (pedidos, defesa, documentos financeiros, cartões de ponto, todas as decisões e o trânsito) e entrega o plano técnico de liquidação para aprovação, ligado ao contrato de dados.',
}, () => ({
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: `Faça a auditoria pericial integral deste processo e entregue o plano técnico de liquidação para aprovação, seguindo pjecalc://docs/auditoria-pericial.
Travas: leia todas as páginas de todos os documentos (documento_inventario, documento_texto, documento_imagens nas escaneadas) e cite documento e folha de cada dado; nada inventado, amostrado ou arredondado; só os autos deste processo; fontes: Constituição, CLT, CPC, leis, súmulas, OJs e teses do TST, precedentes vinculantes do STF, IRDR/IAC do TRT do processo e o que o título adotou (pjecalc://docs/precedentes); lacuna vira pedido em contrato.coleta e premissa DESCONHECIDA num cenário, nunca zero.
1. MAPA PROCESSUAL: partes, devedores e responsabilidade com período, regime tributário com prova, cronologia, aviso prévio e projeção, prescrição, datas de todas as decisões e trânsito por capítulo (processo_mapa, titulo_compor).
2. COISA JULGADA: cada pedido da inicial e cada requerimento da defesa, da inicial ao comando final, com a decisão vigente, folha e trecho; situação final da parcela e regra de cálculo (contrato.decisoes, contrato.parcelas, contrato.pedidos).
3. FINANCEIRO: holerites, TRCT, FGTS, faltas, afastamentos e férias, mês a mês, pelos conversores (holerites_para_historicos, trct_para_pagamentos, extrato_para_fgts), com as rubricas pagas para dedução e a identidade de cada pagamento.
4. CARTÕES: regras do processo por período, decomposição em minutos (residuais, intervalos, interjornadas, noturno, critério das extras, compensação, domingos e feriados na forma do título) e a grade dia a dia por cartoes_para_jornadas.
5. PARAMETRIZAÇÃO: cada aba do PJe-Calc no bloco da especificação (pjecalc://docs/especificacao-calculo), com origem em cada verba; calculo_validar.
6. RELATÓRIO: documentos faltantes (calculo_documentos_necessarios), omissões e contradições do título com as leituras admissíveis, e o plano (calculo_plano_interpretacao) mostrado INTEIRO ao usuário.
Não calcule antes da aprovação (calculo_aprovar_plano). Não escreva no banco H2.`,
    },
  }],
}));

server.registerPrompt('guia-backup-restauracao', {
  title: 'Guia: backup e restauração do banco',
  description: 'Procedimentos de backup/restauração do banco H2 embutido.',
}, () => ({
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: `Backup e restauração do banco H2 do PJe-Calc (.dados/pjecalc.h2.db):
1) Pare o app: pjecalc_parar (o H2 bloqueia o arquivo em uso).
2) Backup físico: db_backup_arquivo (cópia exata do .h2.db). Backup lógico: db_backup_sql.
3) Restauração: db_restaurar com o .sql (exige confirmacao="SIM, RESTAURAR"; faz backup antes).
Para guardar UM cálculo, prefira calculo_exportar_pjc (o .PJC pode ser importado em qualquer PJe-Calc).`,
    },
  }],
}));

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const l = await localizacaoInicial;
  console.error(`[pjecalc-mcp] PJe-Calc MCP ${PACKAGE_VERSION} ativo (stdio). ${l.valida ? `PJe-Calc: ${l.pasta} (${l.origem})` : `PJe-Calc não localizado: ${l.mensagem}`}`);
  process.on('SIGINT', async () => { await server.close(); process.exit(0); });
}

main().catch((e) => {
  console.error('[pjecalc-mcp] falha fatal:', e);
  process.exit(1);
});
