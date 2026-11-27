#!/usr/bin/env bash
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
# Required Notice: Copyright (C) 2026 Lucianum (https://github.com/lucianumm)
# Uso comercial exige licença do titular: veja LICENSE e LICENCA-COMERCIAL.md.
# Recompila os utilitários Java do MCP (alvo Java 8, a JRE que acompanha o PJe-Calc).
# Requer um JDK >= 9 (javac --release 8). Uso: JAVA_HOME=<jdk> ./compilar.sh
set -euo pipefail
cd "$(dirname "$0")"
JAVAC="${JAVA_HOME:+$JAVA_HOME/bin/}javac"
JAR="${JAVA_HOME:+$JAVA_HOME/bin/}jar"
rm -rf classes && mkdir -p classes
"$JAVAC" --release 8 -nowarn -encoding UTF-8 -d classes src/br/jus/pjecalcmcp/*.java
# iniciador: fica no classpath do PJe-Calc em execução (por isso é um jar separado)
mkdir -p classes/META-INF && cp ../LICENSE classes/META-INF/LICENSE
"$JAR" cf pjecalc-mcp-iniciar.jar -C classes br/jus/pjecalcmcp/IniciarSemNavegador.class -C classes META-INF/LICENSE
echo "ok: pjecalc-mcp-iniciar.jar"
