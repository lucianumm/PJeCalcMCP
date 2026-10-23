# Módulo: título executivo (cadeia de decisões)

Carregue sempre. O título é composto a partir de **todas** as decisões do processo e dos processos
ligados que o afetam:
- vara;
- TRT (turma, pleno);
- TST (turma, SDI-1, SDI-2, Órgão Especial, Pleno);
- STF e STJ;
- liquidação e execução.

Resultado: `contrato.decisoes` com os capítulos, `contrato.parcelas`. Conferência: `titulo_compor`.

## 1. Registrar cada decisão

```json
{ "id": "DEC2", "processo": "PR0", "documento": "D30", "instancia": "TRT_TURMA", "tipo": "ACORDAO",
  "recorrida": "DEC1", "resultado": "PARCIALMENTE_PROVIDO", "publicacao": "2016-01-10", "folha": "fl. 200",
  "capitulos": [{ "parcela": "P6", "efeito": "REFORMA", "situacao": "ALTERADA", "detalhe": "limita a 2014-2015", "folha": "fl. 203", "trecho": "..." },
                { "criterio": "ATUALIZACAO", "efeito": "MANTEM" }],
  "transito": [{ "capitulos": ["P6"], "data": "2016-03-01" }],
  "recursos": [{ "tipo": "RECURSO_DE_REVISTA", "por": "reclamante", "objeto": ["P1"], "situacao": "PENDENTE" }],
  "precedentes": [{ "id": "SUM340", "uso": "CRITERIO" }],
  "conflitos": [{ "id": "CF1", "descricao": "dispositivo × fundamentação", "resolucao": "...", "decisao": "DEC3" }] }
```

- `instancia`: `VARA`, `TRT_TURMA`, `TRT_PLENO`, `TST_TURMA`, `TST_SDI1`, `TST_SDI2`,
  `TST_ORGAO_ESPECIAL`, `TST_PLENO`, `STF`, `STJ`.
- `tipo`: `SENTENCA`, `EMBARGOS_DECLARACAO`, `ACORDAO`, `DECISAO_MONOCRATICA`, `AGRAVO_INTERNO`,
  `ADMISSIBILIDADE`, `JUIZO_RETRATACAO`, `SENTENCA_LIQUIDACAO`, `HOMOLOGACAO`, `DECISAO_IMPUGNACAO`,
  `EMBARGOS_EXECUCAO`, `AGRAVO_PETICAO`, `RESCISORIA`, `MANDADO_SEGURANCA`,
  `RECLAMACAO_CONSTITUCIONAL`, `HOMOLOGACAO_ACORDO`, `DESPACHO`, `OUTRA`.
- Decisão que julga recurso ou embargos precisa de `recorrida` e `resultado`:
  - recursos: `NAO_CONHECIDO`, `DESPROVIDO`, `PROVIDO`, `PARCIALMENTE_PROVIDO`,
    `ANULADO_COM_RETORNO`, `PREJUDICADO`;
  - embargos: `ACOLHIDOS`, `REJEITADOS`, `ACOLHIDOS_EM_PARTE`.
- `capitulos[].efeito`: `DEFERE`, `INDEFERE`, `MANTEM`, `REFORMA` (com `situacao`: `DEFERIDA`,
  `INDEFERIDA` ou `ALTERADA`), `EXCLUI`, `ACRESCENTA`, `INTEGRA` (embargos), `ANULA`.
- Os capítulos são as parcelas (`parcela`: id) e os critérios (`criterio`): `ATUALIZACAO`,
  `HONORARIOS`, `CUSTAS`, `PRESCRICAO`, `LIMITACAO` etc.
- `transito`: uma data (todos os capítulos) ou uma lista por capítulo.
- `recursos`: o que foi interposto contra a decisão. Se `JULGADO`, indique `julgadoPor`; se
  `PENDENTE`, indique o `objeto`.

## 2. Regras de composição

1. **Efeito substitutivo** (art. 1.008 do CPC): o julgamento do recurso substitui a decisão recorrida
   no que foi objeto do recurso. Para cada capítulo, vale a última decisão de mérito.
2. Recurso **não conhecido** ou **prejudicado** não substitui nada: a decisão anterior continua
   valendo. Só pode ter efeito `MANTEM`.
3. **Embargos de declaração** integram a decisão e podem modificá-la (`INTEGRA`).
4. Capítulo não recorrido **transita** com a decisão que o julgou. Capítulo com recurso pendente só
   entra antes do trânsito (cálculo provisório) ou na execução provisória.
5. **Anulação com retorno** (`ANULA`): só vale a nova decisão de origem. Sem ela, o capítulo fica
   travado.
6. **Juízo de retratação:** a decisão revista substitui a anterior.
7. **Dispositivo × fundamentação:** o dispositivo é o comando; a fundamentação define o alcance
   quando o dispositivo remete a ela. Contradição vira `conflitos`, com resolução por embargos ou
   decisão posterior, ou é tratada como cenário. Nunca é escolha do agente.
8. **Não são comando:** ementa, voto vencido e precedente citado só como reforço. Precedente adotado
   **como critério** passa a fazer parte do parâmetro (`PRECEDENTES.md`).
9. **"Mantenho a sentença pelos próprios fundamentos"** (certidão do sumaríssimo): o título é a
   sentença (`MANTEM`).
10. **"A apurar em liquidação":** o critério vem da sentença de liquidação e das decisões sobre ela
    (impugnação, agravo de petição). Depois da preclusão, não se rediscute.
11. **Erro material** só se corrige com a decisão que o reconheça.
12. **Proibição de piorar a situação do único recorrente** (reformatio in pejus): se a reforma piora a
    situação dele, releia.
13. **Rescisória e reclamação constitucional** podem desfazer ou cassar capítulos: a decisão entra na
    cadeia e o processo, no mapa.
14. **Reflexos:** só os expressamente deferidos, por parcela (`parcela.reflexos`). Nada por analogia.

## 3. A matriz de capítulos (`titulo_compor`)

Para cada capítulo, a ferramenta mostra:
- a cadeia (decisão, instância, tipo, resultado, efeito);
- a decisão que vale e a fonte do conteúdo (quando a que vale só manteve);
- a situação, o trânsito e se há recurso pendente.

Ela entra no plano de interpretação.

A auditoria acusa:
- capítulo sem decisão;
- decisão sem instância, tipo, data de publicação, recorrida ou resultado;
- reforma por recurso não conhecido;
- capítulo anulado sem nova decisão;
- recurso julgado sem a decisão de julgamento;
- recurso pendente ou trânsito não informado na liquidação ou execução;
- conflito sem resolução;
- parcela que cita uma decisão superada, ou com situação diferente da cadeia;
- correção e juros com origem diferente da decisão que vale;
- os pontos de precedentes listados em `PRECEDENTES.md`.

## 4. Parâmetros fixados no título

Correção e juros (marcos e índices), honorários (percentual, base, credor, suspensão), custas, multas,
contribuições, limitação aos valores da inicial e compensações autorizadas. Cada um vira capítulo
`criterio` e vai para o bloco correspondente, com `origem` na decisão que vale.

## Critério de saída

Toda parcela, reflexo, critério e dedução com decisão que vale identificada (documento, folha e
trecho), trânsito conhecido ou tratamento provisório declarado, sem conflito aberto fora de cenário.
