// Render-only age progression; a birth never changes collision or movement rules.
export function personAgeScale(ageDays) {
  const years = Math.max(0, Number.isFinite(ageDays) ? ageDays / 365 : 0);
  if (years < 12) return .6 + .4 * years / 12;
  if (years < 65) return 1;
  return 1 - .08 * Math.min(1, (years - 65) / 17);
}

export function personLifeStage(ageDays) {
  const years = Math.max(0, Number.isFinite(ageDays) ? ageDays / 365 : 0);
  if (years < 12) return 'Criança';
  if (years < 18) return 'Adolescente';
  if (years < 65) return 'Adulto';
  return 'Idoso';
}
