# Como contribuir

O PJe-Calc MCP é criado e mantido por [Lucianum (@lucianumm)](https://github.com/lucianumm).
Relatos reproduzíveis, correções e melhorias na documentação são bem-vindos. A manutenção e a
revisão das alterações ficam com Lucianum.

## Relatar uma falha ou sugerir uma melhoria

Use os [modelos de issue](https://github.com/lucianumm/PJeCalcMCP/issues/new/choose) e verifique se
já existe um relato semelhante. Para falhas, informe a versão do MCP, do PJe-Calc, do Windows,
do Node.js e do assistente, os passos para reproduzir e o resultado esperado e observado.

Use dados fictícios. Remova nomes, CPF/CNPJ, números reais de processos, dados bancários,
credenciais e caminhos que identifiquem pessoas antes de publicar exemplos, logs ou imagens.
Não anexe autos, holerites, cartões de ponto ou arquivos `.PJC` de casos reais.

Possíveis vulnerabilidades devem ser comunicadas em privado conforme a
[política de segurança](.github/SECURITY.md).

## Preparar o ambiente

Use Windows, Git e Node.js >=20. Faça um fork e clone a sua cópia; a estrutura e os comandos
estão no [README](README.md#desenvolvimento).

O SDK MCP e o Zod já acompanham o projeto em `server/node_modules/`. Não é necessário rodar
`npm install`. Preserve esse conteúdo e as licenças das dependências; uma atualização delas
deve ter escopo explícito e validação própria.

Crie uma branch para uma alteração com objetivo claro. O servidor usa JavaScript ESM (`.mjs`);
acompanhe o estilo dos arquivos próximos. Não inclua arquivos gerados, cópias de instalações do
PJe-Calc, dados pessoais ou alterações de formatação sem relação com a proposta.

## Validar uma alteração

Na raiz do repositório:

```powershell
node scripts/test-mcp.mjs
```

Essa suíte offline verifica o protocolo MCP, os catálogos, as validações e a geração de `.PJC`.
Ela também é executada no GitHub Actions e não exige o PJe-Calc instalado. Em alterações apenas
de documentação, confira os links, os comandos e a coerência com o código.

Ao alterar uma regra de cálculo ou um formato de entrada, inclua um caso de regressão com
dados fictícios, o resultado esperado e sua origem. Atualize, quando necessário, os exemplos,
o contrato de dados em `references/` e as instruções do agente em `SKILL.md`.

### Testes com o PJe-Calc

Para mudanças na integração, use uma **instalação separada do PJe-Calc Cidadão 2.16**, preparada
para testes. A suíte cria, liquida e exclui cálculos de teste e troca tabelas regionais (TRT8 e,
em um dos casos, TRT18). Não a execute sobre uma instalação de trabalho com cálculos reais.

Depois de preparar essa instalação, defina `PJECALC_HOME` e rode, na raiz:

```powershell
$env:PJECALC_HOME = 'C:\PJeCalc-Testes'
node scripts/test-ponta-a-ponta.mjs todos
```

Substitua o caminho pela pasta extraída que contém `bin/` e `tomcat/`. Consulte o cabeçalho do
script para rodar casos específicos. Para alterações no utilitário Java, o alvo é Java 8; o
script `java/compilar.sh` descreve a recompilação com JDK >=9 e Bash.

## Enviar um pull request

Explique o problema, o comportamento após a mudança e o que foi verificado. Informe também os
testes que não puderam ser executados. O [modelo de pull request](.github/PULL_REQUEST_TEMPLATE.md)
ajuda a organizar essas informações.

A geração e a importação de cálculos devem continuar usando `.PJC` e as operações do PJe-Calc;
não grave cálculos diretamente no banco H2. Mantenha as conferências e a rastreabilidade entre
documentos, decisões e parâmetros.

As contribuições de código seguem a [AGPL-3.0-only](LICENSE), e a participação segue o
[código de conduta](CODE_OF_CONDUCT.md).
