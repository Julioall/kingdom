// Physical NPC recovery and garrison-return executors.
//
// Their caller decides WHICH action is allowed. These functions execute the
// consequence only; they must not choose a new objective, award invisible
// resources or bypass the existing military chain of command.
import { clamp, distance } from '../core/math.js';
import { moveOne } from './movement.js';
import { changePersonHealth } from './lifecycle.js';
import { restPersonInHouse, GARRISON_RECOVERY } from '../kingdoms/service.js';

export function executeFieldRecovery(world, person) {
  // A tired campaign soldier reunites with their unit before resting.
  const unit = world.kingdoms.find(kingdom => kingdom.id === person.kingdomId)?.militaryCommand?.units
    .find(unit => unit.id === person.militaryUnitId);
  const commander = unit && world.people.find(other => other.id === unit.commanderId
    && other.alive && other.kingdomId === person.kingdomId);
  const separated = commander && commander.id !== person.id && distance(person, commander) > 8;
  if (separated) {
    const moved = moveOne(world, person, commander, false, { arrivalRadius: 5 });
    person.state = moved ? 'retornando à unidade para recuperar o fôlego'
      : 'aguardando passagem até a própria unidade';
    person.lastLesson = 'A recuperação em campanha exige reencontrar a unidade antes de descansar.';
  } else {
    person.energy = clamp(person.energy + 12, 0, 100);
    person.injury = Math.max(0, person.injury - .2);
    if (person.health < GARRISON_RECOVERY.health)
      changePersonHealth(world, person, 1.1, 'field-recovery');
    person.restingOutdoors = false;
    person.state = 'recuperando o fôlego junto à formação';
    person.lastLesson = 'A tropa faz uma pausa curta em campo, preservando a posição e as rações da campanha.';
  }
}

export function executeHomeRecovery(world, person) {
  const indoors = restPersonInHouse(world, person);
  const resting = indoors || person.militaryRestTargetId == null && person.homeRestTargetId == null;
  if (resting) person.energy = clamp(person.energy + (indoors ? GARRISON_RECOVERY.energyPerDay : 4.2), 0, 100);
  person.restingOutdoors = !indoors && resting && person.energy < GARRISON_RECOVERY.restEnergy;
  if (indoors) {
    person.injury = Math.max(0, person.injury - GARRISON_RECOVERY.injuryPerDay);
    changePersonHealth(world, person, GARRISON_RECOVERY.healthPerDay, 'recovery');
  } else if (resting && person.injury > 0) {
    person.injury = Math.max(0, person.injury - .035);
    changePersonHealth(world, person, .08, 'recovery');
  }
  if (indoors) person.state = 'descansando dentro da casa';
  else if (person.militaryRestTargetId != null || person.homeRestTargetId != null) person.state = 'indo descansar na casa';
  else person.state = 'descansando';
  if (person.constructionRetreating && !indoors) person.state = 'retirando-se da obra para tratar ferimentos';
  if (person.constructionRetreating && person.health >= (person.constructionRecoveryHealth || 85)
    && person.energy >= GARRISON_RECOVERY.restEnergy && person.injury < 2) {
    person.constructionRetreating = false;
    person.constructionRecoveryHealth = null;
  }
  person.lastLesson = indoors
    ? 'A pessoa entrou em casa para recuperar energia e tratar ferimentos antes de retomar suas atividades.'
    : person.militaryRestTargetId != null || person.homeRestTargetId != null
      ? 'A pessoa segue para sua casa; o descanso começa ao entrar.'
      : 'O descanso recuperou energia enquanto não há uma casa disponível.';
}

export function executeGarrisonReturn(world, person, militaryCenter) {
  const moved = militaryCenter && moveOne(world, person, militaryCenter, false, { preferRoads: true });
  person.towerMounted = false;
  if (person.towerDutyId != null) {
    const tower = world.structures.find(structure => structure.id === person.towerDutyId);
    if (tower?.archerId === person.id) tower.archerId = null;
    person.towerRecovering = true;
  }
  person.state = moved ? 'retornando ao centro militar para repouso' : 'aguardando repouso na guarnição';
  person.lastLesson = 'Em paz, o soldado volta ao centro militar quando precisa de comida ou descanso; a ração reduzida vem do estoque do reino.';
}
