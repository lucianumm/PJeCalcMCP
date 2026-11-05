# Módulo: pagamentos e abatimentos

Carregue quando houver valores pagos a deduzir: férias e 13º pagos, verbas rescisórias, depósitos e
saques de FGTS, adiantamentos. Resultado: `contrato.pagamentos`, `valorPago` com `origem` e
`fgts.operacoes` com `origem`.

## Conferências

1. **Identidade**: o pagamento declara o que cobre e precisa coincidir com a parcela abatida em:
   - parcelas do contrato que cobre (`parcelas`) — a auditoria recusa abater verba de outra parcela;
   - competência, período aquisitivo ou período (`competencia`, `periodo`) e avos (`avos`) — período
     fora do contrato ou que não alcança a verba abatida é recusado;
   - data disponível (`data`);
   - emitente (o reclamado, mesmo CNPJ);
   - comando que autoriza a dedução (`comando`: a decisão).

   Nunca compense por semelhança de valor. Data não localizada é **pendência identificada** (alerta),
   nunca data fictícia.
2. **Abrangência**: um pagamento abate só o que cobre (ex.: férias 2013/2014 não abatem 2014/2015).
   Pagamento parcial abate parcialmente; o saldo não alocado aparece como alerta.
3. **Saldo de cobertura**: um recibo pode ser dividido legitimamente entre componentes. Cada parte é
   um pagamento derivado (`derivadoDe` = id do original, com `parcelas` e `valor` próprios). A soma dos
   consumos de um original — diretos e por ids derivados — não pode passar do valor dele; uso repetido
   sem valor em cada uso também é recusado. Criar ids novos não cria dinheiro novo. Somar adiantamento
   e complemento do 13º não duplica pagamento, desde que cada um tenha o próprio documento.
4. **Prova**: recibo sem assinatura, holerite de outro empregador ou extrato ilegível viram premissa
   `CONTROVERTIDA`/`DESCONHECIDA`. A auditoria recusa abatimento apoiado nelas fora de um cenário
   declarado. Holerite com FGTS informado não prova depósito: o depósito pede extrato ou guia.
5. **Alocação**: em que verba e em que competência o abatimento entra (`valorPago` da verba ou do
   reflexo, `verbas[].ocorrencias` com o `pago` de cada competência, ou operação de FGTS), em valor
   nominal na data do pagamento. `trct_para_pagamentos` e `extrato_para_fgts` montam os registros a
   partir da sua transcrição e conferem as somas.

Pagamentos feitos **depois** da liquidação (depósitos judiciais, alvarás, bloqueios convertidos) não
são abatimentos do cálculo: entram no bloco `execucao` (`EXECUCAO.md`).

## Conferência dos números

Depois de liquidar, confira em `resultado.verbas` as rubricas negativas (pagamento maior que o devido)
e explique cada uma. `resultado.conferencia` mostra se a soma fecha com o bruto.
