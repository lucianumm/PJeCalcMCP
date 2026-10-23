// pjecalc-mcp-skill · lib/pdf.mjs
// Leitor de PDF sem dependências: páginas, texto por página (quando o PDF tem texto) e imagens por página.
// Serve para o inventário dos documentos e para localizar trechos; NÃO substitui a leitura: página sem texto
// (escaneada) é marcada para ser vista como imagem, e o texto extraído de PDF com fontes sem mapa de caracteres
// pode sair incompleto — o agente confere sempre na página.
//
// Suporta: streams FlateDecode, object streams (PDF 1.5), árvore de páginas com herança de recursos, fontes com
// ToUnicode (inclusive Type0/Identity-H) e codificação WinAnsi/Differences, XObjects de formulário. Não lê PDF
// criptografado (avisa).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Parser de objetos PDF (texto -> valores JS)
// ---------------------------------------------------------------------------

const BRANCO = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

class Leitor {
  constructor(buf, pos = 0, fim = buf.length) { this.b = buf; this.p = pos; this.fim = fim; }
  pular() {
    while (this.p < this.fim) {
      const c = this.b[this.p];
      if (BRANCO.has(c)) { this.p++; continue; }
      if (c === 0x25) { while (this.p < this.fim && this.b[this.p] !== 0x0a && this.b[this.p] !== 0x0d) this.p++; continue; }
      break;
    }
  }
  token() {
    this.pular();
    if (this.p >= this.fim) return null;
    const c = this.b[this.p];
    if (c === 0x28) return { t: 'str', v: this.literal() };
    if (c === 0x3c) {
      if (this.b[this.p + 1] === 0x3c) { this.p += 2; return { t: '<<' }; }
      return { t: 'str', v: this.hex() };
    }
    if (c === 0x3e && this.b[this.p + 1] === 0x3e) { this.p += 2; return { t: '>>' }; }
    if (c === 0x5b) { this.p++; return { t: '[' }; }
    if (c === 0x5d) { this.p++; return { t: ']' }; }
    if (c === 0x7b || c === 0x7d) { this.p++; return { t: 'op', v: String.fromCharCode(c) }; }
    if (c === 0x2f) {
      this.p++;
      let s = '';
      while (this.p < this.fim && !BRANCO.has(this.b[this.p]) && !DELIM.has(this.b[this.p])) {
        if (this.b[this.p] === 0x23 && /^[0-9a-fA-F]{2}$/.test(String.fromCharCode(this.b[this.p + 1], this.b[this.p + 2]))) { s += String.fromCharCode(parseInt(String.fromCharCode(this.b[this.p + 1], this.b[this.p + 2]), 16)); this.p += 3; }
        else s += String.fromCharCode(this.b[this.p++]);
      }
      return { t: 'name', v: s };
    }
    let s = '';
    while (this.p < this.fim && !BRANCO.has(this.b[this.p]) && !DELIM.has(this.b[this.p])) s += String.fromCharCode(this.b[this.p++]);
    if (s === '') { this.p++; return this.token(); }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { t: 'num', v: Number(s) };
    return { t: 'op', v: s };
  }
  literal() {
    this.p++;
    const out = []; let nivel = 1;
    while (this.p < this.fim) {
      const c = this.b[this.p++];
      if (c === 0x5c) {
        const d = this.b[this.p++];
        const mapa = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (mapa[d] !== undefined) out.push(mapa[d]);
        else if (d >= 0x30 && d <= 0x37) {
          let o = d - 0x30;
          for (let k = 0; k < 2 && this.b[this.p] >= 0x30 && this.b[this.p] <= 0x37; k++) o = o * 8 + (this.b[this.p++] - 0x30);
          out.push(o & 0xff);
        } else if (d === 0x0d) { if (this.b[this.p] === 0x0a) this.p++; } else if (d !== 0x0a) out.push(d);
        continue;
      }
      if (c === 0x28) nivel++;
      if (c === 0x29 && --nivel === 0) break;
      out.push(c);
    }
    return Buffer.from(out);
  }
  hex() {
    this.p++;
    let s = '';
    while (this.p < this.fim && this.b[this.p] !== 0x3e) { const ch = String.fromCharCode(this.b[this.p++]); if (/[0-9a-fA-F]/.test(ch)) s += ch; }
    this.p++;
    if (s.length % 2) s += '0';
    return Buffer.from(s, 'hex');
  }
  /** Lê um valor (dicionário, array, referência "n g R", número, nome, string). */
  valor(tok = this.token()) {
    if (!tok) return null;
    if (tok.t === '<<') {
      const d = {};
      for (;;) {
        const k = this.token();
        if (!k || k.t === '>>') break;
        if (k.t !== 'name') continue;
        d[k.v] = this.valor();
      }
      return d;
    }
    if (tok.t === '[') {
      const a = [];
      for (;;) {
        const x = this.token();
        if (!x || x.t === ']') break;
        a.push(this.valor(x));
      }
      return a;
    }
    if (tok.t === 'num') {
      // referência indireta "n g R"
      const salvo = this.p;
      const t2 = this.token();
      if (t2 && t2.t === 'num') {
        const t3 = this.token();
        if (t3 && t3.t === 'op' && t3.v === 'R') return { ref: tok.v };
      }
      this.p = salvo;
      return tok.v;
    }
    if (tok.t === 'name') return { nome: tok.v };
    if (tok.t === 'str') return tok.v;
    if (tok.t === 'op') return tok.v === 'true' ? true : tok.v === 'false' ? false : tok.v === 'null' ? null : { op: tok.v };
    return null;
  }
}

// ---------------------------------------------------------------------------
// Documento: objetos, streams e páginas
// ---------------------------------------------------------------------------

function descomprimir(dict, dados) {
  let filtros = dict.Filter ? (Array.isArray(dict.Filter) ? dict.Filter : [dict.Filter]).map((f) => f && f.nome) : [];
  let out = dados;
  for (const f of filtros) {
    if (f === 'FlateDecode' || f === 'Fl') {
      try { out = zlib.inflateSync(out); } catch { try { out = zlib.inflateSync(out, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { try { out = zlib.inflateRawSync(out); } catch { return null; } } }
      const parms = dict.DecodeParms || dict.DP;
      const pred = parms && !Array.isArray(parms) ? parms.Predictor : null;
      if (pred && pred >= 10) out = desfazerPng(out, parms.Columns || 1);
    } else if (f === 'ASCIIHexDecode') out = Buffer.from(out.toString('latin1').replace(/[^0-9a-fA-F]/g, ''), 'hex');
    else return null; // DCT, JBIG2, CCITT... (imagens): não é texto
  }
  return out;
}

function desfazerPng(buf, colunas) {
  const linha = colunas + 1; const out = []; let ant = Buffer.alloc(colunas);
  for (let i = 0; i + linha <= buf.length; i += linha) {
    const tipo = buf[i]; const cur = Buffer.from(buf.subarray(i + 1, i + linha));
    for (let j = 0; j < colunas; j++) {
      const a = j ? cur[j - 1] : 0; const b = ant[j]; const c = j ? ant[j - 1] : 0;
      if (tipo === 1) cur[j] = (cur[j] + a) & 0xff;
      else if (tipo === 2) cur[j] = (cur[j] + b) & 0xff;
      else if (tipo === 3) cur[j] = (cur[j] + ((a + b) >> 1)) & 0xff;
      else if (tipo === 4) { const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c); cur[j] = (cur[j] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff; }
    }
    out.push(cur); ant = cur;
  }
  return Buffer.concat(out);
}

class DocumentoPdf {
  constructor(buf) {
    this.b = buf;
    this.objetos = new Map(); // n -> { dict|valor, inicioStream, fimStream }
    this.cacheStream = new Map();
    this.indexar();
  }
  indexar() {
    const s = this.b.toString('latin1');
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      const n = Number(m[1]);
      const ini = m.index + m[0].length;
      const fimObj = s.indexOf('endobj', ini);
      const fim = fimObj < 0 ? s.length : fimObj;
      const r = new Leitor(this.b, ini, fim);
      let valor = null;
      try { valor = r.valor(); } catch { valor = null; }
      const ent = { valor };
      if (valor && typeof valor === 'object' && !Array.isArray(valor) && !valor.ref) {
        const idx = s.indexOf('stream', r.p);
        if (idx >= 0 && idx < fim) {
          let st = idx + 6;
          if (s[st] === '\r') st++;
          if (s[st] === '\n') st++;
          let en = s.lastIndexOf('endstream', fim);
          if (en < st) en = fim;
          let comp = typeof valor.Length === 'number' ? valor.Length : null;
          ent.inicioStream = st;
          ent.fimStream = comp != null && st + comp <= en ? st + comp : en;
        }
      }
      this.objetos.set(n, ent);
      re.lastIndex = fim;
    }
    // object streams
    for (const [, ent] of [...this.objetos]) {
      const v = ent.valor;
      if (!v || !v.Type || v.Type.nome !== 'ObjStm' || ent.inicioStream == null) continue;
      const dados = this.stream(ent);
      if (!dados) continue;
      const r = new Leitor(dados, 0, v.First);
      const pares = [];
      for (let i = 0; i < v.N; i++) { const a = r.token(); const b = r.token(); if (!a || !b) break; pares.push([a.v, b.v]); }
      for (const [num, off] of pares) {
        if (this.objetos.has(num) && this.objetos.get(num).valor != null) continue;
        const r2 = new Leitor(dados, v.First + off, dados.length);
        try { this.objetos.set(num, { valor: r2.valor() }); } catch { /* objeto ilegível */ }
      }
    }
    const raiz = [...s.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)].pop();
    this.raiz = raiz ? Number(raiz[1]) : null;
    this.criptografado = /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(s.slice(Math.max(0, s.length - 4096))) || [...this.objetos.values()].some((e) => e.valor && e.valor.Filter && e.valor.Filter.nome === 'Standard' && e.valor.O);
    const ver = /^%PDF-(\d\.\d)/.exec(s.slice(0, 16));
    this.versao = ver ? ver[1] : null;
  }
  resolver(v) {
    let guarda = 0;
    while (v && typeof v === 'object' && v.ref != null && guarda++ < 20) { const e = this.objetos.get(v.ref); v = e ? e.valor : null; }
    return v;
  }
  stream(ent) {
    if (!ent || ent.inicioStream == null) return null;
    if (this.cacheStream.has(ent)) return this.cacheStream.get(ent);
    const dados = descomprimir(ent.valor, this.b.subarray(ent.inicioStream, ent.fimStream));
    this.cacheStream.set(ent, dados);
    return dados;
  }
  streamDe(refOuValor) {
    if (refOuValor && refOuValor.ref != null) return this.stream(this.objetos.get(refOuValor.ref));
    return null;
  }
  paginas() {
    const out = [];
    const visitar = (ref, herdado, guarda = 0) => {
      if (guarda > 50) return;
      const no = this.resolver(ref);
      if (!no || typeof no !== 'object') return;
      const her = { Resources: no.Resources || herdado.Resources, MediaBox: no.MediaBox || herdado.MediaBox, Rotate: no.Rotate ?? herdado.Rotate };
      const tipo = no.Type && no.Type.nome;
      if (tipo === 'Pages' || (Array.isArray(no.Kids) && tipo !== 'Page')) for (const k of no.Kids || []) visitar(k, her, guarda + 1);
      else out.push({ no, ref: ref && ref.ref, ...her });
    };
    const raiz = this.raiz != null ? this.resolver({ ref: this.raiz }) : null;
    if (raiz && raiz.Pages) visitar(raiz.Pages, {});
    if (!out.length) {
      // sem raiz legível: objetos /Type /Page na ordem do arquivo
      for (const [n, e] of this.objetos) if (e.valor && e.valor.Type && e.valor.Type.nome === 'Page') out.push({ no: e.valor, ref: n, Resources: e.valor.Resources, MediaBox: e.valor.MediaBox });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Fontes e texto
// ---------------------------------------------------------------------------

const WIN_ANSI_EXTRA = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const GLIFOS = { space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', ordfeminine: 'ª', ordmasculine: 'º', degree: '°', section: '§', endash: '–', emdash: '—', quoteright: '’', quoteleft: '‘', quotedblleft: '“', quotedblright: '”', bullet: '•', Euro: '€', ellipsis: '…' };
const ACENTOS = { acute: '́', grave: '̀', circumflex: '̂', tilde: '̃', dieresis: '̈', cedilla: '̧', ring: '̊' };
const nomes0a9 = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function glifo(n) {
  if (!n) return '';
  if (GLIFOS[n]) return GLIFOS[n];
  if (/^[A-Za-z]$/.test(n)) return n;
  const d = nomes0a9.indexOf(n); if (d >= 0) return String(d);
  const u = /^uni([0-9A-Fa-f]{4})$/.exec(n); if (u) return String.fromCharCode(parseInt(u[1], 16));
  const a = /^([A-Za-z])(acute|grave|circumflex|tilde|dieresis|cedilla|ring)$/.exec(n); if (a) return (a[1] + ACENTOS[a[2]]).normalize('NFC');
  return '';
}

function lerCmap(buf) {
  const s = buf.toString('latin1');
  const mapa = new Map(); let bytes = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(s);
  if (cs) { const h = /<([0-9a-fA-F]+)>/.exec(cs[1]); if (h) bytes = Math.max(1, h[1].length / 2); }
  const dst = (hex) => { const b = Buffer.from(hex.length % 4 ? hex.padStart(Math.ceil(hex.length / 4) * 4, '0') : hex, 'hex'); let t = ''; for (let i = 0; i + 1 < b.length; i += 2) t += String.fromCharCode(b.readUInt16BE(i)); return t; };
  for (const bloco of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) mapa.set(parseInt(m[1], 16), dst(m[2]));
  for (const bloco of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(m[1], 16); const b = parseInt(m[2], 16);
      if (b - a > 65535) continue;
      if (m[4] != null) { const base = dst(m[4]); const c0 = base.charCodeAt(base.length - 1); for (let k = a; k <= b; k++) mapa.set(k, base.slice(0, -1) + String.fromCharCode(c0 + (k - a))); }
      else { const lst = [...m[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => dst(x[1])); for (let k = a; k <= b && k - a < lst.length; k++) mapa.set(k, lst[k - a]); }
    }
  }
  return { mapa, bytes };
}

function fonteDe(doc, dict) {
  const f = doc.resolver(dict) || {};
  const sub = f.Subtype && f.Subtype.nome;
  const fonte = { bytes: sub === 'Type0' ? 2 : 1, cmap: null, dif: null };
  if (f.ToUnicode) { const st = doc.streamDe(f.ToUnicode); if (st) { fonte.cmap = lerCmap(st); fonte.bytes = fonte.cmap.bytes || fonte.bytes; } }
  const enc = doc.resolver(f.Encoding);
  if (enc && typeof enc === 'object' && Array.isArray(enc.Differences)) {
    fonte.dif = new Map(); let cod = 0;
    for (const x of enc.Differences) { if (typeof x === 'number') cod = x; else if (x && x.nome) fonte.dif.set(cod++, glifo(x.nome)); }
  }
  // larguras dos glifos (milésimos do corpo): decidem se um deslocamento horizontal é espaço entre palavras
  // ou só o avanço da letra (PDFs que posicionam letra por letra)
  const num = (x) => { const v = doc.resolver(x); return typeof v === 'number' ? v : null; };
  if (sub === 'Type0') {
    const desc = doc.resolver((doc.resolver(f.DescendantFonts) || [])[0]) || {};
    const dw = num(desc.DW) ?? 1000; const w = doc.resolver(desc.W); const mapa = new Map();
    if (Array.isArray(w)) {
      for (let i = 0; i < w.length;) {
        const c = num(w[i]); const prox = doc.resolver(w[i + 1]);
        if (c == null) break;
        if (Array.isArray(prox)) { prox.forEach((x, k) => mapa.set(c + k, num(x) ?? dw)); i += 2; } else { const c2 = num(prox); const lw = num(w[i + 2]); if (c2 == null || lw == null) break; for (let k = c; k <= c2 && k - c < 65536; k++) mapa.set(k, lw); i += 3; }
      }
    }
    fonte.largura = (cod) => mapa.get(cod) ?? dw;
  } else {
    const ws = doc.resolver(f.Widths); const fc = num(f.FirstChar) ?? 0;
    const fd = doc.resolver(f.FontDescriptor) || {}; const mw = num(fd.MissingWidth);
    if (Array.isArray(ws)) fonte.largura = (cod) => num(ws[cod - fc]) ?? mw ?? 500;
  }
  return fonte;
}

/** Avanço horizontal (unidades de texto) de uma string: larguras × corpo + espaçamento entre caracteres. */
function avanco(fonte, bytes, corpo, tc) {
  if (!fonte || !fonte.largura) return null;
  const n = fonte.bytes; let a = 0; let qtd = 0;
  for (let i = 0; i + n <= bytes.length; i += n) { a += fonte.largura(n === 2 ? bytes.readUInt16BE(i) : bytes[i]) / 1000 * corpo; qtd++; }
  return a + tc * qtd;
}

function decodificar(fonte, bytes) {
  if (!fonte) return bytes.toString('latin1');
  let t = '';
  const n = fonte.bytes;
  for (let i = 0; i + n <= bytes.length; i += n) {
    const cod = n === 2 ? bytes.readUInt16BE(i) : bytes[i];
    if (fonte.cmap && fonte.cmap.mapa.has(cod)) { t += fonte.cmap.mapa.get(cod); continue; }
    if (fonte.dif && fonte.dif.has(cod)) { t += fonte.dif.get(cod); continue; }
    if (n === 2) { if (!fonte.cmap) t += String.fromCharCode(cod); continue; }
    t += WIN_ANSI_EXTRA[cod] || String.fromCharCode(cod);
  }
  return t;
}

/** Texto de um fluxo de conteúdo (página ou formulário). */
function textoDoConteudo(doc, conteudo, recursos, profundidade = 0, contagem = { imagens: 0 }) {
  const res = doc.resolver(recursos) || {};
  const fontes = doc.resolver(res.Font) || {};
  const xobjs = doc.resolver(res.XObject) || {};
  const cache = new Map();
  const fonte = (nome) => { if (!cache.has(nome)) cache.set(nome, fontes[nome] ? fonteDe(doc, fontes[nome]) : null); return cache.get(nome); };
  const r = new Leitor(conteudo);
  const pilha = []; let atual = null; let texto = ''; let ultimoY = null;
  // posição na linha: avanço do texto desenhado desde o início da linha atual (Td/TD são relativos a ele)
  // tmX/tmA: origem e escala do último Tm; linhaX: deslocamento (Td/TD) da linha atual em relação a essa origem
  let corpo = 0; let tc = 0; let avancoLinha = 0; let avancoConhecido = true; let tmX = null; let tmA = 1; let linhaX = 0; let aposET = false;
  // texto logo depois de um ET, sem nenhum posicionamento novo: separa com espaço
  const antesDeDesenhar = () => { if (aposET && texto && !texto.endsWith(' ') && !texto.endsWith('\n')) texto += ' '; aposET = false; };
  const desenhou = (bytes) => { const a = avanco(atual, bytes, corpo, tc); if (a == null) avancoConhecido = false; else avancoLinha += a; };
  const novaLinha = () => { avancoLinha = 0; avancoConhecido = true; };
  const quebra = () => { if (texto && !texto.endsWith('\n')) texto += '\n'; };
  for (let guarda = 0; guarda < 2000000; guarda++) {
    const tok = r.token();
    if (!tok) break;
    if (tok.t !== 'op') { pilha.push(tok.t === '[' ? lerArrayOp(r) : tok.t === '<<' ? (r.p -= 2, r.valor()) : tok); continue; }
    const op = tok.v;
    if (op === 'BI') { // imagem inline: pula até EI
      const s = r.b.indexOf('EI', r.p, 'latin1'); r.p = s < 0 ? r.fim : s + 2; contagem.imagens++; pilha.length = 0; continue;
    }
    if (op === 'Tf') { const nome = pilha[pilha.length - 2]; const tam = pilha[pilha.length - 1]; atual = nome && nome.t === 'name' ? fonte(nome.v) : null; if (tam && tam.t === 'num') corpo = tam.v; }
    else if (op === 'Tc') { const v = pilha[pilha.length - 1]; if (v && v.t === 'num') tc = v.v; }
    else if (op === 'Tj' || op === "'" || op === '"') { const s = pilha[pilha.length - 1]; if (op !== 'Tj') { quebra(); novaLinha(); aposET = false; } if (s && s.t === 'str') { antesDeDesenhar(); texto += decodificar(atual, s.v); desenhou(s.v); } }
    else if (op === 'TJ') {
      const arr = pilha[pilha.length - 1];
      if (arr && arr.t === 'arr') for (const x of arr.v) { if (x.t === 'str') { antesDeDesenhar(); texto += decodificar(atual, x.v); desenhou(x.v); } else if (x.t === 'num') { if (x.v < -180) texto += ' '; avancoLinha -= x.v / 1000 * corpo; } }
    } else if (op === 'Td' || op === 'TD') {
      const ty = pilha[pilha.length - 1]; const tx = pilha[pilha.length - 2]; aposET = false;
      if (tx && tx.t === 'num') linhaX += tx.v;
      if (ty && ty.t === 'num' && Math.abs(ty.v) > 0.5) quebra();
      else if (!texto.endsWith(' ') && !texto.endsWith('\n')) {
        // na mesma linha: só é espaço se o deslocamento passa do fim do texto já desenhado (letra por letra não)
        const lacuna = tx && tx.t === 'num' && avancoConhecido && corpo ? tx.v - avancoLinha : null;
        if (lacuna == null || lacuna > 0.15 * Math.abs(corpo)) texto += ' ';
      }
      novaLinha();
    }
    else if (op === 'Tm') {
      const nums = pilha.slice(-6); const y = nums[5]; aposET = false;
      if (y && y.t === 'num') {
        const a = nums[0] && nums[0].t === 'num' ? nums[0].v : 1; const x = nums[4] && nums[4].t === 'num' ? nums[4].v : null;
        if (ultimoY != null && Math.abs(y.v - ultimoY) > 0.5) quebra();
        else if (!texto.endsWith(' ') && !texto.endsWith('\n')) {
          // mesma linha: espaço só se a nova posição passa do fim do texto anterior (letra acentuada ou pedaço
          // da palavra desenhado em bloco próprio não leva espaço)
          const fimX = tmX != null && x != null && avancoConhecido && corpo ? tmX + tmA * (linhaX + avancoLinha) : null;
          const lacuna = fimX != null && a ? (x - fimX) / Math.abs(a) : null;
          if (lacuna == null || lacuna > 0.15 * Math.abs(corpo)) texto += ' ';
        }
        ultimoY = y.v; tmX = x; tmA = a;
      }
      linhaX = 0;
      novaLinha();
    }
    else if (op === 'T*') { quebra(); novaLinha(); }
    else if (op === 'ET') aposET = true;
    else if (op === 'Do') {
      const nome = pilha[pilha.length - 1];
      const ref = nome && nome.t === 'name' ? xobjs[nome.v] : null;
      const ent = ref && ref.ref != null ? doc.objetos.get(ref.ref) : null;
      const sub = ent && ent.valor && ent.valor.Subtype && ent.valor.Subtype.nome;
      if (sub === 'Image') contagem.imagens++;
      else if (sub === 'Form' && profundidade < 6) { const st = doc.stream(ent); if (st) { quebra(); texto += textoDoConteudo(doc, st, ent.valor.Resources || recursos, profundidade + 1, contagem).texto; quebra(); } }
    }
    pilha.length = 0;
  }
  return { texto, imagens: contagem.imagens };
}

function lerArrayOp(r) {
  const v = [];
  for (;;) { const t = r.token(); if (!t || t.t === ']') break; if (t.t === '[') v.push(lerArrayOp(r)); else v.push(t); }
  return { t: 'arr', v };
}

/**
 * Lê um PDF: { paginas: [{ numero, texto, caracteres, temTexto, imagens }], totalPaginas, versao, criptografado, avisos }.
 * `opcoes.paginas`: lista de números (1-based) para limitar a extração de texto.
 */
export function lerPdf(bytes, { paginas: so = null, maxCaracteresPorPagina = 200000 } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('O arquivo não é um PDF (cabeçalho %PDF- ausente).');
  const doc = new DocumentoPdf(buf);
  const avisos = [];
  if (doc.criptografado) avisos.push('PDF criptografado: o texto pode não ser legível; veja as páginas como imagem.');
  const pags = doc.paginas();
  const out = [];
  pags.forEach((pg, i) => {
    const numero = i + 1;
    if (so && !so.includes(numero)) { out.push({ numero }); return; }
    let texto = ''; let imagens = 0;
    try {
      const cont = pg.no.Contents;
      const partes = (Array.isArray(doc.resolver(cont)) ? doc.resolver(cont) : [cont]).map((x) => doc.streamDe(x)).filter(Boolean);
      const r = textoDoConteudo(doc, Buffer.concat(partes.flatMap((p) => [p, Buffer.from('\n')])), pg.Resources);
      texto = r.texto; imagens = r.imagens;
    } catch (e) { avisos.push(`página ${numero}: ${e.message}`); }
    texto = texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (texto.length > maxCaracteresPorPagina) texto = texto.slice(0, maxCaracteresPorPagina);
    const caracteres = texto.replace(/\s/g, '').length;
    // o carimbo de assinatura do PJe (rodapé com assinante, link, número do documento e folha) vem como texto
    // até nas páginas escaneadas: não conta para decidir se a página tem texto próprio
    const uteis = texto.split('\n').filter((l) => !RE_CARIMBO_PJE.test(l.trim())).join('').replace(/\s/g, '').length;
    out.push({ numero, texto, caracteres, ...(uteis !== caracteres ? { caracteresSemCarimbo: uteis } : {}), temTexto: uteis >= 20, imagens });
  });
  return { totalPaginas: pags.length, versao: doc.versao, criptografado: doc.criptografado, paginas: out, avisos };
}

const RE_CARIMBO_PJE = /^(Documento assinado eletronicamente.*|Assinado eletronicamente por.*|https?:\/\/pje\S*.*|N[úu]mero do (documento|processo):.*|Fls\.?\s*:?\s*\d+|ID\.?\s*[0-9a-f]{7}\s*-\s*P[áa]g\.\s*\d+|\d+)$/i;

// ---------------------------------------------------------------------------
// Imagens das páginas (escaneadas): para o agente VER a página sem depender de renderizador
// ---------------------------------------------------------------------------

/** PNG mínimo (sem filtro por linha): tipo de cor 0 (cinza) ou 2 (RGB), profundidade 1 ou 8. */
function codificarPng(largura, altura, canais, bits, dados) {
  const bytesLinha = Math.ceil(largura * canais * bits / 8);
  const cru = Buffer.alloc((bytesLinha + 1) * altura);
  for (let y = 0; y < altura; y++) dados.copy(cru, y * (bytesLinha + 1) + 1, y * bytesLinha, (y + 1) * bytesLinha);
  const bloco = (tipo, conteudo) => {
    const t = Buffer.from(tipo, 'latin1');
    const tam = Buffer.alloc(4); tam.writeUInt32BE(conteudo.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, conteudo])) >>> 0);
    return Buffer.concat([tam, t, conteudo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = bits; ihdr[9] = canais === 3 ? 2 : 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(cru)), bloco('IEND', Buffer.alloc(0))]);
}

/** Imagens (XObject /Image) usadas numa página, inclusive dentro de formulários. */
function imagensDaPagina(doc, recursos, vistos, profundidade = 0) {
  const out = [];
  const res = doc.resolver(recursos) || {};
  const xobjs = doc.resolver(res.XObject) || {};
  for (const ref of Object.values(xobjs)) {
    if (!ref || ref.ref == null || vistos.has(ref.ref)) continue;
    vistos.add(ref.ref);
    const ent = doc.objetos.get(ref.ref);
    const sub = ent && ent.valor && ent.valor.Subtype && ent.valor.Subtype.nome;
    if (sub === 'Image') out.push({ ref: ref.ref, ent });
    else if (sub === 'Form' && profundidade < 6) out.push(...imagensDaPagina(doc, ent.valor.Resources, vistos, profundidade + 1));
  }
  return out;
}

/**
 * Extrai as imagens das páginas pedidas para arquivos (JPEG como está; demais em PNG), para o agente ver as
 * páginas escaneadas. Devolve, por página, os arquivos gravados (a maior imagem é a "principal": em geral a
 * página escaneada inteira) e os avisos de formatos não convertidos (CCITT, JBIG2, JPEG 2000).
 */
export function extrairImagens(bytes, { paginas: so = null, destino, prefixo = 'pagina', larguraMinima = 200 } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('O arquivo não é um PDF (cabeçalho %PDF- ausente).');
  const doc = new DocumentoPdf(buf);
  const pags = doc.paginas();
  fs.mkdirSync(destino, { recursive: true });
  const saida = []; const avisos = [];
  pags.forEach((pg, i) => {
    const numero = i + 1;
    if (so && !so.includes(numero)) return;
    const arquivos = [];
    imagensDaPagina(doc, pg.Resources, new Set()).forEach(({ ref, ent }, k) => {
      const d = ent.valor;
      const largura = Number(doc.resolver(d.Width)) || 0; const altura = Number(doc.resolver(d.Height)) || 0;
      if (largura < larguraMinima && altura < larguraMinima) return; // logotipos e selos
      const filtros = (Array.isArray(d.Filter) ? d.Filter : d.Filter ? [d.Filter] : []).map((f) => f && f.nome);
      const base = path.join(destino, `${prefixo}-${String(numero).padStart(3, '0')}-${k + 1}`);
      const cru = ent.inicioStream != null ? buf.subarray(ent.inicioStream, ent.fimStream) : null;
      try {
        if (filtros.length === 1 && (filtros[0] === 'DCTDecode' || filtros[0] === 'DCT')) {
          fs.writeFileSync(`${base}.jpg`, cru); arquivos.push({ arquivo: `${base}.jpg`, largura, altura, formato: 'JPEG' });
          return;
        }
        if (filtros.includes('JPXDecode') || filtros.includes('JBIG2Decode') || filtros.includes('CCITTFaxDecode')) {
          avisos.push(`página ${numero}: imagem ${largura}×${altura} em ${filtros.join('+')} — formato não convertido; abra o PDF para ver esta página.`);
          return;
        }
        const dados = doc.stream(ent);
        if (!dados) { avisos.push(`página ${numero}: imagem ${largura}×${altura} com filtro ${filtros.join('+') || 'nenhum'} não lida.`); return; }
        let cs = doc.resolver(d.ColorSpace); const bits = Number(doc.resolver(d.BitsPerComponent)) || 8;
        if (Array.isArray(cs) && cs[0] && cs[0].nome === 'ICCBased') { const icc = doc.resolver(cs[1]); const n = icc && Number(doc.resolver(icc.N)); cs = { nome: n === 1 ? 'DeviceGray' : n === 3 ? 'DeviceRGB' : 'DeviceCMYK' }; }
        let canais = cs && cs.nome === 'DeviceGray' ? 1 : cs && cs.nome === 'DeviceRGB' ? 3 : null;
        let pixels = dados;
        if (Array.isArray(cs) && cs[0] && cs[0].nome === 'Indexed' && bits === 8) {
          const baseCs = doc.resolver(cs[1]); const tabela = doc.resolver(cs[3]);
          const lut = Buffer.isBuffer(tabela) ? tabela : (tabela && tabela.ref != null ? doc.streamDe(tabela) : typeof tabela === 'string' ? Buffer.from(tabela, 'latin1') : null);
          const nb = baseCs && baseCs.nome === 'DeviceGray' ? 1 : 3;
          if (lut) { pixels = Buffer.alloc(largura * altura * nb); for (let p = 0; p < largura * altura; p++) lut.copy(pixels, p * nb, dados[p] * nb, dados[p] * nb + nb); canais = nb; }
        } else if (cs && cs.nome === 'DeviceCMYK' && bits === 8) {
          pixels = Buffer.alloc(largura * altura * 3);
          for (let p = 0; p < largura * altura; p++) { const [c, m, y, kk] = [dados[p * 4], dados[p * 4 + 1], dados[p * 4 + 2], dados[p * 4 + 3]]; pixels[p * 3] = 255 - Math.min(255, c + kk); pixels[p * 3 + 1] = 255 - Math.min(255, m + kk); pixels[p * 3 + 2] = 255 - Math.min(255, y + kk); }
          canais = 3;
        }
        if (!canais || !(bits === 8 || (bits === 1 && canais === 1))) { avisos.push(`página ${numero}: imagem ${largura}×${altura} (${bits} bits, espaço de cor não suportado) não convertida.`); return; }
        if (bits === 1) { const dec = doc.resolver(d.Decode); if (Array.isArray(dec) && dec[0] === 1) pixels = Buffer.from(pixels.map((b) => 255 - b)); }
        fs.writeFileSync(`${base}.png`, codificarPng(largura, altura, canais, bits, pixels));
        arquivos.push({ arquivo: `${base}.png`, largura, altura, formato: 'PNG' });
      } catch (e) { avisos.push(`página ${numero}: imagem não extraída (${e.message}).`); }
    });
    if (arquivos.length) {
      const maior = arquivos.reduce((a, x) => (x.largura * x.altura > a.largura * a.altura ? x : a));
      maior.principal = true;
    }
    saida.push({ pagina: numero, arquivos });
  });
  const semImagem = saida.filter((p) => !p.arquivos.length).map((p) => p.pagina);
  return { totalPaginas: pags.length, destino, paginas: saida, semImagem, avisos };
}
