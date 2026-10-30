import { SPELLS, availableSpells, equippedSpells, MAGIC_ROLES, MAGIC_TACTICS } from '../../simulation/magic/catalog.js';

export function renderMagicInspector(person, now = 0) {
  let html = '';
  if (person.militaryClass === 'monge') {
    const ids = equippedSpells(person), available = availableSpells(person);
    html += '<div class="note-card"><b>Magias do sacerdote</b><span>Segure E/1 para curar; 2–5 conjuram as demais magias. Mana é paga ao iniciar e não regenera durante o preparo. Morte, atordoamento ou deslocamento interrompem a conjuração.</span></div>';
    html += '<label class="data-row magic-row"><span>Especialização</span><select aria-label="Especialização de magias" data-magic-person="' + person.id + '" data-magic-role>'
      + '<option value="custom">Personalizada</option>'
      + Object.entries({ healer: 'Curandeiro', protector: 'Protetor', disruptor: 'Enfraquecedor' }).map(([id, title]) => '<option value="' + id + '">' + title + '</option>').join('') + '</select></label>';
    ids.forEach((id, index) => {
      html += '<label class="data-row magic-row"><span>Magia ' + (index + 1)
        + '<br><small>' + (SPELLS[id].castMs / 1000).toLocaleString('pt-BR') + ' s de preparo</small></span><select aria-label="Magia ' + (index + 1)
        + '" data-magic-person="' + person.id + '" data-magic-slot="' + index + '">'
        + available.map(option => '<option value="' + option + '"' + (option === id ? ' selected' : '') + '>'
          + SPELLS[option].name + ' · ' + SPELLS[option].mana + ' mana</option>').join('') + '</select></label>';
    });
    if (person.magicCast) html += '<div class="data-row"><span>Conjurando</span><b>' + SPELLS[person.magicCast.spellId].name + '</b></div>';
  }
  if (['general', 'comandante'].includes(person.militaryRank)) {
    html += '<label class="data-row magic-row"><span>Apoio mágico</span><select aria-label="Tática de apoio mágico" data-magic-person="' + person.id + '" data-magic-policy>'
      + Object.entries(MAGIC_TACTICS).map(([id, policy]) => '<option value="' + id + '"'
        + (id === (person.magicOrders?.policy || 'balanced') ? ' selected' : '') + '>' + policy.label + '</option>').join('') + '</select></label>';
  }
  const effects = (person.magicEffects || []).filter(effect => effect.expiresAt > now);
  if (effects.length) html += '<div class="note-card"><b>Efeitos mágicos</b><span>' + effects.map(effect =>
    (SPELLS[effect.spellId]?.name || effect.id) + ' · ' + Math.ceil((effect.expiresAt - now) / 1000) + ' s').join(' / ') + '</span></div>';
  return html;
}

export function magicInspectorCommand(target, person) {
  if (target.hasAttribute('data-magic-policy')) return { type: 'magic-orders', personId: person.id, policy: target.value };
  if (target.hasAttribute('data-magic-role')) {
    const spells = MAGIC_ROLES[target.value];
    return spells ? { type: 'magic-loadout', personId: person.id, spells, role: target.value } : null;
  }
  if (target.hasAttribute('data-magic-slot')) {
    const spells = equippedSpells(person).slice(), index = Number(target.dataset.magicSlot);
    if (!Number.isInteger(index) || index < 0 || index >= spells.length) return null;
    const other = spells.indexOf(target.value);
    if (other !== -1) spells[other] = spells[index];
    spells[index] = target.value;
    return { type: 'magic-loadout', personId: person.id, spells };
  }
  return null;
}
