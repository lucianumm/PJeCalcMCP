# Módulo: processo completo (mapa, fases e processos ligados)

Carregue **sempre, primeiro**. O mapa do processo define o tipo de trabalho, os documentos a pedir e as
decisões a ler. Resultado: `contrato.processos`, `contrato.fases`, `contrato.devedores`,
`contrato.pagamentosExecucao` e `contrato.destinosDoCredito`. Conferência: `processo_mapa`.

## 1. Processo principal

```json
"processos": [{ "id": "PR0", "numero": "0001234-45.2015.5.08.0001", "relacao": "PRINCIPAL",
                "fase": "LIQUIDACAO", "trabalho": "CALCULO_NOVO", "reclamantes": 1 }]
```

| fase | o trabalho que ela exige |
|---|---|
| `PRE_PROCESSUAL` | acordo na CCP ou extrajudicial homologado, protesto: alcance da quitação e marcos da prescrição |
| `CONHECIMENTO`, `RECURSAL` | cálculo **provisório**: a decisão ainda pode mudar (estimativa, depósito recursal, acordo) |
| `LIQUIDACAO` | cálculo novo a partir do título transitado |
| `EXECUCAO_PROVISORIA` | cálculo dos capítulos que podem ser executados; resultado marcado como provisório; carta de sentença |
| `EXECUCAO` | ponto de partida = **cálculo homologado**; atualizar e abater pagamentos (recalcular do zero exige `justificativaRecalculo`) |
| `ENCERRADO` | só conferência |

| trabalho | quando |
|---|---|
| `CALCULO_NOVO` | conhecimento, liquidação, execução provisória (ou execução com recálculo justificado) |
| `ATUALIZACAO` | execução de cálculo homologado: bloco `execucao` com `calculo_atualizar` (ou `calculo_externo_criar` para conta feita fora do PJe-Calc) — `EXECUCAO.md` |
| `EXECUCAO_COLETIVA` | execução individual de sentença coletiva (o título vem do processo `COLETIVO`) |
| `HABILITACAO` | crédito em recuperação judicial ou falência (atualizado até a data-limite) |
| `ENTE_PUBLICO` | devedor é ente público (regime próprio de correção e juros; precatório ou RPV) |

`contrato.fases` registra a linha do tempo: ajuizamento, sentença, acórdãos, trânsito, homologação,
citação, depósitos, alvarás, com data, documento e folha.

## 2. Processos ligados

Procure números de processo em **todas** as peças lidas e pergunte ao usuário se há outros. Todo
número citado precisa entrar no mapa (a auditoria acusa os que faltam).

| relação | efeito no cálculo (`efeito`) | documentos exigidos do outro processo |
|---|---|---|
| `CONEXO`, `CONTINENCIA` | parcelas decididas em conjunto; `exclui` ou `abate` para não cobrar duas vezes | inicial, decisões |
| `LITISPENDENCIA`, `COISA_JULGADA` | `exclui`: parcelas já julgadas saem do cálculo | inicial, decisões (e trânsito) |
| `ANTERIOR_ARQUIVADO` | `prescricao`: data do ajuizamento da ação arquivada (interrompe a prescrição só para pedidos idênticos — Súmula 268 do TST) | inicial, arquivamento |
| `PROTESTO_INTERRUPTIVO` | `prescricao`: data do protesto | petição do protesto e despacho |
| `COLETIVO` | `titulo: true`: a sentença coletiva é o título; abate o que foi recebido | sentença e acórdãos, trânsito, rol de substituídos ou habilitação |
| `ACORDO` | `exclui` (quitação) ou `abate` (valores pagos) | termo do acordo e homologação |
| `CONTRATO_ANTERIOR` | soma ou separação de períodos | decisão sobre unicidade |
| `CONSIGNACAO` | `abate`: valores depositados | guias e decisão |
| `PROVA_EMPRESTADA` | `admitidaPor`: decisão do processo principal que admitiu a prova | o documento emprestado |
| `INQUERITO` | justa causa ou reintegração e período | decisão |
| `RECUPERACAO_JUDICIAL`, `FALENCIA` | `dataLimite`: a liquidação não passa dessa data | decisão de deferimento ou decretação |
| `EXECUCOES_REUNIDAS` | penhora compartilhada e rateio | despacho de reunião |
| `EMBARGOS_TERCEIRO` | bens liberados ou penhorados | decisão |
| `CARTA_PRECATORIA` | atos praticados em outra vara | carta e certidões |
| `RESCISORIA`, `MANDADO_SEGURANCA`, `RECLAMACAO_CONSTITUCIONAL` | `suspende: true` se houver liminar (vira incerteza: só em cenário) | inicial e decisões |
| `OUTRO` | o que for declarado | documentos do processo |

Sem efeito no cálculo, declare `"efeito": { "nenhum": true, "motivo": "..." }`. Os documentos de outro
processo levam `"processo": "<id>"` em `contrato.documentos` e as decisões dele, em `contrato.decisoes`.

## 3. Situações especiais

- **Vários reclamantes:** um cálculo por reclamante (`reclamantes` > 1 gera alerta).
- **Devedores** (`contrato.devedores`):
  - responsabilidade `PRINCIPAL`, `SOLIDARIA` ou `SUBSIDIARIA`; a subsidiária exige `periodo`;
  - períodos diferentes pedem um cálculo por devedor;
  - `entePublico: true` exige o regime de correção em `correcaoJuros.precedentes`;
  - `recuperacaoJudicial` ou `falencia` levam a `dataLimite`.
- **Pagamentos da execução** (`contrato.pagamentosExecucao`): depósito recursal, depósito judicial,
  bloqueio, penhora, alvará, acordo, pagamento direto, parcelamento. Cada um com data, valor e
  documento. São abatidos na atualização do cálculo homologado, pela ordem de imputação: juros antes
  do principal.
- **Destinos do crédito** (`contrato.destinosDoCredito`): honorários contratuais destacados, penhora
  no rosto dos autos, cessão, pensão alimentícia, herdeiros. O PJe-Calc não os desconta do líquido:
  informe ao usuário o valor que cabe ao reclamante.
- **Rito e limites:** sumaríssimo; condenação limitada aos valores da inicial, quando a decisão
  assim fixar (registre como capítulo ou premissa).
- **Vínculos especiais:** doméstico, rural, avulso, aprendiz, empregado público celetista (registre
  como premissa e confira os critérios próprios).

## 4. O que a auditoria acusa

- mapa ausente, sem processo principal, número fora do padrão CNJ ou diferente do informado;
- fase ou trabalho inválidos;
- execução recalculada do zero sem justificativa;
- atualização de cálculo homologado, ainda não suportada pelo MCP;
- processo citado nos documentos e não registrado;
- relação sem efeito declarado;
- parcela excluída por outro processo e ainda no cálculo;
- marco interruptivo incompatível com a prescrição do cálculo;
- liquidação depois da data-limite de recuperação judicial ou falência;
- prova emprestada sem decisão que a admita;
- devedor subsidiário sem período;
- ente público sem regime de correção;
- pagamentos da execução e destinos do crédito sem documento, data ou valor;
- documentos exigidos de cada relação e da fase (requisitos `REL:<id>:<item>` e `FASE:<item>` da
  coleta).
