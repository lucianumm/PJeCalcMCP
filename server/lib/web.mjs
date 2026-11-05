// pjecalc-mcp-skill · lib/web.mjs
// Cliente HTTP da interface web do PJe-Calc (Seam 2.2 + JSF 1.2 + RichFaces/A4J 3.3).
//
// A interface do PJe-Calc é a única porta de entrada "oficial" para importar, abrir,
// regerar ocorrências e liquidar um cálculo: as regras de negócio rodam no servidor quando
// os botões são acionados. Este módulo reproduz, por HTTP puro, o que o navegador faz:
//
//   - sessão: cookie JSESSIONID (a versão Cidadão entra sozinha como usuário "offline");
//   - formulário JSF "formulario" com javax.faces.ViewState (estado no servidor);
//   - cliques AJAX (A4J.AJAX.Submit): POST com AJAXREQUEST=<container> + parâmetro do
//     componente; navegação volta como cabeçalho "Ajax-Response: redirect" + "Location";
//   - cliques comuns (h:commandLink/h:commandButton): POST do formulário + id do componente;
//   - envio de arquivo do rich:fileUpload: POST multipart para a URL do formulário com os
//     parâmetros _richfaces_upload_uid / _richfaces_upload_file_indicator.
//
// Sem dependências externas (fetch/FormData/Blob nativos do Node >= 20).

import { baseUrl } from './rest.mjs';

// ---------------------------------------------------------------------------
// HTML utilitário (o HTML gerado pelo JSF é regular: atributos sempre entre aspas duplas)
// ---------------------------------------------------------------------------

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodificarEntidades(s) {
  if (!s) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const k = e.toLowerCase();
    if (k in ENTIDADES) return ENTIDADES[k];
    const i = LATIN1.indexOf(e);
    return i >= 0 ? String.fromCharCode(161 + i) : m;
  });
}

// nomes HTML 4 das entidades U+00A1..U+00FF, na ordem (o Facelets emite &ordm;, &ccedil; etc.)
const LATIN1 = ('iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
  + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
  + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');

export function atributos(tag) {
  const out = {};
  const re = /([\w:.\-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = decodificarEntidades(m[2]);
  // atributos booleanos sem valor (checked, selected, disabled)
  for (const b of ['checked', 'selected', 'disabled', 'readonly', 'multiple']) {
    if (new RegExp(`\\s${b}(\\s|/|>|$)`, 'i').test(tag) && !(b in out)) out[b] = b;
  }
  return out;
}

export function textoPuro(html) {
  return decodificarEntidades(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|fieldset|legend|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Extrai o bloco <form id="..."> ... </form>. */
function blocoFormulario(html, formId) {
  const re = new RegExp(`<form[^>]*\\sid="${formId.replace(/[:.]/g, '\\$&')}"[^>]*>`, 'i');
  const m = re.exec(html);
  if (!m) return null;
  const ini = m.index;
  const fim = html.indexOf('</form>', ini);
  return { tag: m[0], html: html.slice(ini, fim < 0 ? html.length : fim) };
}

/** Lê os campos de um formulário como o navegador os enviaria. */
export function camposDoFormulario(html, formId = 'formulario') {
  const bloco = blocoFormulario(html, formId);
  if (!bloco) return null;
  const attrsForm = atributos(bloco.tag);
  const campos = [];
  const inputs = bloco.html.match(/<input\b[^>]*>/gi) || [];
  for (const t of inputs) {
    const a = atributos(t);
    if (!a.name || 'disabled' in a) continue;
    const tipo = (a.type || 'text').toLowerCase();
    if (['submit', 'button', 'image', 'reset', 'file'].includes(tipo)) continue;
    if ((tipo === 'checkbox' || tipo === 'radio') && !('checked' in a)) continue;
    campos.push([a.name, a.value ?? (tipo === 'checkbox' ? 'on' : '')]);
  }
  const selects = bloco.html.match(/<select\b[\s\S]*?<\/select>/gi) || [];
  for (const s of selects) {
    const a = atributos(s.match(/<select\b[^>]*>/i)[0]);
    if (!a.name || 'disabled' in a) continue;
    const opts = (s.match(/<option\b[^>]*>[\s\S]*?(?=<option\b|<\/select>)/gi) || []).map((o) => {
      const oa = atributos(o.match(/<option\b[^>]*>/i)[0]);
      return { value: oa.value ?? textoPuro(o.replace(/<option\b[^>]*>/i, '')), selected: 'selected' in oa };
    });
    const sel = opts.filter((o) => o.selected);
    if (sel.length) sel.forEach((o) => campos.push([a.name, o.value]));
    else if (!('multiple' in a) && opts.length && !/size="\d+"/.test(s.slice(0, 300))) campos.push([a.name, opts[0].value]);
  }
  const areas = bloco.html.match(/<textarea\b[\s\S]*?<\/textarea>/gi) || [];
  for (const ta of areas) {
    const a = atributos(ta.match(/<textarea\b[^>]*>/i)[0]);
    if (!a.name) continue;
    campos.push([a.name, decodificarEntidades(ta.replace(/<textarea\b[^>]*>/i, '').replace(/<\/textarea>$/i, ''))]);
  }
  return { action: attrsForm.action, enctype: attrsForm.enctype || '', campos };
}

/**
 * Elementos clicáveis da página: links/botões com A4J.AJAX.Submit ou jsfcljs (commandLink),
 * botões h:commandButton (submit simples) e eventos a4j:support em selects/inputs.
 */
export function clicaveis(html) {
  const out = [];
  const re = /<(a|input|select|button|span|div|td|img)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tagName = m[1].toLowerCase();
    const a = atributos(m[0]);
    for (const ev of ['onclick', 'ondblclick', 'onchange', 'onkeypress', 'onkeyup', 'onblur', 'oncomplete']) {
      const js = a[ev];
      if (!js) continue;
      const ajax = /A4J\.AJAX\.Submit\('([^']+)',event,(\{[\s\S]*\})\s*\)/.exec(js);
      if (ajax) {
        const opcoes = ajax[2];
        const params = {};
        const pm = /'parameters':\{([^}]*)\}/.exec(opcoes);
        if (pm) {
          const pr = /'([^']+)':'([^']*)'/g;
          let p;
          while ((p = pr.exec(pm[1]))) params[p[1]] = p[2];
        }
        const cont = /'containerId':'([^']+)'/.exec(opcoes);
        const sim = /'similarityGroupingId':'([^']+)'/.exec(opcoes);
        const actionUrl = /'actionUrl':'([^']+)'/.exec(opcoes);
        out.push({
          tipo: 'ajax', evento: ev, tag: tagName, id: a.id || null, name: a.name || null,
          formId: ajax[1], params, containerId: cont ? cont[1] : null, componente: sim ? sim[1] : null,
          actionUrl: actionUrl ? actionUrl[1] : null,
          valor: a.value || null, titulo: a.title || null, confirma: /confirma\(/.test(js), _pos: m.index,
        });
        continue;
      }
      const cl = /jsfcljs\(document\.getElementById\('([^']+)'\),\{([^}]*)\}/.exec(js);
      if (cl) {
        const params = {};
        const pr = /'([^']+)':'([^']*)'/g;
        let p;
        while ((p = pr.exec(cl[2]))) params[p[1]] = p[2];
        out.push({ tipo: 'submit', evento: ev, tag: tagName, id: a.id || null, name: a.name || null, formId: cl[1], params, valor: a.value || null, titulo: a.title || null, _pos: m.index });
      }
    }
    if (tagName === 'input' && /^(submit|image)$/i.test(a.type || '') && a.name && !(a.onclick && /A4J\.AJAX\.Submit/.test(a.onclick))) {
      out.push({ tipo: 'submit', evento: 'click', tag: tagName, id: a.id || null, name: a.name, formId: 'formulario', params: { [a.name]: a.value || a.name }, valor: a.value || null, titulo: a.title || null, _pos: m.index });
    }
  }
  // rótulo visível: texto do link (para <a>) ou value/title (para botões)
  for (const c of out) {
    if (c.tag === 'a') {
      const fim = html.indexOf('</a>', c._pos);
      const ini = html.indexOf('>', c._pos) + 1;
      c.texto = fim > 0 ? textoPuro(html.slice(ini, fim)) : '';
    } else {
      c.texto = c.valor || c.titulo || '';
    }
    delete c._pos;
  }
  return out;
}

/** Opções de um <select name="..."> como [{ valor, texto, selecionada }]. */
export function opcoesDoSelect(html, nome) {
  const ini = html.indexOf(`name="${nome}"`);
  if (ini < 0) return [];
  const abre = html.lastIndexOf('<select', ini);
  const fim = html.indexOf('</select>', ini);
  const bloco = html.slice(abre, fim);
  return [...bloco.matchAll(/<option\b([^>]*)>([^<]*)/g)].map((m) => ({
    valor: (atributos(`<option${m[1]}>`).value ?? ''),
    texto: textoPuro(m[2]),
    selecionada: /selected/.test(m[1]),
  }));
}

/** Mensagens de erro/aviso/sucesso exibidas pelo JSF/Seam (rich:messages, h:messages). */
export function mensagens(html) {
  const out = [];
  const re = /<(span|li|div|dt|td)\b[^>]*class="[^"]*(rich-messages-label|rich-message-label|msgErro|msgAlerta|msgSucesso|msgInfo|errorMessage|infoMessage|warnMessage|rich-msgs|mensagem)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = textoPuro(m[3]);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sessão HTTP
// ---------------------------------------------------------------------------

function charsetDe(ct) {
  const m = /charset=([\w-]+)/i.exec(ct || '');
  const c = (m ? m[1] : 'iso-8859-1').toLowerCase();
  return c === 'iso-8859-1' || c === 'latin1' ? 'latin1' : c;
}

/** Codifica um formulário x-www-form-urlencoded na codificação indicada (latin1 ou utf-8). */
function codificarForm(campos, charset = 'utf-8') {
  const enc = (s) => {
    if (charset === 'latin1') {
      const buf = Buffer.from(String(s), 'latin1');
      let out = '';
      for (const b of buf) {
        const ch = String.fromCharCode(b);
        out += /[A-Za-z0-9*\-._]/.test(ch) ? ch : b === 0x20 ? '+' : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
      }
      return out;
    }
    return encodeURIComponent(String(s)).replace(/%20/g, '+');
  };
  return campos.map(([k, v]) => `${enc(k)}=${enc(v ?? '')}`).join('&');
}

export class Pagina {
  constructor(url, html, status = 200) {
    this.url = url;
    this.html = html;
    this.status = status;
  }
  get form() { return camposDoFormulario(this.html, 'formulario'); }
  get clicaveis() { return clicaveis(this.html); }
  get texto() { return textoPuro(this.html); }
  get mensagens() { return mensagens(this.html); }
  get conversationId() {
    const m = /conversationId=(\d+)/.exec(this.url) || /conversationId=(\d+)/.exec(this.html);
    return m ? m[1] : null;
  }
  get erroInterno() { return /Erro Interno no Servidor|Ocorreu um erro inesperado/i.test(this.html); }
}

export class SessaoPjeCalc {
  constructor(base = null) {
    this.base = (base || baseUrl()).replace(/\/$/, '');
    this.cookies = new Map();
    this.pagina = null; // última página completa
  }

  _cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  _guardarCookies(res) {
    const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of lista) {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  url(p) {
    if (/^https?:/i.test(p)) return p;
    return `${this.base}${p.startsWith('/') ? '' : '/pjecalc/'}${p}`;
  }

  async _fetch(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookies.size) headers.Cookie = this._cookieHeader();
    const res = await fetch(this.url(url), { ...opts, headers, redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs || 180000) });
    this._guardarCookies(res);
    return res;
  }

  /** GET de uma página completa (segue redirecionamentos HTTP). */
  async get(p) {
    let url = this.url(p);
    for (let i = 0; i < 6; i++) {
      const res = await this._fetch(url);
      if ([301, 302, 303, 307].includes(res.status)) {
        url = new URL(res.headers.get('location'), url).toString();
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const html = new TextDecoder(charsetDe(res.headers.get('content-type'))).decode(buf);
      this.pagina = new Pagina(url, html, res.status);
      return this.pagina;
    }
    throw new Error(`Redirecionamentos demais a partir de ${p}`);
  }

  /** Página inicial (cria a sessão, login automático "offline"). */
  async inicio() {
    return this.get('/pjecalc/pages/principal.jsf');
  }

  /**
   * Envia o formulário atual com os campos alterados em `valores` e o parâmetro do
   * componente acionado. Para cliques AJAX, segue o redirecionamento A4J (GET da nova
   * página); sem redirecionamento, recarrega a página atual da conversa para devolver o
   * estado completo.
   */
  async enviar(clicavel, valores = {}, { pagina = null, recarregar = true, binario = false, removerCampos = [] } = {}) {
    const pg = pagina || this.pagina;
    if (!pg) throw new Error('Nenhuma página carregada.');
    const formId = clicavel?.formId || 'formulario';
    const form = camposDoFormulario(pg.html, formId);
    if (!form) throw new Error(`Formulário ${formId} não encontrado em ${pg.url}`);
    // aplica valores (substitui todos os campos com o mesmo nome; arrays = múltiplos)
    let campos = form.campos.filter(([k]) => !(k in valores) && !removerCampos.includes(k));
    for (const [k, v] of Object.entries(valores)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => campos.push([k, String(x)]));
      else campos.push([k, String(v)]);
    }
    const ajax = clicavel?.tipo === 'ajax';
    if (ajax) {
      campos.push(['AJAXREQUEST', clicavel.containerId || '_viewRoot']);
    }
    for (const [k, v] of Object.entries(clicavel?.params || {})) campos.push([k, v]);
    const action = clicavel?.actionUrl || form.action || pg.url;
    const corpo = codificarForm(campos, ajax ? 'utf-8' : 'latin1');
    const res = await this._fetch(action, {
      method: 'POST',
      body: corpo,
      headers: { 'Content-Type': `application/x-www-form-urlencoded; charset=${ajax ? 'UTF-8' : 'ISO-8859-1'}` },
    });
    const ct = res.headers.get('content-type') || '';
    const disp = res.headers.get('content-disposition');
    if (binario || (disp && /attachment/i.test(disp))) {
      const buf = Buffer.from(await res.arrayBuffer());
      const nome = disp ? (/filename="?([^";]+)"?/i.exec(disp) || [])[1] : null;
      return { tipo: 'arquivo', status: res.status, contentType: ct, nome, bytes: buf };
    }
    const loc = res.headers.get('location');
    const ajaxResp = res.headers.get('ajax-response');
    const buf = Buffer.from(await res.arrayBuffer());
    const corpoTxt = new TextDecoder(charsetDe(ct)).decode(buf);
    if (loc && (ajaxResp === 'redirect' || [301, 302, 303].includes(res.status))) {
      return this.get(new URL(loc, this.url(action)).toString());
    }
    if (res.status >= 500) {
      const p = new Pagina(pg.url, corpoTxt, res.status);
      const err = new Error(`O PJe-Calc respondeu ${res.status} (erro interno) ao acionar ${clicavel?.id || clicavel?.texto || 'o formulário'}.`);
      err.pagina = p;
      throw err;
    }
    if (ajax) {
      const parcial = new Pagina(pg.url, corpoTxt, res.status);
      parcial.parcial = true;
      if (recarregar) {
        const nova = await this.get(pg.url);
        nova.respostaAjax = parcial;
        return nova;
      }
      return parcial;
    }
    this.pagina = new Pagina(this.url(action), corpoTxt, res.status);
    return this.pagina;
  }

  /** Localiza um clicável por id exato, por sufixo de id, por texto/valor/título. */
  achar(criterio, pagina = null) {
    const pg = pagina || this.pagina;
    const lista = clicaveis(pg.html);
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    if (typeof criterio === 'function') return lista.find(criterio) || null;
    const alvo = norm(criterio);
    return lista.find((c) => c.id === criterio)
      || lista.find((c) => c.id && c.id.endsWith(`:${criterio}`))
      || lista.find((c) => norm(c.texto) === alvo)
      || lista.find((c) => norm(c.valor) === alvo || norm(c.titulo) === alvo)
      || null;
  }

  async clicar(criterio, valores = {}, opcoes = {}) {
    const c = this.achar(criterio, opcoes.pagina);
    if (!c) throw new Error(`Elemento "${criterio}" não encontrado na página ${this.pagina?.url}`);
    return this.enviar(c, valores, opcoes);
  }

  /** Navega pelo menu lateral (ex.: "Verbas", "FGTS", "Liquidar", "Exportar"). */
  async menu(rotulo) {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    const c = clicaveis(this.pagina.html).find((x) => x.tag === 'a' && x.id && /:j_id\d+:\d+:j_id\d+:\d+:j_id\d+$/.test(x.id) && norm(x.texto) === norm(rotulo));
    if (!c) throw new Error(`Item de menu "${rotulo}" não encontrado (abra um cálculo antes).`);
    return this.enviar(c);
  }

  /**
   * Envia um arquivo pelo componente rich:fileUpload (RichFaces 3.3).
   * O componente envia o arquivo num POST multipart para a URL do formulário com os
   * parâmetros de controle na query string; o servidor chama o fileUploadListener.
   */
  async enviarArquivoRichUpload(idComponente, nomeArquivo, bytes, contentType = 'application/octet-stream') {
    // Reproduz FileUpload.submitForm() do RichFaces 3.3: o formulário inteiro vai em multipart
    // para "<action>?_richfaces_upload_uid=<uid>&<id>=<id>&_richfaces_upload_file_indicator=true
    // &AJAXREQUEST=<container>", com o arquivo no campo "<id>:file". O servidor decodifica o
    // componente e chama o fileUploadListener do apresentador.
    const pg = this.pagina;
    const form = camposDoFormulario(pg.html, 'formulario');
    const m = new RegExp(`new FileUpload\\('${idComponente.replace(/[:.]/g, '\\$&')}','([^']+)'[\\s\\S]*?'containerId':'([^']+)'`).exec(pg.html);
    const actionUrl = m ? m[1] : (form.action || pg.url).replace(/;jsessionid=[^?]*/, '');
    const container = m ? m[2] : '_viewRoot';
    const uid = Math.random().toString();
    const sep = actionUrl.includes('?') ? '&' : '?';
    const url = `${actionUrl}${sep}_richfaces_upload_uid=${encodeURI(uid)}&${idComponente}=${idComponente}&_richfaces_upload_file_indicator=true&AJAXREQUEST=${container}`;
    const fd = new FormData();
    for (const [k, v] of form.campos) fd.append(k, v);
    fd.append(`${idComponente}:file`, new Blob([bytes], { type: contentType }), nomeArquivo);
    const res = await this._fetch(url, { method: 'POST', body: fd });
    const txt = await res.text();
    if (res.status >= 400) throw new Error(`Falha no envio do arquivo (${res.status}).`);
    return { status: res.status, uid, corpo: txt.slice(0, 2000) };
  }
}
