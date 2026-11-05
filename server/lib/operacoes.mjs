// pjecalc-mcp-skill · lib/operacoes.mjs
// Operações de alto nível sobre a interface do PJe-Calc em execução, todas executadas pelas
// regras de negócio do próprio aplicativo (as mesmas ações dos botões da interface):
//
//   importarPjc      -> "Importar Cálculo" (upload do .PJC + Confirmar)
//   abrirCalculo     -> abre um cálculo pelo número (lista de recentes ou busca)
//   regerarOcorrencias -> Verbas > selecionar todas > Regerar (manter/sobrescrever alterações)
//   regerarOcorrenciasEncargo -> FGTS ou Contribuição Social > Ocorrências > Regerar > Confirmar
//   pendencias       -> Operações > Liquidar (lê "Pendências do Cálculo" sem liquidar)
//   liquidar         -> Operações > Liquidar (data de liquidação + botão Liquidar)
//   relatorio        -> Operações > Imprimir (HTML), devolve o texto do relatório
//   exportarPjc      -> Operações > Exportar (bytes do .PJC)
//   listarCalculos   -> Cálculo > Buscar (todos os cálculos do banco)
//   excluirCalculo   -> Operações > Excluir
//   apurarCartaoDePonto -> Cartão de Ponto: Alterar > Salvar cada apuração + Apurar Cartão de Ponto
//   vincularCartaoNaVerba -> Parâmetros da Verba: quantidade/divisor importado de uma coluna do cartão

import { SessaoPjeCalc, textoPuro, camposDoFormulario, opcoesDoSelect } from './web.mjs';

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function exigirSucesso(pagina, acao) {
  const msgs = [...(pagina.respostaAjax ? pagina.respostaAjax.mensagens : []), ...pagina.mensagens];
  const texto = `${pagina.respostaAjax ? pagina.respostaAjax.texto : ''}\n${pagina.texto}`;
  if (pagina.erroInterno) {
    const e = new Error(`O PJe-Calc mostrou "Erro Interno no Servidor" ao ${acao}. Veja pjecalc_logs.`);
    e.mensagens = msgs;
    throw e;
  }
  const erro = /(^|\n)Erro\.\s*\n([^\n]+)/.exec(texto);
  if (erro) {
    const e = new Error(`O PJe-Calc recusou ${acao}: ${erro[2].trim()}`);
    e.mensagens = msgs;
    e.errosDeCampo = errosDeCampo(pagina.html);
    throw e;
  }
  return msgs;
}

/** Mensagens de validação ligadas a campos (spans "...Erro" do PJe-Calc). */
export function errosDeCampo(html) {
  const out = [];
  const re = /<span[^>]*id="formulario:([A-Za-z0-9_:]+?)Erro"[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const t = textoPuro(m[2]).split('//')[0].trim();
    if (t) out.push({ campo: m[1], mensagem: t });
  }
  return out;
}

/**
 * Integridade da seleção: a página aberta precisa mostrar o número pedido. Numa sessão reaproveitada
 * (ou com a lista de recentes desatualizada) outro cálculo poderia ser alterado ou liquidado no lugar.
 */
export function conferirAberto(p, idCalculo) {
  const aberto = (p.html.match(/id="formulario:idCalculo"[^>]*value="([^"]*)"/) || [])[1];
  if (aberto && Number(aberto) !== Number(idCalculo)) {
    throw new Error(`Integridade da sessão: foi pedido o cálculo ${idCalculo}, mas o PJe-Calc abriu o ${aberto}. Nada foi alterado; repita a operação.`);
  }
  return p;
}

/** Data para os campos de data das telas (dd/mm/aaaa); aceita também aaaa-mm-dd. */
export function dataTela(d) {
  if (d == null || d === '') return d;
  const t = String(d).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
}

export class OperadorPjeCalc {
  constructor(base = null) {
    this.base = base;
    this.s = new SessaoPjeCalc(base);
    this.idAberto = null;
    this.jaRegerou = false;
  }

  async inicio() {
    return this.s.inicio();
  }

  /** Importa um .PJC (bytes do ZIP). Devolve o número do cálculo criado (já aberto). */
  async importarPjc(bytes, nomeArquivo = 'calculo.PJC') {
    await this.s.inicio();
    const link = this.s.achar((c) => c.titulo === 'Importar Cálculo');
    if (!link) throw new Error('Link "Importar Cálculo" não encontrado na página inicial.');
    await this.s.enviar(link);
    await this.s.enviarArquivoRichUpload('formulario:arquivo', nomeArquivo, bytes, 'application/zip');
    const p = await this.s.clicar('confirmarImportacao');
    const msgs = exigirSucesso(p, 'importar o cálculo');
    const id = (p.html.match(/id="formulario:idCalculo"[^>]*value="([^"]*)"/) || [])[1];
    if (!id) throw new Error(`Importação sem número de cálculo. Mensagens: ${msgs.join(' | ')}`);
    this.idAberto = Number(id);
    this.jaRegerou = false;
    return { idCalculo: Number(id), mensagens: msgs, url: p.url };
  }

  /** Abre um cálculo pelo número (procura na lista de recentes; senão usa a busca). */
  async abrirCalculo(idCalculo) {
    let p = await this.s.inicio();
    const sel = p.html.match(/<select[^>]*listaCalculosRecentes[^>]*>/);
    if (sel) {
      const nome = (sel[0].match(/name="([^"]+)"/) || [])[1];
      const temOpcao = new RegExp(`<option[^>]*value="${idCalculo}"`).test(p.html);
      if (nome && temOpcao) {
        p = await this.s.enviar(this.s.achar((c) => c.evento === 'ondblclick'), { [nome]: String(idCalculo) });
        if (!p.erroInterno && /calculo\.jsf/.test(p.url)) { conferirAberto(p, idCalculo); this.idAberto = Number(idCalculo); return p; }
      }
    }
    // busca
    p = await this.s.inicio();
    p = await this.s.enviar(this.s.achar((c) => c.titulo === 'Buscar Cálculo'));
    p = await this.s.clicar((c) => norm(c.valor) === 'buscar' || /:buscar$/.test(c.id || ''), { 'formulario:numeroCalculoBusca': String(idCalculo) });
    const abrir = this.s.achar((c) => c.tipo && /listagem:\d+:/.test(c.id || '') && /abrir|alterar|editar/i.test(`${c.titulo} ${c.texto}`));
    if (!abrir) throw new Error(`Cálculo ${idCalculo} não encontrado.`);
    p = await this.s.enviar(abrir);
    conferirAberto(p, idCalculo);
    this.idAberto = Number(idCalculo);
    return p;
  }

  /** Sessão nova no mesmo cálculo (o PJe-Calc guarda listas e o cálculo da conversa na sessão). */
  async novaSessao() {
    if (this.idAberto == null) throw new Error('Nenhum cálculo aberto para reabrir em sessão nova.');
    this.s = new SessaoPjeCalc(this.base);
    this.jaRegerou = false;
    return this.abrirCalculo(this.idAberto);
  }

  /** Lista os cálculos (Cálculo > Buscar sem filtros). */
  async listarCalculos() {
    let p = await this.s.inicio();
    p = await this.s.enviar(this.s.achar((c) => c.titulo === 'Buscar Cálculo'));
    const b = this.s.achar((c) => norm(c.valor) === 'buscar' || /:buscar$/.test(c.id || ''));
    if (b) p = await this.s.enviar(b);
    const linhas = [];
    const re = /<tr[^>]*class="[^"]*rich-table-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = re.exec(p.html))) {
      const cel = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => textoPuro(x[1]));
      if (cel.some((x) => x)) linhas.push(cel.filter((x) => x !== ''));
    }
    return linhas;
  }

  /** Verbas > selecionar todas > Regerar. manterAlteracoes=false sobrescreve ocorrências editadas. */
  async regerarOcorrencias({ manterAlteracoes = false } = {}) {
    // O PJe-Calc só regera as verbas marcadas como alteradas e guarda a lista na
    // sessão: uma segunda regeração na mesma sessão diz "sucesso" e não regera nada. Reabre o cálculo.
    if (this.jaRegerou) await this.novaSessao();
    let p = await this.s.menu('Verbas');
    // principais: listagem:N:verbaSelecionada; reflexos ativos: listagem:N:listaReflexo:M:<j_id> (a
    // caixa ":ativo" liga/desliga o reflexo e NÃO deve ser enviada aqui). Sem marcar os reflexos,
    // o PJe-Calc regera só as principais e os reflexos ficam sem ocorrências (valor zero).
    const inputs = [...p.html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map((x) => x[0]);
    const principais = [];
    const reflexos = [];
    for (const t of inputs) {
      const nome = (t.match(/name="([^"]+)"/) || [])[1];
      if (!nome) continue;
      if (/^formulario:listagem:\d+:verbaSelecionada$/.test(nome)) principais.push(nome);
      else if (/^formulario:listagem:\d+:listaReflexo:\d+:(?!ativo$)[\w]+$/.test(nome)) reflexos.push(nome);
    }
    if (!principais.length) return { regeradas: 0, mensagem: 'O cálculo não tem verbas.' };
    const valores = { 'formulario:tipoRegeracao': manterAlteracoes ? 'true' : 'false' };
    for (const c of [...principais, ...reflexos]) valores[c] = 'on';
    p = await this.s.clicar('regerarOcorrencias', valores);
    const msgs = exigirSucesso(p, 'regerar as ocorrências');
    this.jaRegerou = true;
    return { principais: principais.length, reflexos: reflexos.length, mensagens: msgs };
  }

  /**
   * FGTS ou Contribuição Social > Ocorrências > Regerar > Confirmar (menu = "FGTS" | "Contribuição Social"). O
   * Regerar das verbas não cria essas ocorrências; sem este passo elas só nascem na liquidação. Com
   * manterAlteracoes, o PJe-Calc preserva as bases e os recolhimentos informados (não a alíquota do FGTS).
   */
  async regerarOcorrenciasEncargo(menu, { manterAlteracoes = true } = {}) {
    await this.s.menu(menu);
    await this.s.clicar('ocorrencias');
    await this.s.clicar('regerar');
    const p = await this.s.clicar('confirmarGeracao', { 'formulario:tipoRegeracao': manterAlteracoes ? 'true' : 'false' });
    return { menu, mensagens: exigirSucesso(p, `regerar as ocorrências (${menu})`) };
  }

  /**
   * Cartão de ponto por jornadas. Para cada apuração cadastrada: Alterar > Salvar — o PJe-Calc gera as
   * jornadas de todos os dias a partir da programação semanal/escala (respeitando feriados, férias e faltas)
   * e preserva as jornadas lançadas manualmente. Depois: Visualizar Cartão > Apurar Cartão de Ponto, que
   * calcula a apuração diária e cria as colunas mensais ("Hs EXT", "Hs Trabalhadas", "Dias Trabalhados"...).
   * O botão "Apurar Cartão de Ponto" só existe enquanto o cálculo não tem cartões.
   */
  async apurarCartaoDePonto() {
    let p = await this.s.menu('Cartão de Ponto');
    const n = p.clicaveis.filter((c) => /listagem:\d+:alterarApuracao$/.test(c.id || '')).length;
    if (!n) return { apuracoes: 0, colunas: [], linhas: [] };
    const mensagens = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) p = await this.s.menu('Cartão de Ponto');
      p = await this.s.clicar(`listagem:${i}:alterarApuracao`);
      p = await this.s.clicar('salvar');
      mensagens.push(...exigirSucesso(p, `salvar a apuração ${i + 1} do cartão de ponto`));
    }
    await this.s.menu('Cartão de Ponto');
    p = await this.s.clicar('importarCartao');
    let apurado = false;
    if (this.s.achar((c) => /montarApartirDaApuracao$/.test(c.id || ''))) {
      p = await this.s.clicar('montarApartirDaApuracao');
      mensagens.push(...exigirSucesso(p, 'apurar o cartão de ponto'));
      apurado = true;
      await this.s.menu('Cartão de Ponto');
      p = await this.s.clicar('importarCartao');
    }
    const quadro = quadroDoCartao(p.html);
    if (!quadro.colunas.length) throw new Error('A apuração do cartão de ponto não gerou colunas. Confira as jornadas (Cartão de Ponto > Grade de Ocorrências).');
    return { apuracoes: n, apuradoAgora: apurado, ...quadro, mensagens };
  }

  /**
   * Liga uma verba a uma coluna do cartão de ponto (tela Parâmetros da Verba): quantidade ou divisor
   * "Importada do Cartão de Ponto". Usado para as colunas que só existem depois de apurar o cartão.
   */
  async vincularCartaoNaVerba(nomeVerba, tipo, nomeCartao) {
    let p = await this.s.menu('Verbas');
    const alvo = norm(nomeVerba);
    const link = p.clicaveis.find((c) => c.titulo === 'Parâmetros da Verba' && (() => {
      const i = p.html.indexOf(`id="${c.id}"`);
      const linha = p.html.slice(p.html.lastIndexOf('<tr', i), p.html.indexOf('</tr>', i));
      return [...linha.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].some((m) => norm(textoPuro(m[1])) === alvo);
    })());
    if (!link) throw new Error(`Verba "${nomeVerba}" não encontrada na tela Verbas.`);
    p = await this.s.enviar(link);
    const q = tipo === 'DIVISOR';
    const radio = q ? 'formulario:tipoDeDivisor' : 'formulario:tipoDaQuantidade';
    const select = q ? 'tipoImportadadoDoCartaoDePontoDivisor' : 'tipoImportadadoDoCartaoDePontoQuantidade';
    const incluir = q ? 'incluirCartaoDePontoDivisor' : 'incluirCartaoDePontoQuantidade';
    if (!new RegExp(`name="formulario:${select}"`).test(p.html)) {
      const idRadio = ([...p.html.matchAll(new RegExp(`<input[^>]*name="${radio}"[^>]*>`, 'g'))]
        .map((m) => m[0]).find((t) => /value="IMPORTADA_DO_CARTAO"/.test(t)) || '').match(/id="([^"]+)"/);
      if (!idRadio) throw new Error(`A verba "${nomeVerba}" não oferece ${q ? 'divisor' : 'quantidade'} importado do cartão de ponto.`);
      p = await this.s.clicar(idRadio[1].replace(/^formulario:/, ''), { [radio]: 'IMPORTADA_DO_CARTAO' });
    }
    const opcao = opcoesDoSelect(p.html, `formulario:${select}`).find((o) => norm(o.texto) === norm(nomeCartao));
    if (!opcao) throw new Error(`Coluna "${nomeCartao}" não existe no cartão de ponto. Colunas: ${opcoesDoSelect(p.html, `formulario:${select}`).map((o) => o.texto).filter(Boolean).join(', ')}`);
    p = await this.s.clicar(select, { [radio]: 'IMPORTADA_DO_CARTAO', [`formulario:${select}`]: opcao.valor });
    p = await this.s.clicar(incluir);
    p = await this.s.clicar('salvar');
    return exigirSucesso(p, `ligar a verba "${nomeVerba}" ao cartão "${nomeCartao}"`);
  }

  /** Lista as verbas oferecidas no lançamento "Expresso" (catálogo de verbas do PJe-Calc). */
  async verbasExpressoDisponiveis() {
    await this.s.menu('Verbas');
    const p = await this.s.clicar('lancamentoExpresso');
    return caixasExpresso(p.html);
  }

  /**
   * Lançamento "Expresso": marca as verbas do catálogo pelo nome e salva. O PJe-Calc cria a
   * verba principal com seus parâmetros padrão e todos os reflexos previstos (inativos).
   * nomes = lista de nomes exatamente como no catálogo, ou "*" para todas.
   */
  async lancarExpresso(nomes) {
    await this.s.menu('Verbas');
    const p = await this.s.clicar('lancamentoExpresso');
    const caixas = caixasExpresso(p.html);
    const alvo = nomes === '*' ? caixas : caixas.filter((c) => nomes.some((n) => norm(n) === norm(c.nome)));
    const faltando = nomes === '*' ? [] : nomes.filter((n) => !caixas.some((c) => norm(c.nome) === norm(n)));
    if (faltando.length) throw new Error(`Verbas não encontradas no Expresso: ${faltando.join(', ')}`);
    const valores = {};
    for (const c of alvo) valores[c.campo] = 'on';
    const r = await this.s.clicar('salvar', valores);
    const msgs = exigirSucesso(r, 'lançar as verbas (Expresso)');
    return { lancadas: alvo.map((c) => c.nome), mensagens: msgs };
  }

  /** Lê as pendências do cálculo (tela Liquidar, sem liquidar). */
  async pendencias() {
    const p = await this.s.menu('Liquidar');
    return lerPendencias(p);
  }

  /**
   * Liquida o cálculo aberto. dataLiquidacao "dd/mm/aaaa" (padrão: a sugerida pelo PJe-Calc).
   * acumularIndices: MES_SUBSEQUENTE_AO_VENCIMENTO | MES_DO_VENCIMENTO | MES_SUBSEQUENTE_E_MES_DO_VENCIMENTO
   */
  async liquidar({ dataLiquidacao = null, acumularIndices = null } = {}) {
    // a tela só aceita dd/mm/aaaa: uma data ISO seria ignorada em silêncio
    dataLiquidacao = dataTela(dataLiquidacao);
    let p = await this.s.menu('Liquidar');
    const antes = lerPendencias(p);
    if (antes.totalErros > 0) {
      return { liquidado: false, motivo: 'Há pendências que impedem a liquidação.', ...antes };
    }
    const valores = {};
    if (dataLiquidacao) valores['formulario:dataDeLiquidacaoInputDate'] = dataLiquidacao;
    if (acumularIndices) valores['formulario:indicesAcumulados'] = acumularIndices;
    p = await this.s.clicar('liquidar', valores);
    const texto = `${p.respostaAjax ? p.respostaAjax.texto : ''}\n${p.texto}`;
    const ok = /Opera[cç][aã]o realizada com sucesso/i.test(texto) && !/(^|\n)Erro\./.test(texto);
    const depois = lerPendencias(p);
    const erro = /(^|\n)Erro\.\s*\n([^\n]+)/.exec(texto);
    const naTela = (p.html.match(/id="formulario:dataDeLiquidacaoInputDate"[^>]*value="([^"]*)"/) || [])[1] || dataLiquidacao;
    const mensagens = (texto.match(/(^|\n)[^\n]*(inv[aá]lid|obrigat[oó]ri|n[aã]o pode|deve ser)[^\n]*/gi) || []).map((x) => x.trim()).slice(0, 3);
    return {
      liquidado: ok,
      erro: erro ? erro[2].trim() : null,
      dataLiquidacao: naTela,
      observacao: (texto.match(/Obs\.:[^\n]+/) || [null])[0],
      ...(ok || erro ? {} : { motivo: `o PJe-Calc não liquidou e não mostrou erro${dataLiquidacao && naTela !== dataLiquidacao ? ` (data pedida ${dataLiquidacao}, data na tela ${naTela})` : ''}${mensagens.length ? `: ${mensagens.join(' | ')}` : ''}` }),
      ...depois,
    };
  }

  /**
   * Gera relatório pela tela Imprimir (formato HTML) e devolve { html, texto }.
   * tipos: RESUMO_DE_CALCULO, DADOS_DO_CALCULO, DEMONSTRATIVO_DE_CALCULO, DEMONSTRATIVO_FGTS,
   * DEMONSTRATIVO_INSS, DEMONSTRATIVO_IRPF, DEMONSTRATIVO_HONORARIO, DEMONSTRATIVO_CUSTAS,
   * APURACAO_DE_JUROS, HISTORICO_SALARIAL, FALTAS_E_FERIAS, JUSTIFICATIVA ...
   */
  async relatorio({ tipos = ['RESUMO_DE_CALCULO'], formato = 'HTML', menu = 'Imprimir' } = {}) {
    await this.s.menu(menu);
    const valores = { 'formulario:formatoSaida': formato, 'formulario:tipoDeRelatorio': tipos };
    const r1 = await this.s.clicar('imprimirConsolidado', valores, { recarregar: false });
    if (r1.parcial && /Erro\./.test(textoPuro(r1.html))) {
      throw new Error(`O PJe-Calc não gerou o relatório: ${(textoPuro(r1.html).match(/Erro\.\s*([^\n]+)/) || [])[1] || 'erro'}`);
    }
    const d = await this.s.enviar({ tipo: 'submit', formId: 'formulario', params: { 'formulario:linkDownloadConsolidado': 'formulario:linkDownloadConsolidado' } }, valores, { binario: true });
    if (d.tipo !== 'arquivo' || !d.bytes?.length) throw new Error('O relatório não foi devolvido (o cálculo foi liquidado?).');
    if (formato === 'PDF') return { nome: d.nome, bytes: d.bytes };
    // o relatório HTML do JasperReports vem em UTF-8 (meta charset), embora o cabeçalho diga ISO-8859-1
    const cabeca = d.bytes.subarray(0, 600).toString('latin1');
    const utf8 = /charset=UTF-8/i.test(cabeca) || /utf-8/i.test(d.contentType);
    const html = new TextDecoder(utf8 ? 'utf-8' : 'latin1').decode(d.bytes);
    return { nome: d.nome, html, texto: textoRelatorio(html) };
  }

  /** Exporta o cálculo aberto como .PJC (bytes do ZIP). */
  async exportarPjc() {
    await this.s.menu('Exportar');
    await this.s.clicar('exportar', {}, { recarregar: false });
    const d = await this.s.enviar({ tipo: 'submit', formId: 'formulario', params: { 'formulario:linkDownloadArquivo': 'formulario:linkDownloadArquivo' } }, {}, { binario: true });
    if (d.tipo !== 'arquivo') throw new Error('O PJe-Calc não devolveu o arquivo exportado.');
    return { nome: d.nome, bytes: d.bytes };
  }

  /**
   * Exclui o cálculo aberto (Operações > Excluir). Na interface o item de menu pede confirmação
   * em JavaScript e exclui na hora; por HTTP a exclusão é imediata.
   */
  /**
   * Pagamento > Liquidar Atualização: atualiza o cálculo liquidado (com os pagamentos e eventos que ele tem) até
   * `data` (AAAA-MM-DD). `precatorio`: { tipo: RPV|PRE, esfera: FEDERAL|ESTADUAL_MUNICIPAL, inicioGraca, fimGraca, ec136 }.
   */
  async liquidarAtualizacao({ data, identificacao = null, comentarios = null, cobrarEncargosIrpf = false, precatorio = null } = {}) {
    const br = dataTela;
    let p = await this.s.menu('Liquidar Atualização');
    if (!/dataDeLiquidacaoInputDate/.test(p.html)) throw new Error('A tela "Liquidar Atualização" não abriu (o cálculo está liquidado?).');
    const valores = { 'formulario:dataDeLiquidacaoInputDate': br(data) };
    if (identificacao) valores['formulario:identificacaoCalculo'] = identificacao;
    if (comentarios) valores['formulario:comentarios'] = comentarios;
    if (cobrarEncargosIrpf) valores['formulario:cobrarEncargosIrpf'] = 'on';
    if (precatorio) {
      // a caixa "Atualização de Precatório/RPV" mostra os campos por AJAX: sem esse evento eles não são lidos
      valores['formulario:atualizarRegraPrecatorio'] = 'on';
      const caixa = this.s.achar((c) => c.evento === 'onchange' && (c.id === 'formulario:atualizarRegraPrecatorio' || c.name === 'formulario:atualizarRegraPrecatorio'));
      if (!caixa) throw new Error('Caixa "Atualização de Precatório/RPV" não encontrada.');
      p = await this.s.enviar(caixa, valores);
      valores['formulario:tipoPrecatorio'] = precatorio.tipo;
      valores['formulario:tipoEsferaPrecatorio'] = precatorio.esfera;
      const esfera = this.s.achar((c) => c.evento === 'onchange' && /tipoEsferaPrecatorio/.test(`${c.id || ''} ${c.name || ''}`));
      if (esfera) p = await this.s.enviar(esfera, valores);
      valores['formulario:inicioPeriodoGracaInputDate'] = br(precatorio.inicioGraca);
      valores['formulario:fimPeriodoGracaInputDate'] = br(precatorio.fimGraca);
      if (precatorio.ec136) valores['formulario:inicioPeriodoEC1362025InputDate'] = br(precatorio.ec136);
      if (!/tipoPrecatorio/.test(p.html)) throw new Error('Os campos do precatório não apareceram na tela.');
    }
    p = await this.s.clicar('liquidar', valores);
    const texto = `${p.respostaAjax ? p.respostaAjax.texto : ''}\n${p.texto}`;
    const erro = /(^|\n)Erro\.\s*\n([^\n]+)/.exec(texto);
    const msgs = [...(p.respostaAjax ? p.respostaAjax.mensagens : []), ...p.mensagens];
    if (p.erroInterno) { const e = new Error('O PJe-Calc mostrou "Erro Interno no Servidor" ao liquidar a atualização. Veja pjecalc_logs.'); e.mensagens = msgs; throw e; }
    if (erro) { const e = new Error(`O PJe-Calc recusou a atualização: ${erro[2].trim()}`); e.mensagens = msgs; e.errosDeCampo = errosDeCampo(p.html); throw e; }
    return { liquidado: true, data, mensagens: msgs };
  }

  async excluirCalculo() {
    const p = await this.s.menu('Excluir');
    if (p.erroInterno) throw new Error('O PJe-Calc mostrou erro interno ao excluir.');
    return { excluido: /principal\.jsf/.test(p.url), mensagens: p.mensagens };
  }
}

/** Quadro "Ocorrências do Cartão de Ponto": { colunas: [...], linhas: [{ competencia, valores: {coluna: n} }] }. */
export function quadroDoCartao(html) {
  const t = (html.match(/<table[^>]*id="formulario:tabOcorrencias"[^>]*>([\s\S]*?)<\/table>/) || [])[1] || '';
  const cab = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => textoPuro(m[1]).trim()).filter(Boolean);
  const colunas = cab.slice(cab.findIndex((c) => /M[ÊE]S\s*\/\s*ANO/i.test(c)) + 1);
  const linhas = [];
  for (const m of t.matchAll(/<tr[^>]*class="[^"]*rich-table-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cel = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => textoPuro(x[1]).trim());
    if (!cel.length) continue;
    const valores = {};
    colunas.forEach((c, i) => { valores[c] = Number(String(cel[i + 1] || '0').replace(/\./g, '').replace(',', '.')); });
    linhas.push({ competencia: cel[0], valores });
  }
  return { colunas, linhas };
}

/** Caixas de seleção da tela Expresso: [{ campo, nome }]. */
export function caixasExpresso(html) {
  const out = [];
  const re = /<input\b[^>]*type="checkbox"[^>]*name="(formulario:[^"]*:selecionada)"[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) out.push({ campo: m[1], nome: textoPuro(m[2]).trim() });
  if (!out.length) {
    // ordem de atributos diferente (name antes de type)
    const re2 = /<input\b[^>]*name="(formulario:[^"]*:selecionada)"[^>]*>([\s\S]*?)<\/td>/g;
    while ((m = re2.exec(html))) out.push({ campo: m[1], nome: textoPuro(m[2]).trim() });
  }
  return out;
}

/** Lê o quadro "Pendências do Cálculo" da tela de liquidação (agrupado por módulo). */
export function lerPendencias(p) {
  const html = p.html;
  const total = (id) => Number((html.match(new RegExp(`id="formulario:${id}"[^>]*value="(\d+)"`)) || [])[1] || 0);
  const pendencias = [];
  const blocos = html.split(/<div class="boxModuloValidacao">/).slice(1);
  for (const b of blocos) {
    const modulo = textoPuro((b.match(/<span class="textoTitulo[^"]*">([\s\S]*?)<\/span>/) || [])[1] || '');
    const re = /<div class="validacao(Erro|Alerta)">([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(b))) {
      pendencias.push({ tipo: m[1] === 'Erro' ? 'erro' : 'alerta', modulo, mensagem: textoPuro(m[2]).replace(/\s+/g, ' ').trim() });
    }
  }
  const erros = pendencias.filter((x) => x.tipo === 'erro').length;
  const alertas = pendencias.filter((x) => x.tipo === 'alerta').length;
  return { totalErros: Math.max(total('totalErros'), erros), totalAlertas: Math.max(total('totalAlertas'), alertas), pendencias };
}

/** Texto legível de um relatório HTML do PJe-Calc (JasperReports). */
export function textoRelatorio(html) {
  return textoPuro(html.replace(/<\/td>/gi, ' </td>'))
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}
