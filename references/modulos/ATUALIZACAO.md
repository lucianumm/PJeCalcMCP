# Módulo: atualização (correção, juros, tabelas e data)

Carregue sempre antes de liquidar. Resultado: bloco `correcaoJuros`, `contrato.dataLiquidacao`, tabelas
verificadas.

## Conferências

1. **Marcos e índices por fase**, conforme o título:
   - fase pré-judicial (até o ajuizamento);
   - fase judicial;
   - mudanças legais (ADC 58/59; Lei 14.905/2024: IPCA + taxa legal a partir de 30/08/2024).

   Cada fase com índice, juros e data de início explícitos (`indice` + `combinacoesIndice`, `juros` +
   `jurosFasePreJudicial` + `combinacoesJuros`).
2. **Tabelas**: `tabelas_status` para a data de liquidação e o TRT do processo. Atualize com
   `tabelas_atualizar` (TRT do número CNJ). Falha de consulta = **não verificado**, nunca "ok": a
   liquidação fica bloqueada.
3. **Data de comparação**: todos os componentes (verbas, FGTS, tributos, honorários, custas) na mesma
   data de liquidação, igual a `contrato.dataLiquidacao`. Comparar valores de datas diferentes é falha.
4. **Justificativa**: confira o índice e a última taxa aplicados, os juros por fase e a data a partir
   da qual os juros correm. Use o retorno `justificativa` e não apenas o JSON. O MCP já confere os
   critérios da justificativa contra os parâmetros do cálculo (índices e combinações, acumulação, juros
   por fase, base dos juros, prescrição, aviso prévio, tabela do IR) e refaz a correção e os juros de
   cada verba, do FGTS e da contribuição social; diferença vira falha em `verificacoes`.
5. **Execução**: a atualização de um cálculo já homologado, com os pagamentos e eventos posteriores, é
   feita por `calculo_atualizar` (ou `calculo_externo_criar` para conta feita fora do PJe-Calc) — ver
   `EXECUCAO.md`. Não refaça o cálculo homologado para atualizá-lo.

## Critério de saída

Tabelas verificadas para a data e o TRT, justificativa lida e conferida contra o título, e todos os
valores na mesma data.
