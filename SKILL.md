---
name: pjecalc-mcp
description: >-
  Monta cálculos trabalhistas completos no PJe-Calc Cidadão 2.16.0 a partir de todo o processo
  (fases, processos ligados, todas as decisões da vara ao STF) e dos documentos, com leitura integral,
  rastreio de cada parâmetro até a prova, plano de interpretação aprovado pelo usuário e conferência do
  resultado. Use quando o usuário pedir para fazer, conferir, liquidar, atualizar, comparar, exportar
  ou importar um cálculo no PJe-Calc (verbas e reflexos, valores mês a mês, horas extras por cartão de
  ponto ou jornada, FGTS, INSS, IR, pensão, honorários, custas, correção e juros; pagamentos da
  execução, cálculo externo, precatório e RPV), ou para operar o aplicativo. Ferramentas do servidor
  MCP "pjecalc": processo_*, titulo_*, documento_*, holerites_*, cartoes_*, extrato_*, trct_*,
  calculo_*, catalogo_*, tabelas_*, pjecalc_*, rest_*, db_*, config_*.
license: AGPL-3.0
metadata:
  version: 2.16.0-mcp.17
---

# PJe-Calc MCP (skill)

O MCP garante que o PJe-Calc **aceita e calcula** o que foi especificado. Ele não garante que a
especificação corresponda ao processo. Por isso o trabalho tem etapas separadas:
1. entender o processo inteiro;
2. ler todos os documentos;
3. compor o título a partir de todas as decisões;
4. mostrar ao usuário um plano para aprovação;
5. só então calcular;
6. no fim, voltar aos documentos.

Nenhuma skill garante a interpretação perfeita de um processo. O objetivo verificável é outro:
nenhuma decisão ou página sem leitura, nenhuma omissão ou conflito material sem registro, nenhuma
suposição escondida, e números que possam ser reproduzidos e contestados.

## Etapa 0 — Mapa do processo

Antes de tudo, identifique (`references/modulos/PROCESSO.md`, ferramenta `processo_mapa`):
- o **processo principal**, a **fase** (pré-processual, conhecimento, recursal, liquidação, execução
  provisória, execução, encerrado) e o **trabalho** que a fase exige: cálculo novo, atualização do
  cálculo homologado, execução individual de sentença coletiva, habilitação em recuperação judicial ou
  falência, ente público;
- **todos os processos ligados**: conexos, litispendência, coisa julgada, ação anterior arquivada,
  protesto, ação coletiva, acordo, consignação, prova emprestada, recuperação judicial, falência,
  rescisória, mandado de segurança... Cada um com o **efeito no cálculo** (exclui, abate, prescrição,
  título, data-limite, suspende);
- **devedores** (principal, solidário, subsidiário com período, ente público), **pagamentos da
  execução** e **destinos do crédito** (honorários contratuais, penhora no rosto dos autos, cessão,
  pensão, herdeiros).

Procure números de processo em todas as peças e pergunte ao usuário se há outros. Na execução, o ponto
de partida é o cálculo homologado.

## Etapa 1 — Reunir os documentos

`references/modulos/DOCUMENTOS.md`, ferramenta `calculo_documentos_necessarios`. Em rodadas:
1. título e decisões de todas as instâncias;
2. documentos de cada parcela e de cada processo ligado, conforme a relação e a fase;
3. complementos (meses faltantes, páginas ilegíveis, contradições) e as perguntas ao usuário.

Registre cada documento com o `processo` de origem, o `periodo` e as `lacunas`, e cada pedido em
`contrato.coleta`. Repita até `completa: true`. O que não existir vira pendência declarada, e o cálculo,
simulação.

## Etapa 2 — Leitura integral

`references/modulos/LEITURA.md`:
- inventário de arquivos e páginas (`documento_inventario`: páginas com e sem texto, tipo provável,
  números de processo citados), ou `auditor_importar` sobre a leitura feita pelo AuditorProcessual
  (documentos e folhas pelo rodapé do PJe, livro-razão da jornada e da folha, eventos);
- leitura **de todas as páginas**; imagens e escaneados vistos como imagem (`documento_imagens` grava
  as páginas escaneadas em arquivos; `documento_texto` só ajuda a localizar trechos e conferir números);
- extração por tipo de documento, com citação literal e folha;
- dupla leitura dos números críticos;
- fechamentos: holerites (`holerites_para_historicos`), cartões (`cartoes_para_jornadas`), extrato
  do FGTS (`extrato_para_fgts`) e TRCT (`trct_para_pagamentos`) — os conversores conferem as somas e
  os meses faltantes, não leem por você;
- confronto entre documentos;
- pedidos × decisão.

Registre tudo em `contrato.leitura` (cada folha usada, irrelevante com motivo ou ilegível),
`contrato.confrontos` e `contrato.pedidos`: a auditoria trava sem isso. Página ilegível vira coleta
`ILEGIVEL`. Nada é resumido sem leitura completa.

## Etapa 3 — Composição do título

`references/modulos/TITULO-EXECUTIVO.md`, `references/PRECEDENTES.md`, ferramenta `titulo_compor`:
- registre **todas** as decisões (vara, TRT, TST, STF, liquidação, execução) com instância, tipo,
  recorrida, resultado, capítulos atingidos e efeito, trânsito por capítulo, recursos pendentes,
  conflitos e precedentes;
- aplique as regras de composição: efeito substitutivo; recurso não conhecido não substitui; embargos
  integram; anulação com retorno; dispositivo × fundamentação;
- confira os precedentes vinculantes e a modulação (ADC 58, Lei 14.905/2024, ente público...).

Na dúvida sobre vigência, consulte a fonte e pergunte.

## Etapa 4 — Contrato de dados

`references/CONTRATO-DE-DADOS.md`. Registre:
- documentos, decisões, parcelas (com os reflexos deferidos);
- eventos (faltas, férias, afastamentos), com natureza da prova e efeito;
- remunerações por componente;
- pagamentos com identidade e saldo;
- premissas **CONFIRMADAS, CONTROVERTIDAS ou DESCONHECIDAS**, com fundamento.

Separe **conteúdo documental**, **fato reconhecido no processo** e **efeito no cálculo**.
Desconhecido não vira zero nem padrão: pergunte ou declare um `cenario` com as premissas variadas e as
fixas.

Módulos por assunto (`references/modulos/`):

| módulo | quando |
|---|---|
| `PROCESSO.md`, `DOCUMENTOS.md`, `LEITURA.md`, `TITULO-EXECUTIVO.md`, `PLANO.md` | sempre |
| `REMUNERACAO-REFLEXOS.md` | históricos, bases, reflexos |
| `JORNADA.md` | horas extras, noturnas, intervalos, domingos, feriados, afastamentos e férias |
| `PAGAMENTOS.md` | qualquer valor pago a deduzir |
| `FGTS-TRIBUTOS.md` | FGTS, INSS, IR, pensão, previdência privada |
| `ATUALIZACAO.md` | sempre antes de liquidar |
| `EXECUCAO.md` | execução: pagamentos, honorários, multas, pensão e custas da execução, precatório/RPV, cálculo externo |
| `REFERENCIA.md` | conta de referência (perito, parte, outro cenário) |

## Etapa 5 — Plano de interpretação e aprovação

`references/modulos/PLANO.md`:
1. Gere o plano com `calculo_plano_interpretacao` e **mostre-o inteiro ao usuário**.
2. Resolva as falhas antes.
3. Quando o usuário aprovar, registre com `calculo_aprovar_plano`.

Qualquer mudança no contrato depois disso exige nova aprovação. Sem aprovação válida, `calculo_criar`
não gera nada.

## Etapa 6 — Parametrização

1. `calculo_modelo_json` (`exemplo=auditavel` mostra um caso completo) e os catálogos.
2. Especificação com `origem` em cada verba, histórico, falta, férias e abatimento; correção e juros
   com `origem` (e `precedentes`, se o título for omisso). Campos desconhecidos são recusados.
   - O que o PJe-Calc não gera sozinho (pago de cada contracheque, quantidade de um mês, devido
     informado, ocorrência desativada) vai em `verbas[].ocorrencias` (e nos reflexos).
   - Base, depósito e alíquota do FGTS por competência: `fgts.ocorrencias`. Salários e contribuições
     já recolhidas do INSS: `contribuicaoSocial.ocorrencias`. Custas fixas, autos e armazenamento:
     `custas.fixas`, `custas.autos`, `custas.armazenamentos`.
   - Honorários sobre verbas escolhidas: `honorarios[].verbas`. Piso e vale-transporte: ids de
     `catalogo_pisos_vt`.
3. `calculo_validar` até `valido: true` e `prontoParaCalcular: true`. As regras de validação do
   próprio PJe-Calc são aplicadas antes de importar (`pendenciasPrevistas`). `bloqueiosParaCalcular`
   diz o que falta. Leia:
   - os `avisos`;
   - as `premissasPadrao`;
   - a `auditoria`. Cada `alerta` recebe revisão em `contrato.revisoesDeAlerta` (conclusão,
     fundamento, responsável, impacto).

## Etapa 7 — Cálculo no PJe-Calc

`calculo_criar` com `liquidar_em` = `contrato.dataLiquidacao`. Tabelas pelo TRT do processo
(`atualizar_tabelas: true`). Falha de consulta trava a liquidação.

Depois de liquidar, o MCP refaz a conta por conta própria (verbas, juros, FGTS e multa, contribuição
social, IR, honorários e custas, com o arredondamento do PJe-Calc) e a compara com os relatórios do
aplicativo; confere também os critérios da justificativa e as regras de validação sobre o cálculo
exportado.

Execução (`references/modulos/EXECUCAO.md`):
- cálculo homologado feito no PJe-Calc: `calculo_atualizar` com o `.PJC` liquidado e o bloco
  `execucao` (pagamentos, honorários, multas, pensão alimentícia e custas da execução, precatório/RPV);
- conta homologada feita fora: `calculo_externo_criar`;
- vários reclamantes ou devedores: `calculo_criar_lote`, um cálculo por item.

## Etapa 8 — Conferência e entrega

1. Leia `estado`, `dimensoes`, `bloqueiosDeEntrega`, `provisorio` e `verificacoes`:

   | estado | significa |
   |---|---|
   | `rascunho` | só a especificação |
   | `aceito_pelo_aplicativo` | importado sem pendências — aceitação técnica, **não** revisão |
   | `calculado` | liquidado com tabelas, justificativa, soma, aritmética, completude e comparação verificadas |
   | `simulacao` | calculado, auditado e com plano aprovado, mas com cenário ou incerteza aberta — conta condicionada |
   | `auditado` | mapa, título e contrato sem falhas, sem incertezas abertas, alertas revisados e plano aprovado |

   `provisorio: true` quando há capítulo sem trânsito. `revisadoParaEntrega` é sempre `false`.
2. Volte aos documentos:
   - quantidades e nominais primeiro, depois reflexos, atualização e descontos;
   - a `justificativa` contra o título;
   - **plano × resultado** (toda parcela aprovada com valor ou zero justificado);
   - verba ativa só pelo nome não está calculada.
3. Conta de referência: `calculo_comparar_referencia` na mesma data-base (`REFERENCIA.md`), com outro
   cálculo, o relatório em PDF, HTML ou texto, ou a conta transcrita (`referencia_manual`).
4. Cenários: o efeito de cada incerteza material, e as combinações quando houver interação.
5. Entregue:
   - número do cálculo, `-PRONTO.PJC`, `-LIQUIDADO.PJC`, o relatório completo `-RELATORIO.pdf` e
     `.registro.json`;
   - o plano aprovado, as premissas e as revisões de alerta;
   - separadamente, cada dimensão: **processo**, **título**, **documentação**, **leitura**, **aprovação**,
     **transferência**, **aritmética**, **completude** e **revisão interpretativa** (humana).
   - Informe os destinos do crédito que reduzem o líquido.

## Regras

- **Nunca** escreva no banco H2 (`db_executar`): quebra as sequências e o PJe-Calc passa a recusar
  cálculos.
- Cartão de ponto: **ou** `cartoesDePonto` (quantidades mensais) **ou** `apuracaoCartaoPonto`
  (jornadas).
- Tabelas só por `tabelas_atualizar`. `rest_tabelas_*` são o lado servidor e não atualizam nada.
- Ajuste manual na tela só se for reproduzível: exporte, reimporte e confira. Prefira sempre a
  especificação (inclusive `verbas[].ocorrencias`, as ocorrências de FGTS e de contribuição social,
  as custas fixas e o bloco `execucao`), que fica registrada e é conferida. Depois de editar as
  ocorrências de FGTS ou de contribuição social pela especificação, não as regere na tela.
- O MCP localiza o PJe-Calc sozinho (`pjecalc_localizar` se houver dúvida) e confere o número do
  cálculo ao abri-lo.
- Cada falha nova encontrada num cálculo real vira correção e teste (`scripts/test-mcp.mjs`).

## Referências

- `references/modulos/` — processo, documentos, leitura, título executivo, plano e conferências por
  assunto.
- `references/AUDITORIA-PERICIAL.md` — roteiro longo de perito calculista (prompt `auditoria-pericial-integral`):
  mapa processual, coisa julgada pedido a pedido, financeiro mês a mês, cartões em minutos, parametrização.
- `references/PRECEDENTES.md` — precedentes com vigência, modulação e parametrização.
- `references/CONTRATO-DE-DADOS.md` — todos os campos do contrato e o que a auditoria detecta.
- `references/CONTROLES-INTERPRETACAO.md` — visão geral dos controles.
- `references/ESPECIFICACAO-CALCULO.md` — todos os campos do JSON.
