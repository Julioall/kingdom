function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// An explicit alphabet prevents orphan UTF-8 continuation bytes from extending
// a maxLength string forever in the JSON-schema constraint engine.
export function browserDecisionFormat(candidateActions) {
  if (!Array.isArray(candidateActions) || !candidateActions.length) {
    throw new Error('A decisão precisa de pelo menos uma ação permitida.');
  }
  const actions = candidateActions.map(action => escapeRegex(JSON.stringify(action))).join('|');
  return {
    type: 'regex',
    regex: '\\{"action":(' + actions + '),"confidence":(0(\\.[0-9]{1,2})?|1(\\.0{1,2})?),"reason":"'
      + '([A-Za-z0-9 .,;:!?()-]|' + [...'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ'].join('|') + '){0,180}"\\}'
  };
}
