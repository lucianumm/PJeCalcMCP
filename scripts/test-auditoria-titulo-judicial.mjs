// Testes offline: exceções documentais vinculadas ao título, sem dispensas globais.
import assert from 'node:assert/strict';
import { avaliarDocumentacao } from '../server/lib/documentos.mjs';
import { comporTitulo } from '../server/lib/titulo.mjs';

const base = () => ({
  calculo: { admissao: '2016-08-01', demissao: '2017-07-31' },
  historicosSalariais: [{ nome: 'SALARIO BASE', valores: [{ de: '2016-08', ate: '2017-07', valor: 937 }] }],
  contrato: {
    processos: [{ id: 'PR0', numero: '0001690-13.2017.5.05.0161', relacao: 'PRINCIPAL', fase: 'LIQUIDACAO' }],
    documentos: [
      { id: 'D1', tipo: 'SENTENCA' },
      { id: 'D4', tipo: 'HOLERITES', periodo: { inicio: '2017-06', fim: '2017-06' } },
      { id: 'D6', tipo: 'ACORDAO_TRT' },
    ],
    remuneracoes: [{ id: 'R1', componente: 'SALARIO_FIXO', documento: 'D1', de: '2016-08', ate: '2017-07', valor: 937 }],
    parcelas: [{ id: 'P4', rubrica: 'FÉRIAS + 1/3', situacao: 'DEFERIDA', decisao: 'DEC1' }],
    decisoes: [
      { id: 'DEC1', documento: 'D1', tipo: 'SENTENCA', instancia: 'VARA', transito: '2026-10-22', processo: 'PR0',
        capitulos: [{ parcela: 'P4', efeito: 'DEFERE' }] },
      { id: 'DEC2', documento: 'D6', tipo: 'ACORDAO', instancia: 'TRT_TURMA', recorrida: 'DEC1', resultado: 'DESPROVIDO',
        processo: 'PR0', publicacao: '2019-02-19', transito: '2026-10-22', capitulos: [{ parcela: 'P4', efeito: 'MANTEM' }] },
    ],
  },
});
const requisito = (s, id) => avaliarDocumentacao(s).requisitos.find((r) => r.id === id);
const falhasPub = (s) => comporTitulo(s).verificacoes.filter((v) => v.item === 'decisão DEC1' && v.detalhe.includes('publicação'));
const positivo = base();
assert.equal(requisito(positivo, 'SALARIOS').status, 'ok');
assert.match(requisito(positivo, 'SALARIOS').detalhe, /não comprova pagamentos/);
assert.equal(requisito(positivo, 'FERIAS').status, 'ok');
assert.equal(falhasPub(positivo).length, 1);
assert.equal(falhasPub(positivo)[0].estado, 'alerta');

const divergente = base();
divergente.historicosSalariais[0].valores[0].valor = 936;
assert.notEqual(requisito(divergente, 'SALARIOS').status, 'ok');

const semTitulo = base();
semTitulo.contrato.remuneracoes[0].documento = 'D4';
assert.notEqual(requisito(semTitulo, 'SALARIOS').status, 'ok');

const gozo = base();
gozo.contrato.afastamentos = [{ id: 'A1', tipo: 'FERIAS', inicio: '2017-02-01', fim: '2017-02-10' }];
assert.notEqual(requisito(gozo, 'FERIAS').status, 'ok');

const pago = base();
pago.contrato.pagamentos = [{ id: 'PG1', rubrica: 'FÉRIAS + 1/3', valor: 937 }];
assert.notEqual(requisito(pago, 'FERIAS').status, 'ok');

const semTransito = base();
delete semTransito.contrato.decisoes[0].transito;
assert.equal(falhasPub(semTransito)[0].estado, 'falha');

const acordoSemData = base();
delete acordoSemData.contrato.decisoes[1].publicacao;
assert.equal(falhasPub(acordoSemData)[0].estado, 'falha');
assert(comporTitulo(acordoSemData).verificacoes.some((v) => v.item === 'decisão DEC2' && v.estado === 'falha'));
