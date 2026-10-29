export const MINERAL_SPRITE_KINDS = ['gold', 'silver', 'copper', 'iron'];
const LARGE_DEPOSIT = { gold: 3.5, silver: 20, copper: 60, iron: 36 };

export function mineralDepositVariant(kind, reserve) {
  return Math.max(2, Math.min(6, 1 + Math.ceil(reserve / LARGE_DEPOSIT[kind] * 5)));
}
