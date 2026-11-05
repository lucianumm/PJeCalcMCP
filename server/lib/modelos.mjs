// pjecalc-mcp-skill · lib/modelos.mjs
// Modelos usados pelo gerador de .PJC, todos extraídos do PRÓPRIO PJe-Calc:
//
//   modelos/calculo-base.json      árvore de um cálculo novo criado pela interface (valores padrão
//                                  de FGTS, INSS, IRPF, custas, correção/juros, pontos facultativos...)
//   modelos/verbas-expresso.json   todas as verbas do lançamento "Expresso" (catálogo do PJe-Calc),
//                                  cada uma com seus reflexos, exatamente como o aplicativo as cria
//   modelos/catalogos.json         municípios/UF, assuntos CNJ e feriados do banco do PJe-Calc
//
// construirModelos() refaz os dois primeiros a partir de exportações (.PJC) feitas pelo aplicativo
// (ver scripts/atualizar-modelos.mjs e a ferramenta modelos_atualizar).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerPjc, campo, definir, itens, objetos, clonar } from './pjc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DIR_MODELOS = path.resolve(__dirname, '..', 'modelos');

const CLASSES_VERBA = ['Calculada', 'Informada', 'Reflexo'];

const cache = {};
export function carregarModelo(nome) {
  if (!cache[nome]) {
    const p = path.join(DIR_MODELOS, `${nome}.json`);
    if (!fs.existsSync(p)) throw new Error(`Modelo ausente: ${p}. Rode a ferramenta modelos_atualizar com o PJe-Calc aberto.`);
    cache[nome] = JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return cache[nome];
}

export function limparCacheModelos() {
  for (const k of Object.keys(cache)) delete cache[k];
}

/** Indexa os objetos inline de uma árvore por "Classe#id". */
function indexar(arvore) {
  const idx = new Map();
  for (const o of objetos(arvore)) {
    const id = campo(o, 'id');
    if (id !== undefined && id !== null) idx.set(`${o.$classe}#${id}`, o);
  }
  return idx;
}

/** Substitui, dentro de `no`, objetos inline das classes indicadas por referências {$ref}. */
function trocarInlinePorRef(no, classes, dentroDaRaiz = true) {
  if (!no || typeof no !== 'object') return no;
  if (no.$classe) {
    if (!dentroDaRaiz && classes.includes(no.$classe)) return { $ref: no.$classe, id: campo(no, 'id') };
    for (const par of no.campos) par[1] = trocarInlinePorRef(par[1], classes, false);
    return no;
  }
  if (no.$colecao) {
    no.itens = no.itens.map((it) => trocarInlinePorRef(it, classes, false));
    return no;
  }
  return no;
}

/** id das verbas-base de um reflexo (via formula.baseVerba.itens[].verbaDeCalculo). */
export function basesDoReflexo(reflexo) {
  const f = campo(reflexo, 'formula');
  return itens(campo(campo(f, 'baseVerba'), 'itens')).map((it) => {
    const v = campo(it, 'verbaDeCalculo');
    if (!v) return null;
    return v.$ref ? `${v.$ref}#${v.id}` : `${v.$classe}#${campo(v, 'id')}`;
  }).filter(Boolean);
}

/**
 * Monta a biblioteca de verbas a partir do .PJC de um cálculo com todas as verbas do Expresso.
 * Cada entrada: { nome, classe, resumo, objetos: [principal, ...reflexos] } — os objetos são
 * auto-contidos (verbas, cálculo e históricos referenciados por {$ref}).
 */
export function construirBibliotecaVerbas(bytesPjc) {
  const { arvore } = lerPjc(bytesPjc);
  const idx = indexar(arvore);
  const verbas = [...idx.values()].filter((o) => CLASSES_VERBA.includes(o.$classe));
  const principais = verbas.filter((v) => v.$classe !== 'Reflexo');
  const reflexos = verbas.filter((v) => v.$classe === 'Reflexo');
  const saida = [];
  for (const p of principais) {
    const chave = `${p.$classe}#${campo(p, 'id')}`;
    const meus = reflexos.filter((r) => basesDoReflexo(r).includes(chave));
    const grupo = [p, ...meus].map((o) => {
      const c = trocarInlinePorRef(clonar(o), [...CLASSES_VERBA, 'HistoricoSalarial', 'Calculo']);
      // ocorrências são regeradas pelo PJe-Calc depois da importação (botão Regerar)
      const oc = campo(c, 'ocorrencias');
      if (oc && oc.$colecao) oc.itens = [];
      return c;
    });
    saida.push({
      nome: campo(p, 'nome'),
      classe: p.$classe,
      resumo: resumoVerba(grupo[0]),
      reflexos: meus.map((r) => ({ nome: campo(r, 'nome'), resumo: resumoVerba(r), bases: basesDoReflexo(r).length })),
      objetos: grupo,
    });
  }
  saida.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return saida;
}

/** Resumo legível dos parâmetros de uma verba (para o catálogo exposto aos agentes). */
export function resumoVerba(v) {
  const f = campo(v, 'formula');
  const bt = campo(f, 'baseTabelada');
  const div = campo(f, 'divisor');
  const mult = campo(f, 'multiplicador');
  const qtd = campo(f, 'quantidade');
  const assunto = campo(v, 'assuntoCnj');
  return {
    tipo: v.$classe,
    descricao: campo(v, 'descricao'),
    assuntoCnj: assunto && (assunto.$ext ? assunto.id : null),
    caracteristica: campo(v, 'caracteristica'),
    ocorrenciaDePagamento: campo(v, 'ocorrenciaDePagamento'),
    incidencias: {
      inss: campo(v, 'incidenciaINSS'), irpf: campo(v, 'incidenciaIRPF'), fgts: campo(v, 'incidenciaFGTS'),
      previdenciaPrivada: campo(v, 'incidenciaPrevidenciaPrivada'), pensaoAlimenticia: campo(v, 'incidenciaPensaoAlimenticia'),
    },
    base: bt ? campo(bt, 'tipo') : (f && f.$classe === 'FormulaReflexo' ? 'VERBA' : null),
    divisor: div ? { tipo: campo(div, 'tipo'), valor: campo(div, 'outroValor') } : null,
    multiplicador: mult ? campo(mult, 'outroValor') : null,
    quantidade: qtd ? { tipo: campo(qtd, 'tipo'), valor: campo(qtd, 'valorInformado') } : null,
    comportamentoDoReflexo: campo(v, 'comportamentoDoReflexo') ?? undefined,
    periodoMediaReflexo: campo(v, 'periodoMediaReflexo') ?? undefined,
    ativoPorPadrao: campo(v, 'ativo'),
  };
}

/**
 * Modelo de cálculo-base a partir do .PJC de um cálculo novo (sem verbas): mantém todos os
 * objetos 1:1 com os valores padrão da interface e esvazia as coleções do caso concreto.
 */
export function construirCalculoBase(bytesPjc) {
  const { arvore } = lerPjc(bytesPjc);
  const base = clonar(arvore);
  for (const c of ['verbas', 'historicosSalariais', 'listaDeFerias', 'faltas', 'multas', 'honorarios', 'apuracoesDeJuros', 'excecoesDaCargaHoraria', 'excecoesDoSabado', 'historicosValidacao', 'historicosValidacaoAtualizacao', 'cartoesDePonto', 'pagamentos', 'apuracoesCartaoDePonto', 'apuracoesDiariasCartaoDePonto', 'excecoesDoFechamentoDeCartaoDePonto']) {
    const col = campo(base, c);
    if (col && col.$colecao) col.itens = [];
  }
  const proc = campo(base, 'processo');
  for (const c of ['advogadosReclamante', 'advogadosReclamado']) {
    const col = campo(proc, c);
    if (col && col.$colecao) col.itens = [];
  }
  return base;
}

export function salvarModelo(nome, dados) {
  fs.mkdirSync(DIR_MODELOS, { recursive: true });
  fs.writeFileSync(path.join(DIR_MODELOS, `${nome}.json`), JSON.stringify(dados, null, nome === 'verbas-expresso' ? 0 : 1));
  delete cache[nome];
}

export { definir, campo, itens };
