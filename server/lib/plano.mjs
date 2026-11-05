// pjecalc-mcp-skill · lib/plano.mjs
// Plano de interpretação: o que o agente entendeu do processo, apresentado ao usuário ANTES do cálculo.
// O usuário aprova (ou corrige); a aprovação fica em contrato.aprovacao com o hash do contrato aprovado
// e cai sozinha se o contrato ou o cenário mudarem depois.
//
//   hashContrato(spec)                  -> hash do contrato (sem aprovação nem revisões de alerta) + cenário
//   verificarAprovacao(spec)            -> { valida, motivo, hashAtual }
//   planoInterpretacao(spec, auditoria) -> { markdown, hashContrato, ... }
//   revisaoPlanoResultado(spec, resultado) -> verificações "plano × resultado" depois de liquidar

import crypto from 'node:crypto';

const lista = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** JSON com chaves ordenadas (o hash não depende da ordem dos campos). */
function estavel(v) {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function hashContrato(spec) {
  const c = { ...((spec && spec.contrato) || {}) };
  delete c.aprovacao; delete c.revisoesDeAlerta;
  return crypto.createHash('sha256').update(estavel({ contrato: c, cenario: (spec && spec.cenario) || null })).digest('hex');
}
export function verificarAprovacao(spec) {
  const c = spec && spec.contrato;
  const hashAtual = c ? hashContrato(spec) : null;
  if (!c) return { valida: false, motivo: 'sem contrato de dados', hashAtual };
  const a = c.aprovacao;
  if (!a) return { valida: false, motivo: 'plano de interpretação ainda não aprovado pelo usuário (calculo_plano_interpretacao -> aprovação -> calculo_aprovar_plano)', hashAtual };
  if (!a.por || !a.em) return { valida: false, motivo: 'aprovação sem "por" (quem aprovou) ou "em" (quando)', hashAtual };
  if (a.hashContrato !== hashAtual) return { valida: false, motivo: 'o contrato ou o cenário mudaram depois da aprovação: gere o plano de novo e peça nova aprovação', hashAtual };
  return { valida: true, motivo: `aprovado por ${a.por} em ${a.em}`, hashAtual };
}

const tabela = (cab, linhas) => (linhas.length ? [`| ${cab.join(' | ')} |`, `|${cab.map(() => '---').join('|')}|`, ...linhas.map((l) => `| ${l.map((x) => String(x ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`)].join('\n') : '_nenhum_');

/** Plano legível para o usuário aprovar. "auditoria" é o resultado de auditarEspecificacao(spec). */
export function planoInterpretacao(spec, auditoria) {
  const s = spec || {};
  const c = s.contrato || {};
  const a = auditoria || {};
  const mapa = a.processo || null;
  const caps = a.titulo || [];
  const decs = new Map(lista(c.decisoes).map((d) => [d.id, d]));
  const prems = lista(c.premissas);
  const L = [];
  const numero = (s.processo && s.processo.numero) || (mapa && mapa.principal && mapa.principal.numero) || '?';
  L.push(`# Plano de interpretação — processo ${numero}`, '');
  L.push('Leia com atenção. Este é o entendimento do agente sobre o processo, **antes** do cálculo. Se algo estiver errado ou faltando, diga o que corrigir; se estiver certo, aprove.', '');

  L.push('## 1. Processo, fase e trabalho', '');
  if (mapa && mapa.principal) {
    L.push(`- Processo principal: **${mapa.principal.numero}** — fase **${mapa.principal.fase || '?'}**; trabalho: **${mapa.principal.trabalho}**.`);
    L.push('', mapa.relacionados.length ? tabela(['processo ligado', 'relação', 'efeito no cálculo', 'documentos'], mapa.relacionados.map((p) => [p.numero, p.relacao, p.efeito ? Object.entries(p.efeito).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ') : '—', p.documentos.join(', ')])) : '- Processos ligados: nenhum (conexão, ação anterior, coletiva, acordo, recuperação judicial... conferidos).');
    if (mapa.devedores.length) L.push('', tabela(['devedor', 'responsabilidade', 'período', 'ente público'], mapa.devedores.map((d) => [d.nome || d.id, d.responsabilidade, d.periodo ? `${d.periodo.inicio || '?'} a ${d.periodo.fim || '?'}` : 'todo', d.entePublico ? 'sim' : 'não'])));
  } else L.push('_Mapa do processo não registrado._');

  L.push('', '## 2. Título executivo (decisão que vale em cada capítulo)', '');
  L.push(tabela(['capítulo', 'cadeia de decisões', 'vale', 'situação', 'trânsito'], caps.map((k) => [
    k.rubrica ? `${k.capitulo} ${k.rubrica}` : k.capitulo,
    k.cadeia.map((e) => `${e.decisao} (${e.instancia || '?'} ${e.tipo || ''}${e.resultado ? `, ${e.resultado}` : ''}: ${e.efeito})`).join(' → '),
    k.vigente || '—', k.rubrica ? k.situacao || '—' : k.situacao ? 'fixado na decisão' : '—', k.pendente ? 'recurso pendente' : k.transito || 'não informado',
  ])));

  L.push('', '## 3. Parcelas e como serão calculadas', '');
  for (const p of lista(c.parcelas)) {
    const cap = caps.find((k) => k.capitulo === p.id);
    const d = decs.get((cap && (cap.fonte || cap.vigente)) || p.decisao) || {};
    const capD = lista(d.capitulos).find((x) => x.parcela === p.id) || {};
    L.push(`### ${p.id} — ${p.rubrica || '?'} (${p.situacao || '?'})`);
    L.push(`- Comando: ${d.id || p.decisao || '?'}${capD.folha || p.folha || d.folha ? `, ${capD.folha || p.folha || d.folha}` : ''}${capD.trecho || p.trecho ? ` — "${capD.trecho || p.trecho}"` : ''}`);
    if (p.periodo) L.push(`- Período deferido: ${p.periodo.inicio} a ${p.periodo.fim}`);
    if (lista(p.reflexos).length) L.push(`- Reflexos deferidos: ${lista(p.reflexos).join(', ')}`);
    if (p.naoCalcular) L.push(`- Não calculada como verba: ${p.naoCalcular}`);
    for (const v of lista(s.verbas).filter((x) => lista(x.origem ?? (x.personalizada && x.personalizada.origem)).includes(p.id))) {
      const partes = [];
      if (v.periodo) partes.push(`período ${v.periodo.inicio} a ${v.periodo.fim}`);
      if (v.base) partes.push(`base ${lista(v.base.historicos).join(' + ') || v.base.tipo || 'padrão'}`);
      if (v.divisor) partes.push(`divisor ${v.divisor.valor ?? v.divisor.tipo ?? ''}`);
      if (v.quantidade != null) partes.push(`quantidade ${typeof v.quantidade === 'object' ? (v.quantidade.valor ?? v.quantidade.tipo ?? '') : v.quantidade}`);
      if (v.reflexos) partes.push(`reflexos: ${v.reflexos === 'todos' ? 'todos' : lista(v.reflexos).map((r) => (typeof r === 'string' ? r : r.nome)).join(', ')}`);
      if (v.valorPago && v.valorPago.valor != null) partes.push(`abate ${brl(v.valorPago.valor)} (${lista(v.valorPago.origem).join(', ')})`);
      L.push(`- No PJe-Calc: **${v.nome || v.verba}**${partes.length ? ` — ${partes.join('; ')}` : ''}`);
    }
    for (const id of lista(p.premissas)) { const pr = prems.find((x) => x.id === id); if (pr) L.push(`- Premissa ${pr.id} (${pr.status}): ${pr.texto}`); }
    L.push('');
  }

  L.push('## 4. Critérios gerais', '');
  const cj = s.correcaoJuros;
  L.push(`- Correção e juros: ${cj ? `índice ${cj.indice || '?'}${lista(cj.combinacoesIndice).length ? ` + ${lista(cj.combinacoesIndice).map((x) => `${x.indice} a partir de ${x.aPartirDe}`).join(', ')}` : ''}; juros ${cj.juros || 'padrão'}${lista(cj.combinacoesJuros).length ? ` + ${lista(cj.combinacoesJuros).map((x) => `${x.juros} a partir de ${x.aPartirDe}`).join(', ')}` : ''}; origem ${lista(cj.origem).join(', ') || '—'}${lista(cj.precedentes).length ? `; precedentes ${lista(cj.precedentes).join(', ')}` : ''}` : 'não informados'}`);
  for (const h of lista(s.honorarios)) L.push(`- Honorários ${h.tipo || ''}: ${h.percentual != null ? `${h.percentual}%` : brl(h.valor)} sobre ${h.base || '?'} (devedor ${h.devedor || '?'}; origem ${lista(h.origem).join(', ') || '—'})`);
  L.push(`- Data de liquidação (data-base): ${c.dataLiquidacao || 'não informada'}`);
  if (s.fgts) L.push(`- FGTS: multa ${s.fgts.multa ? `${s.fgts.percentualMulta || 40}%` : 'não'}; destino ${s.fgts.destino || 'padrão'}`);

  L.push('', '## 5. Eventos, pagamentos e abatimentos', '');
  L.push(lista(c.afastamentos).length ? tabela(['evento', 'tipo', 'natureza', 'período', 'efeito', 'documento'], lista(c.afastamentos).map((x) => [x.id, x.tipo || x.motivo, x.natureza, `${x.inicio} a ${x.fim}`, x.efeito || 'EXCLUI_TRABALHO', x.documento])) : '- Faltas, férias e afastamentos: nenhum.');
  L.push('', lista(c.pagamentos).length ? tabela(['pagamento', 'cobre', 'alcance', 'valor', 'documento'], lista(c.pagamentos).map((x) => [x.id + (x.derivadoDe ? ` (de ${x.derivadoDe})` : ''), lista(x.parcelas).join(', '), x.competencia || (x.periodo ? `${x.periodo.inicio} a ${x.periodo.fim}` : '—'), brl(x.valor), x.documento || '—'])) : '- Pagamentos a abater: nenhum.');
  if (lista(c.pagamentosExecucao).length) L.push('', tabela(['pagamento na execução', 'tipo', 'data', 'valor', 'documento'], lista(c.pagamentosExecucao).map((x) => [x.id, x.tipo, x.data, brl(x.valor), x.documento])));
  if (lista(c.destinosDoCredito).length) L.push('', tabela(['destino do crédito', 'beneficiário', 'valor/percentual'], lista(c.destinosDoCredito).map((x) => [x.tipo, x.beneficiario || '—', x.percentual != null ? `${x.percentual}%` : brl(x.valor)])));

  const posicao = String(c.posicao || 'RECLAMANTE').toUpperCase();
  L.push('', '## 6. Premissas', '');
  for (const st of ['CONFIRMADA', 'CONTROVERTIDA', 'DESCONHECIDA']) {
    const ps = prems.filter((p) => semAcento(p.status) === st);
    if (ps.length) L.push(`**${st}**`, ...ps.flatMap((p) => [`- ${p.id}: ${p.texto}${p.fundamento ? ` — ${p.fundamento}` : ''}${p.criterio ? ` _(critério: ${String(p.criterio).replace(/_/g, ' ').toLowerCase()})_` : ''}`,
      ...lista(p.alternativas).map((x) => `  - ${x.favoravel && posicao !== 'NEUTRA' ? '**[mais favorável]** ' : ''}${x.texto}${x.efeito ? ` — ${x.efeito}` : ''}${semAcento(x.texto) === semAcento(p.texto) ? ' ← adotada' : ''}`)]), '');
  }
  if (s.cenario) L.push(`**Cenário:** ${s.cenario.nome}${s.cenario.descricao ? ` — ${s.cenario.descricao}` : ''}`, '');
  if (lista(a.incertezasAbertas).length) L.push('**Incertezas abertas:**', ...lista(a.incertezasAbertas).map((x) => `- ${x}`), '');

  L.push('## 7. Conflitos, alertas e pendências', '');
  const verifs = lista(a.verificacoes);
  const falhas = verifs.filter((v) => v.estado === 'falha');
  const alertas = verifs.filter((v) => v.estado === 'alerta');
  if (falhas.length) L.push(`**${falhas.length} falha(s) — precisam ser resolvidas antes da aprovação:**`, ...falhas.map((v) => `- ${v.item}: ${v.detalhe}`), '');
  if (alertas.length) L.push(`**${alertas.length} alerta(s) — cada um precisa de revisão:**`, ...alertas.map((v) => `- ${v.item}: ${v.detalhe}`), '');
  const doc = a.documentacao;
  if (doc && !doc.completa) L.push('**Documentação pendente:**', '', doc.pedido, '');
  if (doc && doc.perguntas && doc.perguntas.length) L.push('**Perguntas:**', ...doc.perguntas.map((q) => `- ${q}`), '');
  if (!falhas.length && !alertas.length) L.push('_Nenhuma falha ou alerta._', '');

  const hash = hashContrato(s);
  L.push('## 8. Aprovação', '');
  L.push(falhas.length ? 'Ainda **não** pode ser aprovado: resolva as falhas acima.' : `Para aprovar, responda "aprovo o plano". O agente registra a aprovação (calculo_aprovar_plano) com o código ${hash.slice(0, 12)}; qualquer mudança no contrato depois disso exige nova aprovação.`);
  return { markdown: L.join('\n'), hashContrato: hash, falhas: falhas.length, alertas: alertas.length, prontoParaAprovar: falhas.length === 0, aprovacaoAtual: verificarAprovacao(s) };
}

/** Depois de liquidar: cada parcela deferida aprovada aparece no resultado com as verbas que lhe correspondem. */
export function revisaoPlanoResultado(spec, resultado) {
  const s = spec || {};
  const c = s.contrato || {};
  const out = [];
  if (!c.aprovacao || !resultado || !resultado.verbas) return out;
  const linhas = new Map(resultado.verbas.map((v) => [semAcento(v.descricao), v]));
  const zeros = lista(c.zerosJustificados).map((z) => semAcento(z.verba));
  for (const p of lista(c.parcelas).filter((x) => semAcento(x.situacao) === 'DEFERIDA' && !x.naoCalcular)) {
    const verbas = lista(s.verbas).filter((v) => lista(v.origem ?? (v.personalizada && v.personalizada.origem)).includes(p.id));
    const achadas = verbas.map((v) => [v, linhas.get(semAcento(v.nome || (v.personalizada && v.personalizada.nome) || v.verba))]);
    const faltam = achadas.filter(([v, l]) => !l || (Math.abs(l.total || 0) < 0.005 && !zeros.includes(semAcento(v.nome || v.verba))));
    const total = achadas.reduce((acc, [, l]) => acc + (l ? l.total || 0 : 0), 0);
    out.push({ item: `plano × resultado / ${p.id} ${p.rubrica || ''}`, estado: faltam.length ? 'falha' : 'ok', dimensao: 'completude',
      detalhe: faltam.length ? `aprovada no plano, mas sem valor no resultado: ${faltam.map(([v]) => v.nome || v.verba).join(', ')}` : `${achadas.length} verba(s) no resultado, total ${brl(total)}` });
  }
  return out;
}
