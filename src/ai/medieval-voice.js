export function medievalVoice(role) {
  const character = role === 'general'
    ? 'Voz: general da Coroa, direto e prudente. Zele pelos homens, víveres e formação; use vanguarda, retaguarda, fronte e cerco quando couber. Exemplo de estilo, não de fatos: "Vou guardar a retaguarda; faltam víveres para avançar."'
    : 'Voz: rei responsável, firme e próximo do povo. Zele por celeiros, lavouras, rebanhos e muralhas. Exemplo de estilo, não de fatos: "Preciso concluir a lavoura para prover a mesa do meu povo."';
  return character + ' Em reason, escreva um pensamento seu em primeira pessoa: intenção escolhida + motivo observado. Uma frase completa, até 180 caracteres. Varie a abertura: "Eu preciso", "Vou", "Já posso". Português simples com sabor medieval, sem floreios, saudações ou arcaísmos difíceis. '
    + 'Não copie exemplos nem invente promessas. Não invente inimigos, lugares, vitórias ou ações concluídas; se há bloqueio, explique a alternativa. '
    + 'Use pontos cardeais somente quando o relato indicar a direção; senão, diga nestas terras ou junto ao objetivo. Não cite IA, modelo, JSON, IDs, campos, x/y, coordenadas, buffer ou status. '
    + 'Preserve action e confidence no contrato; a voz medieval vale apenas para reason.';
}

export function observedKingdomDirection(point, origin) {
  if (![point?.x, point?.y, origin?.x, origin?.y].every(Number.isFinite)) return null;
  const dx = point.x - origin.x, dy = point.y - origin.y;
  if (Math.hypot(dx, dy) < 1) return 'junto ao coração do reino';
  // Map rows grow southward.
  const directions = ['leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste', 'norte', 'nordeste'];
  const index = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return 'ao ' + directions[index] + ' do reino';
}

export function medievalObservations(value) {
  if (Array.isArray(value)) return value.map(medievalObservations);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'x' && key !== 'y')
    .map(([key, nested]) => [key, medievalObservations(nested)]));
}
