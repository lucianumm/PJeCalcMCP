// pjecalc-mcp-skill · lib/esquema.mjs
// Campos aceitos em cada bloco da especificação. O gerador recusa qualquer campo fora desta lista
// (nada é ignorado em silêncio). Campos iniciados por "_" são anotações livres (ex.: "_fonte",
// "_premissa", "_folha") e não entram no cálculo.

const INCIDENCIAS = { chaves: ['inss', 'irpf', 'fgts', 'previdenciaPrivada', 'pensaoAlimenticia'] };
const PERIODO = { chaves: ['inicio', 'fim'] };
const FAIXA = { chaves: ['de', 'ate', 'competencia', 'valor', 'fgts', 'inss', 'fgtsRecolhido', 'inssRecolhido'] };
const DE_ATE = { chaves: ['de', 'ate'] };
const TURNO = { chaves: ['entrada', 'saida'] };
// atualização da contribuição social (Correção, Juros e Multa > Dados Específicos), salários devidos ou pagos
const ATUALIZACAO_CS = {
  chaves: ['lei11941', 'lei11941APartirDe', 'limitarMulta', 'limitarMultaAPartirDe', 'correcaoTrabalhista', 'jurosTrabalhistas', 'aplicarAte',
    'correcaoPrevidenciaria', 'jurosPrevidenciarios', 'formaAplicacao', 'multa', 'tipoMulta', 'pagamentoMulta'],
};

// parâmetros comuns a verbas principais e reflexos (entidade VerbaDeCalculo)
const COMUNS_VERBA = ['origem', 'incidencias', 'caracteristica', 'ocorrenciaDePagamento', 'jurosDoAjuizamento', 'gerarPrincipal', 'gerarReflexo',
  'comporPrincipal', 'zerarNegativo', 'excluirFaltasJustificadas', 'excluirFaltasNaoJustificadas', 'excluirFeriasGozadas', 'variavel',
  'comentarios', 'assuntoCnj', 'avancado'];
const FORMULA_VERBA = ['base', 'divisor', 'multiplicador', 'quantidade', 'valor', 'proporcionalizar', 'valorPago', 'dobra', 'ocorrencias'];
const EDICAO_OCORRENCIA = { lista: { chaves: ['competencia', 'data', 'aquisitivo', 'indenizadas', 'pago', 'quantidade', 'devido', 'divisor', 'multiplicador', 'dobra', 'ativo', 'origem'] } };
const FILHOS_VERBA = {
  ocorrencias: EDICAO_OCORRENCIA,
  incidencias: INCIDENCIAS,
  base: { chaves: ['tipo', 'historicos', 'proporcionalizar', 'verbas', 'integralizar', 'piso', 'valesTransporte'], filhos: { verbas: { lista: { chaves: ['nome', 'integralizar'] } } } },
  divisor: { chaves: ['tipo', 'valor', 'cartao'] },
  quantidade: { chaves: ['tipo', 'valor', 'proporcionalizar', 'calendario', 'cartao'] },
  valorPago: { chaves: ['tipo', 'valor', 'quantidade', 'proporcionalizar', 'historicos', 'base', 'origem', 'piso', 'valesTransporte'] },
  periodo: PERIODO,
};
export const ESQUEMA_REFLEXO = {
  chaves: ['nome', 'comportamento', 'periodoMedia', 'fracaoDeMes', 'periodo', 'proporcionalizar', 'valorPago', 'ocorrencias', ...COMUNS_VERBA],
  filhos: { incidencias: INCIDENCIAS, periodo: PERIODO, valorPago: FILHOS_VERBA.valorPago, ocorrencias: EDICAO_OCORRENCIA },
};
const VERBA = {
  chaves: ['verba', 'nome', 'descricao', 'periodo', 'data', 'personalizada', 'reflexos', ...FORMULA_VERBA, ...COMUNS_VERBA],
  filhos: {
    ...FILHOS_VERBA,
    personalizada: { chaves: ['modelo', 'nome', 'descricao', 'data', ...FORMULA_VERBA, ...COMUNS_VERBA], filhos: FILHOS_VERBA },
    reflexos: { lista: ESQUEMA_REFLEXO },
  },
};

const PARTE = { chaves: ['nome', 'cpf', 'cnpj', 'cei', 'pis', 'pasep', 'nit'] };
const ADVOGADO = { chaves: ['nome', 'oab', 'cpf', 'cnpj'] };
const CUSTA = { chaves: ['tipo', 'valor', 'vencimento'] };
// custas fixas da tela Custas Judiciais: quantidades de atos e recursos (valores da tabela de custas na data do vencimento)
const CUSTAS_FIXAS = { chaves: ['vencimento', 'atosUrbanos', 'atosRurais', 'agravosDeInstrumento', 'agravosDePeticao', 'impugnacaoSentenca',
  'embargosArrematacao', 'embargosExecucao', 'embargosTerceiros', 'recursoRevista'] };
// ocorrências de FGTS e de contribuição social: uma competência ou um intervalo (alteração em lote da tela)
const SELETOR_ENCARGO = ['competencia', 'de', 'ate', 'origem'];
const OCORRENCIA_FGTS = { lista: { chaves: [...SELETOR_ENCARGO, 'base', 'depositado', 'aliquota'] } };
const OCORRENCIAS_CS = {
  chaves: ['salariosDevidos', 'salariosPagos'],
  filhos: {
    salariosDevidos: { lista: { chaves: [...SELETOR_ENCARGO, 'decimoTerceiro', 'base'] } },
    salariosPagos: { lista: { chaves: [...SELETOR_ENCARGO, 'decimoTerceiro', 'base', 'recolhidoSegurado', 'recolhidoEmpresa', 'recolhidoSat', 'recolhidoTerceiros'] } },
  },
};
const SALARIO_PAGO = ['tipoSalarioPago', 'historicos', 'verbas'];

// Contrato de dados auditável (references/CONTRATO-DE-DADOS.md): a prova e as decisões do processo,
// com ids que as verbas, reflexos, históricos e abatimentos citam em "origem".
const PERIODO_C = { chaves: ['inicio', 'fim'] };
export const ESQUEMA_CONTRATO = {
  chaves: ['documentos', 'decisoes', 'parcelas', 'afastamentos', 'remuneracoes', 'pagamentos', 'premissas', 'dataLiquidacao', 'zerosJustificados',
    'revisoesDeAlerta', 'referencia', 'coleta', 'processos', 'fases', 'devedores', 'destinosDoCredito', 'pagamentosExecucao', 'aprovacao',
    'leitura', 'confrontos', 'pedidos', 'posicao'],
  filhos: {
    // leitura integral (lib/leitura.mjs): classificação de todas as folhas, fechamentos, confrontos, pedidos × decisão
    leitura: {
      lista: {
        chaves: ['documento', 'classificacao', 'lidaComoImagem', 'fechamentos', 'observacao'],
        filhos: {
          classificacao: { chaves: ['usadas', 'irrelevantes', 'ilegiveis'], filhos: { irrelevantes: { lista: { chaves: ['folhas', 'motivo'] } }, ilegiveis: { lista: { chaves: ['folhas', 'motivo'] } } } },
          fechamentos: { lista: { chaves: ['tipo', 'referencia', 'ok', 'detalhe', 'resolucao'] } },
        },
      },
    },
    confrontos: { lista: { chaves: ['tipo', 'documentos', 'ok', 'detalhe', 'resolucao'] } },
    pedidos: { lista: { chaves: ['pedido', 'documento', 'folha', 'situacao', 'decisao', 'observacao'] } },
    // periodo + lacunas: meses que o documento cobre (holerites, cartões, extratos), para conferir a cobertura
    documentos: { lista: { chaves: ['id', 'processo', 'tipo', 'identificacao', 'paginas', 'data', 'descricao', 'sha256', 'periodo', 'lacunas'], filhos: { periodo: PERIODO_C } } },
    // pedidos de documento ao usuário: o que foi pedido, por quê, e se chegou
    coleta: { lista: { chaves: ['id', 'processo', 'requisito', 'documento', 'motivo', 'parcelas', 'impacto', 'status', 'fundamento', 'recebidoComo', 'solicitadoEm', 'observacao'] } },
    // todas as decisões de todas as instâncias (vara, TRT, TST, STF, liquidação, execução), por capítulo
    decisoes: {
      lista: {
        chaves: ['id', 'processo', 'documento', 'instancia', 'tipo', 'recurso', 'recorrida', 'resultado', 'folha', 'trecho', 'altera', 'data', 'publicacao',
          'capitulos', 'transito', 'recursos', 'conflitos', 'precedentes'],
        filhos: {
          capitulos: { lista: { chaves: ['parcela', 'criterio', 'efeito', 'situacao', 'folha', 'trecho', 'detalhe'] } },
          recursos: { lista: { chaves: ['tipo', 'por', 'objeto', 'situacao', 'julgadoPor', 'interpostoEm'] } },
          conflitos: { lista: { chaves: ['id', 'descricao', 'resolucao', 'decisao'] } },
        },
      },
    },
    // mapa do processo: o principal (fase e trabalho) e os processos ligados, com o efeito de cada um
    processos: {
      lista: {
        chaves: ['id', 'numero', 'relacao', 'fase', 'trabalho', 'situacao', 'partes', 'reclamantes', 'efeito', 'documentos', 'justificativaRecalculo', 'observacao'],
        filhos: {
          efeito: { chaves: ['nenhum', 'motivo', 'exclui', 'abate', 'prescricao', 'titulo', 'dataLimite', 'suspende', 'admitidaPor', 'observacao'] },
          justificativaRecalculo: { chaves: ['decisao', 'motivo'] },
        },
      },
    },
    fases: { lista: { chaves: ['processo', 'evento', 'data', 'documento', 'folha', 'observacao'] } },
    devedores: {
      lista: {
        chaves: ['id', 'nome', 'cnpj', 'cpf', 'responsabilidade', 'periodo', 'entePublico', 'recuperacaoJudicial', 'falencia', 'documento', 'decisao'],
        filhos: { periodo: PERIODO_C, recuperacaoJudicial: { chaves: ['dataLimite', 'processo'] }, falencia: { chaves: ['dataLimite', 'processo'] } },
      },
    },
    destinosDoCredito: { lista: { chaves: ['id', 'tipo', 'beneficiario', 'valor', 'percentual', 'documento', 'decisao', 'observacao'] } },
    pagamentosExecucao: { lista: { chaves: ['id', 'tipo', 'data', 'valor', 'documento', 'folha', 'devedor', 'observacao'] } },
    aprovacao: { chaves: ['por', 'em', 'observacoes', 'hashContrato'] },
    parcelas: { lista: { chaves: ['id', 'rubrica', 'situacao', 'decisao', 'folha', 'trecho', 'periodo', 'reflexos', 'premissas', 'naoCalcular', 'observacao'], filhos: { periodo: PERIODO_C } } },
    // evento: o que o documento registra (natureza), o que o processo reconheceu (decisao) e o efeito no cálculo
    afastamentos: {
      lista: {
        chaves: ['id', 'tipo', 'natureza', 'inicio', 'fim', 'motivo', 'documento', 'folha', 'trecho', 'decisao', 'efeito', 'conflitos', 'resolucao', 'premissas'],
        filhos: { conflitos: { lista: { chaves: ['id', 'descricao', 'documento', 'folha'] } } },
      },
    },
    remuneracoes: { lista: { chaves: ['id', 'componente', 'de', 'ate', 'valor', 'documento', 'folha', 'trecho', 'componentes', 'formula', 'arredondamento', 'premissas'] } },
    // pagamento original (com documento) ou alocação derivada ("derivadoDe"): o consumo somado não passa do original
    pagamentos: {
      lista: {
        chaves: ['id', 'titulo', 'parcelas', 'competencia', 'periodo', 'avos', 'data', 'valor', 'emitente', 'documento', 'folha', 'trecho', 'componentes',
          'derivadoDe', 'comando', 'premissas', 'emitenteAceito'],
        // pagamento feito por terceiro (outra empresa do grupo, tomador...) aceito como pagamento do reclamado
        filhos: { periodo: PERIODO_C, emitenteAceito: { chaves: ['motivo', 'decisao', 'folha', 'premissas'] } },
      },
    },
    // alternativas: as leituras que o título admite (uma marcada "favoravel" à parte de contrato.posicao);
    // criterio: por que a leitura adotada foi escolhida (MAIS_FAVORAVEL, COMANDO_EXPRESSO ou ESCOLHA_DO_USUARIO)
    premissas: { lista: { chaves: ['id', 'texto', 'status', 'documento', 'folha', 'trecho', 'fundamento', 'alternativas', 'criterio'], filhos: { alternativas: { lista: { chaves: ['texto', 'efeito', 'favoravel'] } } } } },
    zerosJustificados: { lista: { chaves: ['verba', 'motivo', 'fundamento', 'decisao'] } },
    revisoesDeAlerta: { lista: { chaves: ['item', 'conclusao', 'fundamento', 'responsavel', 'impacto', 'data'] } },
    referencia: { chaves: ['arquivo', 'identificacao', 'sha256', 'dataBase', 'versao', 'criterios', 'limitacoes'] },
  },
};

// fase de execução (lib/execucao.mjs): pagamentos e eventos da atualização de um cálculo liquidado
const COMPONENTES_VINCULO = { lista: { chaves: ['descricao', 'credor', 'valor', 'apurar'] } };
export const ESQUEMA_EXECUCAO = {
  chaves: ['dataAtualizacao', 'identificacao', 'comentarios', 'cobrarEncargosIrpf', 'precatorio', 'pagamentos', 'honorarios', 'multas', 'pensao', 'custas', 'origem'],
  filhos: {
    precatorio: { chaves: ['tipo', 'esfera', 'periodoGraca', 'ec136APartirDe'], filhos: { periodoGraca: { chaves: ['inicio', 'fim'] } } },
    // pensão alimentícia a partir de uma data (Pagamento > Pensão Alimentícia); principal* só no Cálculo Externo
    pensao: { chaves: ['dataEvento', 'aliquota', 'incidirSobreJuros', 'folha', 'verbas', 'fgts', 'multaFgts', 'principalTributavel', 'principalNaoTributavel', 'origem'] },
    // custas da execução (Pagamento > Custas Judiciais): por ato do art. 789-A da CLT, autos e armazenamento
    custas: {
      chaves: ['folha', 'fixas', 'autos', 'armazenamentos', 'origem'],
      filhos: {
        fixas: { lista: CUSTAS_FIXAS },
        autos: { lista: { chaves: ['tipo', 'vencimento', 'valor', 'origem'] } },
        armazenamentos: { lista: { chaves: ['inicio', 'fim', 'valor', 'origem'] } },
      },
    },
    pagamentos: {
      lista: {
        chaves: ['data', 'valor', 'folha', 'origem', 'priorizarJuros', 'precatorio', 'creditoReclamante', 'credito', 'recolher', 'outrosDebitosReclamado', 'outros', 'debitosCobrarReclamante', 'cobrar'],
        filhos: {
          credito: { chaves: ['principal', 'fgts', 'multasReclamante', 'multasReclamado'] },
          recolher: { chaves: ['custas', 'depositoFgts', 'contribuicaoSocial', 'previdenciaPrivada', 'pensao', 'imposto', 'multas', 'honorarios'], filhos: { multas: COMPONENTES_VINCULO, honorarios: COMPONENTES_VINCULO } },
          outros: { chaves: ['custas', 'inssSalariosDevidos', 'inssSalariosPagos', 'jurosPrevidenciaPrivada', 'impostoRenda', 'inss10', 'inss05', 'multas', 'honorarios'], filhos: { multas: COMPONENTES_VINCULO, honorarios: COMPONENTES_VINCULO } },
          cobrar: { chaves: ['custas', 'multas', 'honorarios'], filhos: { multas: COMPONENTES_VINCULO, honorarios: COMPONENTES_VINCULO } },
        },
      },
    },
    honorarios: { lista: { chaves: ['tipo', 'origem', 'descricao', 'devedor', 'credor', 'percentual', 'base', 'verbas', 'valor', 'dataVencimento', 'apurarIrrf', 'tipoImpostoRenda', 'irSobreJuros', 'indiceCorrecao', 'aplicarJuros', 'jurosAPartirDe', 'cobrancaReclamante', 'avancado', 'dataEvento', 'folha'], filhos: { credor: { chaves: ['nome', 'cpf', 'cnpj'] } } } },
    multas: { lista: { chaves: ['descricao', 'origem', 'credorDevedor', 'nomeTerceiro', 'percentual', 'base', 'valor', 'dataVencimento', 'indiceCorrecao', 'aplicarJuros', 'jurosAPartirDe', 'avancado', 'dataEvento', 'folha'] } },
  },
};

export const ESQUEMA = {
  chaves: ['processo', 'calculo', 'historicosSalariais', 'faltas', 'ferias', 'cartoesDePonto', 'apuracaoCartaoPonto', 'verbas', 'fgts',
    'contribuicaoSocial', 'irpf', 'pensaoAlimenticia', 'previdenciaPrivada', 'salarioFamilia', 'seguroDesemprego', 'honorarios', 'multas',
    'custas', 'correcaoJuros', 'exigirDecisoesExplicitas', 'contrato', 'cenario', 'exigirContrato', 'exigirDocumentacaoCompleta', 'execucao'],
  filhos: {
    execucao: ESQUEMA_EXECUCAO,
    contrato: ESQUEMA_CONTRATO,
    cenario: {
      chaves: ['nome', 'descricao', 'hipoteses', 'premissasAlteradas', 'premissasFixas', 'pendencias'],
      filhos: { premissasAlteradas: { lista: { chaves: ['id', 'valor', 'descricao'] } }, premissasFixas: { lista: { chaves: ['id', 'motivo'] } } },
    },
    processo: {
      chaves: ['numero', 'valorCausa', 'autuadoEm', 'reclamante', 'reclamado', 'advogadosReclamante', 'advogadosReclamado'],
      filhos: { reclamante: PARTE, reclamado: PARTE, advogadosReclamante: { lista: ADVOGADO }, advogadosReclamado: { lista: ADVOGADO } },
    },
    calculo: {
      chaves: ['uf', 'estado', 'municipio', 'admissao', 'demissao', 'ajuizamento', 'inicio', 'fim', 'maiorRemuneracao', 'ultimaRemuneracao',
        'criarHistoricoUltimaRemuneracao', 'historicoUltimaRemuneracao', 'cargaHoraria', 'sabadoDiaUtil', 'feriadosEstaduais', 'feriadosMunicipais',
        'prescricaoQuinquenal', 'prescricaoFgts', 'limitarAvos', 'zerarNegativos', 'avisoPrevio', 'regime', 'tipo', 'indicesAcumulados',
        'excecoesCargaHoraria', 'excecoesSabado', 'fechamentoCartao', 'pontosFacultativos', 'comentarios', 'avancado'],
      filhos: {
        fechamentoCartao: { chaves: ['dia', 'excecoes'], filhos: { excecoes: { lista: { chaves: ['de', 'ate', 'dia'] } } } },
        avisoPrevio: { chaves: ['apuracao', 'projetar', 'prazoDias'] },
        historicoUltimaRemuneracao: { chaves: ['criar', 'inss', 'fgts', 'proporcionalizarInss', 'de', 'ate'] },
        excecoesCargaHoraria: { lista: { chaves: ['inicio', 'fim', 'cargaHoraria'] } },
        excecoesSabado: { lista: PERIODO },
      },
    },
    historicosSalariais: {
      lista: {
        chaves: ['nome', 'origem', 'fgts', 'inss', 'proporcionalizarFgts', 'proporcionalizarInss', 'variavel', 'fgtsRecolhido', 'inssRecolhido', 'valores', 'ocorrencias'],
        filhos: { valores: { lista: FAIXA }, ocorrencias: { lista: FAIXA } },
      },
    },
    faltas: { lista: { chaves: ['inicio', 'fim', 'justificada', 'justificativa', 'reiniciaPeriodoAquisitivo', 'origem'] } },
    ferias: {
      chaves: ['gerar', 'periodos', 'prazoProporcionais'],
      filhos: { periodos: { lista: { chaves: ['relativa', 'situacao', 'prazo', 'dobra', 'abono', 'diasAbono', 'gozos', 'origem'], filhos: { gozos: { lista: { chaves: ['inicio', 'fim', 'dobra'] } } } } } },
    },
    cartoesDePonto: { lista: { chaves: ['nome', 'valores', 'ocorrencias'], filhos: { valores: { lista: FAIXA }, ocorrencias: { lista: FAIXA } } } },
    apuracaoCartaoPonto: {
      listaOuObjeto: {
        chaves: ['inicio', 'fim', 'criterio', 'jornadaDiaria', 'jornadaSemanal', 'jornadaMensal', 'limiteSumula85', 'primeirasHorasExtras',
          'preenchimento', 'programacao', 'escala', 'jornadas', 'considerarFeriados', 'tolerancia', 'horarioNoturno', 'apurarHorasNoturnas',
          'apurarHorasExtrasNoturnas', 'reducaoFicta', 'prorrogacaoSumula60', 'forcarProrrogacao', 'extraDescansoSeparado', 'extraFeriadoSeparado',
          'extraSabadoDomingoSeparado', 'apurarFeriadosTrabalhados', 'apurarSabadosDomingosTrabalhados', 'apurarDomingosTrabalhados',
          'jornadaDiariaFeriadoTrabalhado', 'jornadaDiariaFeriadoNaoTrabalhado', 'intervaloIntrajornada', 'intervaloInterjornadas', 'art253', 'art384',
          'art72', 'avancado'],
        filhos: {
          jornadaDiaria: { chaves: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo', 'segundaASexta'] },
          programacao: { chaves: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo', 'segundaASexta', 'feriados', 'feriado'] },
          escala: { chaves: ['tipo', 'inicio', 'ciclo'] },
          jornadas: { lista: { chaves: ['data', 'turnos'] } },
          tolerancia: { chaves: ['porTurno', 'porDia'] },
          intervaloIntrajornada: { chaves: ['acimaDe4ate6', 'acimaDe6', 'tolerancia', 'supressaoIntegral', 'supressaoReforma', 'fracionamento', 'excessoMaximo', 'apenasExcessoAcimaJornada'] },
          intervaloInterjornadas: { chaves: ['entreJornadas', 'entreSemanas'] },
          art253: { chaves: ['trabalho', 'descanso'] },
        },
      },
    },
    verbas: { lista: VERBA },
    fgts: {
      chaves: ['destino', 'aliquota', 'multa', 'percentualMulta', 'valorMultaInformado', 'incidenciaMulta', 'excluirAvisoDaMulta', 'multaArt467',
        'multa10', 'contribuicaoSocial05', 'incidenciaPensaoAlimenticia', 'comporPrincipal', 'periodo', 'operacoes', 'deduzir', 'ocorrencias', 'avancado'],
      filhos: { periodo: PERIODO, operacoes: { lista: { chaves: ['data', 'competencia', 'valor', 'tipo', 'origem'] } }, ocorrencias: OCORRENCIA_FGTS },
    },
    contribuicaoSocial: {
      chaves: ['apurarSegurado', 'cobrarDoReclamante', 'corrigirDescontoReclamante', 'limitarTeto', 'apurarSobreSalariosPagos', 'tipoAliquotaSegurado',
        'aliquotaSeguradoFixa', 'tipoAliquotaEmpregador', 'aliquotaEmpresa', 'aliquotaRat', 'aliquotaTerceiros', 'aliquotasPorPeriodo', 'periodosSimples',
        'atividadeEconomica', 'apurarEmpresaPorAtividade', 'apurarRatPorAtividade', 'apurarTerceirosPorAtividade', 'ocorrencias', 'avancado'],
      filhos: { aliquotasPorPeriodo: { lista: { chaves: ['de', 'ate', 'empresa', 'rat', 'terceiros'] } }, periodosSimples: { lista: DE_ATE }, ocorrencias: OCORRENCIAS_CS },
    },
    irpf: {
      chaves: ['apurar', 'incidirSobreJuros', 'cobrarDoReclamado', 'tributacaoExclusiva', 'tributacaoEmSeparado', 'regimeDeCaixa', 'deduzirContribuicaoSocial',
        'deduzirPrevidenciaPrivada', 'deduzirPensaoAlimenticia', 'deduzirHonorarios', 'aposentadoMaior65', 'dependentes', 'avancado'],
    },
    pensaoAlimenticia: { chaves: ['apurar', 'aliquota', 'incidirSobreJuros', 'avancado'] },
    previdenciaPrivada: { chaves: ['apurar', 'aliquota', 'aliquotas', 'avancado'], filhos: { aliquotas: { lista: { chaves: ['de', 'ate', 'aliquota'] } } } },
    salarioFamilia: {
      chaves: ['apurar', 'filhos', 'inicio', 'fim', 'variacoes', 'comporPrincipal', ...SALARIO_PAGO, 'avancado'],
      filhos: { variacoes: { lista: { chaves: ['aPartirDe', 'filhos'] } }, verbas: { lista: { chaves: ['nome', 'integralizar'] } } },
    },
    seguroDesemprego: {
      chaves: ['apurar', 'solicitacao', 'parcelas', 'valor', 'empregadoDomestico', 'comporPrincipal', ...SALARIO_PAGO, 'avancado'],
      filhos: { verbas: { lista: { chaves: ['nome', 'integralizar'] } } },
    },
    honorarios: {
      lista: {
        chaves: ['tipo', 'origem', 'descricao', 'devedor', 'credor', 'percentual', 'base', 'verbas', 'valor', 'dataVencimento', 'apurarIrrf', 'tipoImpostoRenda', 'irSobreJuros',
          'indiceCorrecao', 'aplicarJuros', 'jurosAPartirDe', 'cobrancaReclamante', 'avancado'],
        filhos: { credor: { chaves: ['nome', 'cpf', 'cnpj'] } },
      },
    },
    multas: {
      lista: {
        chaves: ['descricao', 'origem', 'credorDevedor', 'nomeTerceiro', 'percentual', 'base', 'valor', 'dataVencimento', 'indiceCorrecao', 'aplicarJuros',
          'jurosAPartirDe', 'avancado'],
      },
    },
    custas: {
      chaves: ['base', 'reclamado', 'reclamante', 'liquidacao', 'cobrancaReclamante', 'fixas', 'autos', 'armazenamentos', 'avancado'],
      filhos: {
        reclamado: CUSTA, reclamante: CUSTA, liquidacao: CUSTA, fixas: CUSTAS_FIXAS,
        autos: { lista: { chaves: ['tipo', 'vencimento', 'valor', 'origem'] } },
        armazenamentos: { lista: { chaves: ['inicio', 'fim', 'valor', 'origem'] } },
      },
    },
    correcaoJuros: {
      chaves: ['origem', 'precedentes', 'indice', 'combinacoesIndice', 'juros', 'jurosFasePreJudicial', 'combinacoesJuros', 'baseJuros', 'indiceFgts', 'jurosFgtsComJam',
        'ignorarTaxaNegativa', 'previdenciaPrivada', 'custas', 'contribuicaoSocial', 'avancado'],
      filhos: {
        combinacoesIndice: { lista: { chaves: ['indice', 'aPartirDe'] } },
        combinacoesJuros: { lista: { chaves: ['juros', 'aPartirDe'] } },
        previdenciaPrivada: { chaves: ['juros', 'indice'] },
        custas: { chaves: ['correcao', 'juros', 'indice'] },
        contribuicaoSocial: { chaves: ['salariosDevidos', 'salariosPagos'], filhos: { salariosDevidos: ATUALIZACAO_CS, salariosPagos: ATUALIZACAO_CS } },
      },
    },
  },
};

const objetoSimples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Confere `valor` contra `esquema`; devolve a lista de erros ("campo X não existe em Y (aceitos: ...)"). */
export function conferirEsquema(valor, esquema = ESQUEMA, ctx = 'especificação', erros = []) {
  if (!esquema || valor === null || valor === undefined) return erros;
  if (esquema.lista || esquema.listaOuObjeto) {
    const item = esquema.lista || esquema.listaOuObjeto;
    if (Array.isArray(valor)) valor.forEach((x, i) => conferirEsquema(x, item, `${ctx}[${i}]`, erros));
    else if (esquema.listaOuObjeto) conferirEsquema(valor, item, ctx, erros);
    return erros;
  }
  if (!objetoSimples(valor)) return erros;
  // "avancado" tem validação própria (nomes dos campos Java da entidade)
  for (const k of Object.keys(valor)) {
    if (k.startsWith('_')) continue;
    if (!esquema.chaves.includes(k)) erros.push(`${ctx}: o campo "${k}" não existe (aceitos: ${esquema.chaves.join(', ')}). Para anotações use um nome iniciado por "_".`);
  }
  for (const [k, sub] of Object.entries(esquema.filhos || {})) {
    if (valor[k] !== undefined && k !== 'avancado') conferirEsquema(valor[k], sub, `${ctx}.${k}`, erros);
  }
  return erros;
}
