// pjecalc-mcp-skill · scripts/test-mcp.mjs
// Teste OFFLINE (não precisa do PJe-Calc aberto): protocolo MCP, catálogos, validação,
// geração de .PJC a partir do exemplo e leitura do arquivo gerado.
// Uso (na pasta pjecalc-mcp-skill):  node scripts/test-mcp.mjs

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { conectar, verificar } from './cliente-mcp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exemplo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'calculo-referencia.json'), 'utf-8'));

const c = await conectar();
try {
  console.log('1) protocolo');
  const info = c.init.result && c.init.result.serverInfo;
  verificar(info && info.name === 'pjecalc-mcp', `initialize -> ${info && info.name} ${info && info.version}`);
  const tools = (await c.enviar('tools/list')).result.tools.map((t) => t.name);
  for (const t of ['calculo_criar', 'calculo_validar', 'calculo_gerar_pjc', 'calculo_importar_pjc', 'calculo_apurar_cartao_ponto', 'tabelas_status', 'tabelas_atualizar', 'pjecalc_localizar', 'calculo_pendencias', 'calculo_liquidar', 'calculo_relatorio', 'catalogo_verbas', 'catalogo_cartao_ponto', 'catalogo_atividades', 'catalogo_feriados', 'calculo_comparar_referencia', 'calculo_documentos_necessarios', 'processo_mapa', 'titulo_compor', 'calculo_plano_interpretacao', 'calculo_aprovar_plano', 'pjecalc_iniciar']) verificar(tools.includes(t), `ferramenta ${t}`);
  console.log(`  (${tools.length} ferramentas)`);
  const defs = (await c.enviar('tools/list')).result.tools;
  const { ANOTACOES } = await import('../server/lib/anotacoes.mjs');
  const semAnotacao = defs.filter((t) => !t.annotations || t.annotations.readOnlyHint == null || t.annotations.destructiveHint == null).map((t) => t.name);
  const paramSemDescricao = defs.flatMap((t) => Object.entries((t.inputSchema && t.inputSchema.properties) || {}).filter(([, s]) => !s.description).map(([p]) => `${t.name}.${p}`));
  const sobrando = Object.keys(ANOTACOES).filter((n) => !tools.includes(n));
  const leituraQueApaga = defs.filter((t) => t.annotations && t.annotations.readOnlyHint && t.annotations.destructiveHint).map((t) => t.name);
  verificar(!semAnotacao.length && !paramSemDescricao.length && !sobrando.length && !leituraQueApaga.length
    && defs.find((t) => t.name === 'calculo_excluir').annotations.destructiveHint === true && defs.find((t) => t.name === 'calculo_validar').annotations.readOnlyHint === true
    && defs.every((t) => (t.description || '').length <= 1200),
    `todas as ferramentas com anotações (só lê / altera / apaga / internet) e todos os parâmetros descritos${[...semAnotacao, ...paramSemDescricao, ...sobrando, ...leituraQueApaga].length ? `: ${[...semAnotacao, ...paramSemDescricao, ...sobrando, ...leituraQueApaga].join(', ')}` : ''}`);
  const res = (await c.enviar('resources/list')).result.resources.map((r) => r.uri);
  verificar(res.includes('pjecalc://docs/especificacao-calculo') && res.includes('pjecalc://docs/modulos/referencia') && res.includes('pjecalc://docs/modulos/documentos') && res.includes('pjecalc://docs/modulos/processo') && res.includes('pjecalc://docs/precedentes'), `recursos: ${res.length}`);
  const prompts = (await c.enviar('prompts/list')).result.prompts.map((p) => p.name);
  verificar(prompts.includes('montar-calculo-da-sentenca') && prompts.includes('auditoria-pericial-integral') && res.includes('pjecalc://docs/auditoria-pericial'), `prompts: ${prompts.join(', ')}`);

  console.log('2) catálogos');
  const he = await c.ferramenta('catalogo_verbas', { filtro: 'horas extras 50' });
  verificar(he.some((v) => v.verba === 'HORAS EXTRAS 50%' && v.reflexos.length >= 4), 'catalogo_verbas: HORAS EXTRAS 50% com reflexos');
  const mun = await c.ferramenta('catalogo_municipios', { uf: 'PA', nome: 'belem' });
  verificar(mun[0] && mun[0].id === 427, 'catalogo_municipios: BELEM/PA id 427');
  const doc = await c.ferramenta('catalogo_validar_documentos', { numero_processo: '0001234-56.2015.5.08.0001', cpf: '111.444.777-35' });
  verificar(doc.processo.digitoCorreto === false && doc.processo.digitoEsperado === '45' && doc.cpfValido === true, 'dígito CNJ errado detectado (correto: 45) e CPF válido');

  console.log('3) validação');
  const ok = await c.ferramenta('calculo_validar', { especificacao: exemplo });
  verificar(ok.valido === true && ok.resumo.verbas.length === 10, `exemplo válido (${ok.resumo.verbas.length} verbas ativas; férias: ${ok.resumo.ferias.join('; ')})`);
  const ruim = JSON.parse(JSON.stringify(exemplo));
  ruim.verbas[3].reflexos.push('REFLEXO QUE NAO EXISTE');
  const r2 = await c.ferramenta('calculo_validar', { especificacao: ruim });
  verificar(r2.valido === false && /não existe para HORAS EXTRAS/.test(r2.erros[0]), 'reflexo inexistente é recusado, com a lista dos disponíveis');

  console.log('4) geração e leitura do .PJC');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjecalc-mcp-teste-'));
  const g = await c.ferramenta('calculo_gerar_pjc', { especificacao: exemplo, destino: dir });
  verificar(fs.existsSync(g.arquivo) && g.bytes > 1000, `arquivo gerado: ${path.basename(g.arquivo)} (${g.bytes} bytes)`);
  const lido = await c.ferramenta('calculo_ler_pjc', { arquivo: g.arquivo });
  verificar(lido.processo === '0001234-45.2015.5.08.0001' && lido.verbas.filter((v) => v.ativa).length === 10, `calculo_ler_pjc: processo ${lido.processo}, ${lido.verbas.length} verbas`);
  verificar(lido.historicos['SALÁRIO BASE'].ocorrencias === 26, 'histórico SALÁRIO BASE com 26 competências');

  console.log('5) demais exemplos, cartão de ponto por jornadas e catálogos');
  const ex = (arq) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', arq), 'utf-8'));
  for (const arq of ['calculo-completo.json', 'calculo-inss-periodos.json', 'calculo-cartao-ponto.json', 'calculo-cartao-ponto-escala.json', 'calculo-recente-trt18.json', 'calculo-diversos.json']) {
    const v = await c.ferramenta('calculo_validar', { especificacao: ex(arq) });
    verificar(v.valido === true, `${arq} válido${v.erros.length ? `: ${v.erros.join(' | ')}` : ''}`);
  }
  const cp = await c.ferramenta('catalogo_cartao_ponto', {});
  verificar(cp.colunas.some((x) => x.nome === 'Hs EXT') && cp.escala.includes('DOZE_POR_TRINTA_E_SEIS'), `catalogo_cartao_ponto: ${cp.colunas.length} colunas, ${cp.escala.length} escalas`);
  const g2 = await c.ferramenta('calculo_gerar_pjc', { especificacao: ex('calculo-cartao-ponto.json'), destino: dir });
  const lado = JSON.parse(fs.readFileSync(`${g2.arquivo}.mcp.json`, 'utf-8'));
  verificar(lado.apurarCartao === true && lado.vinculosCartao[0].cartao === 'Hs EXT', 'apuração por jornadas: passos pós-importação gravados em <arquivo>.mcp.json');
  const conflito = ex('calculo-cartao-ponto.json');
  conflito.cartoesDePonto = [{ nome: 'QT', valores: [{ de: '2013-03', ate: '2013-04', valor: 1 }] }];
  const r3 = await c.ferramenta('calculo_validar', { especificacao: conflito });
  verificar(r3.valido === false && /OU "apuracaoCartaoPonto"/.test(r3.erros[0]), 'cartão mensal + apuração por jornadas é recusado (o PJe-Calc não apura com cartões existentes)');
  const esc = ex('calculo-cartao-ponto-escala.json');
  esc.apuracaoCartaoPonto[0].escala = { tipo: 'CINCO_POR_UM', ciclo: [['08:00-12:00']] };
  const r4 = await c.ferramenta('calculo_validar', { especificacao: esc });
  verificar(r4.valido === false && /tem 6 dias no ciclo/.test(r4.erros[0]), 'escala 5x1 com ciclo do tamanho errado é recusada');
  const semVenc = ex('calculo-diversos.json');
  delete semVenc.custas.reclamado.vencimento;
  const r5 = await c.ferramenta('calculo_validar', { especificacao: semVenc });
  verificar(r5.valido === false && /custas INFORMADA precisam/.test(r5.erros[0]), 'custas informadas sem vencimento são recusadas (como na tela)');
  const atv = await c.ferramenta('catalogo_atividades', { filtro: 'carvão mineral' });
  verificar(atv.length >= 1 && atv[0].id === 1, `catalogo_atividades: ${atv[0] && atv[0].descricao}`);
  const fer = await c.ferramenta('catalogo_feriados', { uf: 'PA', municipio: 'Belém', filtro: 'conceição' });
  verificar(fer.length === 1 && fer[0].municipio === 427, `catalogo_feriados (Belém): ${fer.map((f) => f.nome).join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('6) nada ignorado em silêncio, ÚLTIMA REMUNERAÇÃO e resumo com negativos');
  const { gerarCalculo } = await import('../server/lib/gerador.mjs');
  const { campo, objetos } = await import('../server/lib/pjc.mjs');
  const { extrairResumo } = await import('../server/lib/servico-calculo.mjs');
  const comReflexo = ex('calculo-referencia.json');
  comReflexo.verbas.find((v) => v.verba === 'HORAS EXTRAS 50%').reflexos[0] = { nome: '13º SALÁRIO SOBRE HORAS EXTRAS 50%', caracteristica: 'DECIMO_TERCEIRO_SALARIO', excluirFaltasJustificadas: true, avancado: { comentarios: 'AVANCADO' } };
  const rf = [...objetos(gerarCalculo(comReflexo).arvore)].find((o) => o.$classe === 'Reflexo' && campo(o, 'nome') === '13º SALÁRIO SOBRE HORAS EXTRAS 50%');
  verificar(campo(rf, 'caracteristica') === 'DECIMO_TERCEIRO_SALARIO' && campo(rf, 'excluirFaltaJustificada') === 'true' && campo(rf, 'comentarios') === 'AVANCADO', 'reflexo: característica, exclusão de falta justificada e avancado aplicados');
  comReflexo.verbas.find((v) => v.verba === 'HORAS EXTRAS 50%').reflexos[0].excluirFaltaJustificada = true;
  const q5 = await c.ferramenta('calculo_validar', { especificacao: comReflexo });
  verificar(q5.valido === false && /"excluirFaltaJustificada" não existe/.test(q5.erros[0]), 'campo desconhecido no reflexo é recusado (não ignorado)');
  const semDecisao = ex('calculo-referencia.json');
  delete semDecisao.calculo.historicoUltimaRemuneracao;
  const q6 = await c.ferramenta('calculo_validar', { especificacao: semDecisao });
  verificar(q6.valido === false && /historicoUltimaRemuneracao\.criar: decida explicitamente/.test(q6.erros[0]), 'ÚLTIMA REMUNERAÇÃO com históricos reais exige decisão explícita');
  const okRef = await c.ferramenta('calculo_validar', { especificacao: ex('calculo-referencia.json') });
  verificar(okRef.avisos.some((a) => /ÚLTIMA REMUNERAÇÃO .* INSS em \d+ competência/.test(a)) && okRef.resumo.premissasPadrao.length > 0, `aviso da base de INSS do histórico automático e ${okRef.resumo.premissasPadrao.length} premissa(s) padrão listadas`);
  const estrito = { ...ex('calculo-referencia.json'), exigirDecisoesExplicitas: true };
  const q7 = await c.ferramenta('calculo_validar', { especificacao: estrito });
  verificar(q7.valido === false && /exigirDecisoesExplicitas/.test(q7.erros[0]), 'exigirDecisoesExplicitas recusa premissas deixadas no padrão');
  const resNeg = extrairResumo(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'resumo-com-rubrica-negativa.txt'), 'utf-8'));
  const ferias = resNeg.verbas.find((v) => v.descricao === 'FÉRIAS + 1/3');
  verificar(ferias && ferias.total === -24592.62 && resNeg.conferencia.somaConfere === true && resNeg.brutoDevidoAoReclamante === 934.22 && resNeg.liquidoDevidoAoReclamante === -7269.06,
    `resumo: rubrica negativa lida (${ferias && ferias.total}), soma ${resNeg.conferencia.somaRubricas} = total do quadro ${resNeg.conferencia.totalDoQuadro}, líquido negativo ${resNeg.liquidoDevidoAoReclamante}`);
  console.log('7) auditoria: contrato de dados e erros deliberados');
  const { auditarEspecificacao, conferenciaIndependente, compararEspecificacaoResultado, consolidarEstado, verbasAtivas } = await import('../server/lib/auditoria.mjs');
  const { lerPjc, campo: cpo, itens: its, objetos: objs, definir, clonar } = await import('../server/lib/pjc.mjs');
  // documentos acrescentados pelos casos de teste entram como lidos por inteiro (os casos de leitura testam a falta)
  const lerTudo = (sp) => { sp.contrato.leitura = sp.contrato.leitura || []; for (const d of sp.contrato.documentos || []) if (!sp.contrato.leitura.some((l) => l.documento === d.id)) { if (!d.paginas) d.paginas = '1'; sp.contrato.leitura.push({ documento: d.id, classificacao: { usadas: d.paginas } }); } };
  const audit = (mutar, { leitura = true } = {}) => { const sp = ex('calculo-auditavel.json'); if (mutar) mutar(sp); if (leitura) lerTudo(sp); return auditarEspecificacao(sp); };
  const { hashContrato } = await import('../server/lib/plano.mjs');
  // o usuário aprova de novo o contrato alterado (a aprovação anterior cai com qualquer mudança)
  const aprovar = (sp) => { sp.contrato.aprovacao = { por: 'teste', em: '2026-10-18T00:00:00Z', hashContrato: hashContrato(sp) }; };
  const temFalha = (r, re) => r.verificacoes.some((v) => v.estado === 'falha' && re.test(`${v.item} ${v.detalhe}`));
  const falhasDe = (r) => r.verificacoes.filter((v) => v.estado === 'falha').map((v) => `${v.item}: ${v.detalhe}`).join(' | ');
  const audOk = audit();
  verificar(audOk.aprovada === true && audOk.falhas === 0 && audOk.alertas === 0, `exemplo auditável aprovado e sem alertas (faltas e férias ligadas a eventos documentados)${audOk.falhas || audOk.alertas ? `: ${falhasDe(audOk)}` : ''}`);
  verificar(auditarEspecificacao(ex('calculo-referencia.json')).verificacoes[0].estado === 'nao_verificado', 'sem contrato: "não verificado", nunca aprovado');
  // pagamento coerente com a verba abatida; cada caso altera um ponto
  const pag = (extra = {}) => ({ id: 'PG1', titulo: '13º salário 2014', parcelas: ['P3'], competencia: '2014-12', valor: 1000, emitente: 'Empresa Teste Ltda', documento: 'D2', folha: 'fl. 60', comando: 'DEC1', ...extra });
  const abater = (sp, verba, valor, origem = 'PG1') => { sp.verbas.find((v) => v.verba === verba).valorPago = { tipo: 'INFORMADO', valor, origem }; };
  const conflitoJornada = [{ id: 'J1', descricao: 'jornada fixada na sentença inclui fevereiro de 2015' }];
  const casosAud = [
    ['verba sem origem', (sp) => { delete sp.verbas[0].origem; }, /sem "origem"/],
    ['parcela indeferida calculada', (sp) => { sp.contrato.parcelas.find((p) => p.id === 'P5').situacao = 'INDEFERIDA'; }, /INDEFERIDA e está sendo calculada/],
    ['reflexo não deferido', (sp) => { sp.verbas.find((v) => v.verba === 'HORAS EXTRAS 50%').reflexos.push('MULTA DO ARTIGO 477 DA CLT SOBRE HORAS EXTRAS 50%'); }, /reflexo não consta como deferido/],
    ['parcela deferida ignorada (férias)', (sp) => { sp.verbas = sp.verbas.filter((v) => v.verba !== 'FÉRIAS + 1/3'); }, /P4.*DEFERIDA sem verba/],
    ['salário fora da vigência documentada', (sp) => { sp.historicosSalariais[0].valores[1].valor = 1650; }, /difere da remuneração documentada/],
    ['pagamento usado duas vezes acima da cobertura', (sp) => {
      sp.contrato.documentos.push({ id: 'D5', tipo: 'EXTRATO_FGTS', identificacao: 'Extrato analítico do FGTS' });
      sp.contrato.pagamentos = [{ id: 'PG1', titulo: 'FGTS depositado', data: '2015-03-31', valor: 500, emitente: 'Empresa Teste Ltda', documento: 'D5' }];
      sp.fgts.operacoes = [{ data: '2015-03-31', valor: 500, tipo: 'DEPOSITO', origem: 'PG1' }, { data: '2015-04-15', valor: 500, tipo: 'DEPOSITO', origem: 'PG1' }];
    }, /PG1.*consumo de 1000\.00 acima da cobertura/],
    ['abatimento sobre premissa controvertida', (sp) => {
      sp.contrato.premissas.push({ id: 'PR9', texto: 'recibo sem assinatura', status: 'CONTROVERTIDA', fundamento: 'impugnado na réplica' });
      sp.contrato.pagamentos = [pag({ titulo: 'Férias 2013/2014', parcelas: ['P4'], competencia: undefined, periodo: { inicio: '2013-03-01', fim: '2014-02-28' }, valor: 2000, premissas: ['PR9'] })];
      abater(sp, 'FÉRIAS + 1/3', 2000);
    }, /PR9 CONTROVERTIDA.*abatimento/],
    ['pagamento de outro empregador', (sp) => { sp.contrato.pagamentos = [pag({ emitente: 'Outra Empresa SA' })]; abater(sp, '13º SALÁRIO', 1000); }, /emitido por "Outra Empresa SA"/],
    // contraexemplo 1 da auditoria externa: título e competência trocados continuavam aprovados
    ['pagamento de natureza diferente da verba abatida', (sp) => { sp.contrato.pagamentos = [pag({ titulo: 'PARCELA DE NATUREZA DIFERENTE', parcelas: ['P5'] })]; abater(sp, '13º SALÁRIO', 1000); }, /cobre P5, mas abate a verba da parcela P3: natureza incompatível/],
    ['pagamento de competência fora do contrato', (sp) => { sp.contrato.pagamentos = [pag({ competencia: '1990-01', data: '1990-01-01' })]; abater(sp, '13º SALÁRIO', 1000); }, /PG1.*fora do contrato/],
    ['pagamento sem identidade declarada', (sp) => { sp.contrato.pagamentos = [pag({ parcelas: undefined })]; abater(sp, '13º SALÁRIO', 1000); }, /identidade não declarada/],
    ['recibo fracionado com consumo acima do original (ids derivados)', (sp) => {
      sp.contrato.pagamentos = [pag({ titulo: 'Rescisão: 13º e férias', parcelas: ['P3', 'P4'], competencia: '2015-04' }), { id: 'PG1a', derivadoDe: 'PG1', parcelas: ['P3'], valor: 600 }, { id: 'PG1b', derivadoDe: 'PG1', parcelas: ['P4'], valor: 600 }];
      abater(sp, '13º SALÁRIO', 600, 'PG1a'); abater(sp, 'FÉRIAS + 1/3', 600, 'PG1b');
    }, /PG1.*consumo de 1200\.00 acima da cobertura/],
    ['alocação derivada usada acima do próprio valor', (sp) => {
      sp.contrato.pagamentos = [pag({ titulo: 'Rescisão: 13º e férias', parcelas: ['P3', 'P4'], competencia: '2015-04' }), { id: 'PG1a', derivadoDe: 'PG1', parcelas: ['P3'], valor: 300 }];
      abater(sp, '13º SALÁRIO', 500, 'PG1a');
    }, /pagamento PG1a.*consumo de 500\.00 acima da cobertura/],
    // contraexemplo 2: afastamento apontando para documento que não existe
    ['afastamento com documento inexistente', (sp) => { sp.contrato.afastamentos[0].documento = 'D99'; }, /afastamento A1.*documento "D99" não existe/],
    ['falta sem evento documentado', (sp) => { delete sp.faltas[0].origem; }, /faltas\[0\].*sem "origem" em contrato\.afastamentos/],
    ['gozo de férias sem evento', (sp) => { delete sp.ferias.periodos[0].origem; sp.contrato.afastamentos = sp.contrato.afastamentos.filter((a) => a.id !== 'A1'); }, /gozo cadastrado sem evento/],
    ['evento que só prova pagamento excluindo trabalho', (sp) => { sp.contrato.afastamentos[0].natureza = 'PAGAMENTO'; }, /a prova é só de pagamento/],
    ['exclusão de trabalho sem decisão nem premissa confirmada', (sp) => { sp.contrato.afastamentos[0].premissas = []; }, /exclui trabalho sem decisão/],
    ['natureza do evento não informada', (sp) => { delete sp.contrato.afastamentos[1].natureza; }, /afastamento A2.*natureza "" não informada/],
    ['efeito declarado contrário ao cadastro', (sp) => { sp.contrato.afastamentos[0].efeito = 'SEM_EFEITO'; }, /efeito declarado "SEM_EFEITO"/],
    ['conflito material sem resolução nem cenário', (sp) => { sp.contrato.afastamentos[0].conflitos = conflitoJornada; }, /conflito material com jornada fixada/],
    ['cenário que não cobre a incerteza aberta', (sp) => {
      sp.contrato.afastamentos[0].conflitos = conflitoJornada;
      sp.cenario = { nome: 'primeira folga no domingo', premissasAlteradas: [{ id: 'PR1', descricao: 'outra escala' }] };
    }, /cenário \/ A1:J1.*não coberta pelo cenário/],
    ['base derivada que não fecha com os componentes', (sp) => {
      sp.contrato.remuneracoes.push({ id: 'R5', componente: 'ADICIONAL', de: '2015-01', ate: '2015-04', valor: 150, documento: 'D2' }, { id: 'R4', componente: 'BASE_HE', de: '2015-01', ate: '2015-04', valor: 1900, componentes: ['R3', 'R5'] });
    }, /remuneração R4.*= 1850\.00; valor informado 1900/],
    ['trabalho lançado durante afastamento', (sp) => {
      sp.contrato.afastamentos.push({ id: 'A9', tipo: 'AFASTAMENTO', natureza: 'EVENTO_DOCUMENTADO', inicio: '2014-05-01', fim: '2014-05-31', motivo: 'auxílio-doença', documento: 'D2', premissas: ['PR1'] });
      sp.apuracaoCartaoPonto = { inicio: '2014-05-01', fim: '2014-05-31', preenchimento: 'LIVRE', jornadas: [{ data: '2014-05-12', turnos: ['08:00-12:00'] }] };
    }, /trabalho lançado durante o afastamento A9/],
    ['escala 5x1 com duas folgas', (sp) => {
      sp.apuracaoCartaoPonto = { inicio: '2014-01-01', fim: '2014-02-28', escala: { tipo: 'CINCO_POR_UM', ciclo: [['08:00-16:00'], ['08:00-16:00'], ['08:00-16:00'], ['08:00-16:00'], [], []] } };
    }, /CINCO_POR_UM: 6 dias e 2 folga/],
    ['mesma verba duas vezes na base', (sp) => { sp.verbas.find((v) => v.verba === '13º SALÁRIO').base = { historicos: ['SALÁRIO BASE', 'SALÁRIO BASE'] }; }, /entra mais de uma vez na base/],
    ['decisão alterada usada como vigente', (sp) => {
      sp.contrato.documentos.push({ id: 'D9', tipo: 'ACORDAO_TRT', identificacao: 'Acórdão' });
      sp.contrato.decisoes.push({ id: 'DEC2', documento: 'D9', tipo: 'ACORDAO_TRT', folha: 'fl. 200', trecho: 'reforma a multa do 477', altera: ['DEC1'] });
    }, /foi alterada por outra decisão/],
  ];
  for (const [nome, mutar, re] of casosAud) {
    const r = audit(mutar);
    verificar(!r.aprovada && temFalha(r, re), `detecta: ${nome}${!r.aprovada && temFalha(r, re) ? '' : ` (falhas: ${falhasDe(r) || 'nenhuma'})`}`);
  }
  // o controle não pode bloquear o que é legítimo
  const legitimos = [
    ['recibo fracionado dentro do saldo', (sp) => {
      sp.contrato.pagamentos = [pag({ titulo: 'Rescisão: 13º e férias', parcelas: ['P3', 'P4'], competencia: '2015-04' }), { id: 'PG1a', derivadoDe: 'PG1', parcelas: ['P3'], valor: 400 }, { id: 'PG1b', derivadoDe: 'PG1', parcelas: ['P4'], valor: 600 }];
      abater(sp, '13º SALÁRIO', 400, 'PG1a'); abater(sp, 'FÉRIAS + 1/3', 600, 'PG1b');
    }],
    ['recibo da rescisão pago depois da demissão', (sp) => { sp.contrato.pagamentos = [pag({ titulo: 'TRCT: 13º proporcional', competencia: '2015-04', data: '2015-04-25' })]; abater(sp, '13º SALÁRIO', 1000); }],
    ['conflito resolvido por decisão do processo', (sp) => { Object.assign(sp.contrato.afastamentos[0], { conflitos: conflitoJornada, decisao: 'DEC1', resolucao: 'a sentença manda excluir da jornada fixada os períodos de férias documentados' }); }],
    ['base derivada que fecha com os componentes', (sp) => {
      sp.contrato.remuneracoes.push({ id: 'R5', componente: 'ADICIONAL', de: '2015-01', ate: '2015-04', valor: 150, documento: 'D2' }, { id: 'R4', componente: 'BASE_HE', de: '2015-01', ate: '2015-04', valor: 1850, componentes: ['R3', 'R5'] });
    }],
  ];
  for (const [nome, mutar] of legitimos) {
    const r = audit(mutar);
    verificar(r.aprovada, `aceita: ${nome}${r.aprovada ? '' : ` (falhas: ${falhasDe(r)})`}`);
  }
  const comCenario = (sp) => {
    sp.cenario = { nome: 'com o recibo controvertido', premissasAlteradas: [{ id: 'PR9', descricao: 'recibo aceito como pagamento das férias' }] };
    sp.contrato.premissas.push({ id: 'PR9', texto: 'recibo sem assinatura', status: 'CONTROVERTIDA', fundamento: 'impugnado na réplica' });
    sp.contrato.pagamentos = [pag({ titulo: 'Férias 2013/2014', parcelas: ['P4'], competencia: undefined, periodo: { inicio: '2013-03-01', fim: '2014-02-28' }, valor: 2000, premissas: ['PR9'] })];
    abater(sp, 'FÉRIAS + 1/3', 2000);
  };
  const audCen = audit(comCenario);
  verificar(audCen.aprovada && audCen.cenario && audCen.alertas > 0 && audCen.incertezasAbertas.length === 1, `cenário que varia a premissa controvertida: aprovado com alerta e a incerteza listada${audCen.aprovada ? '' : ` (falhas: ${falhasDe(audCen)})`}`);

  // conferência independente sobre um cálculo liquidado de verdade (feito na tela) e com erro introduzido
  const fixtureLiq = path.resolve(__dirname, 'fixtures', 'calculo-liquidado-referencia.PJC');
  const lerFixture = () => lerPjc(fs.readFileSync(fixtureLiq)).arvore;
  const arvLiq = lerFixture();
  const confInd = conferenciaIndependente(arvLiq);
  verificar(confInd.every((v) => v.estado === 'ok') && confInd.length >= 5, `conferência independente do cálculo da tela: ${confInd.map((v) => v.item.split(' (')[0]).join('; ')}`);
  const heLiq = [...objs(arvLiq)].find((o) => o.$classe === 'Calculada' && cpo(o, 'nome') === 'HORAS EXTRAS 50%');
  const ocLiq = its(cpo(heLiq, 'ocorrencias')).find((x) => x.$classe);
  ocLiq.campos.find(([k]) => k === 'devido')[1] = '999.99';
  const dec13Liq = [...objs(arvLiq)].find((o) => o.$classe === 'Calculada' && cpo(o, 'nome') === '13º SALÁRIO');
  its(cpo(dec13Liq, 'ocorrencias')).find((x) => x.$classe).campos.find(([k]) => k === 'quantidade')[1] = '11.0000000000000000000000000';
  const confInd2 = conferenciaIndependente(arvLiq);
  verificar(confInd2.some((v) => v.estado === 'falha' && /aritmética/.test(v.item) && /999\.99/.test(v.detalhe)) && confInd2.some((v) => v.estado === 'alerta' && /avos de 13º 2013/.test(v.item)), 'conferência independente acusa devido adulterado e avos de 13º divergentes');

  // contraexemplo 3: reflexo ativo com todas as ocorrências desativadas passava pelo comparador de nomes
  const arv3 = lerFixture();
  const nomesAtivos = verbasAtivas(arv3).map((v) => String(cpo(v, 'nome')).trim());
  const reflexo = verbasAtivas(arv3).find((o) => o.$classe === 'Reflexo' && its(cpo(o, 'ocorrencias')).some((x) => x.$classe));
  const nomeReflexo = String(cpo(reflexo, 'nome')).trim();
  for (const x of its(cpo(reflexo, 'ocorrencias'))) if (x.$classe) definir(x, 'ativo', 'false');
  const relatorioSintetico = { verbas: nomesAtivos.map((d) => ({ descricao: d, total: 1 })) };
  const conf3 = [...conferenciaIndependente(arv3), ...compararEspecificacaoResultado({ verbasEspecificacao: nomesAtivos, arvore: arv3, resultado: relatorioSintetico })];
  const tudoOk = [{ item: 'x', estado: 'ok', detalhe: '' }];
  const est = (verificacoes, auditoria) => consolidarEstado({ importado: true, pendenciasErros: 0, liquidado: true, verificacoes, auditoria });
  const est3c = est(conf3, audOk);
  verificar(conf3.some((v) => v.estado === 'falha' && v.item === `ocorrências de ${nomeReflexo}`) && conf3.some((v) => v.estado === 'falha' && /ocorrências finais \(ocorrências\)/.test(v.item)) && est3c.estado === 'aceito_pelo_aplicativo' && est3c.dimensoes.completude === 'falha',
    `contraexemplo 3: "${nomeReflexo}" ativo sem ocorrências é falha de completude (estado "${est3c.estado}")`);
  const conf3z = conferenciaIndependente(arv3, { zerosJustificados: [{ verba: nomeReflexo, motivo: 'reflexo excluído pelo acórdão' }] });
  verificar(conf3z.find((v) => v.item === `ocorrências de ${nomeReflexo}`).estado === 'alerta', 'zero justificado em contrato.zerosJustificados vira alerta com o motivo (não bloqueia)');
  const arv4 = lerFixture();
  const he4 = [...objs(arv4)].find((o) => o.$classe === 'Calculada' && cpo(o, 'nome') === 'HORAS EXTRAS 50%');
  const ocs4 = its(cpo(he4, 'ocorrencias'));
  ocs4.push(clonar(ocs4.find((x) => x.$classe)));
  ocs4.splice(ocs4.findIndex((x, i) => x.$classe && i > 3), 1);
  const conf4 = conferenciaIndependente(arv4);
  verificar(conf4.some((v) => v.estado === 'falha' && /duplicada/.test(v.detalhe)) && conf4.some((v) => v.estado === 'falha' && /cobertura do período de HORAS EXTRAS 50%/.test(v.item)), 'ocorrência duplicada e competência faltante são falhas de completude');

  // estados: verificação não feita nunca vira sucesso; cenário chega no máximo a "simulacao"; alerta precisa de revisão
  const est1 = est([{ item: 'tabelas de índices', estado: 'nao_verificado', detalhe: 'consulta falhou' }], audOk);
  const est2 = est(tudoOk, audOk);
  const est3 = est(tudoOk, null);
  verificar(est1.estado === 'aceito_pelo_aplicativo' && /NÃO VERIFICADO/.test(est1.bloqueiosDeEntrega[0]) && est2.estado === 'auditado' && est3.estado === 'calculado' && !est2.revisadoParaEntrega && /humana/.test(est2.dimensoes.revisaoInterpretativa),
    `estados: falha de consulta trava em "${est1.estado}"; com tudo ok e contrato "${est2.estado}"; sem contrato "${est3.estado}"; revisão interpretativa sempre humana`);
  const estCen = est(tudoOk, audCen);
  const audCenRev = audit((sp) => { comCenario(sp); sp.contrato.revisoesDeAlerta = [{ item: 'PG1', conclusao: 'recibo tratado só como hipótese deste cenário', fundamento: 'impugnação na réplica, fl. 130', responsavel: 'agente' }]; aprovar(sp); });
  const estCenRev = est(tudoOk, audCenRev);
  verificar(estCen.estado === 'calculado' && /sem revisão registrada/.test(estCen.bloqueiosDeEntrega.join(' ')) && estCenRev.estado === 'simulacao' && estCenRev.cenario && /simulação/.test(estCenRev.bloqueiosDeEntrega.join(' ')),
    `cenário: alerta sem revisão trava em "${estCen.estado}"; revisado, chega a "${estCenRev.estado}" (nunca "auditado")`);
  const alertaAvos = [{ item: 'avos de 13º 2013 (13º SALÁRIO)', estado: 'alerta', detalhe: 'PJe-Calc 9, conta independente 10', dimensao: 'aritmetica' }];
  const audRev = audit((sp) => { sp.contrato.revisoesDeAlerta = [{ item: 'avos de 13º 2013', conclusao: 'a sentença deferiu 9/12', fundamento: 'sentença, fl. 15', responsavel: 'agente' }]; });
  const estAl = est(alertaAvos, audOk);
  const estAlRev = est(alertaAvos, audRev);
  verificar(estAl.estado === 'calculado' && estAlRev.estado === 'auditado' && estAlRev.dimensoes.aritmetica === 'ok_com_alertas',
    'alerta material sem revisão impede "auditado"; com conclusão e fundamento registrados, libera (e a dimensão mostra "ok_com_alertas")');

  console.log('8) comparação com conta de referência');
  const { contaDoPjc, compararContas } = await import('../server/lib/comparacao.mjs');
  const resumoFix = () => extrairResumo(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'resumo-com-rubrica-negativa.txt'), 'utf-8'));
  const igual = compararContas(contaDoPjc(lerFixture(), { resumo: resumoFix(), origem: 'A' }), contaDoPjc(lerFixture(), { resumo: resumoFix(), origem: 'B' }));
  verificar(igual.iguais && igual.comparacaoCompleta && igual.pontes.reconciliacao.residuo === 0 && igual.verbas.length === 0, `conta comparada consigo mesma: iguais, pontes fecham (resíduo ${igual.pontes.reconciliacao.residuo})`);
  // referência com 2 horas extras a mais numa competência e o total do quadro ajustado
  const arvB = lerFixture();
  const heB = [...objs(arvB)].find((o) => o.$classe === 'Calculada' && cpo(o, 'nome') === 'HORAS EXTRAS 50%');
  const ocB = its(cpo(heB, 'ocorrencias')).find((x) => x.$classe && cpo(x, 'ativo') === 'true');
  definir(ocB, 'quantidade', String(Number(cpo(ocB, 'quantidade')) + 2));
  definir(ocB, 'devido', String(Number(cpo(ocB, 'devido')) + 25));
  const resB = resumoFix();
  resB.verbas.find((v) => v.descricao === 'HORAS EXTRAS 50%').total += 30;
  resB.brutoDevidoAoReclamante += 30; resB.liquidoDevidoAoReclamante += 30;
  const dif = compararContas(contaDoPjc(lerFixture(), { resumo: resumoFix() }), contaDoPjc(arvB, { resumo: resB }));
  const linhaHe = dif.verbas.find((v) => v.verba === 'HORAS EXTRAS 50%');
  verificar(!dif.iguais && linhaHe && linhaHe.causas.quantidade === 1 && linhaHe.quantidade.diferenca === 2 && linhaHe.nominal.diferenca === 25 && dif.pontes.reconciliacao.residuo === 0,
    `diferença localizada: HORAS EXTRAS 50% +2 h (+25,00 nominal) por "quantidade"; a ponte por verba fecha com o bruto (resíduo ${dif.pontes.reconciliacao.residuo})`);
  const resC = resumoFix();
  resC.verbas.find((v) => v.descricao === 'AVISO PRÉVIO').total += 10;
  const resid = compararContas(contaDoPjc(lerFixture(), { resumo: resumoFix() }), contaDoPjc(lerFixture(), { resumo: resC }));
  verificar(resid.verificacoes.some((v) => v.estado === 'falha' && /ponte por verba/.test(v.item) && /resíduo 10/.test(v.detalhe)), 'resíduo da ponte (rubrica que não fecha com o bruto) fica visível como falha');
  const outraData = lerFixture();
  definir(outraData, 'dataDeLiquidacao', String(Number(cpo(outraData, 'dataDeLiquidacao')) + 30 * 86400000));
  const dt = compararContas(contaDoPjc(lerFixture()), contaDoPjc(outraData));
  verificar(dt.verificacoes.some((v) => v.item === 'mesma data-base' && v.estado === 'falha'), 'datas-base diferentes: a comparação acusa antes de discutir valores');
  const viaMcp = await c.ferramenta('calculo_comparar_referencia', { arquivo_calculo: fixtureLiq, arquivo_referencia: fixtureLiq });
  verificar(viaMcp.iguais === true && viaMcp.comparacaoCompleta === false && viaMcp.referencia.sha256 && viaMcp.avisos.length === 2, 'calculo_comparar_referencia com dois .PJC: ocorrências iguais; sem o resumo, as pontes ficam "não verificadas"');

  console.log('9) documentação necessária antes de calcular');
  const dOk = audit();
  verificar(dOk.documentacao && dOk.documentacao.completa && !dOk.documentacao.bloqueia && dOk.documentacao.requisitos.every((r) => !r.obrigatorio || r.status === 'ok'),
    `exemplo auditável com a documentação completa (${dOk.documentacao.requisitos.filter((r) => r.obrigatorio).map((r) => r.id).join(', ')})`);
  const semDocumento = (sp, id, coletaId) => {
    sp.contrato.documentos = sp.contrato.documentos.filter((d) => d.id !== id);
    if (coletaId) sp.contrato.coleta = sp.contrato.coleta.filter((e) => e.id !== coletaId);
  };
  const casosDoc = [
    ['extrato do FGTS ausente e não pedido', (sp) => semDocumento(sp, 'D10', 'C2'), /documentação FGTS.*nenhum documento/],
    ['holerites com mês faltante', (sp) => { sp.contrato.documentos.find((d) => d.id === 'D2').lacunas = ['2014-03']; }, /documentação SALARIOS.*faltam 03\/2014/],
    ['holerites sem o período informado', (sp) => { delete sp.contrato.documentos.find((d) => d.id === 'D2').periodo; }, /documentação SALARIOS.*informe "periodo"/],
    ['remuneração fora do período do documento citado', (sp) => { sp.contrato.documentos.find((d) => d.id === 'D2').periodo = { inicio: '2013-03', fim: '2014-12' }; }, /remuneração R3.*D2 não cobre 01\/2015 a 04\/2015/],
    ['cartões de ponto que não cobrem as horas extras (jornada não fixada na decisão)', (sp) => {
      sp.contrato.premissas.find((p) => p.id === 'PR1').documento = 'D2';
      sp.contrato.documentos.find((d) => d.id === 'D3').periodo = { inicio: '2013-03', fim: '2014-12' };
    }, /documentação JORNADA.*faltam 01\/2015 a 04\/2015/],
    ['pedido de documento não atendido, fora de cenário', (sp) => {
      semDocumento(sp, 'D10');
      Object.assign(sp.contrato.coleta.find((e) => e.id === 'C2'), { status: 'SOLICITADO', recebidoComo: undefined });
    }, /documentação FGTS.*SOLICITADO.*simulação declarada/],
    ['critério de correção e juros sem a decisão', (sp) => { delete sp.correcaoJuros.origem; }, /documentação ATUALIZACAO/],
    ['honorários sem a decisão', (sp) => { delete sp.honorarios[0].origem; }, /documentação HONORARIOS/],
    ['documento "recebido" que não está no contrato', (sp) => { sp.contrato.coleta[0].recebidoComo = 'D99'; }, /coleta C1.*D99/],
  ];
  for (const [nome, mutar, re] of casosDoc) {
    const r = audit(mutar);
    verificar(!r.aprovada && r.documentacao.bloqueia && temFalha(r, re), `trava: ${nome}${!r.aprovada && temFalha(r, re) ? '' : ` (falhas: ${falhasDe(r) || 'nenhuma'})`}`);
  }
  const audPend = audit((sp) => {
    semDocumento(sp, 'D10');
    Object.assign(sp.contrato.coleta.find((e) => e.id === 'C2'), { status: 'SOLICITADO', recebidoComo: undefined });
    sp.cenario = { nome: 'sem o extrato do FGTS', premissasFixas: [{ id: 'DOC:FGTS', motivo: 'extrato pedido em 18/10/2026; multa calculada só sobre o FGTS deferido' }] };
    sp.contrato.revisoesDeAlerta = [{ item: 'FGTS', conclusao: 'extrato pendente; multa só sobre o FGTS deferido', fundamento: 'pedido C2', responsavel: 'agente' }];
    aprovar(sp);
  });
  const estPend = est(tudoOk, audPend);
  verificar(audPend.aprovada && !audPend.documentacao.bloqueia && audPend.incertezasAbertas.some((x) => /documento pendente/.test(x)) && estPend.estado === 'simulacao',
    `documento pedido e não recebido, declarado no cenário: aprovado como "${estPend.estado}" (nunca "auditado")${audPend.aprovada ? '' : ` (falhas: ${falhasDe(audPend)})`}`);
  const audInex = audit((sp) => {
    semDocumento(sp, 'D12');
    Object.assign(sp.contrato.coleta[0], { status: 'INEXISTENTE', recebidoComo: undefined, fundamento: 'sentença sem recurso das partes (andamento processual)' });
    delete sp.contrato.fases.find((x) => x.evento === 'TRANSITO_EM_JULGADO').documento;
  });
  verificar(audInex.aprovada && !audInex.documentacao.bloqueia && audInex.verificacoes.some((v) => v.estado === 'alerta' && /DECISOES_POSTERIORES/.test(v.item)), 'documento inexistente com fundamento: aceito, com alerta a revisar');
  const audDesl = audit((sp) => { sp.exigirDocumentacaoCompleta = false; semDocumento(sp, 'D10', 'C2'); });
  verificar(audDesl.aprovada && !audDesl.documentacao.bloqueia && audDesl.verificacoes.some((v) => v.estado === 'alerta' && v.item === 'documentação'), '"exigirDocumentacaoCompleta": false desliga a trava, mas deixa alerta');
  const ped = await c.ferramenta('calculo_documentos_necessarios', {
    parcelas: ['HORAS EXTRAS 50%', 'FGTS + 40%', 'FÉRIAS + 1/3', 'SALDO DE SALÁRIO'], admissao: '2013-03-01', demissao: '2015-04-15',
    documentos_recebidos: [{ tipo: 'SENTENCA' }, { tipo: 'HOLERITES', periodo_inicio: '2013-03', periodo_fim: '2014-12' }],
  });
  const st = Object.fromEntries(ped.requisitos.map((r) => [r.id, r.status]));
  verificar(!ped.completa && ped.proximaRodada === 1 && st.TITULO === 'ok' && st.DECISOES_POSTERIORES === 'faltando' && st.JORNADA === 'faltando' && st.FGTS === 'faltando'
    && st.RESCISAO === 'faltando' && st.FERIAS === 'faltando' && st.SALARIOS === 'cobertura_incompleta' && /Faltam: 01\/2015 a 04\/2015/.test(ped.pedido)
    && /Extrato analítico do FGTS/.test(ped.pedido) && ped.perguntas.some((q) => /liquidado/.test(q)),
  `calculo_documentos_necessarios antes da especificação: ${ped.requisitos.filter((r) => r.status !== 'ok').map((r) => r.id).join(', ')} a pedir; holerites sem 01/2015 a 04/2015`);
  const incompleta = ex('calculo-auditavel.json');
  incompleta.contrato.documentos = incompleta.contrato.documentos.filter((d) => d.id !== 'D11');
  const vInc = await c.ferramenta('calculo_validar', { especificacao: incompleta });
  const cInc = await c.ferramenta('calculo_criar', { especificacao: incompleta, iniciar: false });
  verificar(vInc.valido === true && vInc.prontoParaCalcular === false && cInc.criado === false && /TRCT/.test(cInc.pedidoDeDocumentos) && cInc.pendencias.some((r) => r.id === 'RESCISAO'),
    'sem o TRCT: calculo_validar marca prontoParaCalcular=false e calculo_criar não gera nada, devolvendo o pedido');

  console.log('10) processo completo, título por capítulo e plano aprovado');
  const temAlerta = (r, re) => r.verificacoes.some((v) => v.estado === 'alerta' && re.test(`${v.item} ${v.detalhe}`));
  const NUM1 = '0000100-17.2014.5.08.0001';
  const NUM2 = '0000200-95.2016.5.08.0002';
  const outroProc = (extra) => ({ id: 'PR1', numero: NUM1, ...extra });
  const docDe = (id, tipo, processo) => ({ id, tipo, identificacao: `${tipo} (fictício)`, ...(processo ? { processo } : {}) });
  const dec1 = (sp) => sp.contrato.decisoes.find((d) => d.id === 'DEC1');
  // acórdão do TRT que julga o recurso ordinário contra a sentença
  const acordao = (sp, extra = {}) => {
    sp.contrato.documentos.push(docDe('D30', 'ACORDAO_TRT'));
    sp.contrato.decisoes.push({ id: 'DEC2', processo: 'PR0', documento: 'D30', instancia: 'TRT_TURMA', tipo: 'ACORDAO', recorrida: 'DEC1', resultado: 'PARCIALMENTE_PROVIDO', publicacao: '2016-01-10', folha: 'fl. 200', trecho: 'dá parcial provimento para limitar as horas extras a 2014-2015', transito: '2016-02-01', ...extra });
    dec1(sp).recursos = [{ tipo: 'RECURSO_ORDINARIO', por: 'reclamada', situacao: 'JULGADO', julgadoPor: 'DEC2' }];
  };
  const casosProc = [
    ['mapa do processo ausente', (sp) => { delete sp.contrato.processos; }, /mapa do processo.*contrato\.processos vazio/],
    ['processo citado nos autos e não registrado no mapa', (sp) => { dec1(sp).trecho += ` Ver também o processo ${NUM2}.`; }, new RegExp(`o processo ${NUM2.replace(/\./g, '\\.')}, citado em`)],
    ['ação anterior arquivada sem os documentos dela', (sp) => { sp.contrato.processos.push(outroProc({ relacao: 'ANTERIOR_ARQUIVADO', efeito: { prescricao: '2014-01-10' } })); }, /documentação REL:PR1:INICIAL/],
    ['marco interruptivo com a prescrição quinquenal do PJe-Calc ligada', (sp) => {
      sp.contrato.processos.push(outroProc({ relacao: 'ANTERIOR_ARQUIVADO', efeito: { prescricao: '2014-01-10' } }));
      sp.contrato.documentos.push(docDe('D20', 'PETICAO_INICIAL', 'PR1'), docDe('D21', 'DESPACHO_DE_ARQUIVAMENTO', 'PR1'));
      sp.calculo.prescricaoQuinquenal = true;
    }, /desligue "prescricaoQuinquenal"/],
    ['parcela já julgada em outro processo ainda no cálculo', (sp) => {
      sp.contrato.processos.push(outroProc({ relacao: 'COISA_JULGADA', efeito: { exclui: ['P5'] } }));
      sp.contrato.documentos.push(docDe('D20', 'PETICAO_INICIAL', 'PR1'), docDe('D21', 'SENTENCA', 'PR1'), docDe('D22', 'CERTIDAO_DE_TRANSITO_EM_JULGADO', 'PR1'));
    }, /parcela P5 já foi decidida/],
    ['recuperação judicial com liquidação depois da data-limite', (sp) => {
      sp.contrato.processos.push(outroProc({ relacao: 'RECUPERACAO_JUDICIAL', efeito: { dataLimite: '2016-03-01' } }));
      sp.contrato.documentos.push(docDe('D20', 'DECISAO_DE_DEFERIMENTO', 'PR1'));
    }, /depois da data-limite 2016-03-01/],
    ['execução recalculada do zero sem justificativa', (sp) => { sp.contrato.processos[0].fase = 'EXECUCAO'; }, /justificativaRecalculo/],
    ['execução sem o cálculo homologado', (sp) => { sp.contrato.processos[0].fase = 'EXECUCAO'; }, /documentação FASE:CALCULO_HOMOLOGADO/],
    ['atualização de cálculo homologado sem o bloco "execucao"', (sp) => { sp.contrato.processos[0].trabalho = 'ATUALIZACAO'; }, /calculo_atualizar/],
    ['responsável subsidiário sem período', (sp) => { sp.contrato.devedores.push({ id: 'R2', nome: 'Tomadora SA', responsabilidade: 'SUBSIDIARIA' }); }, /subsidiário sem "periodo"/],
    ['ente público sem o regime de correção', (sp) => { sp.contrato.devedores[0].entePublico = true; }, /ente público/],
    ['pagamento da execução sem documento', (sp) => { sp.contrato.pagamentosExecucao = [{ id: 'PX1', tipo: 'DEPOSITO_RECURSAL', data: '2016-01-10', valor: 5000, documento: 'D99' }]; }, /pagamentosExecucao\[0\].*D99/],
    ['decisão sem instância', (sp) => { delete dec1(sp).instancia; }, /decisão DEC1.*"instancia" não informada/],
    ['parcela citando a sentença que o acórdão reformou', (sp) => { acordao(sp, { capitulos: [{ parcela: 'P6', efeito: 'REFORMA', situacao: 'ALTERADA', detalhe: 'limita a 2014-2015' }] }); }, /parcela P6.*a decisão que vale para ela é DEC2/],
    ['recurso não conhecido tratado como reforma', (sp) => { acordao(sp, { resultado: 'NAO_CONHECIDO', capitulos: [{ parcela: 'P6', efeito: 'REFORMA', situacao: 'INDEFERIDA' }] }); }, /não conhecido não reforma nada/],
    ['capítulo anulado sem nova decisão', (sp) => { acordao(sp, { resultado: 'ANULADO_COM_RETORNO', capitulos: [{ parcela: 'P5', efeito: 'ANULA' }] }); }, /anulado sem nova decisão/],
    ['recurso pendente na fase de liquidação', (sp) => { dec1(sp).recursos = [{ tipo: 'RECURSO_DE_REVISTA', por: 'reclamada', situacao: 'PENDENTE', objeto: ['P6'] }]; }, /há recurso pendente, mas o processo está em LIQUIDACAO/],
    ['contradição entre dispositivo e fundamentação sem resolução', (sp) => { dec1(sp).conflitos = [{ id: 'CF1', descricao: 'dispositivo defere 20 horas por mês; a fundamentação fala em 2 horas por dia' }]; }, /conflito "dispositivo defere 20 horas/],
    ['título omisso quanto à correção e sem precedente aplicado', (sp) => { dec1(sp).capitulos = dec1(sp).capitulos.filter((x) => x.criterio !== 'ATUALIZACAO'); }, /omisso quanto à correção/],
  ];
  for (const [nome, mutar, re] of casosProc) {
    const r = audit(mutar);
    verificar(!r.aprovada && temFalha(r, re), `detecta: ${nome}${!r.aprovada && temFalha(r, re) ? '' : ` (falhas: ${falhasDe(r) || 'nenhuma'})`}`);
  }
  const legitimosProc = [
    ['acórdão que reformou, com a parcela apontando para ele', (sp) => { acordao(sp, { capitulos: [{ parcela: 'P6', efeito: 'REFORMA', situacao: 'ALTERADA', detalhe: 'limita a 2014-2015' }] }); sp.contrato.parcelas.find((p) => p.id === 'P6').decisao = 'DEC2'; }],
    ['recurso não conhecido mantendo a sentença', (sp) => { acordao(sp, { resultado: 'NAO_CONHECIDO', capitulos: [{ parcela: 'P6', efeito: 'MANTEM' }] }); }],
    ['ação anterior arquivada com documentos e prescrição coerente', (sp) => {
      sp.contrato.processos.push(outroProc({ relacao: 'ANTERIOR_ARQUIVADO', efeito: { prescricao: '2014-01-10' } }));
      sp.contrato.documentos.push(docDe('D20', 'PETICAO_INICIAL', 'PR1'), docDe('D21', 'DESPACHO_DE_ARQUIVAMENTO', 'PR1'));
      sp.contrato.revisoesDeAlerta = [{ item: 'PR1', conclusao: 'pedidos idênticos', fundamento: 'inicial do processo arquivado', responsavel: 'agente' }];
    }],
    ['conflito resolvido por embargos de declaração', (sp) => {
      sp.contrato.documentos.push(docDe('D31', 'EMBARGOS_DE_DECLARACAO'));
      sp.contrato.decisoes.push({ id: 'DEC3', processo: 'PR0', documento: 'D31', instancia: 'VARA', tipo: 'EMBARGOS_DECLARACAO', recorrida: 'DEC1', resultado: 'ACOLHIDOS', publicacao: '2015-12-01', folha: 'fl. 19', trecho: 'esclarece: 20 horas por mês', capitulos: [{ parcela: 'P6', efeito: 'INTEGRA', situacao: 'DEFERIDA', detalhe: '20 horas por mês' }], transito: '2016-02-01' });
      dec1(sp).conflitos = [{ id: 'CF1', descricao: 'dispositivo × fundamentação sobre a quantidade de horas', resolucao: 'os embargos fixaram 20 horas por mês', decisao: 'DEC3' }];
      sp.contrato.parcelas.find((p) => p.id === 'P6').decisao = 'DEC3';
    }],
  ];
  for (const [nome, mutar] of legitimosProc) {
    const r = audit(mutar);
    verificar(r.aprovada, `aceita: ${nome}${r.aprovada ? '' : ` (falhas: ${falhasDe(r)})`}`);
  }
  const audProv = audit((sp) => {
    sp.contrato.processos[0].fase = 'EXECUCAO_PROVISORIA';
    sp.contrato.documentos.push(docDe('D32', 'CARTA_DE_SENTENCA'));
    dec1(sp).recursos = [{ tipo: 'RECURSO_DE_REVISTA', por: 'reclamada', situacao: 'PENDENTE', objeto: ['P6'] }];
  });
  verificar(audProv.aprovada && audProv.provisorio && temAlerta(audProv, /execução provisória/), `execução provisória com recurso pendente: aceita, marcada como provisória${audProv.aprovada ? '' : ` (falhas: ${falhasDe(audProv)})`}`);
  const audAdc = audit((sp) => { dec1(sp).capitulos = dec1(sp).capitulos.filter((x) => x.criterio !== 'ATUALIZACAO'); sp.correcaoJuros.precedentes = ['ADC58']; });
  verificar(audAdc.aprovada && temAlerta(audAdc, /ADC 58 citada, mas sem SELIC/), 'título omisso com ADC 58 aplicada: aceita, mas avisa que falta a SELIC a partir do ajuizamento');
  // aprovação do plano
  const audMudou = audit((sp) => { sp.contrato.premissas[0].texto += ' (alterado depois da aprovação)'; });
  const estMudou = est(tudoOk, audMudou);
  verificar(audMudou.aprovada && !audMudou.aprovacao.valida && /mudaram depois da aprovação/.test(audMudou.aprovacao.motivo) && estMudou.estado === 'calculado' && estMudou.dimensoes.aprovacao === 'pendente',
    `contrato alterado depois da aprovação: aprovação cai e o estado para em "${estMudou.estado}"`);
  const audSemAprov = audit((sp) => { delete sp.contrato.aprovacao; });
  verificar(!audSemAprov.aprovacao.valida && est(tudoOk, audSemAprov).estado === 'calculado', 'sem aprovação do plano: nunca "auditado"');
  verificar(est2.dimensoes.processo === 'ok' && est2.dimensoes.titulo === 'ok' && est2.dimensoes.aprovacao === 'ok', `dimensões novas no exemplo aprovado: processo ${est2.dimensoes.processo}, título ${est2.dimensoes.titulo}, aprovação ${est2.dimensoes.aprovacao}`);
  const { revisaoPlanoResultado } = await import('../server/lib/plano.mjs');
  const spRev = ex('calculo-auditavel.json');
  const resultadoFalso = { verbas: spRev.verbas.filter((v) => v.verba !== 'MULTA DO ARTIGO 477 DA CLT').map((v) => ({ descricao: v.verba, total: 100 })) };
  const rev = revisaoPlanoResultado(spRev, resultadoFalso);
  verificar(rev.some((v) => v.estado === 'falha' && /P5/.test(v.item)) && rev.filter((v) => v.estado === 'ok').length === 5, 'revisão plano × resultado: parcela aprovada sem valor no resultado é falha');
  // ferramentas
  const mapaMcp = await c.ferramenta('processo_mapa', { especificacao: ex('calculo-auditavel.json') });
  const tituloMcp = await c.ferramenta('titulo_compor', { especificacao: ex('calculo-auditavel.json') });
  verificar(mapaMcp.mapa.principal.fase === 'LIQUIDACAO' && tituloMcp.capitulos.length === 9 && tituloMcp.capitulos.every((k) => k.vigente === 'DEC1' && k.transitado), `processo_mapa (fase ${mapaMcp.mapa.principal.fase}) e titulo_compor (${tituloMcp.capitulos.length} capítulos transitados)`);
  const planoMcp = await c.ferramenta('calculo_plano_interpretacao', { especificacao: ex('calculo-auditavel.json') });
  verificar(planoMcp.prontoParaAprovar && planoMcp.hashContrato === hashContrato(ex('calculo-auditavel.json')) && /## 2\. Título executivo/.test(planoMcp.markdown) && /HORAS EXTRAS 50%/.test(planoMcp.markdown) && planoMcp.aprovacaoAtual.valida,
    'calculo_plano_interpretacao: plano legível, pronto para aprovar, com o hash do contrato');
  const aprov = await c.ferramenta('calculo_aprovar_plano', { especificacao: ex('calculo-auditavel.json'), por: 'Teste' });
  let recusou = false;
  try { await c.ferramenta('calculo_aprovar_plano', { especificacao: { ...ex('calculo-auditavel.json'), contrato: { ...ex('calculo-auditavel.json').contrato, processos: [] } }, por: 'Teste' }); } catch (e) { recusou = /não pode ser aprovado/.test(e.message); }
  verificar(aprov.aprovacao.hashContrato === hashContrato(ex('calculo-auditavel.json')) && recusou, 'calculo_aprovar_plano registra o hash do contrato e recusa plano com falhas');
  const semAprov = ex('calculo-auditavel.json');
  semAprov.contrato.premissas[0].texto += ' (mudou)';
  const cSemAprov = await c.ferramenta('calculo_criar', { especificacao: semAprov, iniciar: false });
  verificar(cSemAprov.criado === false && cSemAprov.bloqueios.some((b) => /plano de interpretação/.test(b)), 'calculo_criar não gera nada sem o plano aprovado (aprovação invalidada por mudança no contrato)');

  console.log('11) regras do PJe-Calc antes de importar, recálculo independente e critérios');
  const toolsNovas = (await c.enviar('tools/list')).result.tools.map((t) => t.name);
  for (const t of ['calculo_atualizar', 'calculo_externo_criar', 'calculo_criar_lote', 'documento_inventario', 'documento_texto', 'documento_imagens', 'holerites_para_historicos', 'cartoes_para_jornadas', 'extrato_para_fgts', 'trct_para_pagamentos', 'catalogo_pisos_vt']) verificar(toolsNovas.includes(t), `ferramenta ${t}`);
  const regra = (mutar) => { const sp = JSON.parse(JSON.stringify(exemplo)); mutar(sp); return c.ferramenta('calculo_validar', { especificacao: sp }); };
  const vRn49 = await regra((sp) => { sp.correcaoJuros = { ...(sp.correcaoJuros || {}), avancado: { apertirDe: '2015-01-01' } }; });
  verificar(vRn49.valido === false && vRn49.erros.some((x) => /RN49/.test(x) && /Juros Fazenda Pública/.test(x)), 'regra RN49 do PJe-Calc antecipada: juros da Fazenda Pública antes do ajuizamento é erro antes de importar');
  const vRn05 = await regra((sp) => { sp.irpf = { ...(sp.irpf || {}), apurar: false }; });
  verificar(vRn05.valido === true && vRn05.pendenciasPrevistas.some((x) => x.regra === 'RN05' && x.tipo === 'alerta'), 'regra RN05 (IR com incidência marcada sem apurar) vira alerta antes de importar');
  const vRn80 = await regra((sp) => { delete sp.processo.valorCausa; sp.multas = [{ descricao: 'multa sobre o valor da causa', percentual: 1, base: 'VALOR_CAUSA' }]; });
  verificar(vRn80.pendenciasPrevistas.some((x) => x.regra === 'RN80'), 'regra RN80 (multa sobre o valor da causa sem o valor) antecipada');
  const vRn16 = await regra((sp) => { sp.faltas = [...(sp.faltas || []), { inicio: '2013-01-10', fim: '2013-01-12', justificada: false }]; });
  verificar(vRn16.valido === false && vRn16.erros.some((x) => /RN16/.test(x)), 'regra RN16 (falta antes da admissão) é erro antes de importar');
  const { validarArvore } = await import('../server/lib/validacao.mjs');
  const cmp = cpo; const def = definir;
  const arvFix = () => lerPjc(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'calculo-liquidado-referencia.PJC'))).arvore;
  const gabs = fs.readdirSync(path.resolve(__dirname, '..', 'exemplos', 'gabaritos-tela'));
  const errosGab = gabs.flatMap((g) => validarArvore(lerPjc(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'gabaritos-tela', g))).arvore, { momento: 'ocorrencias' }).filter((x) => x.tipo === 'erro').map((x) => `${g}: ${x.regra}`));
  verificar(!errosGab.length && !validarArvore(arvFix(), { momento: 'ocorrencias' }).length, `regras do PJe-Calc sobre os ${gabs.length} gabaritos feitos na tela e o fixture: nenhum erro falso${errosGab.length ? ` (${errosGab.join(', ')})` : ''}`);
  const { recalcularPjc, compararComRelatorios } = await import('../server/lib/recalculo.mjs');
  const rel = (n) => fs.readFileSync(path.resolve(__dirname, 'fixtures', 'relatorios-referencia', n), 'utf-8');
  const recFix = recalcularPjc(arvFix());
  const cmpFix = [...recFix.verificacoes, ...compararComRelatorios(recFix, { resumo: extrairResumo(rel('RESUMO_DE_CALCULO.txt')), textos: { DEMONSTRATIVO_FGTS: rel('DEMONSTRATIVO_FGTS.txt'), APURACAO_DE_JUROS: rel('APURACAO_DE_JUROS.txt'), DEMONSTRATIVO_IRPF: rel('DEMONSTRATIVO_IRPF.txt') } })];
  verificar(cmpFix.length >= 18 && cmpFix.every((x) => x.estado === 'ok'), `recálculo independente = relatórios do PJe-Calc ao centavo (${cmpFix.length} conferências: verbas, juros, FGTS e multa, contribuição social 4.687,19, IR, honorários, custas)${cmpFix.some((x) => x.estado !== 'ok') ? ` — ${cmpFix.filter((x) => x.estado !== 'ok').map((x) => `${x.item}: ${x.detalhe}`).join(' | ')}` : ''}`);
  const arvMexida = arvFix();
  const ocF0 = its(cmp(cmp(arvMexida, 'fgts'), 'ocorrencias'))[0];
  def(ocF0, 'indiceAcumulado', String(Number(cmp(ocF0, 'indiceAcumulado')) + 0.01));
  const recMexido = recalcularPjc(arvMexida);
  verificar(compararComRelatorios(recMexido, { resumo: extrairResumo(rel('RESUMO_DE_CALCULO.txt')) }).some((x) => x.estado === 'falha' && /FGTS corrigido/.test(x.item)), 'recálculo acusa índice do FGTS diferente do usado no relatório');
  const { r2: r2d, D: Dd, txt: txtd, corrigir: corrigird } = await import('../server/lib/decimal.mjs');
  verificar(txtd(r2d(Dd('0.125'))) === '0.12' && txtd(r2d(Dd('0.135'))) === '0.14' && txtd(r2d(Dd('2.5050'))) === '2.50' && txtd(corrigird(Dd('-2'), Dd('10'))) === '5.00', 'arredondamento HALF_EVEN do PJe-Calc (0,125 → 0,12; 0,135 → 0,14) e índice negativo dividindo');
  const { conferirCriterios } = await import('../server/lib/criterios.mjs');
  const just = JSON.parse(rel('JUSTIFICATIVA.json'));
  const crOk = conferirCriterios(just, arvFix());
  const arvIdx = arvFix(); def(cmp(arvIdx, 'parametrosDeAtualizacao'), 'indiceTrabalhista', 'IPCA');
  const crFalha = conferirCriterios(just, arvIdx);
  verificar(crOk[0].estado === 'ok' && crFalha[0].estado === 'falha' && /IPCA/.test(crFalha[0].detalhe), `critérios da justificativa = parâmetros (${crOk[0].detalhe.split(':')[0]}); índice trocado é falha`);
  // com dois índices a justificativa diz "acumulados" (plural)
  const justPlural = just.map((x) => x.replace('acumulado a partir', 'acumulados a partir'));
  verificar(conferirCriterios(justPlural, arvFix()).every((x) => x.estado !== 'falha'), 'acumulação de índices reconhecida também no plural ("acumulados a partir do mês subsequente")');
  // composição do Resumo que continua na página seguinte (rodapé e número da página no meio)
  const resDuasPag = extrairResumo(rel('RESUMO_DE_CALCULO.txt').replace('DEDUÇÃO DE CONTRIBUIÇÃO SOCIAL', 'Cálculo liquidado por Usuario em 18/10/2026\nPág. 1 de\n2\nDEDUÇÃO DE CONTRIBUIÇÃO SOCIAL'));
  verificar(resDuasPag.composicao.some((x) => /^DEDUÇÃO DE CONTRIBUIÇÃO SOCIAL/.test(x.descricao)) && compararComRelatorios(recFix, { resumo: resDuasPag }).every((x) => x.estado === 'ok'), 'composição do Resumo em duas páginas: as linhas depois do rodapé continuam lidas');
  // custas de liquidação (0,5%): o Resumo mostra conhecimento + liquidação
  const arvCus = arvFix(); const cus = cmp(arvCus, 'custasJudiciais');
  const baseCus = Number(cmp(cus, 'valorBaseCustasCalculadas'));
  def(cus, 'tipoDeCustasDeLiquidacao', 'CALCULADA_MEIO_POR_CENTO'); def(cus, 'valorCustasDeLiquidacao', String(baseCus * 0.005));
  const recCus = recalcularPjc(arvCus);
  const totCus = Math.round(baseCus * 2) / 100 + Math.round(baseCus * 0.5) / 100;
  verificar(recCus.verificacoes.some((x) => /custas de liquidação/.test(x.item) && x.estado === 'ok') && Math.abs(Number(txtd(recCus.custas.totalReclamado)) - totCus) < 0.011, `custas do reclamado = conhecimento (2%) + liquidação (0,5%): ${txtd(recCus.custas.totalReclamado)}`);
  // contribuição social progressiva (a partir de 03/2020): razão exata contribuição/total, alíquota gravada com 2 casas
  const arvProg = arvFix(); const ocProg = its(cmp(cmp(cmp(arvProg, 'inss'), 'inssSobreSalariosDevidos'), 'ocorrencias'))[0];
  for (const [k, v] of [['dataOcorrenciaInss', String(Date.UTC(2023, 1, 1, 3))], ['valorBase', '2200'], ['valorTotalInssSegurado', '178.47075'], ['valorBaseVerbas', '182.61'], ['aliquotaDoTotalSegurado', '8.18'], ['valorDevidoSeguradoVerbas', '14.9381227924419019478638972'], ['valorDevidoSeguradoFinal', '14.9381227924419019478638972'], ['valorTetoSegurado', '877.24'], ['valorTotalInssSegurado', '178.47075']]) def(ocProg, k, v);
  if (cmp(ocProg, 'valorDevidoEmpresaVerbas') != null) def(ocProg, 'valorDevidoEmpresaVerbas', (182.61 * Number(cmp(ocProg, 'aliquotaEmpresa') || 0) / 100).toFixed(6));
  const okProg = recalcularPjc(arvProg).verificacoes.find((x) => /segurado \(alíquota e teto\)/.test(x.item));
  def(ocProg, 'valorDevidoSeguradoVerbas', '15.10'); def(ocProg, 'valorDevidoSeguradoFinal', '15.10');
  const ruimProg = recalcularPjc(arvProg).verificacoes.find((x) => /segurado \(alíquota e teto\)/.test(x.item));
  verificar(okProg.estado === 'ok' && ruimProg.estado === 'falha', 'contribuição social progressiva (02/2023): 182,61 × 8,18% exibido = 14,9381 gravado aceito; 15,10 acusado');
  // honorário informado: corrigido do vencimento até a liquidação (o Resumo mostra o valor corrigido)
  const arvHi = arvFix(); const hi = its(cmp(arvHi, 'honorarios'))[0];
  def(hi, 'tipoValor', 'INFORMADO'); def(hi, 'valor', '2000'); def(hi, 'indiceCorrecaoHonorario', '1.0433'); def(hi, 'aplicarJuros', 'false');
  verificar(txtd(recalcularPjc(arvHi).honorarios[0].valor) === '2086.60', 'honorário informado de 2.000,00 corrigido pelo índice do honorário (1,0433) = 2.086,60, como no Resumo');

  console.log('12) valores mês a mês, execução, Cálculo Externo e precatório');
  const { aplicarEdicoes, conferirEdicoes } = await import('../server/lib/ocorrencias.mjs');
  const arvEd = arvFix();
  const apl = aplicarEdicoes(arvEd, [{ verba: 'HORAS EXTRAS 50%', itens: [{ competencia: '2013-03', pago: 20 }, { competencia: '2014-06', quantidade: 30 }] }]);
  const ocHe = its(cmp([...its(cmp(arvEd, 'verbas'))].length ? arvEd : arvEd, 'verbas'));
  verificar(apl.length === 2 && conferirEdicoes(arvEd, [{ verba: 'HORAS EXTRAS 50%', itens: [{ competencia: '2013-03', pago: 20 }] }]).estado === 'ok' && ocHe.length > 0, 'edição mês a mês aplicada na ocorrência (pago e quantidade) sem tocar na cópia original');
  let errEd = '';
  try { aplicarEdicoes(arvFix(), [{ verba: 'HORAS EXTRAS 50%', itens: [{ competencia: '2019-01', pago: 1 }] }]); } catch (e) { errEd = e.message; }
  verificar(/nenhuma ocorrência casa/.test(errEd) && /2013-03-01/.test(errEd), 'competência sem ocorrência: recusa, listando as ocorrências geradas');
  const vEd = await c.ferramenta('calculo_validar', { especificacao: { ...exemplo, verbas: exemplo.verbas.map((v) => (v.verba === 'HORAS EXTRAS 50%' ? { ...v, ocorrencias: [{ competencia: '2013-03', pago: 20 }] } : v)) } });
  verificar(vEd.valido && vEd.resumo.edicoesOcorrencias && vEd.resumo.edicoesOcorrencias[0].startsWith('HORAS EXTRAS 50%'), 'verbas[].ocorrencias aceito pela especificação (aplicado depois da regeração)');
  const { montarExecucao, parametrosAtualizacao, extrairResumoAtualizacao } = await import('../server/lib/execucao.mjs');
  const ex1 = montarExecucao(arvFix(), { dataAtualizacao: '2016-08-31', pagamentos: [{ data: '2016-07-15', valor: 10000, priorizarJuros: true }] });
  const erroExec = (execucao) => { try { montarExecucao(arvFix(), execucao); return ''; } catch (e) { return e.message; } };
  verificar(ex1.pagamentos.length === 1 && /MSG0125/.test(erroExec({ pagamentos: [{ data: '2016-07-15', valor: 100, creditoReclamante: 90 }] })) && /MSG0127/.test(erroExec({ pagamentos: [{ data: '2016-01-15', valor: 100 }] }))
    && /MSG0138/.test(erroExec({ pagamentos: [{ data: '2016-07-15', valor: 100 }, { data: '2016-07-15', valor: 50 }] })) && /MSG0134/.test(erroExec({ pagamentos: [{ data: '2016-07-15', valor: 100, credito: { principal: 30 } }] }))
    && /MSG0131/.test(erroExec({ pagamentos: [{ data: '2016-07-15', valor: 100, outros: { inssSalariosDevidos: 'apurar' } }] })),
  'execução: pagamento aceito e as regras do PJe-Calc (MSG0125, 0127, 0131, 0134, 0138) conferidas antes de importar');
  // encargos de IRPF: com IR apurado, a decisão precisa estar na especificação
  const arvIr = arvFix(); const irNo = cmp(arvIr, 'irpf'); const apIr = irNo.campos.find(([k]) => k === 'apurarImpostoRenda'); apIr[1] = 'true';
  const irSemDecisao = montarExecucao(arvIr, { dataAtualizacao: '2016-08-31', pagamentos: [{ data: '2016-07-15', valor: 1000 }] });
  const arvIr2 = arvFix(); cmp(arvIr2, 'irpf').campos.find(([k]) => k === 'apurarImpostoRenda')[1] = 'true';
  const irComDecisao = montarExecucao(arvIr2, { dataAtualizacao: '2016-08-31', cobrarEncargosIrpf: true, pagamentos: [{ data: '2016-07-15', valor: 1000 }] });
  const arvSemIr = arvFix(); cmp(arvSemIr, 'irpf').campos.find(([k]) => k === 'apurarImpostoRenda')[1] = 'false';
  const semIr = montarExecucao(arvSemIr, { dataAtualizacao: '2016-08-31', pagamentos: [{ data: '2016-07-15', valor: 1000 }] });
  verificar(irSemDecisao.encargosIrpfSemDecisao && irSemDecisao.avisos.some((x) => /cobrarEncargosIrpf/.test(x)) && !irComDecisao.encargosIrpfSemDecisao && !irComDecisao.avisos.some((x) => /cobrarEncargosIrpf/.test(x))
    && !semIr.irApurado && !semIr.avisos.some((x) => /cobrarEncargosIrpf/.test(x)) && parametrosAtualizacao(arvIr2, { dataAtualizacao: '2016-08-31', cobrarEncargosIrpf: true }).cobrarEncargosIrpf === true,
  'encargos de IRPF: com IR apurado e sem decisão, aviso (e alerta na atualização); com decisão ou sem IR, nada');
  const parPrec = parametrosAtualizacao(arvFix(), { dataAtualizacao: '2016-08-31', precatorio: { tipo: 'RPV', esfera: 'ESTADUAL', periodoGraca: { inicio: '2016-07-01', fim: '2016-12-31' } } });
  verificar(parPrec.precatorio.tipo === 'RPV' && parPrec.precatorio.esfera === 'ESTADUAL_MUNICIPAL' && parPrec.precatorio.ec136 === '2025-08-01', 'precatório/RPV: esfera estadual com o início da EC 136/2025 da tela (01/08/2025)');
  const ra = extrairResumoAtualizacao(rel('RESUMO_PAGAMENTO.txt'));
  verificar(ra.liquidoDevidoAoReclamante === 13309.49 && ra.totalDevidoPeloReclamado === 30738.32 && ra.conferencia.somaDoSaldo === ra.conferencia.total && ra.atualizadoAte === '31/08/2016' && ra.eventos.length === 1, 'Resumo da Atualização lido: saldo por credor, total do reclamado, data e eventos');
  const vExec = await c.ferramenta('calculo_validar', { especificacao: { ...exemplo, execucao: { dataAtualizacao: '2016-08-31', pagamentos: [{ data: '2016-07-15', valor: 1000 }, { data: '2016-07-15', valor: 50 }] } } });
  verificar(vExec.valido === false && vExec.erros.some((x) => /MSG0138/.test(x)), 'bloco "execucao" conferido por calculo_validar');
  const { validarExterno } = await import('../server/lib/externo.mjs');
  const extBase = { processo: { numero: '0001234-45.2015.5.08.0001', reclamante: { nome: 'A' }, reclamado: { nome: 'B' } }, dataBase: '2016-06-30', creditos: { verbasTributaveis: { valor: 1000, juros: 10 } } };
  const erroExt = (e) => { try { validarExterno(e); return ''; } catch (x) { return x.message; } };
  verificar(!erroExt(extBase) && /parcela "inexistente"/.test(erroExt({ ...extBase, creditos: { inexistente: 1 } })) && /dígito verificador/.test(erroExt({ ...extBase, processo: { ...extBase.processo, numero: '0001234-46.2015.5.08.0001' } })) && /ao menos uma parcela/.test(erroExt({ ...extBase, creditos: {} })),
    'Cálculo Externo: especificação conferida (parcelas aceitas, dígito do processo, ao menos uma parcela)');
  // pensão alimentícia e custas da execução: os mesmos objetos que as telas gravam (gabarito lançado à mão)
  const { eventosDaAtualizacao } = await import('../server/lib/execucao.mjs');
  const exPc = ex('execucao-pensao-custas.json');
  const arvPc = arvFix();
  const mPc = montarExecucao(arvPc, exPc);
  const penPc = cmp(arvPc, 'pensaoAlimenticia'); const fgPc = cmp(arvPc, 'fgts'); const cuPc = cmp(arvPc, 'custasJudiciais');
  const verbasPc = [...objs(arvPc)].filter((o) => o.$classe && o.$classe !== 'Fgts' && cmp(o, 'ativo') === 'true' && o.campos.some(([k]) => k === 'incidenciaPensaoAlimenticia'));
  verificar(cmp(penPc, 'origemRegistro') === 'ATUALIZACAO' && cmp(penPc, 'apurarPensaoAlimenticia') === 'true' && cmp(penPc, 'aliquota') === '30.00' && cmp(penPc, 'incidirSobreJuros') === 'true' && cmp(penPc, 'dataEvento') === String(Date.UTC(2016, 6, 20, 3))
    && verbasPc.length === 10 && verbasPc.every((v) => cmp(v, 'incidenciaPensaoAlimenticia') === 'true') && cmp(fgPc, 'incidenciaPensaoAlimenticia') === 'true' && cmp(fgPc, 'incidenciaPensaoAlimenticiaSobreMulta') === 'true',
  `execução: pensão de 30% a partir de 20/07/2016 sobre as 10 verbas e reflexos ativos, FGTS e multa (${mPc.pensao})`);
  const fxPc = its(cmp(cuPc, 'custasFixasAtualizacao')).filter((x) => x.$classe);
  const auPc = its(cmp(cuPc, 'autosJudiciais')).filter((x) => x.$classe); const arPc = its(cmp(cuPc, 'armazenamentos')).filter((x) => x.$classe);
  verificar(fxPc.length === 1 && cmp(fxPc[0], 'qtdeAtosUrbanos') === '2' && cmp(fxPc[0], 'qtdeAgravosDePeticao') === '1' && cmp(fxPc[0], 'qtdeAgravosDeInstrumento') === null && cmp(fxPc[0], 'valorAtosUrbanos') === '11.06' && cmp(fxPc[0], 'valorRecursoRevista') === '55.35'
    && auPc.length === 1 && cmp(auPc[0], 'tipoDeAuto') === 'ARREMATACAO' && cmp(auPc[0], 'origemRegistro') === 'ATUALIZACAO' && arPc.length === 1 && cmp(arPc[0], 'qtdeDias') === '0' && cmp(cuPc, 'folhaDoEvento') === 'FL. 340'
    && /1915\.38 \(teto\)/.test(mPc.custas[1]) && /46 dias = R\$ 920\.00/.test(mPc.custas[2]),
  `execução: custas por ato (2 atos urbanos e 1 agravo de petição, valores do art. 789-A), auto de arrematação no teto e armazenamento de 46 dias como na tela (${mPc.custas.join(' | ')})`);
  const evPc = eventosDaAtualizacao(arvPc);
  verificar(evPc.pagamentos === 1 && evPc.pensao === 1 && evPc.custas === 3 && evPc.custasNoResumo === 3 && !mPc.avisos.length, 'eventos esperados no Resumo: pagamento, pensão e as 3 custas (todas antes do pagamento)');
  const comPensaoCalc = () => { const a = arvFix(); def(cmp(a, 'pensaoAlimenticia'), 'apurarPensaoAlimenticia', 'true'); return a; };
  const erroPc = (e, arv = arvFix()) => { try { montarExecucao(arv, e); return ''; } catch (x) { return x.message; } };
  const pen0 = { dataEvento: '2016-07-20', aliquota: 30, verbas: 'todas' };
  verificar(/MSG0126/.test(erroPc({ pensao: pen0 }, comPensaoCalc())) && /Alíquota\. \(MSG0003\)/.test(erroPc({ pensao: { ...pen0, aliquota: null } })) && /Data do Evento\. \(MSG0003\)/.test(erroPc({ pensao: { ...pen0, dataEvento: null } }))
    && /MSG0127/.test(erroPc({ pensao: { ...pen0, dataEvento: '2016-06-01' } })) && /MSG0128/.test(erroPc({ pensao: { ...pen0, dataEvento: '2099-01-01' } }))
    && /não é verba ativa/.test(erroPc({ pensao: { ...pen0, verbas: ['HORAS EXTRAS 100%'] } })) && /pelo menos uma das verbas/.test(erroPc({ pensao: { ...pen0, verbas: [], fgts: false } }))
    && /multa do FGTS com a incidência sobre o FGTS/.test(erroPc({ pensao: { ...pen0, fgts: false, multaFgts: true } })) && /só no Cálculo Externo/.test(erroPc({ pensao: { ...pen0, principalTributavel: 100 } })),
  'pensão da execução: regras da tela (MSG0126 com pensão no cálculo, MSG0003, 0127, 0128), verba inexistente, sem incidência, multa do FGTS sem FGTS e percentuais só no Cálculo Externo');
  const fx0 = { vencimento: '2016-07-25', atosUrbanos: 1 };
  verificar(/ao menos uma quantidade/.test(erroPc({ custas: { fixas: [{ vencimento: '2016-07-25', atosUrbanos: 0 }] } })) && /uma linha por data/.test(erroPc({ custas: { fixas: [fx0, { ...fx0, atosRurais: 1 }] } }))
    && /quantidade inteira/.test(erroPc({ custas: { fixas: [{ ...fx0, atosUrbanos: 1.5 }] } })) && /Vencimento\. \(MSG0003\)/.test(erroPc({ custas: { fixas: [{ atosUrbanos: 1 }] } }))
    && /tipo: use REMICAO/.test(erroPc({ custas: { autos: [{ tipo: 'PENHORA', vencimento: '2016-07-25', valor: 1 }] } }))
    && /Valor do Bem\. \(MSG0003\)/.test(erroPc({ custas: { autos: [{ tipo: 'Arrematação', vencimento: '2016-07-25' }] } })) && /MSG0127/.test(erroPc({ custas: { autos: [{ tipo: 'REMICAO', vencimento: '2016-05-25', valor: 10 }] } }))
    && /Início\. \(MSG0003\)/.test(erroPc({ custas: { armazenamentos: [{ fim: '2016-08-15', valor: 10 }] } })) && /anterior ao início/.test(erroPc({ custas: { armazenamentos: [{ inicio: '2016-08-15', fim: '2016-08-01', valor: 10 }] } }))
    && /"porAto" não existe/.test(erroPc({ custas: { porAto: [] } })),
  'custas da execução: uma linha por data com quantidade, tipo de auto, valor do bem, datas (MSG0003, 0127) e campos desconhecidos recusados');
  const arvTarde = arvFix();
  const mTarde = montarExecucao(arvTarde, { dataAtualizacao: '2016-08-31', pagamentos: [{ data: '2016-07-15', valor: 1000 }], custas: { autos: [{ tipo: 'ADJUDICACAO', vencimento: '2016-08-20', valor: 1000 }] } });
  const erroData = (() => { try { parametrosAtualizacao(arvTarde, { dataAtualizacao: '2016-08-10' }); return ''; } catch (x) { return x.message; } })();
  verificar(eventosDaAtualizacao(arvTarde).custasNoResumo === 0 && mTarde.avisos.some((x) => /Eventos ocorridos/.test(x)) && /anterior ao último evento/.test(erroData),
    'custas depois do último pagamento: avisa que entram no saldo sem aparecer na lista do Resumo; atualização antes delas é recusada');
  const raPc = extrairResumoAtualizacao(rel('RESUMO_PAGAMENTO_PENSAO_CUSTAS.txt'));
  verificar(raPc.pensaoAlimenticia === 6704.74 && raPc.custasReclamado === 3714.5 && raPc.liquidoDevidoAoReclamante === 11649.75 && raPc.totalDevidoPeloReclamado === 38698.67 && raPc.eventos.length === 5 && raPc.conferencia.somaDoSaldo === raPc.conferencia.total,
    'Resumo da Atualização com pensão e custas da execução lido (gabarito da tela: pensão 6.704,74, custas 3.714,50, total 38.698,67, 5 eventos)');
  const vPc = await c.ferramenta('calculo_validar', { especificacao: { ...exemplo, execucao: { ...exPc, custas: { ...exPc.custas, porAto: [] } } } });
  verificar(vPc.valido === false && vPc.erros.some((x) => /execucao\.custas: o campo "porAto" não existe/.test(x)), 'calculo_validar confere os blocos execucao.pensao e execucao.custas pelo esquema');

  console.log('13) leitura integral, conversores e PDF');
  const audLeit = (mutar) => audit((sp) => mutar(sp), { leitura: false });
  const lFalta = audLeit((sp) => { sp.contrato.leitura.find((l) => l.documento === 'D3').classificacao.usadas = '66-110'; });
  const lIleg = audLeit((sp) => { sp.contrato.leitura.find((l) => l.documento === 'D3').classificacao = { usadas: '66-110', ilegiveis: [{ folhas: '111-120', motivo: 'escaneado cortado' }] }; });
  const lFech = audLeit((sp) => { sp.contrato.leitura.find((l) => l.documento === 'D2').fechamentos = [{ tipo: 'HOLERITE', referencia: '2014-03', ok: false, detalhe: 'líquido não fecha' }]; });
  const lFechRes = audLeit((sp) => { sp.contrato.leitura.find((l) => l.documento === 'D2').fechamentos = [{ tipo: 'HOLERITE', referencia: '2014-03', ok: false, detalhe: 'líquido não fecha', resolucao: 'erro de soma do próprio holerite; valores das rubricas conferidos' }]; });
  const lPed = audLeit((sp) => { sp.contrato.pedidos.push({ pedido: 'Dano moral', documento: 'D1', situacao: 'SEM_DECISAO' }); });
  const lSem = audLeit((sp) => { delete sp.contrato.leitura; });
  verificar(temFalha(lFalta, /folhas sem classificação: 111-120/) && temFalha(lIleg, /ilegíveis 111-120 sem pedido/) && temFalha(lFech, /fechamento HOLERITE 2014-03/) && !temFalha(lFechRes, /fechamento/) && temAlerta(lPed, /sem decisão/) && temFalha(lSem, /nenhuma leitura registrada/),
    'leitura: folha sem classificação, ilegível sem pedido, fechamento sem resolução e falta de registro são falhas; pedido sem decisão é alerta');
  const vLeit = await c.ferramenta('calculo_validar', { especificacao: (() => { const sp = ex('calculo-auditavel.json'); delete sp.contrato.leitura; return sp; })() });
  verificar(vLeit.prontoParaCalcular === false && vLeit.bloqueiosParaCalcular.some((b) => /leitura integral/.test(b)), 'sem o registro da leitura, calculo_criar fica travado (trava "leitura integral")');
  const pdfFix = path.resolve(__dirname, 'fixtures', 'relatorio-referencia.pdf');
  const inv = await c.ferramenta('documento_inventario', { arquivos: [pdfFix] });
  verificar(inv.arquivos[0].tipo === 'PDF' && inv.arquivos[0].paginas === 3 && inv.arquivos[0].paginasComTexto === 3 && inv.processosCitados.includes('0001234-45.2015.5.08.0001') && inv.sugestao.leitura[0].documento === 'D1', `documento_inventario: PDF de ${inv.arquivos[0].paginas} páginas, sha256, páginas com texto, processo citado e esqueleto da leitura`);
  const txtPdf = await c.ferramenta('documento_texto', { arquivo: pdfFix, paginas: '1' });
  verificar(txtPdf.paginas.length === 1 && /Resumo do Cálculo/.test(txtPdf.paginas[0].texto) && /HORAS EXTRAS 50%/.test(txtPdf.paginas[0].texto), 'documento_texto: texto da página 1 do PDF com acentos');
  const { resumoDoTextoDoRelatorio } = await import('../server/lib/comparacao.mjs');
  const { lerPdf } = await import('../server/lib/pdf.mjs');
  const rPdf = resumoDoTextoDoRelatorio(lerPdf(fs.readFileSync(pdfFix)).paginas.map((p) => p.texto).join('\n'));
  verificar(rPdf.verbas.length === 12 && rPdf.brutoDevidoAoReclamante === 31320.1 && rPdf.liquidoDevidoAoReclamante === 23113.54 && rPdf.totalDevidoPeloReclamado === 40330.83, 'Resumo do Cálculo lido do PDF do relatório (referência em PDF): 12 linhas e os totais');
  const hol = await c.ferramenta('holerites_para_historicos', { periodo: { inicio: '2014-01', fim: '2014-03' }, historicos: [{ nome: 'Salário base', rubricas: ['001'] }], holerites: [
    { competencia: '2014-01', liquido: 1424, rubricas: [{ codigo: '001', descricao: 'SALARIO', valor: 1600 }, { codigo: '901', descricao: 'INSS', valor: 176, tipo: 'D' }] },
    { competencia: '2014-02', liquido: 1400, rubricas: [{ codigo: '001', descricao: 'SALARIO', valor: 1600 }, { codigo: '901', descricao: 'INSS', valor: 176, tipo: 'D' }] }] });
  verificar(hol.historicosSalariais[0].ocorrencias.length === 2 && hol.verificacoes.some((x) => x.estado === 'falha' && /2014-02/.test(x.item)) && hol.verificacoes.some((x) => x.estado === 'falha' && /2014-03/.test(x.detalhe)), 'holerites_para_historicos: histórico montado; fechamento errado e mês faltante acusados');
  const jor = await c.ferramenta('cartoes_para_jornadas', { periodo: { inicio: '2014-03-03', fim: '2014-03-05' }, dias: [{ data: '2014-03-03', marcacoes: ['08:00', '12:00', '13:00', '23:00'] }, { data: '2014-03-04', marcacoes: ['07:00', '12:00'] }, { data: '2014-03-05', marcacoes: ['08:00', '12:00', '13:00'] }] });
  verificar(jor.apuracaoCartaoPonto.jornadas.length === 2 && jor.verificacoes.some((x) => x.estado === 'falha' && /ímpar/.test(x.detalhe)) && jor.verificacoes.some((x) => /interjornadas/.test(x.item)), 'cartoes_para_jornadas: jornadas montadas; marcação ímpar e interjornada < 11 h acusadas');
  const fgx = await c.ferramenta('extrato_para_fgts', { documento: 'D10', saldo: 250, periodo: { inicio: '2014-01', fim: '2014-02' }, lancamentos: [{ competencia: '2014-01', data: '2014-02-07', valor: 128 }] });
  verificar(fgx.fgts.operacoes[0].origem === fgx.contratoPagamentos[0].id && fgx.verificacoes.some((x) => x.estado === 'falha' && /saldo/.test(x.item)) && fgx.verificacoes.some((x) => x.estado === 'alerta' && /2014-02/.test(x.detalhe)), 'extrato_para_fgts: operações com origem; saldo que não fecha e competência sem depósito acusados');
  const trct = await c.ferramenta('trct_para_pagamentos', { data: '2015-04-25', totais: { bruto: 2500, descontos: 200, liquido: 2300 }, campos: [{ codigo: 50, valor: 1000 }, { codigo: 65, valor: 1500 }, { codigo: 112, valor: 200 }] });
  verificar(trct.pagamentos.length === 2 && trct.pagamentos[1].titulo === 'FÉRIAS PROPORCIONAIS' && trct.verificacoes.every((x) => x.estado === 'ok'), 'trct_para_pagamentos: pagamentos por campo (Portaria 1.621/2010) e totais conferidos');

  console.log('14) gerador: honorários sobre verbas escolhidas, valor pago em reflexo, piso e vale-transporte');
  const comHon = JSON.parse(JSON.stringify(exemplo));
  comHon.verbas.find((v) => v.verba === 'MULTA DO ARTIGO 477 DA CLT').comporPrincipal = false;
  comHon.honorarios.push({ tipo: 'PERICIAIS_CONTADOR', devedor: 'RECLAMADO', credor: { nome: 'Perito' }, percentual: 10, verbas: ['MULTA DO ARTIGO 477 DA CLT'] });
  const heHon = comHon.verbas.find((v) => v.verba === 'HORAS EXTRAS 50%');
  heHon.reflexos = heHon.reflexos.map((n) => (n.startsWith('13º') ? { nome: n, valorPago: 5 } : n));
  const aHon = gerarCalculo(comHon).arvore;
  const hon = its(cmp(aHon, 'honorarios')).find((h) => cmp(h, 'nomeCredor') === 'PERITO');
  const refl13 = its(cmp(aHon, 'verbas')).find((v) => cmp(v, 'nome') === '13º SALÁRIO SOBRE HORAS EXTRAS 50%');
  verificar(cmp(hon, 'baseParaApuracao') === 'VERBAS_QUE_NAO_COMPOE_O_PRINCIPAL' && its(cmp(hon, 'verbasSelecionadas')).length === 1 && cmp(cmp(cmp(refl13, 'formula'), 'valorPago'), 'valorInformado').startsWith('5.0'), 'honorários sobre verba escolhida (HonorarioVerbaDeCalculo) e valor pago no reflexo (FormulaReflexo.valorPago)');
  const honRuim = JSON.parse(JSON.stringify(exemplo)); honRuim.honorarios.push({ devedor: 'RECLAMADO', credor: { nome: 'X' }, percentual: 10, verbas: ['MULTA DO ARTIGO 477 DA CLT'] });
  const vHonRuim = await c.ferramenta('calculo_validar', { especificacao: honRuim });
  verificar(vHonRuim.valido === false && /compõe o principal/.test(vHonRuim.erros[0]), 'honorário sobre verba que compõe o principal é recusado (a tela só oferece as que não compõem)');
  const piso = JSON.parse(JSON.stringify(exemplo)); piso.verbas.push({ verba: 'DIFERENÇA SALARIAL', nome: 'DIFERENÇA DE PISO', base: { tipo: 'SALARIO_DA_CATEGORIA' }, valorPago: { tipo: 'CALCULADO', base: 'HISTORICO_SALARIAL', historicos: ['SALÁRIO BASE'] } });
  const vPiso = await c.ferramenta('calculo_validar', { especificacao: piso });
  piso.verbas[piso.verbas.length - 1].base.piso = 7;
  const aPiso = gerarCalculo(piso).arvore;
  const vbPiso = its(cmp(aPiso, 'verbas')).find((v) => cmp(v, 'nome') === 'DIFERENÇA DE PISO');
  verificar(vPiso.valido === false && /piso/.test(vPiso.erros[0]) && cmp(vbPiso, 'salarioCategoriaValorDevido').$ext === 'SalarioCategoria', 'base pelo piso salarial: exige o id da tabela (catalogo_pisos_vt) e grava a referência externa');

  console.log('15) ocorrências de FGTS e de contribuição social; custas fixas, autos e armazenamentos');
  // gabarito H: o caso de referência com esses ajustes feitos à mão na tela (células, lotes e o 13º)
  const specH = ex('calculo-ocorrencias-custas.json');
  const telaH = () => lerPjc(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'gabaritos-tela', 'H-ocorrencias-custas.PJC'))).arvore;
  const vH = await c.ferramenta('calculo_validar', { especificacao: specH });
  verificar(vH.valido && vH.resumo.edicoesEncargos.length === 3 && /atosUrbanos 2/.test(vH.resumo.custasFixas), 'fgts.ocorrencias, contribuicaoSocial.ocorrencias e custas.fixas/autos/armazenamentos aceitos pela especificação');
  const { arvore: arvH, posImportacao: posH } = gerarCalculo(specH);
  const { CUSTAS_FIXAS } = await import('../server/lib/gerador.mjs');
  const custasDe = (a) => { const cu = cmp(a, 'custasJudiciais'); return JSON.stringify([...Object.values(CUSTAS_FIXAS).map(([q]) => cmp(cu, q)), cmp(cu, 'dataVencimentoCustasFixas'), ...['autosJudiciais', 'armazenamentos'].map((k) => its(cmp(cu, k)).map((o) => o.campos.filter(([n]) => !['id', 'versao', 'custasJudiciais'].includes(n))))]); };
  verificar(custasDe(arvH) === custasDe(telaH()), 'custas fixas, auto e armazenamento gravados no .PJC como a tela grava (gabarito H)');
  // os campos informados na tela voltam ao valor gerado (cópia original); as edições da especificação refazem a tela
  const { aplicarEdicoesEncargos, conferirEdicoesEncargos, conferirCustas } = await import('../server/lib/ocorrencias.mjs');
  const paresEnc = { OcorrenciaDeFgts: [['baseHistorico', 'tipoDeBaseDoFgts'], ['depositado', 'tipoDeDepositadoDoFgts']], OcorrenciaDeInssSobreSalariosDevidos: [['valorBase', 'tipoValorDaBase']],
    OcorrenciaDeInssSobreSalariosPagos: [['valorBase', 'tipoValorDaBase'], ['valorRecolhidoSegurado', 'tipoValorDoRecolhidoSegurado'], ['valorRecolhidoEmpresa', 'tipoValorDoRecolhidoEmpresa'], ['valorRecolhidoSAT', 'tipoValorDoRecolhidoSAT'], ['valorRecolhidoTerceiros', 'tipoValorDoRecolhidoTerceiros']] };
  const camposEnc = Object.fromEntries(Object.entries(paresEnc).map(([k, v]) => [k, v.flat()]));
  const ocEnc = (a) => [...its(cmp(cmp(a, 'fgts'), 'ocorrencias')), ...['inssSobreSalariosDevidos', 'inssSobreSalariosPagos'].flatMap((k) => its(cmp(cmp(cmp(a, 'inss'), k), 'ocorrencias')))].filter((o) => o.$classe);
  const regerado = telaH();
  for (const o of ocEnc(regerado)) for (const [v, t] of paresEnc[o.$classe]) if (/^INFORMAD/.test(cmp(o, t))) { def(o, v, cmp(cmp(o, 'ocorrenciaOriginal'), v)); def(o, t, cmp(cmp(o, 'ocorrenciaOriginal'), t)); }
  const aplH = aplicarEdicoesEncargos(regerado, posH.edicoesEncargos);
  const ocTela = ocEnc(telaH());
  const difH = ocEnc(regerado).flatMap((o, i) => { const t = ocTela[i]; return camposEnc[o.$classe].filter((k) => (/^tipo|aliquota/.test(k) ? cmp(o, k) !== cmp(t, k) : Math.abs(Number(cmp(o, k)) - Number(cmp(t, k))) > 0.001)).map((k) => `${o.$classe} ${i} ${k}`); });
  verificar(aplH.length === 15 && !difH.length && conferirEdicoesEncargos(regerado, posH.edicoesEncargos).estado === 'ok', `edições da especificação = edições feitas na tela: 15 ocorrências (células, lotes e o 13º) iguais ao gabarito${difH.length ? ` — diferem: ${difH.slice(0, 5).join(', ')}` : ''}`);
  const comAliq = telaH();
  aplicarEdicoesEncargos(comAliq, { fgts: [{ competencia: '2014-05', aliquota: '2' }] });
  const conf2 = conferirEdicoesEncargos(comAliq, { fgts: [{ competencia: '2014-05', aliquota: '2' }] });
  def(its(cmp(cmp(comAliq, 'fgts'), 'ocorrencias')).find((o) => cmp(o, 'aliquotaDoFgtsEnum') === 'DOIS_POR_CENTO'), 'aliquotaDoFgtsEnum', 'OITO_POR_CENTO');
  verificar(conf2.estado === 'ok' && conferirEdicoesEncargos(comAliq, { fgts: [{ competencia: '2014-05', aliquota: '2' }] }).estado === 'falha', 'alíquota do FGTS por competência gravada e conferida (a regeração que a perde vira falha)');
  let err13 = '';
  try { aplicarEdicoesEncargos(telaH(), { salariosDevidos: [{ competencia: '2014-05', decimoTerceiro: true, base: '1.00' }] }); } catch (e) { err13 = e.message; }
  verificar(/nenhuma ocorrência/.test(err13) && /2014-12 \(13º\)/.test(err13), '13º pedido num mês sem 13º: recusa, listando as ocorrências geradas');
  const erroH = async (mudar) => { const sp = JSON.parse(JSON.stringify(specH)); mudar(sp); const r = await c.ferramenta('calculo_validar', { especificacao: sp }); return r.valido ? '' : r.erros.join(' | '); };
  verificar(/fora do período/.test(await erroH((sp) => { sp.fgts.ocorrencias.push({ competencia: '2016-01', base: 1 }); }))
    && /apurarSobreSalariosPagos/.test(await erroH((sp) => { delete sp.contribuicaoSocial.apurarSobreSalariosPagos; }))
    && /use 2 ou 8/.test(await erroH((sp) => { sp.fgts.ocorrencias.push({ competencia: '2014-05', aliquota: 5 }); }))
    && /nada a alterar/.test(await erroH((sp) => { sp.contribuicaoSocial.ocorrencias.salariosDevidos.push({ competencia: '2014-05' }); }))
    && /"competencia" ou o intervalo/.test(await erroH((sp) => { sp.fgts.ocorrencias.push({ competencia: '2014-05', de: '2014-05', depositado: 1 }); })),
  'ocorrências de FGTS e CS: competência fora do período, salários pagos sem apuração, alíquota inválida, item vazio e seletor duplo são recusados');
  verificar(/vencimento/.test(await erroH((sp) => { delete sp.custas.fixas.vencimento; }))
    && /anterior ao ajuizamento/.test(await erroH((sp) => { sp.custas.autos[0].vencimento = '2015-01-10'; }))
    && /valor da avaliação/.test(await erroH((sp) => { delete sp.custas.armazenamentos[0].valor; }))
    && /"fim" anterior/.test(await erroH((sp) => { sp.custas.armazenamentos[0].fim = '2016-01-01'; }))
    && /TipoDeAutoEnum/.test(await erroH((sp) => { sp.custas.autos[0].tipo = 'PENHORA'; }))
    && /inteira de 0 a 999/.test(await erroH((sp) => { sp.custas.fixas.atosUrbanos = 1.5; })),
  'custas: quantidades sem vencimento, data antes do ajuizamento, avaliação ausente, término antes do início, tipo de auto e quantidade inválidos são recusados');
  // conferência no cálculo liquidado: auto = 5% da avaliação até o teto; armazenamento = 0,1% por dia
  const liqH = telaH(); const cuH = cmp(liqH, 'custasJudiciais');
  def(liqH, 'hashCalculoCorreto', 'true'); def(liqH, 'dataDeLiquidacao', String(Date.UTC(2016, 5, 30, 3)));
  for (const [q, v] of [['valorAtosUrbanos', '11.06'], ['valorAgravoInstrumento', '44.26'], ['valorEmbargosExecucao', '44.26'], ['valorRecursoRevista', '55.35']]) def(cuH, q, v);
  const autoH = its(cmp(cuH, 'autosJudiciais'))[0]; def(autoH, 'valorTeto', '1915.38'); def(autoH, 'valorCustasAuto', '1000.00');
  const armH = its(cmp(cuH, 'armazenamentos'))[0]; def(armH, 'qtdeDias', '60'); def(armH, 'valorCustasArmazenamento', '300.00');
  const confC = conferirCustas(liqH, specH.custas);
  // recálculo independente: conhecimento + fixas + auto + armazenamento, cada um × seu índice (= Resumo do caso H: 3.113,98)
  def(cuH, 'valorBaseCustasCalculadas', '81330.60'); def(cuH, 'valorConhecimentoDoReclamado', '1626.612'); def(cuH, 'indiceCorrecaoCustasFixas', '1.0126344');
  def(autoH, 'indiceCorrecao', '1.0126344'); def(armH, 'indiceCorrecao', '1.022175370432392');
  const recH = recalcularPjc(liqH);
  verificar(txtd(recH.custas.totalReclamado) === '3113.98' && recH.verificacoes.some((x) => /custas de autos/.test(x.item) && x.estado === 'ok'), `recálculo das custas com fixas, auto e armazenamento: ${txtd(recH.custas.totalReclamado)} (Resumo do PJe-Calc: 3113.98)`);
  def(armH, 'valorCustasArmazenamento', '310.00');
  verificar(confC.estado === 'ok' && conferirCustas(liqH, specH.custas).estado === 'falha', `custas no cálculo liquidado conferidas (${confC.detalhe}); armazenamento com conta errada vira falha`);

  console.log('16) lacunas encontradas no primeiro cálculo real');
  // ocorrência que não cabe no período: o PJe-Calc não gera nada (ou recusa regerar) — agora é erro antes de importar
  const erroGer = (verba) => { const sp = JSON.parse(JSON.stringify(exemplo)); sp.verbas.push(verba); try { gerarCalculo(sp); return ''; } catch (e) { return e.message; } };
  verificar(/não tem dezembro/.test(erroGer({ verba: '13º SALÁRIO', nome: '13º PROPORCIONAL X', data: '2014-05-20', quantidade: { tipo: 'INFORMADA', valor: 5 } }))
    && /DESLIGAMENTO/.test(erroGer({ verba: 'FÉRIAS + 1/3', nome: 'FÉRIAS X', periodo: { inicio: '2014-05-01', fim: '2014-05-27' }, caracteristica: 'COMUM', ocorrenciaDePagamento: 'DESLIGAMENTO', quantidade: 8 }))
    && /PERIODO_AQUISITIVO/.test(erroGer({ verba: 'FÉRIAS + 1/3', nome: 'FÉRIAS Y', data: '2014-05-20', quantidade: 8 }))
    && /avos/.test(erroGer({ verba: '13º SALÁRIO', nome: '13º Z', data: '2014-05-20', ocorrenciaDePagamento: 'MENSAL' }))
    && erroGer({ verba: '13º SALÁRIO', nome: '13º PROPORCIONAL 5/12', periodo: { inicio: '2014-05-01', fim: '2014-05-27' }, ocorrenciaDePagamento: 'MENSAL', quantidade: { tipo: 'INFORMADA', valor: 5 } }) === '',
  'verba cuja ocorrência não cabe no período (dezembro, desligamento, aquisitivo, avos num dia) é recusada com o caminho certo; MENSAL + avos informados é aceito');
  // avos deferidos pelo título (quantidade INFORMADA) não são comparados com o contrato inteiro
  const arvAvos = lerFixture();
  const d13 = [...objs(arvAvos)].find((o) => o.$classe === 'Calculada' && cpo(o, 'nome') === '13º SALÁRIO');
  const q13 = its(cpo(d13, 'ocorrencias')).find((x) => x.$classe);
  const qForm13 = cpo(cpo(d13, 'formula'), 'quantidade');
  definir(qForm13, 'tipo', 'INFORMADA'); definir(qForm13, 'valorInformado', cpo(q13, 'quantidade'));
  const anoQ13 = new Date(Number(cpo(q13, 'dataInicial'))).toISOString().slice(0, 4);
  const avosInf = conferenciaIndependente(arvAvos).find((x) => x.item === `avos de 13º ${anoQ13} (13º SALÁRIO)`);
  verificar(avosInf && avosInf.estado === 'ok' && /avos informados/.test(avosInf.detalhe), `avos de 13º informados (deferidos pelo título) conferidos contra a especificação: ${avosInf && avosInf.detalhe}`);
  // pago maior que o devido num mês abate os demais (dedução global) — avisa
  const arvNeg = lerFixture();
  const heNeg = [...objs(arvNeg)].find((o) => o.$classe === 'Calculada' && cpo(o, 'nome') === 'HORAS EXTRAS 50%');
  const ocNeg = its(cpo(heNeg, 'ocorrencias')).filter((x) => x.$classe && cpo(x, 'ativo') !== 'false');
  definir(ocNeg[0], 'pago', String(Number(cpo(ocNeg[0], 'devido')) + 50));
  const alNeg = conferenciaIndependente(arvNeg).find((x) => /pago maior que o devido/.test(x.item));
  definir(heNeg, 'zeraValorNegativo', 'true');
  verificar(alNeg && alNeg.estado === 'alerta' && /OJ 415/.test(alNeg.detalhe) && !conferenciaIndependente(arvNeg).some((x) => /pago maior que o devido/.test(x.item)), 'pago maior que o devido num mês: alerta de dedução global (some com "zerarNegativo")');
  // título: parcela excluída pelo acórdão marcada REFORMADA recebe a orientação; coleta aceita os nomes usuais
  const audT = ex('calculo-auditavel.json');
  const decT1 = audT.contrato.decisoes[0];
  audT.contrato.decisoes.push({ id: 'DEC9', processo: decT1.processo, documento: decT1.documento, tipo: 'ACORDAO', instancia: 'TRT_TURMA', publicacao: '2016-01-20', folha: 'fl. 30', trecho: 'exclui as horas extras', recorrida: 'DEC1', resultado: 'PARCIALMENTE_PROVIDO', capitulos: [{ parcela: 'P6', efeito: 'EXCLUI', folha: 'fl. 31' }] });
  Object.assign(audT.contrato.parcelas.find((p) => p.id === 'P6'), { situacao: 'REFORMADA', decisao: 'DEC9' });
  const tt = await c.ferramenta('titulo_compor', { especificacao: audT });
  verificar(tt.verificacoes.some((v) => v.estado === 'falha' && /fica INDEFERIDA/.test(v.detalhe) && /REFORMADA é para a parcela que continua deferida/.test(v.detalhe)), 'parcela excluída por acórdão marcada REFORMADA: a falha diz que a situação final é INDEFERIDA');
  const audC = ex('calculo-auditavel.json');
  audC.contrato.coleta = [...(audC.contrato.coleta || []), { id: 'C90', requisito: 'SENTENCA', documento: 'sentença', motivo: 'título', status: 'RECEBIDO', recebidoComo: ['D1'] }, { id: 'C91', requisito: 'TRANSITO', documento: 'certidão', motivo: 'trânsito', status: 'RECEBIDO', recebidoComo: ['D1'] }, { id: 'C92', requisito: 'OUTROS', documento: 'ata de audiência', motivo: 'confissões', status: 'SOLICITADO' }];
  const dn = await c.ferramenta('calculo_documentos_necessarios', { especificacao: audC });
  const dnFer = await c.ferramenta('calculo_documentos_necessarios', { parcelas: ['FERIADOS EM DOBRO'], admissao: '2023-10-03', demissao: '2024-05-27' });
  verificar(!dn.inconsistencias.some((x) => /desconhecido/.test(x.detalhe)) && dnFer.requisitos.some((r) => r.id === 'JORNADA'), 'coleta aceita SENTENCA, TRANSITO e OUTROS; feriados em dobro pedem os cartões de ponto (ou a jornada fixada)');
  // pagamento feito por outra empresa do grupo: falha, salvo se aceito por decisão (alerta com o motivo)
  const audE = ex('calculo-auditavel.json');
  const pgE = { id: 'PG9', titulo: '13º de 2014 pago', parcelas: ['P3'], competencia: '2014-12', data: '2014-12-20', valor: 100, emitente: 'OUTRA EMPRESA DO GRUPO LTDA', documento: 'D2', folha: 'fl. 50', comando: 'DEC1' };
  audE.contrato.pagamentos = [pgE];
  audE.verbas.find((v) => v.verba === '13º SALÁRIO').valorPago = { tipo: 'INFORMADO', valor: 100, origem: ['PG9'] };
  const emitFalha = (await c.ferramenta('calculo_validar', { especificacao: audE })).auditoria.verificacoes.find((v) => /OUTRA EMPRESA/.test(v.detalhe));
  pgE.emitenteAceito = { motivo: 'recibos juntados pela própria reclamada e aceitos na sentença', decisao: audE.contrato.decisoes[0].id, folha: 'fl. 15' };
  const emitAceito = (await c.ferramenta('calculo_validar', { especificacao: audE })).auditoria.verificacoes.find((v) => /OUTRA EMPRESA/.test(v.detalhe));
  verificar(emitFalha && emitFalha.estado === 'falha' && /emitenteAceito/.test(emitFalha.detalhe) && emitAceito && emitAceito.estado === 'alerta' && /aceito como pagamento/.test(emitAceito.detalhe), 'pagamento de outra empresa: falha que sugere "emitenteAceito"; aceito por decisão vira alerta com o motivo');
  // pago informado mês a mês (ocorrencias) passa pelo mesmo crivo dos pagamentos
  audE.verbas.find((v) => v.verba === 'HORAS EXTRAS 50%').ocorrencias = [{ competencia: '2014-12', pago: 10, origem: 'PG9' }];
  const vOc = (await c.ferramenta('calculo_validar', { especificacao: audE })).auditoria.verificacoes.find((v) => /pago em 2014-12/.test(v.item) && v.estado === 'falha');
  verificar(vOc && /natureza incompatível/.test(vOc.detalhe), 'pago mês a mês com origem em pagamento de outra parcela: falha de identidade, como no valor pago da verba');
  // documento inexistente com fundamento não é pedido aberto, também na cobertura mês a mês
  const audI = ex('calculo-auditavel.json');
  const holer = audI.contrato.documentos.find((d) => d.tipo === 'HOLERITES');
  holer.lacunas = [...(holer.lacunas || []), '2014-08'];
  audI.contrato.coleta = [...(audI.contrato.coleta || []), { id: 'C80', requisito: 'SALARIOS', documento: 'holerite de 08/2014', motivo: 'base', status: 'INEXISTENTE', fundamento: 'a empresa não emitiu holerite naquele mês; valor no TRCT' }];
  const reqSal = (await c.ferramenta('calculo_documentos_necessarios', { especificacao: audI })).requisitos.find((r) => r.id === 'SALARIOS');
  verificar(reqSal && reqSal.status === 'inexistente_fundamentado', `mês faltante registrado como inexistente com fundamento: ${reqSal && reqSal.status} (não "pendente")`);
  // PDF que posiciona letra por letra, carimbo do PJe em página escaneada e imagens das páginas
  const zlibT = await import('node:zlib'); const osT = await import('node:os');
  const montarPdf = (objetos) => {
    const partes = [Buffer.from('%PDF-1.4\n', 'latin1')];
    objetos.forEach((o, i) => {
      if (o.stream) partes.push(Buffer.from(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.stream.length} >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1'));
      else partes.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
    });
    partes.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
    return Buffer.concat(partes);
  };
  const jpegFalso = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
  const cinza = zlibT.deflateSync(Buffer.alloc(250 * 210, 128));
  const pdfT = montarPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 65 /LastChar 70 /Widths [600 600 600 600 600 600] >>',
    { dict: '', stream: Buffer.from('BT /F1 10 Tf 1 0 0 1 50 700 Tm (A) Tj 6 0 TD (B) Tj ET BT /F1 10 Tf 1 0 0 1 62 700 Tm (C) Tj ET BT /F1 10 Tf 1 0 0 1 80 700 Tm (D) Tj ET', 'latin1') },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 7 0 R /Im2 8 0 R >> >> /Contents 9 0 R >>',
    { dict: '/Type /XObject /Subtype /Image /Width 300 /Height 400 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode', stream: jpegFalso },
    { dict: '/Type /XObject /Subtype /Image /Width 250 /Height 210 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode', stream: cinza },
    { dict: '', stream: Buffer.from('q 600 0 0 800 0 0 cm /Im1 Do Q q 100 0 0 80 0 0 cm /Im2 Do Q BT /F1 8 Tf 1 0 0 1 10 20 Tm (Documento assinado eletronicamente por FULANO DE TAL, em 01/01/2026) Tj ET BT /F1 8 Tf 1 0 0 1 10 10 Tm (Fls.: 2) Tj ET', 'latin1') },
  ]);
  const { lerPdf: lerPdfT, extrairImagens } = await import('../server/lib/pdf.mjs');
  const lidoT = lerPdfT(pdfT);
  verificar(lidoT.paginas[0].texto.trim() === 'ABC D', `texto posicionado letra por letra sai em palavras pela largura dos glifos: "${lidoT.paginas[0].texto.trim()}"`);
  verificar(lidoT.paginas[1].temTexto === false && lidoT.paginas[1].caracteresSemCarimbo === 0, 'página escaneada só com o carimbo de assinatura do PJe é marcada sem texto (ver como imagem)');
  const dirImg = fs.mkdtempSync(path.join(osT.tmpdir(), 'pjecalc-mcp-img-'));
  const imgsT = extrairImagens(pdfT, { destino: dirImg });
  const pg2 = imgsT.paginas.find((p) => p.pagina === 2);
  const jpg = pg2 && pg2.arquivos.find((a) => a.formato === 'JPEG'); const png = pg2 && pg2.arquivos.find((a) => a.formato === 'PNG');
  verificar(jpg && png && jpg.principal && fs.readFileSync(jpg.arquivo).equals(jpegFalso) && fs.readFileSync(png.arquivo).subarray(1, 4).toString('latin1') === 'PNG' && imgsT.semImagem.includes(1), 'documento_imagens: JPEG da página gravado como está (principal), imagem comprimida convertida em PNG, página só de texto sem imagem');
  fs.rmSync(dirImg, { recursive: true, force: true });

  console.log('17) leituras alternativas das premissas');
  const comLeitura = (mudar) => { const sp = ex('calculo-auditavel.json'); sp.contrato.premissas.push({ id: 'PR90', texto: 'divisor 220', status: 'CONTROVERTIDA', fundamento: 'o título não fixa o divisor', alternativas: [{ texto: 'divisor 220', efeito: 'valor-hora menor' }, { texto: 'divisor 200', efeito: 'valor-hora 10% maior', favoravel: true }] }); sp.contrato.parcelas.find((x) => x.id === 'P6').premissas = ['PR90']; mudar(sp); return sp; };
  const leit = async (sp) => (await c.ferramenta('calculo_validar', { especificacao: sp })).auditoria.verificacoes.filter((v) => v.item === 'premissa PR90' || v.item === 'contrato.posicao');
  const lMenos = await leit(comLeitura(() => {}));
  const lMais = await leit(comLeitura((sp) => { Object.assign(sp.contrato.premissas.find((x) => x.id === 'PR90'), { texto: 'divisor 200', criterio: 'MAIS_FAVORAVEL' }); }));
  const lExpresso = await leit(comLeitura((sp) => { Object.assign(sp.contrato.premissas.find((x) => x.id === 'PR90'), { criterio: 'COMANDO_EXPRESSO', fundamento: 'o acórdão fixa a carga de 220 horas (fl. 31)' }); }));
  const lPos = await leit(comLeitura((sp) => { sp.contrato.posicao = 'AUTOR'; }));
  verificar(lMenos.some((v) => v.estado === 'alerta' && /não é a mais favorável ao reclamante/.test(v.detalhe) && /criterio/.test(v.detalhe)) && !lMais.length
    && lExpresso.some((v) => /COMANDO_EXPRESSO.*fl\. 31/.test(v.detalhe)) && lPos.some((v) => v.estado === 'falha' && /RECLAMANTE, RECLAMADA ou NEUTRA/.test(v.detalhe)),
  'leitura adotada diferente da marcada é avisada (com o motivo, quando há comando expresso); a marcada passa; posição inválida é falha');
  const lContradita = await leit(comLeitura((sp) => { sp.contrato.premissas.find((x) => x.id === 'PR90').criterio = 'MAIS_FAVORAVEL'; }));
  const lSolta = await leit(comLeitura((sp) => { sp.contrato.parcelas.find((x) => x.id === 'P6').premissas = []; }));
  verificar(lContradita.some((v) => v.estado === 'falha' && /MAIS_FAVORAVEL, mas a leitura adotada/.test(v.detalhe)) && lSolta.some((v) => /não é a mais favorável/.test(v.detalhe)),
    'critério contraditório com a leitura adotada é falha; a premissa é conferida mesmo sem verba ligada');
  const lNeutra = await leit(comLeitura((sp) => { sp.contrato.posicao = 'NEUTRA'; }));
  const planoL = await c.ferramenta('calculo_plano_interpretacao', { especificacao: comLeitura(() => {}) });
  const planoN = await c.ferramenta('calculo_plano_interpretacao', { especificacao: comLeitura((sp) => { sp.contrato.posicao = 'NEUTRA'; }) });
  verificar(!lNeutra.length && !/Posição/.test(planoL.markdown) && /\*\*\[mais favorável\]\*\* divisor 200/.test(planoL.markdown) && !/\[mais favorável\]/.test(planoN.markdown) && /divisor 220 — valor-hora menor ← adotada/.test(planoL.markdown),
    'posição NEUTRA não marca leitura; o plano mostra as leituras e qual foi adotada');

  const { diagnosticoDoLog } = await import('../server/lib/lifecycle.mjs');
  const logOom = 'INFORMAÇÕES: Server startup in 9000 ms\n...\nCaused by: org.h2.jdbc.JdbcSQLException: Out of memory.; SQL statement:\nCaused by: java.lang.OutOfMemoryError: GC overhead limit exceeded\nERROR - The database has been closed [90098-154]';
  verificar(/sem memória/.test(diagnosticoDoLog(logOom)) && /pjecalc_parar/.test(diagnosticoDoLog(logOom)) && diagnosticoDoLog(`${logOom}\nINFORMAÇÕES: Server startup in 8000 ms\nok`) === null,
    'PJe-Calc sem memória: o motivo e o remédio (parar e iniciar) saem no erro; depois de reiniciar, o log antigo não conta');
  console.log('19) relatório completo: as seções que se aplicam a cada cálculo');
  const { secoesDoRelatorio } = await import('../server/lib/servico-calculo.mjs');
  const secGab = (g) => secoesDoRelatorio(lerPjc(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'gabaritos-tela', g))).arvore);
  const sA = secGab('A-referencia.PJC'); const sE = secGab('E-cartao-ponto.PJC'); const sG = secGab('G-diversos.PJC');
  verificar(sA[0] === 'RESUMO_DE_CALCULO' && sA.includes('DEMONSTRATIVO_DE_CALCULO') && sA.includes('DEMONSTRATIVO_CUSTAS') && sA.includes('JUSTIFICATIVA') && !sA.some((x) => /CARTAO|MULTA|PENSAO|SALARIO_FAMILIA/.test(x))
    && sE.includes('CARTAO_MENSAL') && sE.includes('CARTAO_DIARIO') && sG.includes('DEMONSTRATIVO_MULTA') && !sG.includes('CARTAO_MENSAL'),
    `seções escolhidas pelo conteúdo: sem cartão não pede cartão (o PJe-Calc falharia); multa só com multa (${sA.length}/${sE.length}/${sG.length} seções em A/E/G)`);

  console.log('18) contribuição progressiva do segurado pelas faixas da tabela');
  const { pastaSaida } = await import('../server/lib/servico-calculo.mjs');
  const ext = 'C:\\Users\\x\\AppData\\Roaming\\Claude\\Claude Extensions\\pjecalc-mcp\\saida';
  verificar(pastaSaida({ PJECALC_MCP_SAIDA: 'D:\\Calculos' }, ext) === path.resolve('D:\\Calculos') && pastaSaida({ PJECALC_MCP_SAIDA: '${user_config.pasta_saida}', USERPROFILE: 'C:\\Users\\x' }, ext) === path.join('C:\\Users\\x', 'Documents', 'PJe-Calc MCP')
    && pastaSaida({ PJECALC_MCP_SAIDA: '' }, 'D:\\pjecalc\\pjecalc-mcp-skill\\saida') === 'D:\\pjecalc\\pjecalc-mcp-skill\\saida', 'pasta dos arquivos: escolhida pelo usuário, Documentos quando instalado como extensão, "saida" ao lado do MCP');
  const { dataTela } = await import('../server/lib/operacoes.mjs');
  verificar(dataTela('2026-09-30') === '30/09/2026' && dataTela('30/09/2026') === '30/09/2026' && dataTela(null) === null, 'data de liquidação aceita em aaaa-mm-dd ou dd/mm/aaaa (a tela só aceita dd/mm/aaaa)');
  const { contribuicaoProgressiva } = await import('../server/lib/recalculo.mjs');
  const tabInss = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'server', 'modelos', 'tabela-inss-segurado.json'), 'utf-8')).competencias;
  verificar(Math.abs(contribuicaoProgressiva(tabInss['2023-02'], 2200) - 178.47075) < 1e-9 && Math.abs(contribuicaoProgressiva(tabInss['2023-02'], 1000) - 75) < 1e-9 && Object.keys(tabInss).length >= 82,
    '1ª faixa conta de -0,01 (2.200,00 em 02/2023 = 1.302,01 × 7,5% + 898,00 × 9% = 178,47075), como o PJe-Calc grava');
  const arvFaixas = () => lerPjc(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'calculo-inss-progressivo.PJC'))).arvore;
  const regInss = (arv) => recalcularPjc(arv).verificacoes.find((v) => /contribuição social: segurado/.test(v.item));
  const okFaixas = regInss(arvFaixas());
  const arvFaixasMexida = arvFaixas();
  const ocFaixas = its(cmp(cmp(cmp(arvFaixasMexida, 'inss'), 'inssSobreSalariosDevidos'), 'ocorrencias')).find((o) => Number(cmp(o, 'valorBase')) === 2500);
  def(ocFaixas, 'valorTotalInssSegurado', String(Number(cmp(ocFaixas, 'valorTotalInssSegurado')) + 0.01));
  const mexFaixas = regInss(arvFaixasMexida);
  verificar(okFaixas.estado === 'ok' && /72 contribuição\(ões\) progressiva\(s\) recalculada/.test(okFaixas.detalhe) && mexFaixas.estado === 'falha' && /pelas faixas/.test(mexFaixas.detalhe),
    `03/2020 a 12/2022, faixas 2 a 4 e teto: as 72 contribuições batem com as faixas; um centavo a mais no salário é acusado (${okFaixas.detalhe.slice(0, 90)})`);

  // 20) opções fora do padrão: cada gabarito é o caso A com uma tela alterada à mão. Todo campo que a tela mudou
  // em relação ao A tem de sair igual do gerador (o ponta a ponta confere também os valores liquidados).
  console.log('20) opções fora do padrão conferidas com os gabaritos da tela');
  const gabaritoTela = (nome) => lerPjc(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'gabaritos-tela', nome))).arvore;
  const simples = (arv, classe) => {
    const o = [...objetos(arv)].find((x) => x.$classe === classe);
    return o ? Object.fromEntries(o.campos.filter(([n, v]) => !['id', 'versao', 'informacaoUltimoIndice'].includes(n) && (v === null || typeof v !== 'object'))) : {};
  };
  const mesmoValor = (a, b) => String(a ?? '') === String(b ?? '') || (a != null && b != null && /^-?\d+(\.\d+)?$/.test(String(a)) && /^-?\d+(\.\d+)?$/.test(String(b)) && Number(a) === Number(b));
  const conferirGabarito = (exemplo, gabarito, classes, baseGabarito = 'A-referencia.PJC') => {
    const ger = gerarCalculo(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', exemplo), 'utf-8'))).arvore;
    const base = gabaritoTela(baseGabarito); const tela = gabaritoTela(gabarito);
    const mudados = []; const dif = [];
    for (const classe of classes) {
      const a = simples(base, classe); const t = simples(tela, classe); const g = simples(ger, classe);
      for (const k of Object.keys(t)) {
        if (mesmoValor(a[k], t[k])) continue;
        mudados.push(k);
        if (!mesmoValor(g[k], t[k])) dif.push(`${classe}.${k}: gerador ${g[k]} × tela ${t[k]}`);
      }
    }
    verificar(mudados.length > 0 && !dif.length, `${gabarito}: os ${mudados.length} campos mudados na tela saem iguais do gerador${dif.length ? ` — ${dif.join(' | ')}` : ''}`);
  };
  conferirGabarito('calculo-dados-especificos.json', 'I-dados-especificos.PJC', ['ParametrosDeAtualizacao']);
  conferirGabarito('calculo-fgts-cs-ir.json', 'J-fgts-cs-ir.PJC', ['Fgts', 'Inss', 'InssSobreSalariosDevidos', 'Irpf']);
  conferirGabarito('calculo-aliquota-fixa-ir-caixa.json', 'K-aliquota-fixa-ir-caixa.PJC', ['Fgts', 'Inss', 'Irpf']);
  conferirGabarito('calculo-cartao-sumula85.json', 'L-cartao-sumula85.PJC', ['ApuracaoCartaoDePonto'], 'E-cartao-ponto.PJC');
  conferirGabarito('calculo-cartao-semanal-noturno.json', 'M-cartao-semanal-noturno.PJC', ['ApuracaoCartaoDePonto'], 'E-cartao-ponto.PJC');
  conferirGabarito('calculo-indices-juros-parametros.json', 'P-indices-juros-parametros.PJC', ['ParametrosDeAtualizacao']);
  {
    // parâmetros do Calculo mudados na tela (carga, sábado, aviso, feriados, negativos)
    const ger = gerarCalculo(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'calculo-indices-juros-parametros.json'), 'utf-8'))).arvore;
    const tela = gabaritoTela('P-indices-juros-parametros.PJC');
    const ks = ['valorCargaHorariaPadrao', 'sabadoDiaUtil', 'projetaAvisoIndenizado', 'consideraFeriadoEstadual', 'consideraFeriadoMunicipal', 'zeraValorNegativo'];
    const difP = ks.filter((k) => !mesmoValor(cmp(ger, k), cmp(tela, k))).map((k) => `${k}: gerador ${cmp(ger, k)} × tela ${cmp(tela, k)}`);
    verificar(!difP.length, `P-indices-juros-parametros.PJC: parâmetros do cálculo iguais aos da tela${difP.length ? ` — ${difP.join(' | ')}` : ''}`);
    // a tela recusa prescrição que começaria na admissão ou depois (MSG0081/MSG0082)
    const { validarArvore } = await import('../server/lib/validacao.mjs');
    const presc = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'calculo-referencia.json'), 'utf-8'));
    presc.calculo.prescricaoFgts = true; presc.calculo.prescricaoQuinquenal = true;
    const regras = validarArvore(gerarCalculo(presc).arvore).map((x) => x.regra || x.codigo || x.id);
    verificar(regras.includes('MSG0081') && regras.includes('MSG0082'), `prescrição do FGTS e quinquenal recusadas quando começariam na admissão (${regras.filter((x) => /MSG/.test(x)).join(', ')})`);
  }
  // cartão: escalas 12x12, 12x24, 6x1 e 8x2, critério mais favorável, primeiras horas extras, jornada mensal (gabaritos Q a T)
  for (const [ex, gab] of [['calculo-cartao-escala-12x12.json', 'Q-cartao-escala-12x12.PJC'], ['calculo-cartao-escala-12x24.json', 'R-cartao-escala-12x24.PJC'],
    ['calculo-cartao-escala-6x1-fechamento.json', 'S-cartao-escala-6x1-fechamento.PJC'], ['calculo-cartao-escala-8x2.json', 'T-cartao-escala-8x2.PJC']]) {
    conferirGabarito(ex, gab, ['ApuracaoCartaoDePonto', 'PreenchimentoJornadaApuracaoCartao', ...(/6x1/.test(ex) ? ['ExcecaoDoFechamentoDeCartaoDePonto'] : [])], 'E-cartao-ponto.PJC');
  }
  conferirGabarito('calculo-indices-juros-tr-poupanca.json', 'U-indices-juros-tr-poupanca.PJC', ['ParametrosDeAtualizacao', 'CombinacaoDeIndice', 'CombinacaoDeJuros']);
  conferirGabarito('calculo-parcial-aviso-ferias-minimo.json', 'V-parcial-aviso-ferias-minimo.PJC', ['Ferias']);
  {
    // parâmetros do Calculo mudados na tela nos gabaritos S, V e W (fechamento do cartão, regime, aviso informado)
    const difC = [];
    for (const [ex, gab, ks] of [['calculo-cartao-escala-6x1-fechamento.json', 'S-cartao-escala-6x1-fechamento.PJC', ['diaFechamentoMes']],
      ['calculo-parcial-aviso-ferias-minimo.json', 'V-parcial-aviso-ferias-minimo.PJC', ['regimeDoContrato', 'apuracaoPrazoDoAvisoPrevio', 'prazoAvisoInformado']],
      ['calculo-intermitente.json', 'W-intermitente.PJC', ['regimeDoContrato']]]) {
      const ger = gerarCalculo(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', ex), 'utf-8'))).arvore;
      const tela = gabaritoTela(gab);
      for (const k of ks) if (!mesmoValor(cmp(ger, k), cmp(tela, k))) difC.push(`${gab} ${k}: gerador ${cmp(ger, k)} × tela ${cmp(tela, k)}`);
    }
    verificar(!difC.length, `S, V e W: fechamento do cartão, regime e aviso informado iguais aos da tela${difC.length ? ` — ${difC.join(' | ')}` : ''}`);
    // regras da tela reproduzidas no gerador
    const base = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'calculo-referencia.json'), 'utf-8'));
    const erroGerar = (sp) => { try { gerarCalculo(sp); return ''; } catch (e) { return e.message; } };
    const comEscala = (ciclo) => ({ ...JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'calculo-cartao-escala-8x2.json'), 'utf-8')), apuracaoCartaoPonto: { inicio: '2013-03-01', fim: '2015-04-15', escala: { tipo: 'OITO_DOIS', ciclo } } });
    const d = ['07:00-11:00'];
    verificar(/os últimos 2 dias são folga/.test(erroGerar(comEscala([d, d, d, d, d, d, d, d, d, []]))) && erroGerar(comEscala([d, d, d, d, d, d, d, d, [], []])) === '',
      'escala 8x2: turno num dos 2 dias de folga do fim do ciclo recusado, como a tela (que os bloqueia)');
    const parcial = (adm, dem, faltas = []) => { const sp = base(); Object.assign(sp.calculo, { regime: 'PARCIAL', admissao: adm, demissao: dem }); sp.faltas = faltas; sp.calculo.historicoUltimaRemuneracao = { criar: false }; return [...objetos(gerarCalculo(sp).arvore)].filter((o) => o.$classe === 'Ferias').map((o) => cmp(o, 'prazo')); };
    const pAntes = parcial('2013-03-01', '2015-04-15'); const pFaltas = parcial('2013-03-01', '2015-04-15', [{ inicio: '2013-05-06', fim: '2013-05-15' }]); const pDepois = parcial('2017-12-01', '2019-01-10');
    verificar(pAntes.join() === '18,18' && pFaltas[0] === '9' && pDepois.join() === '30', `tempo parcial: férias de 18 dias (9 com mais de 7 faltas) no período aquisitivo antes da Reforma e 30 depois (${pAntes} / ${pFaltas} / ${pDepois})`);
    const gozos = base(); gozos.ferias = { periodos: [{ relativa: '2013/2014', situacao: 'GOZADAS', abono: true, diasAbono: 10, gozos: [{ inicio: '2015-01-30', fim: '2015-02-28' }] }] };
    verificar(/somam 30 dia\(s\); a tela exige 20/.test(erroGerar(gozos)), 'férias gozadas: os gozos têm de somar o prazo menos os dias de abono, como a tela');
    const comb = base(); comb.correcaoJuros = { indice: 'TR', combinacoesIndice: [{ indice: 'IPCAE', aPartirDe: '2015-01-01' }, { indice: 'IGPM', aPartirDe: '2014-01-01' }] };
    verificar(cmp(cmp(gerarCalculo(comb).arvore, 'parametrosDeAtualizacao') || [...objetos(gerarCalculo(comb).arvore)].find((o) => o.$classe === 'ParametrosDeAtualizacao'), 'outroIndiceTrabalhista') === 'IGPM', 'combinação de índices: o parâmetro guarda a de data mais antiga, como a tela');
    const fech = base(); fech.calculo.fechamentoCartao = { dia: 20, excecoes: [{ de: '2014-01', ate: '2014-06', dia: 32 }] };
    verificar(/dia do fechamento entre 1 e 31/.test(erroGerar(fech)), 'fechamento do cartão: dia fora de 1 a 31 recusado');
  }
  {
    // execução e Cálculo Externo (gabaritos X e Y): IR sobre os juros dos honorários, pensão com base própria, débitos do reclamante
    const arvX = lerPjc(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'calculo-liquidado-referencia.PJC'))).arvore;
    const exX = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'execucao-recolhimentos-honorarios.json'), 'utf-8'));
    montarExecucao(arvX, exX);
    const honX = [...objetos(arvX)].find((o) => o.$classe === 'Honorario' && cmp(o, 'tipoHonorario') === 'PERICIAIS_CONTADOR');
    const semIrrf = JSON.parse(JSON.stringify(exX)); delete semIrrf.honorarios[0].apurarIrrf;
    let erroIrJuros = ''; try { montarExecucao(lerPjc(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'calculo-liquidado-referencia.PJC'))).arvore, semIrrf); } catch (e) { erroIrJuros = e.message; }
    verificar(cmp(honX, 'apurarIRPFSobreJuros') === 'true' && cmp(honX, 'apurarIRRF') === 'true' && /só oferece o IR sobre os juros/.test(erroIrJuros), 'honorários da execução: IR sobre os juros gravado (exige IRRF), como no gabarito X');
    const ry = extrairResumoAtualizacao(rel('RESUMO_PAGAMENTO_EXTERNO_DEBITOS_RECLAMANTE.txt'));
    verificar(ry.totalDevidoPeloReclamado === 13847.67 && ry.conferencia.somaDoSaldo === 13847.67 && ry.totalDevidoPeloReclamante === 858.43 && ry.debitosDoReclamante.length === 3 && ry.pensaoAlimenticia === 1113.26,
      'Resumo da Atualização com débitos do reclamante: o segundo quadro fica fora da soma do reclamado (gabarito Y)');
    const { validarExterno: vExt } = await import('../server/lib/externo.mjs');
    const extY = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'calculo-externo-parcelas.json'), 'utf-8'));
    const erroY = (f) => { const e = JSON.parse(JSON.stringify(extY)); f(e); try { vExt(e); return ''; } catch (x) { return x.message; } };
    verificar(erroY(() => {}) === '' && /marque ao menos uma base/.test(erroY((e) => { e.descontos.pensao = { aliquota: 10 }; })) && /"pensao" ou "pensaoAliquota"/.test(erroY((e) => { e.descontos.pensaoAliquota = 10; })),
      'Cálculo Externo: pensão com alíquota e base própria (juros, principal tributável e não tributável, FGTS); sem base é recusada');
  }
  const errDE = (sd) => { try { gerarCalculo({ ...JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'calculo-referencia.json'), 'utf-8')), correcaoJuros: { contribuicaoSocial: { salariosDevidos: sd } } }); return ''; } catch (e) { return e.message; } };
  verificar(/"multaa" não existe/.test(errDE({ multaa: true })) && /exige "aplicarAte"/.test(errDE({ correcaoTrabalhista: true, correcaoPrevidenciaria: true })), 'Dados Específicos: campo desconhecido recusado; correção trabalhista e previdenciária juntas exigem "aplicarAte", como a tela');
  // juros e multa da contribuição social: corrigido arredondado, juros e multa sem arredondar (só juros previdenciários truncados)
  const arvDE = lerPjc(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'calculo-dados-especificos-liquidado.PJC'))).arvore;
  const csDE = compararComRelatorios(recalcularPjc(arvDE), { resumo: { contribuicaoSocialSalariosDevidos: 5452.80, composicao: [], verbas: [] } }).find((v) => /salários devidos .*= Resumo/.test(v.item));
  verificar(csDE && csDE.estado === 'ok', `contribuição social com juros trabalhistas e multa previdenciária = Resumo do PJe-Calc (5.452,80): ${csDE && csDE.detalhe}`);
  // todas as verbas do Expresso (gabarito N): cada verba e reflexo lançado pela tela sai do gerador com os mesmos
  // parâmetros (as 6 do caso A vêm do gabarito A, feito com a biblioteca anterior, e a base pelo histórico é escolha
  // do gerador quando há um só histórico)
  {
    const nn = (x) => String(x || '').replace(/\s+/g, ' ').trim();
    const IGN = new Set(['id', 'versao', 'ordem', 'calculo', 'ocorrencias', 'historicosDaVerbaDoValorDevido']);
    const plano = (o, pre = '') => {
      const r = {};
      for (const [k, v] of o.campos) {
        if (IGN.has(k)) continue;
        if (v === null || typeof v !== 'object') r[pre + k] = nn(v);
        else if (v.$classe && !pre) Object.assign(r, plano(v, `${k}.`));
        else if (v.$colecao) r[pre + k] = `[${its(v).length}]`;
      }
      return r;
    };
    const verbasDe = (arv) => new Map([...objetos(arv)].filter((o) => ['Calculada', 'Informada', 'Reflexo'].includes(o.$classe)).map((o) => [nn(cmp(o, 'nome')), plano(o)]));
    const doA = verbasDe(gabaritoTela('A-referencia.PJC'));
    const telaN = verbasDe(lerPjc(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'gabarito-N-verbas-expresso.PJC'))).arvore);
    const gerN = verbasDe(gerarCalculo(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'exemplos', 'calculo-verbas-expresso.json'), 'utf-8'))).arvore);
    const difN = []; let nN = 0;
    for (const [nome, t] of telaN) {
      if (doA.has(nome) || nome === 'VALE TRANSPORTE') continue;
      const g = gerN.get(nome);
      if (!g) { difN.push(`${nome}: ausente no gerador`); continue; }
      nN++;
      for (const k of new Set([...Object.keys(t), ...Object.keys(g)])) if (!mesmoValor(t[k], g[k])) difN.push(`${nome}.${k}: tela ${t[k]} × gerador ${g[k]}`);
    }
    verificar(nN >= 150 && !difN.length, `gabarito N (Expresso inteiro lançado na tela): ${nN} verbas e reflexos do Expresso com os mesmos parâmetros da tela${difN.length ? ` — ${difN.slice(0, 8).join(' | ')}` : ''}`);
  }
  const { motivoBibliotecaDesatualizada } = await import('../server/lib/servico-calculo.mjs');
  verificar(motivoBibliotecaDesatualizada(null, 'm1', null) && motivoBibliotecaDesatualizada({ modelo: 'm0', conferidaEm: '2026-10-01' }, 'm1', null)
    && motivoBibliotecaDesatualizada({ modelo: 'm1', conferidaEm: '2026-10-01T10:00:00Z' }, 'm1', '2026-10-02T10:00:00Z') && motivoBibliotecaDesatualizada({ modelo: 'm1', conferidaEm: '2026-10-02T11:00:00Z' }, 'm1', '2026-10-02T10:00:00Z') === null,
    'biblioteca de verbas refeita na primeira vez em cada PJe-Calc e depois de cada sincronização de tabelas que trouxe tabelas novas');
  // IR cobrado do reclamado: o Resumo traz "IRPF DEVIDO PELO RECLAMADO" entre os débitos do reclamado
  const { D: Dec } = await import('../server/lib/decimal.mjs');
  const recIrRdo = { verbas: [], fgts: {}, inss: {}, honorarios: [], custas: {}, irpf: { ocorrencias: [{}], devido: Dec('2776.68'), cobrarDoReclamado: true } };
  const irRdo = compararComRelatorios(recIrRdo, { resumo: { verbas: [], composicao: [{ descricao: 'IRPF DEVIDO PELO RECLAMADO', valor: 2776.68 }] } }).find((v) => /IRPF/.test(v.item));
  verificar(irRdo && irRdo.estado === 'ok' && /reclamado/.test(irRdo.item), `IR cobrado do reclamado conferido na linha de débito do reclamado (${irRdo && irRdo.detalhe})`);

  // 21) ponte com o AuditorProcessual: dois downloads dos mesmos autos do PJe (o segundo mais completo e com outra
  // numeração de folhas), página escaneada só com o rodapé, livro-razão, eventos e revisão com fatos (fixture sintética)
  console.log('21) leitura do AuditorProcessual importada como sugestão');
  {
    const F = path.resolve(__dirname, 'fixtures', 'auditor');
    const r = await c.ferramenta('auditor_importar', { pastas: [path.join(F, 'autos-download-1'), path.join(F, 'autos-download-2')], ledger: path.join(F, 'labor_ledger.json'), eventos: path.join(F, 'labor_events.json'), revisao: path.join(F, 'revisao.json'), numero_processo: '0001234-45.2015.5.08.0001' });
    const docs = r.sugestao.contrato.documentos; const ct = r.sugestao.contrato;
    verificar(docs.map((d) => `${d.tipo}:${d.paginas}`).join(' ') === 'A_CLASSIFICAR:1 PETICAO_INICIAL:2-3 A_CLASSIFICAR:4 SENTENCA:5 ACORDAO:6-7' && docs.filter((d) => d._auditor.tambemEm).length === 3,
      `documentos pelo id do PJe nos dois formatos de rodapé, repetidos entre downloads uma vez só, folhas do arquivo mais completo e título lido primeiro (sentença que cita a contestação): ${docs.map((d) => `${d.tipo} ${d.paginas}`).join('; ')}`);
    verificar(ct.leitura.find((l) => l.documento === 'D3').lidaComoImagem === '4' && r.alertas.some((a) => /têm só o rodapé de assinatura/.test(a)),
      'página escaneada com o rodapé do PJe (que o AuditorProcessual conta como texto) marcada para leitura como imagem');
    verificar(r.sugestao.processoPrincipal === '0001234-45.2015.5.08.0001' && r.verificacoes.some((x) => x.item === 'número do processo' && x.estado === 'alerta' && /0009999-11.2018/.test(x.detalhe)),
      'número do processo pelo mais citado; o escolhido pelo AuditorProcessual (um precedente citado) vira alerta');
    verificar(ct.remuneracoes[0].valor === 1700 && ct.remuneracoes[0].documento === 'D3' && ct.remuneracoes[0].folha === '4' && ct.pagamentos[0].valor === 120.5 && !ct.pagamentos.some((p) => p.valor === 300)
      && r.alertas.some((a) => /"due"/.test(a)), 'folha do livro-razão: salário e pagamento ligados ao documento e à folha pelos fatos da revisão; o "devido" estimado fica fora');
    verificar(r.sugestao.apuracaoCartaoPonto.jornadas.length === 2 && r.sugestao.apuracaoCartaoPonto.jornadas[0].turnos[1].saida === '19:00' && r.alertas.some((a) => /relato do cliente/.test(a)),
      'jornada do livro-razão nas jornadas do cartão, com o dia vindo só do relato do cliente apontado');
    verificar(ct.afastamentos.length === 1 && ct.afastamentos[0].inicio === '2014-05-01' && r.sugestao.calculo.admissao === '2013-03-01' && r.sugestao.calculo.demissao === '2015-04-15' && r.alertas.some((a) => /EV-4.*desconhecida/.test(a)),
      'eventos: afastamento, admissão e demissão com data exata; data desconhecida não vira dia inventado');
  }

  console.log('\nTODOS OS TESTES OFFLINE PASSARAM');
} catch (e) {
  console.error(`\n${e.message}`);
  if (c.stderr.length) console.error(c.stderr.join(''));
  process.exitCode = 1;
} finally {
  c.fechar();
}
