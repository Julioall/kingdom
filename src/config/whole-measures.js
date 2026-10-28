export function formatWholeMeasure(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return '0';
  if (amount > 0 && amount < 1) return 'menos de 1';
  return Math.round(amount).toLocaleString('pt-BR');
}
