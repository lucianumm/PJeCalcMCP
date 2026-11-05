// pjecalc-mcp-skill · lib/anotacoes.mjs
// Anotações MCP de cada ferramenta (readOnlyHint, destructiveHint, idempotentHint, openWorldHint): dizem ao
// assistente o que só lê, o que altera, o que apaga ou sobrescreve e o que acessa a internet.

const LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ESCRITA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const ESCRITA_REPETIVEL = { ...ESCRITA, idempotentHint: true };
const DESTRUTIVA = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const GRUPOS = [
  [LEITURA, [
    'pjecalc_status', 'pjecalc_logs', 'pjecalc_info', 'pjecalc_paginas', 'pjecalc_template_csv',
    'calculo_modelo_json', 'processo_mapa', 'titulo_compor', 'calculo_plano_interpretacao', 'calculo_documentos_necessarios',
    'documento_inventario', 'documento_texto', 'auditor_importar', 'holerites_para_historicos', 'cartoes_para_jornadas', 'extrato_para_fgts', 'trct_para_pagamentos',
    'calculo_validar', 'calculo_ler_pjc', 'calculo_pendencias', 'calculo_recentes', 'calculo_comparar_referencia',
    'catalogo_verbas', 'catalogo_municipios', 'catalogo_assuntos_cnj', 'catalogo_enums', 'catalogo_validar_documentos',
    'catalogo_pisos_vt', 'catalogo_atividades', 'catalogo_feriados', 'catalogo_cartao_ponto',
    'tabelas_status', 'rest_selic_periodo', 'rest_precatorio_atualizar', 'rest_tabelas_ultima_versao', 'rest_tabelas_versao',
    'db_tabelas', 'db_esquema', 'db_consultar', 'config_ler',
  ]],
  // gravam arquivos ou configurações próprias, sem apagar nada
  [ESCRITA_REPETIVEL, [
    'pjecalc_localizar', 'pjecalc_iniciar', 'pjecalc_abrir_interface', 'documento_imagens', 'calculo_relatorio', 'calculo_exportar_pjc',
    'rest_tabelas_sincronizar_nacionais', 'rest_tabelas_sincronizar_regionais',
  ]],
  // criam cálculos ou arquivos novos a cada chamada
  [ESCRITA, [
    'calculo_aprovar_plano', 'calculo_gerar_pjc', 'calculo_importar_pjc', 'calculo_apurar_cartao_ponto', 'calculo_atualizar',
    'calculo_externo_criar', 'db_backup_sql', 'db_backup_arquivo',
  ]],
  // podem baixar as tabelas de índices pela internet (atualizar_tabelas)
  [{ ...ESCRITA, openWorldHint: true }, ['calculo_criar', 'calculo_criar_lote']],
  [{ ...ESCRITA_REPETIVEL, openWorldHint: true }, ['calculo_liquidar']],
  // apagam, encerram ou sobrescrevem dados e configurações
  [DESTRUTIVA, [
    'pjecalc_parar', 'calculo_regerar_ocorrencias', 'calculo_excluir', 'modelos_atualizar', 'rest_precatorios_sip', 'rest_precatorios_sip_indices',
    'db_executar', 'db_restaurar', 'config_portas', 'config_memoria', 'config_token', 'config_datasource',
  ]],
  [{ ...DESTRUTIVA, openWorldHint: true }, ['tabelas_atualizar']],
];

export const ANOTACOES = Object.fromEntries(GRUPOS.flatMap(([anotacao, nomes]) => nomes.map((n) => [n, anotacao])));

/** Anotações da ferramenta, com o título; ferramenta sem classificação é um erro de programação. */
export function anotacoesDe(nome, titulo) {
  const a = ANOTACOES[nome];
  if (!a) throw new Error(`ferramenta "${nome}" sem anotações em lib/anotacoes.mjs`);
  return { ...(titulo ? { title: titulo } : {}), ...a };
}
