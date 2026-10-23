# Módulo: leitura integral de documentos, textos e imagens

Carregue **sempre**, antes de interpretar qualquer documento, inclusive os de outros processos do mapa.
Um erro de leitura vira erro de cálculo que nenhuma conferência posterior encontra.

## 1. Inventário antes de ler

Liste cada arquivo e cada página e registre:
- o processo de origem;
- o tipo de documento;
- a folha ou o ID do PJe;
- se a página tem texto ou é só imagem (escaneada, fotografada);
- se está legível.

Nada fica fora do inventário. Página ilegível vira pedido em `contrato.coleta` com status `ILEGIVEL`.

`documento_inventario` (arquivos ou pasta) faz o inventário: hash sha256, número de páginas, páginas
com e sem texto, páginas com imagem, tipo provável e números de processo citados. Devolve a sugestão de
`contrato.documentos` e o esqueleto de `contrato.leitura`. Página **sem texto** é escaneada ou
fotografada: veja como imagem (o MCP não faz OCR). O carimbo de assinatura do PJe (assinante, link,
número do documento, folha) não conta como texto: página que só tem o carimbo é escaneada. PDF
criptografado ou corrompido aparece em `avisos`.

`documento_imagens` grava as imagens dessas páginas em arquivos (JPEG como está, as demais em PNG): abra a
imagem "principal" de cada página e leia. Não precisa de programa externo.

**Com o AuditorProcessual** ([github.com/lucianumm/AuditorProcessual](https://github.com/lucianumm/AuditorProcessual),
opcional, em Python): rode a ingestão dele em cada arquivo dos autos (`ingest_document.py <arquivo> --output <pasta>`,
com `--ocr` se houver Tesseract) e passe as pastas a `auditor_importar`. A ferramenta devolve as mesmas sugestões do
inventário, com mais precisão nos autos do PJe:
- um documento por id do PJe (o rodapé de assinatura, nos formatos do 1º e do 2º grau), com as **folhas** dos autos;
- o mesmo documento em dois downloads entra uma vez, e as folhas vêm do arquivo mais completo;
- página que só tem o rodapé do PJe marcada para leitura como imagem (a ingestão do AuditorProcessual a conta como
  texto);
- o número do processo pelo mais citado nos autos, com alerta quando difere do que o AuditorProcessual identificou, e
  os demais números citados para o mapa (`contrato.processos`).

Se a IA que leu os autos preencheu também o livro-razão (`labor_ledger`: jornada dia a dia e folha de pagamento), os
eventos do contrato (`labor_events`) e a revisão com os fatos (id, página e trecho), passe-os em `ledger`, `eventos`
e `revisao`. Eles viram jornadas (com as conferências de `cartoes_para_jornadas`), remunerações, pagamentos,
afastamentos e datas do contrato, cada item com documento, folha e trecho. O valor "devido" estimado no livro-razão
não entra (no PJe-Calc o devido sai das verbas), dia ou valor só do relato do cliente vira premissa, e data
desconhecida não vira dia inventado.

Tudo é sugestão: confira cada página, informe o tipo dos documentos escaneados e complete natureza, decisão e efeito
dos eventos antes de copiar para a especificação.

## 2. Leitura página por página

- **Todas as páginas** de todos os documentos. É proibido resumir um documento sem ter lido todas elas.
- Imagens e PDFs escaneados são **vistos como imagem**. O texto extraído pode vir truncado, fora de
  ordem ou com números trocados; ele serve de apoio, não substitui a leitura.
- Tabelas (holerites, cartões, extratos) são lidas linha a linha, não por amostragem.
- Cada página termina classificada: **usada**, **irrelevante** (com motivo) ou **ilegível**.
- Em processos grandes, leia em partes, seguindo o inventário, até classificar todas as páginas.
- `documento_texto` devolve o texto de um PDF página por página (`paginas: "1-3,7"`), para localizar
  trechos e conferir números. O espaçamento entre palavras é decidido pela largura real das letras
  (petições que posicionam letra por letra saem legíveis). O texto pode sair fora da ordem visual das
  colunas: confira na página.

## 3. O que extrair de cada documento

| documento | extração |
|---|---|
| Sentença, acórdãos, embargos, decisões de liquidação e execução | ver `TITULO-EXECUTIVO.md`: dispositivo e fundamentação de cada capítulo, resultado, trânsito, precedentes |
| Petição inicial | pedidos, valores, períodos, causa de pedir (limites da condenação) |
| Contestação | fatos incontroversos, pagamentos alegados, impugnações a documentos |
| Atas e depoimentos | confissões, jornada admitida, acordos parciais, desistências |
| Laudos | grau e período de insalubridade ou periculosidade; conclusões contábeis |
| Holerites | por competência: cada rubrica (código, descrição, referência, valor), bases de INSS, FGTS e IR, líquido |
| Cartões de ponto | marcações de cada dia, folgas, feriados, horários invariáveis (Súmula 338) |
| TRCT | cada campo, datas, causa do afastamento, valores pagos e descontados |
| Extrato do FGTS | depósitos por competência, saques, saldo para fins rescisórios |
| Norma coletiva | cláusulas de piso, adicionais, reajustes e vigência |
| CTPS e ficha de registro | admissão, saída, função, alterações salariais |
| Guias, alvarás e extratos judiciais | data, valor, a quem foi pago |
| Documentos de outros processos | os mesmos critérios, registrando o processo de origem |

## 4. Precisão

- **Citação literal:** todo comando e todo valor vêm com a folha. O trecho da decisão vai entre aspas.
  A interpretação fica separada do texto.
- **Dupla leitura dos números críticos:** salários, quantidades, datas, valores pagos. Confira de novo
  antes de usar.
- **Fechamentos obrigatórios:**
  - holerite: proventos − descontos = líquido;
  - cartão: soma diária = total do mês, quando houver;
  - TRCT: soma dos campos = total;
  - extrato do FGTS: soma dos depósitos = saldo.

  Fechamento que não bate indica leitura errada ou documento com problema. Releia e, se persistir,
  registre como premissa `CONTROVERTIDA`.

  Os conversores recebem a **sua transcrição** e conferem os fechamentos e os meses faltantes:

  | ferramenta | recebe | devolve |
  |---|---|---|
  | `holerites_para_historicos` | holerites (competência, rubricas com código, referência, valor, P/D, totais, líquido, folha) e o agrupamento das rubricas | `historicosSalariais` com `_origem`, `contrato.remuneracoes`, fechamento de cada holerite, competências faltantes, proventos fora de histórico |
  | `cartoes_para_jornadas` | marcações dia a dia (ou turnos, ou folga/férias/falta/atestado/feriado) | `apuracaoCartaoPonto.jornadas`; acusa dia sem registro, marcações ímpares, turnos impossíveis, interjornada < 11 h, horários invariáveis (Súmula 338, III) |
  | `extrato_para_fgts` | lançamentos (competência, data, valor, depósito/JAM/saque/multa) e saldo | `fgts.operacoes` com origem, depósitos por competência, soma = saldo, competências sem depósito |
  | `trct_para_pagamentos` | campos do TRCT (código, descrição, valor, P/D), totais, data, folha | `contrato.pagamentos` por campo com a parcela provável (Portaria MTE 1.621/2010), soma dos campos = totais |

  Eles não leem o documento: a transcrição continua sendo sua, com dupla leitura.
- **Confronto entre documentos:**
  - datas: CTPS × TRCT × sentença;
  - salário: holerite × CTPS;
  - jornada: sentença × cartões;
  - pagamentos: TRCT × último holerite;
  - valores: decisão × cálculo homologado.

  Toda divergência vira premissa classificada ou conflito registrado.
- **Pedidos × decisão:** cada pedido da inicial classificado como deferido, indeferido ou sem
  decisão. Omissão é avisada ao usuário (pode caber embargos), nunca preenchida.

## 5. Números de processo, decisões e precedentes citados

Ao ler, anote todo número de processo, toda decisão e todo precedente citados. Processos entram no
mapa (`PROCESSO.md`), decisões entram em `contrato.decisoes`, e precedentes adotados como critério
são conferidos no catálogo (`PRECEDENTES.md`).

## 6. Registro da leitura

- Cada documento lido entra em `contrato.documentos`, com `paginas` e, para séries mensais, `periodo`
  e `lacunas`.
- Cada extração relevante vai para o registro próprio (decisão, parcela, remuneração, pagamento,
  evento, premissa), com `documento`, `folha` e `trecho`.
- A leitura de cada documento vai em `contrato.leitura`, os confrontos em `contrato.confrontos` e os
  pedidos em `contrato.pedidos`:

```json
"leitura": [{
  "documento": "D2",
  "classificacao": { "usadas": "40-60,62",
                     "irrelevantes": [{ "folhas": "61", "motivo": "verso em branco" }],
                     "ilegiveis": [{ "folhas": "63", "motivo": "digitalização cortada" }] },
  "lidaComoImagem": "40-65",
  "fechamentos": [{ "tipo": "HOLERITE", "referencia": "2014-03", "ok": true, "detalhe": "proventos − descontos = líquido" }],
  "observacao": "..."
}],
"confrontos": [{ "tipo": "DATAS", "documentos": ["D11", "D1"], "ok": true, "detalhe": "admissão e saída do TRCT iguais às da sentença" }],
"pedidos": [{ "pedido": "Horas extras com reflexos", "documento": "D1", "folha": "fl. 3", "situacao": "DEFERIDO", "decisao": "DEC1" }]
```

  `confrontos[].tipo`: DATAS, SALARIO, JORNADA, PAGAMENTOS ou VALORES. `pedidos[].situacao`: DEFERIDO,
  INDEFERIDO, PARCIAL ou SEM_DECISAO.

  A auditoria (dimensão **leitura**) recusa:
  - documento sem registro de leitura;
  - folha sem classificação, classificada duas vezes ou fora do documento;
  - folhas irrelevantes sem motivo;
  - folhas ilegíveis sem pedido pendente em `contrato.coleta`;
  - fechamento ou confronto que não fecha sem `resolucao` (com resolução, vira alerta).

  Pedido `SEM_DECISAO` vira alerta: a omissão é avisada ao usuário, nunca preenchida.
- Termine a leitura com um resumo ao usuário: o que foi lido, o que estava ilegível, o que faltou, as
  divergências encontradas.
