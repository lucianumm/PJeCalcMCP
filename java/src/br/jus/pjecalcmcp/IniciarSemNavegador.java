package br.jus.pjecalcmcp;

import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/**
 * Inicia o PJe-Calc exatamente como o launcher oficial (br.jus.trt8.pjecalcsa.container.Lancador),
 * mas sem abrir o navegador, sem janela Swing e sem ícone na bandeja.
 *
 * Passos reproduzidos do Lancador.main():
 *   1. caminho.instalacao = diretório atual (raiz do PJe-Calc);
 *   2. configurarVariaveisBase()  -> porta HTTP livre e URL;
 *   3. validarPastaInstalador()   -> confere .dados/pjecalc.h2.db e converte o persistence.xml;
 *   4. new TomCat("tomcat").startTomcat().
 *
 * O launcher oficial fica vivo por causa da janela Swing; aqui a thread principal espera o
 * arquivo de parada ".dados/pjecalc-mcp.parar" (criado pelo MCP) e então encerra o Tomcat de
 * forma ordenada, fechando o banco H2 corretamente.
 *
 * Uso (cwd = raiz do PJe-Calc):
 *   bin\jre\bin\java -cp bin\pjecalc.jar;pjecalc-mcp-skill\java\pjecalc-mcp-bridge.jar
 *        -Duser.timezone=GMT-3 -Dfile.encoding=ISO-8859-1 -Dseguranca.pjecalc.tokenServicos=...
 *        br.jus.pjecalcmcp.IniciarSemNavegador
 */
public class IniciarSemNavegador {
    public static void main(String[] args) throws Exception {
        System.setProperty("caminho.instalacao", new File("").getAbsolutePath());
        File parar = new File(".dados", "pjecalc-mcp.parar");
        if (parar.exists()) parar.delete();

        Class<?> lancador = Class.forName("br.jus.trt8.pjecalcsa.container.Lancador");
        invocarEstatico(lancador, "configurarVariaveisBase");
        invocarEstatico(lancador, "validarPastaInstalador");
        Class<?> tomcat = Class.forName("br.jus.trt8.pjecalcsa.container.TomCat");
        Constructor<?> c = tomcat.getConstructor(String.class);
        final Object tc = c.newInstance("tomcat");
        tomcat.getMethod("startTomcat").invoke(tc);
        final Method stop = tomcat.getMethod("stopTomcat");
        System.out.println("[PJECALC-MCP] Tomcat iniciado sem navegador.");

        while (!parar.exists()) {
            Thread.sleep(1000);
        }
        System.out.println("[PJECALC-MCP] Pedido de parada recebido; encerrando o Tomcat.");
        try {
            stop.invoke(tc);
        } finally {
            parar.delete();
            System.out.println("[PJECALC-MCP] Encerrado.");
            System.exit(0);
        }
    }

    private static void invocarEstatico(Class<?> cls, String nome) throws Exception {
        Method m = cls.getDeclaredMethod(nome);
        m.setAccessible(true);
        m.invoke(null);
    }
}
