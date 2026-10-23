// pjecalc-mcp-skill · lib/gerador.mjs
// Gerador de cálculo do PJe-Calc (.PJC) a partir de uma especificação JSON em português.
//
// Princípio: tudo o que o arquivo contém vem de modelos exportados pelo próprio PJe-Calc
// (lib/modelos.mjs). O gerador só copia esses modelos e troca os valores do caso concreto.
// As ocorrências mensais de verbas, FGTS e contribuição social NÃO são geradas aqui: o PJe-Calc as
// regera (botão "Regerar" em Verbas) e as calcula na liquidação — exatamente como na interface.
//
// Especificação completa e exemplos: references/ESPECIFICACAO-CALCULO.md e a ferramenta
// calculo_modelo_json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarModelo } from './modelos.mjs';
import { campo, definir, itens, objetos, clonar, dataMs, msParaData } from './pjc.mjs';
import { conferirEsquema } from './esquema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let MODELO_DOMINIO = null;
function dominio() {
  if (!MODELO_DOMINIO) MODELO_DOMINIO = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'modelos', 'modelo-pjc.json'), 'utf-8'));
  return MODELO_DOMINIO;
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

class ErroEspecificacao extends Error {}

function erro(msg) { throw new ErroEspecificacao(msg); }

/** Número -> texto BigDecimal com casas fixas ("1500.00"). Aceita "1.500,00" e "1500,5". Sem erro de ponto flutuante. */
export function dec(v, casas = 2) {
  if (v === null || v === undefined || v === '') return null;
  let s = typeof v === 'number' ? String(v) : String(v).trim();
  if (typeof v !== 'number') {
    if (/,\d+$/.test(s) || /\.\d{3},/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s) || !Number.isFinite(Number(s))) erro(`Valor numérico inválido: ${JSON.stringify(v)}`);
  if (/e/i.test(s)) s = Number(s).toFixed(Math.min(casas, 20));
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  let [int, frac = ''] = s.split('.');
  if (frac.length > casas) {
    // arredondamento meio-para-cima na casa pedida, feito em texto
    const corte = frac.slice(0, casas);
    const prox = Number(frac[casas]);
    let num = BigInt(int + corte) + (prox >= 5 ? 1n : 0n);
    let txt = num.toString().padStart(casas + 1, '0');
    int = txt.slice(0, txt.length - casas) || '0';
    frac = txt.slice(txt.length - casas);
  } else frac = frac.padEnd(casas, '0');
  return `${neg ? '-' : ''}${int}${casas ? `.${frac}` : ''}`;
}

const bool = (v) => (v ? 'true' : 'false');
const sn = (v) => (v ? 'SIM' : 'NAO');

/** Valida um valor de enum do PJe-Calc (nome da constante) e devolve-o em maiúsculas. */
export function enumValido(nomeEnum, valor, contexto) {
  if (valor === null || valor === undefined) return null;
  const lista = (dominio().enums[nomeEnum] || []).map((e) => e.nome);
  const v = String(valor).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!lista.includes(v)) erro(`${contexto}: "${valor}" não é válido. Valores aceitos (${nomeEnum}): ${lista.join(', ')}`);
  return v;
}

function apenasDigitos(s) { return s === null || s === undefined ? null : String(s).replace(/\D/g, ''); }

export function cpfValido(c) {
  const d = apenasDigitos(c);
  if (!d || d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(c) {
  const d = apenasDigitos(c);
  if (!d || d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * p[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Número CNJ "NNNNNNN-DD.AAAA.J.TR.OOOO" -> partes e validação do dígito (Res. CNJ 65/2008). */
export function numeroCnj(numero) {
  const m = /^(\d{1,7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})$/.exec(String(numero).trim());
  if (!m) erro(`Número do processo "${numero}" fora do padrão CNJ NNNNNNN-DD.AAAA.J.TR.OOOO.`);
  const [, n, dd, ano, j, tr, oooo] = m;
  const resto = BigInt(`${n.padStart(7, '0')}${ano}${j}${tr}${oooo}00`) % 97n;
  const esperado = 98 - Number(resto);
  return { numero: Number(n), digito: Number(dd), ano: Number(ano), justica: Number(j), regiao: Number(tr), vara: Number(oooo), digitoCorreto: esperado === Number(dd), digitoEsperado: String(esperado).padStart(2, '0') };
}

/**
 * A ocorrência de pagamento da verba precisa caber no período dela, senão o PJe-Calc não gera nada (ou recusa
 * regerar). Casos vistos em cálculo real:
 *  - DESLIGAMENTO com o período terminando antes do mês da demissão: a regeração é recusada ("A data final não
 *    pode ser anterior ao primeiro dia do mês/ano da demissão");
 *  - DEZEMBRO (13º) sem nenhum dezembro no período e sem chegar à demissão: nenhuma ocorrência;
 *  - PERIODO_AQUISITIVO (férias) num período curto que não fecha aquisitivo nem chega à demissão: nenhuma ocorrência;
 *  - "data" única com quantidade em avos: o mês tem menos de 15 dias no período e os avos saem zerados.
 * Para avos deferidos pelo título num mês certo (ex.: 13º proporcional 5/12 do período sem registro), use
 * ocorrenciaDePagamento MENSAL, período dentro do mês do vencimento e quantidade INFORMADA com os avos.
 */
function conferirOcorrenciaPossivel(principal, { v, personalizada, ctx, pIni, pFim, demissao, dataUnica }) {
  const p = personalizada || v;
  const ocor = campo(principal, 'ocorrenciaDePagamento');
  const ini = msParaData(pIni); const fim = msParaData(pFim);
  const dem = demissao ? msParaData(demissao) : null;
  const chegaNaDemissao = dem && fim.slice(0, 7) >= dem.slice(0, 7);
  const sugestao = 'para um valor devido num mês certo, use "ocorrenciaDePagamento": "MENSAL", um "periodo" dentro desse mês e "quantidade": { "tipo": "INFORMADA", "valor": <avos ou quantidade deferida> }';
  if (ocor === 'DESLIGAMENTO' && dem && !chegaNaDemissao) erro(`${ctx}: ocorrência DESLIGAMENTO com o período terminando em ${fim}, antes do mês da demissão (${dem}): o PJe-Calc recusa regerar ("A data final não pode ser anterior ao primeiro dia do mês/ano da demissão"). Termine o período na demissão ou ${sugestao}.`);
  if (ocor === 'DEZEMBRO') {
    const anos = []; for (let a = Number(ini.slice(0, 4)); a <= Number(fim.slice(0, 4)); a++) anos.push(a);
    const temDezembro = anos.some((a) => `${a}-12-01` <= fim && `${a}-12-31` >= ini);
    if (!temDezembro && !chegaNaDemissao) erro(`${ctx}: ocorrência DEZEMBRO, mas o período ${ini} a ${fim} não tem dezembro nem chega à demissão: o PJe-Calc não gera nenhuma ocorrência e a verba sai vazia. Estenda o período até dezembro (ou até a demissão) ou ${sugestao}.`);
  }
  if (ocor === 'PERIODO_AQUISITIVO' && !chegaNaDemissao) {
    const umAno = new Date(`${ini}T00:00:00Z`); umAno.setUTCFullYear(umAno.getUTCFullYear() + 1); umAno.setUTCDate(umAno.getUTCDate() - 1);
    if (umAno.toISOString().slice(0, 10) > fim) erro(`${ctx}: ocorrência PERIODO_AQUISITIVO, mas o período ${ini} a ${fim} não completa um período aquisitivo nem chega à demissão: o PJe-Calc não gera nenhuma ocorrência. Use o período do contrato (a tela de Férias decide vencidas e proporcionais) ou ${sugestao}.`);
  }
  if (dataUnica != null) {
    const formula = campo(principal, 'formula');
    const q = formula ? campo(formula, 'quantidade') : null;
    if (q && campo(q, 'tipo') === 'AVOS' && !(p.quantidade != null)) erro(`${ctx}: verba de "data" única com quantidade em avos: um dia não completa os 15 dias do mês e os avos saem zerados. Informe "quantidade": { "tipo": "INFORMADA", "valor": <avos deferidos> } (e "ocorrenciaDePagamento": "MENSAL").`);
  }
}

function data(v, contexto, obrigatoria = false) {
  if (v === null || v === undefined || v === '') {
    if (obrigatoria) erro(`${contexto}: data obrigatória.`);
    return null;
  }
  try { return dataMs(v); } catch (e) { erro(`${contexto}: ${e.message}`); }
}

// competência "AAAA-MM" ou "MM/AAAA" -> {ano, mes}
function competencia(v, contexto) {
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(s);
  if (m) return { ano: +m[1], mes: +m[2] };
  m = /^(\d{2})\/(\d{4})$/.exec(s);
  if (m) return { ano: +m[2], mes: +m[1] };
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return { ano: +m[3], mes: +m[2] };
  erro(`${contexto}: competência inválida "${v}" (use AAAA-MM ou MM/AAAA).`);
}

const compChave = ({ ano, mes }) => ano * 12 + (mes - 1);
const compDeChave = (k) => ({ ano: Math.floor(k / 12), mes: (k % 12) + 1 });
const compData = ({ ano, mes }) => `${ano}-${String(mes).padStart(2, '0')}-01`;

/**
 * Edições das ocorrências de FGTS ou de contribuição social: `competencia` (AAAA-MM) ou o intervalo `de`/`ate`
 * (a alteração em lote da tela), mais os campos a alterar. Confere formato, período e valores e devolve a lista
 * normalizada; as ocorrências só são editadas depois que o PJe-Calc as gera.
 */
function edicoesDeEncargo(lista, ctx, campos, [ini, fim]) {
  if (!Array.isArray(lista)) erro(`${ctx}: use uma lista de { competencia | de, ate, ${campos.join(', ')} }.`);
  const kIni = compChave(competencia(msParaData(ini), ctx));
  const kFim = compChave(competencia(msParaData(fim), ctx));
  const txtComp = (k) => compData(compDeChave(k)).slice(0, 7);
  return lista.map((e, j) => {
    const c = `${ctx}[${j}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) erro(`${c}: cada item é um objeto { competencia | de, ate, ${campos.join(', ')} }.`);
    if (e.competencia != null && (e.de != null || e.ate != null)) erro(`${c}: use "competencia" ou o intervalo "de"/"ate", não os dois.`);
    if (e.competencia == null && e.de == null) erro(`${c}: informe "competencia" (AAAA-MM) ou o intervalo "de"/"ate" (alteração em lote).`);
    const de = compChave(competencia(e.competencia ?? e.de, `${c}.${e.competencia != null ? 'competencia' : 'de'}`));
    const ate = compChave(competencia(e.competencia ?? e.ate ?? e.de, `${c}.ate`));
    if (ate < de) erro(`${c}: "ate" anterior a "de".`);
    if (de < kIni || ate > kFim) erro(`${c}: ${txtComp(de)}${ate !== de ? ` a ${txtComp(ate)}` : ''} fora do período das ocorrências (${txtComp(kIni)} a ${txtComp(kFim)}).`);
    if (!campos.some((k) => e[k] != null)) erro(`${c}: nada a alterar (${campos.join(', ')}).`);
    const out = e.competencia != null ? { competencia: txtComp(de) } : { de: txtComp(de), ate: txtComp(ate) };
    if (e.decimoTerceiro != null) out.decimoTerceiro = Boolean(e.decimoTerceiro);
    for (const k of campos) {
      if (e[k] == null) continue;
      if (k === 'aliquota') {
        const a = String(e[k]).trim().toUpperCase();
        if (!['2', '8', 'DOIS_POR_CENTO', 'OITO_POR_CENTO'].includes(a)) erro(`${c}.aliquota: use 2 ou 8 (%).`);
        out[k] = a;
        continue;
      }
      const v = dec(e[k]);
      if (Number(v) < 0) erro(`${c}.${k}: valor negativo.`);
      out[k] = v;
    }
    return out;
  });
}

/** Custas fixas: campo da especificação -> [quantidade no .PJC, valor unitário gravado pela liquidação]. */
export const CUSTAS_FIXAS = {
  atosUrbanos: ['qtdeAtosUrbanos', 'valorAtosUrbanos'],
  atosRurais: ['qtdeAtosRurais', 'valorAtosRurais'],
  agravosDeInstrumento: ['qtdeAgravosDeInstrumento', 'valorAgravoInstrumento'],
  agravosDePeticao: ['qtdeAgravosDePeticao', 'valorAgravoPeticao'],
  impugnacaoSentenca: ['qtdeImpugnacaoSentenca', 'valorImpuganacaoSentenca'],
  embargosArrematacao: ['qtdeEmbargosArrematacao', 'valorEmbargosArrematacao'],
  embargosExecucao: ['qtdeEmbargosExecucao', 'valorEmbargosExecucao'],
  embargosTerceiros: ['qtdeEmbargosTerceiros', 'valorEmbargosTerceiros'],
  recursoRevista: ['qtdeRecursoRevista', 'valorRecursoRevista'],
};

// ---------------------------------------------------------------------------
// Documento: ids únicos e referências
// ---------------------------------------------------------------------------

class Documento {
  constructor() { this.prox = 1; }
  id() { return String(this.prox++); }
}

/** Renumera todos os ids dos objetos inline de `nos` e corrige as referências internas. */
function renumerar(nos, doc, mapaExterno = {}) {
  const mapa = new Map(); // "Classe#idAntigo" -> idNovo
  for (const raiz of nos) {
    for (const o of objetos(raiz)) {
      const par = o.campos.find(([k]) => k === 'id');
      if (par && par[1] !== null && par[1] !== undefined) {
        const novo = doc.id();
        mapa.set(`${o.$classe}#${par[1]}`, novo);
        par[1] = novo;
      }
    }
  }
  const corrigir = (no) => {
    if (!no || typeof no !== 'object') return;
    if (no.$ref) {
      const k = `${no.$ref}#${no.id}`;
      if (mapa.has(k)) no.id = mapa.get(k);
      else if (mapaExterno[no.$ref] !== undefined) no.id = typeof mapaExterno[no.$ref] === 'function' ? mapaExterno[no.$ref](no.id) : mapaExterno[no.$ref];
      return;
    }
    if (no.$classe) for (const [, v] of no.campos) corrigir(v);
    if (no.$colecao) for (const it of no.itens) corrigir(it);
  };
  for (const raiz of nos) corrigir(raiz);
  return mapa;
}

function objetoModelo(classe) {
  const o = carregarModelo('objetos').objetos[classe];
  if (!o) erro(`Modelo do objeto ${classe} ausente (modelos/objetos.json).`);
  return clonar(o);
}

function conferirCampos(classe, mapa, contexto) {
  const ent = dominio().entidades[classe];
  if (!ent) erro(`${contexto}: classe desconhecida ${classe}.`);
  const nomes = new Set(ent.campos.map((c) => c.nome));
  for (const k of Object.keys(mapa)) if (!nomes.has(k)) erro(`${contexto}: o campo "${k}" não existe em ${classe}. Campos: ${[...nomes].join(', ')}`);
}

/**
 * Aba "Dados Específicos" de Correção, Juros e Multa, com nomes próprios: índice do FGTS com juros do JAM,
 * previdência privada, custas e a atualização da contribuição social sobre salários devidos e pagos.
 * Devolve o mapa de campos da entidade (aplicado como "avancado", que confere enums e datas).
 */
function dadosEspecificosDeAtualizacao(cj) {
  const m = {};
  const ctx = 'correcaoJuros';
  const opcao = (v, c) => {
    if (v === undefined) return undefined;
    if (v === 'trabalhista' || v === 'UTILIZAR_INDICE_TRABALHISTA') return ['UTILIZAR_INDICE_TRABALHISTA', null];
    return ['UTILIZAR_OUTRO_INDICE', enumValido('IndiceMonetarioEnum', v, c)];
  };
  if (cj.jurosFgtsComJam != null) m.jurosDeFgtsComJam = cj.jurosFgtsComJam;
  const grupo = (g, nome, chaves) => {
    if (g == null) return null;
    if (typeof g !== 'object' || Array.isArray(g)) { erro(`${ctx}.${nome}: informe um objeto.`); return null; }
    for (const k of Object.keys(g)) if (!chaves.includes(k)) erro(`${ctx}.${nome}: o campo "${k}" não existe (aceitos: ${chaves.join(', ')}).`);
    return g;
  };
  const pp = grupo(cj.previdenciaPrivada, 'previdenciaPrivada', ['juros', 'indice']);
  if (pp) {
    if (pp.juros != null) m.jurosDePrevidenciaPrivada = pp.juros;
    const o = opcao(pp.indice, `${ctx}.previdenciaPrivada.indice`);
    if (o) [m.indiceDeCorrecaoDePrevidenciaPrivada, m.outroIndiceDeCorrecaoDePrevidenciaPrivada] = o;
  }
  const cu = grupo(cj.custas, 'custas', ['correcao', 'juros', 'indice']);
  if (cu) {
    if (cu.correcao != null) m.correcaoDasCustas = cu.correcao;
    if (cu.juros != null) m.jurosDeCustas = cu.juros;
    const o = opcao(cu.indice, `${ctx}.custas.indice`);
    if (o) [m.indiceDeCorrecaoDasCustas, m.outroIndiceDeCorrecaoDasCustas] = o;
  }
  const CHAVES_CS = ['lei11941', 'lei11941APartirDe', 'limitarMulta', 'limitarMultaAPartirDe', 'correcaoTrabalhista', 'jurosTrabalhistas', 'aplicarAte',
    'correcaoPrevidenciaria', 'jurosPrevidenciarios', 'formaAplicacao', 'multa', 'tipoMulta', 'pagamentoMulta'];
  const cs = grupo(cj.contribuicaoSocial, 'contribuicaoSocial', ['salariosDevidos', 'salariosPagos']);
  for (const [chave, sufixo, lei, forma] of [['salariosDevidos', 'Devidos', 'lei11941', 'salarioDevidoFormaAplicacao'], ['salariosPagos', 'Pagos', 'lei11941Pago', 'salarioPagoFormaAplicacao']]) {
    const g = cs && grupo(cs[chave], `contribuicaoSocial.${chave}`, CHAVES_CS);
    if (!g) continue;
    const c = `${ctx}.contribuicaoSocial.${chave}`;
    const s = `DosSalarios${sufixo}DoINSS`;
    const multaLei = chave === 'salariosDevidos' ? 'lei11941Multa' : 'lei11941PagoMulta';
    const aPartir = chave === 'salariosDevidos' ? 'apartirDeLei11941' : 'apartirDeLei11941Pago';
    if (g.lei11941 != null) {
      m[lei] = g.lei11941;
      // sem a Lei 11.941 a tela esconde "Limitar multa" e grava falso
      if (g.lei11941 === false && g.limitarMulta == null) m[multaLei] = false;
    }
    if (g.lei11941APartirDe != null) m[aPartir] = g.lei11941APartirDe;
    if (g.limitarMulta != null) m[multaLei] = g.limitarMulta;
    if (g.limitarMultaAPartirDe != null) m[`${aPartir}Multa`] = g.limitarMultaAPartirDe;
    if (g.correcaoTrabalhista != null) m[`correcaoTrabalhista${s}`] = g.correcaoTrabalhista;
    if (g.jurosTrabalhistas != null) m[`jurosTrabalhistas${s}`] = g.jurosTrabalhistas;
    if (g.aplicarAte != null) m[`aplicarAte${s}`] = g.aplicarAte;
    if (g.correcaoPrevidenciaria != null) m[`correcaoPrevidenciaria${s}`] = g.correcaoPrevidenciaria;
    if (g.jurosPrevidenciarios != null) m[`jurosPrevidenciarios${s}`] = g.jurosPrevidenciarios;
    if (g.formaAplicacao != null) m[forma] = g.formaAplicacao;
    if (g.multa != null) m[`aplicarMulta${s}`] = g.multa;
    if (g.tipoMulta != null) m[`tipoDeMulta${s}`] = g.tipoMulta;
    if (g.pagamentoMulta != null) m[`pagamentoDaMulta${s}`] = g.pagamentoMulta;
    const corr = (k) => (g[k] != null ? g[k] : null);
    if (corr('correcaoTrabalhista') === true && corr('correcaoPrevidenciaria') === true && g.aplicarAte == null) {
      erro(`${c}: com correção trabalhista e previdenciária a tela exige "aplicarAte" (data até a qual vale a atualização trabalhista).`);
    }
  }
  return Object.keys(m).length ? m : null;
}

/** Aplica "avancado" (campos Java crus) a um objeto, validando nomes e enums. */
function aplicarAvancado(obj, mapa, contexto) {
  if (!mapa) return;
  conferirCampos(obj.$classe, mapa, contexto);
  const ent = dominio().entidades[obj.$classe];
  for (const [k, v] of Object.entries(mapa)) {
    const meta = ent.campos.find((c) => c.nome === k);
    const tipo = meta.tipo.split('.').pop();
    let val = v;
    if (v === null) val = null;
    else if (dominio().enums[tipo]) val = enumValido(tipo, v, `${contexto}.${k}`);
    else if (tipo === 'Date') val = data(v, `${contexto}.${k}`);
    else if (tipo === 'Boolean' || tipo === 'boolean') val = bool(v);
    else if (typeof v === 'object') erro(`${contexto}.${k}: campos de objeto/coleção não podem ser alterados por "avancado".`);
    else val = String(v);
    definir(obj, k, val);
  }
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

export function acharMunicipio(uf, nome) {
  const cat = carregarModelo('catalogos');
  const u = normalizar(uf);
  const n = normalizar(nome);
  const naUf = cat.municipios.filter((m) => normalizar(m.uf) === u);
  if (!naUf.length) erro(`UF "${uf}" desconhecida. Use a sigla (ex.: PA, SP).`);
  const exato = naUf.find((m) => normalizar(m.nome) === n);
  if (exato) return exato;
  const parcial = naUf.filter((m) => normalizar(m.nome).includes(n));
  if (parcial.length === 1) return parcial[0];
  erro(`Município "${nome}" não encontrado em ${uf}.${parcial.length ? ` Candidatos: ${parcial.slice(0, 10).map((m) => m.nome).join(', ')}` : ''}`);
}

/** Atividade econômica (tabela do PJe-Calc) por id ou por parte da descrição. */
export function acharAtividade(chave) {
  const lista = carregarModelo('catalogos').atividadesEconomicas || [];
  if (!lista.length) erro('Catálogo de atividades econômicas ausente: rode modelos_atualizar com alvo "catalogos".');
  if (/^\d+$/.test(String(chave))) {
    const a = lista.find((x) => x.id === Number(chave));
    if (!a) erro(`Atividade econômica de id ${chave} não existe.`);
    return a;
  }
  const n = normalizar(chave);
  const achadas = lista.filter((x) => normalizar(x.descricao).includes(n));
  if (achadas.length === 1) return achadas[0];
  const exata = achadas.find((x) => normalizar(x.descricao) === n);
  if (exata) return exata;
  erro(`Atividade econômica "${chave}" ${achadas.length ? `ambígua: ${achadas.slice(0, 10).map((x) => `${x.id} ${x.descricao}`).join(' | ')}` : 'não encontrada'}. Use o id (catalogo_atividades).`);
}

export function bibliotecaVerbas() {
  return carregarModelo('verbas-expresso').verbas;
}

export function acharVerbaModelo(nome) {
  const b = bibliotecaVerbas();
  const n = normalizar(nome);
  const v = b.find((x) => normalizar(x.nome) === n);
  if (!v) {
    const sug = b.filter((x) => normalizar(x.nome).includes(n.split(' ')[0])).slice(0, 8).map((x) => x.nome);
    erro(`Verba "${nome}" não existe no catálogo Expresso do PJe-Calc.${sug.length ? ` Parecidas: ${sug.join(' | ')}` : ''} Use "personalizada" para verbas fora do catálogo.`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Férias (mesma regra da interface: períodos aquisitivos completos, art. 130 da CLT)
// ---------------------------------------------------------------------------

function somarDias(ms, dias) { return String(Number(ms) + dias * 86400000); }
function somarAnos(iso, anos) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y + anos, m - 1, d)); return dt.toISOString().slice(0, 10); }
function menosUmDia(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10); }
function diasEntre(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1; }

// tempo parcial com período aquisitivo terminado antes da Reforma (11/11/2017): 18 dias, ou 9 com mais de 7 faltas
function prazoArt130(faltas, parcialAntesDaReforma = false) {
  if (parcialAntesDaReforma) return faltas <= 7 ? 18 : 9;
  if (faltas <= 5) return 30;
  if (faltas <= 14) return 24;
  if (faltas <= 23) return 18;
  if (faltas <= 32) return 12;
  return 0;
}

export function periodosDeFerias({ admissao, demissao, faltas = [], regime = 'INTEGRAL' }) {
  const out = [];
  if (!admissao || !demissao) return out;
  let ini = admissao;
  for (let k = 0; k < 80; k++) {
    const fim = menosUmDia(somarAnos(ini, 1));
    if (fim > demissao) break;
    const concIni = somarAnos(ini, 1);
    const concFim = menosUmDia(somarAnos(concIni, 1));
    let nFaltas = 0;
    for (const f of faltas) {
      if (f.justificada) continue;
      const a = f.inicio > ini ? f.inicio : ini;
      const b = f.fim < fim ? f.fim : fim;
      if (a <= b) nFaltas += diasEntre(a, b);
    }
    const prazo = prazoArt130(nFaltas, regime === 'PARCIAL' && fim < '2017-11-11');
    const gozadas = concFim <= demissao;
    out.push({
      relativa: `${ini.slice(0, 4)}/${fim.slice(0, 4)}`,
      aquisitivoInicio: ini, aquisitivoFim: fim, concessivoInicio: concIni, concessivoFim: concFim,
      prazo, situacao: prazo === 0 ? 'PERDIDAS' : gozadas ? 'GOZADAS' : 'INDENIZADAS',
      gozos: gozadas && prazo > 0 ? [{ inicio: msParaData(somarDias(dataMs(concFim), -(prazo - 1))), fim: concFim }] : [],
      faltasNaoJustificadas: nFaltas,
    });
    ini = somarAnos(ini, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gerador
// ---------------------------------------------------------------------------

/**
 * Gera a árvore do cálculo. Devolve { arvore, avisos, resumo }.
 * Lança ErroEspecificacao com mensagem em português quando a especificação é inválida.
 */
export function gerarCalculo(spec) {
  const avisos = [];
  const doc = new Documento();
  const s = spec || {};
  const proc = s.processo || {};
  const calc = s.calculo || {};
  if (!s.calculo) erro('Falta o bloco "calculo" (datas, município, parâmetros).');
  // nenhum campo é ignorado em silêncio: o que não existe no esquema é recusado
  const errosEsquema = conferirEsquema(s);
  if (errosEsquema.length) erro(`Campos não reconhecidos (${errosEsquema.length}):\n${errosEsquema.slice(0, 20).join('\n')}`);
  // premissas que ficaram com o padrão do PJe-Calc porque a especificação não decidiu
  const premissasPadrao = [];

  const raiz = clonar(carregarModelo('calculo-base').arvore);
  // ids do modelo-base: renumera tudo e aponta {$ref:'Calculo'} para a raiz
  const mapaBase = renumerar([raiz], doc);
  const idRaiz = campo(raiz, 'id');
  const idProcesso = campo(campo(raiz, 'processo'), 'id');
  const idParam = campo(campo(raiz, 'parametrosDeAtualizacao'), 'id');
  const refCalculo = () => ({ $ref: 'Calculo', id: idRaiz });

  // ---------------- datas e parâmetros do cálculo ----------------
  const admissao = data(calc.admissao, 'calculo.admissao', true);
  const demissao = data(calc.demissao, 'calculo.demissao');
  const ajuizamento = data(calc.ajuizamento, 'calculo.ajuizamento', true);
  const inicio = data(calc.inicio, 'calculo.inicio');
  const fim = data(calc.fim, 'calculo.fim');
  const isoAdm = msParaData(admissao);
  const isoDem = demissao ? msParaData(demissao) : null;
  if (isoDem && isoDem < isoAdm) erro('calculo.demissao anterior à admissão.');
  if (inicio && fim && Number(fim) < Number(inicio)) erro('calculo.fim anterior a calculo.inicio.');
  const periodoIni = inicio || admissao;
  const periodoFim = fim || demissao;
  if (!periodoFim) erro('Informe calculo.demissao ou calculo.fim (término do período do cálculo).');

  const hoje = new Date();
  definir(raiz, 'dataCriacao', dataMs(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`));
  definir(raiz, 'dataAdmissao', admissao);
  definir(raiz, 'dataDemissao', demissao);
  definir(raiz, 'dataAjuizamento', ajuizamento);
  definir(raiz, 'dataInicioCalculo', inicio);
  definir(raiz, 'dataTerminoCalculo', fim);
  definir(raiz, 'valorUltimaRemuneracao', dec(calc.ultimaRemuneracao));
  definir(raiz, 'valorMaiorRemuneracao', dec(calc.maiorRemuneracao));
  definir(raiz, 'valorCargaHorariaPadrao', dec(calc.cargaHoraria ?? 220, 4));
  const flag = (k, padrao) => bool(calc[k] ?? padrao);
  definir(raiz, 'sabadoDiaUtil', flag('sabadoDiaUtil', true));
  definir(raiz, 'projetaAvisoIndenizado', bool((calc.avisoPrevio || {}).projetar ?? true));
  definir(raiz, 'consideraFeriadoEstadual', flag('feriadosEstaduais', true));
  definir(raiz, 'consideraFeriadoMunicipal', flag('feriadosMunicipais', true));
  definir(raiz, 'prescricaoFgts', flag('prescricaoFgts', false));
  definir(raiz, 'prescricaoQuinquenal', flag('prescricaoQuinquenal', false));
  definir(raiz, 'limitarAvosAoPeriodoDoCalculo', flag('limitarAvos', false));
  definir(raiz, 'zeraValorNegativo', flag('zerarNegativos', false));
  definir(raiz, 'tipoCalculo', enumValido('TipoCalculoEnum', calc.tipo || 'ADVOGADO', 'calculo.tipo'));
  definir(raiz, 'regimeDoContrato', enumValido('RegimeDoContratoEnum', calc.regime || 'INTEGRAL', 'calculo.regime'));
  definir(raiz, 'indicesAcumulados', enumValido('IndicesAcumuladosEnum', calc.indicesAcumulados || 'MES_SUBSEQUENTE_AO_VENCIMENTO', 'calculo.indicesAcumulados'));
  const aviso = calc.avisoPrevio || {};
  definir(raiz, 'apuracaoPrazoDoAvisoPrevio', enumValido('TipoDeApuracaoPrazoDoAvisoPrevioEnum', aviso.apuracao || 'APURACAO_CALCULADA', 'calculo.avisoPrevio.apuracao'));
  definir(raiz, 'prazoAvisoInformado', aviso.prazoDias != null ? String(Math.round(aviso.prazoDias)) : null);
  if (campo(raiz, 'apuracaoPrazoDoAvisoPrevio') === 'APURACAO_INFORMADA' && aviso.prazoDias == null) erro('calculo.avisoPrevio.prazoDias é obrigatório quando apuracao = APURACAO_INFORMADA.');
  definir(raiz, 'prazoFeriasProporcional', s.ferias && s.ferias.prazoProporcionais != null ? String(s.ferias.prazoProporcionais) : null);
  definir(raiz, 'comentarios', calc.comentarios ? String(calc.comentarios).toUpperCase() : null);
  definir(raiz, 'processoInformadoManualmente', 'true');

  // município
  const uf = calc.uf || calc.estado;
  if (!uf || !calc.municipio) erro('Informe calculo.uf (sigla) e calculo.municipio.');
  const mun = acharMunicipio(uf, calc.municipio);
  definir(raiz, 'municipio', { $ext: 'Municipio', id: String(mun.id) });

  // exceções de carga horária e de sábado
  const excCH = campo(raiz, 'excecoesDaCargaHoraria');
  for (const [i, e] of (calc.excecoesCargaHoraria || []).entries()) {
    const o = objetoModelo('ExcecaoDaCargaHorariaDoCalculo');
    definir(o, 'id', doc.id()); definir(o, 'versao', '0');
    definir(o, 'dataInicioExcecao', data(e.inicio, `calculo.excecoesCargaHoraria[${i}].inicio`, true));
    definir(o, 'dataTerminoExcecao', data(e.fim, `calculo.excecoesCargaHoraria[${i}].fim`, true));
    definir(o, 'valorCargaHoraria', dec(e.cargaHoraria, 4));
    definir(o, 'calculo', refCalculo());
    excCH.itens.push(o);
  }
  const excSab = campo(raiz, 'excecoesDoSabado');
  for (const [i, e] of (calc.excecoesSabado || []).entries()) {
    const o = objetoModelo('ExcecaoDoSabadoDoCalculo');
    definir(o, 'id', doc.id()); definir(o, 'versao', '0');
    definir(o, 'dataInicioExcecaoSabado', data(e.inicio, `calculo.excecoesSabado[${i}].inicio`, true));
    definir(o, 'dataTerminoExcecaoSabado', data(e.fim, `calculo.excecoesSabado[${i}].fim`, true));
    definir(o, 'calculo', refCalculo());
    excSab.itens.push(o);
  }

  // dia do fechamento mensal do cartão de ponto (padrão 31) e exceções por competência (a tela grava o 1º dia do mês)
  const fech = calc.fechamentoCartao || {};
  const diaFech = (v, c) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 31) erro(`${c}: dia do fechamento entre 1 e 31.`); return String(n); };
  definir(raiz, 'diaFechamentoMes', fech.dia != null ? diaFech(fech.dia, 'calculo.fechamentoCartao.dia') : '31');
  const excFech = campo(raiz, 'excecoesDoFechamentoDeCartaoDePonto');
  for (const [i, e] of (fech.excecoes || []).entries()) {
    const c = `calculo.fechamentoCartao.excecoes[${i}]`;
    const o = objetoModelo('ExcecaoDoFechamentoDeCartaoDePonto');
    definir(o, 'id', doc.id()); definir(o, 'versao', '0');
    const de = dataMs(compData(competencia(e.de, `${c}.de`)));
    const ate = dataMs(compData(competencia(e.ate ?? e.de, `${c}.ate`)));
    if (Number(ate) < Number(de)) erro(`${c}: "ate" anterior a "de".`);
    definir(o, 'dataInicioExcecao', de);
    definir(o, 'dataTerminoExcecao', ate);
    definir(o, 'diaFechamentoMes', diaFech(e.dia, `${c}.dia`));
    definir(o, 'calculo', refCalculo());
    excFech.itens.push(o);
  }

  // pontos facultativos (padrão da interface: os do modelo-base)
  if (Array.isArray(calc.pontosFacultativos)) {
    const cat = carregarModelo('catalogos').feriados.filter((f) => f.tipo === 'P');
    const col = campo(raiz, 'pontosFacultativos');
    col.itens = calc.pontosFacultativos.map((nome) => {
      const f = cat.find((x) => normalizar(x.nome) === normalizar(nome));
      if (!f) erro(`Ponto facultativo "${nome}" não encontrado. Disponíveis: ${cat.map((x) => x.nome).join(', ')}`);
      const o = objetoModelo('ItemPontoFacultativo');
      definir(o, 'id', doc.id());
      definir(o, 'pontoFacultativo', { $ext: 'Feriado', id: f.uid });
      definir(o, 'calculo', refCalculo());
      return o;
    });
  }

  // ---------------- processo ----------------
  const processo = campo(raiz, 'processo');
  definir(processo, 'valorDaCausa', dec(proc.valorCausa));
  definir(processo, 'dataAutuacao', data(proc.autuadoEm, 'processo.autuadoEm'));
  const ident = campo(processo, 'identificador');
  if (proc.numero) {
    const n = numeroCnj(proc.numero);
    if (!n.digitoCorreto) erro(`processo.numero: dígito verificador ${String(n.digito).padStart(2, '0')} não confere (o correto é ${n.digitoEsperado}). O PJe-Calc recusa número com dígito errado.`);
    for (const k of ['numero', 'ano', 'justica', 'regiao', 'vara', 'digito']) definir(ident, k, String(n[k]));
  } else {
    avisos.push('processo.numero não informado: o cálculo ficará sem identificação do processo.');
    for (const k of ['numero', 'ano', 'justica', 'regiao', 'vara', 'digito']) definir(ident, k, null);
  }
  const parte = (p, contexto, permitePrev) => {
    if (!p || !p.nome) erro(`${contexto}.nome é obrigatório.`);
    const obj = contexto.endsWith('reclamante') ? campo(processo, 'reclamante') : campo(processo, 'reclamado');
    definir(obj, 'nome', String(p.nome).toUpperCase());
    let tipo = null; let num = null;
    if (p.cpf) { tipo = 'CPF'; num = apenasDigitos(p.cpf); if (!cpfValido(num)) avisos.push(`${contexto}.cpf ${p.cpf} com dígito inválido.`); }
    else if (p.cnpj) { tipo = 'CNPJ'; num = apenasDigitos(p.cnpj); if (!cnpjValido(num)) avisos.push(`${contexto}.cnpj ${p.cnpj} com dígito inválido.`); }
    else if (p.cei) { tipo = 'CEI'; num = apenasDigitos(p.cei); }
    definir(obj, 'tipoDocumentoFiscal', tipo);
    definir(obj, 'numeroDocumentoFiscal', num);
    if (permitePrev) {
      const prev = p.pis ? ['PIS', p.pis] : p.pasep ? ['PASEP', p.pasep] : p.nit ? ['NIT', p.nit] : [null, null];
      definir(obj, 'tipoDocumentoPrevidenciario', prev[0]);
      definir(obj, 'numeroDocumentoPrevidenciario', apenasDigitos(prev[1]));
    }
  };
  parte(proc.reclamante, 'processo.reclamante', true);
  parte(proc.reclamado, 'processo.reclamado', false);
  const advs = (lista, tipo, campoLista) => {
    const col = campo(processo, campoLista);
    for (const [i, a] of (lista || []).entries()) {
      const o = objetoModelo('Advogado');
      definir(o, 'id', doc.id());
      definir(o, 'nome', String(a.nome || '').toUpperCase());
      definir(o, 'tipoDocumento', a.cnpj ? 'CNPJ' : 'CPF');
      definir(o, 'numeroDocumento', apenasDigitos(a.cpf || a.cnpj));
      definir(o, 'numeroOAB', a.oab || null);
      definir(o, 'tipo', tipo);
      definir(o, 'processo', { $ref: 'Processo', id: idProcesso });
      if (!a.nome) erro(`processo.${campoLista}[${i}].nome é obrigatório.`);
      col.itens.push(o);
    }
  };
  advs(proc.advogadosReclamante, 'RECLAMANTE', 'advogadosReclamante');
  advs(proc.advogadosReclamado, 'RECLAMADO', 'advogadosReclamado');

  // ---------------- históricos salariais ----------------
  const historicos = new Map(); // NOME -> id
  const colHist = campo(raiz, 'historicosSalariais');
  const criarHistorico = (h, contexto) => {
    const o = objetoModelo('HistoricoSalarial');
    const id = doc.id();
    definir(o, 'id', id); definir(o, 'versao', '0');
    const nome = String(h.nome || '').toUpperCase().trim();
    if (!nome) erro(`${contexto}.nome é obrigatório.`);
    if (historicos.has(normalizar(nome))) erro(`${contexto}: histórico "${nome}" repetido.`);
    definir(o, 'nome', nome);
    definir(o, 'tipoVariacaoParcela', h.variavel ? 'VARIAVEL' : 'FIXA');
    definir(o, 'incidenciaFGTS', bool(h.fgts ?? true));
    definir(o, 'aplicarProporcionalidadeFGTS', bool(h.proporcionalizarFgts ?? false));
    definir(o, 'incidenciaINSS', bool(h.inss ?? true));
    definir(o, 'aplicarProporcionalidadeINSS', bool(h.proporcionalizarInss ?? false));
    definir(o, 'calculo', refCalculo());
    const oc = campo(o, 'ocorrencias');
    oc.itens = [];
    const mapaComp = new Map();
    for (const [i, faixa] of (h.valores || []).entries()) {
      const de = competencia(faixa.de ?? faixa.competencia, `${contexto}.valores[${i}].de`);
      const ate = competencia(faixa.ate ?? faixa.de ?? faixa.competencia, `${contexto}.valores[${i}].ate`);
      if (compChave(ate) < compChave(de)) erro(`${contexto}.valores[${i}]: "ate" anterior a "de".`);
      for (let k = compChave(de); k <= compChave(ate); k++) mapaComp.set(k, { valor: faixa.valor, faixa });
    }
    for (const [i, x] of (h.ocorrencias || []).entries()) {
      const c = competencia(x.competencia, `${contexto}.ocorrencias[${i}].competencia`);
      mapaComp.set(compChave(c), { valor: x.valor, faixa: x });
    }
    if (!mapaComp.size) erro(`${contexto}: informe "valores" (faixas de competência) ou "ocorrencias".`);
    for (const k of [...mapaComp.keys()].sort((a, b) => a - b)) {
      const { valor, faixa } = mapaComp.get(k);
      const x = objetoModelo('OcorrenciaDoHistoricoSalarial');
      definir(x, 'id', doc.id()); definir(x, 'versao', '0');
      definir(x, 'dataOcorrencia', dataMs(compData(compDeChave(k))));
      definir(x, 'valor', dec(valor));
      definir(x, 'recolhidoFGTS', bool(faixa.fgtsRecolhido ?? h.fgtsRecolhido ?? false));
      definir(x, 'recolhidoINSS', bool(faixa.inssRecolhido ?? h.inssRecolhido ?? false));
      definir(x, 'incidenciaFGTS', bool(faixa.fgts ?? h.fgts ?? true));
      definir(x, 'incidenciaINSS', bool(faixa.inss ?? h.inss ?? true));
      definir(x, 'historicoSalarial', { $ref: 'HistoricoSalarial', id });
      oc.itens.push(x);
    }
    colHist.itens.push(o);
    historicos.set(normalizar(nome), id);
    return id;
  };
  for (const [i, h] of (s.historicosSalariais || []).entries()) criarHistorico(h, `historicosSalariais[${i}]`);
  // A interface cria o histórico "ÚLTIMA REMUNERAÇÃO" ao gravar Dados do Cálculo com a última remuneração:
  // o valor fixo em TODAS as competências do contrato, com incidência de INSS (entra na base do INSS
  // sobre salários pagos). Com históricos reais isso costuma ser errado, então a decisão é obrigatória.
  const hur = calc.historicoUltimaRemuneracao || {};
  let criarUR = hur.criar ?? calc.criarHistoricoUltimaRemuneracao;
  if (calc.ultimaRemuneracao != null && !historicos.has(normalizar('ÚLTIMA REMUNERAÇÃO'))) {
    const temReal = (s.historicosSalariais || []).length > 0;
    if (criarUR == null) {
      if (temReal) {
        erro('calculo.historicoUltimaRemuneracao.criar: decida explicitamente. Com "ultimaRemuneracao" a tela cria o histórico ÚLTIMA REMUNERAÇÃO com o valor fixo em todas as competências e INSS incidindo (base de salários pagos). Já existem históricos salariais próprios: use { "criar": false } se eles refletem os salários reais, ou { "criar": true } (opcionalmente com "de"/"ate"/"inss") para reproduzir a tela.');
      }
      criarUR = true;
      premissasPadrao.push('Histórico ÚLTIMA REMUNERAÇÃO criado como a tela faz (valor fixo em todas as competências, INSS incidindo) — informe calculo.historicoUltimaRemuneracao.criar para decidir.');
    }
    if (criarUR) {
      const de = competencia(hur.de ?? msParaData(admissao), 'calculo.historicoUltimaRemuneracao.de');
      const ate = competencia(hur.ate ?? msParaData(demissao || periodoFim), 'calculo.historicoUltimaRemuneracao.ate');
      criarHistorico({ nome: 'ÚLTIMA REMUNERAÇÃO', fgts: hur.fgts ?? false, inss: hur.inss ?? true, proporcionalizarInss: hur.proporcionalizarInss ?? true, valores: [{ de: compData(de).slice(0, 7), ate: compData(ate).slice(0, 7), valor: calc.ultimaRemuneracao }] }, 'calculo.ultimaRemuneracao');
      const meses = compChave(ate) - compChave(de) + 1;
      if ((hur.inss ?? true) && (s.historicosSalariais || []).length) {
        avisos.push(`ÚLTIMA REMUNERAÇÃO (${dec(calc.ultimaRemuneracao)}) entra como salário com INSS em ${meses} competência(s) (${compData(de).slice(0, 7)} a ${compData(ate).slice(0, 7)}) ao lado dos históricos reais — confira se isso não cria base de INSS fictícia; senão use historicoUltimaRemuneracao { "criar": false } ou limite "de"/"ate".`);
      } else if ((hur.inss ?? true) && meses > 12) {
        avisos.push(`ÚLTIMA REMUNERAÇÃO (${dec(calc.ultimaRemuneracao)}) aplicada sem evolução salarial em ${meses} competências com INSS — se o salário mudou no contrato, informe historicosSalariais com os valores reais.`);
      }
    }
  }

  // ---------------- faltas ----------------
  const colFaltas = campo(raiz, 'faltas');
  const faltasIso = [];
  for (const [i, f] of (s.faltas || []).entries()) {
    const o = objetoModelo('Falta');
    definir(o, 'id', doc.id()); definir(o, 'versao', '0');
    const a = data(f.inicio, `faltas[${i}].inicio`, true);
    const b = data(f.fim ?? f.inicio, `faltas[${i}].fim`, true);
    if (Number(b) < Number(a)) erro(`faltas[${i}]: fim anterior ao início.`);
    definir(o, 'dataInicioPeriodoFalta', a);
    definir(o, 'dataTerminoPeriodoFalta', b);
    definir(o, 'faltaJustificada', bool(f.justificada));
    definir(o, 'justificativaDaFalta', f.justificativa ? String(f.justificativa) : null);
    definir(o, 'reiniciarFerias', bool(f.reiniciaPeriodoAquisitivo));
    definir(o, 'calculo', refCalculo());
    colFaltas.itens.push(o);
    faltasIso.push({ inicio: msParaData(a), fim: msParaData(b), justificada: !!f.justificada });
  }

  // ---------------- férias ----------------
  const colFerias = campo(raiz, 'listaDeFerias');
  const fer = s.ferias || {};
  if (fer.gerar !== false) {
    const auto = periodosDeFerias({ admissao: isoAdm, demissao: isoDem || msParaData(periodoFim), faltas: faltasIso, regime: campo(raiz, 'regimeDoContrato') });
    const ajustes = fer.periodos || [];
    for (const aj of ajustes) if (!auto.some((p) => p.relativa === aj.relativa)) erro(`ferias.periodos: período "${aj.relativa}" não existe. Períodos do contrato: ${auto.map((p) => p.relativa).join(', ') || '(nenhum período aquisitivo completo)'}`);
    for (const p of auto) {
      const aj = ajustes.find((x) => x.relativa === p.relativa) || {};
      const o = objetoModelo('Ferias');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      definir(o, 'relativa', p.relativa);
      definir(o, 'dataInicialDoPeriodoAquisitivo', dataMs(p.aquisitivoInicio));
      definir(o, 'dataFinalDoPeriodoAquisitivo', dataMs(p.aquisitivoFim));
      definir(o, 'dataInicialDoPeriodoConcessivo', dataMs(p.concessivoInicio));
      definir(o, 'dataFinalDoPeriodoConcessivo', dataMs(p.concessivoFim));
      definir(o, 'prazo', String(aj.prazo ?? p.prazo));
      const situacao = enumValido('SituacaoDaFeriasEnum', aj.situacao || p.situacao, `ferias.periodos[${p.relativa}].situacao`);
      definir(o, 'situacao', situacao);
      definir(o, 'dobraGeral', bool(aj.dobra));
      definir(o, 'abono', bool(aj.abono));
      definir(o, 'quantidadeDiasAbono', String(aj.diasAbono ?? 10));
      // a tela exige que os gozos somem o prazo menos os dias de abono (o padrão termina no fim do período concessivo)
      const diasGozo = Number(campo(o, 'prazo')) - (aj.abono ? Number(aj.diasAbono ?? 10) : 0);
      const gozoPadrao = p.gozos.length && diasGozo > 0 ? [{ inicio: msParaData(somarDias(dataMs(p.concessivoFim), -(diasGozo - 1))), fim: p.concessivoFim }] : [];
      const gozos = aj.gozos ?? (situacao === 'GOZADAS' || situacao === 'GOZADAS_PARCIALMENTE' ? gozoPadrao : []);
      let somaGozos = 0;
      for (let g = 1; g <= 3; g++) {
        const x = gozos[g - 1];
        const ini = x ? data(x.inicio, `ferias ${p.relativa} gozo ${g}`, true) : null;
        const fimGozo = x ? data(x.fim, `ferias ${p.relativa} gozo ${g}`, true) : null;
        if (x) somaGozos += (Number(fimGozo) - Number(ini)) / 86400000 + 1;
        definir(o, `dataInicialDoPeriodoDeGozo${g}`, ini);
        definir(o, `dataFinalDoPeriodoDeGozo${g}`, fimGozo);
        definir(o, `dobraDoPeriodoDeGozo${g}`, bool(x && x.dobra));
      }
      if (situacao === 'GOZADAS' && gozos.length && Math.round(somaGozos) !== diasGozo) erro(`ferias.periodos[${p.relativa}]: os gozos somam ${Math.round(somaGozos)} dia(s); a tela exige ${diasGozo} (prazo de ${campo(o, 'prazo')} dias${aj.abono ? ` menos ${aj.diasAbono ?? 10} de abono` : ''}).`);
      definir(o, 'calculo', refCalculo());
      colFerias.itens.push(o);
    }
  }

  // ---------------- cartões de ponto (quantidades mensais, como "Visualizar Cartão" > importar CSV) ----------------
  const cartoes = new Map(); // NOME -> id
  const colCartoes = campo(raiz, 'cartoesDePonto');
  for (const [i, c] of (s.cartoesDePonto || []).entries()) {
    const ctx = `cartoesDePonto[${i}]`;
    const nome = String(c.nome || '').trim().toUpperCase();
    if (!nome) erro(`${ctx}.nome é obrigatório (é o nome da coluna do cartão, ex.: "QT. H. EXT").`);
    if (cartoes.has(normalizar(nome))) erro(`${ctx}: cartão "${nome}" repetido.`);
    const o = objetoModelo('CartaoDePonto');
    const id = doc.id();
    definir(o, 'id', id); definir(o, 'versao', '0');
    definir(o, 'nome', nome);
    definir(o, 'calculo', refCalculo());
    const mapaComp = new Map();
    for (const [j, faixa] of (c.valores || []).entries()) {
      const de = competencia(faixa.de ?? faixa.competencia, `${ctx}.valores[${j}].de`);
      const ate = competencia(faixa.ate ?? faixa.de ?? faixa.competencia, `${ctx}.valores[${j}].ate`);
      for (let k = compChave(de); k <= compChave(ate); k++) mapaComp.set(k, faixa.valor);
    }
    for (const [j, x] of (c.ocorrencias || []).entries()) mapaComp.set(compChave(competencia(x.competencia, `${ctx}.ocorrencias[${j}].competencia`)), x.valor);
    if (!mapaComp.size) erro(`${ctx}: informe "valores" (faixas) ou "ocorrencias" (competência e quantidade).`);
    campo(o, 'ocorrencias').itens = [...mapaComp.keys()].sort((a, b) => a - b).map((k) => {
      const x = objetoModelo('OcorrenciaDoCartaoDePonto');
      definir(x, 'id', doc.id()); definir(x, 'versao', '0');
      definir(x, 'dataOcorrencia', dataMs(compData(compDeChave(k))));
      definir(x, 'valor', dec(mapaComp.get(k), 4));
      definir(x, 'cartaoDePonto', { $ref: 'CartaoDePonto', id });
      return x;
    });
    colCartoes.itens.push(o);
    cartoes.set(normalizar(nome), id);
  }

  // ---------------- apuração do cartão de ponto (jornadas -> colunas "Hs EXT", "Hs Noturnas"...) ----------------
  // O arquivo leva os critérios, a programação/escala e as jornadas lançadas manualmente. As jornadas dos demais
  // dias, a apuração diária e as colunas do cartão são calculadas pelo próprio PJe-Calc depois da importação
  // (Cartão de Ponto > Alterar > Salvar > Visualizar Cartão > Apurar Cartão de Ponto) — o MCP faz isso sozinho.
  const posImportacao = { apurarCartao: false, vinculosCartao: [], edicoesOcorrencias: [], edicoesEncargos: { fgts: [], salariosDevidos: [], salariosPagos: [] } };
  const apuracoes = s.apuracaoCartaoPonto ? (Array.isArray(s.apuracaoCartaoPonto) ? s.apuracaoCartaoPonto : [s.apuracaoCartaoPonto]) : [];
  if (apuracoes.length) {
    if ((s.cartoesDePonto || []).length) erro('Use "cartoesDePonto" (quantidades mensais) OU "apuracaoCartaoPonto" (jornadas), não os dois: o PJe-Calc só apura o cartão de ponto quando o cálculo ainda não tem cartões.');
    const colApur = campo(raiz, 'apuracoesCartaoDePonto');
    const periodos = [];
    for (const [i, a] of apuracoes.entries()) {
      const ctx = `apuracaoCartaoPonto${apuracoes.length > 1 ? `[${i}]` : ''}`;
      const o = criarApuracaoCartao(a, ctx, { doc, calc, refCalculo, admissao, periodoFim });
      const [ini, fimA] = [Number(campo(o, 'dataInicial')), Number(campo(o, 'dataFinal'))];
      for (const [pi, pf] of periodos) if (ini <= pf && fimA >= pi) erro(`${ctx}: o período se sobrepõe ao de outra apuração.`);
      periodos.push([ini, fimA]);
      colApur.itens.push(o);
    }
    posImportacao.apurarCartao = true;
    for (const c of COLUNAS_APURACAO) {
      cartoes.set(normalizar(c.nome), { apuracao: c.nome });
      cartoes.set(normalizar(c.constante), { apuracao: c.nome });
    }
  }

  // ---------------- verbas ----------------
  const colVerbas = campo(raiz, 'verbas');
  const nomesVerbas = new Set();
  const verbasCriadas = new Map(); // NOME -> { classe, id }
  let ordem = 0;
  for (const [i, v] of (s.verbas || []).entries()) {
    const ctx = `verbas[${i}]${v.verba ? ` (${v.verba})` : ''}`;
    const personalizada = v.personalizada || null;
    const modeloNome = personalizada ? (personalizada.modelo || (v.valor != null ? 'INDENIZAÇÃO POR DANO MORAL' : 'DIFERENÇA SALARIAL')) : v.verba;
    if (!modeloNome) erro(`${ctx}: informe "verba" (nome do catálogo Expresso) ou "personalizada".`);
    const modelo = acharVerbaModelo(modeloNome);
    const grupo = clonar(modelo.objetos);
    const principal = grupo[0];
    const reflexos = grupo.slice(1);
    // ids novos; Calculo e HistoricoSalarial do modelo apontam para os deste cálculo
    renumerar(grupo, doc, { Calculo: idRaiz, HistoricoSalarial: null });
    const nome = String((personalizada && personalizada.nome) || v.nome || modelo.nome).toUpperCase();
    if (nomesVerbas.has(normalizar(nome))) erro(`${ctx}: já existe verba com o nome "${nome}". Use "nome" para diferenciar.`);
    nomesVerbas.add(normalizar(nome));
    definir(principal, 'nome', nome);
    if (personalizada || v.nome) definir(principal, 'descricao', String((personalizada && (personalizada.descricao || personalizada.nome)) || v.descricao || nome).toUpperCase());
    definir(principal, 'ordem', String(ordem++));
    // "data": verba lançada uma única vez (ex.: dano moral na data do arbitramento)
    const dataUnica = v.data ?? (personalizada && personalizada.data);
    const pIni = data(dataUnica ?? (v.periodo || {}).inicio, `${ctx}.periodo.inicio`) || periodoIni;
    const pFim = data(dataUnica ?? (v.periodo || {}).fim, `${ctx}.periodo.fim`) || periodoFim;
    if (Number(pFim) < Number(pIni)) erro(`${ctx}: período com fim anterior ao início.`);
    for (const o of grupo) {
      definir(o, 'periodoInicial', pIni);
      definir(o, 'periodoFinal', pFim);
      definir(o, 'calculo', refCalculo());
    }
    configurarVerba(principal, v, personalizada, ctx, { historicos, avisos, calc, doc, cartoes, verbasCriadas, pendentesCartao: posImportacao.vinculosCartao });
    conferirOcorrenciaPossivel(principal, { v, personalizada, ctx, pIni, pFim, demissao, dataUnica, avisos });
    verbasCriadas.set(normalizar(nome), { classe: principal.$classe, id: campo(principal, 'id') });
    // valores mês a mês (aplicados nas ocorrências depois que o PJe-Calc as gerar)
    const conferirEdicoes = (lista, ctxE) => {
      if (!Array.isArray(lista)) erro(`${ctxE}: "ocorrencias" é uma lista de { competencia|data|aquisitivo, pago, quantidade, devido, divisor, multiplicador, dobra, ativo }.`);
      for (const [j, e] of lista.entries()) {
        if (!e.competencia && !e.data && !e.aquisitivo) erro(`${ctxE}[${j}]: informe "competencia" (AAAA-MM), "data" (AAAA-MM-DD) ou "aquisitivo" (AAAA/AAAA).`);
        if (e.competencia && !/^\d{4}-\d{2}$/.test(String(e.competencia))) erro(`${ctxE}[${j}].competencia: use AAAA-MM.`);
        if (e.data && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.data))) erro(`${ctxE}[${j}].data: use AAAA-MM-DD.`);
        if (!['pago', 'quantidade', 'devido', 'divisor', 'multiplicador', 'dobra', 'ativo'].some((k) => e[k] !== undefined)) erro(`${ctxE}[${j}]: nada a alterar (pago, quantidade, devido, divisor, multiplicador, dobra ou ativo).`);
        for (const k of ['pago', 'quantidade', 'devido', 'divisor', 'multiplicador']) if (e[k] !== undefined) dec(e[k], 25);
      }
      return lista;
    };
    const edicoesDaVerba = v.ocorrencias || (personalizada && personalizada.ocorrencias);
    if (edicoesDaVerba) posImportacao.edicoesOcorrencias.push({ verba: nome, itens: conferirEdicoes(edicoesDaVerba, `${ctx}.ocorrencias`) });
    const edicoesReflexos = [];
    // reflexos
    const pedidos = v.reflexos === 'todos' ? reflexos.map((r) => campo(r, 'nome')) : (v.reflexos || []);
    for (const nomeR of pedidos) {
      const alvoR = typeof nomeR === 'string' ? nomeR : nomeR.nome;
      const r = reflexos.find((x) => normalizar(campo(x, 'nome')) === normalizar(alvoR)
        || normalizar(campo(x, 'nome')).replace(/\s+SOBRE\s+.*$/, '') === normalizar(alvoR));
      if (!r) erro(`${ctx}: reflexo "${alvoR}" não existe para ${modelo.nome}. Reflexos disponíveis: ${reflexos.map((x) => campo(x, 'nome')).join(' | ') || '(nenhum)'}`);
      definir(r, 'ativo', 'true');
      if (typeof nomeR === 'object') configurarReflexo(r, nomeR, `${ctx}.reflexos[${alvoR}]`, { historicos, doc });
      if (typeof nomeR === 'object' && nomeR.ocorrencias) edicoesReflexos.push([r, conferirEdicoes(nomeR.ocorrencias, `${ctx}.reflexos[${alvoR}].ocorrencias`)]);
    }
    // nomes dos reflexos acompanham o nome da principal quando ela é renomeada
    if (nome !== modelo.nome) for (const r of reflexos) definir(r, 'nome', String(campo(r, 'nome')).replace(modelo.nome, nome));
    for (const [r, lista] of edicoesReflexos) posImportacao.edicoesOcorrencias.push({ verba: campo(r, 'nome'), itens: lista });
    for (const o of grupo) colVerbas.itens.push(o);
  }

  // ---------------- FGTS ----------------
  const fgts = campo(raiz, 'fgts');
  const fs_ = s.fgts || {};
  definir(fgts, 'periodoInicial', data((fs_.periodo || {}).inicio, 'fgts.periodo.inicio') || periodoIni);
  definir(fgts, 'periodoFinal', data((fs_.periodo || {}).fim, 'fgts.periodo.fim') || periodoFim);
  if (fs_.destino) definir(fgts, 'destinoDoFgts', enumValido('DestinoDoFgtsEnum', fs_.destino === 'RECOLHER' ? 'DEPOSITAR' : fs_.destino, 'fgts.destino'));
  if (fs_.aliquota != null) definir(fgts, 'aliquota', String(fs_.aliquota) === '2' ? 'DOIS_POR_CENTO' : String(fs_.aliquota) === '8' ? 'OITO_POR_CENTO' : enumValido('AliquotaDoFgtsEnum', fs_.aliquota, 'fgts.aliquota'));
  if (fs_.multa != null) definir(fgts, 'multa', bool(fs_.multa));
  if (fs_.percentualMulta != null) definir(fgts, 'multaDoFgts', String(fs_.percentualMulta) === '20' ? 'VINTE_POR_CENTO' : String(fs_.percentualMulta) === '40' ? 'QUARENTA_POR_CENTO' : enumValido('ValorDaMultaDoFgtsEnum', fs_.percentualMulta, 'fgts.percentualMulta'));
  if (fs_.valorMultaInformado != null) { definir(fgts, 'tipoDoValorDaMulta', 'INFORMADA'); definir(fgts, 'valorInformadoDaMulta', dec(fs_.valorMultaInformado)); }
  if (fs_.incidenciaMulta) definir(fgts, 'incidenciaDoFgts', enumValido('IncidenciaDeMultaDoFgtsEnum', fs_.incidenciaMulta, 'fgts.incidenciaMulta'));
  if (fs_.excluirAvisoDaMulta != null) definir(fgts, 'excluirAvisoDaMulta', bool(fs_.excluirAvisoDaMulta));
  if (fs_.multaArt467 != null) definir(fgts, 'multaDoArtigo467', bool(fs_.multaArt467));
  if (fs_.multa10 != null) definir(fgts, 'multa10', bool(fs_.multa10));
  if (fs_.contribuicaoSocial05 != null) definir(fgts, 'contribuicaoSocial05', bool(fs_.contribuicaoSocial05));
  if (fs_.incidenciaPensaoAlimenticia != null) definir(fgts, 'incidenciaPensaoAlimenticia', bool(fs_.incidenciaPensaoAlimenticia));
  if (fs_.comporPrincipal != null) definir(fgts, 'comporPrincipal', sn(fs_.comporPrincipal));
  // saldo e/ou saque (depósitos/saques já feitos, deduzidos do FGTS devido)
  if (Array.isArray(fs_.operacoes) && fs_.operacoes.length) {
    // no cálculo novo o FGTS ainda não tem id; as operações precisam referenciá-lo no arquivo
    if (campo(fgts, 'id') === null) definir(fgts, 'id', doc.id());
    const colOp = campo(fgts, 'operacoesDeFgts');
    colOp.itens = fs_.operacoes.map((x, i) => {
      const o = objetoModelo('OperacaoDeFgts');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      definir(o, 'competencia', data(x.data ?? x.competencia, `fgts.operacoes[${i}].data`, true));
      definir(o, 'tipoDeOperacaoDoFgts', enumValido('TipoDeOperacaoDoFgtsEnum', x.tipo || 'DEPOSITO', `fgts.operacoes[${i}].tipo`));
      if (x.valor == null || Number(dec(x.valor)) <= 0) erro(`fgts.operacoes[${i}].valor deve ser maior que zero.`);
      definir(o, 'valor', dec(x.valor));
      definir(o, 'fgts', { $ref: 'Fgts', id: campo(fgts, 'id') });
      return o;
    });
    definir(fgts, 'deduzirDoFGTS', bool(fs_.deduzir ?? true));
  } else if (fs_.deduzir != null) {
    definir(fgts, 'deduzirDoFGTS', bool(fs_.deduzir));
  }
  aplicarAvancado(fgts, fs_.avancado, 'fgts.avancado');
  // base, depositado e alíquota por competência (ou em lote): aplicados depois que o PJe-Calc gerar as ocorrências
  if (fs_.ocorrencias != null) {
    posImportacao.edicoesEncargos.fgts = edicoesDeEncargo(fs_.ocorrencias, 'fgts.ocorrencias', ['base', 'depositado', 'aliquota'], [campo(fgts, 'periodoInicial'), campo(fgts, 'periodoFinal')]);
  }

  // ---------------- Contribuição social (INSS) ----------------
  const inss = campo(raiz, 'inss');
  const cs = s.contribuicaoSocial || {};
  if (cs.tipoAliquotaSegurado) definir(inss, 'tipoAliquotaSegurado', enumValido('TipoDeAliquotaDoSeguradoEnum', cs.tipoAliquotaSegurado, 'contribuicaoSocial.tipoAliquotaSegurado'));
  if (cs.aliquotaSeguradoFixa != null) definir(inss, 'aliquotaSeguradoFixa', dec(cs.aliquotaSeguradoFixa, 4));
  // "limitar ao teto" só vale com alíquota fixa (tela Regerar); fora dela a tela grava falso
  if (cs.limitarTeto != null) definir(inss, 'limitarTeto', bool(cs.limitarTeto));
  else if (campo(inss, 'tipoAliquotaSegurado') !== 'FIXA') definir(inss, 'limitarTeto', 'false');
  if (cs.tipoAliquotaEmpregador) definir(inss, 'tipoAliquotaEmpregador', enumValido('TipoDeAliquotaDoEmpregadorEnum', cs.tipoAliquotaEmpregador, 'contribuicaoSocial.tipoAliquotaEmpregador'));
  if (cs.aliquotaEmpresa != null) definir(inss, 'aliquotaEmpresaFixa', dec(cs.aliquotaEmpresa, 4));
  if (cs.aliquotaRat != null) definir(inss, 'aliquotaRATFixa', dec(cs.aliquotaRat, 4));
  if (cs.aliquotaTerceiros != null) definir(inss, 'aliquotaTerceirosFixa', dec(cs.aliquotaTerceiros, 4));
  if (cs.apurarSobreSalariosPagos != null) definir(inss, 'apurarInssSobreSalariosPagos', bool(cs.apurarSobreSalariosPagos));
  const refInss = () => { if (campo(inss, 'id') === null) definir(inss, 'id', doc.id()); return { $ref: 'Inss', id: campo(inss, 'id') }; };
  // alíquotas do empregador por período (tela Contribuição Social > Ocorrências > Alterar > Regerar)
  if (Array.isArray(cs.aliquotasPorPeriodo) && cs.aliquotasPorPeriodo.length) {
    definir(inss, 'tipoAliquotaEmpregador', 'POR_PERIODO');
    campo(inss, 'aliquotasPorPeriodos').itens = cs.aliquotasPorPeriodo.map((x, i) => {
      const ctx = `contribuicaoSocial.aliquotasPorPeriodo[${i}]`;
      const o = objetoModelo('AliquotasDoEmpregadorPorPeriodo');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      definir(o, 'dataInicioPeriodo', dataMs(compData(competencia(x.de, `${ctx}.de`))));
      definir(o, 'dataTerminoPeriodo', dataMs(compData(competencia(x.ate ?? x.de, `${ctx}.ate`))));
      definir(o, 'aliquotaEmpresa', dec(x.empresa ?? 20));
      definir(o, 'aliquotaRAT', dec(x.rat ?? 0));
      definir(o, 'aliquotaTerceiros', x.terceiros != null ? dec(x.terceiros) : null);
      definir(o, 'inss', refInss());
      return o;
    });
  }
  // períodos em que o reclamado era optante do SIMPLES (sem cota patronal)
  if (Array.isArray(cs.periodosSimples) && cs.periodosSimples.length) {
    campo(inss, 'periodosComOpcaoSimples').itens = cs.periodosSimples.map((x, i) => {
      const ctx = `contribuicaoSocial.periodosSimples[${i}]`;
      const o = objetoModelo('PeriodoDoINSSComOpcaoSimples');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      definir(o, 'dataInicioSimples', dataMs(compData(competencia(x.de, `${ctx}.de`))));
      definir(o, 'dataTerminoSimples', dataMs(compData(competencia(x.ate ?? x.de, `${ctx}.ate`))));
      definir(o, 'inss', refInss());
      return o;
    });
  }
  // alíquotas pela atividade econômica (código CNAE da tabela do PJe-Calc; ver catalogo_atividades)
  if (cs.atividadeEconomica != null) {
    const at = acharAtividade(cs.atividadeEconomica);
    definir(inss, 'tipoAliquotaEmpregador', 'POR_ATIVIDADE_ECONOMICA');
    definir(inss, 'atividadeEconomica', { $ext: 'AtividadeEconomica', id: String(at.id) });
    // padrões da tela (sugerirApuracaoAliquotasDaAtividade): marca Empresa e SAT; Terceiros fica desmarcado
    for (const [k, c, padrao] of [['apurarEmpresaPorAtividade', 'apurarEmpresaPorAtividade', true], ['apurarRatPorAtividade', 'apurarRATPorAtividade', true], ['apurarTerceirosPorAtividade', 'apurarTerceirosPorAtividade', false]]) definir(inss, c, bool(cs[k] ?? padrao));
  }
  const devidos = campo(inss, 'inssSobreSalariosDevidos');
  const pagos = campo(inss, 'inssSobreSalariosPagos');
  for (const o of [devidos, pagos]) {
    definir(o, 'dataInicioPeriodo', periodoIni);
    definir(o, 'dataTerminoPeriodo', periodoFim);
  }
  if (cs.apurarSegurado != null) definir(devidos, 'apurarInssSegurado', bool(cs.apurarSegurado));
  if (cs.cobrarDoReclamante != null) definir(devidos, 'cobrarInssDoReclamante', bool(cs.cobrarDoReclamante));
  // a tela grava "Com Correção Trabalhista" no INSS e nos salários devidos
  if (cs.corrigirDescontoReclamante != null) for (const o of [inss, devidos]) definir(o, 'corrigirDescontoReclamante', bool(cs.corrigirDescontoReclamante));
  aplicarAvancado(inss, cs.avancado, 'contribuicaoSocial.avancado');
  // bases dos salários devidos e pagos e contribuições recolhidas por competência (ou em lote), como na tela de ocorrências
  if (cs.ocorrencias != null) {
    const oc = cs.ocorrencias;
    if (typeof oc !== 'object' || Array.isArray(oc)) erro('contribuicaoSocial.ocorrencias: use { "salariosDevidos": [...], "salariosPagos": [...] }.');
    if (oc.salariosDevidos != null) {
      posImportacao.edicoesEncargos.salariosDevidos = edicoesDeEncargo(oc.salariosDevidos, 'contribuicaoSocial.ocorrencias.salariosDevidos', ['base'], [campo(devidos, 'dataInicioPeriodo'), campo(devidos, 'dataTerminoPeriodo')]);
    }
    if (oc.salariosPagos != null) {
      if (campo(inss, 'apurarInssSobreSalariosPagos') !== 'true') erro('contribuicaoSocial.ocorrencias.salariosPagos: o PJe-Calc só gera as ocorrências de salários pagos com "apurarSobreSalariosPagos": true.');
      posImportacao.edicoesEncargos.salariosPagos = edicoesDeEncargo(oc.salariosPagos, 'contribuicaoSocial.ocorrencias.salariosPagos', ['base', 'recolhidoSegurado', 'recolhidoEmpresa', 'recolhidoSat', 'recolhidoTerceiros'], [campo(pagos, 'dataInicioPeriodo'), campo(pagos, 'dataTerminoPeriodo')]);
    }
  }

  // ---------------- IRPF ----------------
  const irpf = campo(raiz, 'irpf');
  const ir = s.irpf || {};
  const mapaIr = { apurar: 'apurarImpostoRenda', incidirSobreJuros: 'incidirSobreJurosDeMora', cobrarDoReclamado: 'cobrarDoReclamado', tributacaoExclusiva: 'considerarTributacaoExclusiva', tributacaoEmSeparado: 'considerarTributacaoEmSeparado', regimeDeCaixa: 'regimeDeCaixa', deduzirContribuicaoSocial: 'deduzirContribuicaoSocialDevidaPeloReclamante', deduzirPrevidenciaPrivada: 'deduzirPrevidenciaPrivada', deduzirPensaoAlimenticia: 'deduzirPensaoAlimenticia', deduzirHonorarios: 'deduzirHonorariosDevidosPeloReclamante', aposentadoMaior65: 'aposentadoMaiorQue65Anos' };
  for (const [k, campoJava] of Object.entries(mapaIr)) if (ir[k] != null) definir(irpf, campoJava, bool(ir[k]));
  if (ir.dependentes != null) { definir(irpf, 'possuiDependentes', bool(Number(ir.dependentes) > 0)); definir(irpf, 'quantidadeDependentes', String(Number(ir.dependentes))); }
  aplicarAvancado(irpf, ir.avancado, 'irpf.avancado');

  // ---------------- Honorários ----------------
  const colHon = campo(raiz, 'honorarios');
  for (const [i, h] of (s.honorarios || []).entries()) colHon.itens.push(construirHonorario(h, `honorarios[${i}]`, { doc, refCalculo, colVerbas }));

  // ---------------- Multas e indenizações ----------------
  const colMul = campo(raiz, 'multas');
  for (const [i, m] of (s.multas || []).entries()) colMul.itens.push(construirMulta(m, `multas[${i}]`, { doc, refCalculo }));

  // ---------------- Custas ----------------
  const custas = campo(raiz, 'custasJudiciais');
  const cu = s.custas || {};
  if (cu.base) definir(custas, 'baseParaCustasCalculadas', enumValido('BaseParaCustasCalculadasEnum', cu.base, 'custas.base'));
  const blocoCustas = (b, tipoCampo, valorCampo, vencCampo, enumNome, ctx) => {
    if (!b) return;
    definir(custas, tipoCampo, enumValido(enumNome, b.tipo, `${ctx}.tipo`));
    // a tela recusa custas informadas sem vencimento ("Existem erros no formulário")
    if (b.tipo === 'INFORMADA' && (b.valor == null || !b.vencimento)) erro(`${ctx}: custas INFORMADA precisam de "valor" e "vencimento" (a tela exige os dois).`);
    if (b.valor != null) definir(custas, valorCampo, dec(b.valor));
    if (b.vencimento) definir(custas, vencCampo, data(b.vencimento, `${ctx}.vencimento`));
  };
  blocoCustas(cu.reclamado, 'tipoDeCustasDeConhecimentoDoReclamado', 'valorConhecimentoDoReclamado', 'dataVencimentoConhecimentoDoReclamado', 'TipoDeCustasDeConhecimentoEnum', 'custas.reclamado');
  blocoCustas(cu.reclamante, 'tipoDeCustasDeConhecimentoDoReclamante', 'valorDeConhecimentoDoReclamante', 'dataVencimentoConhecimentoDoReclamante', 'TipoDeCustasDeConhecimentoEnum', 'custas.reclamante');
  blocoCustas(cu.liquidacao, 'tipoDeCustasDeLiquidacao', 'valorCustasDeLiquidacao', 'dataVencimentoCustasDeLiquidacao', 'TipoDeCustasDeLiquidacaoEnum', 'custas.liquidacao');
  if (cu.cobrancaReclamante) definir(custas, 'tipoCobrancaReclamante', enumValido('TipoCobrancaReclamanteEnum', cu.cobrancaReclamante, 'custas.cobrancaReclamante'));
  // custas fixas (atos dos oficiais de justiça, agravos, impugnação, embargos, recurso de revista), autos e
  // armazenamentos: o PJe-Calc aplica a tabela de custas da data de cada vencimento. Datas como a tela aceita:
  // a partir do ajuizamento e até hoje.
  const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const dataCustas = (v, ctx, obrigatoria = true) => {
    const ms = data(v, ctx, obrigatoria);
    if (ms == null) return null;
    if (Number(ms) < Number(ajuizamento)) erro(`${ctx}: ${msParaData(ms)} é anterior ao ajuizamento (${msParaData(ajuizamento)}); a tela recusa.`);
    if (msParaData(ms) > isoHoje) erro(`${ctx}: ${msParaData(ms)} é data futura; a tela recusa.`);
    return ms;
  };
  const refCustas = () => { if (campo(custas, 'id') === null) definir(custas, 'id', doc.id()); return { $ref: 'CustasJudiciais', id: campo(custas, 'id') }; };
  if (cu.fixas) {
    const fx = cu.fixas;
    for (const [k, [qtde]] of Object.entries(CUSTAS_FIXAS)) {
      if (fx[k] == null) continue;
      const n = Number(fx[k]);
      if (!Number.isInteger(n) || n < 0 || n > 999) erro(`custas.fixas.${k}: quantidade inteira de 0 a 999.`);
      definir(custas, qtde, String(n));
    }
    if (Object.keys(CUSTAS_FIXAS).some((k) => Number(fx[k] || 0) > 0) && !fx.vencimento) erro('custas.fixas: informe "vencimento" (sem ele o PJe-Calc não calcula as custas fixas).');
    if (fx.vencimento) definir(custas, 'dataVencimentoCustasFixas', dataCustas(fx.vencimento, 'custas.fixas.vencimento'));
  }
  if (cu.autos != null) {
    if (!Array.isArray(cu.autos)) erro('custas.autos: use uma lista de { tipo, vencimento, valor }.');
    campo(custas, 'autosJudiciais').itens = cu.autos.map((a, i) => {
      const ctx = `custas.autos[${i}]`;
      if (!a || !a.tipo) erro(`${ctx}.tipo: obrigatório (REMICAO, ADJUDICACAO ou ARREMATACAO).`);
      if (a.valor == null || Number(dec(a.valor)) <= 0) erro(`${ctx}.valor: informe o valor da avaliação (maior que zero).`);
      const o = objetoModelo('AutoJudicial');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      definir(o, 'tipoDeAuto', enumValido('TipoDeAutoEnum', a.tipo, `${ctx}.tipo`));
      definir(o, 'dataVencimentoAuto', dataCustas(a.vencimento, `${ctx}.vencimento`));
      definir(o, 'valorAvaliacaoAuto', dec(a.valor));
      definir(o, 'origemRegistro', 'CALCULO');
      definir(o, 'custasJudiciais', refCustas());
      return o;
    });
  }
  if (cu.armazenamentos != null) {
    if (!Array.isArray(cu.armazenamentos)) erro('custas.armazenamentos: use uma lista de { inicio, fim, valor }.');
    campo(custas, 'armazenamentos').itens = cu.armazenamentos.map((a, i) => {
      const ctx = `custas.armazenamentos[${i}]`;
      if (!a || a.valor == null || Number(dec(a.valor)) <= 0) erro(`${ctx}.valor: informe o valor da avaliação (maior que zero).`);
      const o = objetoModelo('Armazenamento');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      const ini = dataCustas(a.inicio, `${ctx}.inicio`);
      const fimA = dataCustas(a.fim, `${ctx}.fim`, false);
      if (fimA != null && Number(fimA) < Number(ini)) erro(`${ctx}: "fim" anterior a "inicio".`);
      definir(o, 'dataInicioArmazenamento', ini);
      definir(o, 'dataTerminoArmazenamento', fimA);
      definir(o, 'valorAvaliacaoArmazenamento', dec(a.valor));
      definir(o, 'origemRegistro', 'CALCULO');
      definir(o, 'custasJudiciais', refCustas());
      return o;
    });
  }
  aplicarAvancado(custas, cu.avancado, 'custas.avancado');

  // ---------------- Correção monetária e juros ----------------
  const par = campo(raiz, 'parametrosDeAtualizacao');
  const cj = s.correcaoJuros || {};
  if (cj.indice) definir(par, 'indiceTrabalhista', enumValido('IndiceMonetarioEnum', cj.indice, 'correcaoJuros.indice'));
  if (cj.ignorarTaxaNegativa != null) definir(par, 'ignorarTaxaNegativa', bool(cj.ignorarTaxaNegativa));
  if (cj.juros) definir(par, 'juros', enumValido('JurosEnum', cj.juros, 'correcaoJuros.juros'));
  if (cj.jurosFasePreJudicial != null) definir(par, 'aplicarJurosFasePreJudicial', bool(cj.jurosFasePreJudicial));
  if (cj.baseJuros) definir(par, 'baseDeJurosDasVerbas', enumValido('BaseDeJurosDasVerbasEnum', cj.baseJuros, 'correcaoJuros.baseJuros'));
  if (cj.indiceFgts) definir(par, 'indiceDeCorrecaoDoFGTS', enumValido('IndiceDeCorrecaoDoFGTSEnum', cj.indiceFgts, 'correcaoJuros.indiceFgts'));
  const colCombI = campo(par, 'listaDeCombinacaoDeIndices');
  const colCombJ = campo(par, 'listaDeCombinacaoDeJuros');
  if (Array.isArray(cj.combinacoesIndice)) {
    colCombI.itens = cj.combinacoesIndice.map((c, i) => {
      const o = objetoModelo('CombinacaoDeIndice');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      definir(o, 'outroIndiceTrabalhista', enumValido('IndiceMonetarioEnum', c.indice, `correcaoJuros.combinacoesIndice[${i}].indice`));
      definir(o, 'apartirDeOutroIndice', data(c.aPartirDe === 'ajuizamento' ? calc.ajuizamento : c.aPartirDe, `correcaoJuros.combinacoesIndice[${i}].aPartirDe`, true));
      definir(o, 'parametrosDeAtualizacao', { $ref: 'ParametrosDeAtualizacao', id: idParam });
      return o;
    });
    definir(par, 'combinarOutroIndice', bool(colCombI.itens.length > 0));
    // a tela grava também, no próprio parâmetro, a primeira combinação (a de data mais antiga)
    const primeira = [...colCombI.itens].sort((p, q) => Number(campo(p, 'apartirDeOutroIndice')) - Number(campo(q, 'apartirDeOutroIndice')))[0];
    if (primeira) { definir(par, 'outroIndiceTrabalhista', campo(primeira, 'outroIndiceTrabalhista')); definir(par, 'apartirDeOutroIndice', campo(primeira, 'apartirDeOutroIndice')); }
  }
  if (Array.isArray(cj.combinacoesJuros)) {
    colCombJ.itens = cj.combinacoesJuros.map((c, i) => {
      const o = objetoModelo('CombinacaoDeJuros');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      definir(o, 'outroJuros', enumValido('JurosEnum', c.juros, `correcaoJuros.combinacoesJuros[${i}].juros`));
      definir(o, 'apartirDeOutroJuros', data(c.aPartirDe === 'ajuizamento' ? calc.ajuizamento : c.aPartirDe, `correcaoJuros.combinacoesJuros[${i}].aPartirDe`, true));
      definir(o, 'parametrosDeAtualizacao', { $ref: 'ParametrosDeAtualizacao', id: idParam });
      return o;
    });
    definir(par, 'combinarOutroJuros', bool(colCombJ.itens.length > 0));
  } else {
    // padrão da interface: "sem juros" a partir do ajuizamento (combinação criada pelo PJe-Calc)
    for (const o of colCombJ.itens) if (campo(o, 'apartirDeOutroJuros')) definir(o, 'apartirDeOutroJuros', ajuizamento);
  }
  aplicarAvancado(par, dadosEspecificosDeAtualizacao(cj), 'correcaoJuros');
  aplicarAvancado(par, cj.avancado, 'correcaoJuros.avancado');

  // ---------------- Pensão, previdência privada, seguro-desemprego, salário-família ----------------
  const pen = campo(raiz, 'pensaoAlimenticia');
  const pa = s.pensaoAlimenticia;
  if (pa) {
    definir(pen, 'apurarPensaoAlimenticia', bool(pa.apurar ?? true));
    if (pa.aliquota != null) definir(pen, 'aliquota', dec(pa.aliquota));
    if (pa.incidirSobreJuros != null) definir(pen, 'incidirSobreJuros', bool(pa.incidirSobreJuros));
    aplicarAvancado(pen, pa.avancado, 'pensaoAlimenticia.avancado');
  }
  // previdência privada: alíquotas por período (competências)
  const prev = campo(raiz, 'previdenciaPrivada');
  const pp = s.previdenciaPrivada;
  if (pp) {
    definir(prev, 'apurarPrevidenciaPrivada', bool(pp.apurar ?? true));
    if (campo(prev, 'id') === null) definir(prev, 'id', doc.id());
    const al = pp.aliquotas || (pp.aliquota != null ? [{ de: msParaData(periodoIni).slice(0, 7), ate: msParaData(periodoFim).slice(0, 7), aliquota: pp.aliquota }] : []);
    if ((pp.apurar ?? true) && !al.length) erro('previdenciaPrivada: informe "aliquota" ou "aliquotas": [{ de, ate, aliquota }] (a tela exige ao menos uma).');
    campo(prev, 'aliquotas').itens = al.map((x, i) => {
      const o = objetoModelo('AliquotaDePrevidenciaPrivada');
      definir(o, 'id', doc.id()); definir(o, 'versao', '0');
      definir(o, 'dataInicioPeriodo', dataMs(compData(competencia(x.de, `previdenciaPrivada.aliquotas[${i}].de`))));
      definir(o, 'dataTerminoPeriodo', dataMs(compData(competencia(x.ate ?? x.de, `previdenciaPrivada.aliquotas[${i}].ate`))));
      definir(o, 'aliquota', dec(x.aliquota));
      definir(o, 'previdenciaPrivada', { $ref: 'PrevidenciaPrivada', id: campo(prev, 'id') });
      return o;
    });
    aplicarAvancado(prev, pp.avancado, 'previdenciaPrivada.avancado');
    if ((pp.apurar ?? true) && !itens(colVerbas).some((v) => campo(v, 'ativo') === 'true' && campo(v, 'incidenciaPrevidenciaPrivada') === 'true')) {
      avisos.push('previdenciaPrivada: nenhuma verba ativa tem a incidência de previdência privada marcada (use "incidencias": { "previdenciaPrivada": true }). O PJe-Calc não apura nada sem isso.');
    }
  }
  if (s.pensaoAlimenticia && (s.pensaoAlimenticia.apurar ?? true)
    && !itens(colVerbas).some((v) => campo(v, 'ativo') === 'true' && campo(v, 'incidenciaPensaoAlimenticia') === 'true')
    && campo(fgts, 'incidenciaPensaoAlimenticia') !== 'true') {
    erro('pensaoAlimenticia: o PJe-Calc exige a incidência de pensão em pelo menos uma verba (verbas[].incidencias.pensaoAlimenticia = true) ou no FGTS (fgts.incidenciaPensaoAlimenticia = true).');
  }

  // salário-família e seguro-desemprego: salário pelo histórico/última/maior remuneração ou por verbas
  const salarioPago = (b, obj, ctx, itensHist, classeItemHist, campoPai, itensDevido, classeItemDevido) => {
    if (b.tipoSalarioPago || b.historicos) definir(obj, 'tipoSalarioPago', enumValido('TipoSalarioPagoEnum', b.tipoSalarioPago || 'HISTORICO_SALARIAL', `${ctx}.tipoSalarioPago`));
    if (campo(obj, 'id') === null) definir(obj, 'id', doc.id());
    const refPai = { $ref: obj.$classe, id: campo(obj, 'id') };
    if (campo(obj, 'tipoSalarioPago') === 'HISTORICO_SALARIAL') {
      const nomes = b.historicos && b.historicos.length ? b.historicos : [...historicos.keys()].slice(0, 1);
      if (!nomes.length) erro(`${ctx}: informe "historicos" (salário pelo histórico salarial).`);
      campo(obj, itensHist).itens = nomes.map((n) => {
        const id = historicos.get(normalizar(n));
        if (!id) erro(`${ctx}: histórico "${n}" não existe.`);
        const o = objetoModelo(classeItemHist);
        definir(o, 'id', doc.id());
        definir(o, 'historicoSalarial', { $ref: 'HistoricoSalarial', id });
        definir(o, campoPai, refPai);
        return o;
      });
    }
    campo(obj, itensDevido).itens = (b.verbas || []).map((n) => {
      const nomeV = typeof n === 'string' ? n : n.nome;
      const vb = verbasCriadas.get(normalizar(nomeV));
      if (!vb) erro(`${ctx}.verbas: verba "${nomeV}" não existe no cálculo.`);
      return { $classe: classeItemDevido, campos: [['id', doc.id()], ['integralizar', sn(typeof n === 'object' ? n.integralizar !== false : true)], ['verbaDeCalculo', { $ref: vb.classe, id: vb.id }], [campoPai, refPai]] };
    });
  };
  const sf = s.salarioFamilia;
  if (sf) {
    const o = campo(raiz, 'salarioFamilia');
    definir(o, 'apurarSalarioFamilia', bool(sf.apurar ?? true));
    if (sf.filhos != null) definir(o, 'quantFilhosMenores14Anos', String(sf.filhos));
    definir(o, 'dataInicial', sf.inicio ? dataMs(compData(competencia(sf.inicio, 'salarioFamilia.inicio'))) : periodoIni);
    definir(o, 'dataFinal', sf.fim ? dataMs(compData(competencia(sf.fim, 'salarioFamilia.fim'))) : periodoFim);
    if (sf.comporPrincipal != null) definir(o, 'comporPrincipal', sn(sf.comporPrincipal));
    salarioPago(sf, o, 'salarioFamilia', 'itensHistoricoSalarial', 'ItemHistoricoSalarial', 'salarioFamilia', 'itensSalarioDevido', 'ItemSalarioDevido');
    campo(o, 'variacaoQuantidadesFilhos').itens = (sf.variacoes || []).map((x, i) => ({ $classe: 'VariacaoQuantidadeFilho', campos: [['id', doc.id()], ['dataInicial', dataMs(compData(competencia(x.aPartirDe, `salarioFamilia.variacoes[${i}].aPartirDe`)))], ['quantFilhosMenores14Anos', String(x.filhos)], ['salarioFamilia', { $ref: 'SalarioFamilia', id: campo(o, 'id') }]] }));
    aplicarAvancado(o, sf.avancado, 'salarioFamilia.avancado');
  }
  const sd = s.seguroDesemprego;
  if (sd) {
    const o = campo(raiz, 'seguroDesemprego');
    definir(o, 'apurarSeguroDesemprego', bool(sd.apurar ?? true));
    if (sd.empregadoDomestico != null) definir(o, 'empregadoDomestico', bool(sd.empregadoDomestico));
    definir(o, 'tipoSolicitacao', enumValido('TipoSolicitacaoSeguroDesempregoEnum', sd.solicitacao || 'PRIMEIRA', 'seguroDesemprego.solicitacao'));
    if (sd.parcelas != null) definir(o, 'numeroDeParcelas', String(sd.parcelas));
    if (sd.valor != null) { definir(o, 'tipoValorDoSeguroDesemprego', 'INFORMADO'); definir(o, 'valorSeguroDesemprego', dec(sd.valor, 25)); }
    else definir(o, 'tipoValorDoSeguroDesemprego', 'CALCULADO');
    if (sd.comporPrincipal != null) definir(o, 'comporPrincipal', sn(sd.comporPrincipal));
    salarioPago(sd, o, 'seguroDesemprego', 'itensHistoricoSalarialDeSegudoDesemprego', 'ItemHistoricoSalarialDeSeguroDesemprego', 'seguroDesemprego', 'itensSalarioDevidoDeSeguroDesemprego', 'ItemSalarioDevidoDeSeguroDesemprego');
    aplicarAvancado(o, sd.avancado, 'seguroDesemprego.avancado');
  }

  aplicarAvancado(raiz, calc.avancado, 'calculo.avancado');

  // premissas que vieram do padrão (a especificação não decidiu): devolvidas para o agente confirmar
  const padrao = (cond, txt) => { if (cond) premissasPadrao.push(txt); };
  padrao(!calc.avisoPrevio, `Aviso prévio: ${campo(raiz, 'apuracaoPrazoDoAvisoPrevio')}, projeção do aviso indenizado ${campo(raiz, 'projetaAvisoIndenizado') === 'true' ? 'SIM' : 'NÃO'} — informe calculo.avisoPrevio.`);
  padrao(!s.custas, `Custas: reclamado ${campo(custas, 'tipoDeCustasDeConhecimentoDoReclamado')}, reclamante ${campo(custas, 'tipoDeCustasDeConhecimentoDoReclamante')}, liquidação ${campo(custas, 'tipoDeCustasDeLiquidacao')} — informe "custas".`);
  padrao(!s.correcaoJuros, `Correção e juros: índice ${campo(par, 'indiceTrabalhista')}, juros ${campo(par, 'juros')}, juros na fase pré-judicial ${campo(par, 'aplicarJurosFasePreJudicial')}, ${itens(campo(par, 'listaDeCombinacaoDeIndices')).length} combinação(ões) de índice e ${itens(campo(par, 'listaDeCombinacaoDeJuros')).length} de juros — informe "correcaoJuros" por fase, como na decisão.`);
  padrao(!s.fgts, `FGTS: destino ${campo(fgts, 'destinoDoFgts')}, alíquota ${campo(fgts, 'aliquota')}, multa ${campo(fgts, 'multa') === 'true' ? campo(fgts, 'multaDoFgts') : 'NÃO'} — informe "fgts".`);
  padrao(!s.contribuicaoSocial, `Contribuição social: segurado ${campo(inss, 'tipoAliquotaSegurado')}, empregador ${campo(inss, 'tipoAliquotaEmpregador')} (empresa ${campo(inss, 'aliquotaEmpresaFixa')}%, RAT ${campo(inss, 'aliquotaRATFixa')}%, terceiros ${campo(inss, 'aliquotaTerceirosFixa')}%) — informe "contribuicaoSocial".`);
  padrao(!s.irpf, `IRPF: apurar ${campo(irpf, 'apurarImpostoRenda')}, dependentes ${campo(irpf, 'quantidadeDependentes') ?? 0} — informe "irpf".`);
  padrao(fer.gerar !== false && !(fer.periodos || []).length && itens(colFerias).length > 0, `Férias: situação de cada período gerada pela regra da tela (${itens(colFerias).map((o) => `${campo(o, 'relativa')} ${campo(o, 'situacao')}`).join(', ')}) — confirme em "ferias.periodos".`);
  if (s.exigirDecisoesExplicitas && premissasPadrao.length) {
    erro(`exigirDecisoesExplicitas: a especificação deixou ${premissasPadrao.length} decisão(ões) para o padrão do PJe-Calc:\n- ${premissasPadrao.join('\n- ')}`);
  }

  const resumo = {
    premissasPadrao,
    municipio: `${mun.nome}/${mun.uf} (id ${mun.id})`,
    periodo: `${msParaData(periodoIni)} a ${msParaData(periodoFim)}`,
    historicos: [...historicos.keys()],
    verbas: itens(colVerbas).filter((o) => campo(o, 'ativo') === 'true').map((o) => `${campo(o, 'nome')}${o.$classe === 'Reflexo' ? ' (reflexo)' : ''}`),
    ferias: itens(colFerias).map((o) => `${campo(o, 'relativa')}: ${campo(o, 'situacao')} (${campo(o, 'prazo')} dias)`),
    faltas: itens(colFaltas).length,
    honorarios: itens(colHon).length,
    multas: itens(colMul).length,
  };
  if (posImportacao.apurarCartao) {
    resumo.apuracaoCartaoPonto = itens(campo(raiz, 'apuracoesCartaoDePonto')).map((o) => `${msParaData(campo(o, 'dataInicial'))} a ${msParaData(campo(o, 'dataFinal'))}: ${campo(o, 'preenchimentoJornadasCartao')}, ${campo(o, 'formaDeApuracaoCartao')}`);
    resumo.vinculosCartaoAposImportacao = posImportacao.vinculosCartao.map((x) => `${x.verba} <- ${x.cartao} (${x.tipo})`);
    avisos.push('Cartão de ponto por jornadas: depois de importar, o PJe-Calc precisa gerar as jornadas e apurar o cartão (Cartão de Ponto > Alterar > Salvar > Visualizar Cartão > Apurar Cartão de Ponto) e as verbas precisam ser ligadas às colunas apuradas. calculo_criar / calculo_importar_pjc fazem isso automaticamente.');
  }
  if (posImportacao.edicoesOcorrencias.length) {
    resumo.edicoesOcorrencias = posImportacao.edicoesOcorrencias.map((x) => `${x.verba}: ${x.itens.length} ocorrência(s)`);
    avisos.push('Valores mês a mês nas ocorrências: depois de importar e regerar, o MCP exporta o cálculo, aplica as edições, reimporta e regera mantendo as alterações (calculo_criar / calculo_importar_pjc fazem isso).');
  }
  const enc = posImportacao.edicoesEncargos;
  const nEncargos = enc.fgts.length + enc.salariosDevidos.length + enc.salariosPagos.length;
  if (nEncargos) {
    resumo.edicoesEncargos = [['fgts', 'FGTS'], ['salariosDevidos', 'contribuição social sobre salários devidos'], ['salariosPagos', 'contribuição social sobre salários pagos']]
      .filter(([k]) => enc[k].length).map(([k, rot]) => `${rot}: ${enc[k].length} alteração(ões)`);
    avisos.push('Ocorrências de FGTS e de contribuição social: depois de importar, o MCP gera essas ocorrências pela tela (Ocorrências > Regerar), exporta o cálculo, aplica as edições e reimporta (calculo_criar / calculo_importar_pjc fazem isso).');
    if (enc.fgts.some((e) => e.aliquota != null)) avisos.push('fgts.ocorrencias com "aliquota": a tela não edita a alíquota de uma competência, e um novo Regerar do FGTS na tela (mesmo "mantendo alterações") volta todas à alíquota geral. Não regere o FGTS depois.');
  }
  const fixas = itens(campo(custas, 'autosJudiciais')).length + itens(campo(custas, 'armazenamentos')).length
    + Object.values(CUSTAS_FIXAS).reduce((a, [q]) => a + Number(campo(custas, q) || 0), 0);
  if (fixas) {
    resumo.custasFixas = `${Object.entries(CUSTAS_FIXAS).filter(([, [q]]) => Number(campo(custas, q) || 0) > 0).map(([k, [q]]) => `${k} ${campo(custas, q)}`).join(', ') || 'sem atos'}`
      + `; ${itens(campo(custas, 'autosJudiciais')).length} auto(s); ${itens(campo(custas, 'armazenamentos')).length} armazenamento(s)`;
  }
  const temPos = posImportacao.apurarCartao || posImportacao.edicoesOcorrencias.length > 0 || nEncargos > 0;
  return { arvore: raiz, avisos, resumo, posImportacao: temPos ? posImportacao : null };
}

// ---------------------------------------------------------------------------
// Honorários e multas (também usados nos eventos da atualização, lib/execucao.mjs)
// ---------------------------------------------------------------------------

/** Monta um Honorario a partir da especificação. `colVerbas`: coleção de verbas do cálculo (base por verbas escolhidas). */
export function construirHonorario(h, ctx, { doc, refCalculo, colVerbas }) {
  const o = objetoModelo('Honorario');
  definir(o, 'id', doc.id()); definir(o, 'versao', '0');
  const tipo = enumValido('TipoHonorarioEnum', h.tipo || 'SUCUMBENCIAIS', `${ctx}.tipo`);
  definir(o, 'tipoHonorario', tipo);
  definir(o, 'descricao', String(h.descricao || `HONORÁRIOS ${tipo.replace(/_/g, ' ')}`).toUpperCase());
  definir(o, 'tipoDeDevedor', enumValido('TipoDeDevedorDoHonorarioEnum', h.devedor || 'RECLAMADO', `${ctx}.devedor`));
  const cred = h.credor || {};
  if (!cred.nome) erro(`${ctx}.credor.nome é obrigatório.`);
  definir(o, 'nomeCredor', String(cred.nome).toUpperCase());
  definir(o, 'tipoDocumentoFiscalCredor', cred.cnpj ? 'CNPJ' : cred.cpf ? 'CPF' : null);
  definir(o, 'numeroDocumentoFiscalCredor', apenasDigitos(cred.cnpj || cred.cpf));
  definir(o, 'apurarIRRF', bool(h.apurarIrrf));
  definir(o, 'tipoImpostoRenda', h.apurarIrrf ? enumValido('TipoDeImpostoDeRendaEnum', h.tipoImpostoRenda || (cred.cnpj ? 'PESSOA_JURIDICA' : 'PESSOA_FISICA'), `${ctx}.tipoImpostoRenda`) : null);
  if (h.valor != null) {
    definir(o, 'tipoValor', 'INFORMADO');
    definir(o, 'valor', dec(h.valor));
    definir(o, 'dataVencimento', data(h.dataVencimento, `${ctx}.dataVencimento`, true));
    definir(o, 'aliquota', null);
    definir(o, 'baseParaApuracao', null);
  } else {
    if (h.percentual == null) erro(`${ctx}: informe "percentual" (honorário calculado) ou "valor" (informado).`);
    definir(o, 'tipoValor', 'CALCULADO');
    definir(o, 'valor', null);
    definir(o, 'aliquota', dec(h.percentual));
    definir(o, 'baseParaApuracao', enumValido('BaseParaApuracaoDeHonorarioEnum', h.base || (h.verbas ? 'VERBAS_QUE_NAO_COMPOE_O_PRINCIPAL' : 'BRUTO'), `${ctx}.base`));
  }
  // honorários sobre verbas escolhidas: só verbas (ou reflexos) que NÃO compõem o principal;
  // a base é a soma das diferenças corrigidas dessas verbas (sem juros e sem descontos)
  const baseHon = campo(o, 'baseParaApuracao');
  if (baseHon === 'VERBAS_QUE_NAO_COMPOE_O_PRINCIPAL') {
    if (!Array.isArray(h.verbas) || !h.verbas.length) erro(`${ctx}: base VERBAS_QUE_NAO_COMPOE_O_PRINCIPAL exige "verbas": [nomes das verbas que não compõem o principal].`);
    campo(o, 'verbasSelecionadas').itens = h.verbas.map((nomeV) => {
      const alvo = itens(colVerbas).find((x) => normalizar(campo(x, 'nome')) === normalizar(nomeV));
      if (!alvo) erro(`${ctx}.verbas: a verba "${nomeV}" não existe no cálculo.`);
      if (campo(alvo, 'ativo') !== 'true') erro(`${ctx}.verbas: a verba "${nomeV}" não está ativa (reflexo não pedido?).`);
      if (campo(alvo, 'comporPrincipal') !== 'NAO') erro(`${ctx}.verbas: a verba "${nomeV}" compõe o principal; a tela só oferece verbas com "comporPrincipal": false.`);
      return { $classe: 'HonorarioVerbaDeCalculo', campos: [['id', doc.id()], ['honorario', { $ref: 'Honorario', id: campo(o, 'id') }], ['verbaDeCalculo', { $ref: alvo.$classe, id: campo(alvo, 'id') }]] };
    });
  } else if (h.verbas) erro(`${ctx}: "verbas" só vale com base VERBAS_QUE_NAO_COMPOE_O_PRINCIPAL.`);
  if (h.indiceCorrecao && h.indiceCorrecao !== 'UTILIZAR_INDICE_TRABALHISTA') {
    definir(o, 'tipoDeIndiceDeCorrecao', 'UTILIZAR_OUTRO_INDICE');
    definir(o, 'outroIndiceDeCorrecao', enumValido('IndiceMonetarioEnum', h.indiceCorrecao, `${ctx}.indiceCorrecao`));
  }
  if (h.aplicarJuros != null) definir(o, 'aplicarJuros', bool(h.aplicarJuros));
  if (h.jurosAPartirDe) definir(o, 'dataApartirDeAplicarJuros', data(h.jurosAPartirDe, `${ctx}.jurosAPartirDe`));
  if (h.irSobreJuros != null) {
    if (h.irSobreJuros && !h.apurarIrrf) erro(`${ctx}.irSobreJuros: a tela só oferece o IR sobre os juros com "apurarIrrf" marcado.`);
    definir(o, 'apurarIRPFSobreJuros', bool(h.irSobreJuros));
  }
  if (h.cobrancaReclamante) definir(o, 'tipoCobrancaReclamante', enumValido('TipoCobrancaReclamanteEnum', h.cobrancaReclamante, `${ctx}.cobrancaReclamante`));
  definir(o, 'calculo', refCalculo());
  aplicarAvancado(o, h.avancado, `${ctx}.avancado`);
  return o;
}

/** Monta uma Multa (multa ou indenização) a partir da especificação. */
export function construirMulta(m, ctx, { doc, refCalculo }) {
  const o = objetoModelo('Multa');
  definir(o, 'id', doc.id()); definir(o, 'versao', '0');
  if (!m.descricao) erro(`${ctx}.descricao é obrigatória.`);
  definir(o, 'descricao', String(m.descricao).toUpperCase());
  definir(o, 'tipoCredorDevedor', enumValido('CredorDevedorMultaEnum', m.credorDevedor || 'RECLAMANTE_RECLAMADO', `${ctx}.credorDevedor`));
  definir(o, 'nomeTerceiro', m.nomeTerceiro ? String(m.nomeTerceiro).toUpperCase() : null);
  if (m.valor != null) {
    definir(o, 'tipoValorDaMulta', 'INFORMADO');
    definir(o, 'valorMulta', dec(m.valor));
    definir(o, 'dataVencimentoMulta', data(m.dataVencimento, `${ctx}.dataVencimento`, true));
    definir(o, 'aliquotaMulta', null);
    definir(o, 'tipoBaseMulta', null);
  } else {
    if (m.percentual == null) erro(`${ctx}: informe "percentual" (multa calculada) ou "valor" (informada).`);
    definir(o, 'tipoValorDaMulta', 'CALCULADO');
    definir(o, 'aliquotaMulta', dec(m.percentual));
    definir(o, 'tipoBaseMulta', enumValido('BaseParaApuracaoDeMultaEnum', m.base || 'PRINCIPAL', `${ctx}.base`));
  }
  if (m.indiceCorrecao && m.indiceCorrecao !== 'UTILIZAR_INDICE_TRABALHISTA') {
    definir(o, 'opcaoIndiceDeCorrecaoDaMulta', 'UTILIZAR_OUTRO_INDICE');
    definir(o, 'outroIndiceDeCorrecaoDaMulta', enumValido('IndiceMonetarioEnum', m.indiceCorrecao, `${ctx}.indiceCorrecao`));
  }
  if (m.aplicarJuros != null) definir(o, 'aplicarJurosSobreMulta', bool(m.aplicarJuros));
  if (m.jurosAPartirDe) definir(o, 'dataApartirDeAplicarJuros', data(m.jurosAPartirDe, `${ctx}.jurosAPartirDe`));
  definir(o, 'calculo', refCalculo());
  aplicarAvancado(o, m.avancado, `${ctx}.avancado`);
  return o;
}

// ---------------------------------------------------------------------------
// Apuração do cartão de ponto por jornadas
// ---------------------------------------------------------------------------

/** Colunas que "Apurar Cartão de Ponto" cria (CartoesDePontoEnum.getNome). */
export const COLUNAS_APURACAO = [
  ['HORAS_TRABALHADAS', 'Hs Trabalhadas'], ['HORAS_EXTRAS', 'Hs EXT'], ['DIAS_TRABALHADOS', 'Dias Trabalhados'],
  ['HORAS_EXTRAS_DIARIAS', 'Hs Ext Diárias'], ['HORAS_EXTRAS_SEMANAIS', 'Hs Ext Semanais'], ['HORAS_EXTRAS_MENSAIS', 'Hs Ext Mensais'],
  ['HORAS_DIURNAS', 'Hs Diurnas'], ['HORAS_NOTURNAS', 'Hs Noturnas'], ['HORAS_EXTRAS_NOTURNAS', 'Hs Ext Noturnas'],
  ['DIFERENCA_HORAS_NOTURNAS', 'Hs Noturnas (-) Hs Ext Noturnas'], ['ADICIONAL_SUMULA_85', 'Adicional Súmula 85'],
  ['HORAS_EXTRAS_PRIMEIRAS_EM_SEPARADO', 'Primeiras Hs Ext em Separado'], ['HORAS_EXTRAS_REPOUSOS', 'Hs Ext Diárias em Repousos'],
  ['HORAS_EXTRAS_NOTURNAS_REPOUSOS', 'Hs Ext Noturnas em Repousos'], ['HORAS_EXTRAS_FERIADOS', 'Hs Ext Diárias em Feriados'],
  ['HORAS_EXTRAS_NOTURNAS_FERIADOS', 'Hs Ext Noturnas em Feriados'], ['HORAS_EXTRAS_REPOUSOS_FERIADOS', 'Hs Ext em Repousos e Feriados'],
  ['HORAS_INTRAJORNADAS', 'Hs Intrajornada'], ['HORAS_EXCESSO_INTRAJORNADA', 'Exc Int Intrajornada'], ['HORAS_INTERJORNADAS', 'Hs Interjornadas'],
  ['HORAS_ARTIGO_253', 'Hs Insalubres'], ['HORAS_ARTIGO_72', 'Hs Art 72'], ['HORAS_ARTIGO_384', 'Hs Art 384'],
  ['REPOUSOS_TRABALHADOS', 'Repousos Trabalhados'], ['FERIADOS_TRABALHADOS', 'Feriados Trabalhados'],
  ['FERIADOS_REPOUSOS_TRABALHADOS', 'Feriados e Repousos Trabalhados'],
].map(([constante, nome]) => ({ constante, nome }));

const DIAS_PROGRAMACAO = [[2, 'segunda'], [3, 'terca'], [4, 'quarta'], [5, 'quinta'], [6, 'sexta'], [7, 'sabado'], [1, 'domingo'], [0, 'feriados']];
const ESCALAS_DOZE = { DOZE_POR_DOZE: 1, DOZE_POR_VINTE_QUATRO: 3, DOZE_POR_TRINTA_E_SEIS: 2, DOZE_POR_QUARENTA_E_OITO: 5 };
const ESCALAS_DIAS = { CINCO_POR_UM: 6, SEIS_POR_UM: 7, OITO_DOIS: 10 };
// dias de folga no fim do ciclo: a tela os deixa sem turno e bloqueados
const ESCALAS_FOLGAS = { CINCO_POR_UM: 1, SEIS_POR_UM: 1, OITO_DOIS: 2 };

/** "8", 8, "08:00", "8:30", 7.5 -> "HH:MM" */
function hora(v, ctx) {
  if (v === null || v === undefined || v === '') erro(`${ctx}: horário obrigatório.`);
  if (typeof v === 'number') {
    if (!(v >= 0 && v <= 48)) erro(`${ctx}: quantidade de horas inválida (${v}).`);
    const h = Math.floor(v); const m = Math.round((v - h) * 60);
    return `${String(h + (m === 60 ? 1 : 0)).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
  }
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(v).trim().replace(/h$/i, ''));
  if (!m || +m[2] > 59) erro(`${ctx}: horário inválido "${v}" (use HH:MM).`);
  return `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
}
const horaDoRelogio = (v, ctx) => { const h = hora(v, ctx); if (+h.slice(0, 2) > 23) erro(`${ctx}: horário de relógio inválido "${v}".`); return h; };
const minutos = (h) => +h.slice(0, 2) * 60 + +h.slice(3);
const somarHoras = (h, horas) => { const t = (minutos(h) + horas * 60) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** Turnos de um dia: ["08:00-12:00", {entrada:"13:00", saida:"18:00"}] -> [[e,s], ...] (até 6). */
function turnos(lista, ctx) {
  if (lista === null || lista === undefined || lista === false) return [];
  const arr = Array.isArray(lista) ? lista : [lista];
  if (arr.length > 6) erro(`${ctx}: no máximo 6 turnos (entrada/saída) por dia.`);
  return arr.map((t, i) => {
    const c = `${ctx}[${i}]`;
    if (typeof t === 'string') {
      const m = /^\s*([\d:]+)\s*(?:-|–|a|às|as)\s*([\d:]+)\s*$/i.exec(t);
      if (!m) erro(`${c}: turno inválido "${t}" (use "08:00-12:00").`);
      return [horaDoRelogio(m[1], c), horaDoRelogio(m[2], c)];
    }
    if (t && typeof t === 'object') return [horaDoRelogio(t.entrada, `${c}.entrada`), horaDoRelogio(t.saida, `${c}.saida`)];
    erro(`${c}: turno inválido.`);
  });
}
function definirTurnos(o, ts) {
  for (let k = 1; k <= 6; k++) {
    definir(o, `hrEntrada${k}`, ts[k - 1] ? ts[k - 1][0] : null);
    definir(o, `hrSaida${k}`, ts[k - 1] ? ts[k - 1][1] : null);
  }
}

function criarApuracaoCartao(a, ctx, { doc, calc, refCalculo, admissao, periodoFim }) {
  const o = objetoModelo('ApuracaoCartaoDePonto');
  const id = doc.id();
  definir(o, 'id', id); definir(o, 'versao', '0');
  const ref = () => ({ $ref: 'ApuracaoCartaoDePonto', id });
  const ini = data(a.inicio, `${ctx}.inicio`, true);
  const fim = data(a.fim, `${ctx}.fim`, true);
  if (Number(fim) < Number(ini)) erro(`${ctx}: fim anterior ao início.`);
  if (Number(ini) < Number(admissao) || Number(fim) > Number(periodoFim)) erro(`${ctx}: o período (${msParaData(ini)} a ${msParaData(fim)}) precisa estar dentro do período do cálculo (${msParaData(admissao)} a ${msParaData(periodoFim)}).`);
  definir(o, 'dataInicial', ini);
  definir(o, 'dataFinal', fim);
  definir(o, 'calculo', refCalculo());
  definir(o, 'formaDeApuracaoCartao', enumValido('FormaDeApuracaoCartaoEnum', a.criterio || 'HORAS_EXTRAS_EXCEDENTES_DA_JORNADA_DIARIA', `${ctx}.criterio`));

  // jornada contratual (padrões da tela de apuração do cartão de ponto num registro novo)
  const carga = Number(calc.cargaHoraria ?? 220);
  const sabadoUtil = calc.sabadoDiaUtil ?? true;
  let padraoDia = '08:00';
  if (carga !== 220) { const d = carga / 30; const h = Math.floor(d); padraoDia = `${String(h).padStart(2, '0')}:${String(Math.round((d - h) * 60)).padStart(2, '0')}`; }
  const jd = a.jornadaDiaria || {};
  const camposJd = { segunda: 'valorJornadaDiariaSegundaFeira', terca: 'valorJornadaDiariaTercaFeira', quarta: 'valorJornadaDiariaQuartaFeira', quinta: 'valorJornadaDiariaQuintaFeira', sexta: 'valorJornadaDiariaSextaFeira', sabado: 'valorJornadaDiariaSab', domingo: 'valorJornadaDiariaDom' };
  for (const k of Object.keys(jd)) if (!camposJd[k] && k !== 'segundaASexta') erro(`${ctx}.jornadaDiaria: dia "${k}" inválido (use ${Object.keys(camposJd).join(', ')} ou segundaASexta).`);
  for (const [dia, campoJd] of Object.entries(camposJd)) {
    const padrao = dia === 'domingo' ? '00:00' : dia === 'sabado' ? (sabadoUtil ? padraoDia : '00:00') : padraoDia;
    const v = jd[dia] ?? (['segunda', 'terca', 'quarta', 'quinta', 'sexta'].includes(dia) ? jd.segundaASexta : undefined);
    definir(o, campoJd, v != null ? hora(v, `${ctx}.jornadaDiaria.${dia}`) : padrao);
  }
  const semanal = a.jornadaSemanal ?? (carga * (sabadoUtil ? 6 : 5)) / 30;
  const mensal = a.jornadaMensal ?? Math.round((Number(semanal) * 30 / 7) * 100) / 100;
  definir(o, 'qtJornadaSemanal', dec(semanal, 4));
  definir(o, 'qtJornadaMensal', dec(mensal, 4));

  // critérios (os nomes curtos abaixo cobrem a tela; qualquer outro campo vai em "avancado")
  const b = (k, campoJ, padrao) => { const v = a[k] ?? padrao; if (v !== undefined) definir(o, campoJ, bool(v)); };
  b('considerarFeriados', 'considerarFeriados', true);
  b('extraDescansoSeparado', 'extraDescansoSeparado', false);
  b('extraFeriadoSeparado', 'extraFeriadoSeparado', false);
  b('extraSabadoDomingoSeparado', 'extraSabadoDomingoSeparado', false);
  b('apurarHorasNoturnas', 'apurarHorasNoturnas', false);
  b('apurarHorasExtrasNoturnas', 'apurarHorasExtrasNoturnas', false);
  b('reducaoFicta', 'considerarReducaoFictaDaHoraNoturna', true);
  b('prorrogacaoSumula60', 'horarioProrrogadoSumula60', false);
  b('forcarProrrogacao', 'forcarProrrogacao', false);
  b('apurarFeriadosTrabalhados', 'apurarFeriadosTrabalhados', false);
  b('apurarSabadosDomingosTrabalhados', 'apurarSabadosDomingosTrabalhados', false);
  b('apurarDomingosTrabalhados', 'apurarDomingosTrabalhados', false);
  b('jornadaDiariaFeriadoTrabalhado', 'considerarJornadaDiariaFeriadoTrabalhado', false);
  b('jornadaDiariaFeriadoNaoTrabalhado', 'considerarJornadaDiariaFeriadoNaoTrabalhado', false);
  b('art384', 'apurarSupressaoIntervalo384', false);
  b('art72', 'apurarSupressaoIntervalo72', false);
  definir(o, 'horarioNoturnoApuracaroCartao', enumValido('HorarioNoturnoApuracaroCartaoEnum', a.horarioNoturno || 'ATIVIDADE_URBANA', `${ctx}.horarioNoturno`));
  definir(o, 'qtHorasExtasSumulaTST', a.limiteSumula85 != null ? hora(a.limiteSumula85, `${ctx}.limiteSumula85`) : '02:00');
  definir(o, 'qtPrimeirasHorasExtrasSeparado', a.primeirasHorasExtras != null ? hora(a.primeirasHorasExtras, `${ctx}.primeirasHorasExtras`) : '02:00');
  const tol = a.tolerancia;
  definir(o, 'tolerancia', bool(!!tol));
  definir(o, 'toleranciaPorTurno', tol && tol.porTurno != null ? hora(tol.porTurno, `${ctx}.tolerancia.porTurno`) : '00:05');
  definir(o, 'toleranciaPorDia', tol && tol.porDia != null ? hora(tol.porDia, `${ctx}.tolerancia.porDia`) : '00:10');
  const intra = a.intervaloIntrajornada || {};
  definir(o, 'intervaloIntraJornadaSupQuatroSeis', bool(intra.acimaDe4ate6 != null && intra.acimaDe4ate6 !== false));
  definir(o, 'valorIntervaloIntraJornadaSupQuatroSeis', typeof intra.acimaDe4ate6 === 'string' || typeof intra.acimaDe4ate6 === 'number' ? hora(intra.acimaDe4ate6, `${ctx}.intervaloIntrajornada.acimaDe4ate6`) : '00:15');
  definir(o, 'intervalorIntraJornadaSupSeis', bool(intra.acimaDe6 != null && intra.acimaDe6 !== false));
  definir(o, 'valorIntervalorIntraJornadaSupSeis', typeof intra.acimaDe6 === 'string' || typeof intra.acimaDe6 === 'number' ? hora(intra.acimaDe6, `${ctx}.intervaloIntrajornada.acimaDe6`) : '01:00');
  definir(o, 'toleranciaIntervaloIntraJornadaSupSeis', intra.tolerancia != null ? hora(intra.tolerancia, `${ctx}.intervaloIntrajornada.tolerancia`) : '00:05');
  definir(o, 'apurarSupressaoIntervaloIntraIntegral', bool(intra.supressaoIntegral));
  // ao marcar "acima de 6 horas" a tela já marca a supressão pela Reforma (art. 71, § 4º, CLT, Lei 13.467/2017)
  const intraAcimaDe6 = intra.acimaDe6 != null && intra.acimaDe6 !== false;
  definir(o, 'apurarSupressaoIntervaloIntraReforma', bool(intra.supressaoReforma ?? (intraAcimaDe6 && !intra.supressaoIntegral)));
  definir(o, 'considerarFracionamentoIntervaloIntra', bool(intra.fracionamento));
  definir(o, 'apurarExcessoIntervaloIntra', bool(intra.excessoMaximo != null && intra.excessoMaximo !== false));
  definir(o, 'intervaloIntrajornadaMaximo', typeof intra.excessoMaximo === 'string' || typeof intra.excessoMaximo === 'number' ? hora(intra.excessoMaximo, `${ctx}.intervaloIntrajornada.excessoMaximo`) : '02:00');
  definir(o, 'apurarApenasExcessoAcimaJornada', bool(intra.apenasExcessoAcimaJornada));
  const inter = a.intervaloInterjornadas;
  definir(o, 'descansoEntreJornadas', bool(!!inter));
  definir(o, 'valorDescansoEntreJornadas', inter && inter.entreJornadas != null ? hora(inter.entreJornadas, `${ctx}.intervaloInterjornadas.entreJornadas`) : '11:00');
  definir(o, 'valorDescansoEntreSemanas', inter && inter.entreSemanas != null ? hora(inter.entreSemanas, `${ctx}.intervaloInterjornadas.entreSemanas`) : '35:00');
  const a253 = a.art253;
  definir(o, 'apurarSupressaoIntervaloArt253', bool(!!a253));
  definir(o, 'valorTrabalhoArt253', a253 && a253.trabalho != null ? hora(a253.trabalho, `${ctx}.art253.trabalho`) : '01:40');
  definir(o, 'valorDescansoArt253', a253 && a253.descanso != null ? hora(a253.descanso, `${ctx}.art253.descanso`) : '00:20');

  // preenchimento das jornadas
  const modo = enumValido('PreenchimentoJornadasCartaoEnum', a.preenchimento || (a.escala ? 'ESCALA' : a.programacao ? 'PROGRAMACAO' : 'LIVRE'), `${ctx}.preenchimento`);
  definir(o, 'preenchimentoJornadasCartao', modo);
  const colSem = campo(o, 'preenchimentoJornadaSemanalApuracaoCartao');
  const colEsc = campo(o, 'preenchimentoJornadaEscalaApuracaoCartao');
  colSem.itens = []; colEsc.itens = [];
  definir(o, 'tipoEscalaPreenchimentoJornadaCartaoEnum', 'OUTRA');
  definir(o, 'valorHoraInicioEscala', null);
  definir(o, 'qtdDiasTrabalhados', null);
  const linhaPreenchimento = (tipo, seq, ts, editavel) => {
    const x = objetoModelo('PreenchimentoJornadaApuracaoCartao');
    definir(x, 'id', doc.id()); definir(x, 'versao', '0');
    definir(x, 'sequencial', String(seq));
    definir(x, 'tipoPreenchimentoJornadaCartao', tipo);
    definirTurnos(x, ts);
    definir(x, 'editavel', bool(editavel));
    definir(x, 'apuracaoCartaoDePonto', ref());
    return x;
  };
  if (modo === 'PROGRAMACAO') {
    const pg = a.programacao;
    if (!pg || typeof pg !== 'object') erro(`${ctx}.programacao: informe os turnos por dia da semana, ex.: {"segundaASexta": ["08:00-12:00", "13:00-18:00"], "sabado": ["08:00-12:00"]}.`);
    const validos = new Set([...DIAS_PROGRAMACAO.map(([, d]) => d), 'segundaASexta', 'feriado']);
    for (const k of Object.keys(pg)) if (!validos.has(k)) erro(`${ctx}.programacao: chave "${k}" inválida (use ${[...validos].join(', ')}).`);
    let algum = false;
    for (const [seq, dia] of DIAS_PROGRAMACAO) {
      const v = pg[dia] ?? (dia === 'feriados' ? pg.feriado : undefined) ?? (seq >= 2 && seq <= 6 ? pg.segundaASexta : undefined);
      const ts = turnos(v, `${ctx}.programacao.${dia}`);
      if (ts.length) algum = true;
      colSem.itens.push(linhaPreenchimento('SEMANAL', seq, ts, true));
    }
    if (!algum) erro(`${ctx}.programacao: nenhum dia com turno.`);
  } else if (modo === 'ESCALA') {
    const e = a.escala || {};
    const tipo = enumValido('TipoEscalaPreenchimentoJornadaCartaoEnum', e.tipo || 'OUTRA', `${ctx}.escala.tipo`);
    definir(o, 'tipoEscalaPreenchimentoJornadaCartaoEnum', tipo);
    let ciclo;
    if (ESCALAS_DOZE[tipo]) {
      const i0 = horaDoRelogio(e.inicio, `${ctx}.escala.inicio`);
      const dia = [[i0, somarHoras(i0, 12)]], noite = [[somarHoras(i0, 12), i0]];
      ciclo = { DOZE_POR_DOZE: [dia], DOZE_POR_VINTE_QUATRO: [dia, noite, []], DOZE_POR_TRINTA_E_SEIS: [dia, []], DOZE_POR_QUARENTA_E_OITO: [dia, [], noite, [], []] }[tipo];
      if (e.ciclo) erro(`${ctx}.escala: na escala ${tipo} o ciclo é montado pelo PJe-Calc a partir de "inicio"; não informe "ciclo" (use tipo OUTRA para um ciclo próprio).`);
      definir(o, 'valorHoraInicioEscala', i0);
    } else {
      if (!Array.isArray(e.ciclo) || !e.ciclo.length) erro(`${ctx}.escala.ciclo: informe os dias do ciclo em ordem, cada um com seus turnos ([] = folga). Ex.: 5x1 = 6 dias.`);
      if (ESCALAS_DIAS[tipo] && e.ciclo.length !== ESCALAS_DIAS[tipo]) erro(`${ctx}.escala.ciclo: a escala ${tipo} tem ${ESCALAS_DIAS[tipo]} dias no ciclo (informados ${e.ciclo.length}).`);
      ciclo = e.ciclo.map((d, i) => turnos(d, `${ctx}.escala.ciclo[${i}]`));
      const folgas = ESCALAS_FOLGAS[tipo] || 0;
      if (ciclo.slice(ciclo.length - folgas).some((d) => d.length)) erro(`${ctx}.escala.ciclo: na escala ${tipo} ${folgas === 1 ? 'o último dia é folga' : `os últimos ${folgas} dias são folga`} (informe [] para ${folgas === 1 ? 'ele' : 'eles'}).`);
      if (!ciclo.some((d) => d.length)) erro(`${ctx}.escala.ciclo: nenhum dia com turno.`);
      if (tipo === 'OUTRA') definir(o, 'qtdDiasTrabalhados', String(ciclo.length));
    }
    colEsc.itens = ciclo.map((ts, i) => linhaPreenchimento('ESCALA', i + 1, ts, !ESCALAS_DOZE[tipo] && i < ciclo.length - (ESCALAS_FOLGAS[tipo] || 0)));
  }
  // jornadas dia a dia (lançamento manual; no modo LIVRE são a fonte da apuração)
  const colOc = campo(o, 'ocorrenciasJornadaApuracaoCartao');
  colOc.itens = [];
  const vistos = new Set();
  for (const [j, x] of (a.jornadas || []).entries()) {
    const c = `${ctx}.jornadas[${j}]`;
    const d = data(x.data, `${c}.data`, true);
    if (Number(d) < Number(ini) || Number(d) > Number(fim)) erro(`${c}: data ${msParaData(d)} fora do período da apuração.`);
    if (vistos.has(d)) erro(`${c}: data ${msParaData(d)} repetida.`);
    vistos.add(d);
    const oc = objetoModelo('OcorrenciaJornadaApuracaoCartao');
    definir(oc, 'id', doc.id()); definir(oc, 'versao', '0');
    definir(oc, 'dataOcorrencia', d);
    definirTurnos(oc, turnos(x.turnos ?? [], `${c}.turnos`));
    definir(oc, 'alteradaManualmente', 'true');
    definir(oc, 'apuracaoCartaoDePonto', ref());
    colOc.itens.push(oc);
  }
  colOc.itens.sort((p, q) => Number(campo(p, 'dataOcorrencia')) - Number(campo(q, 'dataOcorrencia')));
  if (modo === 'LIVRE' && !colOc.itens.length) erro(`${ctx}: no preenchimento LIVRE informe "jornadas" (dia a dia) — ou use "programacao"/"escala".`);
  aplicarAvancado(o, a.avancado, `${ctx}.avancado`);
  return o;
}

// ---------------------------------------------------------------------------
// Configuração de uma verba principal a partir da especificação
// ---------------------------------------------------------------------------

function vinculoCartao(v, nomeCartao, tipoVinculo, cartoes, doc, ctx, pendentes = null) {
  const id = cartoes.get(normalizar(nomeCartao));
  if (!id) erro(`${ctx}: cartão de ponto "${nomeCartao}" não existe. Cadastre-o em "cartoesDePonto" ou use uma coluna da "apuracaoCartaoPonto" (${COLUNAS_APURACAO.map((c) => c.nome).join(', ')}).`);
  if (typeof id === 'object') {
    // coluna que só existirá depois que o PJe-Calc apurar o cartão: o vínculo é feito após a importação
    if (pendentes) pendentes.push({ verba: campo(v, 'nome'), tipo: tipoVinculo, cartao: id.apuracao });
    return null;
  }
  const o = objetoModelo('CartaoDePontoDaVerba');
  definir(o, 'id', doc.id());
  definir(o, 'tipoVinculoCartao', tipoVinculo);
  definir(o, 'verbaDeCalculo', { $ref: v.$classe, id: campo(v, 'id') });
  definir(o, 'cartaoDePonto', { $ref: 'CartaoDePonto', id });
  return o;
}

function vinculosHistorico(v, nomes, tipoVinculo, proporcionalizar, historicos, doc, ctx, modelo = null) {
  return nomes.map((n) => {
    const id = historicos.get(normalizar(n));
    if (!id) erro(`${ctx}: histórico salarial "${n}" não existe. Cadastrados: ${[...historicos.keys()].join(', ') || '(nenhum)'}`);
    const o = modelo ? clonar(modelo) : objetoHistoricoVerba();
    definir(o, 'id', doc.id());
    definir(o, 'tipoVinculoHistorico', tipoVinculo);
    definir(o, 'aplicarProporcionalidade', bool(proporcionalizar));
    definir(o, 'verbaDeCalculo', { $ref: v.$classe, id: campo(v, 'id') });
    definir(o, 'historicoSalarial', { $ref: 'HistoricoSalarial', id });
    return o;
  });
}

/** Parâmetros comuns a verbas principais e reflexos (campos de VerbaDeCalculo). */
function parametrosComuns(v, p, ctx) {
  const inc = p.incidencias || {};
  const mapaInc = { inss: 'incidenciaINSS', irpf: 'incidenciaIRPF', fgts: 'incidenciaFGTS', previdenciaPrivada: 'incidenciaPrevidenciaPrivada', pensaoAlimenticia: 'incidenciaPensaoAlimenticia' };
  for (const [k, c] of Object.entries(mapaInc)) if (inc[k] != null) definir(v, c, bool(inc[k]));
  if (p.caracteristica) definir(v, 'caracteristica', enumValido('CaracteristicaDaVerbaEnum', p.caracteristica, `${ctx}.caracteristica`));
  if (p.ocorrenciaDePagamento) definir(v, 'ocorrenciaDePagamento', enumValido('OcorrenciaDePagamentoEnum', p.ocorrenciaDePagamento, `${ctx}.ocorrenciaDePagamento`));
  if (p.jurosDoAjuizamento) definir(v, 'jurosDoAjuizamento', enumValido('JurosDoAjuizamentoEnum', p.jurosDoAjuizamento, `${ctx}.jurosDoAjuizamento`));
  if (p.gerarPrincipal) definir(v, 'gerarPrincipal', enumValido('TipoDeGeracaoEnum', p.gerarPrincipal, `${ctx}.gerarPrincipal`));
  if (p.gerarReflexo) definir(v, 'gerarReflexo', enumValido('TipoDeGeracaoEnum', p.gerarReflexo, `${ctx}.gerarReflexo`));
  if (p.comporPrincipal != null) definir(v, 'comporPrincipal', sn(p.comporPrincipal));
  if (p.zerarNegativo != null) definir(v, 'zeraValorNegativo', bool(p.zerarNegativo));
  if (p.excluirFaltasJustificadas != null) definir(v, 'excluirFaltaJustificada', bool(p.excluirFaltasJustificadas));
  if (p.excluirFaltasNaoJustificadas != null) definir(v, 'excluirFaltaNaoJustificada', bool(p.excluirFaltasNaoJustificadas));
  if (p.excluirFeriasGozadas != null) definir(v, 'excluirFeriasGozadas', bool(p.excluirFeriasGozadas));
  if (p.variavel != null) definir(v, 'tipoVariacaoParcela', p.variavel ? 'VARIAVEL' : 'FIXA');
  if (p.comentarios) definir(v, 'comentarios', String(p.comentarios));
  if (p.assuntoCnj) definir(v, 'assuntoCnj', { $ext: 'AssuntoCnj', id: String(p.assuntoCnj) });
}

function configurarVerba(v, spec, personalizada, ctx, { historicos, avisos, doc, cartoes = new Map(), verbasCriadas = new Map(), pendentesCartao = null }) {
  const p = personalizada || spec;
  const f = campo(v, 'formula');
  parametrosComuns(v, p, ctx);
  definir(v, 'verbaAlterada', 'false');

  if (f.$classe === 'FormulaInformada') {
    const valor = p.valor ?? spec.valor;
    if (valor == null) erro(`${ctx}: verba de valor informado — informe "valor".`);
    definir(campo(f, 'constante'), 'valor', dec(valor, 25));
    // caixa "Proporcionalizar" do valor devido (na tela vem marcada; para indenizações costuma ser desmarcada)
    if (p.proporcionalizar != null) definir(v, 'aplicarProporcionalidade', bool(p.proporcionalizar));
    configurarValorPago(f, p, ctx, v, { historicos, doc });
    aplicarAvancado(v, p.avancado, `${ctx}.avancado`);
    return;
  }
  // ----- verba calculada: base, divisor, multiplicador, quantidade -----
  const bt = campo(f, 'baseTabelada');
  const base = p.base || {};
  if (base.tipo) definir(bt, 'tipo', enumValido('BaseDeCalculoDoPrincipalEnum', base.tipo, `${ctx}.base.tipo`));
  if (base.proporcionalizar != null && bt) definir(bt, 'aplicarProporcionalidade', bool(base.proporcionalizar));
  const tipoBase = bt ? campo(bt, 'tipo') : null;
  const vinculos = campo(v, 'historicosDaVerbaDoValorDevido');
  if (tipoBase === 'HISTORICO_SALARIAL') {
    let nomes = base.historicos;
    if (!nomes || !nomes.length) {
      const candidatos = [...historicos.keys()].filter((n) => n !== normalizar('ÚLTIMA REMUNERAÇÃO'));
      nomes = candidatos.length ? [candidatos[0]] : [...historicos.keys()].slice(0, 1);
      if (!nomes.length) erro(`${ctx}: a verba usa base "Histórico Salarial", mas o cálculo não tem histórico salarial. Cadastre "historicosSalariais" ou informe calculo.ultimaRemuneracao.`);
      avisos.push(`${ctx}: base de cálculo não informada; usando o histórico "${nomes[0]}".`);
    }
    const modeloVinc = vinculos.itens[0] ? clonar(vinculos.itens[0]) : null;
    // Na tela de parâmetros da verba, com base "Histórico Salarial", o "Proporcionalizar" é gravado
    // no vínculo verba<->histórico. Reproduzimos o que a tela grava ao salvar
    // (base histórico => proporcionalidade da base tabelada = false; o vínculo nasce com o valor da
    // caixa "proporcionalizar valor devido", que é o indicador da própria verba.)
    const proporcionalizar = base.proporcionalizar ?? (campo(v, 'aplicarProporcionalidade') === 'true');
    if (bt) definir(bt, 'aplicarProporcionalidade', 'false');
    vinculos.itens = vinculosHistorico(v, nomes, 'BASE', proporcionalizar, historicos, doc, ctx, modeloVinc);
  } else {
    vinculos.itens = [];
  }
  // piso salarial (tabela "Pisos Salariais" do PJe-Calc) e vale-transporte: referências externas por id ao banco
  // do usuário (o id precisa existir lá; ver catalogo_pisos_vt). Sem a tabela, use o piso da norma coletiva como
  // histórico salarial.
  if (tipoBase === 'SALARIO_DA_CATEGORIA') {
    if (base.piso == null) erro(`${ctx}.base: base SALARIO_DA_CATEGORIA exige "piso" (id da tabela Pisos Salariais do PJe-Calc; catalogo_pisos_vt). Sem a tabela, informe o piso da norma coletiva como histórico salarial e use base HISTORICO_SALARIAL.`);
    definir(v, 'salarioCategoriaValorDevido', { $ext: 'SalarioCategoria', id: String(base.piso) });
  }
  if (tipoBase === 'VALE_TRANSPORTE') {
    const lst = base.valesTransporte || [];
    if (!lst.length) erro(`${ctx}.base: base VALE_TRANSPORTE exige "valesTransporte": [ids da tabela Vale-transporte do PJe-Calc] (catalogo_pisos_vt).`);
    campo(v, 'valesTransportesDoValorDevido').itens = lst.map((id) => ({ $classe: 'ValeTransporteDaVerba', campos: [['id', doc.id()], ['verbaDeCalculo', { $ref: v.$classe, id: campo(v, 'id') }], ['valeTransporte', { $ext: 'ValeTransporte', id: String(id) }], ['tipoVinculoHistorico', 'BASE']] }));
  }
  // base composta por outras verbas do cálculo (soma integral ou proporcional das verbas indicadas)
  if (Array.isArray(base.verbas) && base.verbas.length) {
    const colItens = campo(campo(f, 'baseVerba'), 'itens');
    colItens.itens = base.verbas.map((nomeB) => {
      const alvo = typeof nomeB === 'string' ? nomeB : nomeB.nome;
      const vb = verbasCriadas.get(normalizar(alvo));
      if (!vb) erro(`${ctx}: base.verbas — a verba "${alvo}" precisa vir ANTES nesta lista de verbas. Já criadas: ${[...verbasCriadas.keys()].join(', ') || '(nenhuma)'}`);
      const it = objetoModelo('ItemBaseVerba');
      definir(it, 'id', doc.id());
      definir(it, 'integralizar', sn(typeof nomeB === 'object' ? nomeB.integralizar !== false : base.integralizar !== false));
      definir(it, 'verbaDeCalculo', { $ref: vb.classe, id: vb.id });
      definir(it, 'formula', { $ref: f.$classe, id: campo(f, 'id') });
      return it;
    });
  }
  // divisor
  const div = campo(f, 'divisor');
  const vincCartaoDiv = campo(v, 'cartoesDePontoDaVerbaDivisor');
  if (p.divisor != null && div) {
    const d = typeof p.divisor === 'object' ? p.divisor : { tipo: 'OUTRO_VALOR', valor: p.divisor };
    definir(div, 'tipo', enumValido('DivisorDeVerbaEnum', d.tipo || (d.cartao ? 'IMPORTADA_DO_CARTAO' : 'OUTRO_VALOR'), `${ctx}.divisor.tipo`));
    definir(div, 'outroValor', campo(div, 'tipo') === 'OUTRO_VALOR' ? dec(d.valor, 25) : null);
    if (campo(div, 'tipo') === 'IMPORTADA_DO_CARTAO') {
      if (!d.cartao) erro(`${ctx}.divisor: informe "cartao" (nome do cartão de ponto).`);
      vincCartaoDiv.itens = [vinculoCartao(v, d.cartao, 'DIVISOR', cartoes, doc, `${ctx}.divisor`, pendentesCartao)].filter(Boolean);
    }
  }
  // multiplicador
  if (p.multiplicador != null) definir(campo(f, 'multiplicador'), 'outroValor', dec(p.multiplicador, 25));
  // quantidade
  const q = campo(f, 'quantidade');
  const vincCartaoQtd = campo(v, 'cartoesDePontoDaVerbaQuantidade');
  if (p.quantidade != null && q) {
    const qq = typeof p.quantidade === 'object' ? p.quantidade : { tipo: 'INFORMADA', valor: p.quantidade };
    definir(q, 'tipo', enumValido('TipoDeQuantidadeEnum', qq.tipo || (qq.cartao ? 'IMPORTADA_DO_CARTAO' : 'INFORMADA'), `${ctx}.quantidade.tipo`));
    if (qq.valor != null) definir(q, 'valorInformado', dec(qq.valor, 25));
    else if (campo(q, 'tipo') === 'INFORMADA') definir(q, 'valorInformado', dec(0, 25));
    if (qq.proporcionalizar != null) definir(q, 'aplicarProporcionalidade', bool(qq.proporcionalizar));
    if (qq.calendario) definir(q, 'tipoImportadaCalendarioEnum', enumValido('TipoDeQuantidadeImportadaDoCalendarioEnum', qq.calendario, `${ctx}.quantidade.calendario`));
    if (campo(q, 'tipo') === 'IMPORTADA_DO_CARTAO') {
      if (!qq.cartao) erro(`${ctx}.quantidade: informe "cartao" (nome do cartão de ponto).`);
      vincCartaoQtd.itens = [vinculoCartao(v, qq.cartao, 'QUANTIDADE', cartoes, doc, `${ctx}.quantidade`, pendentesCartao)].filter(Boolean);
    }
    if (campo(q, 'tipo') === 'IMPORTADA_DO_CALENDARIO' && !qq.calendario) erro(`${ctx}.quantidade: informe "calendario" (DIAS_UTEIS, REPOUSOS, FERIADOS ou REPOUSOS_FERIADOS).`);
  }
  if (q && campo(q, 'tipo') === 'INFORMADA' && Number(campo(q, 'valorInformado') || 0) === 0 && !p.quantidade) {
    avisos.push(`${ctx}: quantidade informada igual a zero (padrão do catálogo). A verba sairá zerada se você não informar "quantidade".`);
  }
  if (p.dobra != null) definir(f, 'dobra', bool(p.dobra));
  configurarValorPago(f, p, ctx, v, { historicos, doc });
  aplicarAvancado(v, p.avancado, `${ctx}.avancado`);
}

function objetoHistoricoVerba() {
  return objetoModelo('HistoricoSalarialDaVerba');
}

function configurarValorPago(f, p, ctx, v = null, { historicos = new Map(), doc = null } = {}) {
  const vp = campo(f, 'valorPago');
  if (!vp) return;
  // a tela grava quantidade 1 no valor pago ao salvar a verba
  if (campo(vp, 'quantidade') === null) definir(vp, 'quantidade', '1.0000');
  if (p.valorPago == null) return;
  const x = typeof p.valorPago === 'object' ? p.valorPago : { tipo: 'INFORMADO', valor: p.valorPago };
  const tipo = enumValido('TipoValorPagoEnum', x.tipo || (x.historicos || x.base ? 'CALCULADO' : 'INFORMADO'), `${ctx}.valorPago.tipo`);
  definir(vp, 'tipo', tipo);
  if (x.valor != null) definir(vp, 'valorInformado', dec(x.valor, 25));
  if (x.quantidade != null) definir(vp, 'quantidade', dec(x.quantidade, 4));
  if (x.proporcionalizar != null && tipo === 'INFORMADO') definir(vp, 'aplicarProporcionalidade', bool(x.proporcionalizar));
  if (tipo === 'CALCULADO') {
    // valor pago calculado (ex.: diferenças salariais = piso/salário devido - salário pago do histórico)
    const baseTab = enumValido('BaseDeCalculoDoPrincipalEnum', x.base || 'HISTORICO_SALARIAL', `${ctx}.valorPago.base`);
    definir(vp, 'baseTabelada', baseTab);
    if (baseTab === 'HISTORICO_SALARIAL') {
      if (!v) erro(`${ctx}.valorPago: valor pago calculado só se aplica a verbas calculadas.`);
      if (!x.historicos || !x.historicos.length) erro(`${ctx}.valorPago: informe "historicos" (ex.: ["SALÁRIO PAGO"]).`);
      campo(v, 'historicosDaVerbaDoValorPago').itens = vinculosHistorico(v, x.historicos, 'VALOR_PAGO', x.proporcionalizar ?? false, historicos, doc, `${ctx}.valorPago`);
    }
    if (baseTab === 'SALARIO_DA_CATEGORIA') {
      if (x.piso == null) erro(`${ctx}.valorPago: base SALARIO_DA_CATEGORIA exige "piso" (id da tabela Pisos Salariais).`);
      definir(v, 'salarioCategoriaValorPago', { $ext: 'SalarioCategoria', id: String(x.piso) });
    }
    if (baseTab === 'VALE_TRANSPORTE') {
      if (!x.valesTransporte || !x.valesTransporte.length) erro(`${ctx}.valorPago: base VALE_TRANSPORTE exige "valesTransporte": [ids].`);
      campo(v, 'valesTransportesDoValorPago').itens = x.valesTransporte.map((id) => ({ $classe: 'ValeTransporteDaVerba', campos: [['id', doc.id()], ['verbaDeCalculo', { $ref: v.$classe, id: campo(v, 'id') }], ['valeTransporte', { $ext: 'ValeTransporte', id: String(id) }], ['tipoVinculoHistorico', 'VALOR_PAGO']] }));
    }
  }
}

function configurarReflexo(r, spec, ctx, { historicos = new Map(), doc = null } = {}) {
  if (spec.comportamento) definir(r, 'comportamentoDoReflexo', enumValido('ComportamentoDoReflexoEnum', spec.comportamento, `${ctx}.comportamento`));
  if (spec.periodoMedia) definir(r, 'periodoMediaReflexo', enumValido('PeriodoDaMediaDoReflexoEnum', spec.periodoMedia, `${ctx}.periodoMedia`));
  if (spec.fracaoDeMes) definir(r, 'tratamentoDaFracaoDeMesDoReflexo', enumValido('TratamentoDaFracaoDeMesDoReflexoEnum', spec.fracaoDeMes, `${ctx}.fracaoDeMes`));
  // característica, ocorrência de pagamento, exclusões de faltas/férias, incidências etc. (mesmos campos da principal)
  parametrosComuns(r, spec, ctx);
  if (spec.periodo) {
    const ini = data(spec.periodo.inicio, `${ctx}.periodo.inicio`, true);
    const fim = data(spec.periodo.fim, `${ctx}.periodo.fim`, true);
    if (Number(fim) < Number(ini)) erro(`${ctx}.periodo: fim anterior ao início.`);
    definir(r, 'periodoInicial', ini);
    definir(r, 'periodoFinal', fim);
  }
  if (spec.proporcionalizar != null) definir(r, 'aplicarProporcionalidade', bool(spec.proporcionalizar));
  // valor pago no reflexo (ex.: 13º sobre horas extras já pago em parte): FormulaReflexo.valorPago
  if (spec.valorPago != null) {
    const f = campo(r, 'formula');
    if (!f || !campo(f, 'valorPago')) erro(`${ctx}.valorPago: este reflexo não tem valor pago no modelo do PJe-Calc.`);
    configurarValorPago(f, spec, ctx, r, { historicos, doc });
  }
  aplicarAvancado(r, spec.avancado, `${ctx}.avancado`);
}

export { ErroEspecificacao };
