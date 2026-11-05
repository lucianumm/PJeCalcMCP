# Controles obrigatórios de interpretação e de prova

O MCP garante que o PJe-Calc **aceita** e calcula o que foi especificado. Ele não garante que a
especificação corresponda ao título executivo nem aos documentos dos autos. "Zero erros e zero
alertas" na tela Liquidar significa aceitação pelo sistema, **não** confirmação jurídica ou documental.
Os controles abaixo são obrigatórios antes de entregar um cálculo. O resultado de cada um vai na
resposta ao usuário e, quando couber, como anotação na própria especificação: campos iniciados por
`_` são aceitos em qualquer bloco e ignorados pelo cálculo, por exemplo
`"_fonte": "sentença fl. 312, item 4"` ou `"_premissa": "controvertida"`.

## 0. Processo, documentação, leitura, título e plano

- **Mapa do processo** (`modulos/PROCESSO.md`): fase, trabalho, processos ligados com efeito,
  devedores, pagamentos da execução e destinos do crédito.
- **Leitura integral** (`modulos/LEITURA.md`): todas as páginas, imagens vistas como imagem,
  fechamentos e confrontos.
- **Título por capítulo** (`modulos/TITULO-EXECUTIVO.md`): todas as decisões, da vara ao STF,
  incluindo liquidação e execução.
- **Plano aprovado pelo usuário** (`modulos/PLANO.md`) antes do cálculo.

### Documentação completa

Antes de qualquer parâmetro, peça e confira os documentos que o caso exige
(`calculo_documentos_necessarios`, `modulos/DOCUMENTOS.md`): título e decisões posteriores, registro,
TRCT, holerites e cartões de **todo** o período, recibos de férias e 13º, extrato do FGTS, norma
coletiva. Registre cada documento com o período que cobre e cada pedido em `contrato.coleta`. O que
não existir vira pendência declarada; o cálculo, simulação.

## 1. Matriz por rubrica

Monte uma linha para cada rubrica antes de escrever o JSON:

| rubrica | comando da sentença | embargos | reforma (TRT/TST no próprio processo) | reflexos deferidos | período | base | unidade/quantidade | vencimento | trecho/folha |
|---|---|---|---|---|---|---|---|---|---|

- O comando que vale é o **último** no próprio processo: sentença, depois embargos de declaração,
  acórdão do TRT e decisão do TST. Jurisprudência citada na fundamentação (súmulas, OJs, julgados de
  outros processos) não é decisão do processo.
- Cada reflexo precisa de comando expresso. Não estenda reflexos por analogia.
- Cada linha da matriz vira uma verba (ou um reflexo) do JSON, com `_fonte` apontando o trecho.

## 2. Classificação das premissas

Classifique cada dado usado como **confirmada** (documento ou comando claro), **controvertida**
(partes divergem, documento ambíguo) ou **desconhecida** (não há prova nos autos).

- Desconhecido **não** vira zero, pagamento integral nem padrão do sistema em silêncio. Pergunte ao
  usuário ou deixe a premissa explícita na resposta.
- `calculo_validar` devolve `resumo.premissasPadrao`: as decisões que ficaram com o padrão do PJe-Calc
  (aviso prévio, custas, correção e juros, FGTS, contribuição social, IRPF, situação das férias,
  histórico ÚLTIMA REMUNERAÇÃO). Cada uma precisa ser confirmada ou decidida no JSON. Com
  `"exigirDecisoesExplicitas": true` o validador recusa a especificação enquanto houver alguma.

## 3. Componentes da remuneração

Separe, para cada competência:

- salário fixo;
- adicionais fixos (periculosidade, gratificação habitual...);
- parcelas variáveis (comissões, horas extras pagas, prêmios);
- remuneração substitutiva de afastamento (auxílio, licenças);
- campos que são só **base de contribuição** e não salário.

Cada componente vai num histórico salarial próprio, com as incidências de INSS e FGTS corretas.
Evite **dupla média** (o reflexo já calcula a média de uma parcela que também está no histórico usado
como base) e **dupla integração** (a mesma parcela entrando como verba e como base de outra verba). Ao
usar `base.verbas`, confira se a verba incluída já não está no histórico da base.

## 4. Conciliação de pagamentos

Compense pagamentos (`valorPago`, `fgts.operacoes`, férias e 13º pagos) somente quando coincidirem
**competência, título, avos, data e emitente** (o mesmo empregador). Não compense por semelhança de
valores. Recibo de outro empregador não abate nada deste contrato. Registre na matriz os pagamentos
recusados e o motivo.

Cada pagamento declara as parcelas que cobre (`parcelas`), o alcance (`competencia`/`periodo`, `avos`)
e o comando que autoriza deduzir. Um recibo dividido entre componentes vira alocações derivadas
(`derivadoDe`): a soma dos consumos não passa do valor do original. Data não localizada é pendência,
nunca data fictícia (`modulos/PAGAMENTOS.md`).

Faltas, férias, afastamentos e redução do aviso são **eventos** com natureza da prova e efeito no
cálculo (`modulos/JORNADA.md`): o que o documento registra, o que o processo reconheceu e o que o
cálculo faz com isso são coisas diferentes.

## 5. Bases reais de INSS

- Use as bases reais dos holerites e do CNIS nos históricos salariais (`inss: true`, `inssRecolhido`
  quando recolhido).
- **ÚLTIMA REMUNERAÇÃO**: com `calculo.ultimaRemuneracao`, a tela cria um histórico com o valor fixo
  em todas as competências e incidência de INSS. Quando há históricos reais, o MCP exige
  `calculo.historicoUltimaRemuneracao.criar` (`false` se os históricos já trazem os salários; `true`
  com `de`/`ate`/`inss` para limitar). Ele também avisa quando o histórico automático coexiste com
  os reais ou cobre um período longo sem evolução salarial.
- Aviso prévio (`calculo.avisoPrevio`: apuração e projeção) e custas (`custas`) precisam de decisão
  explícita conforme o título. Não herde os padrões da tela.

## 6. Correção monetária e juros por fase

Informe cada fase com marco e taxa explícitos (`correcaoJuros.indice` + `combinacoesIndice`,
`juros` + `jurosFasePreJudicial` + `combinacoesJuros`). Exemplo ADC 58 + Lei 14.905/2024: IPCA-E e juros
TRD na fase pré-judicial; SELIC a partir do ajuizamento; IPCA + taxa legal a partir de 30/08/2024 —
sempre conforme o que o título fixou.

Depois de liquidar, confira o retorno `justificativa` de `calculo_criar`/`calculo_liquidar` (relatório
JUSTIFICATIVA do PJe-Calc). Ele traz o índice e a última taxa usados, os juros por fase, o aviso
prévio, a contribuição social e o IR que o sistema **de fato** aplicou. A conferência é feita nesse
relatório, não só no JSON.

## 7. Reconciliação final

Reconcilie todos os componentes **na mesma data de liquidação**:

- `resultado.verbas` traz as rubricas, inclusive as **negativas** (o PJe-Calc mostra entre
  parênteses).
- `resultado.conferencia` mostra:
  - se a soma das rubricas é igual ao total do quadro e ao bruto (`somaConfere`, `brutoIgualAoQuadro`);
  - quais rubricas são negativas.
- `resultado.composicao` mostra a composição do líquido e do total do reclamado:
  - verbas e FGTS separado (devido e depositado);
  - contribuição social e IRPF;
  - honorários e custas.
- Explique ao usuário cada rubrica negativa e cada dedução relevante. Se `conferencia.alerta`
  aparecer, abra `calculo_relatorio` e confira o relatório completo antes de entregar.

## 8. Completude e conta de referência

- Confronte a matriz do item 1 com as ocorrências finais, por período, quantidade, base, pago,
  vencimento e incidência. Verba ativa sem ocorrências, competência faltante e ocorrência duplicada são
  falhas (`verificacoes`); zero material exige causa em `contrato.zerosJustificados`.
- Havendo conta de referência, compare a conta exata, na mesma data-base, com
  `calculo_comparar_referencia` (`modulos/REFERENCIA.md`). Igualdade de totais não substitui
  igualdade das ocorrências.
- Cada alerta material recebe revisão em `contrato.revisoesDeAlerta`; cenários listam as premissas
  variadas e as mantidas fixas.

O cálculo só está pronto para entrega com os nove controles (0 a 8) registrados. Até lá, o máximo que se
afirma é "aceito pelo PJe-Calc". Informe separadamente transferência, aritmética, completude,
documentação e revisão interpretativa (`dimensoes` de `calculo_criar`).
