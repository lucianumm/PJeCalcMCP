# Política de segurança

## Comunicar uma vulnerabilidade

Envie possíveis vulnerabilidades em privado para
[contato@lumenaxis.dev.br](mailto:contato@lumenaxis.dev.br), com o assunto
**[PJeCalcMCP] Segurança**. O contato é acompanhado por Lucianum (@lucianumm).
Não abra uma issue pública com detalhes de exploração ou dados sensíveis.

Inclua, quando possível:

- A versão do MCP, do PJe-Calc, do Windows e do Node.js.
- O componente afetado, os passos mínimos para reproduzir e os requisitos para a falha ocorrer.
- O comportamento observado e o impacto possível sobre arquivos, cálculos ou informações privadas.
- Uma demonstração com dados fictícios, sem documentos de processos, credenciais ou dados pessoais.

Se precisar compartilhar material sensível, peça primeiro uma forma adequada de envio.
Combine a divulgação pública após a análise e a disponibilização de uma correção, quando aplicável.
Não há prazo fixo de resposta ou programa de recompensa.

## Versões

As correções são direcionadas à versão estável mais recente publicada em
[Releases](https://github.com/lucianumm/PJeCalcMCP/releases/latest). Não há manutenção paralela
garantida de versões anteriores. Informe a versão em que encontrou o problema, mesmo que antiga.

## Contexto de uso

O servidor MCP usa **stdio**, é executado localmente no Windows e opera o PJe-Calc da máquina.
Ele pode ler documentos, criar arquivos e alterar cálculos conforme as ferramentas chamadas pelo
assistente. Esse acesso exige confiança no agente e na configuração local; o projeto não oferece
um serviço MCP público nem uma camada de autenticação para acesso remoto.

Exposição indevida de dados, execução de comandos ou alterações de arquivos e cálculos além da
operação solicitada são exemplos relevantes para um relato. Erros de cálculo sem impacto de
segurança podem ser registrados pelo [modelo de falha](https://github.com/lucianumm/PJeCalcMCP/issues/new?template=bug_report.yml),
sempre com dados fictícios.

A instalação do PJe-Calc, os assistentes de IA e suas políticas de envio de dados são componentes
separados. Ao relatar uma falha de integração, indique em qual componente ela se manifesta para
permitir o encaminhamento adequado.
