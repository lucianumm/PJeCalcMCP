// pjecalc-mcp-skill · lib/pjc.mjs
// Leitura e gravação do arquivo de cálculo do PJe-Calc (.PJC).
//
// Formato (o mesmo de Exportar/Importar Cálculo do PJe-Calc):
//
//   .PJC = ZIP com UMA entrada "<nome>.PJC" contendo XML ISO-8859-1:
//     <?xml version="1.0" encoding="ISO-8859-1"?><Calculo> ... </Calculo>
//   - cada objeto é um elemento com o NOME SIMPLES DA CLASSE Java (Calculo, Calculada, Reflexo...)
//     e um filho por CAMPO JPA (nome do campo Java), inclusive os herdados;
//   - campo simples: texto. "null" = nulo; datas = milissegundos desde 1970 (fuso GMT-3);
//     Boolean = true/false; enum = nome da constante; BigDecimal/Long/Integer = texto numérico;
//   - campo objeto: <campo><Classe>...</Classe></campo>;
//   - coleção: <campo><Set>|<List> ...objetos... </Set>|</List></campo>;
//   - um objeto já escrito volta como <Classe><internalRef>ID</internalRef></Classe> (resolvido pelo
//     id + classe dentro do próprio arquivo); ids das entidades do cálculo são descartados na
//     importação (o banco gera novos);
//   - entidades de tabela (fora de dominio.calculo, ex.: Municipio, AssuntoCnj, Feriado) vão como
//     <Classe><externalRef>CHAVE</externalRef></Classe> e são carregadas do banco pela chave
//     (id, uid ou sigla);
//   - texto escapado como no exportador do PJe-Calc: & < > " ' e todo
//     caractere > 0x7F como &#NNN; ; fora do Latin-1 o exportador grava "?".
//
// Representação em memória (árvore JS):
//   objeto   = { $classe: 'Calculada', campos: [[nome, valor], ...] }   (ordem preservada)
//   valor    = string | null | objeto | colecao | ref | ext | refCrua
//   colecao  = { $colecao: 'Set'|'List', itens: [objeto|ref|ext|refCrua, ...] }
//   ref      = { $ref: 'Classe', id: '1' }      -> <Classe><internalRef>1</internalRef></Classe>
//   ext      = { $ext: 'Classe', id: '427' }    -> <Classe><externalRef>427</externalRef></Classe>
//   refCrua  = { $refCrua: 'internalRef'|'externalRef', id: 'null'|'' } -> <internalRef>null</internalRef>

import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// ZIP mínimo (uma ou mais entradas, deflate) — sem dependências
// ---------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dataDos(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function zipar(entradas) {
  const locais = [];
  const central = [];
  let offset = 0;
  const { time, date } = dataDos();
  for (const { nome, dados } of entradas) {
    const nomeBuf = Buffer.from(nome, 'latin1');
    const comp = zlib.deflateRawSync(dados);
    const crc = crc32(dados);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(dados.length, 22);
    lh.writeUInt16LE(nomeBuf.length, 26); lh.writeUInt16LE(0, 28);
    locais.push(lh, nomeBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(dados.length, 24); ch.writeUInt16LE(nomeBuf.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, nomeBuf);
    offset += lh.length + nomeBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(0, 4); fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(centralBuf.length, 12); fim.writeUInt32LE(offset, 16); fim.writeUInt16LE(0, 20);
  return Buffer.concat([...locais, centralBuf, fim]);
}

export function deszipar(buf) {
  // localiza o "end of central directory"
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo não é um ZIP válido (.PJC deve ser ZIP).');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Diretório central do ZIP corrompido.');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenCom = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + lenNome).toString('latin1');
    const lnome = buf.readUInt16LE(offLocal + 26);
    const lextra = buf.readUInt16LE(offLocal + 28);
    const ini = offLocal + 30 + lnome + lextra;
    const comp = buf.subarray(ini, ini + tamComp);
    const dados = metodo === 0 ? Buffer.from(comp) : metodo === 8 ? zlib.inflateRawSync(comp) : null;
    if (!dados) throw new Error(`Método de compressão ZIP não suportado: ${metodo}`);
    out.push({ nome, dados });
    p += 46 + lenNome + lenExtra + lenCom;
  }
  return out;
}

// ---------------------------------------------------------------------------
// XML <-> árvore
// ---------------------------------------------------------------------------

function desescapar(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCharCode(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

/** Escapa texto como o exportador do PJe-Calc, depois de limitar ao Latin-1. */
export function escapar(s) {
  let t = String(s).normalize('NFC');
  let out = '';
  for (const ch of t) {
    let c = ch.codePointAt(0);
    let x = ch;
    if (c > 0xff) {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      x = base && base.codePointAt(0) <= 0xff ? base : '?';
      c = x.codePointAt(0);
    }
    if (x === '&') out += '&amp;';
    else if (x === '<') out += '&lt;';
    else if (x === '>') out += '&gt;';
    else if (x === '"') out += '&quot;';
    else if (x === "'") out += '&apos;';
    else if (c > 0x7f) out += `&#${c};`;
    else out += x;
  }
  return out;
}

/** Tokeniza o XML do .PJC (sem atributos, sem CDATA) em uma árvore de nós {nome, filhos, texto}. */
function parseXml(xml) {
  let i = xml.indexOf('?>');
  i = i >= 0 ? i + 2 : 0;
  const raiz = { nome: '#doc', filhos: [], texto: '' };
  const pilha = [raiz];
  const re = /<(\/?)([A-Za-z_][\w.\-]*)\s*(\/?)>|([^<]+)/g;
  re.lastIndex = i;
  let m;
  while ((m = re.exec(xml))) {
    const topo = pilha[pilha.length - 1];
    if (m[4] !== undefined) {
      topo.texto += m[4];
      continue;
    }
    const [, fecha, nome, auto] = m;
    if (fecha) {
      const n = pilha.pop();
      if (n.nome !== nome) throw new Error(`XML malformado: </${nome}> fecha <${n.nome}>`);
    } else {
      const no = { nome, filhos: [], texto: '' };
      topo.filhos.push(no);
      if (!auto) pilha.push(no);
    }
  }
  if (pilha.length !== 1) throw new Error('XML malformado: elementos não fechados.');
  return raiz.filhos[0];
}

function noParaValor(no) {
  // no = elemento de CAMPO
  if (!no.filhos.length) {
    const t = desescapar(no.texto);
    return t.trim() === 'null' ? null : t;
  }
  const f = no.filhos[0];
  if (f.nome === 'Set' || f.nome === 'List') {
    return { $colecao: f.nome, itens: f.filhos.map(noParaItem) };
  }
  return noParaItem(f);
}

function noParaItem(f) {
  // f = elemento de CLASSE (ou internalRef/externalRef "cru")
  if (f.nome === 'internalRef' || f.nome === 'externalRef') {
    return { $refCrua: f.nome, id: desescapar(f.texto).trim() };
  }
  if (f.filhos.length === 1 && (f.filhos[0].nome === 'internalRef' || f.filhos[0].nome === 'externalRef')) {
    const id = desescapar(f.filhos[0].texto).trim();
    return f.filhos[0].nome === 'internalRef' ? { $ref: f.nome, id } : { $ext: f.nome, id };
  }
  return { $classe: f.nome, campos: f.filhos.map((c) => [c.nome, noParaValor(c)]) };
}

/** Lê o XML do .PJC e devolve a árvore do objeto Calculo. */
export function xmlParaArvore(xml) {
  const raiz = parseXml(xml);
  if (!raiz || raiz.nome !== 'Calculo') throw new Error(`Raiz inesperada no .PJC: <${raiz && raiz.nome}> (esperado <Calculo>).`);
  return noParaItem(raiz);
}

function valorParaXml(v, partes) {
  if (v === null || v === undefined) { partes.push('null'); return; }
  if (typeof v !== 'object') { partes.push(escapar(v)); return; }
  if (v.$colecao) {
    partes.push(`<${v.$colecao}>`);
    for (const it of v.itens) itemParaXml(it, partes);
    partes.push(`</${v.$colecao}>`);
    return;
  }
  itemParaXml(v, partes);
}

function itemParaXml(it, partes) {
  if (it.$refCrua) {
    partes.push(`<${it.$refCrua}>${escapar(it.id)}</${it.$refCrua}>`);
  } else if (it.$ref) {
    partes.push(`<${it.$ref}><internalRef>${escapar(it.id)}</internalRef></${it.$ref}>`);
  } else if (it.$ext) {
    partes.push(`<${it.$ext}><externalRef>${escapar(it.id)}</externalRef></${it.$ext}>`);
  } else if (it.$classe) {
    partes.push(`<${it.$classe}>`);
    for (const [nome, valor] of it.campos) {
      partes.push(`<${nome}>`);
      valorParaXml(valor, partes);
      partes.push(`</${nome}>`);
    }
    partes.push(`</${it.$classe}>`);
  } else {
    throw new Error(`Valor inválido na árvore: ${JSON.stringify(it).slice(0, 120)}`);
  }
}

export function arvoreParaXml(arvore) {
  const partes = ['<?xml version="1.0" encoding="ISO-8859-1"?>'];
  itemParaXml(arvore, partes);
  return partes.join('');
}

// ---------------------------------------------------------------------------
// Arquivo .PJC
// ---------------------------------------------------------------------------

export function lerPjc(bytes) {
  const entradas = deszipar(Buffer.from(bytes));
  const e = entradas.find((x) => /\.pjc$/i.test(x.nome)) || entradas[0];
  if (!e) throw new Error('O .PJC não contém nenhum arquivo.');
  const xml = e.dados.toString('latin1');
  return { nomeInterno: e.nome, xml, arvore: xmlParaArvore(xml) };
}

export function gravarPjc(arvore, nomeInterno = 'CALCULO.PJC') {
  const xml = arvoreParaXml(arvore);
  const dados = Buffer.from(xml, 'latin1');
  return zipar([{ nome: nomeInterno.toUpperCase().endsWith('.PJC') ? nomeInterno : `${nomeInterno}.PJC`, dados }]);
}

// ---------------------------------------------------------------------------
// Utilidades sobre a árvore
// ---------------------------------------------------------------------------

export function campo(obj, nome) {
  if (!obj || !obj.campos) return undefined;
  const c = obj.campos.find(([n]) => n === nome);
  return c ? c[1] : undefined;
}

export function definir(obj, nome, valor) {
  const c = obj.campos.find(([n]) => n === nome);
  if (c) c[1] = valor;
  else obj.campos.push([nome, valor]);
  return obj;
}

export function itens(colecao) {
  return colecao && colecao.$colecao ? colecao.itens : [];
}

/** Percorre todos os objetos inline (não referências). */
export function* objetos(no) {
  if (!no || typeof no !== 'object') return;
  if (no.$classe) {
    yield no;
    for (const [, v] of no.campos) yield* objetos(v);
  } else if (no.$colecao) {
    for (const it of no.itens) yield* objetos(it);
  }
}

/** Cópia profunda. */
export function clonar(no) {
  return JSON.parse(JSON.stringify(no));
}

// datas: o PJe-Calc roda com -Duser.timezone=GMT-3 e grava java.util.Date em ms
const FUSO_MS = 3 * 3600 * 1000;

/** "2015-06-10" | "10/06/2015" | Date -> texto em ms (meia-noite de Brasília, GMT-3). */
export function dataMs(d) {
  if (d === null || d === undefined || d === '') return null;
  if (d instanceof Date) return String(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + FUSO_MS);
  const s = String(d).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return String(Date.UTC(+m[1], +m[2] - 1, +m[3]) + FUSO_MS);
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return String(Date.UTC(+m[3], +m[2] - 1, +m[1]) + FUSO_MS);
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return String(Date.UTC(+m[1], +m[2] - 1, 1) + FUSO_MS);
  m = /^(\d{2})\/(\d{4})$/.exec(s);
  if (m) return String(Date.UTC(+m[2], +m[1] - 1, 1) + FUSO_MS);
  if (/^\d{9,}$/.test(s)) return s;
  throw new Error(`Data inválida: "${d}" (use AAAA-MM-DD ou DD/MM/AAAA).`);
}

/** ms (texto) -> "AAAA-MM-DD" */
export function msParaData(ms) {
  if (ms === null || ms === undefined) return null;
  const d = new Date(Number(ms) - FUSO_MS);
  return d.toISOString().slice(0, 10);
}
