# Módulo: execução (pagamentos, atualização, cálculo externo, precatório)

Carregue quando a fase for execução: atualizar o cálculo homologado, abater depósitos, alvarás e
bloqueios convertidos, lançar honorários, multas, pensão alimentícia e custas da execução, atualizar uma
conta feita fora do PJe-Calc ou expedir RPV/precatório. Resultado: o bloco `execucao`, o `-ATUALIZADO.PJC` e o Resumo da
Atualização conferido.

O ponto de partida é o **cálculo homologado**, não um cálculo novo. Se ele foi feito no PJe-Calc, use o
`.PJC` exportado depois de liquidar (ou o número do cálculo). Se foi feito fora (perito, contadoria,
acordo), use o Cálculo Externo.

## Ferramentas

| situação | ferramenta |
|---|---|
| cálculo homologado feito no PJe-Calc | `calculo_atualizar` com `arquivo_pjc` (ou `id_calculo`) e `execucao` |
| conta homologada feita fora do PJe-Calc | `calculo_externo_criar` com `calculoExterno` (e `execucao` dentro dele) |
| cálculo novo que já sai atualizado | `calculo_criar` com o bloco `execucao` na especificação |

Em todos os casos o MCP grava os pagamentos e os eventos numa **cópia** do cálculo, importa a cópia, roda
"Liquidar Atualização" no próprio PJe-Calc (rateio entre credores e imputação, juros antes do principal
quando pedido) e lê o Resumo da Atualização. O cálculo de origem não muda.

## Bloco `execucao`

```json
{
  "dataAtualizacao": "2016-08-31",
  "identificacao": "fl. 350",
  "comentarios": "atualização para expedição de alvará",
  "cobrarEncargosIrpf": false,
  "honorarios": [{ "tipo": "SUCUMBENCIAIS", "descricao": "Honorários da execução", "devedor": "RECLAMADO",
                   "credor": { "nome": "...", "cpf": "..." }, "valor": 500, "dataVencimento": "2016-07-20",
                   "dataEvento": "2016-07-20", "folha": "fl. 320" }],
  "multas": [{ "descricao": "Multa do art. 523 do CPC", "credorDevedor": "RECLAMANTE_RECLAMADO", "valor": 1000,
               "dataVencimento": "2016-07-20", "dataEvento": "2016-07-20", "folha": "fl. 321" }],
  "pensao": { "dataEvento": "2016-07-20", "aliquota": 30, "incidirSobreJuros": true, "folha": "fl. 322",
              "verbas": "todas", "fgts": true, "multaFgts": true },
  "custas": { "folha": "fl. 340",
              "fixas": [{ "vencimento": "2016-07-25", "atosUrbanos": 2, "agravosDePeticao": 1 }],
              "autos": [{ "tipo": "ARREMATACAO", "vencimento": "2016-07-25", "valor": 50000 }],
              "armazenamentos": [{ "inicio": "2016-07-01", "fim": "2016-08-15", "valor": 20000 }] },
  "pagamentos": [{
    "data": "2016-07-15", "valor": 10000, "folha": "fl. 300", "origem": "D12", "priorizarJuros": true,
    "creditoReclamante": 8000,
    "credito": { "principal": "apurar" },
    "recolher": { "contribuicaoSocial": "apurar" },
    "outrosDebitosReclamado": 2000,
    "outros": { "inssSalariosDevidos": "apurar" }
  }],
  "precatorio": { "tipo": "RPV", "esfera": "FEDERAL", "periodoGraca": { "inicio": "...", "fim": "..." }, "ec136APartirDe": "..." }
}
```

### Pagamento

Cada pagamento tem `data`, `valor`, `folha` e `origem` (o documento do depósito ou alvará), e se divide
em três parcelas:

- `creditoReclamante`: o que vai para o reclamante. Padrão: `valor − outrosDebitosReclamado −
  debitosCobrarReclamante`;
- `outrosDebitosReclamado`: o que o reclamado recolhe por conta própria (INSS da empresa, custas...);
- `debitosCobrarReclamante`: o que se cobra do reclamante (custas, multas e honorários devidos por ele).

Os componentes dizem como cada parcela se distribui. Cada um vale `"apurar"` (o PJe-Calc calcula a
proporção) ou um valor:

| grupo | componentes |
|---|---|
| `credito` | `principal`, `fgts`, `multasReclamante`, `multasReclamado` |
| `recolher` (descontos do crédito) | `custas`, `depositoFgts`, `contribuicaoSocial`, `previdenciaPrivada`, `pensao`, `imposto`, `multas`, `honorarios` |
| `outros` (outros débitos do reclamado) | `custas`, `inssSalariosDevidos`, `inssSalariosPagos`, `jurosPrevidenciaPrivada`, `impostoRenda`, `inss10`, `inss05`, `multas`, `honorarios` |
| `cobrar` (débitos do reclamante) | `custas`, `multas`, `honorarios` |

`multas` e `honorarios` são listas ligadas ao evento: `[{ "descricao" | "credor", "valor" | "apurar": true }]`.

`priorizarJuros: true` imputa o pagamento primeiro nos juros (art. 354 do Código Civil). Sem o campo, vale
o padrão do aplicativo, a imputação proporcional entre juros e principal, e o MCP declara isso em
`premissasPadrao`. Sem `credito`, o crédito do reclamante vai todo para o principal (também declarado).
Confira no título ou na decisão da execução qual critério vale.

Com `precatorio: true` no pagamento, a tela do PJe-Calc desliga priorizar juros, multas, previdência
privada, pensão, débitos a cobrar, juros da previdência privada e INSS 10%/0,5%; o MCP avisa.

### Honorários e multas da execução

Mesmo formato de `honorarios` e `multas` do cálculo (`references/ESPECIFICACAO-CALCULO.md`), mais
`dataEvento` (quando foram fixados) e `folha`. Eles entram como eventos da atualização e são cobrados a
partir da data do evento.

### Pensão alimentícia da execução

A pensão fixada depois da liquidação (tela Pagamento > Pensão Alimentícia). O cálculo tem uma só pensão:
se ela já é apurada no próprio cálculo, a tela recusa (MSG0126) e a pensão se ajusta no cálculo, não na
execução.

| campo | conteúdo |
|---|---|
| `dataEvento` | a partir de quando a pensão vale (obrigatória; não antes da liquidação nem no futuro) |
| `aliquota` | percentual da pensão (obrigatório) |
| `incidirSobreJuros` | a pensão incide também sobre os juros (padrão da tela: não) |
| `folha` | identificação na decisão (ID ou folhas) |
| `verbas` | `"todas"` (verbas e reflexos ativos) ou a lista dos nomes que entram na base; as demais verbas ativas ficam fora. Sem o campo, valem as marcações do cálculo |
| `fgts`, `multaFgts` | incidência sobre o FGTS e sobre a multa do FGTS (a multa só com `fgts: true` e se o cálculo apura a multa) |
| `principalTributavel`, `principalNaoTributavel` | só no Cálculo Externo: percentual da base sobre o principal tributável e o não tributável (ou `false`) |

A base precisa de ao menos uma incidência (verba ou FGTS); sem ela a pensão sairia zerada e o MCP
recusa. Para descontar a pensão de um pagamento, use `recolher.pensao` no pagamento.

### Custas da execução

As custas da tela Pagamento > Custas Judiciais. O PJe-Calc as cobra do reclamado, corrigidas desde o
vencimento.

- `fixas`: custas por ato do art. 789-A da CLT, uma linha por data de `vencimento`, com a quantidade de
  cada ato: `atosUrbanos` e `atosRurais` (diligências do oficial de justiça, R$ 11,06 e R$ 22,13),
  `agravosDeInstrumento`, `agravosDePeticao`, `embargosArrematacao`, `embargosExecucao`,
  `embargosTerceiros` (R$ 44,26), `impugnacaoSentenca` e `recursoRevista` (R$ 55,35). Os valores são os
  da tabela de custas do PJe-Calc, a mesma desde 27/09/2002. Duas linhas na mesma data são recusadas:
  junte as quantidades.
- `autos`: autos de arrematação, adjudicação e remição (`tipo` `ARREMATACAO`, `ADJUDICACAO` ou `REMICAO`),
  com `vencimento` e `valor` do bem; custas de 5% do valor, até R$ 1.915,38.
- `armazenamentos`: depósito judicial de bens, com `inicio`, `fim` e `valor` do bem; custas de 0,1% do
  valor por dia, contados o primeiro e o último dia. Sem `fim`, o armazenamento corre até a data da
  atualização.
- `folha`: identificação das custas (a tela grava em maiúsculas).

As custas entram no saldo em qualquer caso. O Resumo da Atualização, porém, só as lista em "Eventos
ocorridos" quando há pagamento, honorário, multa ou pensão na mesma data ou depois; nos outros casos o
MCP avisa.

### Encargos de IRPF

`cobrarEncargosIrpf` é a caixa "Cobrar encargos de IRPF" da tela Liquidar Atualização e muda o resultado
quando o cálculo apura imposto de renda. A tela vem marcada; o MCP envia o que a especificação disser.
Com IR apurado e o campo ausente, o MCP avisa antes de importar, envia desmarcado e a verificação
"decisão sobre os encargos de IRPF" fica em alerta: o estado não chega a `calculado`. Informe sempre
`true` ou `false` conforme a decisão da execução.

### Precatório e RPV

`precatorio.tipo` `RPV` ou `PRECATORIO`, `esfera` `FEDERAL` ou `ESTADUAL_MUNICIPAL`, o período de graça
(art. 100, § 5º, da Constituição) e, quando cabível, a data a partir da qual vale a EC 136/2025
(`ec136APartirDe`). Com precatório, o relatório lido é o "Resumo da Atualização Precatório / RPV" e o
total aparece como "Total Requisitado".

## Regras conferidas antes de importar

A importação do PJe-Calc não aplica as regras da tela de pagamento. O MCP aplica antes:

| mensagem | regra |
|---|---|
| MSG0135/MSG0136 | o cálculo precisa estar liquidado e sem alteração depois da liquidação |
| MSG0125 | soma das parcelas (crédito + outros débitos + débitos do reclamante) = valor do pagamento |
| MSG0127 | pagamento ou evento anterior à data de liquidação |
| MSG0128 | pagamento ou evento em data futura |
| MSG0131 | componentes escolhidos numa parcela sem valor |
| MSG0132 | parcela com valor sem nenhum componente escolhido |
| MSG0133 | componentes informados somam mais que a parcela |
| MSG0134 | componentes informados somam menos que a parcela e nenhum é `"apurar"` |
| MSG0138 | dois pagamentos na mesma data |
| MSG0181 | honorário ou multa ligado ao pagamento com data de evento posterior à do pagamento |
| MSG0126 | pensão da execução quando o cálculo já apura pensão |
| MSG0003 | campo obrigatório: alíquota e data da pensão; vencimento das custas por ato; tipo, vencimento e valor do auto; início e valor do armazenamento |
| MSG0010 | término do armazenamento no futuro |

O MCP também recusa a linha de custas por ato sem quantidade (a tela não a guarda), duas linhas na mesma
data, o término do armazenamento antes do início e a pensão sem nenhuma incidência.

Erro em qualquer uma recusa a montagem com a mensagem do aplicativo.

## Cálculo Externo

Para a conta homologada feita fora do PJe-Calc. `calculoExterno` tem:

- `processo` (número, valor da causa, partes) e `dataBase` (data da última atualização da conta);
- `parametros`: `indice`, `juros`, `baseJuros`, FGTS (`fgtsDestino`, `indiceFgts`), `irpf` (com `meses`
  para a tributação exclusiva — art. 12-A da Lei 7.713/1988), `contribuicaoSocial` e `custas`;
- `creditos`: `verbasTributaveis`, `verbasNaoTributaveis`, `fgts`, `multaFgts` (cada um `{ valor, juros }`),
  `multasDevidasAoReclamante` e `multasDevidasAoReclamado` (listas);
- `descontos`: `contribuicaoSocialSegurado`, `corrigirDesconto`, `previdenciaPrivada`, `pensao`
  (`{ aliquota, incidirSobreJuros, principalTributavel, principalNaoTributavel, fgts }`, os dois principais em % da base;
  ao menos uma base), `custasReclamante`, `multasTerceiros`, `honorarios`; `pensaoAliquota` (só a alíquota) continua aceito;
- `outrosDebitos`: `contribuicaoSocialSegurado` e `contribuicaoSocialPatronal` (`ateFev2009` e
  `aposFev2009`, cada um `{ valor, juros }`), `multaContribuicaoSocial` (`ateFev2009` e `aposFev2009`:
  datas), `contribuicaoSocialPagos` (`{ valor, juros }`) e `multaContribuicaoSocialPagos` (data),
  `jurosPrevidenciaPrivada`, `contribuicaoSocial10` e `contribuicaoSocial05` (LC 110/2001),
  `custasConhecimento`, `custasLiquidacao` e `custasExecucao` (`{ valor, juros }`), `multasTerceiros` e
  `honorarios`;
- `debitosReclamante`: custas, multas e honorários devidos pelo reclamante (no Resumo da atualização eles saem num
  quadro próprio, `debitosDoReclamante` e `totalDevidoPeloReclamante`, fora do total devido pelo reclamado);
- `execucao` (opcional): o mesmo bloco acima, para atualizar logo em seguida.

Copie cada valor da conta homologada com a folha. Juros já incluídos vão no campo `juros` da parcela,
nunca somados ao valor. O MCP preenche as telas "Novo Cálculo Externo" e "Parcelas Atualizáveis" pela
interface. Ao salvar, o próprio PJe-Calc converte as parcelas num cálculo liquidado na data-base, e o MCP
o exporta (`CALCULO_EXTERNO_<n>_<data>.PJC`).

## Saída e conferência

`calculo_atualizar` devolve:

- `pagamentos` e `eventos` montados (honorários, multas, pensão e custas, com o valor de cada custa),
  `premissasPadrao` e `avisos`;
- `resultado`: saldo por credor, líquido do reclamante, depósito de FGTS, contribuição social, pensão
  alimentícia, custas, total devido pelo reclamado (ou total requisitado), data do saldo devedor e
  eventos considerados;
- `relatorio`: o texto do Resumo e do Demonstrativo da Atualização;
- `verificacoes`:
  - atualização até a data pedida;
  - pagamentos, honorários, multas, pensão e custas listados no Resumo, em número igual ao especificado;
  - soma do saldo por credor = total do reclamado;
  - atualização gravada no cálculo exportado;
- `estado`: `calculado` quando tudo confere;
- `arquivoExecucao` (`-EXECUCAO.PJC`, antes de liquidar a atualização) e `arquivoAtualizado`
  (`-ATUALIZADO.PJC`).

Depois, volte aos documentos:

1. Cada pagamento tem documento (guia, alvará, extrato da conta judicial) com a data e o valor.
2. A imputação (juros primeiro ou principal) segue a decisão.
3. Os honorários e as multas da execução correspondem às decisões que os fixaram, com a data do evento.
   A pensão segue o ofício ou a decisão (alíquota, base, a partir de quando); as custas, os atos
   certificados nos autos, os autos de arrematação, adjudicação ou remição e o termo de depósito.
4. O saldo final é o que a decisão manda pagar ou requisitar.

## Critério de saída

Todos os pagamentos e eventos com documento e folha, as regras do aplicativo satisfeitas, a atualização
até a data pedida, a soma por credor igual ao total e o `-ATUALIZADO.PJC` gravado.
