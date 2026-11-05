// pjecalc-mcp-skill · lib/leitura.mjs
// Leitura integral registrada no contrato (Parte A): cada documento listado em contrato.documentos precisa ter
// todas as folhas classificadas (usadas, irrelevantes com motivo, ilegíveis com pedido de nova cópia), e as
// conferências da leitura ficam registradas: fechamentos (holerite, cartão, TRCT, extrato), confrontos entre
// documentos e pedidos × decisão.
//
// contrato.leitura: [{
//   documento: "D2",
//   classificacao: { usadas: "40-60,62", irrelevantes: [{ folhas: "61", motivo: "verso em branco" }], ilegiveis: [{ folhas: "63", motivo: "digitalização cortada" }] },
//   lidaComoImagem: "40-65",            // folhas sem texto vistas como imagem (escaneadas)
//   fechamentos: [{ tipo: "HOLERITE", referencia: "2014-03", ok: true, detalhe: "proventos − descontos = líquido" }],
//   observacao
// }]
// contrato.confrontos: [{ tipo: "DATAS"|"SALARIO"|"JORNADA"|"PAGAMENTOS"|"VALORES", documentos: ["D2","D11"], ok, detalhe, resolucao }]
// contrato.pedidos: [{ pedido, documento, folha, situacao: "DEFERIDO"|"INDEFERIDO"|"PARCIAL"|"SEM_DECISAO", decisao, observacao }]

const lista = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** "10-18, 20, 22-23" -> [10..18, 20, 22, 23]. Aceita números e listas. */
export function folhas(v) {
  if (v == null || v === '') return [];
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(folhas);
  const out = [];
  for (const parte of String(v).split(/[,;]\s*/)) {
    const m = /^\s*(?:fls?\.?\s*)?(\d+)\s*(?:[-–a]\s*(\d+))?\s*$/i.exec(parte);
    if (!m) continue;
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 100000; i++) out.push(i);
  }
  return out;
}

const faixa = (ns) => {
  const s = [...new Set(ns)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`); i = j; }
  return out.join(', ');
};

/** Verificações da leitura (dimensão "leitura"). */
export function avaliarLeitura(contrato) {
  const verif = [];
  const reg = (item, estado, detalhe) => verif.push({ item, estado, detalhe, dimensao: 'leitura' });
  const documentos = lista(contrato && contrato.documentos);
  if (!documentos.length) return verif;
  const leituras = lista(contrato.leitura);
  const coleta = lista(contrato.coleta);
  if (!leituras.length) {
    reg('leitura integral dos documentos (contrato.leitura)', 'falha', `nenhuma leitura registrada para os ${documentos.length} documento(s): classifique todas as folhas de cada um (usadas, irrelevantes, ilegíveis). documento_inventario prepara o registro.`);
    return verif;
  }
  let completos = 0;
  for (const d of documentos) {
    const l = leituras.find((x) => x.documento === d.id);
    const todas = folhas(d.paginas);
    if (!l) { reg(`leitura de ${d.id} (${d.tipo || 'documento'})`, 'falha', `sem registro de leitura${todas.length ? ` das folhas ${faixa(todas)}` : ''}`); continue; }
    const cl = l.classificacao || {};
    const usadas = folhas(cl.usadas);
    const irrel = lista(cl.irrelevantes);
    const ileg = lista(cl.ilegiveis);
    const semMotivo = irrel.filter((x) => !x.motivo);
    const fIrr = irrel.flatMap((x) => folhas(x.folhas));
    const fIleg = ileg.flatMap((x) => folhas(x.folhas));
    const classificadas = [...usadas, ...fIrr, ...fIleg];
    const repetidas = classificadas.filter((x, i) => classificadas.indexOf(x) !== i);
    const faltam = todas.length ? todas.filter((x) => !classificadas.includes(x)) : [];
    const fora = todas.length ? classificadas.filter((x) => !todas.includes(x)) : [];
    const problemas = [];
    if (!todas.length && !classificadas.length) problemas.push('o documento não informa as folhas (contrato.documentos[].paginas) e nada foi classificado');
    if (faltam.length) problemas.push(`folhas sem classificação: ${faixa(faltam)}`);
    if (repetidas.length) problemas.push(`folhas classificadas duas vezes: ${faixa(repetidas)}`);
    if (fora.length) problemas.push(`folhas classificadas fora do documento: ${faixa(fora)}`);
    if (semMotivo.length) problemas.push(`${semMotivo.length} grupo(s) de folhas irrelevantes sem motivo`);
    const ilegSemPedido = fIleg.length && !coleta.some((c) => (c.documento === d.id || (c.recebidoComo || []).includes?.(d.id)) && c.status !== 'RECEBIDO');
    if (ilegSemPedido) problemas.push(`folhas ilegíveis ${faixa(fIleg)} sem pedido de nova cópia em contrato.coleta (status pendente)`);
    if (problemas.length) reg(`leitura de ${d.id} (${d.tipo || 'documento'})`, 'falha', problemas.join('; '));
    else { completos++; reg(`leitura de ${d.id} (${d.tipo || 'documento'})`, 'ok', `${classificadas.length} folha(s) classificadas: ${usadas.length} usada(s), ${fIrr.length} irrelevante(s), ${fIleg.length} ilegível(is)${l.lidaComoImagem ? `; vistas como imagem: ${faixa(folhas(l.lidaComoImagem))}` : ''}`); }
    for (const f of lista(l.fechamentos)) {
      if (f.ok === false) reg(`fechamento ${f.tipo || ''} ${f.referencia || ''} (${d.id})`.replace(/\s+/g, ' '), f.resolucao ? 'alerta' : 'falha', `${f.detalhe || 'não fecha'}${f.resolucao ? ` — resolução: ${f.resolucao}` : ' — registre a causa e a resolução (ou peça o documento correto)'}`);
    }
    const nOk = lista(l.fechamentos).filter((f) => f.ok === true).length;
    if (nOk) reg(`fechamentos conferidos em ${d.id}`, 'ok', `${nOk} fechamento(s) conferido(s)`);
  }
  for (const c of lista(contrato.confrontos)) {
    const nome = `confronto ${c.tipo || ''} entre ${lista(c.documentos).join(' × ')}`.replace(/\s+/g, ' ');
    if (c.ok === false) reg(nome, c.resolucao ? 'alerta' : 'falha', `${c.detalhe || 'divergência'}${c.resolucao ? ` — resolução: ${c.resolucao}` : ' — registre qual documento prevalece e por quê'}`);
    else if (c.ok === true) reg(nome, 'ok', c.detalhe || 'documentos coerentes');
  }
  const semDecisao = lista(contrato.pedidos).filter((p) => p.situacao === 'SEM_DECISAO');
  if (semDecisao.length) reg('pedidos da inicial sem decisão', 'alerta', `${semDecisao.length} pedido(s) sem decisão: ${semDecisao.slice(0, 6).map((p) => p.pedido).join('; ')} — a omissão é avisada ao usuário, nunca preenchida`);
  if (lista(contrato.pedidos).length && !semDecisao.length) reg('pedidos × decisão', 'ok', `${lista(contrato.pedidos).length} pedido(s) classificados`);
  if (completos === documentos.length) reg('leitura integral: todas as folhas de todos os documentos', 'ok', `${documentos.length} documento(s)`);
  return verif;
}
