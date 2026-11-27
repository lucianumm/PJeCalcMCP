// pjecalc-mcp-skill · lib/licenca.mjs
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Required Notice: Copyright (C) 2026 Lucianum (https://github.com/lucianumm)
//
// Aviso de licença exibido pelo servidor (instruções MCP, pjecalc_info, log de início) e pelo
// instalador. Remover ou alterar este aviso viola a licença (veja LICENSE e LICENCA-COMERCIAL.md).

export const LICENCA = Object.freeze({
  spdx: 'PolyForm-Noncommercial-1.0.0',
  nome: 'PolyForm Noncommercial License 1.0.0',
  url: 'https://polyformproject.org/licenses/noncommercial/1.0.0',
  titular: 'Lucianum (https://github.com/lucianumm)',
  copyright: 'Copyright (C) 2026 Lucianum (https://github.com/lucianumm)',
  uso_gratuito: 'Uso não comercial: estudo, pesquisa, ensino, órgãos públicos e entidades beneficentes.',
  uso_comercial: 'Venda, revenda, oferta como serviço pago, uso profissional remunerado e integração a produtos, sistemas ou plataformas comerciais exigem licença comercial do titular.',
  licenca_comercial: 'https://github.com/lucianumm/PJeCalcMCP/blob/main/LICENCA-COMERCIAL.md',
});

/** Aviso curto, em uma linha. */
export function avisoLicenca() {
  return `PJe-Calc MCP · ${LICENCA.copyright} · ${LICENCA.nome} (somente uso não comercial). `
    + `${LICENCA.uso_comercial} Termos: ${LICENCA.licenca_comercial}`;
}
