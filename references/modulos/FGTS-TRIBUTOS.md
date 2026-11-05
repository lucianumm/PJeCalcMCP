# Módulo: FGTS e tributos

Carregue sempre que houver FGTS, contribuição social (INSS), imposto de renda, pensão ou previdência
privada. Resultado: blocos `fgts`, `contribuicaoSocial`, `irpf`, `pensaoAlimenticia` e
`previdenciaPrivada`.

## Conferências

1. **FGTS**:
   - incidência por verba;
   - alíquota (8% ou 2%);
   - multa (40%, 20% ou indevida);
   - base da multa (`incidenciaMulta`);
   - depósitos e saques já feitos (`operacoes`, com origem). Depósito se prova por extrato ou guia;
     holerite com FGTS informado não prova depósito (a auditoria alerta). Separe, por competência,
     base paga, diferença deferida, alíquota, depósito provado, multa e destino;
   - **destino**: depositar na conta vinculada ou pagar ao reclamante, conforme o título. FGTS
     depositado aparece separado do líquido.
2. **INSS**:
   - bases reais (históricos com incidência);
   - alíquotas do segurado e do empregador (fixa, por período, Simples ou atividade econômica);
   - cobrança da parte do reclamante;
   - salários pagos. Confira se o histórico ÚLTIMA REMUNERAÇÃO não criou base fictícia.
3. **IR**:
   - tributação exclusiva/em separado (13º, férias);
   - regime de caixa/RRA (art. 12-A);
   - dependentes;
   - deduções (INSS, pensão, previdência privada, honorários);
   - incidência sobre juros (em regra não).
4. **Pensão e previdência privada**: alíquota, verbas com incidência e período. O PJe-Calc exige a
   incidência em ao menos uma verba.

## Conferência dos números

Confira em `resultado.composicao`:
- FGTS e depósito de FGTS;
- contribuição social e dedução de contribuição;
- IRPF;
- honorários e custas.

A `justificativa` diz como o PJe-Calc tratou contribuição social e IR. Confira contra o título.
