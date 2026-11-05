// pjecalc-mcp-skill · lib/auditor.mjs
// Ponte com o AuditorProcessual (https://github.com/lucianumm/AuditorProcessual): lê a pasta de saída da
// ingestão dele (manifest.json, pages.jsonl, recovery_findings.json) e, quando houver, o livro-razão da jornada e
// da folha (labor_ledger), os eventos do contrato (labor_events) e a revisão com os fatos (página e trecho), e
// devolve SUGESTÕES para a especificação: contrato.documentos, contrato.leitura, processos citados, jornadas,
// remunerações, pagamentos, afastamentos e datas do contrato. Nada é aceito sem a leitura do agente: a ingestão
// do AuditorProcessual é mecânica (texto, qualidade e peças por página) e os arquivos trabalhistas são escritos
// por quem leu os autos.
//
// Autos do PJe: cada página traz o rodapé de assinatura com o id do documento e as folhas. A ponte separa os
// documentos por esse id (o mesmo documento em dois arquivos aparece uma vez), usa as folhas nas citações e
// desconta o rodapé ao decidir se a página tem texto: página só com o rodapé é escaneada e precisa ser vista
// como imagem.

import fs from 'node:fs';
import path from 'node:path';
import { tipoProvavel, cartoesParaJornadas } from './conversores.mjs';

const CNJ = /\b\d{7}-?\d{2}\.?\d{4}\.?5\.?\d{2}\.?\d{4}\b/g;
const v = (item, estado, detalhe) => ({ item, estado, detalhe });
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const faixa = (ns) => { const s = [...new Set(ns)].sort((a, b) => a - b); const out = []; for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`); i = j; } return out.join(', '); };
const cnjCanonico = (n) => { const d = String(n).replace(/\D/g, ''); return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}` : String(n); };
const MIN_TEXTO = 40; // caracteres próprios (sem o rodapé) para a página contar como texto

// peças do AuditorProcessual -> tipo do contrato quando nem o título nem o classificador decidem
const PECAS = {
  'PETICAO INICIAL': 'PETICAO_INICIAL', 'EMENDA A INICIAL': 'PETICAO_INICIAL', SENTENCA: 'SENTENCA', ACORDAO: 'ACORDAO',
  DECISAO: 'DECISAO', DESPACHO: 'DECISAO', 'LAUDO/PERICIA': 'LAUDO', CERTIDAO: 'CERTIDAO', CONTESTACAO: 'CONTESTACAO',
  RECURSO: 'RECURSO', CONTRARRAZOES: 'CONTRARRAZOES', REPLICA: 'REPLICA', PROCURACAO: 'PROCURACAO',
};
// títulos que decidem o tipo antes do classificador geral (que vê "reclamação trabalhista" numa contestação);
// vale o que aparece primeiro, porque o relatório de uma sentença cita a contestação e vice-versa
const TITULOS = [
  ['CONTESTACAO', /\bCONTESTA(CAO|R)\b|APRESENTAR (A SUA |SUA )?DEFESA/],
  ['ACORDAO', /\bACORDAO\b|\bEMENTA\b|PROCESSO TRT\b|\bRELATOR ?:/],
  ['SENTENCA', /\bSENTENCA\b/],
  ['RECURSO_ORDINARIO', /RECURSO ORDINARIO/],
  ['ATA_DE_AUDIENCIA', /ATA DE AUDIENCIA/],
];
const RE_EMBARGOS = /EMBARGOS DE DECLARACAO|CONHECO DOS EMBARGOS|EMBARGOS DECLARATORIOS/;

// rodapé dos autos do PJe, nas duas instâncias:
//   "Documento assinado eletronicamente por NOME, em 19/08/2025, às 18:53:31 - e518b94" ... "Fls.: 14"
//   "Assinado eletronicamente por: NOME - 20/05/2026 16:14:32 - 46dd667" "ID. 46dd667 - Pág. 1" "Fls.: 110"
const RE_ASSINATURA = [
  /Documento assinado eletronicamente por (.+?), em (\d{2}\/\d{2}\/\d{4})[^\n]*?-\s*([0-9a-f]{7})\b/i,
  /Assinado eletronicamente por:\s*(.+?)\s*-\s*(\d{2}\/\d{2}\/\d{4})[^\n]*?-\s*([0-9a-f]{7})\b/i,
];
const RE_FOLHA = /\bFls\.?:\s*(\d+)/i;
const RE_RODAPE = /(Documento assinado eletronicamente por|N[úu]mero do processo:|N[úu]mero do documento:|Assinado eletronicamente por:)[\s\S]*$/i;
function carimboPje(texto) {
  const t = String(texto || '');
  let a = null;
  for (const re of RE_ASSINATURA) { a = re.exec(t); if (a) break; }
  const f = RE_FOLHA.exec(t.slice(-400));
  return { idPje: a ? a[3].toLowerCase() : null, assinadoPor: a ? a[1].trim() : null, data: a ? a[2] : null, folha: f ? Number(f[1]) : null };
}
const semRodape = (t) => String(t || '').replace(RE_RODAPE, '').replace(RE_FOLHA, '').trim();

function lerJson(arq, rotulo) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf-8')); } catch (e) { throw new Error(`${rotulo}: não consegui ler ${arq} (${e.message}).`); }
}
function lerJsonl(arq) {
  return fs.readFileSync(arq, 'utf-8').split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch (e) { throw new Error(`${path.basename(arq)}, linha ${i + 1}: ${e.message}`); } });
}

/** Fatos da revisão do AuditorProcessual: qualquer objeto com id e página (pdf_page/page) vira { pagina, folha, trecho, sha256 }. */
function indiceDeFatos(revisao) {
  const fatos = new Map();
  const visitar = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(visitar); return; }
    const pag = o.pdf_page ?? o.page ?? (Array.isArray(o.pdf_pages) ? o.pdf_pages[0] : null);
    if (typeof o.id === 'string' && pag != null && !fatos.has(o.id)) {
      fatos.set(o.id, { pagina: Number(pag), folha: o.court_page ?? null, trecho: o.quote ?? o.excerpt ?? o.text ?? null, sha256: o.source_sha256 ?? o.sha256 ?? null });
    }
    for (const x of Object.values(o)) if (x && typeof x === 'object') visitar(x);
  };
  visitar(revisao);
  return fatos;
}

/** "2026-06-01T09:00:00-03:00" ou "09:00" -> "09:00" (horário de parede do local de trabalho, como escrito). */
function horaDe(s) {
  const m = /T?(\d{2}):(\d{2})/.exec(String(s ?? ''));
  if (!m) throw new Error(`horário inválido "${s}"`);
  return `${m[1]}:${m[2]}`;
}

function tipoDoDocumento(textos, rotulo) {
  const inicio = norm(semRodape(textos.find((t) => semRodape(t).length >= MIN_TEXTO) || '').slice(0, 3000));
  let tipo = null; let pos = Infinity;
  for (const [t, re] of TITULOS) { const m = re.exec(inicio); if (m && m.index < pos) { tipo = t; pos = m.index; } }
  // decisão de embargos de declaração: a vara a intitula "sentença"
  if (tipo === 'SENTENCA' && RE_EMBARGOS.test(inicio.slice(0, 1500))) tipo = 'EMBARGOS_DE_DECLARACAO';
  return tipo || tipoProvavel(inicio) || (rotulo && PECAS[norm(rotulo)]) || 'A_CLASSIFICAR';
}

/** Blocos (documentos) de um arquivo: pelo id do PJe quando as páginas têm o rodapé; senão, pelas peças do AuditorProcessual. */
function blocosDoArquivo(manifesto, paginas, fonte, verificacoes) {
  const porPagina = new Map(paginas.map((p) => [Number(p.pdf_page), p]));
  const carimbos = paginas.map((p) => ({ pagina: Number(p.pdf_page), ...carimboPje(p.text) })).sort((a, b) => a.pagina - b.pagina);
  const comCarimbo = carimbos.filter((c) => c.idPje).length;
  let pecas;
  if (comCarimbo >= carimbos.length * 0.8) {
    pecas = [];
    for (const c of carimbos) {
      const ult = pecas[pecas.length - 1];
      if (ult && (!c.idPje || ult.idPje === c.idPje)) {
        ult.fim = c.pagina; if (c.folha != null) ult.folhaFim = c.folha; if (c.idPje) ult.confirmadas++;
        continue;
      }
      const pg = porPagina.get(c.pagina);
      pecas.push({ idPje: c.idPje, rotulo: pg && pg.piece, assinadoPor: c.assinadoPor, data: c.data, ini: c.pagina, fim: c.pagina, folhaIni: c.folha, folhaFim: c.folha, confirmadas: c.idPje ? 1 : 0 });
    }
    verificacoes.push(v(`documentos de ${fonte.name}`, 'ok', `${pecas.length} documento(s) separados pelo rodapé de assinatura do PJe (id do documento e folhas) em ${carimbos.length} página(s)`));
  } else {
    const ps = (manifesto.pieces && manifesto.pieces.length) ? manifesto.pieces : [{ id: 'P001', piece: null, pdf_page_start: 1, pdf_page_end: fonte.pages || paginas.length }];
    pecas = ps.map((p) => ({ peca: p.id, rotulo: p.piece, data: p.date || null, ini: Number(p.pdf_page_start), fim: Number(p.pdf_page_end ?? p.pdf_page_start), folhaIni: p.court_page_start ?? null, folhaFim: p.court_page_end ?? null, confirmadas: 0 }));
    verificacoes.push(v(`documentos de ${fonte.name}`, 'alerta', `sem o rodapé do PJe em ${carimbos.length - comCarimbo} de ${carimbos.length} página(s): ${pecas.length} peça(s) pela segmentação do AuditorProcessual, que erra limites e rótulos com frequência; confira cada uma`));
  }
  for (const pc of pecas) {
    pc.textos = []; pc.semTexto = []; pc.falhas = [];
    for (let k = pc.ini; k <= pc.fim; k++) {
      const p = porPagina.get(k);
      if (!p) { pc.falhas.push(k); continue; }
      pc.textos.push(p.text || '');
      if (p.status === 'FAILED') pc.falhas.push(k);
      else if (p.source !== 'native_text' || p.quality === 'low' || semRodape(p.text).length < MIN_TEXTO) pc.semTexto.push(k);
    }
    if (pc.rotulo === 'Não identificado') pc.rotulo = null;
  }
  return { pecas, carimbos };
}

/**
 * pastas: saídas de ingest_document.py (uma por arquivo). ledger/eventos/revisao: arquivos JSON opcionais
 * (labor_ledger, labor_events e a revisão com fatos). processo: id em contrato.processos; numeroProcesso: CNJ esperado.
 */
export function importarAuditor({ pastas = [], ledger = null, eventos = null, revisao = null, processo = null, numeroProcesso = null, prefixo = 'D' } = {}) {
  if (!pastas.length) throw new Error('Informe "pastas": as pastas de saída do ingest_document.py do AuditorProcessual (uma por arquivo).');
  const verificacoes = []; const alertas = [];
  const contagemCnj = new Map(); const escolhidosPeloAuditor = new Set();
  const arquivos = [];
  for (const pasta of pastas) {
    const dir = path.resolve(pasta);
    const manifesto = lerJson(path.join(dir, 'manifest.json'), 'manifest.json');
    const fonte = manifesto.source || {};
    const paginas = lerJsonl(path.join(dir, 'pages.jsonl'));
    if (!fonte.sha256 || !paginas.length) throw new Error(`${dir}: saída do AuditorProcessual incompleta (sem source.sha256 ou páginas).`);
    if (manifesto.process_id) escolhidosPeloAuditor.add(cnjCanonico(manifesto.process_id));
    for (const p of paginas) for (const m of String(p.text || '').matchAll(CNJ)) { const c = cnjCanonico(m[0]); contagemCnj.set(c, (contagemCnj.get(c) || 0) + 1); }
    const cob = manifesto.coverage || {};
    if (cob.pages_total != null && cob.pages_processed !== cob.pages_total) verificacoes.push(v(`páginas processadas em ${fonte.name}`, 'falha', `${cob.pages_processed} de ${cob.pages_total}: rode a ingestão de novo até cobrir todas`));
    const { pecas, carimbos } = blocosDoArquivo(manifesto, paginas, fonte, verificacoes);
    arquivos.push({ fonte, pecas, carimbos });
    // o AuditorProcessual conta o rodapé do PJe como texto: página escaneada sai como "native_text"
    const disfarcadas = pecas.flatMap((pc) => pc.semTexto.filter((k) => { const p = paginas.find((x) => Number(x.pdf_page) === k); return p && p.source === 'native_text' && p.quality !== 'low'; }));
    if (disfarcadas.length) alertas.push(`${fonte.name}: ${disfarcadas.length} página(s) que o AuditorProcessual marcou como texto nativo têm só o rodapé de assinatura (${faixa(disfarcadas)}): são imagens escaneadas (holerites, cartões, TRCT, atestados...). Veja-as como imagem (documento_imagens) ou rode a ingestão com --ocr.`);
    const arqRec = path.join(dir, 'recovery_findings.json');
    if (fs.existsSync(arqRec)) {
      const abertas = (lerJson(arqRec, 'recovery_findings.json').findings || []).filter((f) => f.status === 'open');
      if (abertas.length) {
        const porCodigo = {}; for (const f of abertas) porCodigo[f.code] = (porCodigo[f.code] || 0) + 1;
        alertas.push(`${fonte.name}: ${abertas.length} pendência(s) abertas no AuditorProcessual (${Object.entries(porCodigo).map(([k, q]) => `${k} ${q}`).join(', ')}).`);
      }
    }
  }
  // documentos: o mesmo id do PJe em dois arquivos (autos baixados de novo, cópia parcial) entra uma vez. Vale o
  // arquivo mais completo, porque cada download numera as folhas a seu modo; os outros só acrescentam o que faltar
  const porCompletude = [...arquivos].sort((x, y) => y.pecas.length - x.pecas.length || y.carimbos.length - x.carimbos.length);
  if (porCompletude.length > 1 && arquivos.some((a) => a.pecas.some((pc) => pc.idPje))) alertas.push(`Folhas pelo arquivo mais completo (${porCompletude[0].fonte.name}): cada download dos autos numera as folhas a seu modo; cite sempre as folhas desse arquivo.`);
  const escolha = new Map(); const ordem = [];
  for (const a of porCompletude) for (const pc of a.pecas) {
    const chave = pc.idPje || `${a.fonte.sha256}:${pc.ini}`;
    const atual = escolha.get(chave);
    if (!atual) { escolha.set(chave, { a, pc, tambem: [] }); ordem.push(chave); continue; }
    atual.tambem.push(`${a.fonte.name}, páginas ${pc.ini}-${pc.fim}`);
  }
  const documentos = []; const leitura = []; const idDoBloco = new Map();
  for (const [i, chave] of ordem.entries()) {
    const { a, pc, tambem } = escolha.get(chave);
    const id = `${prefixo}${i + 1}`;
    idDoBloco.set(chave, id);
    const paginasTxt = pc.ini === pc.fim ? `${pc.ini}` : `${pc.ini}-${pc.fim}`;
    const folhas = pc.folhaIni != null ? (pc.folhaFim != null && pc.folhaFim !== pc.folhaIni ? `${pc.folhaIni}-${pc.folhaFim}` : `${pc.folhaIni}`) : null;
    documentos.push({
      id, ...(processo ? { processo } : {}), tipo: tipoDoDocumento(pc.textos, pc.rotulo),
      identificacao: `${a.fonte.name}, páginas ${paginasTxt}${pc.idPje ? `, ID ${pc.idPje}` : ''}${pc.assinadoPor ? `, assinado por ${pc.assinadoPor}` : ''}`,
      paginas: folhas || paginasTxt, ...(pc.data ? { data: pc.data } : {}), sha256: a.fonte.sha256,
      _auditor: { arquivo: a.fonte.name, paginasDoPdf: paginasTxt, ...(pc.rotulo ? { rotulo: pc.rotulo } : {}), ...(pc.idPje ? { idPje: pc.idPje } : {}), ...(tambem.length ? { tambemEm: tambem } : {}) },
      _paginas: folhas ? '"paginas" são as folhas dos autos (rodapé do PJe)' : 'páginas do PDF: os autos não trazem folhas; troque pelas folhas se o documento as citar',
    });
    const conv = (ks) => {
      if (!folhas) return faixa(ks);
      return faixa(ks.map((k) => { const c = a.carimbos.find((x) => x.pagina === k); return c && c.folha != null ? c.folha : k; }));
    };
    leitura.push({
      documento: id, classificacao: { usadas: '', irrelevantes: [], ilegiveis: pc.falhas.length ? [{ folhas: conv(pc.falhas), motivo: 'falha na extração do AuditorProcessual: veja a página como imagem ou peça cópia legível' }] : [] },
      ...(pc.semTexto.length ? { lidaComoImagem: conv(pc.semTexto) } : {}),
      _instrucao: 'leia todas as páginas e classifique cada uma em usadas, irrelevantes (com motivo) ou ilegiveis (com pedido em contrato.coleta)',
    });
  }
  const repetidos = documentos.filter((d) => d._auditor.tambemEm).length;
  if (repetidos) verificacoes.push(v('documentos repetidos entre os arquivos', 'ok', `${repetidos} documento(s) aparecem em mais de um arquivo (mesmo id do PJe) e entram uma vez`));
  const aClassificar = documentos.filter((d) => d.tipo === 'A_CLASSIFICAR').length;
  if (aClassificar) alertas.push(`${aClassificar} documento(s) sem tipo (em geral escaneados, sem texto próprio): veja a primeira página como imagem e informe o tipo (holerites, cartões de ponto, TRCT, extrato do FGTS...).`);
  // número do processo: o mais citado, comparado com o que o AuditorProcessual escolheu
  const citados = [...contagemCnj.entries()].sort((a, b) => b[1] - a[1]).map(([numero, vezes]) => ({ numero, vezes }));
  const maisCitado = citados[0] ? citados[0].numero : null;
  const esperado = numeroProcesso ? cnjCanonico(numeroProcesso) : null;
  if (maisCitado) {
    const divergentes = [...escolhidosPeloAuditor].filter((x) => x !== (esperado || maisCitado));
    verificacoes.push(v('número do processo', divergentes.length ? 'alerta' : 'ok',
      divergentes.length ? `o AuditorProcessual identificou ${divergentes.join(', ')}, mas o número mais citado nos autos é ${maisCitado} (${citados[0].vezes} vezes)${esperado && esperado !== maisCitado ? ` e o informado é ${esperado}` : ''}: confira antes de usar` : `${esperado || maisCitado} (${citados[0].vezes} citações)`));
  }
  const outros = citados.filter((c) => c.numero !== (esperado || maisCitado));
  if (outros.length) alertas.push(`Números de processo citados além do principal: ${outros.map((c) => `${c.numero} (${c.vezes}×)`).join(', ')}. Cada um precisa estar em contrato.processos (relação e efeito no cálculo) ou ser descartado com motivo (precedente citado, processo de outra pessoa).`);

  // fatos -> documento e folha
  const fatos = revisao ? indiceDeFatos(lerJson(path.resolve(revisao), 'revisão')) : new Map();
  const origemDe = (ids, ctx) => {
    const f = (ids || []).map((id) => fatos.get(id)).find(Boolean);
    if (!f) return { _origem: { fatos: ids || [], aviso: `${ctx}: sem página nos fatos informados; aponte documento, folha e trecho` } };
    let documento = null; let folha = f.folha;
    for (const a of arquivos) {
      if (f.sha256 && a.fonte.sha256 !== f.sha256) continue;
      const pc = a.pecas.find((x) => f.pagina >= x.ini && f.pagina <= x.fim);
      if (!pc) continue;
      documento = idDoBloco.get(pc.idPje || `${a.fonte.sha256}:${pc.ini}`) || null;
      const c = a.carimbos.find((x) => x.pagina === f.pagina);
      folha = folha ?? (c && c.folha) ?? null;
      break;
    }
    return { documento, folha: folha != null ? String(folha) : `p. ${f.pagina} do PDF`, ...(f.trecho ? { trecho: String(f.trecho).slice(0, 300) } : {}), _origem: { fatos: ids } };
  };

  const sugestao = { contrato: { documentos, leitura }, processoPrincipal: esperado || maisCitado, processosCitados: citados };
  // livro-razão: jornadas, remunerações e pagamentos
  if (ledger) {
    const lv = lerJson(path.resolve(ledger), 'labor_ledger');
    const dias = []; const doCliente = [];
    for (const d of lv.days || []) {
      if ((d.day_status === 'worked' || d.day_status === 'rest_day_worked') && (d.intervals || []).length) {
        dias.push({ data: d.date, turnos: d.intervals.map((t) => ({ entrada: horaDe(t.start), saida: horaDe(t.end) })) });
      } else if (d.day_status === 'leave' || d.day_status === 'rest') dias.push({ data: d.date, ocorrencia: d.day_status === 'leave' ? 'FALTA' : 'FOLGA' });
      if (d.origin === 'client') doCliente.push(d.date);
    }
    if (dias.length) {
      const datas = dias.map((d) => d.data).sort();
      const conv = cartoesParaJornadas({ dias, periodo: { inicio: datas[0], fim: datas[datas.length - 1] } });
      sugestao.apuracaoCartaoPonto = conv.apuracaoCartaoPonto;
      verificacoes.push(...conv.verificacoes.map((x) => ({ ...x, item: `jornada do livro-razão: ${x.item}` })));
      if (doCliente.length) alertas.push(`${doCliente.length} dia(s) da jornada vêm só do relato do cliente (origin "client"), não de documento: entram como premissa, com a prova a produzir, nunca como cartão de ponto.`);
    }
    const remuneracoes = []; const pagamentos = [];
    for (const [i, r] of (lv.payroll || []).entries()) {
      const base = { ...origemDe(r.fact_ids, `payroll[${i}]`) };
      if (r.origin === 'client') base.premissas = ['valor informado pelo cliente, sem documento'];
      if (r.kind === 'salary_parameter') remuneracoes.push({ id: `R${remuneracoes.length + 1}`, componente: r.rubric, de: r.competence, ate: r.competence, valor: Number(r.amount), ...base });
      else if (r.kind === 'payment' || r.kind === 'payment_confirmation') pagamentos.push({ id: `PG${pagamentos.length + 1}`, titulo: r.rubric, competencia: r.competence, valor: Number(r.amount), ...base });
    }
    if (remuneracoes.length) sugestao.contrato.remuneracoes = remuneracoes;
    if (pagamentos.length) sugestao.contrato.pagamentos = pagamentos;
    const devidos = (lv.payroll || []).filter((r) => r.kind === 'due').length;
    if (devidos) alertas.push(`${devidos} lançamento(s) "due" do livro-razão (valor que seria devido) não entram no cálculo: no PJe-Calc, o devido sai das verbas e da base; use-os só para comparar com o resultado.`);
  }
  // eventos: afastamentos e datas do contrato
  if (eventos) {
    const ev = lerJson(path.resolve(eventos), 'labor_events');
    const afastamentos = []; const datas = {};
    for (const e of ev.events || []) {
      const h = e.happened || {};
      if (e.kind === 'leave') afastamentos.push({ id: `A${afastamentos.length + 1}`, tipo: 'AFASTAMENTO', inicio: h.value, fim: h.end ?? h.value, motivo: e.description, trecho: e.quote, premissas: [`evento do AuditorProcessual (${e.id}), precisão ${h.precision}: defina natureza, documento, folha e efeito`] });
      if ((e.kind === 'hiring' || e.kind === 'termination') && h.precision === 'exact' && h.value) datas[e.kind === 'hiring' ? 'admissao' : 'demissao'] = h.value;
      if (h.precision && h.precision !== 'exact') alertas.push(`evento ${e.id} (${e.kind}) com data ${h.precision === 'unknown' ? 'desconhecida' : `aproximada (${h.precision})`}: não invente o dia; peça o documento ou registre a premissa.`);
    }
    if (afastamentos.length) sugestao.contrato.afastamentos = afastamentos;
    if (Object.keys(datas).length) sugestao.calculo = datas;
  }
  return {
    sugestao, verificacoes, alertas,
    lembrete: 'Sugestões, não leitura: o AuditorProcessual extrai o texto e separa as peças; quem lê cada página, confere com a imagem e decide o que entra no cálculo é o agente. Copie para a especificação só o que conferiu e complete natureza, decisão e efeito dos eventos.',
  };
}
