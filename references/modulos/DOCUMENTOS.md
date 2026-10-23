# Módulo: documentos necessários (coleta)

Carregue **sempre, antes de tudo**. O cálculo só é gerado quando os documentos que o caso exige
estão no contrato de dados e cobrem todo o período. Resultado: `contrato.documentos` (com `periodo`
e `lacunas`) e `contrato.coleta`.

## Rodadas

1. **Título** — peça a sentença inteira, os embargos, os acórdãos e a certidão de trânsito (ou a
   informação de que não houve recurso). Sem eles não se sabe o que foi deferido.
2. **Documentos de cada parcela** — com as parcelas deferidas identificadas, rode
   `calculo_documentos_necessarios` e peça o que falta. Ao receber, registre cada documento com o
   `periodo` que ele cobre e as `lacunas` (meses que não vieram, páginas ilegíveis).
3. **Complementos e perguntas** — meses faltantes, documentos ilegíveis ou contraditórios, dados que
   só o usuário responde (data de liquidação, município, dependentes, custas, aviso).

Termine cada rodada com um resumo para o usuário: o que chegou, o que falta e o que muda no cálculo
se não vier. Repita até `completa: true`.

## Matriz parcela → documentos

| requisito | quando | aceita | observação |
|---|---|---|---|
| `TITULO` | sempre | sentença | inteira, com o dispositivo |
| `DECISOES_POSTERIORES` | sempre | embargos, acórdãos, certidão de trânsito | sem recurso: certidão ou registro `INEXISTENTE` com fundamento |
| `REGISTRO` | sempre | CTPS, ficha de registro, contrato, TRCT | datas e função |
| `RESCISAO` | saída + verbas rescisórias | TRCT | o que foi pago na rescisão |
| `SALARIOS` | históricos salariais | holerites, ficha financeira | **cobertura mês a mês** de todas as bases |
| `JORNADA` | horas extras, noturno, intervalos, cartão | cartões de ponto | cobertura mês a mês do período; ou jornada fixada na decisão (premissa `CONFIRMADA` ligada à sentença/acórdão) |
| `FERIAS` | férias deferidas e contrato ≥ 12 meses | avisos e recibos de férias | períodos gozados e pagos |
| `DECIMO` | 13º deferido | recibos de 13º, holerites | o que já foi pago |
| `FGTS` | FGTS deferido | extrato analítico, guias | depósitos e base da multa |
| `CCT` | piso, norma coletiva, PLR, reajuste | convenção ou acordo coletivo | do período do contrato |
| `INSS` (desejável) | contribuição social | CNIS, holerites | bases reais |
| `ATUALIZACAO` | sempre | `correcaoJuros` com `origem` na decisão e índice informado | critério do título por fase |
| `HONORARIOS` | honorários | `honorarios[].origem` na decisão | percentual e base |

O tipo do documento é reconhecido pelo campo `tipo` (ex.: `SENTENCA`, `ACORDAO_TRT`, `TRCT`,
`HOLERITES`, `CARTOES_DE_PONTO`, `AVISO_E_RECIBO_DE_FERIAS`, `EXTRATO_FGTS`, `CCT`); se o tipo não
for reconhecido, pela `identificacao`.

## Documentos dos processos ligados e da fase

O mapa do processo (`PROCESSO.md`) acrescenta requisitos:
- `REL:<id>:<item>`: documentos de cada processo ligado, conforme a relação. Por exemplo, para ação
  anterior arquivada, a inicial e o arquivamento; para ação coletiva, a sentença, o trânsito e a
  habilitação; para acordo, o termo e a homologação.
- `FASE:<item>`: na execução, o cálculo homologado e a sentença de liquidação; na execução
  provisória, a carta de sentença.

Documentos de outro processo levam `"processo": "<id>"`. As decisões registradas daquele processo
também satisfazem o pedido de "decisões". Os documentos do processo principal (e do processo cujo
título é executado) são os únicos que valem para os requisitos do principal.

## Cobertura e lacunas

```json
{ "id": "D2", "tipo": "HOLERITES", "identificacao": "Contracheques", "paginas": "40-65",
  "periodo": { "inicio": "2013-03", "fim": "2015-04" }, "lacunas": ["2014-03", { "inicio": "2014-07", "fim": "2014-08" }] }
```

- Meses exigidos e não cobertos (fora do período ou nas lacunas) são **falha**, salvo pedido
  registrado em `coleta`.
- Registros que citam o documento (remuneração, pagamento, afastamento) precisam estar dentro do
  período dele.

## Coleta

```json
"coleta": [
  { "id": "C1", "requisito": "SALARIOS", "documento": "holerites de 03/2014", "motivo": "base de março",
    "parcelas": ["P6"], "impacto": "horas extras de 03/2014", "status": "SOLICITADO", "solicitadoEm": "2026-10-18" },
  { "id": "C2", "requisito": "DECISOES_POSTERIORES", "documento": "acórdão", "status": "INEXISTENTE",
    "fundamento": "certidão de fl. 20: não houve recurso" }
]
```

| status | efeito |
|---|---|
| `RECEBIDO` (com `recebidoComo`: id do documento) | só registro |
| `SOLICITADO`, `INCOMPLETO`, `ILEGIVEL` | pendência: incerteza `DOC:<REQUISITO>`; sem cenário é falha, num cenário precisa estar em `premissasAlteradas` ou `premissasFixas`, e o estado máximo é `simulacao` |
| `INEXISTENTE` com `fundamento` | resolvido, com alerta a revisar |
| `INEXISTENTE` sem fundamento | pendência |

## Trava

Com contrato de dados, `exigirDocumentacaoCompleta` vale `true`:
- `calculo_validar` devolve `prontoParaCalcular: false` e `pedidoDeDocumentos`;
- `calculo_criar` não gera nada e devolve o pedido.

`"exigirDocumentacaoCompleta": false` desliga a trava, mas deixa um alerta: o cálculo não pode ser
apresentado como completo.

Desconhecido não vira zero nem padrão. O que não puder ser obtido fica registrado como pendência, e o
resultado é uma simulação com a hipótese declarada.
