export function chronicleEntry(text) {
  if (/^Nasceu /i.test(text)) return { category: 'Nascimento', text: text.split(';')[0] + '.' };
  if (/morreu|faleceu|morto|morta|perdeu a vida/i.test(text)) return { category: 'Perda', text: text.split('. Valores observados')[0].split(';')[0] };
  // Keep economic accounting and decision traces in the diagnostic log only.
  if (/repass|buffer|piso de seca|biomassa|pontos|comparou .*locais|limiar|deleg|\bIA\b|modelo|inferência|salário|pagamento|reserva.*→/i.test(text)
    && !/^Nasceu /i.test(text)) return null;
  if (/guerra|paz|tratado|captur|conquist|cerco|destru|colaps|batalha/i.test(text)) return { category: 'Conflito', text };
  if (/conclu|fundou|ergueu|construiu|inaugur/i.test(text)) return { category: 'Construção', text };
  if (/abandon|novo rei|coroa|sucedeu|seca|estiagem/i.test(text)) return { category: 'Reino', text };
  return null;
}
