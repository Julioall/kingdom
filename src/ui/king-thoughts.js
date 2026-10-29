import { BUILDING_FEET, SOURCE_TILE_PIXELS } from './map-camera.js';

export function readableKingThought(kingdom) {
  const strategy = kingdom?.strategy;
  const latest = strategy?.aiHistory?.at(-1) || strategy?.aiPlan;
  return readableThought(latest);
}

function readableThought(latest) {
  if (typeof latest?.reason !== 'string') return '';
  let text = latest.reason.trim();
  // Never expose a raw model envelope as dialogue.
  if (text.startsWith('{')) {
    try { text = JSON.parse(text).reason || ''; } catch { return ''; }
  }
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f\ufffd]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function generalThoughts(world, poseFor = (_, person) => person) {
  const entries = new Map();
  for (const campaign of world.campaigns || []) {
    if (!['mobilizing', 'marching', 'engaged', 'withdrawing'].includes(campaign.status)) continue;
    for (const side of [campaign.attacker, campaign.defender]) {
      const thought = readableThought(side?.aiOrder);
      if (!thought) continue;
      const kingdom = world.kingdoms.find(item => item.id === side.kingdomId);
      const ids = kingdom?.militaryCommand?.generalIds || [];
      const generals = world.people.filter(person => person.alive && person.role === 'soldier'
        && person.kingdomId === side.kingdomId && (ids.includes(person.id) || person.militaryRank === 'general'));
      for (const general of generals) {
      const key = 'general:' + general.id;
      const day = side.aiOrder.assignedDay || 0;
      if (entries.has(key) && entries.get(key).day > day) continue;
      const pose = poseFor('person', general);
      entries.set(key, { key, label: 'General ' + general.name, thought,
        x: pose.x + .5, y: pose.y - .8, baseY: pose.y + 1, day, personId: general.id });
      }
    }
  }
  return [...entries.values()];
}

export function thoughtHasFocus(entry, selection) {
  if (!selection) return false;
  if (entry.personId != null) return selection.kind === 'person' && selection.id === entry.personId;
  return selection.kind === 'structure' && selection.id === entry.castleId
    || selection.kind === 'kingdom' && selection.id === entry.key;
}

export function createKingThoughts(stage) {
  const layer = document.createElement('div');
  layer.className = 'king-thoughts';
  layer.setAttribute('aria-label', 'Pensamentos dos reis e generais');
  stage.append(layer);
  const bubbles = new Map();
  return {
    update(world, camera, tileSize, poseFor = (_, person) => person, selection = null) {
      const active = new Set();
      const entries = [];
      for (const kingdom of world.kingdoms) {
        const castle = world.structures.find(structure => structure.type === 'castelo'
          && structure.kingdomId === kingdom.id && structure.complete && structure.destroyedDay == null);
        const thought = readableKingThought(kingdom);
        if (!castle || !thought) continue;
        const ruler = world.people.find(person => person.id === kingdom.rulerId && person.alive);
        entries.push({ key: kingdom.id, castleId: castle.id, label: 'Rei ' + (ruler?.name || kingdom.name), thought,
          x: castle.x + .5, y: castle.y + 1 - BUILDING_FEET.castle / SOURCE_TILE_PIXELS,
          baseY: castle.y + 1 });
      }
      entries.push(...generalThoughts(world, poseFor));
      if (selection?.kind === 'person' && !entries.some(entry => entry.personId === selection.id)) {
        const person = world.people.find(item => item.id === selection.id && item.alive && item.role === 'soldier');
        const kingdom = person && world.kingdoms.find(item => item.id === person.kingdomId);
        if (person && (person.militaryRank === 'general' || kingdom?.militaryCommand?.generalIds?.includes(person.id))) {
          const pose = poseFor('person', person);
          entries.push({ key: 'general:' + person.id, personId: person.id,
            label: 'General ' + person.name,
            thought: 'Ainda não defini uma ordem para uma campanha militar em andamento.',
            x: pose.x + .5, y: pose.y - .8, baseY: pose.y + 1 });
        }
      }
      for (const entry of entries) {
        if (!thoughtHasFocus(entry, selection)) continue;
        const { key, label, thought } = entry;
        active.add(key);
        let bubble = bubbles.get(key);
        if (!bubble) {
          bubble = document.createElement('div');
          bubble.className = 'king-thought';
          const label = document.createElement('span');
          label.className = 'king-thought__label';
          const message = document.createElement('span');
          message.className = 'king-thought__message';
          bubble.append(label, message);
          layer.append(bubble);
          bubbles.set(key, bubble);
        }
        if (bubble.firstChild.textContent !== label) bubble.firstChild.textContent = label;
        if (bubble.lastChild.textContent !== thought) bubble.lastChild.textContent = thought;
        const bubbleScale = Math.max(.2, Math.min(1, camera.scale * .35));
        bubble.style.transform = 'scale(' + bubbleScale + ')';
        const x = entry.x * tileSize * camera.scale + camera.offsetX;
        const y = entry.y * tileSize * camera.scale + camera.offsetY - 12;
        const width = stage.clientWidth, height = stage.clientHeight;
        const castleY = entry.baseY * tileSize * camera.scale + camera.offsetY;
        bubble.hidden = x < 0 || x > width || castleY < 0 || castleY > height;
        if (bubble.hidden) continue;
        const margin = 8;
        const bubbleWidth = bubble.offsetWidth * bubbleScale, bubbleHeight = bubble.offsetHeight * bubbleScale;
        const below = y - bubbleHeight < margin;
        const left = Math.max(margin, Math.min(width - bubbleWidth - margin, x - bubbleWidth / 2));
        const top = Math.max(margin, Math.min(height - bubbleHeight - margin,
          below ? Math.max(margin, castleY + 12) : y - bubbleHeight));
        bubble.classList.toggle('king-thought--below', below);
        bubble.style.setProperty('--thought-tail-x', Math.max(12,
          Math.min(bubble.offsetWidth - 20, (x - left) / bubbleScale)) + 'px');
        bubble.style.left = left + 'px';
        bubble.style.top = top + 'px';
      }
      for (const [id, bubble] of bubbles) {
        if (!active.has(id)) { bubble.remove(); bubbles.delete(id); }
      }
    }
  };
}
