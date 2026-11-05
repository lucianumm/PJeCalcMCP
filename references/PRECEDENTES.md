# Catálogo de precedentes com efeito no cálculo

Ponto de partida, **não** substituto da fonte oficial. Cada item resume o entendimento usual e precisa
ser conferido na fonte antes de ser aplicado; teses novas exigem revisão do catálogo. Fora do catálogo,
ou na dúvida sobre vigência e modulação, consulte a fonte e pergunte ao usuário — nunca decida de memória.

Como usar:
- precedente adotado **como critério** pela decisão vai em `contrato.decisoes[].precedentes` com
  `{ "id": "SUM340", "uso": "CRITERIO" }` (só reforço: `"uso": "REFORCO"`) e precisa estar parametrizado;
- título omisso quanto à correção e aos juros: informe o precedente aplicado em `correcaoJuros.precedentes`;
- decisão transitada que fixou o critério **expressamente** prevalece (modulação da ADC 58): registre o capítulo
  `ATUALIZACAO` na decisão e o trânsito;
- devedor ente público: `correcaoJuros.precedentes` com o regime aplicado (TEMA810, EC113, EC136).

A auditoria (dimensão "titulo") acusa título omisso sem precedente, ente público sem regime, ADC 58 sem
SELIC, liquidação após 30/08/2024 sem conferir a Lei 14.905/2024 e precedente fora do catálogo.

## ADC58 — ADC 58/59 e ADI 5867/6021 (STF)

- **Tema:** correção e juros dos créditos trabalhistas
- **Efeito no cálculo:** IPCA-E na fase pré-judicial (com os juros do art. 39, caput, da Lei 8.177/91) e SELIC a partir do ajuizamento (a SELIC já inclui os juros)
- **Vigência:** 2020-12-18
- **Modulação:** pagamentos já feitos são válidos; decisões transitadas que fixaram critério expressamente são mantidas; processos em curso e decisões omissas aplicam a tese
- **No PJe-Calc:** "indice": "IPCAE", "combinacoesIndice": [{ "indice": "SELIC", "aPartirDe": "ajuizamento" }], juros TRD_SIMPLES na fase pré-judicial e SEM_JUROS a partir do ajuizamento
- **Fonte:** STF, ADC 58 (julg. 18/12/2020; embargos de declaração julgados em 2021)

## LEI14905 — Lei 14.905/2024 (arts. 389 e 406 do Código Civil)

- **Tema:** correção e juros a partir de 30/08/2024
- **Efeito no cálculo:** na fase judicial, a partir de 30/08/2024: correção pelo IPCA e juros pela taxa legal (SELIC menos IPCA, sem resultado negativo), conforme aplicação adotada pelo TST
- **Vigência:** 2024-08-30
- **Modulação:** aplica-se ao período a partir de 30/08/2024; períodos anteriores seguem a ADC 58
- **No PJe-Calc:** combinação de índice IPCA a partir de 2024-08-30 e combinação de juros TAXA_LEGAL a partir de 2024-08-30
- **Fonte:** Lei 14.905/2024; TST, SDI-1, E-ED-RR-713-03.2010.5.04.0029 (2024)

## TEMA810 — Tema 810 (STF, RE 870.947)

- **Tema:** Fazenda Pública: correção e juros
- **Efeito no cálculo:** correção pelo IPCA-E e juros da caderneta de poupança nas condenações da Fazenda Pública (até a EC 113/2021)
- **Vigência:** 2017-09-20
- **Modulação:** conferir
- **No PJe-Calc:** índice IPCAE e juros JUROS_POUPANCA ou FAZENDA_PUBLICA até 08/12/2021
- **Fonte:** STF, RE 870.947

## EC113 — Emenda Constitucional 113/2021, art. 3º

- **Tema:** Fazenda Pública: SELIC única
- **Efeito no cálculo:** a partir de dezembro/2021, correção e juros pela SELIC, uma única vez, nas condenações da Fazenda Pública
- **Vigência:** 2021-12-09
- **Modulação:** conferir
- **No PJe-Calc:** combinação SELIC_FAZENDA (ou SELIC) a partir de 2021-12-09
- **Fonte:** EC 113/2021

## EC136 — Emenda Constitucional 136/2025

- **Tema:** precatórios: juros
- **Efeito no cálculo:** regras de juros de precatórios; o PJe-Calc 2.16 oferece a opção JUROS_PRECATORIO_EC_136_2025
- **Vigência:** conferir
- **Modulação:** conferir conteúdo e vigência na fonte oficial antes de usar
- **No PJe-Calc:** juros JUROS_PRECATORIO_EC_136_2025, conforme a decisão
- **Fonte:** EC 136/2025

## OJ394 — OJ 394 da SDI-1 do TST e incidente de recursos repetitivos que a alterou (2023)

- **Tema:** reflexos do repouso aumentado pelas horas extras
- **Efeito no cálculo:** para horas extras prestadas a partir de 20/03/2023, o aumento do repouso semanal pelas horas extras habituais repercute em férias, 13º, aviso e FGTS; antes, não repercute
- **Vigência:** 2023-03-20
- **Modulação:** data de corte: horas extras a partir de 20/03/2023
- **No PJe-Calc:** reflexos do RSR sobre horas extras (reflexo do reflexo) só para o período a partir de 2023-03-20, se a decisão não dispuser de outro modo
- **Fonte:** TST, IRR (Tema 9), 2023

## SUM85 — Súmula 85 do TST

- **Tema:** compensação de jornada
- **Efeito no cálculo:** compensação irregular: nas horas destinadas à compensação, só o adicional; o banco de horas segue regras próprias
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** apuração do cartão com limite da Súmula 85 (limiteSumula85)
- **Fonte:** TST, Súmula 85

## SUM338 — Súmula 338 do TST

- **Tema:** registro de jornada
- **Efeito no cálculo:** cartões com horários invariáveis não valem como prova; presume-se a jornada da inicial, salvo prova em contrário
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** jornada da decisão (programação), não a dos cartões
- **Fonte:** TST, Súmula 338

## SUM366 — Súmula 366 do TST

- **Tema:** minutos residuais
- **Efeito no cálculo:** variações de até 5 minutos por marcação (máximo 10 por dia) não contam; ultrapassado o limite, conta todo o tempo
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** tolerância por turno e por dia na apuração do cartão
- **Fonte:** TST, Súmula 366

## SUM437 — Súmula 437 do TST e art. 71, §4º, da CLT

- **Tema:** intervalo intrajornada
- **Efeito no cálculo:** até 10/11/2017, supressão parcial gera o pagamento do período integral com natureza salarial; a partir de 11/11/2017 (Lei 13.467), só o período suprimido, com natureza indenizatória
- **Vigência:** conferir
- **Modulação:** data de corte: 11/11/2017
- **No PJe-Calc:** intervaloIntrajornada com supressaoIntegral / supressaoReforma
- **Fonte:** TST, Súmula 437; Lei 13.467/2017

## SUM264 — Súmula 264 do TST

- **Tema:** base das horas extras
- **Efeito no cálculo:** a hora extra é calculada sobre a remuneração (parcelas de natureza salarial) mais o adicional
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** base com os históricos das parcelas salariais
- **Fonte:** TST, Súmula 264

## SUM347 — Súmula 347 do TST

- **Tema:** reflexos das horas extras
- **Efeito no cálculo:** reflexos pela média física das horas, multiplicada pelo valor da hora do mês do pagamento
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** reflexo com comportamento pela média das quantidades
- **Fonte:** TST, Súmula 347

## SUM340 — Súmula 340 do TST

- **Tema:** comissionista
- **Efeito no cálculo:** sobre as comissões, só o adicional de horas extras, com divisor pelas horas efetivamente trabalhadas
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** verba só do adicional sobre o histórico de comissões; divisor pelas horas trabalhadas
- **Fonte:** TST, Súmula 340

## SUM45 — Súmula 45 do TST

- **Tema:** horas extras no 13º
- **Efeito no cálculo:** horas extras habituais integram o 13º
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** reflexo em 13º
- **Fonte:** TST, Súmula 45

## SUM63 — Súmula 63 do TST

- **Tema:** FGTS sobre horas extras e adicionais
- **Efeito no cálculo:** o FGTS incide sobre a remuneração, incluídas horas extras e adicionais eventuais
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** incidência de FGTS nas verbas
- **Fonte:** TST, Súmula 63

## SUM60 — Súmula 60 do TST

- **Tema:** adicional noturno
- **Efeito no cálculo:** adicional noturno habitual integra o salário; cumprida a jornada noturna e prorrogada, o adicional incide também sobre as horas prorrogadas
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** prorrogacaoSumula60 na apuração do cartão
- **Fonte:** TST, Súmula 60

## SUM132 — Súmula 132 do TST

- **Tema:** periculosidade
- **Efeito no cálculo:** o adicional de periculosidade integra a base das horas extras
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** base das horas extras com o histórico da periculosidade
- **Fonte:** TST, Súmula 132

## SUM139 — Súmula 139 do TST

- **Tema:** insalubridade
- **Efeito no cálculo:** enquanto pago, o adicional de insalubridade integra a remuneração
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** base com o histórico da insalubridade
- **Fonte:** TST, Súmula 139

## SUM291 — Súmula 291 do TST

- **Tema:** supressão de horas extras
- **Efeito no cálculo:** supressão de horas extras habituais por 1 ano ou mais: indenização de 1 mês por ano (média dos últimos 12 meses)
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** verba informada ou personalizada com a média
- **Fonte:** TST, Súmula 291

## OJ415 — OJ 415 da SDI-1 do TST

- **Tema:** dedução de horas extras pagas
- **Efeito no cálculo:** a dedução das horas extras pagas é global (todo o período), não limitada ao mês
- **Vigência:** conferir
- **Modulação:** conferir
- **No PJe-Calc:** valor pago abatido pelo critério global
- **Fonte:** TST, OJ 415 da SDI-1
