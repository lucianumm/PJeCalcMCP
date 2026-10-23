# Módulo: jornada (horas extras, noturnas, intervalos, domingos e feriados)

Carregue quando houver horas extras, adicional noturno, intervalos, repousos ou feriados trabalhados.
Resultado: `apuracaoCartaoPonto` ou `cartoesDePonto`, `contrato.afastamentos` e as premissas de
jornada.

## Conferências

1. **Fonte da jornada**:
   - cartões de ponto válidos (`jornadas` dia a dia);
   - jornada fixada pelo título (`programacao` ou `escala`);
   - média arbitrada.

   Uma premissa por fonte. Cartões inválidos ou ausentes só valem com decisão que os substitua.
2. **Ciclos e escalas**: confira o ciclo real (12x36, 5x1, 6x1, 8x2...), o início do ciclo e as folgas.
   A auditoria recusa ciclo incompatível com o tipo.
   Se o cartão fecha o mês em outro dia (ex.: dia 20), informe `calculo.fechamentoCartao`, com as exceções por
   período: o dia do fechamento muda a que mês pertence cada dia e, com isso, as horas extras mensais e os DSR.
3. **Limites**: jornada diária/semanal/mensal do contrato ou da categoria (`jornadaDiaria`,
   `jornadaSemanal`, `jornadaMensal`) e o critério de apuração (`criterio`) conforme o título.
4. **Domingos e feriados**:
   - se o título defere dobra, diária complementar ou só o adicional;
   - quais feriados (nacionais, estaduais, municipais — dependem do TRT das tabelas);
   - se repousos trabalhados geram folga compensatória.

   Escolha justificada pelo título; nenhuma solução é universal.
5. **Calendário em duas dimensões**: confira a existência e a abrangência de cada feriado (nacional,
   estadual, municipal, ponto facultativo) **e** o cabimento dele no título. Registre os efeitos em
   horas extras, repousos, limite semanal e divisor de DSR. Uma data que coincide com folga ou domingo
   pode repercutir em outros campos: não limite a revisão à contagem de dias trabalhados.
6. **Compensações**: banco de horas, compensação semanal e Súmula 85 só com previsão no título ou na
   prova.
7. **Afastamentos, férias e redução do aviso**: identifique a prova e a situação do evento perante o
   título. Distinga, em `contrato.afastamentos[].natureza`:
   - `PAGAMENTO` — o documento só prova que pagou;
   - `PREVISAO_GOZO` — aviso ou programação, sem prova do gozo;
   - `GOZO_DOCUMENTADO` / `EVENTO_DOCUMENTADO` — gozo ou falta registrados (recibo assinado, cartão,
     atestado);
   - `RECONHECIDO_NO_PROCESSO` — admitido pelas partes ou fixado na decisão.

   Um evento confirmado que afasta o trabalho zera a jornada nos respectivos dias: cadastre a falta ou o
   gozo de férias com `origem` no evento. Se o evento colidir com a jornada fixada ou com prova
   impugnada, registre o conflito (`conflitos`) antes de excluir os dias e calcule a alternativa
   pertinente. O cadastro de férias não pode decidir sozinho uma controvérsia sobre trabalho.

   A auditoria acusa:
   - trabalho lançado durante um evento que exclui trabalho;
   - falta ou gozo de férias sem evento em `contrato.afastamentos`;
   - evento que exclui trabalho apoiado só em pagamento ou previsão, ou sem decisão nem premissa
     `CONFIRMADA`;
   - `efeito` declarado diferente do que o cadastro faz;
   - conflito sem resolução fundamentada (`resolucao` + `decisao`) fora de um cenário que o varie;
   - gozo de férias presumido pela regra automática (alerta: confirme em `ferias.periodos`).
8. **Intervalos**: intrajornada (antes/depois da Lei 13.467/2017), interjornadas, arts. 253, 384 e 72,
   conforme deferido.

## Conferência dos números

`calculo_criar` com `liquidar_em` compara as quantidades das verbas com as colunas apuradas do cartão
(`verificacoes`). Confira ainda por amostragem: algumas semanas contadas à mão contra o quadro mensal
(`cartaoDePonto.linhas`).
