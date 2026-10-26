const lancer = { idle: 'Idle', run: 'Run' };
for (const direction of ['Up', 'UpRight', 'Right', 'DownRight', 'Down']) {
  lancer['attack-' + direction] = direction + '_Attack';
  lancer['defend-' + direction] = direction + '_Defence';
}

export const CHARACTER_SPRITE_SCALE = .75;

export const MILITARY_SPRITES = {
  lanceiro: { folder: 'Lancer', prefix: 'Lancer_', size: 320, foot: 199, actions: lancer },
  guerreiro: { folder: 'Warrior', prefix: 'Warrior_', size: 192, foot: 135,
    actions: { idle: 'Idle', run: 'Run', attack: 'Attack1', 'attack-2': 'Attack2', defend: 'Guard' } },
  arqueiro: { folder: 'Archer', prefix: 'Archer_', size: 192, foot: 135,
    actions: { idle: 'Idle', run: 'Run', attack: 'Shoot' } },
  monge: { folder: 'Monk', prefix: '', size: 192, foot: 135,
    actions: { idle: 'Idle', run: 'Run', heal: 'Heal' } }
};

export function militarySpritePose(person, pose, day) {
  const unit = MILITARY_SPRITES[person.militaryClass] || MILITARY_SPRITES.lanceiro;
  const hasDirection = Math.abs(pose.dirX || 0) + Math.abs(pose.dirY || 0) > .001;
  const dx = hasDirection ? pose.dirX || 0 : person.militaryFacingX ?? 1;
  const dy = hasDirection ? pose.dirY || 0 : person.militaryFacingY ?? 0;
  let action = pose.moving ? 'run' : 'idle';
  const fighting = person.militaryAnimationDay === day;
  if (fighting) action = person.militaryAnimation || 'attack';
  else if (!pose.moving && person.state === 'de guarda') action = 'defend';
  if (fighting && unit === MILITARY_SPRITES.guerreiro && action === 'attack') {
    const comboIndex = person.combatAction?.comboIndex;
    if (comboIndex != null) action = comboIndex % 2 === 0 ? 'attack-2' : 'attack';
    else if ((person.id + day) % 2 === 0) action = 'attack-2';
  }
  if (unit === MILITARY_SPRITES.lanceiro && ['attack', 'defend'].includes(action)) {
    const direction = Math.abs(dy) > Math.abs(dx) * 2 ? dy < 0 ? 'Up' : 'Down'
      : Math.abs(dy) > Math.abs(dx) * .4 ? dy < 0 ? 'UpRight' : 'DownRight' : 'Right';
    action += '-' + direction;
  }
  if (!unit.actions[action]) action = 'idle';
  return { unit, action, flip: dx < 0 };
}
