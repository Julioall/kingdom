export function chronicleEntry(text) {
  if (/^Nasceu /i.test(text)) return { category: 'Nascimento', text: text.split(';')[0] + '.' };
  if (/morreu|faleceu|morto|morta|perdeu a vida/i.test(text)) return { category: 'Perda', text: text.split('. Valores observados')[0].split(';')[0] };
  // Keep internal accounting and decision details out of the player journal.
  if (/repass|buffer|piso de seca|biomassa|pontos|comparou .*locais|limiar|deleg|\bIA\b|modelo|inferência|salário|pagamento|reserva.*→/i.test(text)
    && !/^Nasceu /i.test(text)) return null;
  if (/(?:progressão de .* foi pausada|progressão de .* retomou|treinamento de .* foi pausado|treinamento de .* retomou)/i.test(text))
    return { category: 'Reino', text };
  if (/^Nascimento (?:adiado|retomado) /i.test(text)) return { category: 'Reino', text };
  if (/guerra|paz|tratado|captur|conquist|cerco|destru|colaps|batalha/i.test(text)) return { category: 'Conflito', text };
  if (/retirou da obra|pausa preventiva protegeu|pausa preventiva encerrada|retomou a obra|vaga liberada para substituto/i.test(text))
    return { category: 'Construção', text };
  if (/conclu|fundou|ergueu|construiu|inaugur/i.test(text)) return { category: 'Construção', text };
  if (/abandon|novo rei|coroa|sucedeu|seca|estiagem/i.test(text)) return { category: 'Reino', text };
  return null;
}
