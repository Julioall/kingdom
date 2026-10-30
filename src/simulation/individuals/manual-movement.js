import { moveCombatPersonTo } from '../kingdoms/military.js';
import { magicModifiers } from '../magic/effects.js';

// Shared by authoritative simulation and client prediction: identical speed,
// collision sampling and wall sliding on both sides of the Worker boundary.
export function applyManualMovement(world, person, input) {
  if (person.magicCast) {
    person.playerMovementBlockedReason = input.moveX || input.moveY ? 'casting' : null;
    return;
  }
  if (Date.now() < (person.playerMovementLockedUntil || 0)) {
    person.playerMovementBlockedReason = 'action';
    return;
  }
  const dt = Math.max(0, Math.min(.12, input.dt || 0));
  const length = Math.hypot(input.moveX, input.moveY) || 1;
  if (!dt || !input.moveX && !input.moveY) return;
  const speed = 4 * magicModifiers(person, world).speed;
  const dx = input.moveX / length * dt * speed, dy = input.moveY / length * dt * speed;
  if (!moveCombatPersonTo(world, person, { x: person.x + dx, y: person.y + dy })) {
    const movedX = dx && moveCombatPersonTo(world, person, { x: person.x + dx, y: person.y });
    const movedY = dy && moveCombatPersonTo(world, person, { x: person.x, y: person.y + dy });
    if (movedX || movedY) person.playerMovementBlockedReason = null;
  }
}
