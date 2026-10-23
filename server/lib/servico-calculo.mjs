// pjecalc-mcp-skill · lib/servico-calculo.mjs
// Fluxos completos de cálculo usados pelas ferramentas do MCP:
//
//   validar   -> confere a especificação sem gerar nada (mesmas regras do gerador)
//   gerar     -> especificação JSON -> arquivo .PJC (não precisa do PJe-Calc aberto)
//   importar  -> .PJC -> PJe-Calc em execução (Importar Cálculo) + passos pós-importação (apuração do
//                cartão de ponto por jornadas e vínculos das verbas às colunas apuradas) + Regerar
//                ocorrências + pendências + exportação do arquivo final ("-PRONTO.PJC")
//   criar     -> gerar + importar: o cálculo fica no PJe-Calc pronto para o usuário clicar Liquidar
//   ler       -> resumo legível de um .PJC (gerado pelo MCP ou exportado pelo PJe-Calc)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarCalculo, ErroEspecificacao, bibliotecaVerbas } from './gerador.mjs';
import { gravarPjc, lerPjc, campo, itens, objetos, msParaData, definir as definirCampo, dataMs as dataMsIso } from './pjc.mjs';
import { OperadorPjeCalc } from './operacoes.mjs';
import * as life from './lifecycle.mjs';
import * as tabelas from './tabelas.mjs';
import { dadosDir } from './env.mjs';
import crypto from 'node:crypto';
import { auditarEspecificacao, conferenciaIndependente, compararEspecificacaoResultado, consolidarEstado } from './auditoria.mjs';
import { contaDoPjc, compararContas, contaDoResumo, resumoDoTextoDoRelatorio } from './comparacao.mjs';
import { lerPdf } from './pdf.mjs';
import { textoRelatorio as textoRelatorioHtml } from './operacoes.mjs';
import { revisaoPlanoResultado } from './plano.mjs';
import { validarArvore, verificacoesDaValidacao } from './validacao.mjs';
import { recalcularPjc, compararComRelatorios } from './recalculo.mjs';
import { conferirCriterios } from './criterios.mjs';
import { aplicarEdicoes, conferirEdicoes, aplicarEdicoesEncargos, conferirEdicoesEncargos, temEdicoesEncargos, conferirCustas } from './ocorrencias.mjs';
import { montarExecucao, parametrosAtualizacao, extrairResumoAtualizacao, eventosDaAtualizacao } from './execucao.mjs';
import { validarExterno, criarExterno } from './externo.mjs';
import { ehInstalacao } from './localizar.mjs';
import { home } from './env.mjs';
import { construirBibliotecaVerbas, salvarModelo, carregarModelo, limparCacheModelos } from './modelos.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// pasta dos arquivos gerados: PJECALC_MCP_SAIDA, ou "saida" ao lado do MCP; instalado como extensão do Claude
// Desktop (pasta substituída a cada atualização), Documentos\PJe-Calc MCP
const variavelDefinida = (v) => { const t = String(v || '').trim(); return t && !t.includes('${') ? t : null; };
export function pastaSaida(env = process.env, local = path.resolve(__dirname, '..', '..', 'saida')) {
  const escolhida = variavelDefinida(env.PJECALC_MCP_SAIDA);
  if (escolhida) return path.resolve(escolhida);
  if (/[\\/]Claude Extensions[\\/]/i.test(local) && env.USERPROFILE) return path.join(env.USERPROFILE, 'Documents', 'PJe-Calc MCP');
  return local;
}
export const DIR_SAIDA = pastaSaida();

export function validarEspecificacao(spec) {
  // validação técnica (o PJe-Calc aceitará?) separada da auditoria (os parâmetros têm origem na prova?)
  const auditoria = auditarEspecificacao(spec);
  const travas = travasDoCalculo(auditoria);
  const gate = travas.length ? { prontoParaCalcular: false, bloqueiosParaCalcular: travas, ...(auditoria.documentacao && auditoria.documentacao.bloqueia ? { pedidoDeDocumentos: auditoria.documentacao.pedido } : {}) } : { prontoParaCalcular: true };
  try {
    const { avisos, resumo, arvore } = gerarCalculo(spec);
    // as regras de "Pendências do Cálculo" do PJe-Calc, antecipadas: erro aqui impediria a liquidação
    const pendenciasPrevistas = validarArvore(arvore, { momento: 'especificacao' });
    const errosApp = pendenciasPrevistas.filter((x) => x.tipo === 'erro').map((x) => `[PJe-Calc ${x.regra}, tela ${x.tela}] ${x.mensagem}`);
    const alertasApp = pendenciasPrevistas.filter((x) => x.tipo === 'alerta').map((x) => `[PJe-Calc ${x.regra}, tela ${x.tela}] ${x.mensagem}`);
    // fase de execução: as regras da tela de pagamento sobre uma cópia da árvore tratada como liquidada
    if (spec.execucao) {
      try {
        const copia = JSON.parse(JSON.stringify(arvore));
        const datas = (spec.execucao.pagamentos || []).map((p) => String(p.data || '')).concat([...(spec.execucao.honorarios || []), ...(spec.execucao.multas || [])].map((x) => String(x.dataEvento || ''))).filter(Boolean).sort();
        const liq = (spec.contrato && spec.contrato.dataLiquidacao) || datas[0] || spec.execucao.dataAtualizacao;
        definirCampo(copia, 'hashCalculoCorreto', 'true');
        definirCampo(copia, 'dataDeLiquidacao', dataMsIso(liq));
        const m = montarExecucao(copia, spec.execucao);
        parametrosAtualizacao(copia, spec.execucao);
        resumo.execucao = { pagamentos: m.pagamentos, honorarios: m.honorarios, multas: m.multas };
        avisos.push(...m.avisos);
        resumo.premissasPadrao = [...(resumo.premissasPadrao || []), ...m.premissas];
      } catch (e) {
        if (!(e instanceof ErroEspecificacao)) throw e;
        errosApp.push(e.message);
      }
    }
    if (errosApp.length) return { valido: false, erros: errosApp, avisos: [...avisos, ...alertasApp], resumo, pendenciasPrevistas, ...gate, prontoParaCalcular: false, auditoria, estado: 'rascunho' };
    return { valido: true, erros: [], avisos: [...avisos, ...alertasApp], resumo, pendenciasPrevistas, ...gate, auditoria, estado: 'rascunho' };
  } catch (e) {
    if (e instanceof ErroEspecificacao) return { valido: false, erros: [e.message], avisos: [], ...gate, prontoParaCalcular: false, auditoria, estado: 'rascunho' };
    throw e;
  }
}

/**
 * Travas antes de gerar o cálculo, quando há contrato de dados: mapa do processo, documentos, leitura do
 * título e parâmetros sem falha na auditoria, e plano de interpretação aprovado pelo usuário.
 */
export function travasDoCalculo(auditoria) {
  if (!auditoria || !auditoria.temContrato) return [];
  const t = [];
  const falhas = auditoria.verificacoes.filter((v) => v.estado === 'falha');
  if (auditoria.documentacao && auditoria.documentacao.bloqueia) t.push('documentação incompleta: peça ao usuário o que falta (pedidoDeDocumentos)');
  const porDim = (d) => falhas.filter((v) => v.dimensao === d).length;
  if (porDim('processo')) t.push(`${porDim('processo')} falha(s) no mapa do processo (fase, processos ligados, devedores, execução)`);
  if (porDim('titulo')) t.push(`${porDim('titulo')} falha(s) na composição do título (decisões, capítulos, trânsito, precedentes)`);
  if (porDim('leitura')) t.push(`${porDim('leitura')} falha(s) na leitura integral (folhas sem classificação, ilegíveis sem pedido, fechamentos ou confrontos sem resolução)`);
  if (porDim('documentacao')) t.push(`${porDim('documentacao')} falha(s) na auditoria do contrato de dados (vínculos, documentos, pagamentos, eventos, remunerações)`);
  if (!auditoria.aprovacao || !auditoria.aprovacao.valida) t.push(`plano de interpretação: ${auditoria.aprovacao ? auditoria.aprovacao.motivo : 'não aprovado'}`);
  return t;
}

/** O cálculo não é gerado: a mensagem traz as travas e, se for o caso, o pedido de documentos. */
export class CalculoBloqueado extends Error {
  constructor(auditoria, travas) {
    const doc = auditoria.documentacao;
    super(`O cálculo não foi gerado:\n- ${travas.join('\n- ')}${doc && doc.bloqueia ? `\n\n${doc.pedido}` : ''}`);
    this.travas = travas;
    this.documentacao = doc;
  }
}

function nomeArquivo(spec) {
  const n = String((spec.processo || {}).numero || 'SEM_NUMERO').replace(/\D/g, '') || 'SEM_NUMERO';
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, '0');
  return `CALCULO_MCP_PROCESSO_${n}_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.PJC`;
}

/** Gera o .PJC no disco. destino: arquivo ou pasta (padrão: pjecalc-mcp-skill/saida). */
export function gerarArquivo(spec, destino = null) {
  const { arvore, avisos, resumo, posImportacao } = gerarCalculo(spec);
  const nome = nomeArquivo(spec);
  let alvo;
  if (!destino) alvo = path.join(DIR_SAIDA, nome);
  else if (/\.pjc$/i.test(destino)) alvo = path.resolve(destino);
  else alvo = path.join(path.resolve(destino), nome);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const bytes = gravarPjc(arvore, path.basename(alvo).toUpperCase());
  fs.writeFileSync(alvo, bytes);
  // passos que só o PJe-Calc pode fazer depois de importar (ex.: apurar o cartão de ponto) ficam ao lado do .PJC
  const lado = arquivoPosImportacao(alvo);
  if (posImportacao) fs.writeFileSync(lado, JSON.stringify(posImportacao, null, 2));
  else if (fs.existsSync(lado)) fs.unlinkSync(lado);
  return { arquivo: alvo, bytes: bytes.length, resumo, avisos, posImportacao: posImportacao || undefined };
}

export const arquivoPosImportacao = (pjc) => `${pjc}.mcp.json`;

export async function garantirPjeCalc({ iniciar = true } = {}) {
  const st = await life.status();
  if (st.rodando) return st;
  if (!iniciar) throw new Error(life.diagnosticoDeFalha() || 'O PJe-Calc não está em execução. Use pjecalc_iniciar (ou passe iniciar=true).');
  const r = await life.start({ modo: 'sem-navegador' });
  if (!r.pronto) throw new Error(life.diagnosticoDeFalha() || 'O PJe-Calc não respondeu a tempo. Veja pjecalc_logs.');
  return r;
}

/** Importa um .PJC no PJe-Calc em execução e deixa o cálculo pronto para liquidar. */
export async function importarArquivo(arquivo, { regerar = true, iniciar = true, manterAlteracoes = false, posImportacao = undefined, exportarFinal = undefined } = {}) {
  await garantirPjeCalc({ iniciar });
  let op = new OperadorPjeCalc();
  const bytes = fs.readFileSync(arquivo);
  if (posImportacao === undefined) {
    const lado = arquivoPosImportacao(arquivo);
    posImportacao = fs.existsSync(lado) ? JSON.parse(fs.readFileSync(lado, 'utf-8')) : null;
  }
  const imp = await op.importarPjc(bytes, path.basename(arquivo));
  const out = { idCalculo: imp.idCalculo, mensagensImportacao: imp.mensagens };
  if (posImportacao && posImportacao.apurarCartao) {
    out.cartaoDePonto = await op.apurarCartaoDePonto();
    out.vinculosCartao = [];
    for (const v of posImportacao.vinculosCartao || []) {
      await op.vincularCartaoNaVerba(v.verba, v.tipo, v.cartao);
      out.vinculosCartao.push(`${v.verba} <- ${v.cartao} (${v.tipo})`);
    }
    // Regerar na mesma conversa JSF das telas de cartão/verba deixa as demais verbas sem ocorrências
    // (o Calculo da conversa fica desatualizado). Abre o cálculo numa sessão nova, como um usuário faria.
    op = new OperadorPjeCalc();
    await op.abrirCalculo(imp.idCalculo);
  }
  if (regerar) out.regeracao = await op.regerarOcorrencias({ manterAlteracoes });
  // valores mês a mês: as ocorrências agora existem; exporta, aplica as edições (sem tocar na cópia original),
  // reimporta, exclui o cálculo intermediário e regera mantendo as alterações (os reflexos usam os valores novos)
  const edicoes = (posImportacao && posImportacao.edicoesOcorrencias) || [];
  const encargos = (posImportacao && posImportacao.edicoesEncargos) || null;
  const comEncargos = temEdicoesEncargos(encargos);
  if (edicoes.length || comEncargos) {
    if (!regerar) throw new Error('As edições das ocorrências exigem regerar as ocorrências depois de importar (regerar=true).');
    if (comEncargos) {
      // o Regerar das verbas não cria as ocorrências do FGTS nem as da contribuição social: a tela de cada uma
      // as gera (numa sessão nova, com o cálculo relido do banco)
      op = new OperadorPjeCalc();
      await op.abrirCalculo(imp.idCalculo);
      out.geracaoEncargos = [];
      if ((encargos.fgts || []).length) out.geracaoEncargos.push(await op.regerarOcorrenciasEncargo('FGTS'));
      if ((encargos.salariosDevidos || []).length || (encargos.salariosPagos || []).length) out.geracaoEncargos.push(await op.regerarOcorrenciasEncargo('Contribuição Social'));
    }
    const ex = await op.exportarPjc();
    const { arvore: arvEd, nomeInterno } = lerPjc(ex.bytes);
    if (edicoes.length) out.edicoesOcorrencias = aplicarEdicoes(arvEd, edicoes);
    if (comEncargos) out.edicoesEncargos = aplicarEdicoesEncargos(arvEd, encargos);
    const intermediario = imp.idCalculo;
    op = new OperadorPjeCalc();
    const imp2 = await op.importarPjc(gravarPjc(arvEd, nomeInterno), path.basename(arquivo));
    try {
      const opX = new OperadorPjeCalc();
      await opX.abrirCalculo(intermediario);
      await opX.excluirCalculo();
      out.calculoIntermediarioExcluido = intermediario;
    } catch (e) { out.avisoCalculoIntermediario = `O cálculo intermediário ${intermediario} não foi excluído (${e.message}); exclua-o pela interface.`; }
    out.idCalculo = imp2.idCalculo;
    out.mensagensImportacao = [...out.mensagensImportacao, ...imp2.mensagens];
    op = new OperadorPjeCalc();
    await op.abrirCalculo(imp2.idCalculo);
    // só as verbas: um novo Regerar do FGTS ou da contribuição social perderia a alíquota do FGTS editada
    out.regeracaoComEdicoes = await op.regerarOcorrencias({ manterAlteracoes: true });
    try {
      const arvFinal = lerPjc((await op.exportarPjc()).bytes).arvore;
      if (edicoes.length) out.conferenciaEdicoes = conferirEdicoes(arvFinal, edicoes);
      if (comEncargos) out.conferenciaEncargos = conferirEdicoesEncargos(arvFinal, encargos);
    } catch (e) {
      const nv = (item) => ({ item, estado: 'nao_verificado', detalhe: e.message, dimensao: 'transferencia' });
      if (edicoes.length) out.conferenciaEdicoes = nv('valores mês a mês nas ocorrências');
      if (comEncargos) out.conferenciaEncargos = nv('ocorrências de FGTS e de contribuição social');
    }
  }
  out.pendencias = await op.pendencias();
  out.prontoParaLiquidar = out.pendencias.totalErros === 0;
  // arquivo final, já com tudo o que o PJe-Calc calculou: pode ser importado em qualquer PJe-Calc e liquidado direto
  if (exportarFinal ?? !!posImportacao) {
    const ex = await op.exportarPjc();
    out.arquivoPronto = arquivo.replace(/(\.pjc)?$/i, '-PRONTO.PJC');
    fs.writeFileSync(out.arquivoPronto, ex.bytes);
  }
  Object.assign(out, consolidarEstado({ importado: true, pendenciasErros: out.pendencias.totalErros, liquidado: false, verificacoes: [] }));
  out.instrucoes = out.prontoParaLiquidar
    ? `Abra o PJe-Calc, selecione o cálculo ${out.idCalculo} em "Abrir Cálculos Recentes" e use Operações > Liquidar (informe a data de liquidação).`
    : `Há ${out.pendencias.totalErros} pendência(s) que impedem a liquidação; corrija a especificação ou ajuste na interface.`;
  return out;
}

/** TRT do processo a partir do número CNJ (NNNNNNN-DD.AAAA.5.TR.OOOO). */
export function regionalDoProcesso(numero) {
  const m = /^\s*\d{7}-?\d{2}\.?\d{4}\.?5\.?(\d{2})\.?\d{4}\s*$/.exec(String(numero || ''));
  return m ? `TRT${Number(m[1])}` : null;
}

/**
 * Confere se as tabelas de índices do PJe-Calc cobrem a data de liquidação. Se não cobrirem e
 * `atualizar` for verdadeiro, roda a atualização online pelo TRT `regional` e confere de novo.
 */
export async function verificarTabelas({ dataLiquidacao = null, regional = null, atualizar = false } = {}) {
  let status = await tabelas.statusTabelas();
  let avaliacao = tabelas.avaliarDefasagem(status, dataLiquidacao);
  const carregado = tabelas.regionalCarregado();
  const out = { dataLiquidacao: avaliacao.dataLiquidacao, atualizadas: avaliacao.atualizadas, atrasados: avaliacao.atrasados, regionalCarregado: carregado ? carregado.regional : null, indices: status.indices };
  // tabelas regionais (feriados, pisos, custas...) de outro TRT mudam o resultado: trata como desatualizadas
  const outroRegional = Boolean(regional && carregado && carregado.regional !== regional);
  if (outroRegional) {
    out.atualizadas = false;
    out.regionalDiferente = `As tabelas carregadas são do ${carregado.regional} e o processo é do ${regional}.`;
  } else if (regional && !carregado) {
    out.aviso = `Não sei de qual TRT são as tabelas carregadas (nunca atualizadas pelo MCP). Para o processo do ${regional}, rode tabelas_atualizar com ${regional}.`;
  }
  if (!out.atualizadas && atualizar) {
    if (!regional) throw new Error('As tabelas estão desatualizadas e não sei o TRT do processo: informe "regional" (TRT1..TRT24) para atualizar.');
    out.atualizacao = await tabelas.atualizarTabelas({ regional });
    status = await tabelas.statusTabelas();
    avaliacao = tabelas.avaliarDefasagem(status, dataLiquidacao);
    const agora = tabelas.regionalCarregado();
    Object.assign(out, { atualizadas: avaliacao.atualizadas && (!regional || (agora && agora.regional === regional)), atrasados: avaliacao.atrasados, regionalCarregado: agora ? agora.regional : null, indices: status.indices });
    if (out.atualizadas) delete out.regionalDiferente;
  }
  if (!out.atualizadas) {
    const motivos = [];
    if (out.regionalDiferente) motivos.push(out.regionalDiferente);
    if (out.atrasados.length) motivos.push(`índices que não chegam à liquidação em ${out.dataLiquidacao}: ${out.atrasados.map((x) => `${x.indice} até ${x.ultima || '?'}`).join('; ')}`);
    out.instrucao = `Tabelas do PJe-Calc inadequadas para liquidar (${motivos.join(' ')}). Rode tabelas_atualizar com o TRT do processo${regional ? ` (${regional})` : ''} — ou passe atualizar_tabelas=true — antes de liquidar.`;
  }
  return out;
}

/** Fluxo completo: especificação -> .PJC -> PJe-Calc (regerado e validado) -> conferências e estado. */
export async function criarCalculo(spec, { destino = null, iniciar = true, liquidarEm = null, exportarFinal = true, atualizarTabelas = false, ignorarTabelas = false } = {}) {
  const auditoria = auditarEspecificacao(spec);
  const travas = travasDoCalculo(auditoria);
  if (travas.length) throw new CalculoBloqueado(auditoria, travas);
  let ger = gerarArquivo(spec, destino);
  // As tabelas são conferidas (e, se pedido, atualizadas) ANTES de importar: o Regerar usa os feriados
  // das tabelas carregadas, e trocá-las depois deixaria ocorrências de um TRT com índices de outro.
  await garantirPjeCalc({ iniciar });
  const regional = regionalDoProcesso((spec.processo || {}).numero);
  let tabelasAntes;
  try {
    tabelasAntes = await verificarTabelas({ dataLiquidacao: liquidarEm, regional, atualizar: atualizarTabelas });
  } catch (e) {
    tabelasAntes = { atualizadas: null, erro: e.message, instrucao: `Não foi possível verificar as tabelas (${e.message}); a liquidação fica bloqueada até a verificação dar certo (tabelas_status).` };
  }
  // a biblioteca de verbas tem de ser a deste PJe-Calc (muda com a sincronização de tabelas): se for refeita,
  // o arquivo é gerado de novo com ela
  let bibliotecaDeVerbas = null;
  try { bibliotecaDeVerbas = await alinharBibliotecaDeVerbas(); } catch (e) { bibliotecaDeVerbas = { atualizada: false, erro: e.message }; }
  if (bibliotecaDeVerbas && bibliotecaDeVerbas.atualizada) ger = gerarArquivo(spec, destino);
  // só "true" confirma; erro de consulta (null) ou desatualização (false) bloqueiam a liquidação
  const tabelasVerificadas = tabelasAntes.atualizadas === true;
  const imp = await importarArquivo(ger.arquivo, { iniciar, posImportacao: ger.posImportacao || null, exportarFinal });
  const out = { arquivo: ger.arquivo, resumoGerado: ger.resumo, avisos: ger.avisos, ...imp, tabelas: tabelasAntes, ...(bibliotecaDeVerbas ? { bibliotecaDeVerbas } : {}), auditoria };
  const edicoes = (ger.posImportacao && ger.posImportacao.edicoesOcorrencias) || [];
  const encargos = (ger.posImportacao && ger.posImportacao.edicoesEncargos) || null;
  const verificacoes = [...[imp.conferenciaEdicoes, imp.conferenciaEncargos].filter(Boolean), { item: 'tabelas de índices', estado: tabelasVerificadas ? 'ok' : tabelasAntes.atualizadas === false ? 'falha' : 'nao_verificado', detalhe: tabelasVerificadas ? `cobrem ${tabelasAntes.dataLiquidacao}${tabelasAntes.regionalCarregado ? ` (${tabelasAntes.regionalCarregado})` : ''}` : tabelasAntes.instrucao || tabelasAntes.erro }];
  if (!tabelasVerificadas) {
    out.prontoParaLiquidar = false;
    out.instrucoes = `${tabelasAntes.instrucao} O cálculo ${imp.idCalculo} e o arquivo ${path.basename(out.arquivoPronto || ger.arquivo)} já estão prontos; falta só resolver as tabelas e liquidar.`;
  }
  let liquidado = false;
  if (liquidarEm) {
    if (!tabelasVerificadas && !ignorarTabelas) {
      out.liquidacaoDeTeste = { liquidado: false, motivo: out.tabelas.instrucao };
    } else {
      const op = new OperadorPjeCalc();
      await op.abrirCalculo(imp.idCalculo);
      out.liquidacaoDeTeste = await op.liquidar({ dataLiquidacao: liquidarEm });
      if (out.liquidacaoDeTeste.liquidado) {
        liquidado = true;
        out.resultado = { ...extrairResumo((await op.relatorio()).texto), dataLiquidacao: out.liquidacaoDeTeste.dataLiquidacao || liquidarEm };
        const conf = await conferirLiquidacao(op, { resultado: out.resultado, verbasEspecificacao: ger.resumo.verbas, cartao: out.cartaoDePonto, zerosJustificados: (spec.contrato && spec.contrato.zerosJustificados) || [], salvarEm: ger.arquivo.replace(/(\.pjc)?$/i, '-LIQUIDADO.PJC'), relatorioEm: ger.arquivo.replace(/(\.pjc)?$/i, '-RELATORIO.pdf'), edicoes, encargos, custas: spec.custas });
        out.justificativa = conf.justificativa;
        out.arquivoLiquidado = conf.arquivoLiquidado;
        out.relatorioCompleto = conf.relatorioCompleto;
        verificacoes.push(...conf.verificacoes);
        // o que foi aprovado no plano aparece no resultado?
        verificacoes.push(...revisaoPlanoResultado(spec, out.resultado));
        // fase de execução: pagamentos e eventos sobre o cálculo liquidado, atualizado até a data pedida
        if (spec.execucao && out.arquivoLiquidado) {
          try {
            out.execucao = await atualizarCalculo({ arquivo: out.arquivoLiquidado, execucao: spec.execucao });
            verificacoes.push(...out.execucao.verificacoes);
          } catch (e) { verificacoes.push({ item: 'atualização da execução (pagamentos e eventos)', estado: 'falha', detalhe: e.message, dimensao: 'transferencia' }); }
        }
      }
    }
    if (auditoria.dataLiquidacao && auditoria.dataLiquidacao !== (iso(liquidarEm) || '')) {
      verificacoes.push({ item: 'data de liquidação', estado: 'falha', detalhe: `liquidado em ${liquidarEm}, mas o contrato de dados fixa ${auditoria.dataLiquidacao}: compare valores numa mesma data` });
    }
  }
  out.verificacoes = verificacoes;
  Object.assign(out, consolidarEstado({ importado: true, pendenciasErros: imp.pendencias.totalErros, liquidado, verificacoes, auditoria }));
  out.registro = gravarRegistro(ger.arquivo, { spec, out });
  return out;
}

const iso = (v) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null; };

/**
 * Fase de execução: acrescenta pagamentos e eventos (bloco "execucao") a um cálculo LIQUIDADO, importa a cópia,
 * roda "Liquidar Atualização" até a data pedida e lê o Resumo e o Demonstrativo da atualização. O cálculo de
 * origem (arquivo ou número no PJe-Calc) não é alterado: o resultado é um cálculo novo e o "-ATUALIZADO.PJC".
 */
export async function atualizarCalculo({ arquivo = null, idCalculo = null, execucao, destino = null, iniciar = true } = {}) {
  if (!execucao) throw new Error('Informe "execucao" (dataAtualizacao, pagamentos, eventos).');
  await garantirPjeCalc({ iniciar });
  let bytes; let origem;
  if (arquivo) { bytes = fs.readFileSync(path.resolve(arquivo)); origem = path.basename(arquivo); }
  else if (idCalculo != null) {
    const op0 = new OperadorPjeCalc();
    await op0.abrirCalculo(idCalculo);
    bytes = (await op0.exportarPjc()).bytes;
    origem = `cálculo ${idCalculo} do PJe-Calc`;
  } else throw new Error('Informe arquivo_pjc (cálculo liquidado exportado) ou id_calculo.');
  const { arvore, nomeInterno } = lerPjc(bytes);
  const montagem = montarExecucao(arvore, execucao);
  const params = parametrosAtualizacao(arvore, execucao);
  const base = arquivo ? path.resolve(arquivo).replace(/(-LIQUIDADO)?(\.pjc)?$/i, '') : path.join(DIR_SAIDA, `CALCULO_${idCalculo}`);
  const dir = destino ? path.resolve(destino) : path.dirname(base);
  fs.mkdirSync(dir, { recursive: true });
  const arqExecucao = path.join(dir, `${path.basename(base)}-EXECUCAO.PJC`);
  const novos = gravarPjc(arvore, nomeInterno);
  fs.writeFileSync(arqExecucao, novos);
  const op = new OperadorPjeCalc();
  const imp = await op.importarPjc(novos, path.basename(arqExecucao));
  const out = { origem, idCalculo: imp.idCalculo, arquivoExecucao: arqExecucao, pagamentos: montagem.pagamentos, eventos: { honorarios: montagem.honorarios, multas: montagem.multas, pensao: montagem.pensao, custas: montagem.custas }, premissasPadrao: montagem.premissas, avisos: montagem.avisos, parametros: params };
  out.liquidacaoAtualizacao = await op.liquidarAtualizacao(params);
  const verificacoes = [];
  if (montagem.irApurado) verificacoes.push({ item: 'decisão sobre os encargos de IRPF', estado: montagem.encargosIrpfSemDecisao ? 'alerta' : 'ok', detalhe: montagem.encargosIrpfSemDecisao ? 'o cálculo apura IR e "execucao.cobrarEncargosIrpf" não foi informado: enviado desmarcado (a tela vem marcada); informe true ou false conforme a decisão' : `cobrar encargos de IRPF: ${params.cobrarEncargosIrpf ? 'sim' : 'não'} (informado)`, dimensao: 'transferencia' });
  try {
    // com a regra de precatório/RPV o relatório da atualização é o "Resumo da Atualização Precatório / RPV"
    const tiposRel = params.precatorio ? ['RESUMO_PRECATORIO', 'DEMONSTRATIVO_PRECATORIO'] : ['RESUMO_PAGAMENTO', 'DEMONSTRATIVO_PAGAMENTO'];
    const rel = await op.relatorio({ tipos: tiposRel, menu: 'Imprimir Atualização' });
    out.resultado = extrairResumoAtualizacao(rel.texto);
    out.relatorio = rel.texto.length > 30000 ? `${rel.texto.slice(0, 30000)}\n[... cortado: ${rel.texto.length} caracteres]` : rel.texto;
    const r = out.resultado;
    const br = params.data.split('-').reverse().join('/');
    verificacoes.push({ item: 'atualização até a data pedida', estado: r.atualizadoAte === br ? 'ok' : 'falha', detalhe: `relatório: saldo devedor em ${r.atualizadoAte || '?'}; pedido ${br}`, dimensao: 'transferencia' });
    const noRel = (re) => r.eventos.filter((x) => re.test(x)).length;
    // o Resumo lista um item por evento; as custas da execução só aparecem quando há outro evento na mesma data ou depois
    const esp = eventosDaAtualizacao(arvore);
    const confere = noRel(/^(Pagamento|Recolhimento)/i) === esp.pagamentos && noRel(/^Honor[aá]rios/i) === esp.honorarios && noRel(/^Multa/i) === esp.multas
      && noRel(/^Pens[aã]o Aliment/i) === esp.pensao && noRel(/^(Custa Fixa|Auto Judicial|Custas de Armazenamento)/i) === esp.custasNoResumo;
    verificacoes.push({ item: 'pagamentos e eventos considerados na atualização', estado: confere ? 'ok' : 'falha', detalhe: `relatório: ${r.eventos.join('; ') || 'nenhum evento'}${esp.custas > esp.custasNoResumo ? ` (+${esp.custas - esp.custasNoResumo} lançamento(s) de custas depois do último evento, no saldo mas fora da lista)` : ''}`, dimensao: 'transferencia' });
    verificacoes.push({ item: 'saldo por credor = total devido pelo reclamado', estado: !r.conferencia ? 'nao_verificado' : Math.abs(r.conferencia.somaDoSaldo - r.conferencia.total) < 0.011 ? 'ok' : 'alerta', detalhe: r.conferencia ? `soma ${r.conferencia.somaDoSaldo}, total ${r.conferencia.total}` : 'total não lido', dimensao: 'aritmetica' });
  } catch (e) { verificacoes.push({ item: 'relatório da atualização', estado: 'nao_verificado', detalhe: e.message, dimensao: 'transferencia' }); }
  try {
    const ex = await op.exportarPjc();
    out.arquivoAtualizado = path.join(dir, `${path.basename(base)}-ATUALIZADO.PJC`);
    fs.writeFileSync(out.arquivoAtualizado, ex.bytes);
    const a2 = lerPjc(ex.bytes).arvore;
    verificacoes.push({ item: 'atualização gravada no cálculo (exportação)', estado: campo(a2, 'hashAtualizacaoCorreto') === 'true' && campo(a2, 'atualizacao') ? 'ok' : 'falha', detalhe: `hashAtualizacaoCorreto ${campo(a2, 'hashAtualizacaoCorreto')}, ${itens(campo(a2, 'pagamentos')).length} pagamento(s)`, dimensao: 'transferencia' });
  } catch (e) { verificacoes.push({ item: 'exportação do cálculo atualizado', estado: 'nao_verificado', detalhe: e.message, dimensao: 'transferencia' }); }
  out.verificacoes = verificacoes;
  out.estado = verificacoes.some((v) => v.estado === 'falha') ? 'aceito_pelo_aplicativo' : verificacoes.every((v) => v.estado === 'ok') ? 'calculado' : 'aceito_pelo_aplicativo';
  out.instrucoes = `Atualização feita no cálculo ${imp.idCalculo} (cópia de ${origem}). Confira o rateio no relatório (Pagamento > Imprimir Atualização) e as premissas devolvidas.`;
  return out;
}

/**
 * Lote: um cálculo por especificação (um por reclamante no litisconsórcio, um por devedor na responsabilidade
 * subsidiária ou sucessiva, ou cenários). Cada item passa pelas travas de calculo_criar; erro num item não
 * interrompe os outros. Devolve o resultado por item e o consolidado dos liquidados.
 */
export async function criarLote({ especificacoes = [], liquidarEm = null, atualizarTabelas = false, ignorarTabelas = false } = {}) {
  if (!especificacoes.length) throw new Error('Informe "especificacoes" ou "arquivos_json".');
  const itensLote = [];
  for (const [i, spec] of especificacoes.entries()) {
    const nome = (spec.processo && spec.processo.reclamante && spec.processo.reclamante.nome) || `item ${i + 1}`;
    const devedor = spec.processo && spec.processo.reclamado && spec.processo.reclamado.nome;
    try {
      const v = validarEspecificacao(spec);
      if (!v.valido) { itensLote.push({ item: i + 1, reclamante: nome, devedor, criado: false, erros: v.erros }); continue; }
      if (!v.prontoParaCalcular) { itensLote.push({ item: i + 1, reclamante: nome, devedor, criado: false, bloqueios: v.bloqueiosParaCalcular }); continue; }
      const r = await criarCalculo(spec, { liquidarEm, atualizarTabelas, ignorarTabelas });
      itensLote.push({
        item: i + 1, reclamante: nome, devedor, criado: true, idCalculo: r.idCalculo, arquivo: r.arquivoPronto || r.arquivo, estado: r.estado,
        totais: r.resultado ? { bruto: r.resultado.brutoDevidoAoReclamante, liquido: r.resultado.liquidoDevidoAoReclamante, totalReclamado: r.resultado.totalDevidoPeloReclamado, dataLiquidacao: r.resultado.dataLiquidacao } : null,
        falhas: (r.verificacoes || []).filter((x) => x.estado === 'falha' || x.estado === 'nao_verificado').map((x) => `${x.item}: ${x.detalhe}`),
        pendencias: r.pendencias ? r.pendencias.totalErros : null,
      });
    } catch (e) { itensLote.push({ item: i + 1, reclamante: nome, devedor, criado: false, erro: e.message }); }
  }
  const liquidados = itensLote.filter((x) => x.totais);
  const soma = (k) => Math.round(liquidados.reduce((a, x) => a + (x.totais[k] || 0), 0) * 100) / 100;
  const datas = [...new Set(liquidados.map((x) => x.totais.dataLiquidacao))];
  return {
    itens: itensLote,
    consolidado: liquidados.length ? { itensLiquidados: liquidados.length, bruto: soma('bruto'), liquido: soma('liquido'), totalReclamado: soma('totalReclamado'), dataLiquidacao: datas.length === 1 ? datas[0] : null, ...(datas.length > 1 ? { aviso: `itens liquidados em datas diferentes (${datas.join(', ')}): não some sem atualizar todos para a mesma data` } : {}) } : null,
    criados: itensLote.filter((x) => x.criado).length,
    comFalha: itensLote.filter((x) => !x.criado || (x.falhas && x.falhas.length)).length,
  };
}

/**
 * Cálculo Externo: cria no PJe-Calc (telas "Novo Cálculo Externo" e "Parcelas Atualizáveis") a conta homologada
 * feita fora do aplicativo, exporta o .PJC e, com `execucao` (dataAtualizacao, pagamentos, eventos), atualiza a
 * cópia pela "Liquidar Atualização".
 */
export async function criarCalculoExterno(ext, { destino = null, iniciar = true } = {}) {
  const val = validarExterno(ext);
  await garantirPjeCalc({ iniciar });
  const op = new OperadorPjeCalc();
  const cr = await criarExterno(op, ext);
  const out = { idCalculo: cr.idCalculo, parcelas: cr.parcelas, dataBase: val.dataBase };
  const ex = await op.exportarPjc();
  const dir = destino ? path.resolve(destino) : DIR_SAIDA;
  fs.mkdirSync(dir, { recursive: true });
  const n = String(ext.processo.numero).replace(/\D/g, '');
  out.arquivo = path.join(dir, `CALCULO_EXTERNO_${n}_${val.dataBase.replace(/-/g, '')}.PJC`);
  fs.writeFileSync(out.arquivo, ex.bytes);
  const arv = lerPjc(ex.bytes).arvore;
  out.verificacoes = [{ item: 'Cálculo Externo gravado pelo PJe-Calc', estado: campo(arv, 'calculoExterno') === 'true' && campo(arv, 'hashCalculoCorreto') === 'true' ? 'ok' : 'falha', detalhe: `calculoExterno ${campo(arv, 'calculoExterno')}, liquidado em ${msParaData(campo(arv, 'dataDeLiquidacao'))}, ${itens(campo(arv, 'verbas')).filter((x) => x.$classe).length} parcela(s) convertidas em verbas`, dimensao: 'transferencia' }];
  if (ext.execucao) {
    out.execucao = await atualizarCalculo({ arquivo: out.arquivo, execucao: ext.execucao, destino: dir });
    out.verificacoes.push(...out.execucao.verificacoes);
  }
  out.estado = out.verificacoes.every((v) => v.estado === 'ok') ? 'calculado' : 'aceito_pelo_aplicativo';
  out.instrucoes = `Cálculo Externo ${cr.idCalculo} criado (data-base ${msParaData(campo(arv, 'dataDeLiquidacao'))}).${out.execucao ? ` Atualizado na cópia ${out.execucao.idCalculo}.` : ' Para atualizar, use calculo_atualizar com o arquivo exportado.'}`;
  return out;
}

/** Liquida um cálculo e devolve os valores do "Resumo do Cálculo". */
export async function liquidarCalculo(idCalculo, { dataLiquidacao = null, acumularIndices = null, regional = null, atualizarTabelas = false, ignorarTabelas = false, regerar = false } = {}) {
  await garantirPjeCalc({ iniciar: false });
  const tab = await verificarTabelas({ dataLiquidacao, regional, atualizar: atualizarTabelas });
  if (!tab.atualizadas && !ignorarTabelas) return { liquidado: false, motivo: tab.instrucao, tabelas: tab };
  let op = new OperadorPjeCalc();
  await op.abrirCalculo(idCalculo);
  // tabelas trocadas agora (ou a pedido): as ocorrências precisam ser regeradas com os feriados/tabelas novos
  let regeracao = null;
  if (regerar || (tab.atualizacao && tab.atualizacao.atualizado && !tab.atualizacao.jaEstavaAtualizado)) {
    regeracao = await op.regerarOcorrencias({ manterAlteracoes: true });
    op = new OperadorPjeCalc();
    await op.abrirCalculo(idCalculo);
  }
  const r = await op.liquidar({ dataLiquidacao, acumularIndices });
  if (regeracao) r.regeracao = regeracao;
  const verificacoes = [{ item: 'tabelas de índices', estado: tab.atualizadas === true ? 'ok' : 'falha', detalhe: tab.atualizadas === true ? `cobrem ${tab.dataLiquidacao}` : tab.instrucao }];
  if (r.liquidado) {
    r.resultado = { ...extrairResumo((await op.relatorio()).texto), dataLiquidacao: r.dataLiquidacao || dataLiquidacao };
    const conf = await conferirLiquidacao(op, { resultado: r.resultado, relatorioEm: path.join(DIR_SAIDA, `CALCULO_${idCalculo}-RELATORIO.pdf`) });
    r.justificativa = conf.justificativa;
    r.relatorioCompleto = conf.relatorioCompleto;
    verificacoes.push(...conf.verificacoes);
  }
  r.tabelas = { atualizadas: tab.atualizadas, atrasados: tab.atrasados, atualizacao: tab.atualizacao };
  r.verificacoes = verificacoes;
  // sem a especificação e o contrato, o máximo é "calculado"
  Object.assign(r, consolidarEstado({ importado: true, pendenciasErros: r.totalErros ?? 0, liquidado: Boolean(r.liquidado), verificacoes, auditoria: null }));
  return r;
}

/**
 * Compara um cálculo com uma conta de referência — cada lado é um cálculo do PJe-Calc (número) ou um
 * .PJC exportado depois de liquidar. Do PJe-Calc também se lê o Resumo do Cálculo (pontes por verba e
 * bruto -> líquido); do arquivo, só as ocorrências. Nada é alterado nos cálculos comparados.
 */
export async function compararComReferencia({ idCalculo = null, arquivoCalculo = null, idReferencia = null, arquivoReferencia = null, referenciaManual = null, dataBase = null, tolerancia = 0.01 } = {}) {
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const carregar = async (id, arquivo, papel) => {
    if (papel === 'referencia' && referenciaManual) {
      // conta transcrita pelo agente (relatório do perito, planilha): só o resumo é comparado
      const r = { ...referenciaManual, verbas: referenciaManual.verbas || [], composicao: referenciaManual.composicao || [] };
      return { conta: contaDoResumo(r, { origem: referenciaManual.origem || 'referência transcrita', dataLiquidacao: iso(referenciaManual.dataLiquidacao || dataBase) }), sha256: sha(Buffer.from(JSON.stringify(referenciaManual))), aviso: 'referência transcrita: só o resumo (verbas, bruto, líquido, total) é comparado; confira a transcrição na conta original.' };
    }
    if (arquivo && !/\.pjc$/i.test(arquivo)) {
      // relatório do PJe-Calc em PDF, HTML ou texto copiado: resumo sem ocorrências
      const bytes = fs.readFileSync(path.resolve(arquivo));
      const texto = bytes.subarray(0, 5).toString('latin1') === '%PDF-' ? lerPdf(bytes).paginas.map((p) => p.texto).join('\n') : /\.html?$/i.test(arquivo) ? textoRelatorioHtml(bytes.toString('utf-8')) : bytes.toString('utf-8');
      const resumo = /Valor Corrigido\s*\n\s*Juros\s*\n\s*Total/.test(texto) ? extrairResumo(texto) : resumoDoTextoDoRelatorio(texto);
      if (!resumo.verbas.length) throw new Error(`Não reconheci o Resumo do Cálculo em ${path.basename(arquivo)}: transcreva a conta em referencia_manual.`);
      return { conta: contaDoResumo(resumo, { origem: path.basename(arquivo), dataLiquidacao: iso(dataBase) || (resumo.dataLiquidacao ? iso(resumo.dataLiquidacao) : null) }), sha256: sha(bytes), aviso: `${papel}: relatório (${path.basename(arquivo)}) — só o resumo é comparado; para as causas por ocorrência, peça o .PJC.` };
    }
    if (arquivo) {
      const bytes = fs.readFileSync(path.resolve(arquivo));
      return { conta: contaDoPjc(lerPjc(bytes).arvore, { origem: path.basename(arquivo) }), sha256: sha(bytes), aviso: `${papel}: arquivo .PJC — sem o Resumo do Cálculo, só quantidades e nominais são comparados.` };
    }
    if (id == null) throw new Error(`Informe id_${papel} ou arquivo_${papel}.`);
    await garantirPjeCalc({ iniciar: false });
    const op = new OperadorPjeCalc();
    await op.abrirCalculo(id);
    const ex = await op.exportarPjc();
    let resumo = null; let aviso = null;
    try { resumo = extrairResumo((await op.relatorio()).texto); } catch (e) { aviso = `${papel}: Resumo do Cálculo não lido (${e.message}) — liquide o cálculo; só as ocorrências foram comparadas.`; }
    return { conta: contaDoPjc(lerPjc(ex.bytes).arvore, { resumo, origem: `cálculo ${id}` }), sha256: sha(ex.bytes), aviso };
  };
  const a = await carregar(idCalculo, arquivoCalculo, 'calculo');
  const b = await carregar(idReferencia, arquivoReferencia, 'referencia');
  const r = compararContas(a.conta, b.conta, { tolerancia });
  r.calculo.sha256 = a.sha256;
  r.referencia.sha256 = b.sha256;
  r.avisos = [a.aviso, b.aviso].filter(Boolean);
  r.lembrete = 'Reproduzir a referência não a torna juridicamente correta. Registre-a em contrato.referencia (arquivo ou identificação, sha256, dataBase, critérios conhecidos e limitações) e explique cada diferença pela causa, não pelo total.';
  return r;
}

const NUM = /^\(?-?[\d.]+,\d{2,}\)?$|^\(?-?\d+\)?$/;
const num = (s) => {
  if (s == null) return null;
  const t = String(s).trim();
  const negativo = /^\(.*\)$/.test(t) || t.startsWith('-');
  const v = Number(t.replace(/[()\s-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? (negativo ? -v : v) : null;
};
const VALOR = String.raw`(\(?-?[\d.]+,\d+\)?)`;

/**
 * Extrai os valores do relatório "Resumo do Cálculo" (texto): rubricas (inclusive negativas, que o
 * PJe-Calc mostra entre parênteses), a linha de totais do quadro, a composição de créditos/descontos
 * e débitos do reclamado e uma conferência (soma das rubricas = total do quadro = bruto).
 */
export function extrairResumo(texto) {
  const t = texto;
  const pick = (re) => { const m = t.match(re); return m ? m[1] : null; };
  const linhas = [];
  let totaisQuadro = null;
  const cab = 'Valor Corrigido\nJuros\nTotal';
  const ini = t.indexOf(cab);
  const fim = t.indexOf('Percentual de Parcelas');
  if (ini >= 0) {
    const corpo = t.slice(ini + cab.length, fim > 0 ? fim : undefined).split('\n').map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < corpo.length; ) {
      const tres = (k) => k + 2 < corpo.length && NUM.test(corpo[k]) && NUM.test(corpo[k + 1]) && NUM.test(corpo[k + 2]);
      if (!NUM.test(corpo[i]) && corpo[i] !== 'Total' && tres(i + 1)) {
        linhas.push({ descricao: corpo[i], valorCorrigido: num(corpo[i + 1]), juros: num(corpo[i + 2]), total: num(corpo[i + 3]) });
        i += 4;
      } else if (tres(i)) {
        // três números sem descrição = linha de totais do quadro (o rótulo "Total" vem depois)
        totaisQuadro = { valorCorrigido: num(corpo[i]), juros: num(corpo[i + 1]), total: num(corpo[i + 2]) };
        i += 3;
      } else i += 1;
    }
  }
  // composição: "Descrição de Créditos e Descontos do Reclamante" / "Débitos do Reclamado por Credor"
  const composicao = [];
  const ci = t.indexOf('Descrição de Créditos e Descontos do Reclamante');
  if (ci >= 0) {
    const resto = t.slice(ci).split('\n').map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i + 1 < resto.length; i++) {
      // o quadro pode continuar na página seguinte: rodapé e número da página não encerram a composição
      if (/^C[aá]lculo liquidado por|^P[aá]g\. \d+ de/.test(resto[i])) { if (/^P[aá]g\./.test(resto[i]) && NUM.test(resto[i + 1])) i += 1; continue; }
      if (!NUM.test(resto[i]) && NUM.test(resto[i + 1]) && !/^Descri[cç][aã]o de|^Valor$/.test(resto[i])) {
        composicao.push({ descricao: resto[i], valor: num(resto[i + 1]) });
        i += 1;
      }
    }
  }
  const bruto = num(pick(new RegExp(`Bruto Devido ao Reclamante\s*\n${VALOR}`)));
  const somaRubricas = Math.round(linhas.reduce((a, x) => a + (x.total || 0), 0) * 100) / 100;
  const conferencia = {
    somaRubricas,
    totalDoQuadro: totaisQuadro ? totaisQuadro.total : null,
    rubricasNegativas: linhas.filter((x) => x.total < 0).map((x) => `${x.descricao}: ${x.total}`),
  };
  conferencia.somaConfere = totaisQuadro ? Math.abs(somaRubricas - totaisQuadro.total) < 0.011 : null;
  conferencia.brutoIgualAoQuadro = totaisQuadro && bruto != null ? Math.abs(bruto - totaisQuadro.total) < 0.011 : null;
  if (conferencia.somaConfere === false) conferencia.alerta = `A soma das rubricas lidas (${somaRubricas}) difere do total do quadro (${totaisQuadro.total}): confira o relatório (calculo_relatorio) — alguma linha não foi reconhecida.`;
  return {
    verbas: linhas,
    totaisDoQuadro: totaisQuadro,
    composicao,
    conferencia,
    brutoDevidoAoReclamante: bruto,
    liquidoDevidoAoReclamante: num(pick(new RegExp(`L[ií]quido Devido ao Reclamante\s*\n${VALOR}`))),
    totalDevidoPeloReclamado: num(pick(new RegExp(`Total Devido pelo Reclamado\s*\n${VALOR}`))),
    totalDescontos: num(pick(new RegExp(`Total de Descontos\s*\n${VALOR}`))),
    contribuicaoSocialSalariosDevidos: num(pick(new RegExp(`CONTRIBUI[CÇ][AÃ]O SOCIAL SOBRE SAL[AÁ]RIOS DEVIDOS\s*\n${VALOR}`))),
    custasReclamado: num(pick(new RegExp(`CUSTAS JUDICIAIS DEVIDAS PELO RECLAMADO\s*\n${VALOR}`))),
    percentualRemuneratorio: pick(/Percentual de Parcelas Remunerat[oó]rias e Tribut[aá]veis:\s*(-?[\d.,]+%)/),
    dataLiquidacao: pick(/Data (?:de )?Liquida[cç][aã]o:?\s*\n?(\d{2}\/\d{2}\/\d{4})/),
    rodape: pick(/(C[aá]lculo liquidado por[^\n]+)/),
  };
}

/**
 * Critérios que o PJe-Calc aplicou de fato (relatório JUSTIFICATIVA: aviso prévio, índice e última taxa,
 * juros por fase, contribuição social, IR...). Para conferir as premissas no resultado, não só no JSON.
 */
export async function lerJustificativa(op) {
  try {
    const r = await op.relatorio({ tipos: ['JUSTIFICATIVA'] });
    const t = r.texto.split('Critério de Cálculo e Fundamentação Legal')[1] || '';
    return t.split(/\n\d+\.\n/).map((x) => x.replace(/\s+/g, ' ').replace(/C[aá]lculo liquidado.*$/, '').trim()).filter(Boolean);
  } catch (e) {
    // uma falha de leitura nunca é devolvida como se fosse a justificativa
    const erro = new Error(`não foi possível ler a justificativa: ${e.message}`);
    erro.naoVerificado = true;
    throw erro;
  }
}

/**
 * Conferências depois da liquidação (cálculo aberto em `op`): justificativa, soma do resumo, conferência
 * independente das ocorrências (sobre a exportação do PJe-Calc) e comparação com a especificação.
 * Qualquer falha de leitura vira "nao_verificado" — nunca sucesso.
 */
/**
 * Seções do relatório completo (Operações > Imprimir) que se aplicam ao cálculo: as que têm conteúdo nele. Seção
 * de cartão sem cartões faz o PJe-Calc falhar; as outras sem conteúdo sairiam como páginas só com o cabeçalho.
 */
export function secoesDoRelatorio(arvore) {
  const qtd = (k) => itens(campo(arvore, k)).filter((x) => x && x.$classe).length;
  const sub = (k, f) => { const o = campo(arvore, k); return o ? campo(o, f) : null; };
  const ocorrencias = (o) => (o ? itens(campo(o, 'ocorrencias')).filter((x) => x && x.$classe).length : 0);
  const verbasAtivas = itens(campo(arvore, 'verbas')).filter((v) => v && v.$classe && campo(v, 'ativo') !== 'false').length;
  const cu = campo(arvore, 'custasJudiciais');
  const temCustas = cu && (['tipoDeCustasDeConhecimentoDoReclamante', 'tipoDeCustasDeConhecimentoDoReclamado', 'tipoDeCustasDeLiquidacao'].some((k) => { const v = campo(cu, k); return v && v !== 'NAO_SE_APLICA'; })
    || campo(cu, 'dataVencimentoCustasFixas') != null || ['autosJudiciais', 'armazenamentos'].some((k) => itens(campo(cu, k)).some((x) => x && x.$classe)));
  const inssOcorr = ocorrencias(sub('inss', 'inssSobreSalariosDevidos'));
  const fgtsOcorr = ocorrencias(campo(arvore, 'fgts'));
  const secoes = [
    ['RESUMO_DE_CALCULO', true],
    ['DADOS_DO_CALCULO', true],
    ['FALTAS_E_FERIAS', qtd('faltas') + qtd('listaDeFerias') > 0],
    ['HISTORICO_SALARIAL', qtd('historicosSalariais') > 0],
    ['CARTAO_MENSAL', qtd('cartoesDePonto') > 0],
    ['CARTAO_DIARIO', qtd('apuracoesDiariasCartaoDePonto') > 0],
    ['DEMONSTRATIVO_DE_CALCULO', verbasAtivas > 0],
    ['APURACAO_DE_JUROS', qtd('apuracoesDeJuros') > 0],
    ['SALARIO_FAMILIA', sub('salarioFamilia', 'apurarSalarioFamilia') === 'true'],
    ['SEGURO_DESEMPREGO', sub('seguroDesemprego', 'apurarSeguroDesemprego') === 'true'],
    ['DEMONSTRATIVO_FGTS', fgtsOcorr > 0],
    ['DEMONSTRATIVO_INSS', inssOcorr > 0],
    ['DEMONSTRATIVO_ESOCIAL_INSS_FGTS', inssOcorr + fgtsOcorr > 0],
    ['PREVIDENCIA_PRIVADA', sub('previdenciaPrivada', 'apurarPrevidenciaPrivada') === 'true'],
    ['PENSAO_ALIMENTICIA', sub('pensaoAlimenticia', 'apurarPensaoAlimenticia') === 'true'],
    ['DEMONSTRATIVO_IRPF', sub('irpf', 'apurarImpostoRenda') === 'true'],
    ['DEMONSTRATIVO_MULTA', qtd('multas') > 0],
    ['DEMONSTRATIVO_HONORARIO', qtd('honorarios') > 0],
    ['DEMONSTRATIVO_CUSTAS', Boolean(temCustas)],
    ['JUSTIFICATIVA', true],
  ];
  return secoes.filter(([, aplica]) => aplica).map(([s]) => s);
}

/** Relatório completo em PDF (as seções que se aplicam ao cálculo aberto). */
export async function gravarRelatorioCompleto(op, arvore, destino) {
  const secoes = secoesDoRelatorio(arvore);
  const r = await op.relatorio({ tipos: secoes, formato: 'PDF' });
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, r.bytes);
  return { arquivo: destino, secoes, bytes: r.bytes.length };
}

/** Seções que se aplicam ao cálculo aberto no operador (lidas do cálculo exportado). */
export async function secoesDoCalculoAberto(op) {
  return secoesDoRelatorio(lerPjc((await op.exportarPjc()).bytes).arvore);
}

async function conferirLiquidacao(op, { resultado, verbasEspecificacao = null, cartao = null, zerosJustificados = [], salvarEm = null, relatorioEm = null, edicoes = [], encargos = null, custas = null }) {
  const verif = [];
  let justificativa = null;
  try {
    justificativa = await lerJustificativa(op);
    verif.push({ item: 'justificativa do PJe-Calc', estado: justificativa.length >= 3 ? 'ok' : 'nao_verificado', detalhe: `${justificativa.length} critério(s) lidos` });
  } catch (e) { verif.push({ item: 'justificativa do PJe-Calc', estado: 'nao_verificado', detalhe: e.message }); }
  const c = resultado && resultado.conferencia;
  verif.push({ item: 'soma das rubricas = total do quadro = bruto', estado: !c || c.somaConfere == null ? 'nao_verificado' : c.somaConfere && c.brutoIgualAoQuadro ? 'ok' : 'falha', detalhe: c ? `soma ${c.somaRubricas}, quadro ${c.totalDoQuadro}${c.alerta ? ` — ${c.alerta}` : ''}` : 'resumo não lido' });
  let arvore = null;
  try {
    const ex = await op.exportarPjc();
    arvore = lerPjc(ex.bytes).arvore;
    if (salvarEm) fs.writeFileSync(salvarEm, ex.bytes);
    verif.push(...conferenciaIndependente(arvore, { cartao, zerosJustificados }));
  } catch (e) { verif.push({ item: 'conferência independente das ocorrências', estado: 'nao_verificado', detalhe: `exportação do cálculo liquidado falhou: ${e.message}` }); }
  // recálculo independente de verbas, juros, FGTS, contribuição social, IR, honorários e custas, comparado com os
  // relatórios impressos pelo próprio PJe-Calc; e as regras de validação do aplicativo sobre o cálculo exportado
  let recalculo = null;
  if (arvore) {
    try {
      recalculo = recalcularPjc(arvore);
      const textos = {};
      for (const t of ['DEMONSTRATIVO_FGTS', 'APURACAO_DE_JUROS', 'DEMONSTRATIVO_IRPF']) {
        try { textos[t] = (await op.relatorio({ tipos: [t] })).texto; } catch { /* relatório ausente: a comparação fica "não verificado" */ }
      }
      verif.push(...recalculo.verificacoes, ...compararComRelatorios(recalculo, { resumo: resultado, textos }));
    } catch (e) { verif.push({ item: 'recálculo independente (FGTS, contribuição social, IR, juros)', estado: 'nao_verificado', detalhe: e.message, dimensao: 'aritmetica' }); }
    verif.push(...conferirCriterios(justificativa, arvore));
    if (edicoes.length) verif.push({ ...conferirEdicoes(arvore, edicoes), item: 'valores mês a mês nas ocorrências do cálculo liquidado' });
    if (temEdicoesEncargos(encargos)) verif.push({ ...conferirEdicoesEncargos(arvore, encargos), item: 'ocorrências de FGTS e de contribuição social do cálculo liquidado' });
    if (custas && (custas.fixas || custas.autos || custas.armazenamentos)) verif.push(conferirCustas(arvore, custas));
    verif.push(...verificacoesDaValidacao(validarArvore(arvore, { momento: 'ocorrencias' }), { momento: 'ocorrencias' }).map((x) => (x.estado === 'falha' ? { ...x, estado: 'alerta', detalhe: `${x.detalhe} (o quadro de pendências do aplicativo é o oficial)` } : x)));
  }
  if (verbasEspecificacao) verif.push(...compararEspecificacaoResultado({ verbasEspecificacao, arvore, resultado, zerosJustificados }));
  // relatório completo em PDF, com as seções que se aplicam ao cálculo (o mesmo que a tela imprime)
  let relatorioCompleto = null;
  if (arvore && relatorioEm) {
    try { relatorioCompleto = await gravarRelatorioCompleto(op, arvore, relatorioEm); } catch (e) { relatorioCompleto = { erro: `relatório completo não gerado: ${e.message}` }; }
  }
  return { verificacoes: verif, justificativa, arquivoLiquidado: arvore && salvarEm ? salvarEm : null, relatorioCompleto };
}

function versaoDoArquivo(rel, re) {
  try { return (re.exec(fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf-8')) || [])[1] || null; } catch { return null; }
}

/** Registro de reprodução: versões, especificação usada, entradas e saídas (ao lado do .PJC). */
function gravarRegistro(arquivoPjc, { spec, out }) {
  try {
    const registro = {
      geradoEm: new Date().toISOString(),
      versoes: {
        mcp: versaoDoArquivo('server/package.json', /"version":\s*"([^"]+)"/),
        skill: versaoDoArquivo('SKILL.md', /version:\s*(\S+)/),
        pjecalc: (ehInstalacao(home()) || {}).versao || null,
        node: process.version,
        tabelas: out.tabelas ? { regional: out.tabelas.regionalCarregado || null, atualizadas: out.tabelas.atualizadas ?? null, indices: out.tabelas.indices || null } : null,
      },
      entrada: { sha256: crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex'), especificacao: spec },
      saida: {
        idCalculo: out.idCalculo, arquivo: out.arquivo, arquivoPronto: out.arquivoPronto || null, arquivoLiquidado: out.arquivoLiquidado || null,
        estado: out.estado, dimensoes: out.dimensoes || null, bloqueiosDeEntrega: out.bloqueiosDeEntrega, verificacoes: out.verificacoes,
        totais: out.resultado ? { bruto: out.resultado.brutoDevidoAoReclamante, liquido: out.resultado.liquidoDevidoAoReclamante, totalReclamado: out.resultado.totalDevidoPeloReclamado, dataLiquidacao: out.resultado.dataLiquidacao } : null,
        justificativa: out.justificativa || null,
      },
    };
    const p = `${arquivoPjc}.registro.json`;
    fs.writeFileSync(p, JSON.stringify(registro, null, 2));
    return p;
  } catch { return null; }
}

/** Resumo legível de um arquivo .PJC. */
export function lerArquivo(arquivo) {
  const { arvore, nomeInterno } = lerPjc(fs.readFileSync(arquivo));
  const proc = campo(arvore, 'processo');
  const ident = campo(proc, 'identificador');
  const hist = {};
  for (const h of itens(campo(arvore, 'historicosSalariais'))) {
    if (!h.$classe) continue;
    const oc = itens(campo(h, 'ocorrencias')).filter((x) => x.$classe);
    hist[campo(h, 'id')] = campo(h, 'nome');
    hist[`_${campo(h, 'nome')}`] = { ocorrencias: oc.length, de: oc[0] && msParaData(campo(oc[0], 'dataOcorrencia')), ate: oc.length && msParaData(campo(oc[oc.length - 1], 'dataOcorrencia')), valores: [...new Set(oc.map((x) => campo(x, 'valor')))] };
  }
  const verbas = [];
  for (const o of objetos(arvore)) {
    if (!['Calculada', 'Informada', 'Reflexo'].includes(o.$classe)) continue;
    if (verbas.some((v) => v.id === campo(o, 'id'))) continue;
    const f = campo(o, 'formula');
    const bt = campo(f, 'baseTabelada');
    const q = campo(f, 'quantidade');
    verbas.push({
      id: campo(o, 'id'), tipo: o.$classe, nome: campo(o, 'nome'), ativa: campo(o, 'ativo') === 'true',
      periodo: `${msParaData(campo(o, 'periodoInicial'))} a ${msParaData(campo(o, 'periodoFinal'))}`,
      base: bt ? campo(bt, 'tipo') : undefined,
      historicos: itens(campo(o, 'historicosDaVerbaDoValorDevido')).map((x) => { const h = campo(x, 'historicoSalarial'); return h && (hist[h.id] || h.id); }),
      quantidade: q ? `${campo(q, 'tipo')} ${campo(q, 'valorInformado') ?? ''}`.trim() : undefined,
      multiplicador: campo(campo(f, 'multiplicador'), 'outroValor') ?? undefined,
      valorInformado: campo(campo(f, 'constante'), 'valor') ?? undefined,
      incidencias: { inss: campo(o, 'incidenciaINSS'), irpf: campo(o, 'incidenciaIRPF'), fgts: campo(o, 'incidenciaFGTS') },
      ocorrencias: itens(campo(o, 'ocorrencias')).length,
    });
  }
  const fg = campo(arvore, 'fgts');
  const par = campo(arvore, 'parametrosDeAtualizacao');
  return {
    arquivoInterno: nomeInterno,
    processo: ident && campo(ident, 'numero') ? `${String(campo(ident, 'numero')).padStart(7, '0')}-${String(campo(ident, 'digito')).padStart(2, '0')}.${campo(ident, 'ano')}.${campo(ident, 'justica')}.${String(campo(ident, 'regiao')).padStart(2, '0')}.${String(campo(ident, 'vara')).padStart(4, '0')}` : null,
    reclamante: campo(campo(proc, 'reclamante'), 'nome'),
    reclamado: campo(campo(proc, 'reclamado'), 'nome'),
    admissao: msParaData(campo(arvore, 'dataAdmissao')),
    demissao: msParaData(campo(arvore, 'dataDemissao')),
    ajuizamento: msParaData(campo(arvore, 'dataAjuizamento')),
    liquidadoEm: msParaData(campo(arvore, 'dataDeLiquidacao')),
    historicos: Object.fromEntries(Object.entries(hist).filter(([k]) => k.startsWith('_')).map(([k, v]) => [k.slice(1), v])),
    verbas,
    ferias: itens(campo(arvore, 'listaDeFerias')).filter((x) => x.$classe).map((x) => `${campo(x, 'relativa')}: ${campo(x, 'situacao')} (${campo(x, 'prazo')} dias)`),
    faltas: itens(campo(arvore, 'faltas')).filter((x) => x.$classe).map((x) => `${msParaData(campo(x, 'dataInicioPeriodoFalta'))} a ${msParaData(campo(x, 'dataTerminoPeriodoFalta'))}${campo(x, 'faltaJustificada') === 'true' ? ' (justificada)' : ''}`),
    cartoesDePonto: itens(campo(arvore, 'cartoesDePonto')).filter((x) => x.$classe).map((x) => `${campo(x, 'nome')} (${itens(campo(x, 'ocorrencias')).length} meses)`),
    apuracoesCartaoPonto: itens(campo(arvore, 'apuracoesCartaoDePonto')).filter((x) => x.$classe).map((x) => `${msParaData(campo(x, 'dataInicial'))} a ${msParaData(campo(x, 'dataFinal'))}: ${campo(x, 'preenchimentoJornadasCartao')}${campo(x, 'preenchimentoJornadasCartao') === 'ESCALA' ? ` ${campo(x, 'tipoEscalaPreenchimentoJornadaCartaoEnum')}` : ''}, ${campo(x, 'formaDeApuracaoCartao')}, ${itens(campo(x, 'ocorrenciasJornadaApuracaoCartao')).length} jornada(s) no arquivo`),
    fgts: fg && { destino: campo(fg, 'destinoDoFgts'), aliquota: campo(fg, 'aliquota'), multa: campo(fg, 'multa'), percentualMulta: campo(fg, 'multaDoFgts') },
    honorarios: itens(campo(arvore, 'honorarios')).filter((x) => x.$classe).map((x) => ({ descricao: campo(x, 'descricao'), devedor: campo(x, 'tipoDeDevedor'), credor: campo(x, 'nomeCredor'), percentual: campo(x, 'aliquota'), valor: campo(x, 'valor') })),
    multas: itens(campo(arvore, 'multas')).filter((x) => x.$classe).map((x) => ({ descricao: campo(x, 'descricao'), percentual: campo(x, 'aliquotaMulta'), valor: campo(x, 'valorMulta') })),
    correcaoJuros: par && {
      indice: campo(par, 'indiceTrabalhista'), juros: campo(par, 'juros'), jurosFasePreJudicial: campo(par, 'aplicarJurosFasePreJudicial'),
      combinacoesIndice: itens(campo(par, 'listaDeCombinacaoDeIndices')).filter((x) => x.$classe).map((x) => `${campo(x, 'outroIndiceTrabalhista')} a partir de ${msParaData(campo(x, 'apartirDeOutroIndice'))}`),
      combinacoesJuros: itens(campo(par, 'listaDeCombinacaoDeJuros')).filter((x) => x.$classe).map((x) => `${campo(x, 'outroJuros')} a partir de ${msParaData(campo(x, 'apartirDeOutroJuros'))}`),
    },
  };
}

/**
 * Refaz a biblioteca de verbas (modelos/verbas-expresso.json) a partir do PJe-Calc em execução:
 * importa um cálculo-base, lança TODAS as verbas do Expresso, exporta, monta a biblioteca e exclui
 * o cálculo temporário. Use depois de atualizar o PJe-Calc ou as tabelas de verbas.
 */
export async function atualizarBibliotecaVerbas() {
  await garantirPjeCalc({ iniciar: true });
  const exemplo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'exemplos', 'calculo-referencia.json'), 'utf-8'));
  const base = { processo: exemplo.processo, calculo: { ...exemplo.calculo, comentarios: 'CALCULO TEMPORARIO DO MCP (BIBLIOTECA DE VERBAS) - PODE EXCLUIR' }, historicosSalariais: exemplo.historicosSalariais };
  const tmp = path.join(DIR_SAIDA, 'tmp-biblioteca-base.PJC');
  const { arvore } = gerarCalculo(base);
  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  fs.writeFileSync(tmp, gravarPjc(arvore, 'BIBLIOTECA.PJC'));
  const op = new OperadorPjeCalc();
  const imp = await op.importarPjc(fs.readFileSync(tmp), 'BIBLIOTECA.PJC');
  try {
    const lanc = await op.lancarExpresso('*');
    const ex = await op.exportarPjc();
    const verbas = construirBibliotecaVerbas(ex.bytes);
    const atualizadoEm = new Date().toISOString();
    salvarModelo('verbas-expresso', { origem: 'Exportação de cálculo com todas as verbas do lançamento Expresso (atualizada pelo MCP)', atualizadoEm, verbas });
    limparCacheModelos();
    try { fs.writeFileSync(arquivoMarcaBiblioteca(), JSON.stringify({ modelo: atualizadoEm, conferidaEm: atualizadoEm }, null, 2)); } catch { /* sem .dados: só deixa de lembrar */ }
    return { verbas: verbas.length, reflexos: verbas.reduce((a, v) => a + v.reflexos.length, 0), lancadasNoExpresso: lanc.lancadas.length };
  } finally {
    try { await op.abrirCalculo(imp.idCalculo); await op.excluirCalculo(); } catch { /* o cálculo temporário pode ser excluído manualmente */ }
    try { fs.unlinkSync(tmp); } catch { /* ok */ }
  }
}

// A biblioteca de verbas do Expresso (incidências, parcela fixa ou variável, reflexos e até os nomes) muda
// quando o PJe-Calc sincroniza as tabelas. O gerador tem de usar a biblioteca do PJe-Calc deste usuário:
// cada instalação guarda em .dados quando a biblioteca foi conferida, e ela é refeita na primeira vez e
// depois de cada sincronização de tabelas.
const arquivoMarcaBiblioteca = () => path.join(dadosDir(), 'pjecalc-mcp-biblioteca.json');

/** Motivo para refazer a biblioteca, ou null se ela já é a deste PJe-Calc. */
export function motivoBibliotecaDesatualizada(marca, modeloAtualizadoEm, tabelasAtualizadasEm) {
  if (!marca || !marca.conferidaEm) return 'a biblioteca de verbas do MCP ainda não foi conferida com a deste PJe-Calc';
  if (marca.modelo !== modeloAtualizadoEm) return 'a biblioteca de verbas do MCP foi trocada desde a última conferência com este PJe-Calc';
  if (tabelasAtualizadasEm && tabelasAtualizadasEm > marca.conferidaEm) return 'as tabelas do PJe-Calc foram sincronizadas depois da última conferência da biblioteca de verbas';
  return null;
}

/** Refaz a biblioteca de verbas a partir do PJe-Calc em execução quando ela não é a dele. */
export async function alinharBibliotecaDeVerbas() {
  let marca = null;
  try { marca = JSON.parse(fs.readFileSync(arquivoMarcaBiblioteca(), 'utf-8')); } catch { /* nunca conferida */ }
  const tab = tabelas.regionalCarregado();
  const motivo = motivoBibliotecaDesatualizada(marca, carregarModelo('verbas-expresso').atualizadoEm, tab ? tab.tabelasMudaramEm || tab.atualizadoEm : null);
  if (!motivo) return null;
  return { atualizada: true, motivo, ...(await atualizarBibliotecaVerbas()) };
}

/** Refaz modelos/catalogos.json a partir do banco H2 (PJe-Calc PARADO). */
export async function atualizarCatalogos() {
  const st = await life.status();
  if (st.processos.length) throw new Error('Pare o PJe-Calc (pjecalc_parar) antes: o banco H2 fica bloqueado enquanto ele roda.');
  const h2 = await import('./h2.mjs');
  const municipios = (await h2.select('SELECT ICDMUNICIPIO, SNMMUNICIPIO, SSGESTADO, SFLCAPITAL FROM TBMUNICIPIO ORDER BY SSGESTADO, SNMMUNICIPIO', { maxRows: 20000 }))
    .map((r) => ({ id: Number(r.ICDMUNICIPIO), nome: r.SNMMUNICIPIO, uf: r.SSGESTADO, capital: r.SFLCAPITAL === 'S' }));
  const estados = (await h2.select('SELECT SSGESTADO, SNMESTADO FROM TBESTADO ORDER BY SSGESTADO', { maxRows: 100 })).map((r) => ({ uf: r.SSGESTADO, nome: r.SNMESTADO }));
  const assuntos = (await h2.select('SELECT ICDASSUNTO, SDSASSUNTO, ICDASSUNTOPAI FROM TBASSUNTOCNJ ORDER BY ICDASSUNTO', { maxRows: 20000 }))
    .map((r) => ({ codigo: Number(r.ICDASSUNTO), descricao: r.SDSASSUNTO, pai: r.ICDASSUNTOPAI ? Number(r.ICDASSUNTOPAI) : null }));
  const feriados = (await h2.select('SELECT SUIDFERIADO, SNMFERIADO, STPFERIADO, STPABRANGENCIA, SSGESTADO, ICDMUNICIPIO, DDTFERIADO, SFLFERIADOMOVEL, DDTINICIOVIGENCIA, DDTFIMVIGENCIA FROM TBFERIADO ORDER BY SNMFERIADO', { maxRows: 20000 }))
    .map((r) => ({ uid: r.SUIDFERIADO, nome: r.SNMFERIADO, tipo: r.STPFERIADO, abrangencia: r.STPABRANGENCIA, uf: r.SSGESTADO || null, municipio: r.ICDMUNICIPIO ? Number(r.ICDMUNICIPIO) : null, data: r.DDTFERIADO || null, movel: r.SFLFERIADOMOVEL === 'S', inicioVigencia: r.DDTINICIOVIGENCIA || null, fimVigencia: r.DDTFIMVIGENCIA || null }));
  const atividadesEconomicas = (await h2.select('SELECT IIDATIVIDADEECONOMICA, SDSATIVIDADEECONOMICA FROM TBATIVIDADEECONOMICA ORDER BY IIDATIVIDADEECONOMICA', { maxRows: 20000 }))
    .map((r) => ({ id: Number(r.IIDATIVIDADEECONOMICA), descricao: r.SDSATIVIDADEECONOMICA }));
  // pisos salariais e vales-transporte cadastrados no PJe-Calc do usuário (referências por id nas verbas)
  const pisos = (await h2.select('SELECT S.IIDSALARIOCATEGORIA, S.SNMSALARIOCATEGORIA, S.SSGESTADO, MIN(O.DDTOCORRENCIA) INI, MAX(O.DDTOCORRENCIA) FIM, COUNT(O.IIDOCORRENCIASALARIOCATEGORIA) N FROM TBSALARIOCATEGORIA S LEFT JOIN TBOCORRENCIASALARIOCATEGORIA O ON O.IIDSALARIOCATEGORIA = S.IIDSALARIOCATEGORIA GROUP BY S.IIDSALARIOCATEGORIA, S.SNMSALARIOCATEGORIA, S.SSGESTADO ORDER BY S.SSGESTADO, S.SNMSALARIOCATEGORIA', { maxRows: 20000 }))
    .map((r) => ({ id: Number(r.IIDSALARIOCATEGORIA), nome: r.SNMSALARIOCATEGORIA, uf: r.SSGESTADO, de: r.INI || null, ate: r.FIM || null, competencias: Number(r.N || 0) }));
  const valesTransporte = (await h2.select('SELECT V.IIDVALETRANSPORTE, V.SDSLINHA, V.STPLINHA, V.SSGESTADO, V.ICDMUNICIPIO, V.DDTENCERRAMENTOLINHA, COUNT(O.IIDOCORRENCIAVALETRANSPORTE) N FROM TBVALETRANSPORTE V LEFT JOIN TBOCORRENCIAVALETRANSPORTE O ON O.IIDVALETRANSPORTE = V.IIDVALETRANSPORTE GROUP BY V.IIDVALETRANSPORTE, V.SDSLINHA, V.STPLINHA, V.SSGESTADO, V.ICDMUNICIPIO, V.DDTENCERRAMENTOLINHA ORDER BY V.SSGESTADO, V.SDSLINHA', { maxRows: 20000 }))
    .map((r) => ({ id: Number(r.IIDVALETRANSPORTE), linha: r.SDSLINHA, tipo: r.STPLINHA, uf: r.SSGESTADO, municipio: r.ICDMUNICIPIO ? Number(r.ICDMUNICIPIO) : null, encerrada: r.DDTENCERRAMENTOLINHA || null, valores: Number(r.N || 0) }));
  salvarModelo('catalogos', { origem: 'Banco H2 do PJe-Calc (atualizado pelo MCP)', atualizadoEm: new Date().toISOString(), municipios, estados, assuntos, feriados, atividadesEconomicas, pisos, valesTransporte });
  limparCacheModelos();
  return { municipios: municipios.length, estados: estados.length, assuntos: assuntos.length, feriados: feriados.length, atividadesEconomicas: atividadesEconomicas.length, pisos: pisos.length, valesTransporte: valesTransporte.length };
}

export function catalogoVerbas(filtro = null) {
  const n = filtro ? String(filtro).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() : null;
  return bibliotecaVerbas()
    .filter((v) => !n || v.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes(n))
    .map((v) => ({ verba: v.nome.trim(), ...v.resumo, reflexos: v.reflexos.map((r) => r.nome.trim()) }));
}

export { carregarModelo };
