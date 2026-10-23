# Módulo: plano de interpretação e aprovação

O usuário aprova o entendimento do agente **antes** do cálculo. Com contrato de dados, `calculo_criar`
não gera nada sem a aprovação válida, e o estado nunca chega a `auditado` ou `simulacao` sem ela.

## 1. Gerar o plano

`calculo_plano_interpretacao` (com a especificação) devolve `markdown`, `hashContrato`,
`prontoParaAprovar` e `aprovacaoAtual`. O plano traz:
1. processo, fase, trabalho, processos ligados e devedores;
2. a matriz do título: a cadeia de decisões, a que vale e o trânsito de cada capítulo;
3. cada parcela: comando, folha e trecho, período, reflexos deferidos e como será calculada no
   PJe-Calc (base, divisor, quantidade, reflexos, abatimentos), com as premissas;
4. critérios gerais: correção e juros (origem e precedentes), honorários, data-base, FGTS;
5. eventos, pagamentos, pagamentos da execução e destinos do crédito;
6. premissas por classe, cenário e incertezas abertas;
7. falhas, alertas, documentação pendente e perguntas;
8. como aprovar.

**Mostre o plano inteiro ao usuário.** Com falhas, o plano não pode ser aprovado: resolva-as antes
(ou registre pendências num cenário).

## 2. Aprovar

Quando o usuário aprovar na conversa, chame `calculo_aprovar_plano` com o nome de quem aprovou e as
observações. A ferramenta devolve:

```json
"aprovacao": { "por": "Nome", "em": "2026-10-18T14:00:00Z", "observacoes": "...", "hashContrato": "..." }
```

Grave o objeto em `contrato.aprovacao`, ou use `arquivo_json` + `gravar: true`. Se o usuário pedir
correções, faça-as, gere o plano de novo e peça nova aprovação.

## 3. Quando a aprovação cai

O hash cobre o contrato inteiro e o cenário. Ficam de fora só a própria aprovação e as revisões de
alerta. Qualquer mudança depois da aprovação a invalida: documento, decisão, parcela, premissa,
pagamento ou cenário. É preciso gerar o plano de novo e obter nova aprovação. Ajustes só na
parametrização (blocos fora do contrato) não derrubam a aprovação, mas continuam sujeitos à auditoria,
que confere a ligação com o contrato.

## 4. Depois de calcular

Com `liquidar_em`, `calculo_criar` confere o plano contra o resultado: cada parcela deferida aprovada
precisa aparecer no resultado com valor, ou ter o zero justificado em `contrato.zerosJustificados`.
Mostre ao usuário as diferenças entre o plano aprovado e o resultado.
