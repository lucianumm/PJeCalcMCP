# Auditoria pericial integral

Roteiro longo das etapas 0 a 8 da skill para o trabalho de perito calculista: ler o processo inteiro e
transformá-lo num plano técnico de liquidação, antes de qualquer cálculo. O prompt
`auditoria-pericial-integral` do MCP carrega este roteiro.

O resultado não é um texto solto. Cada achado vai para o contrato de dados (`CONTRATO-DE-DADOS.md`), que
a auditoria confere, e o plano (`calculo_plano_interpretacao`) é o relatório que o usuário aprova. Só
depois se calcula.

## Travas (valem para todas as etapas)

1. **Leitura integral e rastreável.** Todos os documentos, do início ao fim, página por página
   (`documento_inventario`, `documento_texto`, `documento_imagens` para as páginas escaneadas). Todo dado
   extraído (data, salário, batida, comando) leva o documento e a folha ou ID: `(ID a1b2c3d, pág. 4)`.
   Folhas sem uso entram em `contrato.leitura` como irrelevantes (com motivo) ou ilegíveis (com pedido).
2. **Nada inventado, amostrado ou arredondado.** Sessenta meses de cartões e holerites são sessenta
   meses lidos, dia por dia. Média só quando o título manda (por exemplo, a média física dos cartões
   juntados para os meses sem cartão). Minutos não se arredondam.
3. **Autos isolados.** Só os documentos deste processo. Nada de outro caso, nem como "padrão".
4. **Fontes.** Constituição, CLT, CPC, leis federais, súmulas, OJs e teses do TST (inclusive recursos
   repetitivos), precedentes vinculantes do STF e o IRDR ou IAC do TRT do processo (CPC, art. 985). O
   que o título adotou vale como coisa julgada, inclusive tese regional. Jurisprudência não vinculante
   só reforça, nunca contraria o título. Vigência e modulação em `PRECEDENTES.md`; na dúvida, consulte
   a fonte oficial e pergunte.
5. **Lacuna declarada, nunca preenchida.** Mês sem holerite, cartão ilegível, divisor omitido: registre
   `[LACUNA: documento ou período, impacto, solução]`, peça em `contrato.coleta`
   (`calculo_documentos_necessarios` gera o pedido) e, até chegar, trate como premissa `DESCONHECIDA`
   num cenário declarado. Nunca zero, nunca padrão silencioso.
6. **Precisão verificável.** Nenhum valor "aproximado". O MCP recalcula cada ocorrência, juros, FGTS,
   INSS, IR, honorários e custas e compara ao centavo; diferença é falha a explicar.

## Etapa 1 — mapa processual, datas e trânsito

Ferramentas: `processo_mapa` (`contrato.processos`), `titulo_compor`, `catalogo_atividades`.

1. **Processo e partes.** Número CNJ, vara e TRT. Reclamante (nome, CPF). Reclamada e corréus: razão
   social, CNPJ ou CPF, CNAE, SAT/RAT e FAP (se constarem de GFIP ou eSocial), Simples Nacional ou
   desoneração da folha (Lei 12.546/2011) **com os períodos provados**, ente público, massa falida ou
   recuperação judicial (Lei 11.101/2005).
2. **Responsabilidade de terceiros.** Subsidiária (Súmula 331 do TST) ou solidária, o período exato de
   cada devedor e as verbas excluídas da responsabilidade de cada um.
3. **Cronologia.** Admissão (confronte CTPS e TRCT com o vínculo ou a unicidade reconhecidos),
   dispensa e último dia trabalhado, modalidade da rescisão (sem justa causa, justa causa mantida ou
   revertida, rescisão indireta, pedido de demissão, acordo do art. 484-A da CLT, término de contrato a
   termo), aviso prévio (Lei 12.506/2011: 30 dias + 3 por ano completo, até 90) e a data de saída
   projetada (OJ 82 da SDI-1), ajuizamento e citação.
4. **Prescrição.** Quinquenal contada do ajuizamento (CF, art. 7º, XXIX; Súmula 308, I, do TST) e
   bienal. FGTS: Súmula 362 do TST e a modulação do ARE 709.212 do STF. Suspensões (por exemplo, a Lei
   14.010/2020) só se o título as aplicou; senão, premissa declarada.
5. **Decisões e trânsito.** Datas de prolação e publicação de sentença, embargos, acórdãos do TRT, do TST
   e do STF. Data e ID da certidão de trânsito. Trânsito por capítulo (CPC, arts. 356 e 502; Súmula 100,
   II, do TST): decide se o critério de correção e juros já estava coberto pela coisa julgada na
   modulação da ADC 58.

## Etapa 2 — matriz da coisa julgada

Ferramentas: `titulo_compor` (`contrato.decisoes`, `contrato.parcelas`), `contrato.pedidos`.

Efeito substitutivo do recurso (CPC, art. 1.008) e vedação de inovar na liquidação (CLT, art. 879,
§ 1º). Para **cada** pedido da inicial e cada requerimento autônomo da defesa (compensação, dedução,
má-fé, honorários):

1. **Inicial:** o pedido, o período, a causa de pedir (jornada alegada, paradigma, grau de
   insalubridade) e o valor atribuído. Limitação aos valores da inicial (CLT, art. 840, § 1º): só se o
   título a fixou; sem comando, os valores são estimativa (IN 41/2018 do TST, art. 12, § 2º).
2. **Defesa:** a tese, os documentos juntados e o pedido expresso de dedução.
3. **Sentença e embargos:** deferido, parcialmente deferido ou improcedente, com os parâmetros
   transcritos (período, base, divisor, adicional, quantidade, reflexos, deduções) e a folha.
4. **Acórdãos (TRT, TST, STF) e embargos:** quem recorreu do capítulo, se foi conhecido, mantido,
   reformado (o quê) ou excluído.
5. **Comando final:** a situação final da parcela (`DEFERIDA`, `INDEFERIDA`, `REFORMADA` ou
   `PENDENTE`), a decisão vigente com folha e trecho, e a regra de cálculo (período, base, divisor,
   multiplicador, quantidade, reflexos deferidos e abatimentos autorizados). Pedido sem decisão é
   `SEM_DECISAO`: omissão se resolve por embargos, não no cálculo.

Verifique multas processuais em qualquer instância: embargos protelatórios (CPC, art. 1.026, § 2º) e
litigância de má-fé (CPC, art. 81; CLT, art. 793-C).

## Etapa 3 — auditoria financeira

Ferramentas: `holerites_para_historicos`, `trct_para_pagamentos`, `extrato_para_fgts` (conferem os
fechamentos de cada documento), `contrato.remuneracoes`, `contrato.pagamentos`, `contrato.afastamentos`.

1. **Evolução salarial, mês a mês.** Salário pago e salário devido (piso normativo ou reconhecido);
   parcelas fixas (gratificação, anuênio, insalubridade, periculosidade, transferência, quebra de
   caixa); variáveis (comissões, prêmios, produção, gorjetas, DSR sobre variáveis); indenizatórias (vale
   refeição, ajuda de custo, diárias, PLR); descontos (faltas, DSR, INSS, IRRF, contribuições para
   eventual devolução). Cada componente em histórico próprio, sem dupla média.
2. **Rubricas já pagas para dedução**, com identidade: horas extras por adicional, adicional noturno,
   hora noturna reduzida, intervalo, domingos e feriados e os reflexos em DSR, mês a mês. Dedução mês a
   mês (`zerarNegativo`) ou global (OJ 415 da SDI-1, nas horas extras), conforme o título.
3. **TRCT.** Todas as rubricas e valores, o líquido pago e a data do pagamento, e a entrega das guias e
   da baixa: multa do art. 477, § 8º (prazo de 10 dias do término, art. 477, § 6º).
4. **FGTS.** Depósito por depósito contra a remuneração: meses sem depósito, depósitos a menor, FGTS
   rescisório e multa de 40% (ou 20%) recolhidos na guia rescisória, para abater no bloco `fgts`.
5. **Faltas e afastamentos.** Cada falta injustificada (afeta DSR, divisor e a proporção de férias do
   art. 130 da CLT); afastamentos previdenciários com início, 16º dia e alta, e se acidentários (o FGTS
   continua devido, Lei 8.036/1990, art. 15, § 5º). Cada evento com a natureza da prova.
6. **Férias.** Por período aquisitivo: faltas, dias de direito (30, 24, 18, 12 ou 0), concessivo, gozo
   (até três períodos), abono, data de pagamento (art. 145 da CLT; a ADPF 501 do STF afastou a dobra só
   pelo atraso no pagamento) e se foram pagas ou indenizadas na rescisão.

## Etapa 4 — cartões de ponto, dia a dia, em minutos

Ferramentas: `cartoes_para_jornadas` (a grade dia a dia em JSON, conferida contra o documento),
`apuracaoCartaoPonto` ou `cartoesDePonto`, `calculo_apurar_cartao_ponto`, `catalogo_cartao_ponto`,
`catalogo_feriados`.

1. **Regras do processo.** Ciclo de fechamento (1 a 30/31, 16 a 15, 21 a 20...). Meses com cartão
   válido, sem cartão (Súmula 338, I) ou com cartão invalidado (marcação britânica, Súmula 338, III, ou
   prova oral). Jornada arbitrada para cada período sem cartão válido: dias da semana, entrada,
   intervalo, saída, sábados, domingos e feriados. Média física dos cartões juntados, se o título manda.
2. **Decomposição.**
   - **Carga e escala:** diária e semanal; 12x36 (CLT, art. 59-A), 6x1, 5x2, turnos de revezamento
     (CF, art. 7º, XIV), e se a escala foi validada ou descaracterizada.
   - **Minutos residuais** (CLT, art. 58, § 1º; Súmula 366): variação de até 5 minutos por marcação e
     10 por dia; passou de 10, conta tudo.
   - **Tempo à disposição, uniforme, higienização, espera, horas in itinere:** só se deferidos, somados
     às marcações antes de apurar as extras, com o marco de 11/11/2017 (Lei 13.467/2017) que o título
     fixar.
   - **Intrajornada** (CLT, art. 71; Súmula 437): acima de 6 horas efetivas, 1 hora de intervalo (item
     IV); entre 4 e 6, 15 minutos. Até 10/11/2017, a hora integral com adicional e natureza salarial;
     desde 11/11/2017, só o tempo suprimido, com natureza indenizatória. Salvo comando diverso do título.
   - **Interjornadas** (CLT, arts. 66 e 67; Súmula 110; OJ 355): descanso = início da jornada seguinte
     menos o fim da anterior, em data e hora (a jornada que passa da meia-noite termina no dia
     seguinte). Menos de 11 horas: as horas faltantes com adicional. Com repouso semanal entre as
     jornadas, 35 horas, se deferido.
   - **Intervalos especiais, se deferidos:** art. 384 da CLT (fatos até 10/11/2017; Tema 528 do STF),
     art. 253 (ambiente frio; Súmula 438), art. 72 (digitação). Motorista profissional: tempo de espera
     do art. 235-C conforme a ADI 5322 do STF (que declarou inconstitucionais a exclusão do tempo de
     espera da jornada e a indenização de 30%) e a modulação fixada; prevalece o título.
   - **Noturno** (CLT, art. 73; Súmula 60): urbano das 22h às 5h, hora de 52min30s (fator 60/52,5 =
     1,142857); prorrogação após as 5h (Súmula 60, II) se o título deferiu. Rural (Lei 5.889/1973, art.
     7º): lavoura das 21h às 5h, pecuária das 20h às 4h, adicional de 25% e sem hora reduzida.
   - **Critério das extras:** diário, semanal, o mais favorável, ou diário e semanal sem duplicidade.
     Compensação (Súmula 85): nas horas além da diária e dentro da semanal, só o adicional; além da
     semanal, hora mais adicional (itens III e IV; o banco de horas fica fora, item V).
   - **Domingos e feriados** (Lei 605/1949; Súmula 146; OJ 410): nacionais, estaduais e municipais do
     local da prestação, trabalhados sem folga compensatória. A forma é a do título: "dia em dobro" não
     é "horas extras a 100% com reflexos" quando o título não deferiu esses reflexos.
3. **Grade.** `Data | dia | entrada 1 | saída 1 | entrada 2 | saída 2 | entrada 3 | saída 3 | ocorrência
   | total | intervalo`, gerada por `cartoes_para_jornadas` e conferida por dupla leitura contra o
   documento. Não transcreva à mão o que o conversor extrai e confere.

## Etapa 5 — parametrização no PJe-Calc

O destino é a especificação JSON (`ESPECIFICACAO-CALCULO.md`), validada por `calculo_validar` com as
regras do próprio PJe-Calc. Não se preenche tela. Cada aba tem seu bloco:

| Aba do PJe-Calc | Bloco | O que conferir |
|---|---|---|
| Dados e parâmetros | `processo`, `calculo` | município, datas, prescrição quinquenal e do FGTS, regime, projeção do aviso, limitar avos, zerar negativo, feriados estaduais e municipais, carga horária (e mudanças), sábado como dia útil (bancário: Súmula 113), maior e última remuneração |
| Faltas e férias | `faltas`, `ferias` | justificada, reinício do aquisitivo; situação, dobra, abono e gozos |
| Histórico salarial | `historicosSalariais` | incidências e proporcionalização de FGTS e INSS, valores já recolhidos, competências |
| Cartão de ponto | `apuracaoCartaoPonto` ou `cartoesDePonto` | critério das extras, preenchimento (livre, programação, escala), tolerâncias, intervalos, hora noturna e prorrogação, feriados, fechamento |
| Verbas | `verbas` | característica e ocorrência, incidências, período, exclusões, base (Súmulas 264, 132, 60, I; OJ 97 da SDI-1), divisor, multiplicador, quantidade, valor pago (mês a mês ou OJ 415), reflexos (RSR majorado conforme a OJ 394 e a modulação de 20/03/2023; médias de 13º, férias e aviso) |
| Salário-família, seguro-desemprego | `salarioFamilia`, `seguroDesemprego` | filhos provados; parcelas da indenização substitutiva (Súmula 389) |
| FGTS | `fgts` | destino, alíquota (8% ou 2% do aprendiz), multa (40%, 20% na culpa recíproca ou no art. 484-A), depósitos a deduzir |
| Contribuição social | `contribuicaoSocial` | segurado e cobrança do reclamante (Súmula 368, II; OJ 363), salários pagos para o teto, empresa, SAT/RAT × FAP, terceiros, Simples ou desoneração; regime de caixa até 04/03/2009 e de competência desde 05/03/2009, juros e multa (Súmula 368, IV e V) |
| Imposto de renda | `irpf` | rendimentos recebidos acumuladamente (Lei 7.713/1988, art. 12-A; Súmula 368, VI), 13º e férias em separado, deduções (INSS do segurado, pensão, honorários pagos pelo reclamante, dependentes); juros isentos (OJ 400) |
| Honorários, multas, custas | `honorarios`, `multas`, `custas` | sucumbenciais do art. 791-A sobre o valor da condenação sem dedução de INSS e IR e sem a cota patronal (OJ 348); recíproca com exigibilidade suspensa do beneficiário da justiça gratuita, sem compensação (ADI 5766); periciais (art. 790-B; OJ 198); custas do art. 789; multas do art. 477, do art. 467, normativas e processuais |
| Correção e juros | `correcaoJuros` | o critério transitado expressamente prevalece; senão ADC 58/59 (IPCA-E e juros do art. 39 da Lei 8.177/1991 na fase pré-judicial, SELIC do ajuizamento) e Lei 14.905/2024 (IPCA e taxa legal desde 30/08/2024); dano moral conforme o título (Súmula 439 lida com a ADC 58); ente público pelo Tema 810, pela EC 113/2021 e pela EC 136/2025 |

Cada verba com `origem` (parcela, decisão, premissas) e cada critério com a decisão ou o precedente.

## Etapa 6 — relatório de inconsistências e plano

1. **Documentos faltantes ou ilegíveis**, mês a mês: `calculo_documentos_necessarios` devolve o pedido
   pronto.
2. **Omissões e contradições do título**: as que `titulo_compor` acusa e cada ponto em que o título não
   fixou um parâmetro (critério de média, base de uma rubrica, divisor). Para cada um, as leituras que
   o título admite e o efeito de cada uma no valor, registrados na premissa.
3. **Plano técnico de liquidação**: `calculo_plano_interpretacao` com todas as verbas que irão ao
   resumo, as premissas, os cenários e as perguntas. O usuário aprova (`calculo_aprovar_plano`) antes de
   `calculo_criar`.

Depois do cálculo: a auditoria do MCP (estado, dimensões, verificações), a volta aos documentos e,
havendo conta de outra pessoa, `calculo_comparar_referencia`, que mostra a causa de cada diferença por
ocorrência (quantidade, base, divisor, multiplicador, pago).
