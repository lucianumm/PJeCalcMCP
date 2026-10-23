# Especificação JSON do cálculo (MCP do PJe-Calc 2.16.0)

O agente descreve o cálculo num JSON. O MCP transforma o JSON num arquivo `.PJC` — o formato oficial
de exportação/importação do PJe-Calc —, importa no aplicativo, executa os passos que só a interface
faz (apuração do cartão de ponto por jornadas), regera as ocorrências, devolve as pendências e grava
o arquivo final `-PRONTO.PJC`, que pode ser importado em qualquer PJe-Calc 2.16.x e liquidado direto.

Convenções:

- **Datas**: `AAAA-MM-DD` ou `DD/MM/AAAA`. **Competências**: `AAAA-MM` ou `MM/AAAA`.
- **Valores**: números (`1500.5`). **Horários**: `"HH:MM"` (ou número de horas: `8`, `7.5`).
- **Enums**: nomes das constantes do PJe-Calc (`catalogo_enums` lista todas; os principais estão abaixo).
- Nomes de verbas, reflexos, históricos e cartões são comparados sem acento e sem diferença de maiúsculas.
- Os blocos de entidade aceitam `avancado: { campoJava: valor }`: `calculo`, cada verba e cada reflexo,
  `fgts`, `contribuicaoSocial`, `irpf`, `pensaoAlimenticia`, `previdenciaPrivada`, `salarioFamilia`,
  `seguroDesemprego`, cada honorário e multa, `custas`, `correcaoJuros` e cada apuração do cartão.
  São campos crus da entidade Java, conferidos contra o modelo de campos do PJe-Calc (`catalogo_enums`;
  enums e datas convertidos). É a válvula de escape para opções da tela sem atalho aqui; coleções não passam por ele.
- **Nada é ignorado em silêncio**: campo que não existe no bloco é recusado, com a lista dos aceitos.
  Campos iniciados por `_` (`_fonte`, `_premissa`, `_folha`...) são anotações livres em qualquer bloco
  e não entram no cálculo.
- O que não for informado fica com o **padrão da tela** (os modelos foram extraídos de um cálculo
  novo criado na interface). `calculo_validar` lista em `resumo.premissasPadrao` cada decisão que ficou
  com o padrão (aviso prévio, custas, correção e juros, FGTS, contribuição social, IRPF, férias,
  ÚLTIMA REMUNERAÇÃO); com `"exigirDecisoesExplicitas": true` na raiz, a especificação é recusada
  enquanto houver alguma.

Fluxo recomendado: `calculo_modelo_json` → controles de `CONTROLES-INTERPRETACAO.md` → `catalogo_*` →
montar o JSON → `calculo_validar` (até não haver erros; ler avisos e premissas padrão) →
`calculo_criar` (opcional `liquidar_em`) → reconciliação → o usuário liquida.

---

## processo

| campo | descrição |
|---|---|
| `numero` | CNJ `NNNNNNN-DD.AAAA.J.TR.OOOO`. O dígito verificador é conferido (o PJe-Calc recusa dígito errado); `catalogo_validar_documentos` devolve o correto |
| `valorCausa`, `autuadoEm` | valor da causa e data de autuação |
| `reclamante` | `{ nome, cpf \| cnpj \| cei, pis \| pasep \| nit }` |
| `reclamado` | `{ nome, cnpj \| cpf \| cei }` |
| `advogadosReclamante`, `advogadosReclamado` | `[{ nome, oab, cpf \| cnpj }]` |

## calculo (obrigatório)

| campo | padrão | descrição |
|---|---|---|
| `uf`, `municipio` | — | local da prestação dos serviços (`catalogo_municipios`; nome sem acento serve) |
| `admissao`, `ajuizamento` | — | obrigatórias |
| `demissao` | — | ou `fim` |
| `inicio`, `fim` | admissão / demissão | período do cálculo (ex.: prescrição quinquenal manual) |
| `maiorRemuneracao`, `ultimaRemuneracao` | — | valores das bases MAIOR_REMUNERACAO / ULTIMA_REMUNERACAO |
| `historicoUltimaRemuneracao` | — | `{ criar, inss: true, fgts: false, proporcionalizarInss: true, de, ate }`. A tela cria o histórico "ÚLTIMA REMUNERAÇÃO" com o valor fixo em **todas** as competências e INSS incidindo (base de salários pagos). **Obrigatório** decidir `criar` quando houver `historicosSalariais` (`false` se eles já trazem os salários reais); `de`/`ate` limitam o período. Aviso quando coexistir com históricos reais ou cobrir mais de 12 meses sem evolução. (`criarHistoricoUltimaRemuneracao: true/false` continua aceito.) |
| `cargaHoraria` | 220 | carga horária mensal |
| `sabadoDiaUtil` | true | |
| `feriadosEstaduais`, `feriadosMunicipais` | true | considerar feriados estaduais/municipais |
| `prescricaoQuinquenal`, `prescricaoFgts` | false | |
| `limitarAvos` | false | limitar avos ao período do cálculo |
| `zerarNegativos` | false | zerar valores negativos |
| `avisoPrevio` | `{ apuracao: "APURACAO_CALCULADA", projetar: true }` | `apuracao`: NAO_APURAR \| APURACAO_CALCULADA \| APURACAO_INFORMADA (+ `prazoDias`) |
| `regime` | INTEGRAL | INTEGRAL \| PARCIAL \| INTERMITENTE. Em tempo parcial, as férias com período aquisitivo terminado antes de 11/11/2017 têm 18 dias (9 com mais de 7 faltas), como na tela |
| `tipo` | ADVOGADO | ADVOGADO \| CREDOR \| DEVEDOR \| VARA \| GABINETE |
| `indicesAcumulados` | MES_SUBSEQUENTE_AO_VENCIMENTO | MES_DO_VENCIMENTO \| MES_SUBSEQUENTE_E_MES_DO_VENCIMENTO |
| `excecoesCargaHoraria` | — | `[{ inicio, fim, cargaHoraria }]` |
| `excecoesSabado` | — | `[{ inicio, fim }]` (períodos em que sábado não é dia útil) |
| `fechamentoCartao` | `{ dia: 31 }` | dia do fechamento mensal do cartão de ponto e exceções por competência: `{ dia: 20, excecoes: [{ de: "2014-01", ate: "2014-06", dia: 25 }] }`. Muda a que mês pertence cada dia apurado |
| `pontosFacultativos` | os do cálculo novo (Carnaval, Sexta-feira Santa, Corpus Christi...) | nomes de pontos facultativos (`catalogo_feriados` tipo P) |
| `comentarios` | — | texto livre (sai no relatório) |
| `avancado` | — | campos da entidade `Calculo` |

## historicosSalariais

```json
[{ "nome": "SALÁRIO BASE", "fgts": true, "inss": true, "proporcionalizarFgts": false, "proporcionalizarInss": false,
   "variavel": false, "fgtsRecolhido": false, "inssRecolhido": false,
   "valores": [{ "de": "2013-03", "ate": "2013-12", "valor": 1500 }],
   "ocorrencias": [{ "competencia": "2014-05", "valor": 1650, "fgtsRecolhido": true, "inssRecolhido": true }] }]
```

`valores` gera uma ocorrência por mês de cada faixa; `ocorrencias` sobrescreve meses avulsos. Cada
faixa/ocorrência pode trazer `fgts`, `inss`, `fgtsRecolhido`, `inssRecolhido` próprios. Use um
histórico "SALÁRIO PAGO" para diferenças salariais (ver `valorPago` calculado).

## faltas

`[{ "inicio", "fim", "justificada": false, "reiniciaPeriodoAquisitivo": false, "justificativa", "origem" }]`

Com contrato, cada falta aponta (`origem`) para o evento em `contrato.afastamentos`.

## ferias

Os períodos aquisitivos completos são gerados como na interface: o prazo é reduzido pelas faltas
injustificadas (art. 130 da CLT); concessivo vencido até a demissão = GOZADAS, com o gozo nos últimos
dias do concessivo; senão INDENIZADAS. Ajuste por período:

```json
{ "prazoProporcionais": null,
  "periodos": [{ "relativa": "2013/2014", "situacao": "INDENIZADAS", "prazo": 30, "dobra": false,
                 "abono": false, "diasAbono": 10, "gozos": [{ "inicio": "2015-01-30", "fim": "2015-02-28", "dobra": false }] }] }
```

`situacao`: GOZADAS \| GOZADAS_PARCIALMENTE \| NAO_GOZADAS \| INDENIZADAS \| PERDIDAS (até 3 `gozos`).
Em GOZADAS, os gozos têm de somar o prazo menos os dias de abono (a tela recusa outra soma); sem `gozos`, o
gozo padrão termina no fim do concessivo e já desconta o abono.
`gerar: false` não cria férias. `calculo_validar` mostra os períodos gerados no resumo. Com contrato,
período com gozo aponta (`origem`) para o evento `FERIAS` em `contrato.afastamentos`; o gozo presumido
pela regra automática fica como alerta até ser confirmado em `ferias.periodos`.

## Cartão de ponto — duas formas (exclusivas entre si)

O PJe-Calc só oferece "Apurar Cartão de Ponto" enquanto o cálculo não tem cartões; por isso use
**uma** das formas.

### cartoesDePonto — quantidades mensais já apuradas

```json
[{ "nome": "QT. H. EXT", "valores": [{ "de": "2013-03", "ate": "2013-12", "valor": 20 }],
   "ocorrencias": [{ "competencia": "2013-04", "valor": 12.5 }] }]
```

Equivale a Cartão de Ponto > Visualizar Cartão > Importar (CSV). As verbas usam a coluna em
`quantidade: { "cartao": "QT. H. EXT" }` (ou `divisor: { "cartao": ... }`).

### apuracaoCartaoPonto — jornadas (o PJe-Calc apura horas extras, noturnas, intervalos...)

Objeto ou lista de objetos (um por período, sem sobreposição). Exemplo (programação semanal):

```json
{ "inicio": "2013-03-01", "fim": "2015-04-15",
  "criterio": "HORAS_EXTRAS_EXCEDENTES_DA_JORNADA_DIARIA",
  "jornadaDiaria": { "segundaASexta": "08:00", "sabado": "04:00" },
  "programacao": { "segundaASexta": ["07:00-12:00", "13:00-18:00"], "sabado": ["08:00-12:00"] },
  "jornadas": [{ "data": "2014-05-10", "turnos": ["08:00-16:00"] }] }
```

| campo | padrão | descrição |
|---|---|---|
| `inicio`, `fim` | — | período da apuração (dentro do período do cálculo) |
| `criterio` | HORAS_EXTRAS_EXCEDENTES_DA_JORNADA_DIARIA | NAO_APURAR_HORAS_EXTRAS \| HORAS_EXTRAS_PELO_CRITERIO_MAIS_FAVORAVEL \| HORAS_EXTRAS_CONFORME_SUMULA_85 \| APURA_PRIMEIRAS_HORAS_EXTRAS_SEPARADO \| HORAS_EXTRAS_EXCEDENTES_DA_JORNADA_SEMANAL \| HORAS_EXTRAS_EXCEDENTES_DA_JORNADA_MENSAL |
| `jornadaDiaria` | carga/30 por dia (08:00 com 220 h); sábado igual se `sabadoDiaUtil`, senão 00:00; domingo 00:00 | `{ segunda, terca, quarta, quinta, sexta, sabado, domingo, segundaASexta }` |
| `jornadaSemanal`, `jornadaMensal` | carga × 6/30 (5/30 sem sábado útil) e semanal × 30/7 | em horas |
| `limiteSumula85`, `primeirasHorasExtras` | "02:00" | limites dos critérios Súmula 85 / primeiras horas em separado |
| `preenchimento` | conforme o que vier: `escala` → ESCALA, `programacao` → PROGRAMACAO, senão LIVRE | |
| `programacao` | — | turnos por dia: `segunda`...`domingo`, `segundaASexta`, `feriados`; cada dia = lista de `"HH:MM-HH:MM"` ou `{ entrada, saida }` (até 6) |
| `escala` | — | `{ tipo, inicio }` para DOZE_POR_DOZE, DOZE_POR_VINTE_QUATRO, DOZE_POR_TRINTA_E_SEIS, DOZE_POR_QUARENTA_E_OITO (o ciclo é montado como na tela a partir do horário de início); `{ tipo, ciclo: [[turnos], [], ...] }` para CINCO_POR_UM (6 dias), SEIS_POR_UM (7), OITO_DOIS (10) ou OUTRA (qualquer tamanho); `[]` = folga. Nas escalas 5x1 e 6x1 o último dia e na 8x2 os dois últimos são folga (a tela os bloqueia) |
| `jornadas` | — | lançamentos dia a dia `[{ data, turnos }]` (cartões de ponto do processo). No modo LIVRE são a fonte da apuração; nos outros modos substituem a programação/escala naquele dia |
| `considerarFeriados` | true | |
| `tolerancia` | desligada | `{ porTurno: "00:05", porDia: "00:10" }` (art. 58 §1º) |
| `horarioNoturno` | ATIVIDADE_URBANA | ATIVIDADE_AGRICOLA \| ATIVIDADE_PECUARIA |
| `apurarHorasNoturnas`, `apurarHorasExtrasNoturnas` | false | |
| `reducaoFicta` | true | hora noturna reduzida |
| `prorrogacaoSumula60`, `forcarProrrogacao` | false | prorrogação do horário noturno |
| `extraDescansoSeparado`, `extraFeriadoSeparado`, `extraSabadoDomingoSeparado` | false | extras em repousos/feriados em coluna própria |
| `apurarFeriadosTrabalhados`, `apurarSabadosDomingosTrabalhados`, `apurarDomingosTrabalhados` | false | |
| `jornadaDiariaFeriadoTrabalhado`, `jornadaDiariaFeriadoNaoTrabalhado` | false | |
| `intervaloIntrajornada` | desligado | `{ acimaDe4ate6: "00:15", acimaDe6: "01:00", tolerancia: "00:05", supressaoIntegral, supressaoReforma, fracionamento, excessoMaximo: "02:00", apenasExcessoAcimaJornada }` (um campo com horário liga a apuração) |
| `intervaloInterjornadas` | desligado | `{ entreJornadas: "11:00", entreSemanas: "35:00" }` (art. 66/67) |
| `art253` | desligado | `{ trabalho: "01:40", descanso: "00:20" }` (câmaras frias) |
| `art384`, `art72` | false | intervalos do art. 384 e do art. 72 |
| `avancado` | — | qualquer campo de `ApuracaoCartaoDePonto` |

O arquivo leva os critérios, a programação/escala e as jornadas manuais. Depois de importar, o MCP faz
o que a tela faz: **Cartão de Ponto > Alterar > Salvar** (o PJe-Calc gera as jornadas de todos os
dias, respeitando feriados, férias e faltas, e preserva as manuais) e **Visualizar Cartão > Apurar
Cartão de Ponto**, que cria as colunas mensais. Colunas possíveis (`catalogo_cartao_ponto`):
Hs Trabalhadas, Hs EXT, Dias Trabalhados, Hs Ext Diárias, Hs Ext Semanais, Hs Ext Mensais,
Hs Diurnas, Hs Noturnas, Hs Ext Noturnas, Hs Noturnas (-) Hs Ext Noturnas, Adicional Súmula 85,
Primeiras Hs Ext em Separado, Hs Ext Diárias em Repousos, Hs Ext Noturnas em Repousos,
Hs Ext Diárias em Feriados, Hs Ext Noturnas em Feriados, Hs Ext em Repousos e Feriados,
Hs Intrajornada, Exc Int Intrajornada, Hs Interjornadas, Hs Insalubres (art. 253), Hs Art 72,
Hs Art 384, Repousos Trabalhados, Feriados Trabalhados, Feriados e Repousos Trabalhados.

A verba usa a coluna pelo nome (ou pela constante, ex.: `HORAS_NOTURNAS`):
`"quantidade": { "cartao": "Hs EXT" }`. Como a coluna só existe depois da apuração, o vínculo é
feito pelo MCP logo após "Apurar" (o `.PJC` gerado vem acompanhado de `<arquivo>.mcp.json` com esses
passos; `calculo_importar_pjc` os executa). Exemplos: `exemplos/calculo-cartao-ponto.json`,
`exemplos/calculo-cartao-ponto-escala.json`.

## verbas

Cada item parte de uma verba do **catálogo Expresso** do PJe-Calc (`catalogo_verbas`), que já traz
característica, ocorrência de pagamento, incidências, base, divisor, multiplicador e os reflexos.

O catálogo muda quando o PJe-Calc sincroniza as tabelas (incidências, parcela fixa ou variável e até nomes
de verbas). Por isso o `calculo_criar` e o `tabelas_atualizar` refazem a biblioteca de verbas a partir do
PJe-Calc do usuário na primeira vez e depois de cada sincronização que trouxe tabelas novas; a saída traz
`bibliotecaDeVerbas` quando isso acontece. `modelos_atualizar` com `"verbas"` força a atualização.

| campo | descrição |
|---|---|
| `verba` | nome exato do catálogo (ex.: `"HORAS EXTRAS 50%"`) |
| `nome`, `descricao` | renomeia (para lançar a mesma verba duas vezes; os reflexos acompanham) |
| `periodo` | `{ inicio, fim }` (padrão: período do cálculo) |
| `data` | verba lançada uma única vez (ex.: dano moral na data do arbitramento) — substitui `periodo` |
| `base` | `{ tipo, historicos, proporcionalizar, verbas, integralizar, piso, valesTransporte }` — `tipo`: HISTORICO_SALARIAL \| MAIOR_REMUNERACAO \| ULTIMA_REMUNERACAO \| SALARIO_MINIMO \| SALARIO_DA_CATEGORIA (com `piso`: id da tabela Pisos Salariais) \| VALE_TRANSPORTE (com `valesTransporte`: ids da tabela Vale-transporte) — ids em `catalogo_pisos_vt`; com histórico, sem `historicos` usa o primeiro (aviso); `verbas`: base composta por outras verbas **listadas antes** (`["SALÁRIO", { "nome": "X", "integralizar": false }]`) |
| `divisor` | número, ou `{ tipo: CARGA_HORARIA \| DIAS_UTEIS \| OUTRO_VALOR \| IMPORTADA_DO_CARTAO, valor, cartao }` |
| `multiplicador` | ex.: `1.5` (HE 50%), `0.1` (10%) |
| `quantidade` | número, ou `{ tipo: INFORMADA \| AVOS \| APURADA \| IMPORTADA_DO_CALENDARIO \| IMPORTADA_DO_CARTAO, valor, proporcionalizar, calendario: DIAS_UTEIS \| REPOUSOS \| FERIADOS \| REPOUSOS_FERIADOS, cartao }` — **horas extras do catálogo vêm com quantidade 0** |
| `valor` | verbas de valor informado (dano moral, PLR, acordo...) |
| `proporcionalizar` | caixa "proporcionalizar" do valor devido (vem marcada no catálogo; desmarque em indenizações) |
| `valorPago` | número, `{ tipo: "INFORMADO", valor, proporcionalizar }` ou `{ tipo: "CALCULADO", historicos: ["SALÁRIO PAGO"], proporcionalizar, base, piso, valesTransporte }` — diferenças salariais: devido pela base, pago pelo histórico (ou pelo piso) |
| `ocorrencias` | valores mês a mês nas ocorrências geradas pelo PJe-Calc (ver "Valores mês a mês") |
| `incidencias` | `{ inss, irpf, fgts, previdenciaPrivada, pensaoAlimenticia }` |
| `caracteristica` | COMUM \| DECIMO_TERCEIRO_SALARIO \| AVISO_PREVIO \| FERIAS |
| `ocorrenciaDePagamento` | DESLIGAMENTO \| DEZEMBRO \| MENSAL \| PERIODO_AQUISITIVO |
| `jurosDoAjuizamento` | OCORRENCIAS_VENCIDAS_E_VINCENDAS \| OCORRENCIAS_VENCIDAS |
| `gerarPrincipal`, `gerarReflexo` | DEVIDO \| DIFERENCA |
| `comporPrincipal`, `zerarNegativo`, `excluirFaltasJustificadas`, `excluirFaltasNaoJustificadas`, `excluirFeriasGozadas`, `dobra`, `variavel` | booleanos |
| `assuntoCnj`, `comentarios` | código CNJ (`catalogo_assuntos_cnj`) e observação |
| `reflexos` | `"todos"` ou lista de nomes (ex.: `"13º SALÁRIO SOBRE HORAS EXTRAS 50%"`, ou sem o "SOBRE ..."); item pode ser `{ nome, comportamento: VALOR_MENSAL \| MEDIA_PELA_QUANTIDADE \| MEDIA_PELO_VALOR \| MEDIA_PELO_VALOR_CORRIGIDO, periodoMedia, fracaoDeMes: MANTER \| INTEGRALIZAR \| DESPREZAR \| DESPREZAR_MENOR_QUE_15_DIAS, periodo, proporcionalizar, incidencias, caracteristica, ocorrenciaDePagamento, jurosDoAjuizamento, gerarPrincipal, gerarReflexo, comporPrincipal, zerarNegativo, excluirFaltasJustificadas, excluirFaltasNaoJustificadas, excluirFeriasGozadas, variavel, comentarios, assuntoCnj, valorPago, ocorrencias, avancado }` — todos aplicados ao reflexo (característica e exclusões mudam a média e a base previdenciária) |
| `personalizada` | verba fora do catálogo: `{ modelo: "DIFERENÇA SALARIAL" \| "INDENIZAÇÃO POR DANO MORAL" \| outra do catálogo, nome, descricao, assuntoCnj, ...mesmos campos acima }` |
| `avancado` | campos da entidade da verba (`Calculada` / `Informada`) |

Regra da tela: com base "Histórico Salarial", a proporcionalidade fica no **vínculo** verba↔histórico
(vale `base.proporcionalizar`, ou a caixa da verba), e a da base tabelada é gravada como falsa.

A ocorrência de pagamento precisa caber no período da verba, senão o PJe-Calc não gera nada; o validador
recusa antes de importar:
- `DEZEMBRO` (13º) sem nenhum dezembro no período e sem chegar à demissão;
- `DESLIGAMENTO` com o período terminando antes do mês da demissão (o PJe-Calc recusa regerar);
- `PERIODO_AQUISITIVO` (férias) num período que não fecha aquisitivo nem chega à demissão;
- `data` única com quantidade em avos (um dia não completa os 15 dias do mês).

Para avos deferidos pelo título num mês certo (ex.: 13º proporcional 5/12 e férias 8/12 do período sem
registro, com vencimento no fim desse período), use `"ocorrenciaDePagamento": "MENSAL"`, um `periodo`
dentro do mês do vencimento e `"quantidade": { "tipo": "INFORMADA", "valor": <avos> }`; a conferência
compara os avos com o informado, não com o contrato inteiro.

Pago maior que o devido num mês: sem `zerarNegativo`, a diferença negativa abate os outros meses
(dedução global, OJ 415 da SBDI-1); a conferência avisa. Se o título manda deduzir mês a mês, use
`"zerarNegativo": true` na verba.

Piso salarial e vale-transporte usam as tabelas do PJe-Calc do usuário (Tabelas > Pisos Salariais /
Vale-transporte), que precisam ser do mesmo estado (e município, no vale-transporte) do cálculo. Se a
tabela não existir, informe o piso da norma coletiva num histórico salarial, com a origem na cláusula.

### Valores mês a mês (`ocorrencias`)

Para o que o PJe-Calc não gera sozinho: o pago de cada contracheque, a quantidade apurada num mês, um
devido informado, uma ocorrência desativada. Em `verbas[]` e nos reflexos:

```json
"ocorrencias": [
  { "competencia": "2013-03", "pago": 20, "origem": "D7" },
  { "competencia": "2014-06", "quantidade": 30 },
  { "aquisitivo": "2013/2014", "indenizadas": true, "ativo": false }
]
```

- seletor: `competencia` (AAAA-MM), `data` (AAAA-MM-DD) ou `aquisitivo` (AAAA/AAAA, férias), com
  `indenizadas` quando dois períodos coincidem. Um seletor que casa com mais de uma ocorrência é recusado
  com a lista das ocorrências geradas;
- campos: `pago`, `quantidade`, `devido` (passa o valor a INFORMADO), `divisor`, `multiplicador`,
  `dobra`, `ativo`.

As ocorrências só existem depois que o PJe-Calc regera a verba. O MCP importa, regera, exporta, aplica as
edições, reimporta e regera mantendo as alterações (o próprio PJe-Calc preserva os campos alterados). A
saída traz `conferenciaEdicoes` com cada edição encontrada no cálculo final; a liquidação de teste
confere de novo.

## fgts

`{ destino: DEPOSITAR | PAGAR, aliquota: 8 | 2, multa: true, percentualMulta: 40 | 20, valorMultaInformado,
incidenciaMulta: SOBRE_O_TOTAL_DEVIDO | SOBRE_DEPOSITADO_SACADO | SOBRE_DIFERENCA | SOBRE_TOTAL_DEVIDO_MAIS_SAQUE_E_OU_SALDO | SOBRE_TOTAL_DEVIDO_MENOS_SAQUE_E_OU_SALDO,
excluirAvisoDaMulta, multaArt467, multa10, contribuicaoSocial05, incidenciaPensaoAlimenticia, comporPrincipal,
periodo: { inicio, fim }, operacoes: [{ data, valor, tipo: DEPOSITO | SAQUE }], deduzir: true, ocorrencias, avancado }`

`operacoes` = depósitos/saques já feitos (deduzidos do FGTS devido quando `deduzir`).

### Ocorrências do FGTS (`fgts.ocorrencias`)

O que se ajusta na tela FGTS > Ocorrências, por competência ou em lote:

```json
"ocorrencias": [
  { "competencia": "2014-03", "base": 1234.56 },
  { "competencia": "2014-04", "depositado": 50 },
  { "de": "2014-06", "ate": "2014-08", "depositado": 100 },
  { "competencia": "2014-05", "aliquota": 2 }
]
```

- seletor: `competencia` (AAAA-MM) ou o intervalo `de`/`ate`, que é a alteração em lote da tela. As
  competências ficam dentro de `fgts.periodo`;
- `base`: Base (Histórico), no lugar da soma dos históricos salariais com FGTS;
- `depositado`: o valor recolhido na competência, que é deduzido do devido;
- `aliquota`: 2 ou 8 (%) só naquela competência;
- `origem` (opcional, anotação): o documento ou pagamento do contrato que prova o valor.

Cada campo informado fica marcado como "Informado", como na tela. As edições valem na ordem: um
item posterior sobrepõe um anterior na mesma competência.

A tela não edita a alíquota de uma competência: ela só regera todas com uma alíquota. Um novo
Regerar do FGTS na tela, mesmo "mantendo alterações", devolve a alíquota geral; a base e o depositado
informados são mantidos.

### Como o MCP aplica as ocorrências do FGTS e da contribuição social

O Regerar das verbas não cria essas ocorrências; o PJe-Calc só as cria na tela de cada módulo ou na
liquidação. Depois de importar e regerar as verbas, o MCP faz assim:

1. FGTS (ou Contribuição Social) > Ocorrências > Regerar > Confirmar;
2. exporta o cálculo e aplica as edições, sem tocar na cópia original de cada ocorrência;
3. reimporta, exclui o cálculo intermediário e regera só as verbas, "mantendo alterações".

A saída traz `conferenciaEncargos`: cada campo editado encontrado no cálculo final e marcado como
informado. A liquidação de teste confere de novo no cálculo liquidado. Depois disso, não regere o
FGTS nem a contribuição social na tela.

## contribuicaoSocial (INSS)

| campo | descrição |
|---|---|
| `apurarSegurado`, `cobrarDoReclamante`, `corrigirDescontoReclamante`, `limitarTeto`, `apurarSobreSalariosPagos` | booleanos |
| `tipoAliquotaSegurado` | SEGURADO_EMPREGADO \| EMPREGADO_DOMESTICO \| FIXA (+ `aliquotaSeguradoFixa`) |
| `tipoAliquotaEmpregador` | FIXA (+ `aliquotaEmpresa`, `aliquotaRat`, `aliquotaTerceiros`) \| POR_PERIODO \| POR_ATIVIDADE_ECONOMICA |
| `aliquotasPorPeriodo` | `[{ de, ate, empresa, rat, terceiros }]` (competências) — liga POR_PERIODO |
| `periodosSimples` | `[{ de, ate }]` — períodos de opção pelo Simples (sem cota patronal) |
| `atividadeEconomica` | id ou descrição (`catalogo_atividades`) — liga POR_ATIVIDADE_ECONOMICA; `apurarEmpresaPorAtividade`, `apurarRatPorAtividade`, `apurarTerceirosPorAtividade` (padrões da tela: Empresa e SAT true, Terceiros false) |
| `ocorrencias` | `{ salariosDevidos: [...], salariosPagos: [...] }` — as abas da tela Contribuição Social > Ocorrências (abaixo) |
| `avancado` | campos de `Inss` |

### Ocorrências da contribuição social (`contribuicaoSocial.ocorrencias`)

```json
"ocorrencias": {
  "salariosDevidos": [
    { "competencia": "2014-03", "base": 999.99 },
    { "competencia": "2014-12", "decimoTerceiro": true, "base": 777 },
    { "de": "2015-01", "ate": "2015-03", "base": 1200 }
  ],
  "salariosPagos": [
    { "competencia": "2014-03", "base": 1500, "recolhidoSegurado": 111, "recolhidoEmpresa": 222, "recolhidoSat": 33, "recolhidoTerceiros": 44 },
    { "de": "2014-09", "ate": "2014-10", "recolhidoSegurado": 150 }
  ]
}
```

- seletor como no FGTS: `competencia` ou o lote `de`/`ate`, dentro do período do cálculo;
- 13º salário:
  - o 13º tem ocorrência própria;
  - `competencia` sozinha pega a do mês; para pegar a do 13º, use `decimoTerceiro: true`;
  - o lote pega também o 13º dos meses do intervalo, como na tela; `decimoTerceiro` restringe a um
    dos dois.
- `salariosDevidos`:
  - `base` é "Salários Pagos (Histórico)": o salário já pago no mês, que ocupa a faixa e o teto do
    segurado.
- `salariosPagos` (exige `apurarSobreSalariosPagos: true`):
  - `base`;
  - as contribuições já recolhidas no mês: `recolhidoSegurado`, `recolhidoEmpresa`, `recolhidoSat`,
    `recolhidoTerceiros`.

O MCP aplica e confere como no FGTS (seção acima). O Regerar da contribuição social "mantendo
alterações" preserva as bases e os recolhimentos informados.

## irpf

`{ apurar: true, incidirSobreJuros, cobrarDoReclamado, tributacaoExclusiva, tributacaoEmSeparado, regimeDeCaixa,
deduzirContribuicaoSocial, deduzirPrevidenciaPrivada, deduzirPensaoAlimenticia, deduzirHonorarios,
aposentadoMaior65, dependentes, avancado }`

## pensaoAlimenticia

`{ apurar: true, aliquota, incidirSobreJuros, avancado }` — o PJe-Calc exige a incidência de pensão em
ao menos uma verba (`incidencias.pensaoAlimenticia`) ou no FGTS; o validador recusa sem isso.

## previdenciaPrivada

`{ apurar: true, aliquota }` (todo o período) ou `{ apurar: true, aliquotas: [{ de, ate, aliquota }] }`.
Marque `incidencias.previdenciaPrivada` nas verbas (aviso se nenhuma tiver).

## salarioFamilia

`{ apurar: true, filhos, inicio, fim, variacoes: [{ aPartirDe, filhos }], tipoSalarioPago: NENHUM | ULTIMA_REMUNERACAO | MAIOR_REMUNERACAO | HISTORICO_SALARIAL,
historicos: ["SALÁRIO BASE"], verbas: ["..."], comporPrincipal, avancado }`

## seguroDesemprego

`{ apurar: true, solicitacao: PRIMEIRA | SEGUNDA | DEMAIS, parcelas, valor (informado; sem ele é calculado),
empregadoDomestico, tipoSalarioPago, historicos, verbas, comporPrincipal, avancado }`

## honorarios

`[{ tipo, descricao, devedor: RECLAMADO | RECLAMANTE, credor: { nome, cpf | cnpj }, percentual, base, valor, dataVencimento,
apurarIrrf, tipoImpostoRenda, irSobreJuros, indiceCorrecao, aplicarJuros, jurosAPartirDe, cobrancaReclamante: DESCONTAR_CREDITO | COBRAR, avancado }]`

- `irSobreJuros`: o IR do honorário incide também sobre os juros (só com `apurarIrrf`)

- `tipo`: SUCUMBENCIAIS \| ADVOCATICIOS \| CONTRATUAIS \| ASSISTENCIAIS \| PERICIAIS_CONTADOR \| PERICIAIS_DOCUMENTOSCOPIO \| PERICIAIS_ENGENHEIRO \| PERICIAIS_INTERPRETE \| PERICIAIS_MEDICO \| PERICIAIS_OUTROS \| LEILOEIRO
- calculado: `percentual` + `base` (BRUTO \| BRUTO_MENOS_CONTRIBUICAO_SOCIAL \| BRUTO_MENOS_CONTRIBUICAO_SOCIAL_MENOS_PREVIDENCIA_PRIVADA \| VERBAS_QUE_NAO_COMPOE_O_PRINCIPAL); informado: `valor` + `dataVencimento`
- sobre verbas escolhidas: `verbas: ["MULTA DO ARTIGO 477 DA CLT", ...]` com base
  VERBAS_QUE_NAO_COMPOE_O_PRINCIPAL (padrão quando há `verbas`). Como na tela, só entram verbas ou
  reflexos com `comporPrincipal: false`; a liquidação de teste confere base × percentual.

## multas

`[{ descricao, credorDevedor: RECLAMANTE_RECLAMADO | RECLAMADO_RECLAMANTE | TERCEIRO_RECLAMANTE | TERCEIRO_RECLAMADO, nomeTerceiro,
percentual, base: PRINCIPAL | PRINCIPAL_MENOS_CONTRIBUICAO_SOCIAL | PRINCIPAL_MENOS_CONTRIBUICAO_SOCIAL_MENOS_PREVIDENCIA_PRIVADA | VALOR_CAUSA,
valor, dataVencimento, indiceCorrecao, aplicarJuros, jurosAPartirDe, avancado }]` — `percentual` (calculada) ou `valor` + `dataVencimento` (informada).

## custas

`{ base: BRUTO_DEVIDO_AO_RECLAMANTE | BRUTO_DEVIDO_AO_RECLAMANTE_MAIS_DEBITOS_RECLAMADO,
reclamado: { tipo: CALCULADA_2_POR_CENTO | INFORMADA | NAO_SE_APLICA, valor, vencimento },
reclamante: { ...mesmo formato },
liquidacao: { tipo: CALCULADA_MEIO_POR_CENTO | INFORMADA | NAO_SE_APLICA, valor, vencimento },
cobrancaReclamante, fixas, autos, armazenamentos, avancado }`

`INFORMADA` exige `valor` e `vencimento` (a tela recusa sem o vencimento).

Custas fixas, autos e armazenamento (tela Custas Judiciais, aba Custas Devidas):

```json
"fixas": { "vencimento": "2016-05-10", "atosUrbanos": 2, "atosRurais": 0, "agravosDeInstrumento": 1,
  "agravosDePeticao": 0, "impugnacaoSentenca": 0, "embargosArrematacao": 0, "embargosExecucao": 1,
  "embargosTerceiros": 0, "recursoRevista": 1 },
"autos": [{ "tipo": "ARREMATACAO", "vencimento": "2016-05-10", "valor": 20000 }],
"armazenamentos": [{ "inicio": "2016-01-11", "fim": "2016-03-10", "valor": 5000 }]
```

- `fixas`:
  - quantidades (inteiros de 0 a 999) de atos dos oficiais de justiça (zona urbana e rural),
    agravos de instrumento e de petição, impugnação à sentença de liquidação, embargos (à
    arrematação, à execução, de terceiros) e recurso de revista;
  - o valor unitário de cada um vem da tabela de custas do PJe-Calc na data de `vencimento`, que é
    obrigatória quando há quantidade.
- `autos`:
  - `tipo`: REMICAO, ADJUDICACAO ou ARREMATACAO;
  - `vencimento` e `valor` do bem;
  - custas = 5% do valor, limitadas ao teto da tabela.
- `armazenamentos`:
  - `inicio`, `fim` (opcional; sem ele, conta até a liquidação) e `valor` do bem;
  - custas = 0,1% do valor por dia.
- Datas como a tela aceita: a partir do ajuizamento e até hoje.
- Esses campos vão direto no `.PJC`, sem passo depois da importação. A liquidação de teste confere
  quantidades, datas e avaliações e refaz a conta de autos e armazenamentos.

## correcaoJuros

`{ indice, combinacoesIndice: [{ indice, aPartirDe: "ajuizamento" | data }], juros, jurosFasePreJudicial,
combinacoesJuros: [{ juros, aPartirDe }], baseJuros: VERBAS | VERBA_INSS | VERBA_INSS_PP,
indiceFgts: UTILIZAR_INDICE_TRABALHISTA | UTILIZAR_INDICE_JAM | UTILIZAR_INDICE_JAM_E_TRABALHISTA, ignorarTaxaNegativa, avancado }`

- `indice`: INDICE_TRABALHISTA, TUACDT, TABELA_DEVEDOR_FAZENDA, TABELA_INDEBITO_TRIBUTARIO, TABELA_UNICA_JT_MENSAL, TABELA_UNICA_JT_DIARIO, TR, IGPM, INPC, IPC, IPCA, IPCAE, IPCAETR, JAM, SELIC, SELIC_FAZENDA, SELIC_BACEN, SEM_CORRECAO
- `juros`: JUROS_PADRAO, JUROS_POUPANCA, FAZENDA_PUBLICA, JUROS_MEIO_PORCENTO, JUROS_UM_PORCENTO, JUROS_ZERO_TRINTA_TRES, JUROS_DOIS_AA, JUROS_PRECATORIO_EC_136_2025, SELIC, SELIC_FAZENDA, SELIC_BACEN, TRD_SIMPLES, TRD_COMPOSTOS, TAXA_LEGAL, SEM_JUROS

Padrão do PJe-Calc 2.16 para cálculo novo: IPCA-E, juros TRD simples na fase pré-judicial e "sem
juros" a partir do ajuizamento. Configure conforme a decisão — ex. ADC 58/59 (IPCA-E até o
ajuizamento e SELIC depois): `"indice": "IPCAE", "combinacoesIndice": [{ "indice": "SELIC", "aPartirDe": "ajuizamento" }]`.

Aba "Dados Específicos" (todos opcionais; o que faltar fica como na tela):

- `jurosFgtsComJam`: juros do FGTS junto com o JAM.
- `previdenciaPrivada: { juros, indice }` e `custas: { correcao, juros, indice }`: `indice` é
  `"trabalhista"` (o índice do cálculo) ou um índice da lista acima ("utilizar outro índice").
- `contribuicaoSocial: { salariosDevidos: {...}, salariosPagos: {...} }`, cada um com `lei11941`,
  `lei11941APartirDe`, `limitarMulta`, `limitarMultaAPartirDe`, `correcaoTrabalhista`, `jurosTrabalhistas`,
  `aplicarAte` (obrigatório com correção trabalhista e previdenciária juntas, como na tela),
  `correcaoPrevidenciaria`, `jurosPrevidenciarios`, `formaAplicacao` (MES_A_MES | A_PARTIR_DE), `multa`,
  `tipoMulta` (URBANA | RURAL) e `pagamentoMulta` (INTEGRAL | REDUZIDO). Sem a Lei 11.941 a tela
  desmarca "limitar multa"; o gerador faz o mesmo.

Ex.: `"contribuicaoSocial": { "salariosDevidos": { "lei11941": false, "correcaoTrabalhista": true, "jurosTrabalhistas": true,
"aplicarAte": "2015-12-31", "correcaoPrevidenciaria": true, "jurosPrevidenciarios": true, "multa": true, "tipoMulta": "RURAL",
"pagamentoMulta": "REDUZIDO" } }`.

---

## contrato, origem e cenário (auditoria)

- `contrato` (raiz): documentos, decisões, parcelas, afastamentos (eventos), remunerações, pagamentos,
  premissas, `zerosJustificados`, `revisoesDeAlerta` e `referencia` — formato completo em
  `CONTRATO-DE-DADOS.md`.
- `origem`: ids do contrato em `verbas[]` (e `personalizada` e reflexos em objeto), `valorPago`,
  `fgts.operacoes[]`, `historicosSalariais[]`, `faltas[]`, `ferias.periodos[]`, `honorarios[]` e
  `multas[]`. O cálculo ignora esse campo; a auditoria o confere.
- `cenario` (raiz): `{ nome, descricao, premissasAlteradas: [{ id, valor, descricao }], premissasFixas:
  [{ id, motivo }], pendencias, hipoteses }`. Cada incerteza aberta precisa estar variada ou fixada com
  motivo (senão é falha); as cobertas viram alerta, a saída leva `cenario: true` e o estado máximo é
  `simulacao`.
- `exigirContrato: true` torna a falta do contrato uma falha.
- `exigirDocumentacaoCompleta` (padrão `true` com contrato): documentos obrigatórios do caso precisam
  estar em `contrato.documentos`, cobrindo todos os meses (`periodo`, `lacunas`), ou pedidos em
  `contrato.coleta` — ver `modulos/DOCUMENTOS.md`. `false` desliga a trava e deixa um alerta.
- `correcaoJuros.origem` e `honorarios[].origem`: a decisão que fixa o critério de atualização e os
  honorários. `correcaoJuros.precedentes`: os precedentes aplicados quando o título é omisso
  (`PRECEDENTES.md`).
- Mapa do processo, decisões por capítulo e aprovação do plano: campos em `CONTRATO-DE-DADOS.md`.
  Com contrato de dados, `calculo_validar` só dá `prontoParaCalcular: true` com a auditoria sem
  falhas e o plano aprovado (`bloqueiosParaCalcular` lista o que falta).

`calculo_validar` devolve `auditoria { aprovada, falhas, alertas, naoVerificados, verificacoes[],
documentacao { requisitos[], perguntas[], pedido, completa, bloqueia } }` e `prontoParaCalcular`
(com `pedidoDeDocumentos` quando falta documento). `calculo_criar` não gera nada enquanto
`prontoParaCalcular` for `false`.

`calculo_criar` devolve:
- `estado`: `rascunho`, `aceito_pelo_aplicativo`, `calculado`, `simulacao` ou `auditado`; `provisorio`
  quando há capítulo sem trânsito;
- `dimensoes`: `processo`, `titulo`, `documentacao`, `leitura`, `aprovacao`, `transferencia`, `aritmetica`,
  `completude` (`ok`, `ok_com_alertas`, `falha`, `pendente` ou `nao_verificado`) e
  `revisaoInterpretativa` (sempre humana);
- `bloqueiosDeEntrega[]`, `verificacoes[]`, `alertasSemRevisao` e `revisadoParaEntrega: false`;
- `registro`: o caminho do `.registro.json`, com versões, especificação e saídas;
- `arquivoLiquidado`: o `-LIQUIDADO.PJC`.
- `relatorioCompleto`: `{ arquivo, secoes }` do `-RELATORIO.pdf`, o relatório do PJe-Calc com as seções que se
  aplicam ao cálculo (resumo, dados, faltas e férias, histórico, cartão de ponto mensal e diário quando há
  cartões, demonstrativo das verbas com base, divisor, multiplicador e quantidade, juros, FGTS, contribuição
  social, eSocial, IR, multas, honorários, custas e justificativa). `calculo_relatorio` gera o mesmo relatório
  de um cálculo já liquidado.

## execucao (fase de execução)

Bloco opcional na raiz: com ele, `calculo_criar` liquida, grava os pagamentos e eventos da execução numa
cópia, roda "Liquidar Atualização" e devolve `execucao` com o Resumo da Atualização. Exige `liquidar_em`.
Para um cálculo homologado já existente, use `calculo_atualizar`; para uma conta feita fora do PJe-Calc,
`calculo_externo_criar`. Formato completo em `modulos/EXECUCAO.md`:

```json
"execucao": { "dataAtualizacao": "2016-08-31", "pagamentos": [{ "data": "2016-07-15", "valor": 10000,
  "folha": "fl. 300", "priorizarJuros": true, "credito": { "principal": "apurar" } }],
  "honorarios": [...], "multas": [...], "pensao": { "dataEvento": "2016-07-20", "aliquota": 30, "verbas": "todas" },
  "custas": { "fixas": [...], "autos": [...], "armazenamentos": [...] }, "precatorio": { "tipo": "RPV", "esfera": "FEDERAL" } }
```

## Cobertura

Tudo o que o PJe-Calc calcula está na especificação: cálculo, verbas e reflexos (com valores mês a
mês), cartão de ponto, FGTS, INSS, IR, pensão, previdência privada, salário-família, seguro-desemprego,
honorários (inclusive sobre verbas escolhidas), multas, custas, correção e juros, pisos e
vale-transporte, pagamentos e atualização da execução, Cálculo Externo e precatório/RPV. O que depende
de cadastro no PJe-Calc do usuário (pisos, linhas de vale-transporte, feriados municipais) usa os ids do
banco dele (`catalogo_pisos_vt`, `catalogo_feriados`).

## Resultado de `calculo_criar`

`{ arquivo, arquivoPronto, idCalculo, regeracao, cartaoDePonto?, vinculosCartao?, edicoesOcorrencias?, conferenciaEdicoes?, geracaoEncargos?, edicoesEncargos?, conferenciaEncargos?, pendencias: { totalErros, totalAlertas, pendencias[] }, tabelas: { atualizadas, atrasados[], regionalCarregado, regionalDiferente?, instrucao?, atualizacao? }, prontoParaLiquidar, instrucoes, avisos, resumoGerado, liquidacaoDeTeste?, resultado?, justificativa? }`

`resultado` (liquidação): `verbas[]` com `{ descricao, valorCorrigido, juros, total }` — **inclusive
negativas** (o relatório as mostra entre parênteses) —, `totaisDoQuadro`, `composicao[]` (créditos e
descontos do reclamante e débitos do reclamado: verbas, FGTS e depósito de FGTS, contribuição social,
IRPF, honorários, custas...), `conferencia { somaRubricas, totalDoQuadro, somaConfere,
brutoIgualAoQuadro, rubricasNegativas[], alerta? }`, `brutoDevidoAoReclamante`,
`liquidoDevidoAoReclamante`, `totalDevidoPeloReclamado`, `totalDescontos`, `dataLiquidacao`.
`justificativa[]`: os critérios que o PJe-Calc aplicou de fato (relatório JUSTIFICATIVA).

Opções de `calculo_criar`: `liquidar_em` (liquidação de teste), `atualizar_tabelas` (atualiza as
tabelas pelo TRT do número CNJ se não cobrirem a liquidação ou forem de outro TRT), `ignorar_tabelas`,
`exportar_final`, `destino`, `iniciar`. Se `tabelas.atualizadas` vier `false`, o cálculo e o `.PJC`
já estão prontos — falta só `tabelas_atualizar` antes de liquidar.

`prontoParaLiquidar = true` significa que a tela Liquidar não tem erros: o usuário escolhe a data e
clica em **Liquidar**. `arquivoPronto` (`-PRONTO.PJC`) é o cálculo exportado pelo próprio PJe-Calc
depois de tudo: importado em outro PJe-Calc 2.16.x, liquida sem nenhum passo adicional.
