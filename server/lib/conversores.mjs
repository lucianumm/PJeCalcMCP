// pjecalc-mcp-skill · lib/conversores.mjs
// Ferramentas de leitura e conversão (Parte B). Organizam e conferem o que o agente leu; NÃO substituem a
// leitura de cada página.
//
//   inventarioDocumentos   -> arquivos e páginas, hash, páginas com e sem texto, tipo provável, números de
//                             processo citados; pré-preenche contrato.documentos e contrato.leitura
//   textoDocumento         -> texto por página dos PDFs (página sem texto = ver como imagem)
//   imagensDocumento       -> imagens das páginas escaneadas em arquivos, para o agente ver
//   holeritesParaHistoricos-> transcrição dos holerites -> historicosSalariais e contrato.remuneracoes, com
//                             fechamento (proventos − descontos = líquido) e meses faltantes
//   cartoesParaJornadas    -> marcações -> apuracaoCartaoPonto.jornadas, com dia faltante, horário invariável,
//                             marcação impossível e interjornada
//   extratoParaFgts        -> extrato do FGTS -> fgts.operacoes, com soma × saldo e competências sem depósito
//   trctParaPagamentos     -> campos do TRCT -> contrato.pagamentos, com a soma dos campos × totais

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { lerPdf, extrairImagens } from './pdf.mjs';
import { CATEGORIAS } from './documentos.mjs';

const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/^R\$\s*/, '');
  const t = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`valor inválido: ${JSON.stringify(v)}`);
  return n;
};
const comp = (v) => {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[2]}-${m[1]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2]}`;
  throw new Error(`competência inválida "${v}" (AAAA-MM)`);
};
const dataIso = (v) => {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw new Error(`data inválida "${v}" (AAAA-MM-DD)`);
};
const meses = (de, ate) => { const out = []; let [y, m] = de.split('-').map(Number); const [y2, m2] = ate.split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } if (out.length > 1200) break; } return out; };
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const faixa = (ns) => { const s = [...new Set(ns)].sort((a, b) => a - b); const out = []; for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`); i = j; } return out.join(', '); };
const v = (item, estado, detalhe) => ({ item, estado, detalhe });

// ---------------------------------------------------------------------------
// Inventário e texto
// ---------------------------------------------------------------------------

const CNJ = /\b\d{7}-?\d{2}\.?\d{4}\.?5\.?\d{2}\.?\d{4}\b/g;
export function tipoProvavel(texto) {
  const t = norm(texto).slice(0, 6000);
  const ordem = ['SENTENCA', 'DECISOES_POSTERIORES', 'PETICAO_INICIAL', 'RESCISAO', 'SALARIOS', 'JORNADA', 'FGTS', 'FERIAS', 'DECIMO', 'REGISTRO', 'CCT', 'TERMO_ACORDO', 'GUIA_JUDICIAL', 'CALCULO_HOMOLOGADO', 'CNIS'];
  for (const k of ordem) if (CATEGORIAS[k] && CATEGORIAS[k].re.test(t)) return k;
  return null;
}
function dimensoesImagem(buf) {
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return { formato: 'PNG', largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marca = buf[i + 1]; const tam = buf.readUInt16BE(i + 2);
      if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) return { formato: 'JPEG', altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
      i += 2 + tam;
    }
    return { formato: 'JPEG' };
  }
  if (buf.subarray(0, 4).toString('latin1') === 'II*\u0000' || buf.subarray(0, 4).toString('latin1') === 'MM\u0000*') return { formato: 'TIFF' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { formato: 'WEBP' };
  return null;
}

/** Arquivos (lista de caminhos ou uma pasta) -> inventário + sugestão de contrato.documentos e contrato.leitura. */
export function inventarioDocumentos({ arquivos = [], pasta = null, processo = null, prefixo = 'D' } = {}) {
  let lista = [...arquivos];
  if (pasta) for (const n of fs.readdirSync(pasta)) { const p = path.join(pasta, n); if (fs.statSync(p).isFile()) lista.push(p); }
  lista = lista.map((x) => path.resolve(x));
  if (!lista.length) throw new Error('Informe "arquivos" ou "pasta".');
  const itens = []; const documentos = []; const leitura = []; const processosCitados = new Set();
  lista.forEach((arq, i) => {
    const buf = fs.readFileSync(arq);
    const id = `${prefixo}${i + 1}`;
    const it = { id, arquivo: arq, nome: path.basename(arq), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      try {
        const pdf = lerPdf(buf, { maxCaracteresPorPagina: 20000 });
        it.tipo = 'PDF'; it.paginas = pdf.totalPaginas; it.criptografado = pdf.criptografado;
        const sem = pdf.paginas.filter((p) => !p.temTexto).map((p) => p.numero);
        it.paginasComTexto = pdf.paginas.filter((p) => p.temTexto).length;
        it.paginasSemTexto = faixa(sem) || null;
        it.paginasComImagem = faixa(pdf.paginas.filter((p) => p.imagens > 0).map((p) => p.numero)) || null;
        const textoTodo = pdf.paginas.map((p) => p.texto || '').join('\n');
        it.tipoProvavel = tipoProvavel(textoTodo);
        it.porPagina = pdf.paginas.map((p) => ({ pagina: p.numero, caracteres: p.caracteres, imagens: p.imagens, tipoProvavel: p.temTexto ? tipoProvavel(p.texto) : null }));
        for (const m of textoTodo.matchAll(CNJ)) processosCitados.add(m[0]);
        if (pdf.avisos.length) it.avisos = pdf.avisos;
      } catch (e) { it.tipo = 'PDF'; it.erro = e.message; }
    } else {
      const img = dimensoesImagem(buf);
      if (img) { it.tipo = 'IMAGEM'; Object.assign(it, img); it.paginas = 1; it.paginasSemTexto = '1'; }
      else if (/\.(txt|csv|md|html?|xml|json)$/i.test(arq)) { const t = buf.toString('utf-8'); it.tipo = 'TEXTO'; it.linhas = t.split('\n').length; it.paginas = 1; it.tipoProvavel = tipoProvavel(t); for (const m of t.matchAll(CNJ)) processosCitados.add(m[0]); }
      else { it.tipo = 'OUTRO'; it.paginas = null; it.aviso = 'formato não lido pelo MCP: abra o arquivo e veja o conteúdo'; }
    }
    itens.push(it);
    documentos.push({ id, ...(processo ? { processo } : {}), tipo: it.tipoProvavel || 'A_CLASSIFICAR', identificacao: it.nome, paginas: it.paginas ? `1-${it.paginas}` : null, sha256: it.sha256, _paginas: 'número da página no arquivo: troque pelas folhas dos autos se o documento citar folhas' });
    leitura.push({ documento: id, classificacao: { usadas: '', irrelevantes: [], ilegiveis: [] }, ...(it.paginasSemTexto ? { lidaComoImagem: it.paginasSemTexto } : {}), _instrucao: 'leia TODAS as páginas (as sem texto, como imagem) e classifique cada uma em usadas, irrelevantes (com motivo) ou ilegiveis (com pedido em contrato.coleta)' });
  });
  return {
    arquivos: itens,
    processosCitados: [...processosCitados],
    sugestao: { documentos, leitura },
    lembrete: 'O inventário não é a leitura. Abra cada página (as sem texto como imagem), extraia com folha e trecho e classifique todas em contrato.leitura. Números de processo citados que não estão no mapa (contrato.processos) precisam ser perguntados ao usuário.',
  };
}

/** Texto por página de um PDF (ou do arquivo de texto). `paginas`: "1-3,7". */
export function textoDocumento({ arquivo, paginas = null, maxCaracteres = 60000 } = {}) {
  const buf = fs.readFileSync(path.resolve(arquivo));
  const so = paginas ? String(paginas).split(/[,;]\s*/).flatMap((p) => { const m = /^(\d+)(?:-(\d+))?$/.exec(p.trim()); if (!m) return []; const a = Number(m[1]); const b = Number(m[2] || m[1]); return Array.from({ length: b - a + 1 }, (_, k) => a + k); }) : null;
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    if (dimensoesImagem(buf)) return { arquivo, tipo: 'IMAGEM', paginas: [{ numero: 1, temTexto: false, texto: '' }], instrucao: 'Imagem: o MCP não faz OCR. Veja a imagem e transcreva.' };
    return { arquivo, tipo: 'TEXTO', paginas: [{ numero: 1, temTexto: true, texto: buf.toString('utf-8').slice(0, maxCaracteres) }] };
  }
  const pdf = lerPdf(buf, { paginas: so });
  let total = 0; const out = [];
  for (const p of pdf.paginas) {
    if (so && !so.includes(p.numero)) continue;
    const resto = Math.max(0, maxCaracteres - total);
    const texto = (p.texto || '').slice(0, resto);
    total += texto.length;
    out.push({ numero: p.numero, temTexto: p.temTexto, imagens: p.imagens, caracteres: p.caracteres, texto, ...(p.temTexto ? {} : { instrucao: 'página sem texto próprio (escaneada; o carimbo do PJe não conta): veja como imagem com documento_imagens' }) });
  }
  return { arquivo, tipo: 'PDF', totalPaginas: pdf.totalPaginas, criptografado: pdf.criptografado, paginas: out, cortado: total >= maxCaracteres, avisos: pdf.avisos, lembrete: 'Texto extraído do PDF (pode sair fora da ordem visual das colunas). Confira os números na página antes de usar.' };
}

/** Imagens das páginas (escaneadas) de um PDF, gravadas em arquivos para o agente ver como imagem. */
export function imagensDocumento({ arquivo, paginas = null, destino = null } = {}) {
  const buf = fs.readFileSync(path.resolve(arquivo));
  const so = paginas ? String(paginas).split(/[,;]\s*/).flatMap((p) => { const m = /^(\d+)(?:-(\d+))?$/.exec(p.trim()); if (!m) return []; const a = Number(m[1]); const b = Number(m[2] || m[1]); return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i); }) : null;
  const pasta = destino ? path.resolve(destino) : path.join(path.dirname(path.resolve(arquivo)), `${path.basename(arquivo, path.extname(arquivo))}-paginas`);
  const r = extrairImagens(buf, { paginas: so, destino: pasta });
  return { arquivo, ...r, lembrete: 'Abra o arquivo "principal" de cada página e leia-o como imagem (o MCP não faz OCR). Transcreva com a folha e classifique a página em contrato.leitura (lidaComoImagem).' };
}

// ---------------------------------------------------------------------------
// Holerites -> históricos salariais
// ---------------------------------------------------------------------------

/**
 * holerites: [{ competencia, documento, folha, rubricas: [{ codigo, descricao, referencia, valor, tipo: "P"|"D" }],
 *   totalProventos, totalDescontos, liquido, baseInss, baseFgts, baseIrrf }]
 * historicos: [{ nome, rubricas: ["001", "SALARIO BASE"...] (códigos ou descrições), fgts, inss }] — como agrupar as rubricas.
 * periodo: { inicio: "AAAA-MM", fim: "AAAA-MM" } — para acusar meses faltantes.
 */
export function holeritesParaHistoricos({ holerites = [], historicos = [], periodo = null } = {}) {
  const verificacoes = []; const problemas = []; const porComp = new Map();
  for (const [i, h] of holerites.entries()) {
    const c = comp(h.competencia);
    if (porComp.has(c)) problemas.push(`competência ${c} transcrita duas vezes (holerites[${i}])`);
    porComp.set(c, h);
    const prov = r2((h.rubricas || []).filter((r) => (r.tipo || 'P').toUpperCase().startsWith('P')).reduce((a, r) => a + num(r.valor), 0));
    const desc = r2((h.rubricas || []).filter((r) => (r.tipo || 'P').toUpperCase().startsWith('D')).reduce((a, r) => a + num(r.valor), 0));
    const difs = [];
    if (h.totalProventos != null && Math.abs(prov - num(h.totalProventos)) > 0.01) difs.push(`proventos ${prov} × total ${num(h.totalProventos)}`);
    if (h.totalDescontos != null && Math.abs(desc - num(h.totalDescontos)) > 0.01) difs.push(`descontos ${desc} × total ${num(h.totalDescontos)}`);
    if (h.liquido != null && Math.abs(r2(prov - desc) - num(h.liquido)) > 0.01) difs.push(`proventos − descontos ${r2(prov - desc)} × líquido ${num(h.liquido)}`);
    verificacoes.push(v(`fechamento do holerite ${c}`, difs.length ? 'falha' : h.liquido != null || h.totalProventos != null ? 'ok' : 'nao_verificado', difs.length ? `${difs.join('; ')} — releia o holerite (fl. ${h.folha || '?'})` : h.liquido != null ? `proventos ${prov} − descontos ${desc} = líquido ${num(h.liquido)}` : 'sem totais transcritos: transcreva proventos, descontos e líquido para conferir'));
  }
  if (periodo && periodo.inicio && periodo.fim) {
    const falt = meses(comp(periodo.inicio), comp(periodo.fim)).filter((m) => !porComp.has(m));
    verificacoes.push(v('holerites de todo o período', falt.length ? 'falha' : 'ok', falt.length ? `faltam ${falt.length} competência(s): ${falt.join(', ')} — peça ao usuário (ou registre a premissa para esses meses)` : `${porComp.size} competência(s) de ${comp(periodo.inicio)} a ${comp(periodo.fim)}`));
  }
  for (const p of problemas) verificacoes.push(v('transcrição dos holerites', 'falha', p));
  // agrupamento das rubricas em históricos
  const casa = (r, regras) => regras.some((x) => norm(x) === norm(r.codigo) || norm(x) === norm(r.descricao) || (String(x).length > 3 && norm(r.descricao).includes(norm(x))));
  const usadas = new Set();
  const historicosSalariais = []; const remuneracoes = [];
  for (const hdef of historicos) {
    if (!hdef.nome || !Array.isArray(hdef.rubricas) || !hdef.rubricas.length) throw new Error('historicos[]: informe { nome, rubricas: [códigos ou descrições] }.');
    const ocorrencias = [];
    for (const [c, h] of [...porComp.entries()].sort()) {
      const rs = (h.rubricas || []).filter((r) => (r.tipo || 'P').toUpperCase().startsWith('P') && casa(r, hdef.rubricas));
      rs.forEach((r) => usadas.add(`${c}|${r.codigo || ''}|${r.descricao}`));
      if (!rs.length) continue;
      const valor = r2(rs.reduce((a, r) => a + num(r.valor), 0));
      ocorrencias.push({ competencia: c, valor, _origem: `${h.documento || 'holerite'}${h.folha ? ` fl. ${h.folha}` : ''}: ${rs.map((r) => `${r.codigo ? `${r.codigo} ` : ''}${r.descricao} ${r.valor}`).join(' + ')}` });
    }
    historicosSalariais.push({ nome: String(hdef.nome).toUpperCase(), ...(hdef.fgts != null ? { fgts: hdef.fgts } : {}), ...(hdef.inss != null ? { inss: hdef.inss } : {}), ocorrencias });
    // vigências (valores iguais em meses seguidos viram uma remuneração do contrato)
    let atual = null;
    for (const o of ocorrencias) {
      if (atual && atual.valor === o.valor && meses(atual.ate, o.competencia).length === 2) { atual.ate = o.competencia; continue; }
      if (atual) remuneracoes.push(atual);
      atual = { id: `R${remuneracoes.length + 1}`, componente: String(hdef.nome).toUpperCase(), de: o.competencia, ate: o.competencia, valor: o.valor, documento: (porComp.get(o.competencia) || {}).documento || null, folha: (porComp.get(o.competencia) || {}).folha || null };
    }
    if (atual) remuneracoes.push(atual);
    const sem = [...porComp.keys()].filter((c) => !ocorrencias.some((o) => o.competencia === c));
    if (sem.length) verificacoes.push(v(`histórico ${hdef.nome}: rubricas encontradas em todos os meses`, 'alerta', `sem rubrica do histórico em: ${sem.join(', ')} — confira se a rubrica mudou de código/descrição ou se não houve pagamento`));
  }
  const naoUsadas = [];
  for (const [c, h] of porComp) for (const r of h.rubricas || []) if ((r.tipo || 'P').toUpperCase().startsWith('P') && !usadas.has(`${c}|${r.codigo || ''}|${r.descricao}`)) naoUsadas.push(`${c} ${r.codigo || ''} ${r.descricao}`.replace(/\s+/g, ' '));
  if (historicos.length && naoUsadas.length) verificacoes.push(v('proventos fora dos históricos', 'alerta', `${naoUsadas.length} provento(s) não entraram em nenhum histórico (confira se são pagamento de parcela deferida, a abater, ou parcela sem reflexo): ${naoUsadas.slice(0, 12).join('; ')}${naoUsadas.length > 12 ? '...' : ''}`));
  return { historicosSalariais, remuneracoes, verificacoes };
}

// ---------------------------------------------------------------------------
// Cartões de ponto -> jornadas
// ---------------------------------------------------------------------------

const minutos = (h) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h).trim()); if (!m) throw new Error(`horário inválido "${h}" (HH:MM)`); return Number(m[1]) * 60 + Number(m[2]); };
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * dias: [{ data, marcacoes: ["08:00","12:00","13:00","17:00"] } | { data, turnos: [{ entrada, saida }] } | { data, ocorrencia: "FOLGA"|"FERIAS"|"FALTA"|"ATESTADO"|"FERIADO"|"DSR" }]
 * periodo: { inicio, fim } (AAAA-MM-DD) para acusar dias faltantes; diasSemMarcacao: dias da semana sem trabalho (0=domingo).
 */
export function cartoesParaJornadas({ dias = [], periodo = null, diasSemMarcacao = [0], invariavelMinimo = 10 } = {}) {
  const verificacoes = []; const jornadas = []; const impossiveis = []; const interj = [];
  const porData = new Map();
  for (const [i, d] of dias.entries()) {
    const data = dataIso(d.data);
    if (porData.has(data)) impossiveis.push(`${data}: dia transcrito duas vezes (dias[${i}])`);
    porData.set(data, d);
    if (d.ocorrencia) continue;
    let turnos = d.turnos;
    if (!turnos && d.marcacoes) {
      if (d.marcacoes.length % 2) { impossiveis.push(`${data}: ${d.marcacoes.length} marcações (número ímpar): falta entrada ou saída`); continue; }
      turnos = []; for (let k = 0; k < d.marcacoes.length; k += 2) turnos.push({ entrada: d.marcacoes[k], saida: d.marcacoes[k + 1] });
    }
    if (!turnos || !turnos.length) continue;
    let ant = null; let total = 0; let ok = true;
    for (const t of turnos) {
      let e = minutos(t.entrada); let s = minutos(t.saida);
      if (ant != null && e < ant) e += 1440; // turno depois da meia-noite
      if (s <= e) s += 1440;
      if (ant != null && e < ant) { impossiveis.push(`${data}: turno ${t.entrada}-${t.saida} começa antes do fim do anterior`); ok = false; }
      if (s - e > 16 * 60) { impossiveis.push(`${data}: turno ${t.entrada}-${t.saida} com mais de 16 h`); ok = false; }
      total += s - e; ant = s;
    }
    if (total > 20 * 60) { impossiveis.push(`${data}: ${hhmm(total)} trabalhadas no dia`); ok = false; }
    if (ok) jornadas.push({ data, turnos: turnos.map((t) => ({ entrada: t.entrada, saida: t.saida })), _fim: ant });
  }
  // interjornada (art. 66 da CLT): 11 h entre o fim de um dia e o início do seguinte
  jornadas.sort((a, b) => (a.data < b.data ? -1 : 1));
  for (let i = 1; i < jornadas.length; i++) {
    const a = jornadas[i - 1]; const b = jornadas[i];
    const dias = Math.round((Date.parse(b.data) - Date.parse(a.data)) / 86400000);
    if (dias !== 1) continue;
    const descanso = minutos(b.turnos[0].entrada) + 1440 - a._fim;
    if (descanso < 11 * 60) interj.push(`${a.data}→${b.data}: ${hhmm(Math.max(0, descanso))}`);
  }
  // horário invariável (Súmula 338, III, do TST): mesmas marcações em muitos dias
  const assinatura = new Map();
  for (const j of jornadas) { const k = j.turnos.map((t) => `${t.entrada}-${t.saida}`).join(' '); assinatura.set(k, (assinatura.get(k) || 0) + 1); }
  const [maisComum, vezes] = [...assinatura.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  if (jornadas.length >= invariavelMinimo && vezes / jornadas.length >= 0.9) verificacoes.push(v('horários invariáveis (britânicos)', 'alerta', `${vezes} de ${jornadas.length} dias com as mesmas marcações (${maisComum}): pela Súmula 338, III, do TST são inválidos como prova; confira a decisão sobre a jornada`));
  verificacoes.push(v('marcações possíveis', impossiveis.length ? 'falha' : 'ok', impossiveis.length ? impossiveis.slice(0, 12).join('; ') : `${jornadas.length} dia(s) com marcações coerentes`));
  if (interj.length) verificacoes.push(v('intervalo interjornadas (11 h)', 'alerta', `${interj.length} ocorrência(s) com menos de 11 h: ${interj.slice(0, 8).join('; ')} — se deferido, o intervalo interjornadas é apurado na apuracaoCartaoPonto`));
  if (periodo && periodo.inicio && periodo.fim) {
    const faltam = [];
    for (let t = Date.parse(dataIso(periodo.inicio)); t <= Date.parse(dataIso(periodo.fim)); t += 86400000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (!porData.has(d) && !diasSemMarcacao.includes(new Date(t).getUTCDay())) faltam.push(d);
    }
    verificacoes.push(v('dias do período com registro', faltam.length ? 'falha' : 'ok', faltam.length ? `${faltam.length} dia(s) sem registro nem ocorrência (folga, férias, falta...): ${faltam.slice(0, 15).join(', ')}${faltam.length > 15 ? '...' : ''} — releia os cartões ou peça os que faltam` : 'todos os dias com registro ou ocorrência'));
  }
  return { apuracaoCartaoPonto: { jornadas: jornadas.map(({ _fim, ...j }) => j) }, ocorrencias: dias.filter((d) => d.ocorrencia).map((d) => ({ data: dataIso(d.data), ocorrencia: d.ocorrencia })), verificacoes };
}

// ---------------------------------------------------------------------------
// Extrato do FGTS -> operações
// ---------------------------------------------------------------------------

/**
 * lancamentos: [{ competencia, data, valor, tipo: "DEPOSITO"|"JAM"|"SAQUE"|"MULTA" }], saldo: saldo final do extrato,
 * periodo: { inicio, fim } (AAAA-MM). Devolve fgts.operacoes (depósitos) e as conferências.
 */
export function extratoParaFgts({ lancamentos = [], saldo = null, periodo = null, documento = null, prefixo = 'F', emitente = null } = {}) {
  const verificacoes = []; const operacoes = []; const porComp = new Map(); const pagamentos = [];
  // cada depósito ou saque vira um registro em contrato.pagamentos (a prova) e a operação aponta para ele
  const registrar = (tipo, valor, l, c) => {
    const id = `${prefixo}${pagamentos.length + 1}`;
    pagamentos.push({ id, titulo: tipo === 'SAQUE' ? 'SAQUE DE FGTS' : 'DEPÓSITO DE FGTS', parcelas: ['FGTS'], ...(c ? { competencia: c } : {}), ...(l.data ? { data: dataIso(l.data) } : {}), valor: r2(valor), ...(emitente ? { emitente } : {}), ...(documento ? { documento } : {}), ...(l.folha ? { folha: String(l.folha) } : {}) });
    return id;
  };
  let soma = 0;
  for (const [i, l] of lancamentos.entries()) {
    const tipo = String(l.tipo || 'DEPOSITO').toUpperCase();
    const valor = num(l.valor);
    if (tipo === 'SAQUE') soma -= valor; else soma += valor;
    if (tipo === 'DEPOSITO') {
      const c = comp(l.competencia ?? l.data);
      porComp.set(c, r2((porComp.get(c) || 0) + valor));
      operacoes.push({ data: l.data ? dataIso(l.data) : `${c}-01`, valor: r2(valor), tipo: 'DEPOSITO', origem: registrar('DEPOSITO', valor, l, c), _competencia: c });
    } else if (tipo === 'SAQUE') operacoes.push({ data: dataIso(l.data), valor: r2(valor), tipo: 'SAQUE', origem: registrar('SAQUE', valor, l, null) });
    else if (!['JAM', 'MULTA', 'CREDITO'].includes(tipo)) throw new Error(`lancamentos[${i}].tipo: use DEPOSITO, JAM, SAQUE ou MULTA.`);
  }
  if (saldo != null) verificacoes.push(v('extrato do FGTS: soma dos lançamentos = saldo', Math.abs(r2(soma) - num(saldo)) <= 0.01 ? 'ok' : 'falha', `soma ${r2(soma)}, saldo do extrato ${num(saldo)}`));
  if (periodo && periodo.inicio && periodo.fim) {
    const sem = meses(comp(periodo.inicio), comp(periodo.fim)).filter((m) => !porComp.has(m));
    verificacoes.push(v('competências com depósito de FGTS', sem.length ? 'alerta' : 'ok', sem.length ? `sem depósito em ${sem.length} competência(s): ${sem.join(', ')} — o FGTS dessas competências é devido integralmente (se houve salário)` : 'todas as competências com depósito'));
  }
  const tiposSaque = operacoes.filter((o) => o.tipo === 'SAQUE').length;
  return { fgts: { operacoes, deduzir: true }, contratoPagamentos: pagamentos, depositosPorCompetencia: Object.fromEntries([...porComp.entries()].sort()), verificacoes, lembrete: `As operações deduzem do FGTS devido os depósitos já feitos${tiposSaque ? ' e os saques' : ''}; confira se a decisão manda deduzir. Grave "contratoPagamentos" em contrato.pagamentos (a origem de cada operação).` };
}

// ---------------------------------------------------------------------------
// TRCT -> pagamentos
// ---------------------------------------------------------------------------

// campos do TRCT (Portaria MTE 1.621/2010, anexo I) com a parcela que costumam quitar
const CAMPOS_TRCT = {
  50: 'SALDO DE SALÁRIO', 51: 'COMISSÕES', 52: 'GRATIFICAÇÃO', 53: 'ADICIONAL DE INSALUBRIDADE', 54: 'ADICIONAL DE PERICULOSIDADE', 55: 'ADICIONAL NOTURNO',
  56: 'HORAS EXTRAS', 57: 'GORJETAS', 58: 'DESCANSO SEMANAL REMUNERADO', 59: 'REFLEXO DO DSR SOBRE SALÁRIO VARIÁVEL', 60: 'MULTA DO ARTIGO 477 DA CLT',
  61: 'MULTA DO ARTIGO 479 DA CLT', 62: 'SALÁRIO-FAMÍLIA', 63: '13º SALÁRIO PROPORCIONAL', 64: '13º SALÁRIO EXERCÍCIO', 65: 'FÉRIAS PROPORCIONAIS',
  66: 'FÉRIAS VENCIDAS', 67: 'FÉRIAS EM DOBRO', 68: 'TERÇO CONSTITUCIONAL DE FÉRIAS', 69: 'AVISO PRÉVIO INDENIZADO', 70: '13º SALÁRIO (AVISO PRÉVIO INDENIZADO)',
  71: 'FÉRIAS (AVISO PRÉVIO INDENIZADO)', 72: 'PERCENTAGEM', 73: 'PRÊMIOS', 74: 'VIAGENS', 75: 'SOBREAVISO', 76: 'QUEBRA DE CAIXA', 77: 'ADICIONAL POR TEMPO DE SERVIÇO',
  78: 'ADICIONAL POR TRANSFERÊNCIA', 80: 'DIFERENÇA SALARIAL', 82: 'INDENIZAÇÃO ART. 9º DA LEI 7.238/1984', 95: 'OUTRAS VERBAS',
  100: 'PENSÃO ALIMENTÍCIA', 101: 'ADIANTAMENTO SALARIAL', 102: 'ADIANTAMENTO DE 13º SALÁRIO', 103: 'AVISO PRÉVIO INDENIZADO (DESCONTO)', 112: 'PREVIDÊNCIA SOCIAL', 114: 'IRRF',
};

/**
 * campos: [{ codigo, descricao, valor, tipo: "P"|"D" }], totais: { bruto, descontos, liquido }, data (pagamento), documento, folha.
 * Devolve contrato.pagamentos (um por campo de provento, com a parcela provável) e as conferências.
 */
export function trctParaPagamentos({ campos = [], totais = {}, data = null, documento = null, folha = null, prefixo = 'P' } = {}) {
  const verificacoes = []; const pagamentos = [];
  let prov = 0; let desc = 0;
  for (const [i, c] of campos.entries()) {
    const tipo = (c.tipo || (Number(String(c.codigo).split('.')[0]) >= 100 ? 'D' : 'P')).toUpperCase();
    const valor = num(c.valor);
    if (tipo.startsWith('D')) { desc += valor; continue; }
    prov += valor;
    if (!valor) continue;
    const cod = Number(String(c.codigo || '').split('.')[0]);
    pagamentos.push({
      id: `${prefixo}${pagamentos.length + 1}`, titulo: c.descricao || CAMPOS_TRCT[cod] || `CAMPO ${c.codigo}`, parcelas: [], valor: r2(valor),
      ...(data ? { data: dataIso(data) } : {}), ...(documento ? { documento } : {}), ...(folha ? { folha: String(folha) } : {}),
      trecho: `TRCT campo ${c.codigo || i}: ${c.descricao || CAMPOS_TRCT[cod] || ''} R$ ${r2(valor)}`.trim(),
      _parcelaProvavel: CAMPOS_TRCT[cod] || null, _instrucao: 'ligue o pagamento à parcela do contrato (parcelas: [id]) e diga o período/avos que ele quita',
    });
  }
  prov = r2(prov); desc = r2(desc);
  if (totais.bruto != null) verificacoes.push(v('TRCT: soma dos proventos = total bruto', Math.abs(prov - num(totais.bruto)) <= 0.01 ? 'ok' : 'falha', `soma ${prov}, total bruto ${num(totais.bruto)}`));
  if (totais.descontos != null) verificacoes.push(v('TRCT: soma dos descontos = total de descontos', Math.abs(desc - num(totais.descontos)) <= 0.01 ? 'ok' : 'falha', `soma ${desc}, total ${num(totais.descontos)}`));
  if (totais.liquido != null) verificacoes.push(v('TRCT: bruto − descontos = líquido', Math.abs(r2(prov - desc) - num(totais.liquido)) <= 0.01 ? 'ok' : 'falha', `${prov} − ${desc} = ${r2(prov - desc)}, líquido ${num(totais.liquido)}`));
  if (!data) verificacoes.push(v('TRCT: data do pagamento', 'alerta', 'sem data do pagamento: sem ela a multa do art. 477 não pode ser conferida'));
  return { pagamentos, totais: { proventos: prov, descontos: desc, liquido: r2(prov - desc) }, verificacoes };
}
