# Contrato de dados auditável

O contrato é o bloco `contrato` da especificação. Ele registra a prova e as decisões do processo antes
de qualquer parâmetro do PJe-Calc, e cada verba, reflexo, histórico, falta, período de férias e
abatimento aponta para ele em `origem`.

A auditoria (`calculo_validar` → `auditoria`, `calculo_criar` → `estado`) confere:
- se os vínculos existem (inclusive os documentos citados);
- se estão preenchidos;
- se são coerentes (identidade e saldo dos pagamentos, eventos x cadastro, cobertura dos cenários).

Ela **não** substitui a leitura do trecho citado: a interpretação jurídica continua exigindo revisão.
O validador não certifica a veracidade de nada pelo simples preenchimento de um campo.

Sem contrato, o cálculo pode ser feito, mas o estado máximo é `calculado`, nunca `auditado`. Com
`"exigirContrato": true` na raiz, a ausência do contrato é falha.

## Estrutura

```json
"contrato": {
  "dataLiquidacao": "2016-06-30",
  "documentos": [{ "id": "D1", "tipo": "SENTENCA", "identificacao": "ID 4f2a / fls. 10-18", "paginas": "10-18", "data": "2015-11-20" },
                 { "id": "D2", "tipo": "HOLERITES", "identificacao": "Contracheques", "paginas": "40-65",
                   "periodo": { "inicio": "2013-03", "fim": "2015-04" }, "lacunas": ["2014-03"] }],
  "coleta":     [{ "id": "C1", "requisito": "SALARIOS", "documento": "holerite de 03/2014", "motivo": "base de março/2014",
                   "impacto": "horas extras de 03/2014", "status": "SOLICITADO" }],
  "decisoes":   [{ "id": "DEC1", "documento": "D1", "tipo": "SENTENCA", "folha": "fl. 15", "trecho": "Julgo procedentes ..." },
                 { "id": "DEC2", "documento": "D4", "tipo": "ACORDAO_TRT", "folha": "fl. 210", "trecho": "...", "altera": ["DEC1"] }],
  "parcelas":   [{ "id": "P6", "rubrica": "HORAS EXTRAS 50%", "situacao": "DEFERIDA", "decisao": "DEC2", "folha": "fl. 211",
                   "periodo": { "inicio": "2013-03-01", "fim": "2015-04-15" },
                   "reflexos": ["13º SALÁRIO", "AVISO PRÉVIO", "FÉRIAS + 1/3", "REPOUSO SEMANAL REMUNERADO E FERIADO"],
                   "premissas": ["PR1"] },
                 { "id": "P7", "rubrica": "FGTS + 40%", "situacao": "DEFERIDA", "decisao": "DEC1", "naoCalcular": "apurado no bloco fgts" }],
  "afastamentos": [{ "id": "A1", "tipo": "FERIAS", "natureza": "GOZO_DOCUMENTADO", "inicio": "2015-01-30", "fim": "2015-02-28",
                     "documento": "D5", "folha": "fl. 121", "trecho": "gozo de 30/01 a 28/02/2015", "efeito": "EXCLUI_TRABALHO",
                     "premissas": ["PR3"] },
                   { "id": "A2", "tipo": "AFASTAMENTO", "natureza": "RECONHECIDO_NO_PROCESSO", "inicio": "2014-05-01", "fim": "2014-05-31",
                     "motivo": "auxílio-doença", "documento": "D6", "decisao": "DEC1",
                     "conflitos": [{ "id": "J1", "descricao": "jornada fixada na sentença sem ressalva de maio/2014" }],
                     "resolucao": "a sentença manda excluir os afastamentos previdenciários" }],
  "remuneracoes": [{ "id": "R1", "componente": "SALARIO_FIXO", "de": "2013-03", "ate": "2013-12", "valor": 1500, "documento": "D2", "folha": "fl. 41" },
                   { "id": "R2", "componente": "ADICIONAL_FIXO", "de": "2013-03", "ate": "2013-12", "valor": 450, "documento": "D2" },
                   { "id": "R3", "componente": "BASE_CONTRIBUICAO", "de": "2013-03", "ate": "2013-12", "valor": 1950, "componentes": ["R1", "R2"] }],
  "pagamentos":   [{ "id": "PG1", "titulo": "TRCT: 13º proporcional e férias", "parcelas": ["P3", "P4"], "competencia": "2015-04",
                     "data": "2015-04-20", "valor": 3000, "emitente": "Empresa Teste Ltda", "documento": "D2", "folha": "fl. 52",
                     "comando": "DEC1" },
                   { "id": "PG1a", "derivadoDe": "PG1", "parcelas": ["P3"], "valor": 1200 },
                   { "id": "PG1b", "derivadoDe": "PG1", "parcelas": ["P4"], "valor": 1800, "premissas": ["PR2"] }],
  "premissas":    [{ "id": "PR1", "texto": "20 horas extras por mês", "status": "CONFIRMADA", "documento": "D1", "folha": "fl. 16", "fundamento": "quantidade fixada na sentença" },
                   { "id": "PR2", "texto": "recibo de férias sem assinatura", "status": "CONTROVERTIDA", "fundamento": "impugnado na réplica, fl. 130" }],
  "zerosJustificados": [{ "verba": "13º SALÁRIO SOBRE HORAS EXTRAS 50%", "motivo": "reflexo excluído pelo acórdão", "decisao": "DEC2" }],
  "revisoesDeAlerta":  [{ "item": "PG1b", "conclusao": "recibo usado só no cenário B", "fundamento": "impugnação, fl. 130", "responsavel": "agente", "impacto": "R$ 1.800,00" }],
  "referencia": { "arquivo": "conta-perito.PJC", "sha256": "…", "dataBase": "2016-06-30", "versao": "2.16.0",
                  "criterios": "jornada da sentença, IPCA-E + SELIC", "limitacoes": "médias do perito não exportadas" },
  "leitura":    [{ "documento": "D2", "classificacao": { "usadas": "40-60,62", "irrelevantes": [{ "folhas": "61", "motivo": "verso em branco" }],
                   "ilegiveis": [{ "folhas": "63", "motivo": "digitalização cortada" }] }, "lidaComoImagem": "40-65",
                   "fechamentos": [{ "tipo": "HOLERITE", "referencia": "2014-03", "ok": true, "detalhe": "proventos − descontos = líquido" }] }],
  "confrontos": [{ "tipo": "DATAS", "documentos": ["D11", "D1"], "ok": true, "detalhe": "admissão e saída do TRCT iguais às da sentença" }],
  "pedidos":    [{ "pedido": "Horas extras com reflexos", "documento": "D1", "folha": "fl. 3", "situacao": "DEFERIDO", "decisao": "DEC1" }]
}
```

- `situacao` da parcela: `DEFERIDA`, `INDEFERIDA`, `PENDENTE` ou `REFORMADA`. A situação é a **final**,
  depois de todas as decisões: parcela excluída por acórdão fica `INDEFERIDA`; `REFORMADA` é a parcela que
  continua deferida com o conteúdo alterado (período, base, alcance). A `decisao` precisa ser a vigente:
  uma decisão citada em `altera` de outra é recusada.
- `coleta[].requisito` aceita os ids da matriz (`TITULO`, `DECISOES_POSTERIORES`, `REGISTRO`, `RESCISAO`,
  `SALARIOS`, `JORNADA`...) e os nomes usuais (`SENTENCA`, `ACORDAO`, `TRANSITO`, `CTPS`, `TRCT`,
  `HOLERITES`, `CARTOES_DE_PONTO`, `EXTRATO_FGTS`...); `OUTROS` registra um pedido livre (ata, réplica...).
- `componente` da remuneração: `SALARIO_FIXO`, `ADICIONAL_FIXO`, `VARIAVEL`, `SUBSTITUTIVA` ou
  `BASE_CONTRIBUICAO`. Separe-os em históricos diferentes, sem dupla média. Uma base derivada lista os
  `componentes` (ids) e, se não for soma simples, a `formula` e o `arredondamento`: a soma é
  recalculada a partir dos componentes.
- **Documentos**: `periodo` e `lacunas` dizem quais meses o documento cobre (holerites, cartões,
  extratos). **Coleta** (`coleta`): cada pedido de documento ao usuário, com `requisito`, `motivo`,
  `impacto` e `status` (`SOLICITADO`, `RECEBIDO`, `INCOMPLETO`, `ILEGIVEL`, `INEXISTENTE`). Matriz e
  regras em `modulos/DOCUMENTOS.md`.
- `status` da premissa: `CONFIRMADA`, `CONTROVERTIDA` ou `DESCONHECIDA`, com `fundamento`, `folha` ou
  `documento`.
- **Eventos** (`afastamentos`): `tipo` (`FERIAS`, `FALTA`, `AFASTAMENTO`, `AVISO_REDUZIDO`...),
  `natureza` da prova (`PAGAMENTO`, `PREVISAO_GOZO`, `GOZO_DOCUMENTADO`, `EVENTO_DOCUMENTADO`,
  `RECONHECIDO_NO_PROCESSO`), `efeito` no cálculo (padrão `EXCLUI_TRABALHO`; `REDUZ_AVISO` para a
  redução do aviso; `SEM_EFEITO`), `decisao` que trata o evento, `conflitos` e `resolucao`.
- **Pagamentos**: o original tem documento; uma alocação derivada (`derivadoDe`) herda o documento e o
  emitente e consome o saldo do original. `parcelas` diz o que o pagamento cobre; `periodo` ou
  `competencia` e `avos` dizem o alcance; `comando`, a decisão que autoriza deduzir. Sem data, o
  pagamento fica como pendência identificada. Pagamento feito por terceiro (outra empresa do grupo,
  tomador) só abate com `"emitenteAceito": { "motivo", "decisao", "folha", "premissas" }`: vira alerta com
  o motivo; sem isso, emitente diferente do reclamado é falha.
- **Leitura** (`leitura`, `confrontos`, `pedidos`): cada documento de `documentos` com todas as folhas
  classificadas (usadas, irrelevantes com motivo, ilegíveis com pedido em `coleta`), as folhas vistas
  como imagem, os fechamentos, os confrontos entre documentos (`DATAS`, `SALARIO`, `JORNADA`,
  `PAGAMENTOS`, `VALORES`) e cada pedido da inicial (`DEFERIDO`, `INDEFERIDO`, `PARCIAL`,
  `SEM_DECISAO`). Formato e regras em `modulos/LEITURA.md`; `documento_inventario` prepara o registro.

## Processo, decisões por capítulo e aprovação

Campos do mapa do processo (`modulos/PROCESSO.md`), da cadeia de decisões
(`modulos/TITULO-EXECUTIVO.md`) e da aprovação (`modulos/PLANO.md`):

```json
"processos": [{ "id": "PR0", "numero": "...", "relacao": "PRINCIPAL", "fase": "LIQUIDACAO", "trabalho": "CALCULO_NOVO" },
              { "id": "PR1", "numero": "...", "relacao": "ANTERIOR_ARQUIVADO", "efeito": { "prescricao": "2014-01-10" } }],
"fases": [{ "processo": "PR0", "evento": "TRANSITO_EM_JULGADO", "data": "2016-02-01", "documento": "D12", "folha": "fl. 20" }],
"decisoes": [{ "id": "DEC1", "processo": "PR0", "documento": "D1", "instancia": "VARA", "tipo": "SENTENCA", "publicacao": "2015-11-20",
               "folha": "fl. 15", "trecho": "...", "capitulos": [{ "parcela": "P6", "efeito": "DEFERE" }, { "criterio": "ATUALIZACAO", "efeito": "DEFERE" }],
               "transito": "2016-02-01", "recursos": [], "precedentes": [], "conflitos": [] }],
"devedores": [{ "id": "R1", "nome": "...", "responsabilidade": "PRINCIPAL" }],
"pagamentosExecucao": [{ "id": "PX1", "tipo": "DEPOSITO_RECURSAL", "data": "...", "valor": 0, "documento": "..." }],
"destinosDoCredito": [{ "tipo": "HONORARIOS_CONTRATUAIS", "percentual": 30, "documento": "..." }],
"aprovacao": { "por": "...", "em": "...", "observacoes": "...", "hashContrato": "..." }
```

- Documentos e pedidos de outro processo levam `"processo": "<id>"`.
- `correcaoJuros.precedentes`: os precedentes aplicados quando o título é omisso (ver `PRECEDENTES.md`).

## Vínculos na especificação

| onde | campo | aponta para |
|---|---|---|
| `verbas[]` (e `personalizada`) | `origem` | parcela(s) |
| reflexo em objeto | `origem` (opcional) | parcela; nomes em texto são conferidos contra `parcela.reflexos` |
| `verbas[].valorPago` informado | `origem` | pagamento(s), original ou derivado |
| `fgts.operacoes[]` | `origem` | pagamento |
| `historicosSalariais[]` | `origem` | remuneração(ões) |
| `faltas[]` | `origem` | evento em `afastamentos` (obrigatório com contrato) |
| `ferias.periodos[]` com gozo | `origem` | evento `FERIAS` em `afastamentos` |
| `honorarios[]`, `multas[]` | `origem` (opcional) | qualquer registro |

## O que a auditoria detecta

Documentação (com `exigirDocumentacaoCompleta`, padrão com contrato):
- documento obrigatório do caso **ausente** e não pedido (sentença, decisões posteriores, registro,
  TRCT, holerites, cartões, recibos de férias e 13º, extrato do FGTS, norma coletiva);
- **cobertura mês a mês incompleta** (meses fora do período ou nas lacunas) e documento sem
  `periodo` quando a cobertura precisa ser conferida;
- registro (remuneração, pagamento, afastamento) fora do período do documento citado;
- critério de correção e juros ou honorários sem `origem` na decisão;
- pedido pendente (`SOLICITADO`, `INCOMPLETO`, `ILEGIVEL`, `INEXISTENTE` sem fundamento): incerteza
  `DOC:<REQUISITO>`, falha fora de cenário; `INEXISTENTE` com fundamento: alerta.

Leitura (dimensão `leitura`):
- documento sem registro de leitura;
- folha sem classificação, repetida ou fora do documento; folhas irrelevantes sem motivo;
- folhas ilegíveis sem pedido pendente de nova cópia;
- fechamento ou confronto que não fecha, sem resolução (com resolução: alerta);
- pedido da inicial sem decisão (alerta).

Processo (dimensão `processo`):
- mapa ausente ou incoerente;
- processo citado e não registrado;
- relação sem efeito;
- parcela já decidida em outro processo ainda no cálculo;
- prescrição incompatível com o marco interruptivo;
- data-limite de recuperação judicial ou falência;
- execução recalculada sem justificativa;
- devedores, pagamentos da execução e destinos do crédito sem documento.

Título (dimensão `titulo`):
- capítulo sem decisão;
- decisão mal registrada;
- reforma por recurso não conhecido;
- capítulo anulado sem nova decisão;
- recurso pendente ou trânsito ausente na liquidação ou execução;
- conflito sem resolução;
- parcela apontando decisão superada;
- correção e juros contra precedente vinculante.

Aprovação (dimensão `aprovacao`): plano não aprovado, ou contrato alterado depois da aprovação.

Prova e vínculos:
- verba sem origem, parcela inexistente, **INDEFERIDA** calculada, **PENDENTE** fora de cenário;
- período da verba fora do deferido; **reflexo não deferido**; `"reflexos": "todos"` sem lista;
- parcela **DEFERIDA sem verba** (sem `naoCalcular` com motivo);
- decisão sem documento, trecho ou folha; decisão **alterada** usada como vigente;
- **documento inexistente** citado por decisão, afastamento, remuneração, pagamento ou premissa;
- premissa sem fundamento (alerta).

Pagamentos:
- pagamento **sem identidade** (`parcelas`) ou que cobre **outra parcela** que não a abatida;
- período ou competência **fora do contrato** ou que não alcança a verba abatida;
- pagamento sem data, período ou competência (pendência, alerta) e sem `comando` (alerta);
- **consumo acima da cobertura** do pagamento original, somando os ids derivados; uso repetido sem
  valor em cada uso; saldo não alocado (alerta);
- pagamento de **outro emitente**; abatimento apoiado em premissa **CONTROVERTIDA** ou
  **DESCONHECIDA** fora de cenário;
- depósito de FGTS provado por documento que não é extrato/guia (alerta).

Remunerações:
- valor salarial **fora da vigência** documentada ou diferente dela;
- base derivada cuja soma dos componentes **não fecha** com o valor, ou com componente fora da vigência.

Eventos e jornada:
- falta ou gozo de férias **sem evento**; evento sem `natureza`;
- evento que exclui trabalho provado só por **pagamento** ou **previsão**, ou sem decisão nem premissa
  `CONFIRMADA`;
- `efeito` declarado que contraria o cadastro de faltas/férias;
- **conflito material** sem resolução fundamentada fora de cenário;
- **trabalho lançado durante afastamento** (jornadas, programação ou escala sobre o período);
- férias decididas pela regra automática (alerta); horas extras com período sobre afastamento (alerta);
- **ciclo de folgas** incompatível com a escala (5x1, 6x1, 8x2);
- a **mesma parcela mais de uma vez na base**; dupla integração (alerta).

Antes de importar (`calculo_validar`): as regras de validação do próprio PJe-Calc sobre a
especificação (`pendenciasPrevistas`); erro do aplicativo é erro da especificação, alerta vira aviso.

Depois de liquidar (`verificacoes`):
- aritmética de cada ocorrência, avos de 13º, dias de aviso, quantidades do cartão;
- **verba ativa sem ocorrências**, **competência faltante**, **ocorrência duplicada** (falhas, salvo
  zero justificado em `zerosJustificados`); verba toda zerada (alerta);
- **recálculo independente** de verbas, juros, FGTS e multa, contribuição social (segurado, empresa,
  SAT, terceiros, com juros e multa; a partir de 03/2020, a contribuição progressiva do segurado
  refeita pelas faixas da tabela da competência, `server/modelos/tabela-inss-segurado.json`), IR, honorários e custas, comparado ao centavo com o Resumo do
  Cálculo e os demonstrativos de FGTS, juros e IR;
- **critérios da justificativa** (índices e combinações, acumulação, juros por fase, base dos juros,
  prescrição, aviso prévio, tabela do IR) iguais aos parâmetros do cálculo;
- valores mês a mês (`verbas[].ocorrencias`) presentes no cálculo liquidado;
- regras de validação do PJe-Calc sobre o cálculo exportado (alerta: o quadro de pendências do
  aplicativo é o oficial);
- data de liquidação diferente de `contrato.dataLiquidacao`.

## Revisão dos alertas

Alerta não é falha, mas também não some sozinho. Para chegar a `auditado` (ou `simulacao`), cada
alerta precisa de uma revisão em `revisoesDeAlerta` cujo `item` apareça no item ou no detalhe do
alerta, com `conclusao` e `fundamento`. A revisão registra a conclusão e o responsável; ela não torna o
problema resolvido se a conclusão for "pendente".

## Cenários

Quando uma incerteza material não pode ser resolvida, declare:

```json
"cenario": {
  "nome": "B — recibo de férias aceito",
  "descricao": "...",
  "premissasAlteradas": [{ "id": "PR2", "valor": "aceito", "descricao": "recibo vale como pagamento" }],
  "premissasFixas": [{ "id": "A2:J1", "motivo": "variado no cenário C; aqui mantém a exclusão de maio/2014" }],
  "pendencias": ["data de pagamento do 13º 2014"]
}
```

- Cada incerteza aberta (premissa controvertida/desconhecida usada, parcela pendente, conflito de
  evento sem resolução) precisa aparecer em `premissasAlteradas` (variada) ou em `premissasFixas`
  (mantida, com motivo). Se não aparecer, é **falha**: alterar a primeira folga não cobre férias,
  calendário ou abatimentos.
- Num cenário, as incertezas cobertas viram **alerta**; a saída leva `cenario: true` e o estado máximo
  é `simulacao`.
- Entregue cada cenário com a hipótese que o separa dos outros e o efeito medido de cada incerteza.
  Quando houver interação relevante entre incertezas, calcule também as combinações.
