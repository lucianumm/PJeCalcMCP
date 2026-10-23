# Módulo: conta de referência

Carregue quando houver uma conta para comparar: a do perito, a de uma parte, a homologada ou outro
cenário seu. Resultado: `contrato.referencia` e a saída de `calculo_comparar_referencia`.

A conta de referência é um ponto de reprodução, não um alvo. Não mude premissas até os números
coincidirem: cada diferença precisa de causa, e reproduzir a referência não a torna juridicamente
correta.

## Antes de comparar

1. **Conta exata**: identifique a conta selecionada (arquivo, hash, número no PJe-Calc, versão do
   sistema) e registre em `contrato.referencia` (`arquivo` ou `identificacao`, `sha256`, `dataBase`,
   `versao`, `criterios`, `limitacoes`).
2. **Mesma data-base**: liquide os dois cálculos na mesma data. A auditoria recusa referência com
   `dataBase` diferente de `contrato.dataLiquidacao`, e o comparador acusa datas diferentes antes de
   olhar valores.
3. **Critérios observáveis**: registre, para cada conta, jornada, calendário, afastamentos, salários,
   médias, pagamentos, incidências e destino do FGTS. Quando possível, monte um cenário de controle com
   os critérios da referência, sem tratá-los como corretos só por reproduzi-los. Dado ou configuração
   inacessível fica como limitação localizada (`limitacoes`).

## Comparar

`calculo_comparar_referencia` com `id_calculo`/`arquivo_calculo` e a referência. Nada é alterado. A
referência pode ser:

| referência | o que é comparado |
|---|---|
| `id_referencia`: cálculo no PJe-Calc já liquidado | ocorrências, pontes por verba e bruto → líquido |
| `arquivo_referencia` `.PJC` exportado depois de liquidar | ocorrências (quantidades e nominais) |
| `arquivo_referencia` com o relatório do PJe-Calc em PDF, HTML ou texto copiado | o Resumo: verbas (corrigido, juros, total) e bruto → líquido |
| `referencia_manual`: a conta transcrita (perito, planilha, conta homologada fora do PJe-Calc) | o resumo transcrito |

`referencia_manual`:

```json
{ "dataLiquidacao": "2016-06-30", "origem": "laudo do perito, fls. 400-412",
  "verbas": [{ "descricao": "HORAS EXTRAS 50%", "valorCorrigido": 9876.54, "juros": 1234.56, "total": 11111.10 }],
  "brutoDevidoAoReclamante": 31320.10, "totalDescontos": -8206.56, "liquidoDevidoAoReclamante": 23113.54,
  "totalDevidoPeloReclamado": 40330.83, "composicao": [{ "descricao": "DEDUÇÃO DE CONTRIBUIÇÃO SOCIAL", "valor": -1980.37 }] }
```

Transcreva com a folha de cada número e dupla leitura. Quando o relatório não mostra a data-base,
informe `data_base`. Um PDF escaneado não tem texto: transcreva a conta em `referencia_manual`.

A saída traz, nesta ordem:

1. **Verbas e ocorrências** — quantidades e valores nominais (devido − pago) antes de correção e juros,
   ocorrência por ocorrência, com a causa local de cada diferença: `quantidade`, `base`, `divisor`,
   `multiplicador`, `pago`, ocorrência só num lado, ou devido diferente com os mesmos parâmetros.
   Diferença sem causa localizada aparece como alerta.
2. **Ponte por verba** (precisa do Resumo do Cálculo, lido do PJe-Calc): nominal → correção → corrigido
   → juros → total, para cada lado, e o efeito que explica a diferença (nominal, correção ou juros). A
   soma das diferenças por verba precisa fechar com a diferença do bruto; o resíduo é mostrado e vira
   falha se passar da tolerância.
3. **Ponte do bruto ao líquido** — verbas, FGTS, depósito em conta vinculada, INSS da parte, IR e
   líquido, linha a linha. Cada conta precisa fechar sozinha (bruto + descontos = líquido).

Leia `iguais` (nada diverge no que foi comparado) e `comparacaoCompleta` (as pontes também foram
comparadas). Igualdade de totais não substitui igualdade das ocorrências: diferenças que se compensam
aparecem em `observacao`.

## Explicar as diferenças

- Distinga **efeito medido** (a causa local explica o valor), **interação** entre fatores (duas causas
  na mesma ocorrência) e **critério ainda não decidido** (vira premissa ou cenário).
- Comece pelas maiores diferenças nominais; só depois discuta índices e juros.
- Diferença que nenhuma ocorrência explica: confira ocorrências inativas, duplicadas ou fora do
  período, e rubricas fora do quadro.
- Entregue a tabela das diferenças por verba com a causa e o trecho que decide cada uma.
