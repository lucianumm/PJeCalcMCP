// pjecalc-mcp-skill · lib/externo.mjs
// Cálculo Externo: atualização de uma conta homologada feita FORA do PJe-Calc (perito, contadoria, acordo).
// Os valores consolidados na data-base entram nas telas "Novo Cálculo Externo" e "Parcelas Atualizáveis";
// ao salvar, o próprio PJe-Calc transforma as parcelas num cálculo sintético (verbas, FGTS, INSS, custas) e a
// "Liquidar Atualização" corrige e aplica os juros até a data pedida. As telas são preenchidas pela interface,
// com as regras do aplicativo; o MCP não monta esse cálculo sintético por conta própria.
//
// Especificação ("calculoExterno"):
// {
//   "processo": { "numero", "valorCausa", "reclamante": { "nome", "cpf"|"cnpj" }, "reclamado": { "nome", "cnpj"|"cpf" } },
//   "dataBase": "AAAA-MM-DD",             // data da última atualização da conta homologada
//   "parametros": { "indice", "juros", "baseJuros", "ignorarTaxaNegativa", "fgtsDestino": "DEPOSITAR"|"PAGAR", "indiceFgts",
//                   "irpf": { "apurar", "meses", "incidirSobreJuros", "cobrarDoReclamado", "deduzirContribuicaoSocial", "deduzirPrevidenciaPrivada",
//                             "deduzirPensao", "deduzirHonorarios", "aposentadoMaior65" },
//                   "contribuicaoSocial": { "correcaoTrabalhistaDevidos", "correcaoPrevidenciariaPagos", "jurosPrevidenciariosPagos", "lei11941" },
//                   "custas": { "base", "corrigir", "indice", "aplicarTeto" } },
//   "creditos": { "verbasTributaveis": { "valor", "juros" }, "verbasNaoTributaveis", "fgts", "multaFgts",
//                 "multasDevidasAoReclamante": [{ "descricao", "valor", "indice" }], "multasDevidasAoReclamado": [...] },
//   "descontos": { "contribuicaoSocialSegurado": valor, "corrigirDesconto": true, "previdenciaPrivada": valor,
//                  "pensao": { "aliquota", "incidirSobreJuros", "principalTributavel": %|false, "principalNaoTributavel": %|false, "fgts" },
//                  "pensaoAliquota": % (só a alíquota, sem base),
//                  "custasReclamante": { "valor", "juros" }, "multasTerceiros": [{ "descricao", "credor", "valor", "indice" }],
//                  "honorarios": [{ "descricao", "credor", "cpf"|"cnpj", "tipo", "valor", "indice" }] },
//   "outrosDebitos": { "contribuicaoSocialSegurado": { "ateFev2009": { "valor", "juros" }, "aposFev2009": { "valor", "juros" } },
//                      "contribuicaoSocialPatronal": { ...igual }, "multaContribuicaoSocial": { "ateFev2009": "AAAA-MM-DD", "aposFev2009": "AAAA-MM-DD" },
//                      "contribuicaoSocialPagos": { "valor", "juros" }, "multaContribuicaoSocialPagos": "AAAA-MM-DD", "jurosPrevidenciaPrivada": valor,
//                      "contribuicaoSocial10": valor, "contribuicaoSocial05": valor,
//                      "custasConhecimento": { "valor", "juros" }, "custasLiquidacao": { "valor", "juros" }, "custasExecucao": { "valor", "juros" },
//                      "multasTerceiros": [...], "honorarios": [...] },
//   "debitosReclamante": { "custas": { "valor", "juros" }, "multas": [...], "honorarios": [...] }
// }

import { numeroCnj, dec, ErroEspecificacao } from './gerador.mjs';
import { camposDoFormulario } from './web.mjs';

const erro = (m) => { throw new ErroEspecificacao(m); };
const br = (iso) => String(iso).split('-').reverse().join('/');
const moeda = (v) => dec(v).replace('.', ',');
function iso(v, ctx) {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  erro(`${ctx}: data inválida "${v}" (AAAA-MM-DD).`);
}

// parcelas com valor e juros: [caixa, campo do valor] (os juros são o campo seguinte no formulário)
const VALOR_JUROS = {
  'creditos.verbasTributaveis': ['verbasTributavel', 'valorParcelaCredReclamVerbasTributavel'],
  'creditos.verbasNaoTributaveis': ['verbasNaoTributavel', 'valorParcelaCredReclamVerbasNaoTributavel'],
  'creditos.fgts': ['fgts', 'valorParcelaCredReclamFgts'],
  'creditos.multaFgts': ['multaFgts', 'valorParcelaCredReclamMultaFgts'],
  'descontos.custasReclamante': ['custasReclamante', 'valorParcelaDescCredReclamCustasDevReclamante'],
  'outrosDebitos.contribuicaoSocialPagos': ['contribSocialPagos', 'valorParcelaContribSocialPagosOutrosDeb'],
  'outrosDebitos.custasConhecimento': ['custasConhecimentoReclamadoOutrosDeb', 'valorParcelaOutrosDebCustasConhecimentoReclamado'],
  'outrosDebitos.custasLiquidacao': ['custasLiquidacaoOutrosDeb', 'valorParcelaOutrosDebCustasLiquidacao'],
  'outrosDebitos.custasExecucao': ['custasExecucaoOutrosDeb', 'valorParcelaOutrosDebCustasExecucao'],
  'debitosReclamante.custas': ['custasReclamanteDebReclam', 'valorParcelaDebReclamCustasDevReclamante'],
};
// parcelas só com valor: [caixa, campo]
const SO_VALOR = {
  'descontos.contribuicaoSocialSegurado': ['contribSocialSegurado', 'valorParcelaDescCredReclamContribSocialSegurado'],
  'descontos.previdenciaPrivada': ['previdenciaPrivada', 'valorParcelaDescCredReclamPrevidenciaPrivada'],
  'descontos.pensaoAliquota': ['pensaoAlimenticia', 'aliquotaPensaoAlimenticia'],
  'outrosDebitos.jurosPrevidenciaPrivada': ['jurosPrevidenciaPrivateOutrosDeb', 'valorJurosPrevidenciaPrivadaOutrosDeb'],
  'outrosDebitos.contribuicaoSocial10': ['contribSocial10OutrosDeb', 'valorParcelaOutrosDebContribSocial10'],
  'outrosDebitos.contribuicaoSocial05': ['contribSocial05OutrosDeb', 'valorParcelaOutrosDebContribSocial05'],
};
// contribuição social do reclamado: até/após fev/2009, cada uma com valor e juros
const CS_REC = {
  'outrosDebitos.contribuicaoSocialSegurado': ['contribSocialSeguradoDevidos', 'valorParcelasAteFev2009ContribSocialSeguradoOutrosDeb', 'valorParcelasAposFev2009ContribSocialSeguradoOutrosDeb'],
  'outrosDebitos.contribuicaoSocialPatronal': ['contribSocialPatronalDevidos', 'valorParcelasAteFev2009ContribSocialPatronalOutrosDeb', 'valorParcelasAposFev2009ContribSocialPatronalOutrosDeb'],
};
// listas de multas e honorários: [caixa, campo da descrição, campo do credor, campo do documento, campo do tipo do documento, campo do valor, honorário?]
const LISTAS = {
  'creditos.multasDevidasAoReclamante': ['multaIndenizacaoDevidaReclamante', 'descricaoCredReclamMultaDevReclamante', null, null, null, 'valorParcelaCredReclamMultaDevReclamante', false],
  'creditos.multasDevidasAoReclamado': ['multaIndenizacaoDevidaReclamado', 'descricaoCredReclamMultaDevReclamado', null, null, null, 'valorParcelaCredReclamMultaDevReclamado', false],
  'descontos.multasTerceiros': ['multaIndenizTerceiroReclamante', 'descricaoMultaTerceiroReclamanteDescCredReclam', 'credorMultaTerceiroReclamanteDescCredReclam', null, null, 'valorParcelaDescCredReclamMultaTerceiroReclamante', false],
  'descontos.honorarios': ['honorariosDevidoReclamante', 'descricaoHonorariosDevReclamanteDescCredReclam', 'credorHonorariosDevReclamanteDescCredReclam', 'numDocFiscalHonorariosDevReclamanteDescCredReclam', 'descontosCredReclamHonorariosDocFiscal', 'valorParcelaDescCredReclamHonorarioDevReclamante', true],
  'outrosDebitos.multasTerceiros': ['multaIndenizTerceiroReclamOutrosDeb', 'descricaoMultaTerceiroReclamadoOutrosDeb', 'credorMultaTerceiroReclamadoOutrosDeb', null, null, 'valorParcelaOutrosDebMultaTerceiroReclamado', false],
  'outrosDebitos.honorarios': ['honorarioDevidosReclamOutrosDeb', 'descricaoHonorariosDevReclamadoOutrosDeb', 'credorHonorariosDevReclamadoOutrosDeb', 'numDocFiscalHonorariosDevReclamadoOutrosDeb', 'outrosDebitosReclamadoHonorariosDocFiscal', 'valorParcelaOutrosDebHonorariosDevReclamado', true],
  'debitosReclamante.multas': ['multaIndenizTerceiroReclamanteDebReclam', 'descricaoMultaDevReclamanteDebReclam', 'credorMultaDevReclamanteDebReclam', null, null, 'valorParcelaDebReclamMultaDevReclamante', false],
  'debitosReclamante.honorarios': ['honorariosDevidoReclamanteDebReclam', 'descricaoHonorariosDevReclamanteDebReclam', 'credorHonorariosDevReclamanteDebReclam', 'numDocFiscalHonorariosDevReclamDebReclam', 'debitosReclamHonorariosDocFiscal', 'valorParcelaDebReclamHonorariosDevReclamante', true],
};
const pegar = (obj, caminho) => caminho.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);

/** Confere a especificação do Cálculo Externo (sem PJe-Calc). Lança ErroEspecificacao. */
export function validarExterno(ext) {
  if (!ext || typeof ext !== 'object') erro('Informe "calculoExterno".');
  const proc = ext.processo || {};
  if (!proc.numero) erro('calculoExterno.processo.numero é obrigatório.');
  const cnj = numeroCnj(proc.numero);
  if (!cnj.digitoCorreto) erro(`calculoExterno.processo.numero: dígito verificador errado (o correto é ${cnj.digitoEsperado}).`);
  if (!proc.reclamante || !proc.reclamante.nome) erro('calculoExterno.processo.reclamante.nome é obrigatório.');
  if (!proc.reclamado || !proc.reclamado.nome) erro('calculoExterno.processo.reclamado.nome é obrigatório.');
  iso(ext.dataBase, 'calculoExterno.dataBase');
  const conhecidos = new Set(['creditos', 'descontos', 'outrosDebitos', 'debitosReclamante']);
  for (const k of Object.keys(ext)) if (!['processo', 'dataBase', 'parametros', 'execucao', 'origem', ...conhecidos].includes(k) && !k.startsWith('_')) erro(`calculoExterno: o campo "${k}" não existe.`);
  const aceitos = new Set([...Object.keys(VALOR_JUROS), ...Object.keys(SO_VALOR), ...Object.keys(CS_REC), ...Object.keys(LISTAS), 'descontos.corrigirDesconto', 'descontos.pensao', 'outrosDebitos.multaContribuicaoSocial', 'outrosDebitos.multaContribuicaoSocialPagos']);
  let n = 0;
  for (const g of conhecidos) for (const k of Object.keys(ext[g] || {})) {
    if (k.startsWith('_')) continue;
    if (!aceitos.has(`${g}.${k}`)) erro(`calculoExterno.${g}: a parcela "${k}" não existe. Aceitas: ${[...aceitos].filter((x) => x.startsWith(`${g}.`)).map((x) => x.split('.')[1]).join(', ')}.`);
    n++;
  }
  if (!n) erro('calculoExterno: informe ao menos uma parcela (creditos, descontos, outrosDebitos ou debitosReclamante).');
  for (const [k] of Object.entries(VALOR_JUROS)) { const x = pegar(ext, k); if (x != null) { if (typeof x !== 'object' || x.valor == null) erro(`calculoExterno.${k}: use { "valor", "juros" }.`); dec(x.valor); if (x.juros != null) dec(x.juros); } }
  const pen = pegar(ext, 'descontos.pensao');
  if (pen != null) {
    if (typeof pen !== 'object') erro('calculoExterno.descontos.pensao: use { "aliquota", "incidirSobreJuros", "principalTributavel", "principalNaoTributavel", "fgts" }.');
    for (const k of Object.keys(pen)) if (!['aliquota', 'incidirSobreJuros', 'principalTributavel', 'principalNaoTributavel', 'fgts'].includes(k)) erro(`calculoExterno.descontos.pensao: o campo "${k}" não existe.`);
    if (ext.descontos.pensaoAliquota != null) erro('calculoExterno.descontos: use "pensao" ou "pensaoAliquota", não os dois.');
    if (!(Number(dec(pen.aliquota)) > 0 && Number(pen.aliquota) <= 100)) erro('calculoExterno.descontos.pensao.aliquota: percentual maior que 0 e até 100.');
    for (const k of ['principalTributavel', 'principalNaoTributavel']) if (pen[k] != null && pen[k] !== false && !(Number(pen[k]) > 0 && Number(pen[k]) <= 100)) erro(`calculoExterno.descontos.pensao.${k}: percentual da base maior que 0 e até 100 (ou false).`);
    if (!pen.principalTributavel && !pen.principalNaoTributavel && !pen.fgts) erro('calculoExterno.descontos.pensao: marque ao menos uma base (principalTributavel, principalNaoTributavel ou fgts); sem base a pensão sai zerada.');
  }
  for (const [k] of Object.entries(LISTAS)) { const l = pegar(ext, k); if (l != null) { if (!Array.isArray(l)) erro(`calculoExterno.${k}: use uma lista.`); for (const [i, x] of l.entries()) { if (!x.descricao) erro(`calculoExterno.${k}[${i}].descricao é obrigatória.`); if (x.valor == null) erro(`calculoExterno.${k}[${i}].valor é obrigatório.`); dec(x.valor); } } }
  return { numeroCnj: cnj, dataBase: iso(ext.dataBase, 'calculoExterno.dataBase') };
}

/** Cria o Cálculo Externo no PJe-Calc pela interface. `op`: OperadorPjeCalc novo. Devolve { idCalculo, parcelas }. */
export async function criarExterno(op, ext) {
  const { numeroCnj: cnj, dataBase } = validarExterno(ext);
  const s = op.s;
  await s.inicio();
  const link = s.achar((c) => c.texto === 'Novo Cálculo Externo');
  if (!link) throw new Error('Menu "Novo Cálculo Externo" não encontrado.');
  let p = await s.enviar(link);
  const proc = ext.processo;
  const par = ext.parametros || {};
  const ir = par.irpf || {};
  const cs = par.contribuicaoSocial || {};
  const cu = par.custas || {};
  const valores = {
    'formulario:numero': String(cnj.numero), 'formulario:digito': String(cnj.digito).padStart(2, '0'), 'formulario:ano': String(cnj.ano), 'formulario:regiao': String(cnj.regiao), 'formulario:vara': String(cnj.vara),
    'formulario:reclamanteNome': String(proc.reclamante.nome).toUpperCase(), 'formulario:reclamadoNome': String(proc.reclamado.nome).toUpperCase(),
    'formulario:dataUltimaAtualizacaoInputDate': br(dataBase),
  };
  if (proc.valorCausa != null) valores['formulario:valorDaCausa'] = moeda(proc.valorCausa);
  const doc = proc.reclamante.cpf || proc.reclamante.cnpj;
  if (doc) { valores['formulario:documentoFiscalReclamante'] = proc.reclamante.cnpj ? 'CNPJ' : 'CPF'; valores['formulario:reclamanteNumeroDocumentoFiscal'] = String(doc).replace(/\D/g, ''); }
  const docR = proc.reclamado.cnpj || proc.reclamado.cpf;
  if (docR) valores['formulario:reclamadoNumeroDocumentoFiscal'] = String(docR).replace(/\D/g, '');
  if (par.indice) valores['formulario:indiceTrabalhista'] = par.indice;
  if (par.juros) valores['formulario:juros'] = par.juros;
  if (par.baseJuros) valores['formulario:baseDeJurosDasVerbas'] = par.baseJuros;
  if (par.fgtsDestino) valores['formulario:tipoDeVerba'] = par.fgtsDestino === 'RECOLHER' ? 'DEPOSITAR' : par.fgtsDestino;
  if (par.indiceFgts) valores['formulario:indiceDeCorrecaoDoFGTS'] = par.indiceFgts;
  if (ir.meses != null) valores['formulario:qtdMesesRendimento'] = String(ir.meses);
  if (cu.base) valores['formulario:baseParaCustasCalculadas'] = cu.base;
  if (cu.indice) valores['formulario:indiceDeCorrecaoDasCustas'] = cu.indice;
  // caixas: true marca, false desmarca (remove do formulário)
  const remover = [];
  const caixa = (campoForm, v) => { if (v == null) return; if (v) valores[`formulario:${campoForm}`] = 'on'; else remover.push(`formulario:${campoForm}`); };
  caixa('ignorarTaxaNegativa', par.ignorarTaxaNegativa);
  caixa('apurarImpostoRenda', ir.apurar);
  caixa('incidirSobreJurosDeMora', ir.incidirSobreJuros);
  caixa('cobrarDoReclamado', ir.cobrarDoReclamado);
  caixa('deduzirContribuicaoSocialDevidaPeloReclamante', ir.deduzirContribuicaoSocial);
  caixa('deduzirPrevidenciaPrivada', ir.deduzirPrevidenciaPrivada);
  caixa('deduzirPensaoAlimenticia', ir.deduzirPensao);
  caixa('deduzirHonorariosDevidosPeloReclamante', ir.deduzirHonorarios);
  caixa('aposentadoMaiorQue65Anos', ir.aposentadoMaior65);
  caixa('correcaoTrabalhistaDosSalariosDevidosDoINSS', cs.correcaoTrabalhistaDevidos);
  caixa('correcaoPrevidenciariaDosSalariosPagosDoINSS', cs.correcaoPrevidenciariaPagos);
  caixa('jurosPrevidenciariosDosSalariosPagosDoINSS', cs.jurosPrevidenciariosPagos);
  caixa('correcaoLei11941', cs.lei11941);
  caixa('aplicarCorrecaoCustas', cu.corrigir);
  caixa('aplicarTetoCustas', cu.aplicarTeto);
  p = await s.clicar('salvar', valores, { removerCampos: remover });
  exigirOk(p, 'salvar o Cálculo Externo');
  const id = Number((p.html.match(/id="formulario:idCalculo"[^>]*value="([^"]*)"/) || [])[1]);
  if (!id) throw new Error('O Cálculo Externo não recebeu número.');
  op.idAberto = id;
  // parcelas atualizáveis
  p = await s.menu('Parcelas Atualizáveis');
  const v2 = {};
  const marcar = async (caixaId) => {
    const c = s.achar((x) => x.id === `formulario:${caixaId}` && x.evento === 'onchange');
    if (!c) throw new Error(`Caixa "${caixaId}" não encontrada na tela de parcelas.`);
    v2[`formulario:${caixaId}`] = 'on';
    p = await s.enviar(c, v2);
  };
  const campoApos = (nome, n = 1) => { const lista = camposDoFormulario(p.html, 'formulario').campos.map(([k]) => k); const i = lista.indexOf(`formulario:${nome}`); return i >= 0 ? lista[i + n] : null; };
  const resumo = [];
  for (const [k, [cx, cv]] of Object.entries(VALOR_JUROS)) {
    const x = pegar(ext, k);
    if (x == null) continue;
    await marcar(cx);
    v2[`formulario:${cv}`] = moeda(x.valor);
    const j = campoApos(cv);
    if (j && /:j_id\d+$/.test(j)) v2[j] = moeda(x.juros ?? 0);
    resumo.push(`${k}: ${dec(x.valor)} + juros ${dec(x.juros ?? 0)}`);
  }
  for (const [k, [cx, cv]] of Object.entries(SO_VALOR)) {
    const x = pegar(ext, k);
    if (x == null) continue;
    await marcar(cx);
    v2[`formulario:${cv}`] = moeda(x);
    resumo.push(`${k}: ${dec(x)}`);
  }
  if (ext.descontos && ext.descontos.corrigirDesconto) { await marcar('corrigirDescontoReclamante'); }
  const pen = pegar(ext, 'descontos.pensao');
  if (pen) {
    // a pensão tem alíquota e base própria: juros, percentual do principal tributável e do não tributável, FGTS
    await marcar('pensaoAlimenticia');
    v2['formulario:aliquotaPensaoAlimenticia'] = moeda(pen.aliquota);
    if (pen.incidirSobreJuros) v2['formulario:descontoCredPensaoAlimenticiaIncideJuros'] = 'on';
    if (pen.principalTributavel) { await marcar('descontoCredPensaoAlimenticiaPrincipalTributavel'); v2['formulario:percPrincipalTribPensaoAliment'] = moeda(pen.principalTributavel); }
    if (pen.principalNaoTributavel) { await marcar('descontoCredPensaoAlimenticiaPrincipalNaoTributavel'); v2['formulario:percPrincipalNaoTribPensaoAliment'] = moeda(pen.principalNaoTributavel); }
    if (pen.fgts) await marcar('descontoCredPensaoAlimenticiaFgts');
    resumo.push(`descontos.pensao: ${dec(pen.aliquota)}%${pen.incidirSobreJuros ? ' com juros' : ''}`);
  }
  for (const [k, [cx, cAte, cApos]] of Object.entries(CS_REC)) {
    const x = pegar(ext, k);
    if (x == null) continue;
    await marcar(cx);
    for (const [sub, cv] of [['ateFev2009', cAte], ['aposFev2009', cApos]]) {
      if (!x[sub]) continue;
      v2[`formulario:${cv}`] = moeda(x[sub].valor);
      const j = campoApos(cv);
      if (j && /:j_id\d+$/.test(j)) v2[j] = moeda(x[sub].juros ?? 0);
      resumo.push(`${k}.${sub}: ${dec(x[sub].valor)} + juros ${dec(x[sub].juros ?? 0)}`);
    }
  }
  const multaCs = pegar(ext, 'outrosDebitos.multaContribuicaoSocial');
  if (multaCs) {
    await marcar('multaContribSocialDevidos');
    if (multaCs.ateFev2009) v2['formulario:dataInicialAteFev2009MultaContribSocialDevidosInputDate'] = br(iso(multaCs.ateFev2009, 'outrosDebitos.multaContribuicaoSocial.ateFev2009'));
    if (multaCs.aposFev2009) v2['formulario:dataInicialAposFev2009MultaContribSocialDevidosInputDate'] = br(iso(multaCs.aposFev2009, 'outrosDebitos.multaContribuicaoSocial.aposFev2009'));
  }
  const multaPagos = pegar(ext, 'outrosDebitos.multaContribuicaoSocialPagos');
  if (multaPagos) { await marcar('multaContribSocialPagos'); v2['formulario:dataInicialBaseMultaContribSocialPagosOutrosDebInputDate'] = br(iso(multaPagos, 'outrosDebitos.multaContribuicaoSocialPagos')); }
  // listas: preenche o bloco e clica em "Adicionar" para cada item
  for (const [k, [cx, cDesc, cCred, cDoc, cTipoDoc, cValor, honorario]] of Object.entries(LISTAS)) {
    const lista = pegar(ext, k);
    if (!lista || !lista.length) continue;
    await marcar(cx);
    for (const x of lista) {
      v2[`formulario:${cDesc}`] = String(x.descricao).toUpperCase();
      if (cCred && x.credor) v2[`formulario:${cCred}`] = String(x.credor).toUpperCase();
      if (cDoc && (x.cpf || x.cnpj)) { v2[`formulario:${cDoc}`] = String(x.cpf || x.cnpj).replace(/\D/g, ''); v2[`formulario:${cTipoDoc}`] = x.cnpj ? 'CNPJ' : 'CPF'; }
      v2[`formulario:${cValor}`] = moeda(x.valor);
      // tipo do honorário: o select antes da descrição do bloco; índice: o select depois do campo do valor
      if (honorario && x.tipo) { const t = selectAntes(p.html, cDesc, 'ADVOCATICIOS'); if (!t) throw new Error(`Tipo do honorário não encontrado para ${k}.`); v2[t] = x.tipo; }
      if (x.indice) { const iSel = selectDepois(p.html, cValor, 'INDICE_TRABALHISTA'); if (iSel) v2[iSel] = x.indice; }
      const add = linkAdicionar(p.html, cDesc);
      if (!add) throw new Error(`Botão "Adicionar" não encontrado para ${k}.`);
      p = await s.enviar({ tipo: 'submit', formId: 'formulario', params: { [add]: add } }, v2);
      exigirOk(p, `adicionar ${k}`);
      for (const nome of [cDesc, cCred, cDoc, cValor]) if (nome) delete v2[`formulario:${nome}`];
      resumo.push(`${k}: ${x.descricao} ${dec(x.valor)}`);
    }
  }
  p = await s.clicar('salvar', v2);
  exigirOk(p, 'salvar as parcelas atualizáveis');
  return { idCalculo: id, parcelas: resumo };
}

/** Nome do primeiro <select> depois do campo `campo` cujo conteúdo tem `opcao` (índice, tipo do honorário). */
function selectDepois(html, campo, opcao) {
  const pos = html.indexOf(`name="formulario:${campo}"`);
  if (pos < 0) return null;
  const re = /<select[^>]*name="(formulario:[A-Za-z0-9_]+)"[^>]*>([\s\S]*?)<\/select>/g;
  re.lastIndex = pos;
  let m;
  while ((m = re.exec(html))) if (m[2].includes(`value="${opcao}"`)) return m[1];
  return null;
}

/** Nome do último <select> antes do campo `campo` cujo conteúdo tem `opcao` (tipo do honorário, que abre o bloco). */
function selectAntes(html, campo, opcao) {
  const pos = html.indexOf(`name="formulario:${campo}"`);
  if (pos < 0) return null;
  let achado = null;
  for (const m of html.slice(0, pos).matchAll(/<select[^>]*name="(formulario:[A-Za-z0-9_]+)"[^>]*>([\s\S]*?)<\/select>/g)) if (m[2].includes(`value="${opcao}"`)) achado = m[1];
  return achado;
}

/** Parâmetro do link "Adicionar" (jsfcljs) que vem depois do campo de descrição do bloco. */
function linkAdicionar(html, campoDescricao) {
  const pos = html.indexOf(`name="formulario:${campoDescricao}"`);
  if (pos < 0) return null;
  const re = /title="Adicionar"[^>]*jsfcljs\(document\.getElementById\('formulario'\),\{'(formulario:j_id\d+)'/g;
  re.lastIndex = pos;
  const m = re.exec(html);
  return m ? m[1] : null;
}

function exigirOk(p, acao) {
  const texto = `${p.respostaAjax ? p.respostaAjax.texto : ''}\n${p.texto}`;
  const e = /(^|\n)Erro\.\s*\n([^\n]+)/.exec(texto);
  if (p.erroInterno) throw new Error(`O PJe-Calc mostrou erro interno ao ${acao}.`);
  if (e) throw new Error(`O PJe-Calc recusou ${acao}: ${e[2].trim()}`);
}
