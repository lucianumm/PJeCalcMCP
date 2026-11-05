// pjecalc-mcp-skill · lib/decimal.mjs
// Aritmética decimal exata (BigInt) para refazer as contas do PJe-Calc: o aplicativo usa BigDecimal com
// precisão de 38 dígitos e arredonda valores monetários para 2 casas com HALF_EVEN.
// Em ponto flutuante, um empate (x,xx5) pode cair do lado errado; aqui não.

const ESCALA = 34; // casas decimais internas (sobra para produtos de índices com 25 casas)
const FATOR = 10n ** BigInt(ESCALA);

/** Converte "123.4500", "0E-25", 12.5 ou null em Decimal (BigInt escalado). */
export function D(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'object' && v.__dec) return v.n;
  let s = String(v).trim();
  if (/e/i.test(s)) {
    const [m, e] = s.toLowerCase().split('e');
    const exp = Number(e);
    const neg = m.startsWith('-');
    const [ip, fp = ''] = m.replace(/^[-+]/, '').split('.');
    let digitos = ip + fp;
    let pontos = fp.length - exp; // casas decimais do resultado
    if (pontos < 0) { digitos += '0'.repeat(-pontos); pontos = 0; }
    s = `${neg ? '-' : ''}${digitos.slice(0, digitos.length - pontos) || '0'}.${digitos.slice(digitos.length - pontos).padStart(pontos, '0')}`;
  }
  const neg = s.startsWith('-');
  const [ip, fp = ''] = s.replace(/^[-+]/, '').split('.');
  const frac = (fp + '0'.repeat(ESCALA)).slice(0, ESCALA);
  const n = BigInt(ip || '0') * FATOR + BigInt(frac || '0');
  return neg ? -n : n;
}

const div = (a, b) => {
  // divisão com arredondamento HALF_EVEN na última casa interna
  const q = a / b; const r = a % b;
  if (r === 0n) return q;
  const dobro = (r < 0n ? -r : r) * 2n; const bb = b < 0n ? -b : b;
  const sinal = (a < 0n) !== (b < 0n) ? -1n : 1n;
  if (dobro > bb || (dobro === bb && (q % 2n !== 0n))) return q + sinal;
  return q;
};

export const soma = (...xs) => xs.reduce((a, x) => a + (x == null ? 0n : x), 0n);
export const sub = (a, b) => (a == null ? 0n : a) - (b == null ? 0n : b);
export const mul = (a, b) => (a == null || b == null ? null : div(a * b, FATOR));
export const dividir = (a, b) => (a == null || b == null || b === 0n ? null : div(a * FATOR, b));
export const pct = (a, taxa) => (a == null || taxa == null ? null : div(a * taxa, FATOR * 100n));
export const max0 = (a) => (a == null ? null : a < 0n ? 0n : a);
export const min = (a, b) => (a == null ? b : b == null ? a : a < b ? a : b);
export const cmp = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

/** Arredonda para `casas` decimais. modo: 'HALF_EVEN' (padrão do PJe-Calc), 'HALF_UP' ou 'DOWN'. */
export function arred(a, casas = 2, modo = 'HALF_EVEN') {
  if (a == null) return null;
  const passo = 10n ** BigInt(ESCALA - casas);
  const q = a / passo; const r = a % passo;
  if (r === 0n) return q * passo;
  const sinal = a < 0n ? -1n : 1n;
  if (modo === 'DOWN') return q * passo;
  const dobro = (r < 0n ? -r : r) * 2n;
  let ajuste = 0n;
  if (dobro > passo) ajuste = sinal;
  else if (dobro === passo) ajuste = modo === 'HALF_UP' || q % 2n !== 0n ? sinal : 0n;
  return (q + ajuste) * passo;
}
export const r2 = (a) => arred(a, 2, 'HALF_EVEN');

/** Correção monetária como no PJe-Calc: índice negativo divide (conversão de moeda); senão multiplica; r2 HALF_EVEN. */
export function corrigir(indice, valor) {
  if (indice == null || valor == null) return valor;
  return r2(indice < 0n ? dividir(valor, -indice) : mul(indice, valor));
}

export const num = (a) => (a == null ? null : Number(a) / Number(FATOR));
export const txt = (a, casas = 2) => {
  if (a == null) return null;
  const v = arred(a, casas, 'HALF_EVEN');
  const neg = v < 0n; const abs = neg ? -v : v;
  const ip = abs / FATOR; const fp = (abs % FATOR).toString().padStart(ESCALA, '0').slice(0, casas);
  return `${neg ? '-' : ''}${ip}${casas ? `.${fp}` : ''}`;
};
export const ZERO = 0n;
