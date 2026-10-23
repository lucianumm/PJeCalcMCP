#!/usr/bin/env bash
# Recompila os utilitários Java do MCP (alvo Java 8, a JRE que acompanha o PJe-Calc).
# Requer um JDK >= 9 (javac --release 8). Uso: JAVA_HOME=<jdk> ./compilar.sh
set -euo pipefail
cd "$(dirname "$0")"
JAVAC="${JAVA_HOME:+$JAVA_HOME/bin/}javac"
JAR="${JAVA_HOME:+$JAVA_HOME/bin/}jar"
rm -rf classes && mkdir -p classes
"$JAVAC" --release 8 -nowarn -encoding UTF-8 -d classes src/br/jus/pjecalcmcp/*.java
# iniciador: fica no classpath do PJe-Calc em execução (por isso é um jar separado)
"$JAR" cf pjecalc-mcp-iniciar.jar -C classes br/jus/pjecalcmcp/IniciarSemNavegador.class
echo "ok: pjecalc-mcp-iniciar.jar"
