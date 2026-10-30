import { dominantMetalKind } from '../config/mineral-deposits.js';
import { dashPosition, dashGhosts, DASH_TRAIL_FADE_MS } from './dash-presentation.js';
import { manualAttackProfile } from '../simulation/kingdoms/military.js';
import { createCombatAction } from '../simulation/kingdoms/combat-contact.js';
import { createManualMovementPrediction } from './manual-movement-prediction.js';
import { resourceSummary } from './gameplay-data.js';
import { formatWholeMeasure } from './whole-measures.js';
import { buildingCard, kingdomOverview } from './building-card.js';
import { towerVitality } from '../simulation/kingdoms/fortifications.js';
import { activeLeadershipRank } from '../simulation/kingdoms/military-identity.js';
import { createMovementInterpolator } from './movement-interpolation.js';
import { createDamageBarTracker } from './health-bars.js';
import { GameSession } from '../app/session.ts';
import { SimulationClock } from '../app/simulation-loop.ts';
import Sim from './simulation-view.js';
import LocalAI from '../ai/local-engine.js';
import { readLocalAiPreference, writeLocalAiPreference } from '../ai/preference.js';
import { DOMESTIC_SHEEP_DAILY_FEED, SHEEP_ADULT_AGE_DAYS, SHEEP_JUVENILE_MIN_SCALE } from '../config/ecosystem.js';
import { isRoadTile, ROAD_RULES } from '../simulation/world/roads.js';
import { trainingDummiesForWorld } from '../simulation/world/training-dummies.js';
import { SPELLS, equippedSpells } from '../simulation/magic/catalog.js';
import { magicHasActivity } from '../simulation/magic/system.js';
import { createMagicPresentation } from './magic/presentation.js';
import { renderMagicInspector, magicInspectorCommand } from './magic/inspector.js';
import { isBushAnchor } from '../simulation/ecology/plants.js';
import { CHARACTER_SPRITE_SCALE, MILITARY_SPRITES, militarySpritePose } from './military-sprites.js';
import { createAnimationRenderer, getUnitAnimation, getAnimationFrame } from './animations.js';
import { residentSpritePose, createActorAnimationClock, createActivityEffects } from './person-animations.js';
import { createGameAudio, windGainAtZoom } from './game-audio.js';
import { musicGainAtZoom } from './music-audio.js';
import { mapDecorationAt, MAP_DECORATION_SPRITES } from './map-decorations.js';
import { MILITARY_PAY, GARRISON_RECOVERY } from '../simulation/kingdoms/service.js';
import { MILITARY_SOURCE_LABELS } from '../simulation/kingdoms/military-sources.js';
import { mapCamera, followCameraPan, spriteScale, BUILDING_FEET, alignedTileRect, SOURCE_TILE_PIXELS } from './map-camera.js';
import { structureDepthY } from './world-depth.js';
import { createCloudSystem, atmosphereZoomProfile } from './cloud-system.js';
import AtmosphericLayer from './atmospheric-layer.js';
import DirtBrush, { SOIL_PALETTE } from './dirt-brush.js';
import { createLoadingScreen } from './loading-screen.js';
import { renderSocialInspectorSections } from './social-inspector.js';
import { createRenderDiagnostics } from './render-profiler-panel.js';
import { syncHudPanelAccess } from './hud-panel-access.js';
import { createKingThoughts } from './king-thoughts.js';
import { createTerrainChunkCache } from './terrain-chunks.js';
import { createPixelTileCache } from './pixel-tile-cache.js';
import { compareDepth, mergeDepthItems } from './depth-order.js';
import { createStaticDepthSpatialIndex } from './depth-spatial-index.js';
import { shouldDrawMineralAtZoom } from './mineral-lod.js';
import { MINERAL_SPRITE_KINDS, mineralDepositVariant } from './mineral-sprites.js';
import { CORRAL_VISUAL_SCALE, corralFenceRadius } from '../simulation/ecology/herd.js';


const IMAGE_ASSET_EXTENSION = import.meta.env?.PROD ? 'webp' : 'png';
const imageFileName = name => `${name}.${IMAGE_ASSET_EXTENSION}`;
const lightenHexColor = (hex, amount) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0].map(shift => {
    const channel = value >> shift & 255;
    return Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, '0');
  }).join('');
};
const PATH_SOIL_PALETTE = Object.freeze(Object.fromEntries(Object.entries(SOIL_PALETTE)
  .map(([name, color]) => [name, lightenHexColor(color, .25)])));
const RIBBON_PALETTE = Object.freeze({ blue: 'cyan', cyan: 'cyan', red: 'red', purple: 'purple', yellow: 'yellow', black: 'black' });
const ARCHER_READY_FRAME_MS = 400;
const ARCHER_RELEASE_FRAME_MS = 500;

function setModalRibbon(panel, forjaUI, color) {
  if (!panel) return;
  const heading = panel && [...panel.children].find(child => child.classList.contains('panel-heading')
    || child.classList.contains('utility-heading'));
  if (!heading || !forjaUI?.ribbon) return;
  const ribbonColor = RIBBON_PALETTE[color] || 'black';
  let ribbon = [...heading.children].find(child => child.classList.contains('panel-ribbon'));
  if (ribbon?.dataset.ribbonColor === ribbonColor) return;
  const nextRibbon = forjaUI.ribbon(ribbonColor, '', 'panel-ribbon', 47);
  nextRibbon.dataset.ribbonColor = ribbonColor;
  nextRibbon.setAttribute('aria-hidden', 'true');
  nextRibbon.querySelector('.ribbon-text')?.remove();
  if (ribbon) ribbon.replaceWith(nextRibbon);
  else heading.prepend(nextRibbon);
  heading.dataset.ribbonColor = ribbonColor;
  panel.classList.add('has-ribbon-heading');
}

function atmosphereProfileForZoom(zoom) {
  const density = atmosphereZoomProfile(zoom).fogDensity;
  return {
    coverage: .62 + density * .32,
    openings: .85 - density * .52,
    speed: .32,
    turbulence: .54,
    scale: .60 + density * .30,
    shadows: .35 + density * .15,
    opacity: 1,
  };
}

function atmosphereLayerOpacityForZoom(zoom) {
  return atmosphereZoomProfile(zoom).fogOpacity;
}

export function mountGame() {
  'use strict';
  const loadingScreen = createLoadingScreen();
  const renderDiagnostics = createRenderDiagnostics();
  const diagnosticQuery = new URLSearchParams(window.location.search);
  const referenceRendering = diagnosticQuery.get('profile') === '1' && diagnosticQuery.get('render') === 'reference';
  const fixedEffects = diagnosticQuery.get('profile') === '1' && diagnosticQuery.get('effects') === 'fixed';
  const combatDebug = diagnosticQuery.get('combatDebug') === '1';
  const trackedImage = () => loadingScreen.trackImage(new Image());
  const $ = id => document.getElementById(id);
  const forjaUI = window.FantasyUI;
  if (forjaUI) {
    for (const [selector, skin] of [['.topbar', 'wood'], ['.mini-map-panel', 'wood'], ['.left-panel', 'scroll'], ['.right-panel', 'scroll'], ['.journal-panel', 'scroll'], ['.utility-drawer', 'scroll']]) {
      const panel = document.querySelector(selector);
      if (panel && !panel.querySelector(':scope > .skin-layer')) {
        panel.classList.add('ui-skinned-panel');
        panel.dataset.uiSkin = skin;
        panel.prepend(forjaUI.skinLayer(skin));
      }
    }
    for (const [id, color] of [['kingdomsToggle', 'yellow'], ['journalToggle', 'cyan']]) {
      const button = $(id);
      if (button && !button.querySelector(':scope > .rail-ribbon')) {
        const ribbon = forjaUI.ribbon(color, '', 'rail-ribbon', 50);
        ribbon.dataset.ribbonColor = color;
        ribbon.setAttribute('aria-hidden', 'true');
        ribbon.querySelector('.ribbon-text')?.remove();
        button.prepend(ribbon);
      }
    }
    setModalRibbon($('rightPanel'), forjaUI, 'black');
    setModalRibbon($('settingsTray'), forjaUI, 'black');
  }
  const canvas = $('world');
  canvas.tabIndex = 0;
  const parryStarSprite = trackedImage();
  parryStarSprite.src = '/assets/kingdom-ui/' + imageFileName('parry-star');
  const deathSprite = trackedImage();
  deathSprite.addEventListener('load', () => { if (world) drawMap(); });
  deathSprite.src = '/assets/tiny-swords/military/dead.png';
  const selectionFrameSprite = trackedImage();
  selectionFrameSprite.addEventListener('load', () => { if (world) drawMap(); });
  selectionFrameSprite.src = '/assets/kingdom-ui/Cursor_04.png';
  const cloudSpritesCanvas = $('cloudSprites');
  const cloudSpritesContext = cloudSpritesCanvas.getContext('2d');
  const miniMapCanvas = $('miniMap');
  const miniMapContext = miniMapCanvas.getContext('2d');
  miniMapContext.imageSmoothingEnabled = false;
  let miniMapRenderKey = '';
  const LOGICAL_SIZE = 1024;
  let ctx = canvas.getContext('2d');
  const groundCacheCanvas = document.createElement('canvas');
  groundCacheCanvas.width = canvas.width; groundCacheCanvas.height = canvas.height;
  const groundCacheContext = groundCacheCanvas.getContext('2d');
  // Tiny Swords art is pixel art: nearest-neighbor sampling keeps its source pixels crisp.
  ctx.imageSmoothingEnabled = false;
  groundCacheContext.imageSmoothingEnabled = false;
  const W = Sim.width, H = Sim.height, TILE = LOGICAL_SIZE / W, stage = canvas.parentElement;
  const magicVfx = createMagicPresentation({ tileSize: TILE });
  const kingThoughts = createKingThoughts(stage);
  const terrainChunks = createTerrainChunkCache({ width: W, height: H, tileSize: TILE });
  const pixelTiles = createPixelTileCache();
  let terrainSyncRevision = -1, terrainSyncFallback = null, assetRevision = 0, terrainAssetRevision = 0, renderTimestamp = null;
  const seasonNames = Sim.seasons;
  const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const requestedSeed = diagnosticQuery.get('seed');
  const sessionSeed = requestedSeed !== null && /^\d+$/.test(requestedSeed) && Number(requestedSeed) <= 0xffffffff
    ? Number(requestedSeed) : randomSeed();
  const PATH_TRAIL_OPACITY = .74;
  const PATH_TRAIL_WIDTH = 8;
  const PATH_EDGE_IRREGULARITY = .77;
  const trailCanvasScale = 1;
  const trailBrushSize = PATH_TRAIL_WIDTH * trailCanvasScale;
  const trailCanvas = document.createElement('canvas');
  trailCanvas.width = trailCanvas.height = LOGICAL_SIZE * trailCanvasScale;
  const dirtBrush = new DirtBrush({ canvas: trailCanvas, size: trailBrushSize, irregularity: PATH_EDGE_IRREGULARITY,
    palette: PATH_SOIL_PALETTE, seed: sessionSeed ^ 0x4d2b79f5, autoBind: false });
  const trailLastPositionByPerson = new Map();
  const trailSegmentByPerson = new Map();
  const pendingPersonTrailPoints = new Map();
  let lastTrailFlushAt = -Infinity;
  const session = new GameSession(undefined, sessionSeed);
  if (diagnosticQuery.get('paused') === '1') {
    session.paused = true;
    session.ready.then(() => session.setPaused(true)).catch(error => session.onError?.(error));
  }
  const clock = new SimulationClock();

  let world = null, rendered = false, localAI = null;
  let peopleById = new Map(), animalsById = new Map(), communitiesById = new Map(), kingdomsById = new Map(), structuresById = new Map();
  let selection = null, showLeft = false, showRight = false, hoveredTerritoryStructureId = null, hoveredMapEntity = false, hoveredPersonId = null;
  let manualControlId = null, manualAimWorld = null, manualDefending = false, manualHealing = false, lastManualInputKey = '';
  const manualHeldKeys = new Set();
  let manualAttackPreview = null, lastManualPointer = null;
  const dashPresentations = new Map();
  let lastDashEvent = 0;
  let manualDispatchQueue = Promise.resolve();
  const queueManualDispatch = command => {
    manualDispatchQueue = manualDispatchQueue.then(() => session.dispatch(command)).catch(error => {
      if (!isResetCancellation(error)) console.error('[Controle manual]', error);
    });
    return manualDispatchQueue;
  };
  const isEditableTarget = target => !!target?.closest?.('input, textarea, select, button, [contenteditable="true"]');
  const currentManualPerson = () => manualControlId == null ? null : peopleById.get(manualControlId) || null;
  const primaryIsHealing = () => {
    const person = currentManualPerson();
    return person?.militaryClass === 'monge' && SPELLS[equippedSpells(person)[0]]?.kind === 'heal';
  };
  const manualPrediction = createManualMovementPrediction();
  let lastManualTick = 0;
  function sendManualInput(dt = 0) {
    const person = currentManualPerson();
    if (!person || !world || dt && !person.playerControlled) return;
    const moveX = Number(manualHeldKeys.has('d')) - Number(manualHeldKeys.has('a'));
    const moveY = Number(manualHeldKeys.has('s')) - Number(manualHeldKeys.has('w'));
    let aimX, aimY, aimBucket = '';
    if (person.role === 'soldier' && manualAimWorld) {
      aimX = Math.max(0, Math.min(W - .001, manualAimWorld.x));
      aimY = Math.max(0, Math.min(H - .001, manualAimWorld.y));
      const angle = Math.atan2(aimY - person.y, aimX - person.x);
      aimBucket = Math.round(angle / (Math.PI / 16));
    }
    const healingTarget = hoveredPersonId == null ? null : getPerson(hoveredPersonId);
    const healingTargetId = healingTarget?.kingdomId === person.kingdomId ? healingTarget.id : null;
    const signature = [moveX, moveY, Number(manualDefending), Number(manualHealing), healingTargetId ?? '', aimBucket].join(':');
    if (dt && ['shield-bash', 'lance-charge'].includes(manualAttackPreview?.action.attackVariant)) return;
    if (!dt && signature === lastManualInputKey) return;
    if (dt && !moveX && !moveY && !manualHealing && !(person.playerFlurryUntil > Date.now())) return;
    lastManualInputKey = signature;
    const command = { type: 'player-input', personId: person.id, moveX, moveY, dt,
      defending: manualDefending, healing: manualHealing && person.militaryClass === 'monge',
      healingTargetId: healingTargetId ?? undefined,
      aimX, aimY };
    if (dt) {
      manualPrediction.predict(world, person, command);
      session.dispatch(command).catch(error => { if (!isResetCancellation(error)) console.error('[Controle manual]', error); });
    } else queueManualDispatch(command);
  }
  function updateManualAim(event, forceMouse = false, redraw = true) {
    if (manualControlId == null || !forceMouse && event.pointerType !== 'mouse' || !world) return;
    lastManualPointer = { clientX: event.clientX, clientY: event.clientY, pointerType: 'mouse' };
    const rect = stage.getBoundingClientRect();
    const point = currentMapCamera().toWorld(event.clientX - rect.left, event.clientY - rect.top);
    const picked = pickEntity(point.x / TILE, point.y / TILE);
    const targetPerson = picked?.kind === 'person' ? getPerson(picked.id) : null;
    const nextAim = targetPerson && targetPerson.kingdomId !== currentManualPerson()?.kingdomId
      ? { x: targetPerson.x, y: targetPerson.y }
      : { x: Math.max(0, Math.min(W - .001, point.x / TILE)),
        y: Math.max(0, Math.min(H - .001, point.y / TILE)) };
    const visualChanged = !manualAimWorld || Math.hypot(nextAim.x - manualAimWorld.x, nextAim.y - manualAimWorld.y) > .06;
    manualAimWorld = nextAim;
    if (currentManualPerson()?.role === 'soldier') sendManualInput();
    if (visualChanged && redraw) drawMap();
  }
  function queueManualAttack(actionKey) {
    const person = currentManualPerson();
    if (!person || person.role !== 'soldier' || !manualAimWorld) return;
    let aimX = Math.max(0, Math.min(W - .001, manualAimWorld.x));
    let aimY = Math.max(0, Math.min(H - .001, manualAimWorld.y));
    const hoveredTargetPerson = hoveredPersonId == null ? null : getPerson(hoveredPersonId);
    const target = hoveredTargetPerson?.alive
      ? { kind: 'person', id: hoveredTargetPerson.id } : pickEntity(aimX, aimY);
    const hoveredTarget = target?.kind === 'person' ? getPerson(target.id) : null;
    const locksTarget = hoveredTarget && (person.militaryClass === 'monge'
      || hoveredTarget.id !== person.id && hoveredTarget.kingdomId !== person.kingdomId);
    if (locksTarget) { aimX = hoveredTarget.x; aimY = hoveredTarget.y; }
    const profile = manualAttackProfile(person, actionKey);
    const preview = profile && (target?.kind === 'training-dummy' || (person.stamina ?? 100) >= (profile.minStamina || 8))
      && !(person.combatDisarmedUntilDay > world.day) ? {
        personId: person.id, previousId: person.combatAction?.id, startedAt: animationTime,
        action: createCombatAction({ combatSequence: 0, rngState: 42 }, { ...person },
          { id: -1, x: aimX, y: aimY }, world.day,
          { ...profile, reach: profile.range, aim: { x: aimX, y: aimY }, targetLock: !!locksTarget })
      } : null;
    manualAttackPreview = preview;
    queueManualDispatch({ type: 'player-action', personId: person.id, actionKey,
      aimX, aimY, targetId: target?.kind === 'training-dummy' ? target.id
        : locksTarget ? hoveredTarget.id : undefined })
      .finally(() => { if (manualAttackPreview === preview) manualAttackPreview = null; });
  }
  function toggleManualControl() {
    if (!world) return;
    manualPrediction.reset(); manualAttackPreview = null;
    const selectedPerson = selection?.kind === 'person' ? getPerson(selection.id) : null;
    if (manualControlId != null && (!selectedPerson || selectedPerson.id === manualControlId)) {
      const previousId = manualControlId;
      manualControlId = null; manualAimWorld = null; manualDefending = false; manualHealing = false;
      manualHeldKeys.clear(); lastManualInputKey = '';
      queueManualDispatch({ type: 'player-control', personId: previousId, enabled: false });
    } else if (selectedPerson?.alive) {
      manualControlId = selectedPerson.id; manualDefending = false; manualHealing = false;
      mapZoom = Math.max(mapZoom, FIT_MAP_ZOOM);
      showRight = false; $('rightPanel').classList.remove('is-open');
      syncPanelAccess(); updateMapViewport();
      manualHeldKeys.clear(); lastManualInputKey = '';
      const facingX = selectedPerson.militaryFacingX || 1, facingY = selectedPerson.militaryFacingY || 0;
      const length = Math.hypot(facingX, facingY) || 1;
      manualAimWorld = { x: Math.max(0, Math.min(W - .001, selectedPerson.x + facingX / length * 4)),
        y: Math.max(0, Math.min(H - .001, selectedPerson.y + facingY / length * 4)) };
      queueManualDispatch({ type: 'player-control', personId: selectedPerson.id, enabled: true });
    } else return;
    sendManualInput();
    renderInspector(); drawMap();
  }
  function clearManualInput() {
    if (manualControlId == null) return;
    manualHeldKeys.clear(); manualDefending = false; manualHealing = false;
    lastManualInputKey = '';
    sendManualInput();
  }
  const syncPanelAccess = () => syncHudPanelAccess($('leftPanel'), $('rightPanel'), { leftOpen: showLeft, rightOpen: showRight });
  syncPanelAccess();
  const isResetCancellation = error => error && error.name === 'AbortError';
  session.onUpdate = (nextWorld, _stats, reset) => {
    world = nextWorld;
    peopleById = new Map(world.people.map(person => [person.id, person]));
    animalsById = new Map(world.animals.map(animal => [animal.id, animal]));
    communitiesById = new Map(world.communities.map(community => [community.id, community]));
    kingdomsById = new Map(world.kingdoms.map(kingdom => [kingdom.id, kingdom]));
    structuresById = new Map(world.structures.map(structure => [structure.id, structure]));
    if (manualControlId != null && !peopleById.get(manualControlId)?.alive) {
      manualControlId = null; manualAimWorld = null; manualDefending = false; manualHealing = false;
      manualHeldKeys.clear(); lastManualInputKey = '';
    }
    manualPrediction.reconcile(world, currentManualPerson());
    invalidateStaticDepthCache();

    movementInterpolator.observe(world, performance.now(), { reset, speed: session.speed });
    npcDamageBars.observe(world.people, performance.now(), reset);
    structureDamageBars.observe(world.structures.map(s => ({ id: s.id, alive: s.destroyedDay == null,
      lastAttackSequence: s.lastAttackSequence })), performance.now(), reset);
    observeDashPresentations(world, animationTime, reset);
    activityEffects.observe(world, animationTime, reset);
    magicVfx.sync(world, animationTime, reset);
    gameAudio.observe(world, animationTime, reset);
    for (const person of world.people) if (person.combatAction?.day === world.day) {
      actorAnimationClock.elapsed('combat:' + person.id, String(person.combatAction.id), animationTime);
    }
    for (const person of world.people) if (person.combatDefense?.day === world.day) {
      actorAnimationClock.elapsed('defense:' + person.id, String(person.combatDefense.actionId), animationTime);
    }
    activeMiningSites = new Set(world.people.filter(person => person.alive && person.visualActivity?.day === world.day
      && person.visualActivity.kind === 'mine').map(person => person.visualActivity.x + ':' + person.visualActivity.y));
    actorAnimationClock.retain(new Set(world.people.filter(person => person.alive).flatMap(person => [person.id, 'shot:' + person.id, 'combat:' + person.id, 'defense:' + person.id])));
    for (const kingdom of world.kingdoms) ensureTinyPalette(kingdom.palette);
    if (reset) {
      magicGeneration++; magicAccumulator = 0; magicTickPending = false; lastMagicFrame = 0;
      dirtBrush.clear();
      trailLastPositionByPerson.clear();
      trailSegmentByPerson.clear();
      pendingPersonTrailPoints.clear();
      lastTrailFlushAt = performance.now();
      selection = null;
      manualPrediction.reset(); manualAttackPreview = null;
      manualControlId = null; manualAimWorld = null; manualDefending = false;
      manualHeldKeys.clear(); lastManualInputKey = '';
      showRight = false;

      $('rightPanel').classList.remove('is-open');
      syncPanelAccess();
      actorAnimationClock.clear();
      invalidateStaticDepthCache();
      resetMapViewport(MIN_MAP_ZOOM);
    }
    if (!rendered) {
      rendered = true;
      updateMapViewport();
      render('snapshot');
      window.requestAnimationFrame(frame);
      loadingScreen.markWorldReady();
    } else render('snapshot');
    if (localAI) localAI.pump();
  };
  session.onPlayerUpdate = (combat, personIds, magic = false) => {
    if (!world) return;
    magicVfx.sync(world, animationTime);
    const controlled = currentManualPerson();
    if (controlled?.militaryClass === 'monge' && !controlled.playerHealing) manualHealing = false;
    if (personIds.includes(manualControlId)) manualPrediction.reconcile(world, currentManualPerson());
    if (magic) {
      npcDamageBars.observe(world.people, performance.now(), false);
      activityEffects.observe(world, animationTime, false);
      gameAudio.observe(world, animationTime, false);
      return;
    }
    if (!combat) return;
    invalidateStaticDepthCache();
    if (selection?.kind === 'training-dummy') renderInspector();
    let combatPresentationAt = animationTime;
    const preview = manualAttackPreview;
    if (preview && personIds.includes(preview.personId) && controlled?.combatAction
        && controlled.combatAction.id !== preview.previousId) {
      const prepared = Math.min(animationTime - preview.startedAt, preview.action.windupMs * .85);
      combatPresentationAt -= prepared;
      actorAnimationClock.startAt('combat:' + controlled.id, String(controlled.combatAction.id), animationTime - prepared);
      manualAttackPreview = null;
    }
    npcDamageBars.observe(world.people, performance.now(), false);
    observeDashPresentations(world, combatPresentationAt, false);
    activityEffects.observe(world, combatPresentationAt, false);
    gameAudio.observe(world, combatPresentationAt, false);
    const person = currentManualPerson();
    if (person?.combatAction?.day === world.day)
      actorAnimationClock.elapsed('combat:' + person.id, String(person.combatAction.id), animationTime);
  };
  session.onError = error => {
    if (isResetCancellation(error)) return;
    console.error('[Kingdom Worker de simulação]', error);
    if (!rendered) loadingScreen.fail(error);
    if ($('worldLine')) $('worldLine').textContent = 'Falha na simulação: ' + error.message;
  };
  session.ready.catch(error => {
    if (!isResetCancellation(error)) loadingScreen.fail(error);
  });
  localAI = LocalAI ? LocalAI.create({
    getWorld: () => world,
    getWorldEpoch: () => session.epoch,
    setKingdomAiEnabled: enabled => session.setKingdomAiEnabled(enabled),
    pullKingdomAiRequest: limit => session.pullKingdomAiRequest(limit),
    applyKingdomAiDecision: (request, decision, metadata) => session.applyKingdomAiDecision(request, decision, metadata),
    failKingdomAiRequest: (request, failure) => session.failKingdomAiRequest(request, failure),
    onStatus: updateLocalAIStatus
  }) : null;
  if (localAI) updateLocalAIStatus(localAI.getStatus());
  if (localAI) {
    let preferenceEnabled = false;
    try {
      preferenceEnabled = readLocalAiPreference(window.localStorage);
    } catch (error) {
      console.error('[Kingdom IA local] não foi possível ler a preferência:', error);
    }
    if (preferenceEnabled) {
      localAI.enable().catch(error => {
        console.error('[Kingdom IA local] não foi possível ativar a preferência salva:', error);
      });
    }
  }
  const visualPack = 'tiny-swords';
  // Spring, summer, autumn, winter: the four terrain palettes currently used on the map.
  const SEASON_TERRAIN_PALETTES = Object.freeze([0, 2, 3, 4]);
  // Blend in the next palette across the final two weeks of each season.
  const SEASON_TERRAIN_TRANSITION_DAYS = 14;
  const MIN_MAP_ZOOM = .5, MAX_MAP_ZOOM = 16, FIT_MAP_ZOOM = 2;
  const COLLISION_CALIBRATION_STORAGE_KEY = 'kingdom-collision-calibration-v3';
  const LEGACY_COLLISION_CALIBRATION_STORAGE_KEY = 'kingdom-collision-calibration-v2';
  let mapZoom = MIN_MAP_ZOOM, mapPanX = 0, mapPanY = 0;
  let showHitboxes = false;

  let mapTransform = [1, 0, 0, 1, 0, 0];
  let animationTime = 0, lastSpriteDraw = 0, lastAtmosphereUpdate = 0, assetRenderQueued = false, groundCacheKey = '', pendingClockDays = 0;
  let pendingMapDraw = 'initial';
  let lastCloudLayerDraw = -Infinity, cloudLayerViewKey = '', fogUpdateAccumulator = 0;
  const movementInterpolator = createMovementInterpolator();
  document.addEventListener('visibilitychange', () => movementInterpolator.markDiscontinuity());
  const actorAnimationClock = createActorAnimationClock();
  const activityEffects = createActivityEffects();
  const gameAudio = createGameAudio({
    onStatus: status => { const node = $('audioStatus'); if (node) node.textContent = status; },
    getWindGain: () => windGainAtZoom(mapZoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM),
    getMusicGain: () => musicGainAtZoom(mapZoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM),
    getPan: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
      const camera = currentMapCamera();
      const screenX = (x * TILE * camera.scale + camera.offsetX) / Math.max(1, stage.clientWidth);
      return Math.max(-1, Math.min(1, (screenX - .5) * 2));
    },
    getDistanceGain: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 1;
      const camera = currentMapCamera();
      const center = camera.toWorld(stage.clientWidth / 2, stage.clientHeight / 2);
      const distanceInCells = Math.hypot(x - center.x / TILE, y - center.y / TILE);
      const zoomGain = Math.min(1, mapZoom / 10);
      return zoomGain / (1 + (distanceInCells / 10) ** 2);
    }
  });
  function syncAudioControls() {
    $('musicVolume').value = String(gameAudio.musicVolume);
    $('musicVolumeValue').textContent = Math.round(gameAudio.musicVolume * 100) + '%';
    $('effectsVolume').value = String(gameAudio.effectsVolume);
    $('effectsVolumeValue').textContent = Math.round(gameAudio.effectsVolume * 100) + '%';
    syncAudioActivation();
  }
  function syncAudioActivation() {
    const waiting = gameAudio.enabled && !gameAudio.ready;
    const button = $('audioToggle');
    const label = !gameAudio.enabled ? 'Ativar todos os sons' : waiting ? 'Ativar som' : 'Silenciar todos os sons';
    const icon = !gameAudio.enabled ? '🔇' : waiting ? '🔈' : '🔊';
    if (button.textContent !== icon) button.textContent = icon;
    if (button.title !== label) {
      button.title = label;
      button.setAttribute('aria-label', label);
    }
    button.setAttribute('aria-pressed', String(!gameAudio.enabled));
    const state = !gameAudio.enabled ? 'silenciado' : waiting ? 'aguardando ativação' : 'ligado';
    if ($('audioState').textContent !== state) $('audioState').textContent = state;
  }
  syncAudioControls();
  const unlockAudio = event => {
    if (event?.target?.closest?.('#audioToggle')) return;
    if (!gameAudio.ready) void gameAudio.unlock();
  };
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('pointerup', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);
  document.addEventListener('wheel', unlockAudio, { capture: true, passive: true, once: true });
  window.addEventListener('focus', unlockAudio);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockAudio(); });
  $('audioToggle').addEventListener('click', () => {
    if (gameAudio.enabled && !gameAudio.ready) void gameAudio.unlock();
    else gameAudio.setEnabled(!gameAudio.enabled);
    syncAudioControls();
  });
  $('musicVolume').addEventListener('input', event => {
    gameAudio.setMusicVolume(event.target.value);
    syncAudioControls();
  });
  $('effectsVolume').addEventListener('input', event => {
    gameAudio.setEffectsVolume(event.target.value);
    syncAudioControls();
  });
  let activeMiningSites = new Set();
  const tinyTreeSprites = Object.create(null);
  const tinyBushSprites = [];
  const tinyStumpSprites = Object.create(null);
  const tinySheepSprites = Object.create(null);
  const animationRenderer = createAnimationRenderer({ imageFactory: trackedImage, onReady: queueAssetRender });
  let waterRockDistanceWorld = null, waterRockDistances = null;
  let waterRockPlacementsWorld = null, waterRockPlacements = null;
  const tinyBuildingSprites = Object.create(null);
  const constructionFoundationSprites = Object.create(null);
  const constructionFoundationFiles = {
    castle: 'castelo-construcao', house: 'casa-construcao', tower: 'torre-construcao',
    barracks: 'centro-militar-construcao', archery: 'arquearia-construcao', monastery: 'convento-construcao'
  };
  for (const [key, file] of Object.entries(constructionFoundationFiles)) {
    const image = trackedImage();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/construction-variants/' + imageFileName(file);
    constructionFoundationSprites[key] = image;
  }
  const tinyMineralSprites = Object.fromEntries(MINERAL_SPRITE_KINDS.map(kind => [kind, Object.create(null)]));
  const tinyRockSprites = Object.create(null);
  const mapDecorationSprites = Object.create(null);
  for (const sprite of MAP_DECORATION_SPRITES) {
    const image = trackedImage();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/map-decorations/' + imageFileName(sprite);
    mapDecorationSprites[sprite] = image;
  }
  const tinyTerrainAtlases = [];
  for (let color = 1; color <= 5; color++) {
    const image = trackedImage();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(true); };
    image.src = 'assets/kingdom-autotile/' + imageFileName('Tilemap_color' + color);
    tinyTerrainAtlases.push(image);
  }
  // Water assets come from AutoTile.zip; its blue background happens to be
  // pixel-identical to the older Tiny Swords water tile.
  const autoTileWaterBackground = trackedImage();
  autoTileWaterBackground.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  autoTileWaterBackground.src = 'assets/kingdom-autotile/water-background.png';
  const autoTileWaterFoam = trackedImage();
  autoTileWaterFoam.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  autoTileWaterFoam.src = 'assets/kingdom-autotile/water-foam.png';
  const cloudSprites = Array.from({ length: 8 }, (_, index) => {
    const image = trackedImage();
    const asset = imageFileName('Clouds_' + String(index + 1).padStart(2, '0'));
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.onerror = () => console.error('[Kingdom cloud asset] Falha ao carregar ' + asset);
    image.src = 'assets/kingdom-clouds/' + asset;
    return image;
  });
  const cloudSystem = createCloudSystem(cloudSprites, sessionSeed);
  const fogCanvas = $('cloudAtmosphere');
  const atmosphericLayer = new AtmosphericLayer({
    canvas: fogCanvas,
    preset: 'dense',
    options: atmosphereProfileForZoom(mapZoom),
    autoStart: false,
    maxPixels: 300_000,
  });
  fogCanvas.style.opacity = String(atmosphereLayerOpacityForZoom(mapZoom));
  let atmosphericProfile = atmosphereProfileForZoom(mapZoom);
  function syncAtmosphereWithZoom() {
    fogCanvas.hidden = mapZoom >= 2;
    cloudSpritesCanvas.hidden = mapZoom >= 2;
    fogCanvas.style.opacity = String(atmosphereLayerOpacityForZoom(mapZoom));
    cloudSpritesCanvas.style.opacity = String(atmosphereZoomProfile(mapZoom).cloudLayerOpacity);
    const next = atmosphereProfileForZoom(mapZoom);
    if (Object.keys(next).some(key => Math.abs(next[key] - atmosphericProfile[key]) >= .012)) {
      atmosphericLayer.setOptions(next);
      atmosphericProfile = next;
    }
  }
  const tinyCorralSprite = trackedImage();
  tinyCorralSprite.onload = () => {
    invalidateStaticDepthCache();
    if (visualPack === 'tiny-swords') queueAssetRender();
  };
  tinyCorralSprite.src = 'assets/construction-variants/' + imageFileName('kingdom-curral');
  const tinyMeatSprite = trackedImage();
  tinyMeatSprite.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  tinyMeatSprite.src = 'assets/tiny-swords/meat-resource.png';
  const showCropFieldGround = false;
  const cropFieldTexture = showCropFieldGround ? trackedImage() : null;
  if (cropFieldTexture) {
    cropFieldTexture.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(true); };
    cropFieldTexture.src = 'assets/kingdom-autotile/rice-field-ground.png';
  }
  const riceGrowthWindTexture = trackedImage();
  riceGrowthWindTexture.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  riceGrowthWindTexture.src = 'assets/kingdom-autotile/rice-growth-wind.png';
  const healthBarSprites = { track: {}, fills: {} };
  for (const part of ['left', 'center', 'right']) {
    const image = trackedImage();
    image.onload = queueAssetRender;
    image.src = 'assets/kingdom-ui/' + imageFileName('hud-big-track-' + part);
    healthBarSprites.track[part] = image;
  }
  const personBarSprites = { track: {}, fills: {} };
  for (const part of ['left', 'center', 'right']) {
    const image = trackedImage();
    image.onload = queueAssetRender;
    image.src = 'assets/kingdom-ui/' + imageFileName('hud-small-track-' + part);
    personBarSprites.track[part] = image;
  }
  for (const color of ['red', 'yellow', 'green']) {
    const image = trackedImage();
    image.onload = queueAssetRender;
    image.src = 'assets/kingdom-ui/' + imageFileName('hud-big-fill-' + color);
    healthBarSprites.fills[color] = image;
  }
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    const image = trackedImage();
    image.onload = queueAssetRender;
    image.src = 'assets/kingdom-ui/' + imageFileName('hud-small-fill-' + color);
    personBarSprites.fills[color] = image;
  }
  const commanderIcon = trackedImage();
  commanderIcon.onload = queueAssetRender;
  commanderIcon.src = 'assets/kingdom-ui/icon-05.png';
  const generalSwordSprites = Object.create(null);
  for (const color of ['black', 'cyan', 'purple', 'red', 'yellow']) {
    generalSwordSprites[color] = {};
    for (const part of ['left', 'center', 'right']) {
      const image = trackedImage();
      image.onload = queueAssetRender;
      image.src = 'assets/kingdom-ui/' + imageFileName('sword-' + color + '-' + part);
      generalSwordSprites[color][part] = image;
    }
  }
  const tinyWoodSprite = trackedImage();
  tinyWoodSprite.onload = queueAssetRender;
  tinyWoodSprite.src = 'assets/tiny-swords/wood-resource.png';
  for (let variant = 1; variant <= 4; variant++) {
    const image = trackedImage();
    image.onload = queueAssetRender;
    image.src = 'assets/tiny-swords/rocks/' + imageFileName('rock-' + variant);
    tinyRockSprites[variant] = image;
  }
  for (const kind of MINERAL_SPRITE_KINDS) for (let variant = 1; variant <= 6; variant++) {
    const image = trackedImage();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/minerals/' + imageFileName(kind + '-stone-' + variant);
    tinyMineralSprites[kind][variant] = image;
  }
  let terrainAssetRenderQueued = false;
  function queueAssetRender(terrain = false) {
    terrainAssetRenderQueued ||= terrain === true;
    if (assetRenderQueued) return;
    assetRenderQueued = true;
    window.requestAnimationFrame(() => {
      assetRenderQueued = false; assetRevision++;
      if (terrainAssetRenderQueued) {
        terrainAssetRenderQueued = false; terrainAssetRevision++; groundCacheKey = '';
        terrainChunks.invalidateAll();
      }
      invalidateStaticDepthCache();
      if (world) render();
    });
  }
  let manualVisualPosition = null;
  function visualPose(kind, agent) {
    // Interpolation samples are stamped with real snapshot arrival times.
    const pose = movementInterpolator.pose(kind, agent, renderTimestamp ?? performance.now());
    if (kind === 'person' && agent.playerControlled) {
      const now = renderTimestamp ?? performance.now();
      if (!manualVisualPosition || manualVisualPosition.id !== agent.id
          || Math.hypot(agent.x - manualVisualPosition.x, agent.y - manualVisualPosition.y) > 5) {
        manualVisualPosition = { id: agent.id, x: agent.x, y: agent.y, time: now };
      }
      const alpha = 1 - Math.exp(-Math.max(0, now - manualVisualPosition.time) / 35);
      manualVisualPosition.x += (agent.x - manualVisualPosition.x) * alpha;
      manualVisualPosition.y += (agent.y - manualVisualPosition.y) * alpha;
      manualVisualPosition.time = now;
      pose.x = manualVisualPosition.x; pose.y = manualVisualPosition.y;
      pose.moving = manualHeldKeys.has('w') || manualHeldKeys.has('a') || manualHeldKeys.has('s') || manualHeldKeys.has('d');
      pose.dirX = agent.militaryFacingX || 1; pose.dirY = agent.militaryFacingY || 0;
    }
    const action = kind === 'person' ? agent.combatAction : null;
    if (action?.attackVariant === 'lance-flurry') {
      const elapsed = actorAnimationClock.elapsed('combat:' + agent.id, String(action.id), animationTime);
      if (elapsed < action.durationMs)
        return { ...pose, moving: false, dirX: 0, dirY: 0 };
    }
    if (kind !== 'person' || !agent.towerMounted) return pose;
    const tower = structuresById.get(agent.towerDutyId);
    return tower ? { ...pose, x: tower.x, y: tower.y - 3, moving: false }
      : { ...pose, moving: false };
  }
  function updateIndividualTrails(now) {
    if (!world) return;
    const visibleWear = ROAD_RULES.visibleAt;
    const minSampleDistance = 2.2;
    const maxSegmentDistance = TILE * 6;
    const maxPointSpacing = TILE * .2;
    const wornGroundAt = point => {
      const x = Math.round(point.x / TILE - .5);
      const y = Math.round(point.y / TILE - 1);
      const tile = cell(x, y);
      return tile?.terrain === 'land' && tile.cropFieldId == null && (tile.roadWear || 0) >= visibleWear
        ? tile : null;
    };
    const isWalkableGround = point => !!wornGroundAt(point);
    const pressureForWear = wear => .34 + Math.sqrt(Math.max(0, Math.min(1,
      (wear - visibleWear) / (ROAD_RULES.maxWear - visibleWear)))) * .86;
    const queuePoints = (key, points) => {
      if (!points.length) return;
      let pending = pendingPersonTrailPoints.get(key);
      if (!pending) pendingPersonTrailPoints.set(key, pending = []);
      for (const point of points) pending.push({ x: point.x * trailCanvasScale, y: point.y * trailCanvasScale, p: point.p });
    };
    const breakTrail = id => {
      trailLastPositionByPerson.delete(id);
      trailSegmentByPerson.set(id, (trailSegmentByPerson.get(id) || 0) + 1);
    };

    for (const person of world.people || []) {
      const id = person.id;
      if (!person.alive) {
        trailLastPositionByPerson.delete(id);
        trailSegmentByPerson.delete(id);
        continue;
      }
      if (person.restingStructureId != null || person.towerMounted) {
        if (trailLastPositionByPerson.has(id)) breakTrail(id);
        continue;
      }
      const pose = combatDisplayPose(person, visualPose('person', person));
      if (!pose.moving) continue;
      const current = { x: (pose.x + .5) * TILE, y: (pose.y + 1) * TILE };
      if (!isWalkableGround(current)) {
        if (trailLastPositionByPerson.has(id)) breakTrail(id);
        continue;
      }
      const previous = trailLastPositionByPerson.get(id);
      if (!previous) {
        trailLastPositionByPerson.set(id, current);
        continue;
      }
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
      if (distance < minSampleDistance) continue;
      if (distance > maxSegmentDistance) {
        breakTrail(id);
        trailLastPositionByPerson.set(id, current);
        continue;
      }

      const samples = Math.max(1, Math.ceil(distance / maxPointSpacing));
      let pathPoints = [];
      let inGap = false;
      let segment = trailSegmentByPerson.get(id) || 0;
      for (let i = 1; i <= samples; i++) {
        const ratio = i / samples;
        const point = { x: previous.x + (current.x - previous.x) * ratio,
          y: previous.y + (current.y - previous.y) * ratio };
        const tile = wornGroundAt(point);
        if (tile) {
          pathPoints.push({ ...point, p: pressureForWear(tile.roadWear || 0) });
          inGap = false;
        } else if (!inGap) {
          queuePoints(id + ':' + segment, pathPoints);
          pathPoints = [];
          segment++;
          inGap = true;
        }
      }
      queuePoints(id + ':' + segment, pathPoints);
      trailSegmentByPerson.set(id, segment);
      trailLastPositionByPerson.set(id, current);
    }

    if (now - lastTrailFlushAt >= 180 && pendingPersonTrailPoints.size) {
      dirtBrush.appendPaths(Array.from(pendingPersonTrailPoints, ([key, points]) => ({
        key, points, options: { size: trailBrushSize, irregularity: PATH_EDGE_IRREGULARITY }
      })));
      pendingPersonTrailPoints.clear();
      lastTrailFlushAt = now;
    }
  }
  function clampMapPan() {
    const mapSize = Math.min(stage.clientWidth, stage.clientHeight) * mapZoom;
    const maxX = Math.max(0, (mapSize - stage.clientWidth) / 2);
    const maxY = Math.max(0, (mapSize - stage.clientHeight) / 2);
    mapPanX = Math.max(-maxX, Math.min(maxX, mapPanX));
    mapPanY = Math.max(-maxY, Math.min(maxY, mapPanY));
  }
  function updateMapViewport() {
    clampMapPan();
    gameAudio.refreshAmbience();
    $('mapZoomLevel').textContent = Math.round(mapZoom * 100) + '%';
    $('mapZoomOut').disabled = mapZoom <= MIN_MAP_ZOOM + .001;
    $('mapZoomIn').disabled = mapZoom >= MAX_MAP_ZOOM - .001;
    $('mapZoomReset').disabled = Math.abs(mapZoom - FIT_MAP_ZOOM) < .001 && Math.abs(mapPanX) < 1 && Math.abs(mapPanY) < 1;
    $('cameraPosition').textContent = mapZoom > MIN_MAP_ZOOM + .001 ? 'ZOOM ' + Math.round(mapZoom * 100) + '%' : 'MAPA INTEIRO';
    canvas.style.cursor = mapZoom > MIN_MAP_ZOOM + .001 ? 'grab' : 'crosshair';
    renderMiniMap();
  }
  function getMapViewport() {
    const camera = currentMapCamera();
    const { x, y, width, height } = camera.view;
    const padding = 8; // Trees, buildings, and pens can extend several cells beyond their anchor.
    return {
      x, y, width, height,
      bounds: {
        minX: Math.max(0, Math.floor(x / TILE) - padding),
        maxX: Math.min(W - 1, Math.ceil((x + width) / TILE) + padding),
        minY: Math.max(0, Math.floor(y / TILE) - padding),
        maxY: Math.min(H - 1, Math.ceil((y + height) / TILE) + padding)
      }
    };
  }
  function currentMapCamera() {
    return mapCamera(stage.clientWidth, stage.clientHeight, mapZoom, mapPanX, mapPanY,
      window.devicePixelRatio || 1, LOGICAL_SIZE);
  }
  function renderMiniMap() {
    if (!world || !miniMapContext || $('miniMapPanel').hidden) return;
    const key = [world.seed, world.day, mapZoom, mapPanX.toFixed(1), mapPanY.toFixed(1), world.people.length, world.structures.length].join(':');
    if (key === miniMapRenderKey) return;
    miniMapRenderKey = key;
    const map = miniMapContext, width = miniMapCanvas.width, height = miniMapCanvas.height;
    map.clearRect(0, 0, width, height);
    const tileWidth = width / W, tileHeight = height / H;
    const colors = { blue: '#3974b8', red: '#b74f45', purple: '#8354a7', yellow: '#d5b346', black: '#59616b' };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tile = cell(x, y);
        if (!tile) continue;
        if (tile.terrain === 'water') map.fillStyle = '#3995a8';
        else if (tile.kingdomId != null) {
          const kingdom = getKingdom(tile.kingdomId);
          map.fillStyle = colors[kingdom && kingdom.palette] || '#9c8751';
        } else {
          const biomass = Array.isArray(tile.plants) ? tile.plants.reduce((sum, amount) => sum + amount, 0) : 0;
          map.fillStyle = biomass > 80 ? '#78934e' : biomass > 25 ? '#879351' : '#958751';
        }
        map.fillRect(x * tileWidth, y * tileHeight, tileWidth + .1, tileHeight + .1);
      }
    }
    for (const structure of world.structures) {
      map.fillStyle = colors[getKingdom(structure.kingdomId)?.palette] || '#d0b36c';
      map.fillRect(structure.x - .6, structure.y - .6, 1.4, 1.4);
    }
    for (const person of world.people) if (person.alive && person.restingStructureId == null) {
      map.fillStyle = colors[getKingdom(person.kingdomId)?.palette] || '#f0e2ae';
      map.fillRect(person.x - .35, person.y - .35, .8, .8);
    }
    for (const animal of world.animals) if (animal.alive) {
      map.fillStyle = '#fff1d0';
      map.fillRect(animal.x - .3, animal.y - .3, .7, .7);
    }
    const view = getMapViewport();
    const scaleX = width / LOGICAL_SIZE, scaleY = height / LOGICAL_SIZE;
    map.strokeStyle = '#fff4ce'; map.lineWidth = 1.25;
    map.strokeRect(view.x * scaleX + .5, view.y * scaleY + .5,
      Math.max(1, view.width * scaleX - 1), Math.max(1, view.height * scaleY - 1));
  }
  function zoomMapTo(nextZoom, clientX, clientY) {
    const bounds = stage.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2, centerY = bounds.top + bounds.height / 2;
    const focusX = Number.isFinite(clientX) ? clientX : centerX;
    const focusY = Number.isFinite(clientY) ? clientY : centerY;
    const mapX = (focusX - centerX - mapPanX) / mapZoom;
    const mapY = (focusY - centerY - mapPanY) / mapZoom;
    mapZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, nextZoom));
    mapPanX = focusX - centerX - mapX * mapZoom;
    mapPanY = focusY - centerY - mapY * mapZoom;
    updateMapViewport();
    drawMap();
  }
  function resetMapViewport(zoom = FIT_MAP_ZOOM) {
    mapZoom = zoom; mapPanX = 0; mapPanY = 0;
    updateMapViewport();
    drawMap();
  }
  window.addEventListener('resize', updateMapViewport);
  for (let id = 1; id <= 4; id++) {
    const image = trackedImage();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/trees/' + imageFileName('tree-' + id);
    tinyTreeSprites[id] = image;
    const bush = trackedImage();
    bush.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    bush.src = 'assets/tiny-swords/bushes/' + imageFileName('bush-' + id);
    tinyBushSprites[id] = bush;
  }
  for (let id = 1; id <= 4; id++) {
    const image = trackedImage();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/stumps/' + imageFileName('stump-' + id);
    tinyStumpSprites[id] = image;
  }
  for (const [action, file] of Object.entries({ idle: 'sheep_idle', move: 'sheep_move', grass: 'sheep_grass' })) {
    const image = trackedImage();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/sheep/' + imageFileName(file);
    tinySheepSprites[action] = image;
  }
  const tinyPalettes = ['blue', 'red', 'purple', 'yellow', 'black'];
  const loadedTinyPalettes = new Set();
  const trainingDummySprites = Object.create(null);
  const trainingDummyColorFiles = { blue: 'azul', red: 'vermelho', purple: 'purpura', yellow: 'amarelo', black: 'preto' };
  function ensureTinyPalette(palette) {
    if (!tinyPalettes.includes(palette) || loadedTinyPalettes.has(palette)) return;
    loadedTinyPalettes.add(palette);
    trainingDummySprites[palette] = Object.create(null);
    for (const pose of ['frontal', 'diagonal']) {
      const image = trackedImage();
      image.onload = () => queueAssetRender();
      image.src = 'assets/training-dummies/boneco_treino_' + pose + '_' + trainingDummyColorFiles[palette] + '.png';
      trainingDummySprites[palette][pose] = image;
    }
    for (const action of ['idle', 'run', 'attack', 'arrow'])
      animationRenderer.load(getUnitAnimation('arqueiro', action, palette)).catch(error => console.warn(error));
    animationRenderer.load(getUnitAnimation('guerreiro', 'attack-2', palette)).catch(error => console.warn(error));
    animationRenderer.load(getUnitAnimation('monge', 'heal-effect', palette)).catch(error => console.warn(error));
    tinyBuildingSprites[palette] = Object.create(null);
    for (const key of ['house1', 'house2', 'house3', 'castle', 'tower', 'barracks', 'archery', 'monastery', 'farmhouse']) {
      const image = trackedImage();
      image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
      image.src = 'assets/tiny-swords/buildings/' + palette + '/' + imageFileName(key);
      tinyBuildingSprites[palette][key] = image;
    }
  }
  // Kingdom palettes load when the Worker first returns its world snapshot.

  function fmt(n) { return formatWholeMeasure(n); }
  function fmtRationPortions(feed) { return fmt((Number(feed) || 0) / DOMESTIC_SHEEP_DAILY_FEED); }
  function qualityLabel(score) { return score >= .62 ? 'boa' : score >= .28 ? 'moderada' : 'ruim'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, alpha) { const c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')'; }
  function mix(a, b, amount) { return a.map((v, i) => Math.round(v + (b[i] - v) * amount)); }
  function hashColor(x, y, salt) { return ((x * 92821 + y * 68917 + salt * 283) >>> 0) % 11; }
  function autoTileHash(x, y, seed = 0) {
    let value = Math.imul(x + seed * 33 + 17, 374761393) + Math.imul(y + seed * 7 + 53, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }
  function cell(x, y) { return x < 0 || y < 0 || x >= W || y >= H ? null : world.tiles[y * W + x]; }
  function plantIndex(id) { return Sim.plants.findIndex(p => p.id === id); }
  function getCommunity(id) { const entry = communitiesById.get(id); return entry && !entry.dissolved ? entry : undefined; }
  function getKingdom(id) { return kingdomsById.get(id); }
  function getPerson(id) { const entry = peopleById.get(id); return entry?.alive ? entry : undefined; }
  function getAnimal(id) { const entry = animalsById.get(id); return entry?.alive ? entry : undefined; }

  function communityPalette(id) { return tinyPalettes[Math.abs(Math.trunc(id || 0)) % tinyPalettes.length]; }

  function tinyTreeSpriteLayout(tile, type, mass) {
    const variation = hashColor(tile.x, tile.y, world.seed + 991);
    const season = Sim.modules.Cosmos.seasonIndex(world.day);
    const treeId = type === 'conifer' ? 1 + variation % 2 : season < 2 ? 3 : 4;
    const image = tinyTreeSprites[treeId];
    const frameWidth = 192;
    const frameCount = Math.max(1, Math.floor((image && image.naturalWidth || frameWidth) / frameWidth));
    const frame = ((Math.floor(animationTime / 100) + variation) % frameCount + frameCount) % frameCount;
    const maturityScale = mass > 760 ? 1 : mass > 420 ? .84 : .68;
    const naturalSize = .8 + (variation % 5) * .1;
    const scale = spriteScale(TILE, maturityScale * naturalSize);
    const width = frameWidth * scale;
    const frameHeight = image && image.naturalHeight || (treeId < 3 ? 256 : 192);
    const height = frameHeight * scale;
    const baseY = ({ 1: 241, 2: 249, 3: 170, 4: 168 })[treeId];
    const x = tile.x * TILE + TILE / 2 - width / 2;
    const y = (tile.y + 1) * TILE - baseY * scale;
    return { image, frame, frameCount, variation, frameWidth, frameHeight, x, y, width, height };
  }

  function drawTinySwordsTree(tile, type, mass, prepared = null) {
    const layout = prepared || tinyTreeSpriteLayout(tile, type, mass);
    if (!layout.image || !layout.image.complete || !layout.image.naturalWidth) return false;
    const frame = ((Math.floor(animationTime / 100) + layout.variation) % layout.frameCount + layout.frameCount) % layout.frameCount;
    ctx.drawImage(layout.image, frame * layout.frameWidth, 0, layout.frameWidth, layout.frameHeight,
      layout.x, layout.y, layout.width, layout.height);
    return true;
  }

  function tinyBushSpriteLayout(tile, plantId) {
    const index = plantIndex(plantId), mass = tile.plants[index];
    const variation = hashColor(tile.x, tile.y, world.seed + (plantId === 'browse' ? 2729 : 2011));
    const bushId = 1 + variation % 4, image = tinyBushSprites[bushId];
    if (!image || !image.complete || !image.naturalWidth) return false;
    const frameWidth = 128, frameCount = Math.max(1, Math.floor(image.naturalWidth / frameWidth));
    const size = mass >= 70 ? 1 : .67;
    const scale = spriteScale(TILE, size), width = frameWidth * scale, height = image.naturalHeight * scale;
    const footY = tile.y * TILE + TILE;
    const x = tile.x * TILE + TILE / 2 - width / 2;
    const y = footY - 79 * scale;
    return { image, variation, frameCount, frameWidth, x, y, width, height };
  }

  function drawTinySwordsBush(tile, plantId, prepared = null) {
    const layout = prepared || tinyBushSpriteLayout(tile, plantId);
    if (!layout) return false;
    const frame = ((Math.floor(animationTime / 180) + layout.variation) % layout.frameCount + layout.frameCount) % layout.frameCount;
    ctx.drawImage(layout.image, frame * layout.frameWidth, 0, layout.frameWidth, layout.image.naturalHeight,
      layout.x, layout.y, layout.width, layout.height);
    return true;
  }

  function tinySwordsSheepLayout(animal, x, y, pose) {
    const state = String(animal.state || '').toLowerCase();
    const action = animal.brain.lastAction;
    const sheet = action === 'feed' || state.includes('alimentando') ? 'grass' : pose.moving ? 'move' : 'idle';
    const image = tinySheepSprites[sheet];
    if (!image || !image.complete || !image.naturalWidth) return null;
    const frameWidth = 128, frameCount = Math.max(1, Math.floor(image.naturalWidth / frameWidth));
    const frame = ((Math.floor(animationTime / (sheet === 'grass' ? 145 : 180)) + animal.id * 2) % frameCount + frameCount) % frameCount;
    const growth = Math.max(0, Math.min(1, (animal.ageDays || 0) / SHEEP_ADULT_AGE_DAYS));
    const sheepScale = SHEEP_JUVENILE_MIN_SCALE + (1 - SHEEP_JUVENILE_MIN_SCALE) * growth;
    const scale = spriteScale(TILE, sheepScale), width = frameWidth * scale, height = image.naturalHeight * scale;
    const footY = y + TILE, x0 = x + TILE / 2 - width / 2, y0 = footY - 84 * scale;
    return { image, frame, frameWidth, frameHeight: image.naturalHeight, x: x0, y: y0, width, height };
  }

  function drawTinySwordsSheep(animal, x, y, pose) {
    const layout = tinySwordsSheepLayout(animal, x, y, pose);
    if (!layout) return false;
    ctx.drawImage(layout.image, layout.frame * layout.frameWidth, 0, layout.frameWidth, layout.frameHeight,
      layout.x, layout.y, layout.width, layout.height);
    return true;
  }

  function militaryAnimationState(person, pose) {
    const palette = getKingdom(person.kingdomId)?.palette || 'blue';
    const channelingHeal = (person.playerHealing === true || !!person.magicCast) && person.militaryClass === 'monge';
    const preview = manualAttackPreview?.personId === person.id ? manualAttackPreview : null;
    const action = preview?.action || presentedCombatAction(person);
    const contactElapsed = preview ? Math.min(animationTime - preview.startedAt, action.windupMs * .85)
      : action ? presentedCombatElapsed(person, action) : Infinity;
    const extendedMeleeAction = ['shield-bash', 'lance-charge', 'lance-flurry'].includes(action?.attackVariant);
    const attacking = (preview || action?.day === world.day || extendedMeleeAction) && contactElapsed < action.durationMs;
    const defense = person.combatDefense;
    const defenseElapsed = defense ? actorAnimationClock.elapsed('defense:' + person.id, String(defense.actionId), animationTime) : Infinity;
    const defending = defense?.day === world.day && defenseElapsed >= Math.max(0, defense.atMs - 100)
      && defenseElapsed < defense.atMs + 200;
    const comboHoldingGuard = !attacking && person.militaryClass === 'guerreiro'
      && person.combatCombo?.lastDay === world.day && person.combatCombo.count < 4;
    const preparingSpear = attacking && action.weapon === 'lanceiro' && contactElapsed < action.windupMs;
    const repeatingLanceAttack = attacking && action.weapon === 'lanceiro'
      && ['lance-charge', 'lance-flurry'].includes(action.attackVariant)
      && contactElapsed >= action.windupMs && contactElapsed < action.windupMs + action.activeMs;
    const shieldBashing = attacking && action.weapon === 'guerreiro' && action.attackVariant === 'shield-bash';
    const bowPoseElapsed = attacking && action.weapon === 'arqueiro'
      ? contactElapsed < action.windupMs
        ? Math.min(contactElapsed, ARCHER_READY_FRAME_MS)
        : ARCHER_RELEASE_FRAME_MS + contactElapsed - action.windupMs
      : contactElapsed;
    const shotElapsed = actorAnimationClock.elapsed('shot:' + person.id, String(person.lastArrowSequence || 0), animationTime);
    const shooting = !action && person.militaryClass === 'arqueiro' && person.lastArrowSequence > 0 && shotElapsed < 800;
    const restingPerson = (action || defense) && ['attack', 'defend'].includes(person.militaryAnimation)
      ? { ...person, militaryAnimationDay: -1 } : person;
    const animatedPerson = channelingHeal ? { ...person, militaryAnimation: 'heal', militaryAnimationDay: world.day }
      : attacking || shooting ? { ...person,
      militaryAnimation: preparingSpear || shieldBashing ? 'defend' : 'attack', militaryAnimationDay: world.day,
      militaryFacingX: action ? Math.cos(action.angle) : person.militaryFacingX,
      militaryFacingY: action ? Math.sin(action.angle) : person.militaryFacingY }
      : defending || comboHoldingGuard
        ? { ...person, militaryAnimation: 'defend', militaryAnimationDay: world.day } : restingPerson;
    let sprite = militarySpritePose(animatedPerson, attacking || shooting ? { ...pose, moving: false, dirX: 0, dirY: 0 } : pose, world.day);
    let animation = getUnitAnimation(sprite.unit.folder.toLowerCase(), sprite.action, palette);
    const battle = attacking || defending || comboHoldingGuard || shooting || animatedPerson.militaryAnimationDay === world.day;
    const elapsedMs = attacking ? action.weapon === 'lanceiro' && !preparingSpear
      ? (contactElapsed - action.windupMs) * (action.animationSpeedMultiplier || 1)
      : action.weapon === 'arqueiro' ? bowPoseElapsed : contactElapsed : defending ? Math.max(0, defenseElapsed - defense.atMs + 100)
      : shooting ? shotElapsed : actorAnimationClock.elapsed(person.id, animation.id + (battle ? ':' + world.day : ''), animationTime);
    if (battle && !channelingHeal && !repeatingLanceAttack && !comboHoldingGuard
        && getAnimationFrame(animation, elapsedMs, { loop: false }).done) {
      sprite = militarySpritePose(restingPerson, pose, -1);
      animation = getUnitAnimation(sprite.unit.folder.toLowerCase(), sprite.action, palette);
    }
    return { sprite, animation, elapsedMs, battle,
      loop: channelingHeal || shieldBashing || repeatingLanceAttack || comboHoldingGuard || animation.loop };
  }

  function drawMilitaryPerson(person, x, y, pose) {
    const { sprite, animation, elapsedMs, battle, loop } = militaryAnimationState(person, pose);
    const centerX = x + TILE / 2, baseY = y + TILE;
    const scale = spriteScale(TILE, CHARACTER_SPRITE_SCALE);
    const preview = manualAttackPreview?.personId === person.id ? manualAttackPreview : null;
    const action = preview?.action || presentedCombatAction(person);
    const actionElapsed = preview ? Math.min(animationTime - preview.startedAt, action.windupMs * .85)
      : action ? presentedCombatElapsed(person, action) : Infinity;
    let shieldLean = 0;
    if (action?.attackVariant === 'shield-bash') {
      const windupEnd = action.windupMs;
      const dashEnd = windupEnd + action.activeMs;
      const recovery = Math.max(1, action.recoveryMs);
      shieldLean = actionElapsed < windupEnd ? actionElapsed / Math.max(1, windupEnd)
        : actionElapsed < dashEnd ? 1
          : Math.max(0, 1 - (actionElapsed - dashEnd) / recovery);
      shieldLean = shieldLean * shieldLean * (3 - 2 * shieldLean);
    }
    const facingAngle = action?.angle ?? Math.atan2(person.militaryFacingY || 0, person.militaryFacingX || 1);
    const leanDistance = TILE * .07 * shieldLean;
    const drawCenterX = centerX + Math.cos(facingAngle) * leanDistance;
    const drawBaseY = baseY + Math.sin(facingAngle) * leanDistance;
    const leanRotation = Math.cos(facingAngle) * .085 * shieldLean;
    if (action?.attackVariant === 'lance-flurry'
        && actionElapsed >= action.windupMs && actionElapsed < action.windupMs + action.activeMs) {
      const flurryElapsed = actionElapsed - action.windupMs;
      const interval = Math.max(1, action.strikeIntervalMs || 233);
      const strikeAge = flurryElapsed % interval;
      const angle = action.angle || 0;
      const backX = Math.cos(angle), backY = Math.sin(angle);
      for (let echo = 1; echo <= 4; echo++) {
        const age = strikeAge + echo * 45;
        if (age >= 235) continue;
        ctx.save();
        ctx.globalAlpha *= .24 * (1 - age / 235);
        animationRenderer.draw(ctx, animation,
          centerX - backX * age / 235 * 3.5, baseY - backY * age / 235 * 3.5,
          { elapsedMs: Math.max(0, elapsedMs - age * (action.animationSpeedMultiplier || 1)),
            scale, flipX: sprite.flip, loop: true });
        ctx.restore();
      }
    }
    return animationRenderer.draw(ctx, animation, drawCenterX, drawBaseY,
      { elapsedMs, scale, flipX: sprite.flip,
        rotation: (pose.rotation || 0) + leanRotation,
        loop: battle ? loop : true });
  }

  function drawTinySwordsPerson(person, x, y, child, pose) {
    if (person.role === 'soldier') return drawMilitaryPerson(person, x, y, pose);
    const kingdom = getKingdom(person.kingdomId);
    const palette = kingdom ? kingdom.palette : 'blue';
    ensureTinyPalette(palette);
    const sprite = residentSpritePose(person, pose, world.day);
    const animation = getUnitAnimation('pawn', sprite.action, palette);
    return animationRenderer.draw(ctx, animation, x + TILE / 2, y + TILE,
      { elapsedMs: actorAnimationClock.elapsed(person.id, animation.id, animationTime),
        scale: spriteScale(TILE, CHARACTER_SPRITE_SCALE * (child ? .78 : 1)),
        flipX: sprite.flip, loop: true });
  }

  function drawCarriedMeat(person, x, y, pose) {
    if ((person.carriedMeat || 0) <= .01 || !tinyMeatSprite.complete || !tinyMeatSprite.naturalWidth) return;
    if (person.role !== 'soldier' && residentSpritePose(person, pose, world.day).cargoInSprite === 'meat') return;
    const size = 64 * spriteScale(TILE);
    const side = pose.dirX < 0 ? -1 : 1;
    const px = x + TILE / 2 + (side < 0 ? -size - 2 : 4);
    const py = y + TILE / 2 - size / 2 + 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tinyMeatSprite, Math.round(px), Math.round(py), size, size);
    ctx.restore();
  }

  function drawCarriedWood(person, x, y, pose) {
    if ((person.carriedWood || 0) + (person.carriedStone || 0) + (person.carriedFeed || 0) <= .01) return;
    const cargoInSprite = person.role !== 'soldier' ? residentSpritePose(person, pose, world.day).cargoInSprite : null;
    if (cargoInSprite === 'stone' && (person.carriedWood || 0) + (person.carriedFeed || 0) <= .01) return;
    if (cargoInSprite === 'wood' && (person.carriedStone || 0) + (person.carriedFeed || 0) <= .01) return;
    const side = pose.dirX < 0 ? -1 : 1, px = x + TILE / 2 + (side < 0 ? -9 : 3), py = y + TILE / 2 - 2;
    const isStone = (person.carriedStone || 0) > .01;
    const image = isStone
      ? tinyRockSprites[1 + Math.abs(Math.trunc(person.id || 0)) % 4]
      : (person.carriedWood || 0) > .01 ? tinyWoodSprite : null;
    if (image && image.complete && image.naturalWidth) {
      const size = spriteScale(TILE) * 64;
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, Math.round(px - 1), Math.round(py - 2), size, size);
      ctx.restore();
      return;
    }
    if (isStone) {
      ctx.fillStyle = '#59665f'; ctx.fillRect(px, py - 1, 7, 5);
      ctx.fillStyle = '#a3aa99'; ctx.fillRect(px + 1, py - 1, 4, 2);
      return;
    }
    ctx.fillStyle = '#61432c'; ctx.fillRect(px, py, 7, 3);
    ctx.fillStyle = '#bc8c57'; ctx.fillRect(px + 1, py - 1, 5, 2);
    ctx.fillStyle = '#e0bd84'; ctx.fillRect(px, py, 1, 2); ctx.fillRect(px + 6, py, 1, 2);
  }

  function structureSpriteKey(structure) {
    if (structure.type === 'arquearia') return 'archery';
    if (structure.type === 'monasterio') return 'monastery';
    const defaults = { castelo: 'castle', torre: 'tower', centro_militar: 'barracks', monasterio: 'monastery', arquearia: 'archery', abrigo: 'house1', roça: 'farmhouse', 'posto de coleta': 'house2' };
    return structure.spriteKey || defaults[structure.type] || 'house3';
  }

  const constructionFoundationSpecs = Object.freeze({
    castle: { asset: 'castle', sprite: 'castle', width: 320, height: 256, visualTop: 140 },
    house: { asset: 'house', sprite: 'house1', width: 128, height: 192, visualTop: 90 },
    tower: { asset: 'tower', sprite: 'tower', width: 128, height: 256, visualTop: 148 },
    barracks: { asset: 'barracks', sprite: 'barracks', width: 192, height: 256, visualTop: 9 },
    archery: { asset: 'archery', sprite: 'archery', width: 192, height: 256, visualTop: 15 },
    monastery: { asset: 'monastery', sprite: 'monastery', width: 192, height: 320, visualTop: 19 }
  });

  function constructionFoundationSpec(structure) {
    if (structure.type === 'castelo') return constructionFoundationSpecs.castle;
    if (structure.type === 'torre') return constructionFoundationSpecs.tower;
    if (structure.type === 'centro_militar') return constructionFoundationSpecs.barracks;
    if (structure.type === 'arquearia') return constructionFoundationSpecs.archery;
    if (structure.type === 'monasterio') return constructionFoundationSpecs.monastery;
    if (structure.type === 'abrigo' || structure.type === 'casa' || structureSpriteKey(structure) === 'house1') {
      return constructionFoundationSpecs.house;
    }
    return null;
  }

  function structureDisplayName(type) {
    return ({ castelo: 'Castelo', torre: 'Torre', centro_militar: 'Centro de treinamento', monasterio: 'Monastério', arquearia: 'Arquearia', vila: 'Vila', mercado: 'Mercado', curral: 'Curral', casa: 'Casa', abrigo: 'Abrigo', roça: 'Roça comunitária', 'posto de coleta': 'Posto de coleta' })[type] || type;
  }

  function tinySwordsBuildingLayout(structure, community, kingdom, x = structure.x * TILE, y = structure.y * TILE) {
    const spriteKey = structureSpriteKey(structure);
    const palette = kingdom ? kingdom.palette : community ? communityPalette(community.id) : 'blue';
    ensureTinyPalette(palette);
    const image = tinyBuildingSprites[palette] && tinyBuildingSprites[palette][spriteKey];
    if (!image || !image.complete || !image.naturalWidth) return null;
    const scale = spriteScale(TILE), width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const x0 = x + TILE / 2 - width / 2;
    const y0 = y + TILE - (BUILDING_FEET[spriteKey] || image.naturalHeight) * scale;
    return { image, x: x0, y: y0, width, height };
  }

  function drawTinySwordsBuilding(structure, community, kingdom, x, y) {
    const layout = tinySwordsBuildingLayout(structure, community, kingdom, x, y);
    if (!layout) return false;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layout.image, layout.x, layout.y, layout.width, layout.height);
    ctx.restore();
    return true;
  }

  function drawConstructionFoundation(x, y, spec) {
    const image = constructionFoundationSprites[spec.asset];
    if (!image || !image.complete || !image.naturalWidth) return false;
    const scale = spriteScale(TILE), width = spec.width * scale, height = spec.height * scale;
    const feet = BUILDING_FEET[spec.sprite] || spec.height;
    const x0 = x + TILE / 2 - width / 2;
    const y0 = y + TILE - feet * scale;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, x0, y0, width, height);
    ctx.restore();
    return true;
  }

  function drawConstructionProgressBar(structure, x, y, spec) {
    const scale = spriteScale(TILE);
    const feet = BUILDING_FEET[spec.sprite] || spec.height;
    const foundationTop = y + TILE - feet * scale + spec.visualTop * scale;
    const width = Math.max(TILE * 2, spec.width * scale);
    const ratio = structure.required > 0
      ? Math.max(0, Math.min(1, (structure.progress || 0) / structure.required)) : 0;
    drawWorldHealthBar(x + TILE / 2 - width / 2, foundationTop - 7, width, 4, ratio, 'yellow');
  }

  function tinyTerrainPalette(season = Sim.modules.Cosmos.seasonIndex(world.day)) {
    return SEASON_TERRAIN_PALETTES[season] ?? SEASON_TERRAIN_PALETTES[0];
  }

  function seasonalTerrainTransition(day) {
    const date = Sim.modules.Cosmos.calendarDate(day);
    const daysRemaining = date.daysInSeason - date.dayOfSeason;
    const denominator = Math.max(1, SEASON_TERRAIN_TRANSITION_DAYS - 1);
    const progress = Math.max(0, Math.min(1,
      (SEASON_TERRAIN_TRANSITION_DAYS - 1 - daysRemaining) / denominator));
    return {
      season: date.season,
      nextSeason: date.nextSeason,
      alpha: progress * progress * (3 - 2 * progress)
    };
  }

  function tileElevation(t) {
    return Number.isInteger(t.elevationLevel) ? t.elevationLevel : (t.heightM || 0) >= 320 ? 1 : 0;
  }

  function autoTileCoord(t, layer) {
    const hasLayer = (x, y) => {
      const neighbor = cell(x, y);
      return !!neighbor && neighbor.terrain !== 'water' && tileElevation(neighbor) >= layer;
    };
    const west = hasLayer(t.x - 1, t.y), east = hasLayer(t.x + 1, t.y);
    const north = hasLayer(t.x, t.y - 1), south = hasLayer(t.x, t.y + 1);
    const col = !west && !east ? 3 : !west ? 0 : !east ? 2 : 1;
    const row = !north && !south ? 3 : !north ? 0 : !south ? 2 : 1;
    return { col, row };
  }

  function drawTinyAtlasTile(image, col, row, x, y) {
    if (!image || !image.complete || !image.naturalWidth) return false;
    const [sx, , , sy, tx, ty] = mapTransform;
    const left = Math.round(x * sx + tx), top = Math.round(y * sy + ty);
    const width = Math.round((x + TILE) * sx + tx) - left;
    const height = Math.round((y + TILE) * sy + ty) - top;
    const tile = pixelTiles.get(image, col * 64, row * 64, 64, 64, width, height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (tile) ctx.drawImage(tile, left, top);
    else ctx.drawImage(image, col * 64, row * 64, 64, 64, left, top, width, height);
    ctx.setTransform(...mapTransform);
    return true;
  }

  function hasElevation(x, y) {
    const tile = cell(x, y);
    return !!tile && tile.terrain !== 'water' && tileElevation(tile) > 0;
  }

  function rampFits(x, y, side) {
    if (side !== 1 && side !== 2) return false;
    const lower = cell(x, y), lowerFoot = cell(x, y + 1);
    const highX = x + (side === 1 ? 1 : -1);
    const high = cell(highX, y), highFoot = cell(highX, y + 1);
    return !!lower && !!lowerFoot && !!high && !!highFoot
      && lower.terrain !== 'water' && lowerFoot.terrain !== 'water'
      && tileElevation(lower) === 0 && tileElevation(lowerFoot) === 0
      && hasElevation(highX, y) && !hasElevation(highX, y + 1);
  }

  function isValidTinyRamp(tile) {
    return tile && tile.rampSegment === 1 && tile.rampLevel === 1
      && rampFits(tile.x, tile.y, tile.rampSide);
  }

  function hasLeftRamp(x, y) {
    return isValidTinyRamp(cell(x - 1, y)) && cell(x - 1, y).rampSide === 1;
  }

  function hasRightRamp(x, y) {
    return isValidTinyRamp(cell(x + 1, y)) && cell(x + 1, y).rampSide === 2;
  }

  function cliffColumn(x, y) {
    const west = hasElevation(x - 1, y), east = hasElevation(x + 1, y);
    return !west && !east ? 8 : !west ? 5 : !east ? 7 : 6;
  }

  function cliffTopCoord(x, y) {
    let west = hasElevation(x - 1, y), east = hasElevation(x + 1, y);
    const north = hasElevation(x, y - 1), south = hasElevation(x, y + 1);
    if (!west && east && hasLeftRamp(x, y)) west = true;
    if (!east && west && hasRightRamp(x, y)) east = true;
    const col = !west && !east ? 3 : !west ? 0 : !east ? 2 : 1;
    const row = !north && !south ? 3 : !north ? 0 : !south ? 2 : 1;
    return { col: col + 5, row };
  }

  // Match AutoTile's paint order: the low ground stays visible, the south
  // facing wall occupies the tile below the raised edge, then ramp and top.
  function drawTinyCliffFaces(bounds) {
    for (const t of terrainTiles(bounds)) {
      if (!hasElevation(t.x, t.y) || hasElevation(t.x, t.y + 1)) continue;
      const lower = cell(t.x, t.y + 1);
      if (!lower) continue;
      const atlas = tinyTerrainAtlases[tinyTerrainPalette()];
      if (!atlas || !atlas.complete || !atlas.naturalWidth) continue;
      let column = cliffColumn(t.x, t.y);
      if (hasLeftRamp(t.x, t.y) && (column === 5 || column === 8)) column = 6;
      if (hasRightRamp(t.x, t.y) && (column === 7 || column === 8)) column = 6;
      const row = lower.terrain === 'water' ? 5 : 4;
      drawTinyAtlasTile(atlas, column, row, t.x * TILE, lower.y * TILE);
    }
  }

  function drawTinyElevationLayer(bounds) {
    for (const t of terrainTiles(bounds)) {
      if (!hasElevation(t.x, t.y)) continue;
      const atlas = tinyTerrainAtlases[tinyTerrainPalette()];
      const coord = cliffTopCoord(t.x, t.y);
      drawTinyAtlasTile(atlas, coord.col, coord.row, t.x * TILE, t.y * TILE);
    }
  }

  function drawTinyRamps(bounds) {
    for (const t of terrainTiles(bounds)) {
      if (!isValidTinyRamp(t)) continue;
      const high = cell(t.x + (t.rampSide === 1 ? 1 : -1), t.y);
      const atlas = high && tinyTerrainAtlases[tinyTerrainPalette()];
      if (!atlas || !atlas.complete || !atlas.naturalWidth) continue;
      const column = t.rampSide === 1 ? 0 : 3;
      drawTinyAtlasTile(atlas, column, 4, t.x * TILE, t.y * TILE);
      drawTinyAtlasTile(atlas, column, 5, t.x * TILE, (t.y + 1) * TILE);
    }
  }

  function* terrainTiles(bounds) {
    if (!bounds) { yield* world.tiles; return; }
    for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
      yield world.tiles[y * W + x];
    }
  }

  function drawTinySwordsGround(bounds) {
    const baseAtlas = tinyTerrainAtlases[0];
    if (!baseAtlas || !baseAtlas.complete || !baseAtlas.naturalWidth) return false;
    const transition = seasonalTerrainTransition(world.day);
    const currentAtlas = tinyTerrainAtlases[tinyTerrainPalette(transition.season)];
    for (const t of terrainTiles(bounds)) {
      if (t.terrain === 'water') continue;
      const x = t.x * TILE, y = t.y * TILE;
      const coord = autoTileCoord(t, 0);
      drawTinyAtlasTile(currentAtlas && currentAtlas.complete && currentAtlas.naturalWidth
        ? currentAtlas : baseAtlas, coord.col, coord.row, x, y);
    }
    if (transition.alpha > 0) {
      const nextAtlas = tinyTerrainAtlases[tinyTerrainPalette(transition.nextSeason)];
      if (nextAtlas && nextAtlas.complete && nextAtlas.naturalWidth) {
        ctx.save();
        ctx.globalAlpha = transition.alpha;
        for (const t of terrainTiles(bounds)) {
          if (t.terrain === 'water') continue;
          const coord = autoTileCoord(t, 0);
          drawTinyAtlasTile(nextAtlas, coord.col, coord.row, t.x * TILE, t.y * TILE);
        }
        ctx.restore();
      }
    }
    return true;
  }

  function drawGround(bounds) {
    if (drawTinySwordsGround(bounds)) return;
    for (const t of terrainTiles(bounds)) {
      if (t.terrain === 'water') continue;
      const x = t.x * TILE, y = t.y * TILE, variation = hashColor(t.x, t.y, world.seed);
      if (t.terrain === 'rock') {
        const stone = [112 + variation, 117 + variation, 105 + variation];
        ctx.fillStyle = 'rgb(' + stone.join(',') + ')'; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = rgba('#d5d0b5', .24); ctx.fillRect(x + 2, y + 2, 8 + variation % 4, 3);
        ctx.fillStyle = rgba('#34463e', .3); ctx.fillRect(x + 7, y + 9, 7, 5);
        if (variation % 3 === 0) { ctx.fillStyle = '#789078'; ctx.fillRect(x + 4, y + 12, 4, 2); }
      } else {
        const wet = Math.max(0, Math.min(1, t.soilWaterMm / t.soilCapacityMm));
        let ground = t.soilType === 'shallow' ? [112, 116, 88] : t.soilType === 'sandy' ? [152, 139, 98] : t.soilType === 'riparian' ? [77, 111, 73] : [88, 119, 72];
        ground = mix(ground, [142, 123, 83], Math.max(0, .42 - wet) * .54);
        ground = ground.map(v => Math.min(220, v + variation * .75));
        ctx.fillStyle = 'rgb(' + ground.join(',') + ')';
        ctx.fillRect(x, y, TILE, TILE);
        if (variation % 4 === 0) { ctx.fillStyle = '#d5c99a4d'; ctx.fillRect(x + 3 + variation % 5, y + 4 + variation % 6, 2, 1); }
      }
    }
  }

  function drawGroundPlants(bounds) {
    if (!showCropFieldGround || !cropFieldTexture) return;
    for (const t of terrainTiles(bounds)) {
      if (t.terrain === 'water') continue;
      const px = t.x * TILE, py = t.y * TILE;
      if (t.cropFieldId == null) continue;
      const tileSize = TILE;
      const columns = Math.floor(cropFieldTexture.naturalWidth / tileSize);
      const rows = Math.floor(cropFieldTexture.naturalHeight / tileSize);
      if (!cropFieldTexture.complete || !columns || !rows) continue;
      const variantCount = columns * rows;
      const variant = Math.min(variantCount - 1,
        Math.floor(autoTileHash(t.x, t.y, world.seed + 2147) * variantCount));
      const sourceX = (variant % columns) * tileSize;
      const sourceY = Math.floor(variant / columns) * tileSize;
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cropFieldTexture, sourceX, sourceY, tileSize, tileSize,
        ...alignedTileRect(px, py, TILE, mapTransform));
      ctx.restore();
    }
  }

  const waterEdgeOffsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let shorelineRevision = -1, shorelineTiles = [];
  function collectShoreline() {
    if (shorelineRevision === session.revision) return shorelineTiles;
    shorelineTiles = [];
    for (const tile of world.tiles) {
      if (tile.terrain === 'water') continue;
      const edges = waterEdgeOffsets.filter(([dx, dy]) => {
        const neighbor = cell(tile.x + dx, tile.y + dy);
        return !neighbor || neighbor.terrain === 'water';
      });
      if (edges.length) shorelineTiles.push({ tile, edges, phase: autoTileHash(tile.x, tile.y, world.seed + 65) });
    }
    shorelineRevision = session.revision;
    return shorelineTiles;
  }

  function drawTinyWaterFoam(bounds) {
    const frameSize = 128, cropSize = 64, cropOffset = 32;
    if (!autoTileWaterFoam.complete || !autoTileWaterFoam.naturalWidth
        || autoTileWaterFoam.naturalHeight < frameSize) return;
    const frameCount = Math.floor(autoTileWaterFoam.naturalWidth / frameSize);
    if (!frameCount) return;
    if (!referenceRendering) {
      for (const { tile, edges, phase } of collectShoreline()) {
        const { x, y } = tile;
        if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
        const frame = Math.floor(animationTime / 110 + phase * frameCount) % frameCount;
        for (const [dx, dy] of edges) {
          ctx.drawImage(autoTileWaterFoam, frame * frameSize + cropOffset, cropOffset, cropSize, cropSize,
            x * TILE + dx * TILE * .18, y * TILE + dy * TILE * .18, TILE, TILE);
        }
      }
      return;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const edges = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const tile = cell(x, y);
        if (!tile || tile.terrain === 'water') continue;
        const hasWaterEdge = edges.some(([dx, dy]) => {
          const neighbor = cell(x + dx, y + dy);
          return !neighbor || neighbor.terrain === 'water';
        });
        if (!hasWaterEdge) continue;
        const frame = Math.floor(animationTime / 110
          + autoTileHash(x, y, world.seed + 65) * frameCount) % frameCount;
        const sourceX = frame * frameSize + cropOffset;
        for (const [dx, dy] of edges) {
          const neighbor = cell(x + dx, y + dy);
          if (neighbor && neighbor.terrain !== 'water') continue;
          ctx.drawImage(autoTileWaterFoam, sourceX, cropOffset, cropSize, cropSize,
            x * TILE + dx * TILE * .18, y * TILE + dy * TILE * .18, TILE, TILE);
        }
      }
    }
    ctx.restore();
  }

  function getWaterRockDistances() {
    if (waterRockDistanceWorld === world && waterRockDistances) return waterRockDistances;
    const maxDistance = 24;
    const distances = new Uint8Array(W * H);
    distances.fill(255);
    const queue = new Int32Array(W * H);
    let head = 0, tail = 0;
    const isOcean = tile => tile?.terrain === 'water' && tile.waterKind === 'ocean';
    const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const tile of world.waterTiles || []) {
      if (!isOcean(tile)) continue;
      const shoreCell = neighbors.some(([dx, dy]) => {
        const neighbor = cell(tile.x + dx, tile.y + dy);
        return neighbor && neighbor.terrain !== 'water';
      });
      if (!shoreCell) continue;
      const index = tile.y * W + tile.x;
      distances[index] = 1;
      queue[tail++] = index;
    }
    while (head < tail) {
      const index = queue[head++], distance = distances[index];
      if (distance >= maxDistance) continue;
      const x = index % W, y = Math.floor(index / W);
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx, nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= W || nextY >= H) continue;
        const nextIndex = nextY * W + nextX;
        if (distances[nextIndex] !== 255 || !isOcean(world.tiles[nextIndex])) continue;
        distances[nextIndex] = distance + 1;
        queue[tail++] = nextIndex;
      }
    }
    waterRockDistanceWorld = world;
    waterRockDistances = distances;
    return distances;
  }

  function getWaterRockPlacements() {
    if (waterRockPlacementsWorld === world && waterRockPlacements) return waterRockPlacements;
    const distances = getWaterRockDistances();
    const bands = [
      { min: 16, max: 24, limit: 10, candidates: [] },
      { min: 8, max: 15, limit: 12, candidates: [] }
    ];
    const shoreDensities = [0, .5, .32, .2, .12, .065, .03, .012];
    const placements = [];
    for (const tile of world.waterTiles || []) {
      const shoreDistance = distances[tile.y * W + tile.x];
      if (shoreDistance >= 1 && shoreDistance <= 7) {
        const chance = autoTileHash(tile.x, tile.y, world.seed + 4591);
        if (chance >= shoreDensities[shoreDistance]) continue;
        const variant = Math.floor(autoTileHash(tile.x, tile.y, world.seed + 4603) * 4) + 1;
        const phase = Math.floor(autoTileHash(tile.x, tile.y, world.seed + 4619) * 16);
        const size = Math.max(.58, 1.18 - (shoreDistance - 1) * .1);
        placements.push({ x: tile.x, y: tile.y, variant, phase, size });
        continue;
      }
      const band = bands.find(item => shoreDistance >= item.min && shoreDistance <= item.max);
      if (!band) continue;
      const density = shoreDistance <= 15 ? .018 : .01;
      const chance = autoTileHash(tile.x, tile.y, world.seed + 5399);
      if (chance >= density) continue;
      band.candidates.push({ x: tile.x, y: tile.y, shoreDistance,
        priority: autoTileHash(tile.x, tile.y, world.seed + 5417) });
    }

    const minSeparationSquared = 12 * 12;
    for (const band of bands) {
      band.candidates.sort((a, b) => a.priority - b.priority);
      let placedInBand = 0;
      for (const candidate of band.candidates) {
        if (placements.some(rock => (rock.x - candidate.x) ** 2 + (rock.y - candidate.y) ** 2 < minSeparationSquared)) continue;
        const variant = Math.floor(autoTileHash(candidate.x, candidate.y, world.seed + 5431) * 4) + 1;
        const phase = Math.floor(autoTileHash(candidate.x, candidate.y, world.seed + 5443) * 16);
        const size = Math.max(.58, 1.18 - (candidate.shoreDistance - 1) * .1);
        placements.push({ x: candidate.x, y: candidate.y, variant, phase, size });
        if (++placedInBand >= band.limit) break;
      }
    }
    waterRockPlacementsWorld = world;
    waterRockPlacements = placements;
    return placements;
  }

  function drawWaterRocks(bounds) {
    for (const rock of getWaterRockPlacements()) {
      if (rock.x < bounds.minX - 2 || rock.x > bounds.maxX + 2
          || rock.y < bounds.minY - 2 || rock.y > bounds.maxY + 2) continue;
      animationRenderer.draw(ctx, 'nature.water-rocks-' + String(rock.variant).padStart(2, '0'),
        (rock.x + .5) * TILE, (rock.y + .5) * TILE,
        { elapsedMs: animationTime, phase: rock.phase, scale: spriteScale(TILE, rock.size) });
    }
  }

  function drawRiceGrowthWindOverlay(bounds) {
    if (!world || visualPack !== 'tiny-swords'
        || !riceGrowthWindTexture.complete || riceGrowthWindTexture.naturalWidth === 0) return;
    const crop = plantIndex('cultivated-root');
    const tileSize = SOURCE_TILE_PIXELS;
    const frameCount = Math.floor(riceGrowthWindTexture.naturalWidth / tileSize);
    const growthStageCount = Math.floor(riceGrowthWindTexture.naturalHeight / tileSize);
    if (frameCount < 16 || growthStageCount < 4 || crop < 0) return;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const minX = Math.max(0, bounds?.minX ?? 0), maxX = Math.min(W - 1, bounds?.maxX ?? W - 1);
    const minY = Math.max(0, bounds?.minY ?? 0), maxY = Math.min(H - 1, bounds?.maxY ?? H - 1);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const tile = world.tiles[y * W + x];
      if (!tile || tile.terrain === 'water' || tile.cropFieldId == null) continue;
      const cropMass = tile.plants[crop] || 0;
      if (cropMass < .8) continue;
      const growthStage = cropMass >= 80 ? 3 : cropMass >= 50 ? 2 : cropMass >= 24 ? 1 : 0;
      const windFrame = (Math.floor(animationTime / 50)
        + hashColor(tile.x, tile.y, world.seed + 991)) % frameCount;
      const sourceX = windFrame * tileSize;
      const sourceY = growthStage * tileSize;
      const [drawX, drawY, drawWidth, drawHeight] = alignedTileRect(
        tile.x * TILE, tile.y * TILE, TILE, mapTransform
      );
      ctx.drawImage(riceGrowthWindTexture, sourceX, sourceY, tileSize, tileSize,
        drawX, drawY, drawWidth, drawHeight);
    }
    ctx.restore();
  }

  function traceMudBlob(tile, radiusScale, seedOffset) {
    const points = [], centerX = (tile.x + .5) * TILE, centerY = (tile.y + .5) * TILE;
    const count = 12, rotation = autoTileHash(tile.x, tile.y, world.seed + seedOffset) * Math.PI * 2;
    for (let index = 0; index < count; index++) {
      const angle = rotation + index * Math.PI * 2 / count;
      const jitter = .78 + autoTileHash(tile.x * 17 + index, tile.y * 29 - index, world.seed + seedOffset + 1) * .38;
      points.push({ x: centerX + Math.cos(angle) * TILE * radiusScale * jitter,
        y: centerY + Math.sin(angle) * TILE * radiusScale * jitter });
    }
    ctx.beginPath();
    for (let index = 0; index < count; index++) {
      const current = points[index], next = points[(index + 1) % count];
      const midpoint = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
      if (index === 0) ctx.moveTo(midpoint.x, midpoint.y);
      ctx.quadraticCurveTo(current.x, current.y, midpoint.x, midpoint.y);
    }
    ctx.closePath();
  }

  function drawRoads(bounds) {
    ctx.save();
    for (const tile of terrainTiles(bounds)) {
      const wear = tile.roadWear || 0;
      if (tile.terrain !== 'land' || tile.cropFieldId != null || !isRoadTile(tile)) continue;
      const strength = Math.max(0, Math.min(1,
        (wear - ROAD_RULES.visibleAt) / (ROAD_RULES.maxWear - ROAD_RULES.visibleAt)));
      const maturity = Math.sqrt(strength);
      const radius = .2 + maturity * .36;
      const variation = autoTileHash(tile.x, tile.y, world.seed + 2587);
      const darkVariation = Math.max(0, variation - .3) / .7 * maturity * .46;
      const outerColor = mix(mix(rgb('#C79565'), rgb('#795033'), maturity), rgb('#493222'), darkVariation);
      const innerColor = mix(mix(rgb('#D3A274'), rgb('#98643F'), maturity), rgb('#63432D'), darkVariation * .4);
      const alpha = .09 + strength * .22;
      traceMudBlob(tile, radius, 781);
      ctx.fillStyle = 'rgba(' + outerColor.join(',') + ',' + alpha + ')';
      ctx.fill();
      traceMudBlob(tile, radius * (.54 + variation * .06), 1781);
      ctx.fillStyle = 'rgba(' + innerColor.join(',') + ',' + (alpha * (.28 + maturity * .18)) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  let staticDepthCacheWorld = null, staticDepthCacheDay = -1, staticDepthItems = [];
  let staticDepthSpatialIndex = null;
  function invalidateStaticDepthCache() {
    staticDepthCacheWorld = null;
    staticDepthCacheDay = -1;
    staticDepthSpatialIndex = null;
  }

  function collectStaticDepthItems() {
    if (staticDepthCacheWorld === world && staticDepthCacheDay === world.day) return staticDepthItems;
    const items = [], broad = plantIndex('broadleaf'), conifer = plantIndex('conifer');
    const corralGates = world.structures.filter(s => s.complete && s.type === 'curral')
      .map(s => Object.assign({ structureId: s.id }, Sim.modules.SocietyExperiment.corralGate(world, s)));
    const gateCells = new Set(corralGates.map(gate => gate.y * W + gate.x));
    let sequence = 0;
    function add(kind, x, y, tile, order, id, extra) {
      const z = tile ? Math.max(0, Math.min(1800, tile.heightM || 0)) : 0;
      // Screen-space ground contact is primary; terrain elevation is the explicit Z tie-breaker.
      const depthY = extra?.depthY ?? y;
      items.push(Object.assign({ kind, x, y, z, depth: (depthY + 1) * TILE * 2048 + z, order, id: id || 0, sequence: sequence++ }, extra || {}));
    }
    for (const t of world.tiles) {
      if (t.terrain === 'water' || t.cropFieldId != null) continue;
      const tree = t.plants[broad], pine = t.plants[conifer];
      const variant = (t.x * 13 + t.y * 17 + world.seed) % 5;
      const treeAnchor = !gateCells.has(t.i) && Sim.modules.Biosphere.Botany.isTreeAnchor(world, t);
      if ((t.stoneDeposit || 0) > .7 || ['gold', 'copper', 'silver', 'iron'].some(metal => (t[metal + 'Ore'] || 0) > .05)) {
        add('mineral', t.x, t.y, t, .15, t.i, {
          tile: t, stone: t.stoneDeposit || 0, gold: t.goldOre || 0,
          copper: t.copperOre || 0, silver: t.silverOre || 0, iron: t.ironOre || 0
        });
      }
      if (treeAnchor) {
        const type = tree >= pine ? 'broadleaf' : 'conifer', mass = type === 'broadleaf' ? tree : pine;
        add('tree', t.x, t.y, t, 0, t.i, { tile: t, type, mass, variant,
          layout: referenceRendering ? null : tinyTreeSpriteLayout(t, type, mass) });
      }
      let bushAnchor = false;
      for (const plantId of ['berry', 'browse']) {
        if (isBushAnchor(world, t, plantId)) {
          bushAnchor = true;
          add('bush', t.x, t.y, t, 1, t.i, { tile: t, plantId,
            layout: referenceRendering ? null : tinyBushSpriteLayout(t, plantId) });
        }
      }
      const decoration = !treeAnchor && !bushAnchor && !isRoadTile(t) && t.stoneDeposit <= .7 && t.goldOre <= .05
        && (t.copperOre || 0) <= .05 && (t.silverOre || 0) <= .05 && (t.ironOre || 0) <= .05
        ? mapDecorationAt(t, world.seed) : null;
      if (decoration) add('decoration', t.x, t.y, t, 1.5, t.i, { decoration });
      if (t.stump && t.stump.untilDay >= world.day) add('stump', t.x, t.y, t, 2, t.i, { tile: t, stump: t.stump });
    }
    for (const item of world.logs || []) {
      if (!item.available || item.amount <= .01) continue;
      const tile = cell(Math.round(item.x), Math.round(item.y));
      if (tile && tile.cropFieldId == null) add('log', item.x, item.y, tile, 2.2, item.id, { resource: item });
    }
    for (const s of world.structures) {
      if (s.type === 'divisa') continue;
      const tile = cell(Math.round(s.x), Math.round(s.y));
      const footprint = s.type === 'castelo' ? Sim.modules.Collision.structureHitbox(s) : null;
      add('structure', s.x, s.y, tile, 2, s.id, { structure: s, depthY: structureDepthY(s, footprint) });
      if (s.complete && s.type === 'curral') {
        const radius = Math.max(2, Math.round(s.radius || 3.5));
        const centerX = Math.round(s.x), centerY = Math.round(s.y);
        const imageWidth = tinyCorralSprite.naturalWidth;
        const imageHeight = tinyCorralSprite.naturalHeight;
        if (imageWidth > 0 && imageHeight > 0) {
          const columns = radius * 2 + 1;
          const spriteWidth = columns * TILE * CORRAL_VISUAL_SCALE;
          const spriteHeight = spriteWidth * imageHeight / imageWidth;
          const rows = Math.max(1, Math.round(spriteHeight / TILE));
          const spriteX = (centerX + .5) * TILE - spriteWidth / 2;
          const spriteY = (centerY + .5) * TILE - spriteHeight / 2;
          const sourceColumnWidth = imageWidth / columns;
          const sourceRowHeight = imageHeight / rows;
          const destinationCellWidth = spriteWidth / columns;
          const destinationCellHeight = spriteHeight / rows;
          // Tile-sized slices let people and sheep pass in front of the near fence and behind the far fence.
          for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
            const destX = spriteX + column * destinationCellWidth;
            const destY = spriteY + row * destinationCellHeight;
            const x = (destX + destinationCellWidth / 2) / TILE;
            const y = (destY + destinationCellHeight) / TILE - 1;
            const sourceX = column * sourceColumnWidth;
            const sourceY = row * sourceRowHeight;
            const corralTile = cell(Math.floor(x), Math.floor(y));
            add('corral', x, y, corralTile, 2.6, s.id * 1000 + row * columns + column, {
              depthY: y, sourceX, sourceY, sourceWidth: sourceColumnWidth, sourceHeight: sourceRowHeight,
              destX, destY, destWidth: destinationCellWidth, destHeight: destinationCellHeight
            });
          }
        }
      }
    }
    for (const dummy of trainingDummiesForWorld(world)) {
      const tile = cell(Math.round(dummy.x), Math.round(dummy.y));
      add('training-dummy', dummy.x, dummy.y, tile, 2.1, dummy.id,
        { dummy, depthY: dummy.y });
    }
    staticDepthItems = referenceRendering ? items : items.sort(compareDepth);
    staticDepthSpatialIndex = referenceRendering ? null : createStaticDepthSpatialIndex(staticDepthItems);
    staticDepthCacheWorld = world;
    staticDepthCacheDay = world.day;
    return staticDepthItems;
  }

  function observeDashPresentations(nextWorld, now, reset) {
    if (reset) { dashPresentations.clear(); lastDashEvent = nextWorld.combatSequence || 0; return; }
    for (const event of nextWorld.combatEvents || []) {
      if (event.id <= lastDashEvent) continue;
      lastDashEvent = event.id;
      if (event.day !== nextWorld.day || !['shield-bash', 'lance-charge'].includes(event.attackVariant)
          || event.result?.kind === 'cancelled') continue;
      const durationMs = Math.max(event.durationMs, event.windupMs + event.activeMs + DASH_TRAIL_FADE_MS);
      dashPresentations.set(event.actorId, { action: { ...event, durationMs }, startedAt: now });
    }
  }
  function presentedCombatAction(person) {
    return dashPresentations.get(person.id)?.action || person.combatAction;
  }
  function presentedCombatElapsed(person, action) {
    const track = dashPresentations.get(person.id);
    return track?.action.id === action.id ? Math.max(0, animationTime - track.startedAt)
      : actorAnimationClock.elapsed('combat:' + person.id, String(action.id), animationTime);
  }
  function combatDisplayPose(person, pose) {
    const action = presentedCombatAction(person);
    if (!['shield-bash', 'lance-charge'].includes(action?.attackVariant)) return pose;
    const elapsed = presentedCombatElapsed(person, action);
    if (elapsed >= action.durationMs) return pose;
    return { ...pose, ...dashPosition(action, elapsed), moving: elapsed >= action.windupMs,
      dirX: Math.cos(action.angle), dirY: Math.sin(action.angle) };
  }
  function updateFollowCamera(now) {
    for (const [id, track] of dashPresentations) {
      if (animationTime - track.startedAt < track.action.durationMs) continue;
      const person = getPerson(id);
      if (person && !person.playerControlled) movementInterpolator.settleActor('person', person,
        dashPosition(track.action, track.action.durationMs), now);
      dashPresentations.delete(id);
    }
    const person = currentManualPerson();
    if (!person) return;
    const pose = combatDisplayPose(person, visualPose('person', person));
    const pan = followCameraPan(stage.clientWidth, stage.clientHeight, mapZoom, pose, TILE, LOGICAL_SIZE);
    const moved = Math.abs(mapPanX - pan.x) + Math.abs(mapPanY - pan.y) > .01;
    mapPanX = pan.x; mapPanY = pan.y;
    if (moved && lastManualPointer) updateManualAim(lastManualPointer, true, false);
  }

  function collectDepthItems(bounds) {
    // Only off-screen resources are culled. Camera zoom never thins deposits.
    const allStatic = collectStaticDepthItems();
    const staticCandidates = referenceRendering ? allStatic : staticDepthSpatialIndex.query(bounds);
    const staticItems = staticCandidates.filter(item => item.x >= bounds.minX && item.x <= bounds.maxX
      && item.y >= bounds.minY && item.y <= bounds.maxY
      && (referenceRendering || item.kind !== 'mineral'
        || shouldDrawMineralAtZoom(item, mapZoom, activeMiningSites.has(item.x + ':' + item.y))));
    const items = referenceRendering ? staticItems : [];
    let sequence = staticItems.length;
    function add(kind, x, y, tile, order, id, extra) {
      const z = tile ? Math.max(0, Math.min(1800, tile.heightM || 0)) : 0;
      items.push(Object.assign({ kind, x, y, z, depth: (y + 1) * TILE * 2048 + z, order, id: id || 0, sequence: sequence++ }, extra || {}));
    }
    for (const a of world.animals) {
      if (!a.alive) continue;
      const pose = visualPose('animal', a);
      if (pose.x < bounds.minX || pose.x > bounds.maxX || pose.y < bounds.minY || pose.y > bounds.maxY) continue;
      const tile = cell(Math.round(a.x), Math.round(a.y));
      add('animal', pose.x, pose.y, tile, 3, a.id, { animal: a, pose });
    }
    for (const p of world.people) {
      if (!p.alive || p.restingStructureId != null) continue;
      const pose = combatDisplayPose(p, visualPose('person', p));
      if (pose.x < bounds.minX || pose.x > bounds.maxX || pose.y < bounds.minY || pose.y > bounds.maxY) continue;
      const tile = cell(Math.round(pose.x), Math.round(pose.y));
      add('person', pose.x, pose.y, tile, 4, p.id, { person: p, pose });
      if (p.towerMounted) {
        const tower = structuresById.get(p.towerDutyId);
        items[items.length - 1].depth = ((tower?.y ?? p.y) + 1) * TILE * 2048 + (tile?.heightM || 0) + 1;
      }
    }
    for (const pile of world.loot || []) {
      if (pile.available && pile.x >= bounds.minX && pile.x <= bounds.maxX && pile.y >= bounds.minY && pile.y <= bounds.maxY)
        add('loot', pile.x, pile.y, cell(Math.round(pile.x), Math.round(pile.y)), 4.5, pile.id, { pile });
    }
    for (const effect of activityEffects.active(animationTime)) {
      const recipient = effect.personId != null ? getPerson(effect.personId) : null;
      if (effect.personId != null && !recipient) continue;
      const elapsed = animationTime - effect.startedAt;
      const flightDuration = effect.flightDuration || effect.duration;
      const flight = effect.projectile ? Math.min(1, Math.max(0, elapsed / flightDuration)) : 0;
      const fallProgress = effect.projectile && effect.fallDuration
        ? Math.min(1, Math.max(0, (elapsed - flightDuration) / effect.fallDuration)) : 0;
      const arcEnd = effect.arcProgressEnd ?? 1;
      const arcHeight = effect.arcHeight || 0;
      const arcAtImpact = arcHeight * Math.sin(Math.PI * arcEnd);
      const isDash = ['lance-dash', 'shield-dash'].includes(effect.animation);
      const dashAction = isDash ? { origin: { x: effect.x, y: effect.y },
        endPosition: { x: effect.endX, y: effect.endY }, activeMs: effect.activeDuration, windupMs: 0,
        attackVariant: effect.animation === 'shield-dash' ? 'shield-bash' : 'lance-charge' } : null;
      const position = isDash && Number.isFinite(effect.endX) && Number.isFinite(effect.endY)
        ? dashPosition(dashAction, elapsed)
        : recipient ? combatDisplayPose(recipient, visualPose('person', recipient)) : effect.projectile
        ? elapsed < flightDuration
          ? { x: effect.x + (effect.targetX - effect.x) * flight,
            y: effect.y + (effect.targetY + arcAtImpact - effect.y) * flight
              - arcHeight * Math.sin(Math.PI * flight * arcEnd) }
          : { x: effect.targetX,
            y: effect.targetY + ((effect.groundY ?? effect.targetY) - effect.targetY) * fallProgress }
        : effect;
      if (position.x < bounds.minX || position.x > bounds.maxX || position.y < bounds.minY || position.y > bounds.maxY) continue;
      add('effect', position.x, position.y, cell(Math.round(position.x), Math.round(position.y)), 5, effect.id,
        { effect, recipient, pose: recipient ? position : null });
      if ((effect.projectile && elapsed < flightDuration) || recipient?.towerMounted)
        items[items.length - 1].depth = Number.MAX_SAFE_INTEGER;
    }
    return referenceRendering ? items.sort(compareDepth) : mergeDepthItems(staticItems, items);
  }

  function drawParryStars(effect, centerX, feetY, person, pose) {
    if (!parryStarSprite.complete || !parryStarSprite.naturalWidth) return;
    const elapsed = Math.max(0, animationTime - effect.startedAt);
    const duration = effect.duration || 3000;
    const anchorPixels = person?.militaryClass
      ? militaryAnimationState(person, pose).animation.anchor.y : 64;
    const headY = feetY - anchorPixels * spriteScale(TILE, CHARACTER_SPRITE_SCALE) + TILE * .38;
    const crop = { x: 365, y: 366, width: 524, height: 525 };
    const particleLife = 690;
    const particleInterval = 220;
    const particleCount = Math.ceil(duration / particleInterval);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let index = 0; index < particleCount; index++) {
      const age = elapsed - index * particleInterval;
      if (age < 0 || age >= particleLife) continue;
      const progress = age / particleLife;
      const drift = Math.sin(index * 2.31) * TILE * .36 * progress;
      const bob = Math.sin(progress * Math.PI * 2 + index) * TILE * .05;
      const size = Math.max(2, Math.round(TILE * [.34, .28, .31][index % 3] * .375));
      const alpha = Math.min(1, (1 - progress) * 1.35, Math.min(1, (duration - elapsed) / 180));
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      const x = Math.round(centerX + Math.sin(index * 1.71) * TILE * .18 + drift - size / 2);
      const y = Math.round(headY - progress * TILE * .3 + bob - size / 2);
      ctx.drawImage(parryStarSprite, crop.x, crop.y, crop.width, crop.height, x, y, size, size);
    }
    ctx.restore();
  }

  function drawCombatDash(effect, centerX, feetY, person = null, pose = null) {
    if (!person) return;
    const elapsed = Math.max(0, animationTime - effect.startedAt);
    const shieldDash = effect.animation === 'shield-dash';
    const action = { origin: { x: effect.x, y: effect.y }, endPosition: { x: effect.endX, y: effect.endY },
      activeMs: effect.activeDuration || 780, windupMs: 0,
      attackVariant: shieldDash ? 'shield-bash' : 'lance-charge' };
    const angle = Math.atan2(effect.endY - effect.y, effect.endX - effect.x);
    const ghostPose = { ...(pose || {}), moving: false, dirX: Math.cos(angle), dirY: Math.sin(angle) };
    const ghostState = militaryAnimationState({ ...person, id: 'ghost:' + person.id,
      combatAction: null, combatDefense: null, combatCombo: null,
      militaryAnimation: shieldDash ? 'defend' : 'attack', militaryAnimationDay: world.day,
      militaryFacingX: Math.cos(angle), militaryFacingY: Math.sin(angle) }, ghostPose);
    ctx.save(); ctx.imageSmoothingEnabled = false;
    for (const ghost of dashGhosts(action, elapsed)) {
      ctx.globalAlpha = ghost.alpha;
      animationRenderer.draw(ctx, ghostState.animation, (ghost.x + .5) * TILE, (ghost.y + 1) * TILE, {
        elapsedMs: ghostState.elapsedMs, scale: spriteScale(TILE, CHARACTER_SPRITE_SCALE),
        flipX: ghostState.sprite.flip, loop: true
      });
    }
    ctx.restore();
  }

  function drawPersonDeath(effect, centerX, feetY) {
    if (!deathSprite.complete || !deathSprite.naturalWidth) return;
    const elapsed = Math.max(0, animationTime - effect.startedAt);
    const frameSize = effect.pixels || 128;
    const frameCount = effect.frameCount || 7;
    const transformDuration = effect.transformDurationMs || 700;
    const holdDuration = effect.skullHoldDurationMs || 10_000;
    const disappearDuration = effect.disappearDurationMs || 700;
    const scale = spriteScale(TILE, CHARACTER_SPRITE_SCALE);
    const footAnchorY = 100;
    let row = 0, frame = frameCount - 1;
    if (elapsed < transformDuration) {
      frame = Math.min(frameCount - 1, Math.floor(elapsed / transformDuration * frameCount));
    } else if (elapsed >= transformDuration + holdDuration) {
      row = 1;
      const progress = Math.min(1, (elapsed - transformDuration - holdDuration) / disappearDuration);
      frame = Math.min(frameCount - 1, Math.floor(progress * frameCount));
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(deathSprite, frame * frameSize, row * frameSize, frameSize, frameSize,
      centerX - frameSize * scale / 2, feetY - footAnchorY * scale,
      frameSize * scale, frameSize * scale);
    ctx.restore();
  }

  function projectileRotation(effect, elapsed) {
    const flightDuration = effect.flightDuration || effect.duration;
    const flight = Math.min(1, Math.max(0, elapsed / flightDuration));
    const arcEnd = effect.arcProgressEnd ?? 1;
    const arcHeight = effect.arcHeight || 0;
    const arcAtImpact = arcHeight * Math.sin(Math.PI * arcEnd);
    const verticalTangent = effect.targetY + arcAtImpact - effect.y
      - arcHeight * Math.PI * Math.cos(Math.PI * flight * arcEnd) * arcEnd;
    return Math.atan2(verticalTangent, effect.targetX - effect.x);
  }

  function drawTrainingDummyDamage(effect) {
    const elapsed = animationTime - effect.startedAt;
    const duration = effect.duration || 1050;
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    const centerX = (effect.x + .5) * TILE + Math.sin(effect.id * 2.3) * TILE * .12;
    const baseY = (effect.y + 1) * TILE - TILE * 1.35;
    const rise = TILE * 1.2 * (progress * (2 - progress));
    const label = '−' + Math.max(1, Math.round(effect.damage || 0));
    ctx.save();
    ctx.globalAlpha *= Math.pow(1 - progress, .8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.max(8, TILE * .62) + 'px MedievalSharp, Georgia, serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, TILE * .12);
    ctx.strokeStyle = '#30231c';
    ctx.fillStyle = '#ffe1a0';
    ctx.strokeText(label, centerX, baseY - rise);
    ctx.fillText(label, centerX, baseY - rise);
    ctx.restore();
  }

  function drawCombatDamageNumber(effect) {
    const elapsed = animationTime - effect.startedAt;
    const duration = effect.duration || 1050;
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    const centerX = (effect.x + .5) * TILE;
    const rise = TILE * .9 * (progress * (2 - progress));
    const centerY = (effect.y - .55) * TILE - rise;
    const label = '−' + Math.max(1, Math.round(effect.damage || 0));
    ctx.save();
    ctx.globalAlpha *= Math.pow(1 - progress, .8);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.max(10, 12 / mapZoom) + 'px monospace';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, 2 / mapZoom);
    ctx.strokeStyle = '#34221f'; ctx.fillStyle = '#fff0a8';
    ctx.strokeText(label, centerX, centerY); ctx.fillText(label, centerX, centerY);
    ctx.restore();
  }

  function drawDepthSortedWorld(bounds, profile = null) {
    magicVfx.prepare(world, animationTime, bounds, id => {
      const person = peopleById.get(id);
      return person?.alive ? combatDisplayPose(person, visualPose('person', person)) : null;
    });
    magicVfx.drawGround(ctx);
    const items = collectDepthItems(bounds);
    profile?.mark('depthOrder');
    for (const item of items) {
      if (item.kind === 'tree') drawTreeItem(item);
      else if (item.kind === 'mineral') drawMineralDeposit(item);
      else if (item.kind === 'bush') drawTinySwordsBush(item.tile, item.plantId, item.layout);
      else if (item.kind === 'decoration') drawMapDecoration(item);
      else if (item.kind === 'stump') drawTreeStump(item);
      else if (item.kind === 'log') drawLooseTreeLog(item);
      else if (item.kind === 'loot') drawLootPile(item.pile);
      else if (item.kind === 'corral') drawCorralSlice(item);
      else if (item.kind === 'training-dummy') drawTrainingDummy(item.dummy);
      else if (item.kind === 'structure') drawStructure(item.structure);
      else if (item.kind === 'animal') drawAnimal(item.animal, item.pose);
      else if (item.kind === 'person') drawPerson(item.person, item.pose);
      else if (item.kind === 'effect') {
        if (item.effect.damageNumber) {
          drawCombatDamageNumber(item.effect);
        } else if (item.effect.trainingDummyDamage) {
          drawTrainingDummyDamage(item.effect);
        } else if (item.effect.deathAnimation) {
          drawPersonDeath(item.effect, (item.x + .5) * TILE, (item.y + 1) * TILE);
        } else if (item.effect.animation === 'parry-stars') {
          drawParryStars(item.effect, (item.x + .5) * TILE, (item.y + 1) * TILE, item.recipient, item.pose);
        } else if (['lance-dash', 'shield-dash'].includes(item.effect.animation)) {
          drawCombatDash(item.effect, (item.x + .5) * TILE, (item.y + 1) * TILE,
            item.recipient, item.pose);
        } else {
          const elapsed = animationTime - item.effect.startedAt;
          const groundedAt = (item.effect.flightDuration || item.effect.duration) + (item.effect.fallDuration || 0);
          const fadeStart = item.effect.duration - 360;
          const landedAlpha = item.effect.projectile && elapsed > groundedAt && elapsed > fadeStart
            ? Math.max(0, Math.min(1, (item.effect.duration - elapsed) / 360)) : 1;
          ctx.save();
          ctx.globalAlpha *= landedAlpha;
          animationRenderer.draw(ctx, item.effect.animation,
            (item.x + .5) * TILE, (item.y + (item.effect.personId != null ? 1 : .5)) * TILE,
            { elapsedMs: elapsed, scale: TILE / item.effect.pixels,
              rotation: item.effect.projectile ? projectileRotation(item.effect, elapsed) : 0 });
          ctx.restore();
        }
      }
    }
    magicVfx.drawAura(ctx);
    if (showHitboxes) drawHitboxOverlay(bounds);
    drawMovementBlockLabels(bounds);
    if (combatDebug) drawCombatDebugOverlay(bounds);
    profile?.mark('entities');
  }

  function drawHitboxOverlay(bounds) {
    const collision = Sim.modules.Collision.worldCollisionIndex(world);
    ctx.save();
    ctx.lineWidth = Math.max(1, 1.5 / mapZoom);
    // Show the physical character mask separately from the wider proximity
    // spacing used by manual movement to avoid walking through other people.
    for (const person of world.people || []) {
      if (!person.alive || person.restingStructureId != null || person.towerMounted) continue;
      const pose = visualPose('person', person);
      const body = Sim.modules.Collision.npcHitbox(person, pose.x, pose.y);
      if (body.x < bounds.minX - 1 || body.x > bounds.maxX + 1
          || body.y < bounds.minY - 1 || body.y > bounds.maxY + 1) continue;
      ctx.beginPath(); ctx.strokeStyle = '#72e6ff';
      ctx.arc(body.x * TILE, body.y * TILE, body.radius * TILE, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle = '#ff7edb'; ctx.setLineDash([5 / mapZoom, 4 / mapZoom]);
      ctx.arc(person.x * TILE, person.y * TILE, .42 * TILE, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [index, color] of [[collision.resources, '#ffcc55'], [collision.structures, '#ff5c6c']]) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color + '24';
      for (const hitbox of index?.hitboxes || []) {
        const radius = hitbox.shape === 'circle' ? hitbox.radius : 0;
        if (hitbox.x + (hitbox.halfWidth || radius) < bounds.minX - 1
            || hitbox.x - (hitbox.halfWidth || radius) > bounds.maxX + 1
            || hitbox.y + (hitbox.halfDepth || radius) < bounds.minY - 1
            || hitbox.y - (hitbox.halfDepth || radius) > bounds.maxY + 1) continue;
        ctx.beginPath();
        if (hitbox.shape === 'circle') {
          ctx.arc(hitbox.x * TILE, hitbox.y * TILE, hitbox.radius * TILE, 0, Math.PI * 2);
        } else {
          ctx.rect((hitbox.x - hitbox.halfWidth) * TILE, (hitbox.y - hitbox.halfDepth) * TILE,
            hitbox.halfWidth * 2 * TILE, hitbox.halfDepth * 2 * TILE);
        }
        ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawMovementBlockLabels(bounds) {
    const reasonLabels = { 'map-edge': 'limite do mapa', water: 'água', rock: 'rocha',
      elevation: 'desnível', object: 'objeto/cenário', person: 'personagem', action: 'ação em andamento' };
    ctx.save();
    for (const person of world.people || []) {
      if (!person.alive || !person.playerControlled || !person.playerMovementBlockedReason
          || person.x < bounds.minX - 1 || person.x > bounds.maxX + 1
          || person.y < bounds.minY - 1 || person.y > bounds.maxY + 1) continue;
      const label = 'Bloqueio: ' + (reasonLabels[person.playerMovementBlockedReason] || 'outro');
      ctx.font = `${Math.max(10, 12 / mapZoom)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const textX = (person.x + .5) * TILE, textY = person.y * TILE - 18 / mapZoom;
      const width = ctx.measureText(label).width + 10 / mapZoom;
      ctx.fillStyle = '#17231bea'; ctx.fillRect(textX - width / 2, textY - 20 / mapZoom, width, 22 / mapZoom);
      ctx.fillStyle = '#fff0c4'; ctx.fillText(label, textX, textY - 4 / mapZoom);
    }
    ctx.restore();
  }

  function drawCombatDebugOverlay(bounds) {
    const events = (world.combatEvents || []).filter(event => event.day === world.day
      && (event.origin.x >= bounds.minX && event.origin.x <= bounds.maxX
        && event.origin.y >= bounds.minY && event.origin.y <= bounds.maxY
        || event.result?.point && event.result.point.x >= bounds.minX && event.result.point.x <= bounds.maxX
          && event.result.point.y >= bounds.minY && event.result.point.y <= bounds.maxY)).slice(-16);
    if (!events.length) return;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'bottom';
    for (const event of events) {
      const origin = { x: (event.origin.x + .5) * TILE, y: (event.origin.y + .5) * TILE };
      const aim = event.result?.point || event.aim;
      const endpoint = { x: (aim.x + .5) * TILE, y: (aim.y + .5) * TILE };
      const hit = ['body', 'shield', 'weapon-guard', 'parry', 'structure'].includes(event.result?.kind);
      const color = event.result?.kind === 'obstructed' ? '#ff9b38' : hit ? '#68ef93' : '#f05b5b';
      ctx.strokeStyle = 'rgba(245, 245, 235, .75)';
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo((event.aim.x + .5) * TILE, (event.aim.y + .5) * TILE); ctx.stroke();
      ctx.setLineDash([]);
      if (event.geometry?.type === 'swept-arc') {
        const radius = event.geometry.reach * TILE;
        const thickness = Math.max(2, event.geometry.radius * TILE);
        ctx.strokeStyle = 'rgba(95, 220, 255, .82)';
        ctx.beginPath(); ctx.arc(origin.x, origin.y, radius - thickness, event.angle - event.geometry.arcRadians,
          event.angle + event.geometry.arcRadians); ctx.stroke();
        ctx.beginPath(); ctx.arc(origin.x, origin.y, radius + thickness, event.angle - event.geometry.arcRadians,
          event.angle + event.geometry.arcRadians); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(95, 220, 255, .82)';
        ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(endpoint.x, endpoint.y); ctx.stroke();
      }
      if (['circle', 'structure-contact'].includes(event.result?.hitbox?.shape) && event.result.targetPosition) {
        ctx.strokeStyle = 'rgba(255, 230, 92, .9)';
        ctx.beginPath(); ctx.arc((event.result.targetPosition.x + .5) * TILE,
          (event.result.targetPosition.y + .5) * TILE, event.result.hitbox.radius * TILE, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(endpoint.x, endpoint.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(`#${event.id} ${event.result?.kind || 'miss'} ${event.result?.atMs ?? '—'}ms`, endpoint.x + 6, endpoint.y - 5);
    }
    ctx.restore();
  }

  function drawCorralSlice(item) {
    const image = tinyCorralSprite;
    if (!image.complete || !image.naturalWidth) return;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, item.sourceX, item.sourceY, item.sourceWidth, item.sourceHeight,
      item.destX, item.destY, item.destWidth, item.destHeight);
    ctx.restore();
  }

  function drawTreeStump(item) {
    if (visualPack !== 'tiny-swords') return;
    const isConifer = item.stump.type === 'conifer';
    const firstVariant = isConifer ? 1 : 3;
    const variant = firstVariant + hashColor(item.tile.x, item.tile.y, world.seed + 281) % 2;
    const image = tinyStumpSprites[variant];
    if (!image || !image.complete || image.naturalWidth < 128 || image.naturalHeight < 256) return;
    const anchors = { 1: { x: 35, y: 48 }, 2: { x: 30.5, y: 53 }, 3: { x: 33, y: 40 }, 4: { x: 35, y: 36 } };
    const anchor = anchors[variant], scale = spriteScale(TILE);
    const x = item.x * TILE + TILE / 2 - anchor.x * scale;
    const groundY = (item.y + 1) * TILE;
    const y = groundY - anchor.y * scale;
    if (referenceRendering) { ctx.save(); ctx.imageSmoothingEnabled = false; }
    ctx.drawImage(image, 64, 192, 64, 64, x, y, 64 * scale, 64 * scale);
    if (referenceRendering) ctx.restore();
  }

  function drawMapDecoration(item) {
    const image = mapDecorationSprites[item.decoration.sprite];
    if (!image || !image.complete || !image.naturalWidth) return;
    const scale = spriteScale(TILE, item.decoration.size);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const x = item.x * TILE + (TILE - width) / 2;
    const y = (item.y + 1) * TILE - height;
    if (referenceRendering) { ctx.save(); ctx.imageSmoothingEnabled = false; }
    ctx.drawImage(image, x, y, width, height);
    if (referenceRendering) ctx.restore();
  }

  function drawMineralDeposit(item) {
    const x = item.x * TILE, y = item.y * TILE;
    const kind = dominantMetalKind(item);
    const ore = item[kind] || 0;
    if (ore > .05) {
      const variant = mineralDepositVariant(kind, ore);
      const highlighted = activeMiningSites.has(item.x + ':' + item.y);
      if (kind === 'gold' && highlighted && animationRenderer.draw(ctx, 'resource.gold-stone-' + variant + '-highlight',
        x + TILE / 2, y + TILE / 2, { elapsedMs: animationTime, scale: spriteScale(TILE), phase: item.id || 0 })) return;
      const image = tinyMineralSprites[kind][variant];
      if (image && image.complete && image.naturalWidth) {
        const scale = spriteScale(TILE), width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        if (referenceRendering) { ctx.save(); ctx.imageSmoothingEnabled = false; }
        ctx.drawImage(image, x + TILE / 2 - width / 2, y + TILE / 2 - height / 2, width, height);
        if (referenceRendering) ctx.restore();
      }
      return;
    } else {
      const variant = 1 + ((item.x * 13 + item.y * 17 + world.seed) % 4);
      const image = tinyRockSprites[variant];
      if (image && image.complete && image.naturalWidth) {
        const scale = spriteScale(TILE) * (item.stone >= 8 ? 1.4 : 1);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        if (referenceRendering) { ctx.save(); ctx.imageSmoothingEnabled = false; }
        ctx.drawImage(image, x + TILE / 2 - width / 2, y + TILE / 2 - height / 2, width, height);
        if (referenceRendering) ctx.restore();
      }
      return;
    }
  }

  function drawLootPile(pile) {
    const x = pile.x * TILE, y = pile.y * TILE;
    if (MINERAL_SPRITE_KINDS.includes(pile.mineralKind) && (pile.resources[pile.mineralKind] || 0) > 0) {
      const image = tinyMineralSprites[pile.mineralKind][1];
      if (image?.complete && image.naturalWidth) {
        const scale = spriteScale(TILE);
        ctx.drawImage(image, x + TILE / 2 - image.naturalWidth * scale / 2,
          y + TILE / 2 - image.naturalHeight * scale / 2,
          image.naturalWidth * scale, image.naturalHeight * scale);
      }
      return;
    }
    const stoneOnly = (pile.resources.stone || 0) > 0
      && !['food', 'meat', 'wood', 'gold', 'feed'].some(resource => (pile.resources[resource] || 0) > 0);
    if (stoneOnly) {
      ctx.fillStyle = '#253b2b88'; ctx.fillRect(x + 1, y + 11, 14, 3);
      ctx.fillStyle = '#596762'; ctx.fillRect(x + 2, y + 7, 5, 4);
      ctx.fillRect(x + 8, y + 5, 6, 6);
      ctx.fillStyle = '#a4aaa0'; ctx.fillRect(x + 3, y + 7, 2, 1);
      ctx.fillRect(x + 9, y + 5, 3, 1);
      return;
    }
    ctx.fillStyle = '#253b2b88'; ctx.fillRect(x - 2, y + 10, 23, 5);
    ctx.fillStyle = '#b28a51'; ctx.fillRect(x + 3, y + 3, 11, 10);
    ctx.fillStyle = '#e1bb78'; ctx.fillRect(x + 5, y + 1, 7, 3);
    ctx.fillStyle = '#76552f'; ctx.fillRect(x + 5, y + 4, 7, 1);
    if (pile.resources.gold > 0) { ctx.fillStyle = '#f5cf58'; ctx.fillRect(x + 15, y + 8, 4, 4); }
    if (pile.resources.wood > 0) { ctx.fillStyle = '#9d653c'; ctx.fillRect(x - 2, y + 8, 6, 3); }
    if ((pile.resources.food || 0) + (pile.resources.meat || 0) > 0) { ctx.fillStyle = '#d27c57'; ctx.fillRect(x + 7, y + 7, 4, 4); }
    if (pile.resources.stone > 0) { ctx.fillStyle = '#7c8982'; ctx.fillRect(x + 14, y + 3, 4, 4); }
  }

  function drawLooseTreeLog(item) {
    const x = item.x * TILE, y = item.y * TILE;
    if (!tinyWoodSprite.complete || !tinyWoodSprite.naturalWidth) return;
    const scale = spriteScale(TILE);
    ctx.drawImage(tinyWoodSprite, x + TILE / 2 - tinyWoodSprite.naturalWidth * scale / 2,
      y + TILE - 46 * scale, tinyWoodSprite.naturalWidth * scale, tinyWoodSprite.naturalHeight * scale);
  }

  function drawTreeItem(item) {
    drawTinySwordsTree(item.tile, item.type, item.mass, item.layout);
  }

  function drawCommunities() {
    for (const community of world.communities) {
      if (community.dissolved || !community.memberIds.length) continue;
      const count = community.memberIds.filter(id => getPerson(id)).length;
      if (!count) continue;
      const radius = (4 + Math.min(4, Math.sqrt(count))) * TILE;
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = rgba(community.color, .66);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(community.x * TILE + 8, community.y * TILE + 8, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBoundaries() {
    for (const s of world.structures) {
      if (s.type !== 'divisa') continue;
      const activeCommunity = getCommunity(s.communityId);
      const x = s.x * TILE, y = s.y * TILE;
      if (!activeCommunity && !s.complete) continue;
      const ratio = s.complete ? 1 : Math.max(.08, s.progress / s.required);
      const radius = (s.radius || 4) * TILE;
      ctx.save(); ctx.strokeStyle = activeCommunity ? activeCommunity.color : '#b58a55'; ctx.lineWidth = s.complete ? 2 : 1.5;
      ctx.setLineDash(s.complete ? [] : [3, 4]); ctx.beginPath(); ctx.arc(x + 8, y + 8, radius, -.5 * Math.PI, -.5 * Math.PI + Math.PI * 2 * ratio); ctx.stroke();
      const posts = Math.max(4, Math.ceil(12 * ratio)); ctx.fillStyle = activeCommunity ? activeCommunity.color : '#b58a55';
      for (let n = 0; n < posts; n++) {
        const angle = -.5 * Math.PI + Math.PI * 2 * ratio * n / Math.max(1, posts - 1);
        ctx.fillRect(x + 6 + Math.cos(angle) * radius, y + 6 + Math.sin(angle) * radius, 4, 4);
      }
      ctx.restore();
    }
  }

  function drawWorldHealthBar(x, y, width, height, value, colorOverride = null) {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    const color = colorOverride || (ratio < .3 ? 'red' : ratio < .6 ? 'yellow' : 'green');
    const track = healthBarSprites.track, fill = healthBarSprites.fills[color];
    const ready = [track.left, track.center, track.right, fill]
      .every(image => image.complete && image.naturalWidth > 0);
    if (!ready) {
      ctx.fillStyle = '#15251f'; ctx.fillRect(x, y, width, height);
      ctx.fillStyle = color === 'red' ? '#e76d59' : color === 'yellow' ? '#e7bd62' : '#86ce83';
      ctx.fillRect(x + 1, y + 1, Math.max(0, (width - 2) * ratio), Math.max(0, height - 2));
      return;
    }

    const scale = height / track.center.naturalHeight;
    const capWidth = track.left.naturalWidth * scale;
    const centerWidth = Math.max(0, width - capWidth * 2);
    const repeatX = (image, startX, startY, destWidth, destHeight) => {
      const sourceTileWidth = image.naturalWidth;
      const destTileWidth = sourceTileWidth * scale;
      for (let offset = 0; offset < destWidth; offset += destTileWidth) {
        const partWidth = Math.min(destTileWidth, destWidth - offset);
        const sourceWidth = partWidth / scale;
        ctx.drawImage(image, 0, 0, sourceWidth, image.naturalHeight,
          startX + offset, startY, partWidth, destHeight);
      }
    };

    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(track.left, x, y, capWidth, height);
    repeatX(track.center, x + capWidth, y, centerWidth, height);
    ctx.drawImage(track.right, x + width - capWidth, y, capWidth, height);
    const insetX = 8 * scale, fillY = y + 11 * scale, fillHeight = 24 * scale;
    repeatX(fill, x + insetX, fillY, Math.max(0, (width - insetX * 2) * ratio), fillHeight);
    ctx.restore();
  }

  function drawPersonStatusBar(x, y, width, height, value, color) {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    const track = personBarSprites.track, fill = personBarSprites.fills[color];
    const ready = [track.left, track.center, track.right, fill]
      .every(image => image.complete && image.naturalWidth > 0);
    if (!ready) {
      ctx.fillStyle = '#15251f';
      ctx.fillRect(x, y, width, height);
      ctx.fillStyle = color === 'red' ? '#e76d59' : color === 'yellow' ? '#e7bd62'
        : color === 'blue' ? '#6daef1' : '#86ce83';
      ctx.fillRect(x + 1, y + 1, Math.max(0, (width - 2) * ratio), Math.max(1, height - 2));
      return;
    }

    const scale = height / track.center.naturalHeight;
    const capWidth = track.left.naturalWidth * scale;
    const centerWidth = Math.max(0, width - capWidth * 2);
    const repeatX = (image, startX, startY, destWidth, destHeight) => {
      const destTileWidth = image.naturalWidth * scale;
      for (let offset = 0; offset < destWidth; offset += destTileWidth) {
        const partWidth = Math.min(destTileWidth, destWidth - offset);
        ctx.drawImage(image, 0, 0, partWidth / scale, image.naturalHeight,
          startX + offset, startY, partWidth, destHeight);
      }
    };

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(track.left, x, y, capWidth, height);
    repeatX(track.center, x + capWidth, y, centerWidth, height);
    ctx.drawImage(track.right, x + width - capWidth, y, capWidth, height);
    const insetX = 6 * scale, fillY = y + 8 * scale, fillHeight = 3 * scale;
    repeatX(fill, x + insetX, fillY, Math.max(0, (width - insetX * 2) * ratio), fillHeight);
    ctx.restore();
  }

  function drawLeaderBadge(person, x, y) {
    const kingdom = getKingdom(person.kingdomId);
    const rank = activeLeadershipRank(person, kingdom);
    if (rank === 'comandante') {
      if (commanderIcon.complete && commanderIcon.naturalWidth > 0) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(commanderIcon, x + 5.75, y - 11, 4.5, 4.5);
        ctx.restore();
      }
      return;
    }
    if (rank !== 'general') return;

    const color = kingdom?.palette === 'blue' ? 'cyan' : kingdom?.palette || 'black';
    const sword = generalSwordSprites[color] || generalSwordSprites.black;
    const { left, center, right } = sword;
    if (![left, center, right].every(image => image.complete && image.naturalWidth > 0)) return;

    const height = 7.5, scale = height / center.naturalHeight;
    const leftWidth = left.naturalWidth * scale, rightWidth = right.naturalWidth * scale;
    ctx.save();
    ctx.font = '6px MedievalSharp, Georgia, serif';
    const labelWidth = Math.min(100, ctx.measureText(person.name).width);
    const width = Math.max(25.5, leftWidth + labelWidth + rightWidth + 2);
    const startX = x + TILE / 2 - width / 2, startY = y - 13;
    const centerWidth = width - leftWidth - rightWidth;
    const repeatX = (image, fromX, destWidth) => {
      const tileWidth = image.naturalWidth * scale;
      for (let offset = 0; offset < destWidth; offset += tileWidth) {
        const partWidth = Math.min(tileWidth, destWidth - offset);
        ctx.drawImage(image, 0, 0, partWidth / scale, image.naturalHeight,
          fromX + offset, startY, partWidth, height);
      }
    };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(left, startX, startY, leftWidth, height);
    repeatX(center, startX + leftWidth, centerWidth);
    ctx.drawImage(right, startX + width - rightWidth, startY, rightWidth, height);
    ctx.font = '6px MedievalSharp, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#43372b';
    ctx.fillText(person.name, startX + leftWidth + centerWidth / 2, startY + height / 2 + .5, centerWidth);
    ctx.restore();
  }

  function drawStructureLife(s, x, y, constructionBarOffset = 0) {
    if (!structureDamageBars.visible(s.id, performance.now())) return;
    const life = towerVitality(s), ratio = life.health / life.maxHealth;
    const spriteKey = structureSpriteKey(s);
    const top = s.type === 'curral' ? y - corralFenceRadius(s) * TILE
      : y + TILE - (BUILDING_FEET[spriteKey] || 150) * spriteScale(TILE);
    const barWidth = 20, barHeight = 3.5, barX = x - 2;
    const barY = (s.complete ? top - barHeight - 2 : y - barHeight - 2) + constructionBarOffset;
    drawWorldHealthBar(barX, barY, barWidth, barHeight, ratio);
    if (world.day - (s.lastAttackedDay ?? -Infinity) <= 1) {
      ctx.save();
      ctx.strokeStyle = '#f6aa63'; ctx.lineWidth = .5;
      ctx.strokeRect(barX - .5, barY - .5, barWidth + 1, barHeight + 1);
      ctx.restore();
    }
  }

  function drawStructure(s) {
      const foundationSpec = constructionFoundationSpec(s);
      if (!s.complete && !(s.progress > 0) && !foundationSpec) return;
      if (s.type === 'curral' && s.complete && s.destroyedDay == null) { drawStructureLife(s, s.x * TILE, s.y * TILE); return; }
      const activeCommunity = getCommunity(s.communityId);
      const kingdom = getKingdom(s.kingdomId);
      if (!activeCommunity && !kingdom && !s.complete) return;
      const x = s.x * TILE, y = s.y * TILE;
      if (s.destroyedDay != null) {
        ctx.fillStyle = '#756f64'; ctx.fillRect(x - 5, y + 5, 23, 8);
        ctx.fillStyle = '#a0977f'; ctx.fillRect(x - 2, y + 2, 6, 5); ctx.fillRect(x + 9, y + 4, 5, 4);
        return;
      }
      let drawnBuilding = false;
      if (s.complete) {
        drawnBuilding = drawTinySwordsBuilding(s, activeCommunity, kingdom, x, y);
      }
      if (!s.complete && foundationSpec) drawConstructionFoundation(x, y, foundationSpec);
      if (!s.complete && s.progress > 0 && s.type !== 'curral') {
        const height = (BUILDING_FEET[foundationSpec?.sprite || structureSpriteKey(s)] || 180) * spriteScale(TILE);
        const reveal = height * (.15 + .85 * Math.min(1, s.progress / s.required));
        ctx.save(); ctx.beginPath(); ctx.rect(x - TILE * 4, y + TILE - reveal, TILE * 8, reveal); ctx.clip();
        drawTinySwordsBuilding(s, activeCommunity, kingdom, x, y); ctx.restore();
      }
      if (s.complete && s.type === 'centro_militar') {
        ctx.fillStyle = '#4d5f3c'; ctx.fillRect(x + TILE * .70, y + TILE * .10, 2, TILE * .48);
        ctx.fillStyle = '#d5b85c'; ctx.fillRect(x + TILE * .72, y + TILE * .10, TILE * .2, TILE * .12);
      }
      if (s.complete && !drawnBuilding) {
        ctx.fillStyle = '#303a2b'; ctx.fillRect(x + 3, y + 10, 11, 5);
        ctx.fillStyle = activeCommunity ? (s.type === 'abrigo' ? '#b58a55' : '#a87849') : kingdom ? kingdom.color : '#776e5c';
        ctx.fillRect(x + 5, y + 7, 8, 5); ctx.fillRect(x + 7, y + 5, 4, 3);
        ctx.fillStyle = '#66543b'; ctx.fillRect(x + 8, y + 11, 2, 4);
      } else if (!s.complete && !foundationSpec) {
        ctx.fillStyle = '#e2d4a5'; ctx.fillRect(x + 4, y + 11, 10, 2);
        ctx.fillStyle = '#b8844e'; ctx.fillRect(x + 7, y + 8, 2, 3); ctx.fillRect(x + 10, y + 7, 2, 4);
      }
      const damageVisible = structureDamageBars.visible(s.id, performance.now());
      if (!s.complete && foundationSpec && !damageVisible) drawConstructionProgressBar(s, x, y, foundationSpec);
      if (s.maxHealth) drawStructureLife(s, x, y, !s.complete && foundationSpec ? 9 : 0);
  }

  function drawTrainingDummy(dummy) {
    const image = trainingDummySprites[dummy.palette]?.[dummy.pose];
    if (!image?.complete || !image.naturalWidth) return false;
    const size = TILE * 3 * (dummy.sizeScale ?? 1);
    const centerX = (dummy.x + .5) * TILE, footY = (dummy.y + 1) * TILE;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (dummy.flipX) {
      ctx.translate(centerX, 0);
      ctx.scale(-1, 1);
      ctx.translate(-centerX, 0);
    }
    ctx.drawImage(image, centerX - size / 2, footY - size, size, size);
    ctx.restore();
    const healthRatio = dummy.health / dummy.maxHealth;
    const healthColor = healthRatio < .3 ? 'red' : healthRatio < .6 ? 'yellow' : 'green';
    drawPersonStatusBar(centerX - 5.5, footY - size - 3, 11, 2, healthRatio, healthColor);
    return true;
  }

  function drawAnimal(a, pose) {
      const p = Sim.animals.find(s => s.id === a.speciesId), x = pose.x * TILE, y = pose.y * TILE;
      if (!p) return;
      if (a.speciesId === 'sheep' && drawTinySwordsSheep(a, x, y, pose)) return;
      const sheepScale = a.speciesId === 'sheep'
        ? SHEEP_JUVENILE_MIN_SCALE + (1 - SHEEP_JUVENILE_MIN_SCALE)
          * Math.max(0, Math.min(1, (a.ageDays || 0) / SHEEP_ADULT_AGE_DAYS)) : 1;
      if (sheepScale < 1) {
        ctx.save(); ctx.translate(x + TILE / 2, y + TILE - 1); ctx.scale(sheepScale, sheepScale);
        ctx.translate(-x - TILE / 2, -y - TILE + 1);
      }
      if (p.aquatic) {
        ctx.fillStyle = p.color; ctx.fillRect(x + 5, y + 7, 7, 3); ctx.fillRect(x + 11, y + 6, 3, 5);
        ctx.fillStyle = '#f4e8b5'; ctx.fillRect(x + 7, y + 8, 1, 1);
      } else if (a.speciesId === 'bird') {
        ctx.fillStyle = p.color; ctx.fillRect(x + 5, y + 6, 7, 3); ctx.fillRect(x + 8, y + 4, 2, 3);
        ctx.fillStyle = '#dfc78b'; ctx.fillRect(x + 11, y + 5, 3, 1);
      } else {
        ctx.fillStyle = '#1f2d25aa'; ctx.fillRect(x + 4, y + 10, 9, 2);
        ctx.fillStyle = p.color; ctx.fillRect(x + 5, y + 6, 8, 4); ctx.fillRect(x + 11, y + 5, 3, 3);
        if (a.speciesId === 'hare') { ctx.fillRect(x + 12, y + 2, 1, 4); ctx.fillRect(x + 14, y + 3, 1, 3); }
        if (a.speciesId === 'fox') { ctx.fillRect(x + 2, y + 7, 4, 2); ctx.fillRect(x + 3, y + 6, 2, 2); }
        ctx.fillStyle = '#302a22'; ctx.fillRect(x + 12, y + 6, 1, 1);
      }
      if (sheepScale < 1) ctx.restore();
  }

  const npcDamageBars = createDamageBarTracker();
  const structureDamageBars = createDamageBarTracker();
  function drawHoverEnergyCircle(centerX, centerY) {
    magicVfx.drawIndicator(ctx, centerX, centerY, animationTime,
      { color: '#c7776c', radius: TILE * .55, rotationSpeed: .23 });
  }
  function drawPerson(p, pose) {
      const c = p.communityId ? getCommunity(p.communityId) : null;
      const militarySprite = MILITARY_SPRITES[p.militaryClass];
      const towerDrop = p.towerMounted
        ? ((militarySprite?.foot || 0) * .625 + (militarySprite?.size || 0) * .1)
          * spriteScale(TILE, CHARACTER_SPRITE_SCALE) : 0;
      const x = pose.x * TILE, y = pose.y * TILE + towerDrop, child = p.ageDays < 12 * 365;
      const scale = child ? .72 : 1, color = c ? c.color : ['#d9c28b', '#cfb585', '#e0c99b', '#c9b27f'][p.id % 4];
      if (hoveredPersonId === p.id) drawHoverEnergyCircle(x + TILE / 2, y + TILE - .5);
      if (p.conflictRisk > .5) { ctx.strokeStyle = 'rgba(196,109,72,.52)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + 8, y + 8, 7.5, 0, Math.PI * 2); ctx.stroke(); }
      if (!drawTinySwordsPerson(p, x, y, child, pose)) {
        ctx.save();
        ctx.translate(x + TILE / 2, y + TILE);
        ctx.scale(CHARACTER_SPRITE_SCALE, CHARACTER_SPRITE_SCALE);
        ctx.translate(-x - TILE / 2, -y - TILE);
        ctx.fillStyle = 'rgba(22,35,27,.38)'; ctx.beginPath(); ctx.ellipse(x + TILE / 2, y + TILE, TILE * .25, TILE * .1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.fillRect(x + 8 - scale * 3, y + 7, scale * 6, scale * 5);
        ctx.fillRect(x + 8 - scale * 2, y + 3, scale * 4, scale * 4);
        ctx.fillStyle = '#554731'; ctx.fillRect(x + 7, y + 4, 3, 1);
        if (!child) {
          ctx.fillStyle = '#4b4a3a';
          if (p.brain.lastAction === 'gather' || p.brain.lastAction === 'build') ctx.fillRect(x + 4, y + 8, 3, 1);
          else ctx.fillRect(x + 5, y + 8, 2, 1);
          ctx.fillStyle = '#67553c'; ctx.fillRect(x + 7, y + 11, 1, 3); ctx.fillRect(x + 10, y + 11, 1, 3);
        }
        ctx.restore();
      }
      drawCarriedMeat(p, x, y, pose);
      drawCarriedWood(p, x, y, pose);
      const now = performance.now();
      const isMonk = p.role === 'soldier' && p.militaryClass === 'monge';
      if (npcDamageBars.visible(p.id, now)) {
        const ratio = p.health < 30 ? 'red' : p.health < 60 ? 'yellow' : 'green';
        drawPersonStatusBar(x + 2.5, y - (isMonk ? 12 : 8), 11, 2, p.health / 100, ratio);
      }
      if (p.role === 'soldier' && (npcDamageBars.visible(p.id, now) || selection?.kind === 'person' && selection.id === p.id)) {
        drawPersonStatusBar(x + 2.5, y - (isMonk ? 10 : 6), 11, 2, (p.stamina ?? p.maxStamina ?? 200) / (p.maxStamina || 200), 'yellow');
        if (isMonk) {
          drawPersonStatusBar(x + 2.5, y - 8, 11, 2, (p.mana ?? p.maxMana ?? 200) / (p.maxMana || 200), 'blue');
        }
      }
      drawLeaderBadge(p, x, y);
      if (p.health < 22) { ctx.fillStyle = '#bc574d'; ctx.fillRect(x + 12, y + 2, 3, 2); }
  }

  function drawSelection() {
    if (!selection) return;
    if (selection.kind === 'person') {
      const person = getPerson(selection.id);
      if (person?.alive) {
        const pose = combatDisplayPose(person, visualPose('person', person));
        magicVfx.drawIndicator(ctx, (pose.x + .5) * TILE, (pose.y + 1) * TILE, animationTime);
        return;
      }
    }
    const bounds = selectionBounds(selection);
    if (bounds) drawSelectionFrame(bounds);
  }

  function animationSpriteBounds(animation, centerX, baseY, scale, rotation = 0) {
    const left = -(animation.anchor?.x ?? animation.frameWidth / 2);
    const top = -(animation.anchor?.y ?? animation.frameHeight);
    const right = left + animation.frameWidth, bottom = top + animation.frameHeight;
    const cos = Math.cos(rotation || 0), sin = Math.sin(rotation || 0);
    const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => ({
      x: centerX + (x * cos - y * sin) * scale,
      y: baseY + (x * sin + y * cos) * scale
    }));
    const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  }

  function selectionBounds(item) {
    if (item.kind === 'plant') {
      const tile = cell(item.x, item.y);
      if (!tile) return null;
      const broadleaf = tile.plants[plantIndex('broadleaf')], conifer = tile.plants[plantIndex('conifer')];
      return tinyTreeSpriteLayout(tile, broadleaf >= conifer ? 'broadleaf' : 'conifer', Math.max(broadleaf, conifer));
    }
    if (item.kind === 'training-dummy') {
      const dummy = trainingDummiesForWorld(world).find(entry => entry.id === item.id);
      if (!dummy) return null;
      const size = TILE * 3 * (dummy.sizeScale ?? 1);
      return { x: (dummy.x + .5) * TILE - size / 2, y: (dummy.y + 1) * TILE - size,
        width: size, height: size };
    }
    if (item.kind === 'person') {
      const person = getPerson(item.id);
      if (!person || person.restingStructureId != null) return null;
      const pose = combatDisplayPose(person, visualPose('person', person));
      const towerDrop = person.towerMounted
        ? ((MILITARY_SPRITES[person.militaryClass]?.foot || 0) * .625
          + (MILITARY_SPRITES[person.militaryClass]?.size || 0) * .1) * spriteScale(TILE, CHARACTER_SPRITE_SCALE) : 0;
      const x = pose.x * TILE, y = pose.y * TILE + towerDrop;
      const palette = getKingdom(person.kingdomId)?.palette || 'blue';
      const animation = person.role === 'soldier'
        ? militaryAnimationState(person, pose).animation
        : getUnitAnimation('pawn', residentSpritePose(person, pose, world.day).action, palette);
      const scale = spriteScale(TILE, CHARACTER_SPRITE_SCALE * (person.role === 'soldier' || person.ageDays >= 12 * 365 ? 1 : .78));
      return animationSpriteBounds(animation, x + TILE / 2, y + TILE, scale, pose.rotation);
    }
    if (item.kind === 'animal') {
      const animal = getAnimal(item.id);
      if (!animal) return null;
      const pose = visualPose('animal', animal), x = pose.x * TILE, y = pose.y * TILE;
      if (animal.speciesId === 'sheep') {
        const layout = tinySwordsSheepLayout(animal, x, y, pose);
        if (layout) return layout;
      }
      const profile = Sim.animals.find(species => species.id === animal.speciesId);
      let bounds = profile?.aquatic ? { x: x + 5, y: y + 6, width: 10, height: 7 }
        : animal.speciesId === 'bird' ? { x: x + 5, y: y + 4, width: 10, height: 6 }
          : animal.speciesId === 'fox' ? { x: x + 2, y: y + 5, width: 14, height: 7 }
            : animal.speciesId === 'hare' ? { x: x + 5, y: y + 2, width: 11, height: 11 }
              : { x: x + 4, y: y + 5, width: 11, height: 8 };
      if (animal.speciesId === 'sheep') {
        const growth = Math.max(0, Math.min(1, (animal.ageDays || 0) / SHEEP_ADULT_AGE_DAYS));
        const scale = SHEEP_JUVENILE_MIN_SCALE + (1 - SHEEP_JUVENILE_MIN_SCALE) * growth;
        const anchorX = x + TILE / 2, anchorY = y + TILE - 1;
        bounds = { x: anchorX + (bounds.x - anchorX) * scale, y: anchorY + (bounds.y - anchorY) * scale,
          width: bounds.width * scale, height: bounds.height * scale };
      }
      return bounds;
    }
    if (item.kind === 'kingdom') {
      const kingdom = getKingdom(item.id);
      if (!kingdom) return null;
      const castle = world.structures.find(structure => structure.type === 'castelo' && structure.kingdomId === kingdom.id);
      return castle ? structureSelectionBounds(castle) : { x: kingdom.x * TILE, y: kingdom.y * TILE, width: TILE, height: TILE };
    }
    if (item.kind === 'structure') {
      const structure = world.structures.find(entry => entry.id === item.id);
      return structure ? structureSelectionBounds(structure) : null;
    }
    if (item.kind === 'loot') {
      const pile = (world.loot || []).find(entry => entry.id === item.id && entry.available);
      if (!pile) return null;
      const x = pile.x * TILE, y = pile.y * TILE;
      const stoneOnly = (pile.resources.stone || 0) > 0
        && !['food', 'meat', 'wood', 'gold', 'feed'].some(resource => (pile.resources[resource] || 0) > 0);
      return stoneOnly ? { x: x + 1, y: y + 5, width: 14, height: 9 } : { x: x - 2, y: y + 1, width: 21, height: 14 };
    }
    if (item.kind === 'log') {
      const log = (world.logs || []).find(entry => entry.id === item.id && entry.available);
      if (!log) return null;
      const image = tinyWoodSprite, scale = spriteScale(TILE);
      const width = image.complete && image.naturalWidth ? image.naturalWidth * scale : TILE;
      const height = image.complete && image.naturalHeight ? image.naturalHeight * scale : TILE * .7;
      return { x: log.x * TILE + TILE / 2 - width / 2, y: log.y * TILE + TILE - 46 * scale, width, height };
    }
    if (item.kind === 'community') {
      const community = getCommunity(item.id);
      if (!community) return null;
      const radius = (4 + Math.min(4, Math.sqrt(community.memberIds.filter(id => getPerson(id)).length))) * TILE;
      return { x: community.x * TILE + 8 - radius, y: community.y * TILE + 8 - radius, width: radius * 2, height: radius * 2 };
    }
    return null;
  }

  function structureSelectionBounds(structure) {
    const x = structure.x * TILE, y = structure.y * TILE;
    if (structure.type === 'divisa') {
      const radius = (structure.radius || 4) * TILE + 3;
      return { x: x + 8 - radius, y: y + 8 - radius, width: radius * 2, height: radius * 2 };
    }
    if (structure.type === 'curral' && structure.complete && structure.destroyedDay == null) {
      const radius = corralFenceRadius(structure);
      return { x: (Math.round(structure.x) - radius) * TILE, y: (Math.round(structure.y) - radius) * TILE,
        width: (radius * 2 + 1) * TILE, height: (radius * 2 + 1) * TILE };
    }
    if (structure.destroyedDay != null) return { x: x - 5, y: y + 2, width: 23, height: 11 };
    const community = getCommunity(structure.communityId), kingdom = getKingdom(structure.kingdomId);
    if (structure.complete) {
      const layout = tinySwordsBuildingLayout(structure, community, kingdom);
      if (layout) return layout;
      return { x: x + 3, y: y + 5, width: 12, height: 11 };
    }
    const foundation = constructionFoundationSpec(structure);
    if (foundation) {
      const scale = spriteScale(TILE), width = foundation.width * scale, height = foundation.height * scale;
      const feet = BUILDING_FEET[foundation.sprite] || foundation.height;
      return { x: x + TILE / 2 - width / 2, y: y + TILE - feet * scale, width, height };
    }
    return structure.progress > 0 ? { x: x + 4, y: y + 7, width: 8, height: 6 } : null;
  }

  function drawSelectionFrame(bounds) {
    const padding = Math.min(4, Math.max(1, Math.min(bounds.width, bounds.height) * .08));
    const x = bounds.x - padding, y = bounds.y - padding;
    const width = bounds.width + padding * 2, height = bounds.height + padding * 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (selectionFrameSprite.complete && selectionFrameSprite.naturalWidth) {
      const sourceSize = selectionFrameSprite.naturalWidth / 4;
      const cornerSize = Math.min(20, width / 2, height / 2, Math.max(3, Math.min(width, height) * .36));
      ctx.drawImage(selectionFrameSprite, 0, 0, sourceSize, sourceSize, x, y, cornerSize, cornerSize);
      ctx.drawImage(selectionFrameSprite, selectionFrameSprite.naturalWidth - sourceSize, 0, sourceSize, sourceSize,
        x + width - cornerSize, y, cornerSize, cornerSize);
      ctx.drawImage(selectionFrameSprite, 0, selectionFrameSprite.naturalHeight - sourceSize, sourceSize, sourceSize,
        x, y + height - cornerSize, cornerSize, cornerSize);
      ctx.drawImage(selectionFrameSprite, selectionFrameSprite.naturalWidth - sourceSize,
        selectionFrameSprite.naturalHeight - sourceSize, sourceSize, sourceSize,
        x + width - cornerSize, y + height - cornerSize, cornerSize, cornerSize);
    } else {
      ctx.strokeStyle = '#fff0b4'; ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, width, height);
    }
    ctx.restore();
  }

  function drawHoveredStructureTerritory() {
    const structure = world.structures.find(item => item.id === hoveredTerritoryStructureId
      && ['castelo', 'torre'].includes(item.type) && item.complete && item.destroyedDay == null);
    if (!structure) return;
    const kingdom = getKingdom(structure.kingdomId);
    if (!kingdom) return;
    ctx.save();
    ctx.fillStyle = rgba(kingdom.color, .14);
    ctx.strokeStyle = rgba(kingdom.color, .92);
    ctx.lineWidth = 1.5;
    if (structure.type === 'castelo') {
      for (const tile of world.tiles) {
        if (tile.kingdomId === kingdom.id) ctx.fillRect(tile.x * TILE, tile.y * TILE, TILE, TILE);
      }
    } else {
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc((structure.x + .5) * TILE, (structure.y + .5) * TILE,
        (structure.territoryRadius || 13) * TILE, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  const oceanPatterns = new WeakMap();
  const oceanBackdropCache = document.createElement('canvas');
  const waterLayerCache = document.createElement('canvas');
  let oceanBackdropKey = '', waterLayerKey = '';
  function drawCachedWater(camera, view) {
    const oceanKey = [camera.width, camera.height, camera.transform[0],
      autoTileWaterBackground.naturalWidth, world.seed].join(':');
    const period = Math.max(1, camera.transform[0] * TILE);
    if (oceanBackdropKey !== oceanKey) {
      oceanBackdropCache.width = camera.width + Math.ceil(period * 2);
      oceanBackdropCache.height = camera.height + Math.ceil(period * 2);
      drawOceanBackdrop(oceanBackdropCache.getContext('2d'),
        { ...camera, transform: [camera.transform[0], 0, 0, camera.transform[3], 0, 0] });
      oceanBackdropKey = oceanKey;
    }
    const viewKey = [oceanKey, ...camera.transform].join(':');
    const key = [viewKey, Math.floor(animationTime / 110), world.day, assetRevision].join(':');
    if (waterLayerKey !== key) {
      if (waterLayerCache.width !== camera.width || waterLayerCache.height !== camera.height) {
        waterLayerCache.width = camera.width; waterLayerCache.height = camera.height;
      }
      const previousContext = ctx;
      try {
        ctx = waterLayerCache.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const offsetX = ((camera.transform[4] % period) + period) % period - period;
        const offsetY = ((camera.transform[5] % period) + period) % period - period;
        ctx.drawImage(oceanBackdropCache, offsetX, offsetY);
        ctx.setTransform(...camera.transform);
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        ctx.beginPath(); ctx.rect(view.x, view.y, view.width, view.height); ctx.clip();
        drawWaterRocks(view.bounds); drawTinyWaterFoam(view.bounds);
        ctx.restore();
      } finally { ctx = previousContext; }
      waterLayerKey = key;
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(waterLayerCache, 0, 0); ctx.restore();
  }

  function drawOceanBackdrop(context, camera) {
    context.fillStyle = '#16536e';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    if (!autoTileWaterBackground.complete || !autoTileWaterBackground.naturalWidth) return;
    let pattern = referenceRendering ? null : oceanPatterns.get(context);
    if (!pattern) {
      pattern = context.createPattern(autoTileWaterBackground, 'repeat');
      if (pattern && !referenceRendering) oceanPatterns.set(context, pattern);
    }
    if (!pattern) return;
    const patternScale = camera.transform[0] * TILE / autoTileWaterBackground.naturalWidth;
    if (pattern.setTransform && typeof DOMMatrix === 'function') {
      pattern.setTransform(new DOMMatrix([
        patternScale, 0, 0, patternScale, camera.transform[4], camera.transform[5]
      ]));
    }
    context.fillStyle = pattern;
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  }


  function drawCloudOverlay(camera, center) {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(1_000_000 / (width * height)));
    const backingWidth = Math.max(1, Math.floor(width * ratio));
    const backingHeight = Math.max(1, Math.floor(height * ratio));
    const key = [backingWidth, backingHeight, mapZoom, ...camera.transform].join(':');
    const now = performance.now();
    if (key === cloudLayerViewKey && (mapZoom >= 2 || now - lastCloudLayerDraw < 1000 / 30 - 1)) return;
    cloudLayerViewKey = key;
    lastCloudLayerDraw = now;
    if (cloudSpritesCanvas.width !== backingWidth || cloudSpritesCanvas.height !== backingHeight) {
      cloudSpritesCanvas.width = backingWidth;
      cloudSpritesCanvas.height = backingHeight;
    }
    cloudSpritesContext.setTransform(1, 0, 0, 1, 0, 0);
    cloudSpritesContext.clearRect(0, 0, backingWidth, backingHeight);
    if (mapZoom >= 2) return;
    const ratioX = backingWidth / width, ratioY = backingHeight / height;
    const cloudCamera = {
      ...camera, width: backingWidth, height: backingHeight,
      transform: [camera.scale * ratioX, 0, 0, camera.scale * ratioY,
        camera.offsetX * ratioX, camera.offsetY * ratioY],
    };
    cloudSystem.drawAtmosphere(cloudSpritesContext, cloudCamera, width, height, center, mapZoom);
  }

  function drawMap(source = 'event') {
    if (referenceRendering) paintMap(source);
    else pendingMapDraw = source;
  }

  function paintMap(source = 'event') {
    if (!world) return;
    const profile = renderDiagnostics.profiler.beginDraw(source);
    renderTimestamp = performance.now();
    updateFollowCamera(renderTimestamp);
    updateIndividualTrails(renderTimestamp);
    syncAtmosphereWithZoom();
    const displayContext = ctx;
    const camera = currentMapCamera();
    kingThoughts.update(world, camera, TILE, visualPose, selection);
    mapTransform = camera.transform;
    if (canvas.width !== camera.width || canvas.height !== camera.height) {
      canvas.width = camera.width; canvas.height = camera.height;
      groundCacheCanvas.width = camera.width; groundCacheCanvas.height = camera.height;
      groundCacheKey = '';
    }
    displayContext.setTransform(...camera.transform);
    const view = getMapViewport();
    const fallbackTerrain = !(tinyTerrainAtlases[0]?.complete && tinyTerrainAtlases[0]?.naturalWidth);
    if (!referenceRendering && (terrainSyncRevision !== session.revision || terrainSyncFallback !== fallbackTerrain)) {
      terrainChunks.sync(world, tile => [tile.terrain, tile.cropFieldId != null,
        tile.terrain === 'land' && tile.cropFieldId == null && isRoadTile(tile, true) ? tile.roadWear || 0 : 0,
        ...(fallbackTerrain ? [tile.soilType, tile.soilWaterMm, tile.soilCapacityMm] : [])].join(':'));
      terrainSyncRevision = session.revision; terrainSyncFallback = fallbackTerrain;
    }
    const transition = seasonalTerrainTransition(world.day);
    const terrainStyle = [world.seed, visualPack, transition.season, transition.nextSeason, transition.alpha, terrainAssetRevision, fallbackTerrain].join(':');
    const nextGroundKey = [referenceRendering ? world.day : terrainChunks.revision, terrainStyle,
      camera.width, camera.height, ...camera.transform].join(':');
    const cacheRebuilt = groundCacheKey !== nextGroundKey;
    profile?.mark('preparation');
    if (cacheRebuilt) {
      ctx = groundCacheContext;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, groundCacheCanvas.width, groundCacheCanvas.height);
      if (referenceRendering) {
        ctx.setTransform(...camera.transform);
        ctx.imageSmoothingEnabled = false;
        profile?.mark('preparation');
        drawGround(); drawTinyCliffFaces(); drawTinyElevationLayer(); drawTinyRamps(); profile?.mark('terrain');
        drawGroundPlants(); profile?.mark('plants');
        drawRoads(); profile?.mark('roads');
      } else {
        profile?.mark('preparation');
        terrainChunks.draw(ctx, camera, terrainStyle, (chunkContext, bounds, transform) => {
          const previousContext = ctx, previousTransform = mapTransform;
          try {
            ctx = chunkContext; mapTransform = transform;
            drawGround(bounds);
            drawTinyCliffFaces(bounds); drawTinyElevationLayer(bounds); drawTinyRamps(bounds);
            profile?.mark('terrain');
            drawGroundPlants(bounds); profile?.mark('plants');
            drawRoads(bounds); profile?.mark('roads');
          } finally { ctx = previousContext; mapTransform = previousTransform; }
        });
        profile?.mark('composition');
      }
      ctx = displayContext;
      groundCacheKey = nextGroundKey;
    }
    ctx = displayContext;
    ctx.imageSmoothingEnabled = false;
    profile?.mark('preparation');
    if (!referenceRendering) drawCachedWater(camera, view);
    else {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawOceanBackdrop(ctx, camera);
    ctx.restore();
    if (view.width > 0 && view.height > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(view.x, view.y, view.width, view.height); ctx.clip();
      drawWaterRocks(view.bounds);
      drawTinyWaterFoam(view.bounds);
      ctx.restore();
    }
    }
    profile?.mark('water');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(groundCacheCanvas, 0, 0);
    ctx.restore();
    profile?.mark('composition');
    if (view.width > 0 && view.height > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(view.x, view.y, view.width, view.height); ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = PATH_TRAIL_OPACITY;
      ctx.drawImage(trailCanvas, 0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
      ctx.restore();
    }
    profile?.mark('groundEffects');
    if (view.width > 0 && view.height > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(view.x, view.y, view.width, view.height); ctx.clip();
      drawRiceGrowthWindOverlay(view.bounds);
      profile?.mark('groundEffects');
      drawHoveredStructureTerritory();
      profile?.mark('selection');
      drawDepthSortedWorld(view.bounds, profile);
      ctx.restore();
      const cameraCenter = camera.toWorld(stage.clientWidth / 2, stage.clientHeight / 2);
      cloudSystem.drawShadows(ctx, camera, stage.clientWidth, stage.clientHeight, cameraCenter, mapZoom);
      profile?.mark('clouds');
      ctx.save();
      ctx.beginPath(); ctx.rect(view.x, view.y, view.width, view.height); ctx.clip();
      drawSelection();
      ctx.restore();
      profile?.mark('selection');
      drawCloudOverlay(camera, cameraCenter);
      profile?.mark('clouds');
    }
    profile?.end({ cacheRebuilt, day: world.day, zoom: mapZoom,
      context: { renderer: 'canvas2d', atmosphereRenderer: atmosphericLayer.rendererType,
        magic: magicVfx.stats(),
        referenceRendering, fixedEffects, terrainChunks: referenceRendering ? null : terrainChunks.stats(),
        pixelTiles: referenceRendering ? null : pixelTiles.stats(),
        seed: world.seed, day: world.day, season: world.stats.season, paused: session.paused, speed: session.speed,
        zoom: mapZoom, cameraTransform: camera.transform.slice(), viewport: { ...view.bounds },
        canvasWidth: canvas.width, canvasHeight: canvas.height, devicePixelRatio: window.devicePixelRatio || 1,
        viewportWidth: stage.clientWidth, viewportHeight: stage.clientHeight,
        visibilityState: document.visibilityState, pageHasFocus: document.hasFocus(),
        worldWidth: world.width, worldHeight: world.height, peopleTotal: world.people.length, animalsTotal: world.animals.length } });
    renderTimestamp = null;
  }

  function renderKingdomList() {
    $('kingdomList').innerHTML = world.kingdoms.map(kingdom => {
      const residents = kingdom.memberIds.map(id => getPerson(id)).filter(Boolean);
      const resources = resourceSummary(world, kingdom.id);
      const ruler = getPerson(kingdom.rulerId);
      const soldiers = residents.filter(person => person.role === 'soldier').length;
      const campaign = (world.campaigns || []).find(item => item.status !== 'complete'
        && (item.attackerId === kingdom.id || item.defenderId === kingdom.id));
      const campaignStatus = campaign ? ' · campanha ' + (campaign.status === 'engaged' ? 'em combate' : campaign.status === 'withdrawing' ? 'retirada' : 'em marcha') : '';
      const metrics = [
        ['food', 'Comida', fmt(resources.food), 'Comida disponível nas contas vinculadas ao reino, em dias alimentares equivalentes.'],
        ['wealth', 'Riqueza', fmt(resources.gold, 0), 'Ouro nas contas vinculadas ao reino e com moradores vivos.'],
        ['people', 'Pessoas', fmt(resources.people), 'Moradores vivos deste reino.'],
        ['births', 'Nascimentos', fmt(resources.births), 'Nascimentos registrados para este reino desde o início.'],
        ['deaths', 'Mortes', fmt(resources.deaths), 'Mortes registradas para este reino desde o início.']
      ].map(([key, label, value, title]) => '<span class="kingdom-card-stat" data-kingdom-stat="' + key + '" title="' + title + '"><small>' + label + '</small><b>' + value + '</b></span>').join('');
      return '<button class="community-card" data-kingdom="' + kingdom.id + '" title="Inspecionar reino, moradias, tesouro e mercado" style="--community:' + esc(kingdom.color) + '">' +
        '<i class="color-dot"></i><span class="kingdom-card-body"><strong>' + esc(kingdom.name) + '</strong><small>' + soldiers + ' soldados' + esc(campaignStatus) + ' · ' + (kingdom.homeIds || []).length + ' casas · ' + kingdom.towerIds.map(id => world.structures.find(structure => structure.id === id && structure.complete)).filter(Boolean).length + ' torres · rei ' + esc(ruler ? ruler.name : 'sem governante') + '</small><span class="kingdom-card-stats" aria-label="Indicadores de ' + esc(kingdom.name) + '">' + metrics + '</span></span><em>' + fmt(kingdom.territoryTileCount) + ' células</em></button>';
    }).join('');
    $('solitaryCount').textContent = world.kingdoms.length + ' domínios';
  }

  function renderLocalAiHistory() {
    const list = $('localAiHistoryList');
    if (!list || !world) return;
    const kingdomsById = new Map(world.kingdoms.map(kingdom => [kingdom.id, kingdom]));
    const choiceLabels = {
      trade_for_food: 'trocar excedentes por alimento',
      forage_for_food: 'buscar alimento para a reserva comum',
      repair_damaged_structures: 'reparar construções danificadas',
      secure_herd_feed: 'repor a ração do rebanho',
      build_project: 'avançar a construção comunitária',
      gather_materials: 'reunir materiais de construção',
      recruit_soldier: 'recrutar um soldado',
      patrol_borders: 'patrulhar as fronteiras',
      reserve_garrison: 'manter a guarnição em reserva',
      maintain_autonomy: 'manter a iniciativa local'
    };
    const decisions = [];
    for (const kingdom of world.kingdoms) {
      for (const decision of kingdom.strategy?.aiHistory || []) {
        decisions.push({
          day: decision.day,
          role: 'Rei',
          kingdomName: kingdom.name,
          action: choiceLabels[decision.choice] || String(decision.choice || decision.action || 'ordem estratégica').replaceAll('_', ' ')
        });
      }
    }
    for (const decision of world.campaignGeneralAi?.events || []) {
      if (decision.type !== 'applied' || decision.role !== 'general' || !decision.decision?.action) continue;
      const kingdom = kingdomsById.get(decision.kingdomId);
      if (!kingdom) continue;
      const actionLabels = { advance: 'avançar ao objetivo', hold_position: 'manter posição', withdraw: 'retirada ordenada' };
      decisions.push({
        day: decision.day,
        role: 'General',
        kingdomName: kingdom.name,
        action: actionLabels[decision.decision.action] || String(decision.decision.action).replaceAll('_', ' ')
      });
    }
    decisions.sort((a, b) => b.day - a.day);
    list.innerHTML = decisions.slice(0, 4).map(decision =>
      '<li><span>Dia ' + fmt(decision.day) + ' · ' + decision.role + ' de ' + esc(decision.kingdomName) + '</span><b>'
      + esc(decision.action) + '</b></li>'
    ).join('') || '<li class="quiet">Nenhuma decisão registrada nesta partida.</li>';
  }

  function renderSpecies(stats) {
    $('faunaList').innerHTML = Sim.animals.map(p => {
      const count = stats.animalCounts[p.id] || 0;
      return '<div class="species-row" title="' + esc(p.role) + '"><i class="species-dot" style="--species:' + p.color + '"></i><span>' + esc(p.name) + '</span><b>' + count + '</b></div>';
    }).join('');
    $('floraList').innerHTML = Sim.plants.map((p, i) => {
      const count = stats.plantCounts[p.id] || 0;
      return '<div class="species-row" title="' + esc(p.guild) + '"><i class="species-dot" style="--species:' + p.color + '"></i><span>' + esc(p.name) + '</span><b>' + fmt(count) + '</b></div>';
    }).join('');
  }

  function renderEvents() {
    $('events').innerHTML = (world.chronicle || []).slice(0, 40).map(e => {
      const date = Sim.modules.Cosmos.calendarDate(e.day);
      return '<div class="event"><strong>' + esc(e.category) + '</strong><p>' + esc(e.text) + '</p><small>Dia ' + date.dayOfYear + ' · Ano ' + date.year + '</small></div>';
    }).join('') || '<div class="empty-state">A história começa aqui. Nascimentos, perdas, obras e conflitos aparecerão neste diário.</div>';
  }

  function updateWorldLine(stats) {
    if (stats.dryRegions >= 5) $('worldLine').textContent = 'Seca em ' + stats.dryRegions + ' regiões altera água e alimento';
    else if (stats.activeWars) $('worldLine').textContent = stats.activeWars + ' guerra(s) · ' + (stats.activeCampaigns || 0) + ' campanha(s) · ' + stats.borderIncidents + ' incursões descobertas';
    else $('worldLine').textContent = world.kingdoms.length + ' reinos · ' + stats.peopleCount + ' moradores · ' + stats.borderIncidents + ' incursões descobertas';
  }

  function updateHeader(stats) {
    const calendar = Sim.modules.Cosmos.calendarDate(world.day);
    $('day').textContent = fmt(calendar.dayOfYear);
    $('day').parentElement.title = 'Dia ' + world.day + ' desde a criação · 365 dias por ano';
    $('year').textContent = fmt(stats.year);
    $('animalCount').textContent = fmt(stats.animalCount);
    $('kingdomCount').textContent = fmt(stats.kingdomCount);
    $('conflictCount').textContent = fmt(stats.borderIncidents);
    $('harvestCount').textContent = fmt(stats.harvests.hunting);
    $('meatCount').textContent = fmt(stats.meatCarried) + '/' + fmt(stats.meatStored);
    $('season').textContent = seasonNames[stats.season].toUpperCase();
    $('runState').textContent = session.paused ? 'PAUSADA' : 'ATIVA';
    $('toggle').innerHTML = session.paused ? '▶' : 'Ⅱ';
    $('toggle').title = session.paused ? 'Retomar' : 'Pausar';
    $('toggle').setAttribute('aria-label', session.paused ? 'Retomar simulação' : 'Pausar simulação');
    $('seedLabel').textContent = world.seed;
    $('mapDimensions').textContent = world.width + ' × ' + world.height + ' CÉLULAS · 10 m POR LADO';
    $('faunaSpecies').textContent = stats.speciesAnimals + ' presentes';
    $('floraSpecies').textContent = stats.speciesPlants + ' presentes';
    updateWorldLine(stats);
  }

  function openSelection(item) {
    if (item) {
      $('journal').hidden = true; $('journalToggle').setAttribute('aria-expanded', 'false');
      $('settingsTray').hidden = true; $('settingsToggle').setAttribute('aria-expanded', 'false');
    }
    if (item && showLeft) {
      showLeft = false;
      $('leftPanel').classList.remove('is-open');
      $('kingdomsToggle').setAttribute('aria-expanded', 'false');
    }
    selection = item;
    showRight = !!item;
    $('rightPanel').classList.toggle('is-open', showRight);
    syncPanelAccess();
    renderInspector();
    drawMap();
  }

  function updateLocalAIStatus(status) {
    if (!$('localAiState')) return;
    const labels = { idle: 'desligada', loading: 'carregando', ready: 'ativa', working: 'pensando', error: 'indisponível' };
    $('localAiState').textContent = labels[status.phase] || status.phase;
    $('localAiStatus').textContent = status.text || '';
    $('localAiToggle').textContent = status.phase === 'loading' ? 'Carregando modelo…' : status.phase === 'ready' || status.phase === 'working' ? 'Desativar IA local' : 'Ativar IA local';
    $('localAiToggle').disabled = status.phase === 'loading';
    $('localAiProgress').hidden = status.phase !== 'loading';
    $('localAiProgress').value = status.progress || 0;
  }

  function persistLocalAIPreference(enabled) {
    try {
      writeLocalAiPreference(window.localStorage, enabled);
      return true;
    } catch (error) {
      console.error('[Kingdom IA local] não foi possível salvar a preferência:', error);
      $('localAiStatus').textContent = 'Não foi possível salvar a preferência de IA neste navegador.';
      return false;
    }
  }

  let lastInspectorSelection = '';
  function renderInspector() {
    const selectionKey = selection ? selection.kind + ':' + (selection.id ?? (selection.x + ':' + selection.y)) : '';
    const sameSelection = selectionKey === lastInspectorSelection;
    lastInspectorSelection = selectionKey;
    const root = $('inspector');
    const opened = new Set((sameSelection ? [...root.querySelectorAll('details[open]')] : []).map(d => d.querySelector('summary')?.textContent));
    const scroll = sameSelection ? root.scrollTop : 0;
    renderInspectorContent();
    const ribbonPalette = (() => {
      if (!selection) return 'black';
      if (selection.kind === 'kingdom') return getKingdom(selection.id)?.palette || 'black';
      if (selection.kind === 'structure') {
        const structure = world.structures.find(item => item.id === selection.id);
        return getKingdom(structure?.kingdomId)?.palette
          || (structure?.communityId != null ? communityPalette(structure.communityId) : 'black');
      }
      if (selection.kind === 'training-dummy')
        return trainingDummiesForWorld(world).find(item => item.id === selection.id)?.palette || 'black';
      if (selection.kind === 'person') return getKingdom(getPerson(selection.id)?.kingdomId)?.palette || 'black';
      if (selection.kind === 'community') return communityPalette(selection.id);
      if (selection.kind === 'animal') {
        const animal = world.animals.find(item => item.id === selection.id);
        return animal?.herdCommunityId != null ? communityPalette(animal.herdCommunityId) : 'cyan';
      }
      if (selection.kind === 'loot') {
        const pile = (world.loot || []).find(item => item.id === selection.id);
        if (pile?.mineralKind || pile?.resources?.stone > 0 || pile?.resources?.iron > 0) return 'black';
        if (pile?.resources?.gold > 0 || pile?.resources?.silver > 0 || pile?.resources?.copper > 0) return 'yellow';
        if (pile?.resources?.wood > 0) return 'purple';
      }
      if (selection.kind === 'log') return 'purple';
      if (selection.kind === 'plant') return 'yellow';
      return 'cyan';
    })();
    setModalRibbon($('rightPanel'), forjaUI, ribbonPalette);
    for (const detail of root.querySelectorAll('details')) detail.open = opened.has(detail.querySelector('summary')?.textContent);
    root.scrollTop = scroll;
  }

  function renderInspectorContent() {
    if (!world) return;
    const root = $('inspector');
    if (!selection) {
      $('rightPanel').classList.remove('is-open');
      $('inspectEyebrow').textContent = 'CAMPO DE OBSERVAÇÃO';
      $('inspectTitle').textContent = 'Um ecossistema em formação';
      root.innerHTML = '<p class="intro">Selecione um organismo, construção ou reino para acompanhar suas condições.</p>';
      return;
    }
    if (selection.kind === 'training-dummy') {
      const dummy = trainingDummiesForWorld(world).find(item => item.id === selection.id);
      if (!dummy) { selection = null; renderInspector(); return; }
      const kingdom = getKingdom(dummy.kingdomId);
      $('inspectEyebrow').textContent = 'TREINO MILITAR · ' + (kingdom?.name || 'REINO');
      $('inspectTitle').textContent = 'Boneco de treino';
      root.innerHTML = '<div class="data-row"><span>Função</span><b>alvo de prática</b></div>'
        + '<div class="data-row"><span>Vida</span><b>' + fmt(dummy.health) + ' / ' + fmt(dummy.maxHealth) + '</b></div>'
        + '<div class="data-row"><span>Resistência</span><b>permanece no lugar</b></div>'
        + '<p class="quiet">Os ataques mostram o dano causado. O boneco bloqueia a passagem como um personagem.</p>';
      return;
    }
    if (selection.kind === 'kingdom') {
      const kingdom = getKingdom(selection.id);
      if (!kingdom) { selection = null; renderInspector(); return; }
      $('inspectEyebrow').textContent = 'REINO · ASSENTAMENTO INICIAL';
      $('inspectTitle').textContent = kingdom.name;
      root.innerHTML = kingdomOverview(world, kingdom);
      return;
    }
    if (selection.kind === 'person') {
      const p = getPerson(selection.id);
      if (!p) { selection = null; renderInspector(); return; }
      const kingdom = p.kingdomId ? getKingdom(p.kingdomId) : null;
      const links = Object.values(world.socialLinks).filter(l => l.a === p.id || l.b === p.id).length;
      const skillLabels = { forage: 'coletor de alimento', hunt: 'caçador', gather: 'coletor de recursos', build: 'construtor', care: 'cuidador', diplomacy: 'mediador' };
      const leadingSkill = Object.entries(p.skills).sort((a, b) => b[1] - a[1])[0];
      const role = skillLabels[leadingSkill[0]] || 'generalista';
      const assignmentPhaseLabels = {
        'personal-recovery': 'recompondo reserva pessoal',
        'communal-collection': 'coleta destinada ao estoque comum',
        'communal-delivery': 'transportando carga ao estoque comum'
      };
      const assignmentPhase = p.assignment && p.assignment.supplyPhase
        ? ' · ' + (assignmentPhaseLabels[p.assignment.supplyPhase] || p.assignment.supplyPhase) : '';
      const actionLabels = { forage: 'buscar frutos', hunt: 'caçar', deliver: 'levar recursos ao abrigo', drink: 'buscar água conhecida', socialize: 'procurar companhia visível', rest: 'descansar', explore: 'explorar', build: 'construir', gather: 'cortar árvore ou extrair minério', collect_log: 'recolher tronco', collect_feed: 'guardar brotos para o rebanho', share: 'partilhar', trade: 'negociar no posto ou com outro reino', migrate: 'migrar', capture_sheep: 'capturar ovelha próxima', lead_sheep: 'conduzir ovelha ao curral', raid: 'assaltar armazém conhecido', patrol: 'patrulhar o reino', campaign: 'marchar ou defender posição' };
      Object.assign(actionLabels, { train: 'treinar combate simulado', guard: 'guardar o posto', return_garrison: 'reabastecer na guarnição' });
      const choices = p.lastDecision && Array.isArray(p.lastDecision.scores) ? p.lastDecision.scores.map((score, i) => ({ action: (p.lastDecision.actions || Sim.actions)[i], score }))
        .filter(choice => choice.score > -1e8).sort((a, b) => b.score - a.score).slice(0, 3) : [];
      const personalMemories = (p.personalMemory || []).slice(-3).reverse();
      const socialInspector = renderSocialInspectorSections(p, world);
      const decisionBrain = p.role === 'soldier' && p.militaryBrain ? p.militaryBrain : p.brain;
      const progressionAudit = p.militaryProgressionStatus;
      const progressionAuditText = progressionAudit?.state === 'paused'
        ? 'Pausada desde o dia ' + progressionAudit.sinceDay + ': falta ' + (MILITARY_SOURCE_LABELS[progressionAudit.sourceType] || 'fonte operacional') + '. Mérito preservado.'
        : progressionAudit?.state === 'resumed'
          ? 'Retomada no dia ' + progressionAudit.resumedDay + ' após reconstrução de ' + (MILITARY_SOURCE_LABELS[progressionAudit.sourceType] || 'fonte operacional') + '.' : '';
      const recoveryNeeds = [];
      if (p.energy < GARRISON_RECOVERY.restEnergy) recoveryNeeds.push('energia até ' + GARRISON_RECOVERY.restEnergy + '%');
      if (p.health < GARRISON_RECOVERY.restHealth) recoveryNeeds.push('saúde até ' + GARRISON_RECOVERY.restHealth + '%');
      if (p.injury >= GARRISON_RECOVERY.restInjury) recoveryNeeds.push('tratar ferimentos');
      const manualAttackHint = p.militaryClass === 'guerreiro'
        ? 'Combo: 1 → 2 → 1 → 2 · 3 investida com escudo'
        : p.militaryClass === 'lanceiro'
          ? '1 estocada · 2 rajada de lanças · 3 investida de lança'
          : p.militaryClass === 'arqueiro'
            ? '1 tiro padrão · 2 chuva de flechas · 3 tiro em cunha · 4 tiro concentrado'
            : p.militaryClass === 'monge' ? '1–5 usam as magias equipadas; segure E/1 quando a primeira for cura.'
            : p.role === 'soldier' ? 'Esta classe não possui ataques manuais mapeados.' : 'Sem ataques para esta unidade.';
      const isManualPerson = manualControlId === p.id || p.playerControlled;
      const manualControlHint = p.role === 'soldier'
        ? (isManualPerson ? 'WASD move · mouse mira · ' + (p.militaryClass === 'monge' ? 'segure E ou 1 para curar' : 'E: ataque básico · teclas numéricas: habilidades') + ' · segure F para defender · Espaço devolve a autonomia. ' + manualAttackHint
          : 'Clique no personagem e pressione Espaço para controlar. Depois, WASD move · mouse mira · ' + (p.militaryClass === 'monge' ? 'segure E ou 1 para curar' : 'E ataca · teclas numéricas acionam habilidades') + ' · segure F para defender. ' + manualAttackHint)
        : (isManualPerson ? 'WASD move · Espaço devolve a autonomia. Ataques e defesa manuais estão disponíveis para soldados.'
          : 'Clique no personagem e pressione Espaço para controlar com WASD. Ataques e defesa manuais estão disponíveis para soldados.');
      $('inspectEyebrow').textContent = p.role === 'soldier' ? (p.militaryRank || p.militaryGrade || 'soldado').toUpperCase() + ' · ' + (kingdom ? kingdom.name.toUpperCase() : 'SEM REINO') : kingdom ? 'MORADOR · ' + kingdom.name.toUpperCase() : 'INDIVÍDUO · SEM REINO';
      $('inspectTitle').textContent = p.name;
      root.innerHTML = '<div class="data-row"><span>Estado atual</span><b>' + esc(p.state) + '</b></div>' +
        '<div class="note-card"><b>' + (isManualPerson ? 'Controle manual ativo' : 'Controle do personagem') + '</b><span>'
          + manualControlHint
          + '</span></div>' +
        (p.recruitmentOrder ? '<div class="note-card"><b>Treinamento militar</b><span>' + (p.recruitmentOrder.progressionStatus === 'paused'
          ? 'Pausado: ' + esc(p.recruitmentOrder.pauseReason) + '. Custo e progresso preservados.'
          : 'Classe ' + esc(p.recruitmentOrder.militaryClass) + ' · conclusão prevista no dia ' + p.recruitmentOrder.readyDay + '.') + '</span></div>' : '') +
        (p.role === 'ruler' && kingdom?.lastSitingDecision ? '<div class="note-card"><b>Última escolha de local para obra</b><span>' + esc(kingdom.lastSitingDecision.label) + ' em ' + kingdom.lastSitingDecision.x + ',' + kingdom.lastSitingDecision.y + '. ' + esc(kingdom.lastSitingDecision.reason) + '</span></div>' : '') +
        (p.restingStructureId != null || p.homeRestTargetId != null || p.militaryRestTargetId != null
          ? '<div class="data-row"><span>Recuperação em casa</span><b>'
            + esc(recoveryNeeds.length ? 'Falta recuperar: ' + recoveryNeeds.join(' · ') : 'Recuperado · sai no próximo dia') + '</b></div>' : '') +
        '<div class="data-row"><span>Idade aproximada</span><b>' + fmt(p.ageDays / 365, 1) + ' anos</b></div>' +
        '<div class="data-row"><span>Reserva alimentar (dias) / água</span><b>' + Math.round(p.foodReserve) + ' / ' + Math.round(p.hydration) + '%</b></div>' +
        (p.role === 'soldier' ? '<div class="data-row"><span>Vitalidade de combate</span><b>' + Math.round(p.health / 100 * (p.maxCombatHealth || 100)) + ' / ' + (p.maxCombatHealth || 100) + '</b></div>' : '') +
        (p.role === 'soldier' ? '<div class="data-row"><span>Estamina</span><b>' + Math.round(p.stamina ?? p.maxStamina ?? 200) + ' / ' + (p.maxStamina || 200) + '</b></div>' : '') +
        (p.role === 'soldier' && p.combatDisarmedUntilDay > world.day
          ? '<div class="data-row"><span>Estado de combate</span><b>Desarmado · volta a lutar no dia ' + p.combatDisarmedUntilDay + '</b></div>' : '') +
        (p.role === 'soldier' && p.combatOpening?.expiresDay > world.day
          ? '<div class="data-row"><span>Abertura de parry</span><b>Contra ' + esc(getPerson(p.combatOpening.targetId)?.name || 'oponente') + '</b></div>' : '') +
        (p.role === 'soldier' && p.combatCombo?.lastDay === world.day
          ? '<div class="data-row"><span>Combo</span><b>' + p.combatCombo.count + ' / '
            + (p.militaryClass === 'guerreiro' ? 4 : 3) + ' golpes contra '
            + esc(getPerson(p.combatCombo.targetId)?.name || 'oponente') + '</b></div>' : '') +
        (p.militaryClass === 'monge' ? '<div class="data-row"><span>Mana</span><b>' + Math.round(p.mana ?? p.maxMana ?? 200) + ' / ' + (p.maxMana || 200) + '</b></div>' : '') +
        renderMagicInspector(p, world.magicTimeMs || 0) +
        (p.towerMounted ? '<div class="data-row"><span>Posto na torre</span><b>Alcance: 14 células</b></div>' : '') +
        '<div class="data-row"><span>Energia / saúde</span><b>' + Math.round(p.energy) + ' / ' + Math.round(p.health) + '%</b></div>' +
        '<div class="data-row"><span>Reino / moradia</span><b>' + esc(kingdom ? kingdom.name : 'sem reino') + ' · ' + esc(p.homeId ? 'moradia ' + p.homeId : 'sem moradia registrada') + '</b></div>' +
        '<div class="data-row"><span>Ferimentos / carga</span><b>' + Math.round(p.injury) + ' · carne ' + fmt(p.carriedMeat) + ' · madeira ' + fmt(p.carriedWood) + ' · pedra ' + fmt(p.carriedStone) + ' · ração ' + fmtRationPortions(p.carriedFeed) + ' porções</b></div>' +
        ((p.carriedFood > .01 || p.carriedFruit > .01) ? '<div class="data-row"><span>Alimento na carga</span><b>' + fmt(p.carriedFood, 1) + ' para o estoque · ' + fmt(p.carriedFruit, 1) + ' frutos</b></div>' : '') +
        '<div class="data-row"><span>Necessidade social</span><b>' + Math.round(p.socialNeed) + '%</b></div>' +
        '<div class="data-row"><span>Caminhos aprendidos</span><b>' + (p.knownRoutes?.length || 0) + ' · reutilizações: ' + (p.navigationCacheHits || 0) + '</b></div>' +
        '<div class="data-row"><span>Especialização emergente</span><b>' + esc(p.role === 'soldier' ? 'soldado ' + (p.militaryClass || '') : role) + ' · ' + Math.round(leadingSkill[1] * 100) + '%</b></div>' +
        '<div class="data-row"><span>Prestígio / tarefa</span><b>' + fmt(p.prestige || 0, 1) + (p.assignment ? ' · ' + esc(p.assignment.title) + esc(assignmentPhase) + (p.assignment.pauseReason ? ' · suspensa por ' + esc(p.assignment.pauseReason) : ' · até dia ' + p.assignment.expiresDay) : ' · sem delegação ativa') + '</b></div>' +
        '<div class="data-row"><span>Vínculos observados</span><b>' + links + '</b></div>' +
        (p.role === 'soldier' ? '<div class="data-row"><span>Patente / nível</span><b>' + esc(p.militaryRank || p.militaryGrade || 'soldado') + (p.militaryGrade && p.militaryRank !== p.militaryGrade ? ' · carreira: ' + esc(p.militaryGrade) : '') + ' · nível ' + (p.militaryLevel || 1) + ' · mérito ' + fmt(p.militaryMerit || 0, 1) + '</b></div><div class="data-row"><span>Função militar</span><b>' + esc((p.militaryRank || 'soldado') + ' · ' + (p.militaryClass || 'soldado')) + ' · guarnição do centro ' + (p.militaryCenterId || '—') + '</b></div>'
          + (progressionAuditText ? '<div class="data-row"><span>Progressão de classe</span><b>' + esc(progressionAuditText) + '</b></div>' : '')
          + (p.campaignId != null && p.fieldCommand ? '<div class="note-card"><b>' + (p.fieldCommand.issuerId === p.id ? 'Ordem emitida' : 'Ordem recebida de ' + esc(getPerson(p.fieldCommand.issuerId)?.name || 'general')) + '</b><span>' + esc(p.fieldCommand.reason) + ' Formação: ' + (p.fieldCommand.formationType === 'line' ? 'linha' : 'coluna') + '. Alvo: ' + p.fieldCommand.target.x + ',' + p.fieldCommand.target.y + '.</span></div>' : '')
          + '<div class="data-row"><span>Soldo do rei</span><b>' + MILITARY_PAY.copper + ' cobres / ' + MILITARY_PAY.days + ' dias</b></div>'
          + '<div class="data-row"><span>Carteira / pendências</span><b>' + fmt(p.militaryWallet?.stock?.gold || 0) + ' ouro · ' + fmt(p.militaryWallet?.stock?.silver || 0) + ' prata · ' + fmt(p.militaryWallet?.stock?.copper || 0) + ' cobre; legado: ' + fmt(p.militaryPayArrears || 0, 3) + ' ouro; novo: ' + fmt(p.militaryPayArrearsCopper || 0) + ' cobres</b></div>'

          + '<div class="data-row"><span>Próximo soldo</span><b>Dia ' + (p.nextMilitaryPayDay ?? '—') + '</b></div>' : '') +
        '<h3>Reino e fronteiras</h3><div class="note-card"><b>' + esc(kingdom ? kingdom.name : 'Terra comum') + '</b><span>' + esc(p.perception && p.perception.territorialAwareness && p.perception.territorialAwareness.warningText || (kingdom ? 'Você reconhece este domínio e os riscos de atravessar fronteiras estrangeiras.' : 'Você vive em terra comum, sem a proteção territorial de um reino.')) + '</span></div>' +
        '<h3>Decisão e aprendizado</h3><div class="brain-box"><strong>' + (p.militaryBrain && p.role === 'soldier' ? 'Rede militar' : 'Rede individual') + ' · ' + decisionBrain.inputSize + ' → ' + decisionBrain.hiddenSize + ' → ' + decisionBrain.actionCount + '</strong><small>' + (p.role === 'soldier' ? 'Compara guarda, patrulha e treino. Campanhas e necessidades urgentes limitam as opções disponíveis; os resultados ajustam seus pesos militares.' : p.role === 'ruler' ? 'O rei usa uma rede maior para comparar necessidades, recursos e riscos do reino; seus pesos também aprendem com os resultados.' : 'Avalia necessidades, alimento, água, risco de fronteira e áreas próximas; resultados positivos e negativos ajustam decisões futuras.') + '</small><div class="brain-metrics"><span>Intenção<b>' + esc(actionLabels[p.brain.lastAction] || p.brain.lastAction) + '</b></span><span>Atualizações<b>' + fmt(decisionBrain.updates) + '</b></span><span>Recompensa média<b>' + decisionBrain.rewardMean.toFixed(2) + '</b></span><span>Memória por ação<b>individual</b></span></div></div>' +
        (personalMemories.length ? '<h3>Memória pessoal recente</h3>' + personalMemories.map(memory => '<div class="event">Dia ' + memory.day + ': ' + esc(memory.state) + ' — ' + esc(memory.lesson) + '</div>').join('') : '') +
        socialInspector.planSection + socialInspector.commitmentSection
        + socialInspector.memorySection + socialInspector.beliefSection +
        '<div class="note-card"><b>O que aprendeu</b><span>' + esc(p.lastLesson || 'Ainda está aprendendo com o ambiente.') + '</span></div>' +
        (choices.length ? '<h3>Alternativas avaliadas</h3>' + choices.map(item => '<div class="data-row"><span>' + esc(actionLabels[item.action] || item.action) + '</span><b>' + item.score.toFixed(2) + '</b></div>').join('') : '') +
        (p.parents ? '<div class="note-card"><b>Dependência familiar</b><span>Esta pessoa nasceu durante a simulação e ainda recebe cuidado de seus responsáveis.</span></div>' : '');
      if (window.ForjaHUD) {
        const meters = document.createElement('div');
        meters.className = 'vital-meters';
        for (const [label, value, color] of [['Vida', p.health, p.health < 30 ? 'red' : 'green'], ['Energia', p.energy, 'yellow'], ['Água', p.hydration, 'blue']]) {
          const meter = document.createElement('div');
          meter.className = 'vital-meter';
          const heading = document.createElement('div');
          heading.className = 'vital-meter-label';
          const name = document.createElement('span'); name.textContent = label;
          const amount = document.createElement('b'); amount.textContent = Math.round(value) + '%';
          heading.append(name, amount);
          meter.append(heading, window.ForjaHUD.create({ size: 'small', color, value, label, width: 220 }));
          meters.append(meter);
        }
        root.prepend(meters);
      }
      return;
    }
    if (selection.kind === 'animal') {
      const a = getAnimal(selection.id);
      if (!a) { selection = null; renderInspector(); return; }
      const profile = Sim.animals.find(p => p.id === a.speciesId);
      $('inspectEyebrow').textContent = 'BIOSFERA · FAUNA';
      $('inspectTitle').textContent = profile.name;
      root.innerHTML = '<div class="data-row"><span>Perfil funcional</span><b>' + esc(profile.role) + '</b></div>' +
        '<div class="data-row"><span>Comportamento</span><b>' + esc(a.state) + '</b></div>' +
        (a.beingLedBy ? '<div class="data-row"><span>Conduzida por</span><b>' + esc((getPerson(a.beingLedBy) || {}).name || 'morador') + ' · a caminho do curral</b></div>' : a.herdCommunityId ? '<div class="data-row"><span>Rebanho</span><b>ovelha habituada · ' + (a.herdPenId != null ? 'em curral · ' : 'fora dos currais · aguardando vaga · ') + Math.round((a.habituation || 0) * 100) + '%</b></div>' : '<div class="data-row"><span>Condição</span><b>ovelha selvagem</b></div>') +
        '<div class="data-row"><span>Idade / longevidade</span><b>' + fmt(a.ageDays / 365, 1) + ' / ' + fmt(profile.life / 365) + ' anos</b></div>' +
        '<div class="data-row"><span>Energia / hidratação</span><b>' + Math.round(a.energy) + ' / ' + Math.round(a.hydration) + '%</b></div>' +
        (a.speciesId === 'sheep' && a.herdCommunityId != null
          ? '<div class="brain-box"><strong>Manejo do rebanho · IA individual desligada</strong><small>' + (a.herdPenId != null
            ? 'A ovelha está associada a um curral e recebe uma porção diária. Os moradores recolhem brotos para manter o estoque comunitário.'
            : 'A ovelha pertence ao rebanho comunitário, mas aguarda vaga em um curral. A ração vem do estoque compartilhado.') + '</small><div class="brain-metrics"><span>Ração diária<b>1 porção</b></span><span>Recebida hoje<b>' + fmtRationPortions(a.lastFeedAmount || 0) + ' porção</b></span><span>Ração no reino<b>' + fmtRationPortions((getCommunity(a.herdCommunityId) || { stores: {} }).stores.feed || 0) + ' porções</b></span><span>Aprendizado<b>desativado</b></span></div></div>'
          : '<div class="brain-box"><strong>Controlador individual · rede ' + a.brain.inputSize + ' → ' + a.brain.hiddenSize + ' → ' + a.brain.actionCount + '</strong><small>As necessidades e o habitat limitam as ações possíveis; a rede aprende com os resultados das decisões.</small><div class="brain-metrics"><span>Última intenção<b>' + esc(a.brain.lastAction) + '</b></span><span>Decisões<b>' + a.brain.decisions + '</b></span><span>Atualizações<b>' + a.brain.updates + '</b></span><span>Pesos<b>independentes</b></span></div></div>') +
        '<p class="quiet">' + (profile.prey.length ? 'A dieta inclui ' + profile.prey.map(id => Sim.animals.find(s => s.id === id).name.toLowerCase()).join(', ') + '; a predação depende de encontros e do estado da presa.' : 'A dieta retira biomassa vegetal disponível; não há reposição automática de indivíduos.') + '</p>';
      return;
    }
    if (selection.kind === 'loot') {
      const pile = (world.loot || []).find(p => p.id === selection.id && p.available);
      if (!pile) { selection = null; renderInspector(); return; }
      $('inspectEyebrow').textContent = 'RECURSOS · LIVRES NO CHÃO';
      $('inspectTitle').textContent = 'Recursos derrubados';
      const labels = { food: 'Alimento', meat: 'Carne', wood: 'Madeira', stone: 'Pedra', gold: 'Ouro',
        silver: 'Prata', copper: 'Cobre', iron: 'Ferro', feed: 'Ração' };
      root.innerHTML = Object.entries(pile.resources).filter(([, n]) => n > (pile.mineralKind ? 0 : .001)).map(([resource, amount]) =>
        '<div class="data-row"><span>' + esc(labels[resource] || resource) + '</span><b>' + fmt(amount, 1) + '</b></div>').join('')
        + '<p class="quiet">' + (pile.mineralKind ? 'Moradores podem recolher os fragmentos de minério.'
          : 'Qualquer pessoa pode recolher os recursos.') + ' O limite de carga é de 24 unidades por viagem.</p>';
      return;
    }
    if (selection.kind === 'log') {
      const item = (world.logs || []).find(entry => entry.id === selection.id && entry.available);
      if (!item) { selection = null; renderInspector(); return; }
      $('inspectEyebrow').textContent = 'RECURSO · MADEIRA NO SOLO';
      $('inspectTitle').textContent = 'Tronco derrubado';
      root.innerHTML = '<div class="data-row"><span>Madeira disponível</span><b>' + fmt(item.amount, 1) + ' unidades</b></div>' +
        '<div class="data-row"><span>Espécie cortada</span><b>' + (item.treeType === 'conifer' ? 'conífera' : 'árvore de folhas largas') + '</b></div>' +
        '<div class="data-row"><span>Localização</span><b>' + item.x + ', ' + item.y + '</b></div>' +
        '<p class="quiet">O tronco fica disponível para qualquer morador que o perceba. A madeira só entra no estoque depois de ser levada ao abrigo.</p>';
      return;
    }
    if (selection.kind === 'community') {
      const c = getCommunity(selection.id);
      if (!c) { selection = null; renderInspector(); return; }
      const members = c.memberIds.map(getPerson).filter(Boolean);
      const names = members.slice(0, 8).map(p => p.name).join(', ');
      const activeUse = Object.values(c.usedCells || {}).filter(day => world.day - day <= 45).length;
      const relations = Object.values(world.communityRelations).filter(r => r.a === c.id || r.b === c.id);
      const disputes = relations.reduce((sum, r) => sum + r.conflicts, 0);
      const roleNames = { forage: 'alimento', hunt: 'caça', gather: 'recursos', build: 'construção', care: 'cuidado', diplomacy: 'mediação' };
      const roles = {};
      for (const p of members) {
        const best = Object.entries(p.skills).sort((a, b) => b[1] - a[1])[0][0];
        roles[best] = (roles[best] || 0) + 1;
      }
      const roleText = Object.entries(roles).map(([key, count]) => count + ' ' + roleNames[key]).join(' · ') || 'Sem especializações observadas';
      const groundsText = c.grounds && c.grounds.hunting ? ['caça perto de ' + c.grounds.hunting.feature + ' (' + qualityLabel(c.grounds.hunting.score || 0) + ')'] : [];
      const stageText = { vínculo: 'Laços ainda pequenos', grupo: 'Grupo local', tribo: 'Tribo emergente', reino: 'Reino emergente' }[c.stage] || c.stage;
      const leader = members.find(person => person.id === c.leaderId) || null;
      const taskCount = (c.assignments || []).filter(task => task.status === 'delegada').length;
      const tasksCompleted = (c.assignments || []).filter(task => task.status === 'concluída').length;
      const propertyCount = (c.properties || []).length;
      const raids = world.raidAttempts ? world.raidAttempts : 0;
      $('inspectEyebrow').textContent = 'ORGANIZAÇÃO SOCIAL · EXPERIMENTO';
      $('inspectTitle').textContent = c.name;
      root.innerHTML = '<div class="data-row"><span>Forma atual</span><b>' + esc(stageText) + '</b></div>' +
        '<div class="data-row"><span>Membros vivos</span><b>' + members.length + '</b></div>' +
        '<div class="data-row"><span>Coesão média</span><b>' + Math.round(c.cohesion * 100) + '%</b></div>' +
        '<div class="data-row"><span>' + (c.stage === 'reino' ? 'Rei' : 'Prefeito') + '</span><b>' + (leader ? esc(leader.name) : 'ainda sem nomeação') + ' · prestígio ' + fmt(leader && leader.prestige || 0, 1) + '</b></div>' +
        '<div class="data-row"><span>Satisfação</span><b>' + Math.round((c.satisfaction || 0) * 100) + '% · mede alimento, saúde, abrigo e vínculos</b></div>' +
        '<div class="data-row"><span>Reservas compartilhadas</span><b>alimento ' + fmt(c.stores.food) + ' · carne ' + fmt(c.stores.meat) + ' · madeira ' + fmt(c.stores.wood) + ' · pedra ' + fmt(c.stores.stone) + ' · ração ' + fmtRationPortions(c.stores.feed) + ' porções · ouro ' + fmt(c.stores.gold) + '</b></div>' +
        '<div class="data-row"><span>Tarefas / propriedades</span><b>' + tasksCompleted + ' concluídas · ' + taskCount + ' ativas · ' + propertyCount + ' propriedade(s)</b></div>' +
        '<div class="data-row"><span>Trocas / disputas / assaltos</span><b>' + c.tradeCount + ' / ' + disputes + ' / ' + raids + ' no mundo</b></div>' +
        '<div class="data-row"><span>Primeiro vínculo</span><b>dia ' + c.createdDay + '</b></div>' +
        '<h3>Membros observados</h3><p>' + esc(names || 'Nenhum membro vivo') + (members.length > 8 ? '…' : '') + '</p>' +
        '<div class="note-card"><b>Ordens e prestígio</b><span>' + esc(roleText) + '. A liderança prioriza alimento para o reino quando as reservas caem; sede, fome ou energia críticas suspendem a tarefa para a pessoa cuidar da própria sobrevivência. Concluir uma tarefa concede 1 ponto de prestígio ao membro e 0,2 à liderança; um membro mais prestigiado precisa manter apoio por sete dias para assumir.</span></div>' +
        '<h3>Áreas e uso comunitário</h3><div class="note-card"><span>' + activeUse + ' locais usados nos últimos 45 dias. Caçadas bem-sucedidas marcam áreas comunitárias.</span></div>' +
        '<div class="note-card"><b>Áreas e propriedades</b><span>' + esc(groundsText.join(' · ') || 'Ainda sem áreas de caça marcadas') + (propertyCount ? ' · ' + propertyCount + ' propriedade(s), adquiridas por ouro, madeira e pedra' : '') + '</span></div>' +
        '<div class="note-card"><b>Nome comunitário</b><span>' + esc(c.nameSource || 'Os primeiros membros') + ' propôs o nome usando um marco da paisagem local. Uma união pode gerar uma nova votação.</span></div>' +
        (c.history.length ? '<h3>Histórico</h3>' + c.history.slice(-5).reverse().map(item => '<div class="event">' + esc(item) + '</div>').join('') : '');
      return;
    }
    if (selection.kind === 'structure') {
      const structure = world.structures.find(item => item.id === selection.id);
      if (!structure) { selection = null; renderInspector(); return; }
      const kingdom = getKingdom(structure.kingdomId);
      $('inspectEyebrow').textContent = kingdom ? kingdom.name.toUpperCase() : 'CONSTRUÇÃO';
      $('inspectTitle').textContent = structure.frontierOutpost ? 'Posto de fronteira' : structureDisplayName(structure.type);
      root.innerHTML = buildingCard(world, structure);
      const meter = root.querySelector('.construction-meter');
      if (meter && window.ForjaHUD) meter.append(window.ForjaHUD.create({ size: 'small', color: 'yellow', value: Number(meter.dataset.progress), label: 'Progresso da construção' }));
      return;
    }    if (selection.kind === 'plant') {
      const d = Sim.inspectTile(world, selection.x, selection.y);
      if (!d) return;
      $('inspectEyebrow').textContent = 'BIOSFERA · VEGETAÇÃO';
      $('inspectTitle').textContent = 'Vegetação local';
      root.innerHTML = '<h3>Biomassa vegetal</h3>' + (d.plantBiomass.length
        ? d.plantBiomass.map(p => '<div class="data-row"><span>' + esc(p.name) + '</span><b>' + fmt(p.biomass) + ' g/m²</b></div>').join('')
        : '<p>Sem biomassa vegetal visível nesta área.</p>');
    }
  }

  function render(source = 'ui') {
    if (!world) return;
    const stats = world.stats;
    $('assetCreditTiny').hidden = false;
    updateHeader(stats);
    drawMap(source);
    renderMiniMap();
    renderKingdomList();
    renderLocalAiHistory();
    renderSpecies(stats);
    renderEvents();
    renderInspector();
  }

  function pickEntity(mapX, mapY) {
    const tileX = Math.floor(mapX), tileY = Math.floor(mapY);
    const x = mapX - .5, y = mapY - .5;
    const nearestActor = (kind, agents) => agents.filter(agent => agent.alive && agent.restingStructureId == null)
      .map(agent => { const pose = visualPose(kind, agent); return { agent, distance: Math.hypot(pose.x - x, pose.y - y) }; })
      .filter(item => item.distance < .72).sort((a, b) => a.distance - b.distance)[0]?.agent;
    const p = nearestActor('person', world.people);
    if (p) return { kind: 'person', id: p.id };
    const a = nearestActor('animal', world.animals);
    if (a) return { kind: 'animal', id: a.id };
    const pile = (world.loot || []).filter(p => p.available && Math.hypot(p.x - x, p.y - y) < .85)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (pile) return { kind: 'loot', id: pile.id };
    const looseLog = (world.logs || []).filter(item => item.available && item.amount > .01 && Math.hypot(item.x - x, item.y - y) < .72)
      .sort((u, v) => Math.hypot(u.x - x, u.y - y) - Math.hypot(v.x - x, v.y - y))[0];
    if (looseLog) return { kind: 'log', id: looseLog.id };
    const trainingDummy = trainingDummiesForWorld(world).filter(dummy =>
      Math.abs(dummy.x - x) <= 1.5 * (dummy.sizeScale ?? 1)
        && y >= dummy.y + .5 - 3 * (dummy.sizeScale ?? 1) && y <= dummy.y + .5)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (trainingDummy) return { kind: 'training-dummy', id: trainingDummy.id };
    const structure = world.structures.filter(s => s.type === 'divisa'
      ? Math.abs(Math.hypot(s.x - x, s.y - y) - (s.radius || 4)) < .85
      : s.type === 'curral' ? Math.abs(Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) - corralFenceRadius(s)) < .85
      : (() => {
        const kingdom = getKingdom(s.kingdomId), community = getCommunity(s.communityId);
        const spriteKey = structureSpriteKey(s);
        const palette = kingdom ? kingdom.palette : community ? communityPalette(community.id) : 'blue';
        const sprite = tinyBuildingSprites[palette] && tinyBuildingSprites[palette][spriteKey];
        if (sprite && sprite.complete && sprite.naturalWidth) {
          const width = sprite.naturalWidth / 48, height = sprite.naturalHeight / 48;
          const left = s.x + .5 - width / 2, top = s.y + 1 - height * .9;
          return mapX >= left - .18 && mapX <= left + width + .18
            && mapY >= top - .18 && mapY <= top + height + .18;
        }
        return Math.hypot(s.x - x, s.y - y) < 1.1;
      })())
      .sort((u, v) => Math.hypot(u.x - x, u.y - y) - Math.hypot(v.x - x, v.y - y))[0];
    if (structure) return { kind: 'structure', id: structure.id };
    const broad = plantIndex('broadleaf'), conifer = plantIndex('conifer'), pointPx = mapX * TILE, pointPy = mapY * TILE;
    const trees = [];
    for (let ty = Math.max(0, tileY - 9); ty <= Math.min(H - 1, tileY + 1); ty++) for (let tx = Math.max(0, tileX - 4); tx <= Math.min(W - 1, tileX + 4); tx++) {
      const tile = cell(tx, ty);
      if (!tile || !Sim.modules.Biosphere.Botany.isTreeAnchor(world, tile)) continue;
      const broadleaf = tile.plants[broad], pine = tile.plants[conifer];
      const type = broadleaf >= pine ? 'broadleaf' : 'conifer';
      const mass = Math.max(broadleaf, pine);
      const layout = tinyTreeSpriteLayout(tile, type, mass);
      if (pointPx >= layout.x && pointPx <= layout.x + layout.width && pointPy >= layout.y && pointPy <= layout.y + layout.height) {
        trees.push({ x: tx, y: ty, depth: ty, distance: Math.hypot(tx - x, ty - y) });
      }
    }
    if (trees.length) {
      trees.sort((a, b) => b.depth - a.depth || a.distance - b.distance);
      return { kind: 'plant', x: trees[0].x, y: trees[0].y };
    }
    const kingdom = world.kingdoms.find(k => Math.hypot(k.x - x, k.y - y) < 12);
    if (kingdom) return { kind: 'kingdom', id: kingdom.id };
    return null;
  }

  function territoryStructureAtMapPosition(mapX, mapY) {
    return world.structures.filter(structure => ['castelo', 'torre'].includes(structure.type)
      && structure.complete && structure.destroyedDay == null).map(structure => {
      const kingdom = getKingdom(structure.kingdomId), community = getCommunity(structure.communityId);
      const spriteKey = structureSpriteKey(structure);
      const palette = kingdom ? kingdom.palette : community ? communityPalette(community.id) : 'blue';
      const sprite = tinyBuildingSprites[palette] && tinyBuildingSprites[palette][spriteKey];
      const width = sprite && sprite.complete && sprite.naturalWidth ? sprite.naturalWidth / 48 : 1.1;
      const height = sprite && sprite.complete && sprite.naturalHeight ? sprite.naturalHeight / 48 : 1.1;
      const left = structure.x + .5 - width / 2, top = structure.y + 1 - height * .9;
      return mapX >= left - .18 && mapX <= left + width + .18
        && mapY >= top - .18 && mapY <= top + height + .18 ? structure : null;
    }).filter(Boolean).sort((a, b) => Math.hypot(a.x - mapX, a.y - mapY) - Math.hypot(b.x - mapX, b.y - mapY))[0] || null;
  }

  function collisionStructureAtMapPosition(mapX, mapY) {
    const candidates = [];
    for (const structure of world.structures) {
      const hitbox = Sim.modules.Collision.structureHitbox(structure);
      if (!hitbox) continue;
      const spriteKey = structureSpriteKey(structure);
      const kingdom = getKingdom(structure.kingdomId), community = getCommunity(structure.communityId);
      const palette = kingdom ? kingdom.palette : community ? communityPalette(community.id) : 'blue';
      const sprite = tinyBuildingSprites[palette] && tinyBuildingSprites[palette][spriteKey];
      const width = sprite?.complete && sprite.naturalWidth ? sprite.naturalWidth / SOURCE_TILE_PIXELS : Math.max(1.2, hitbox.halfWidth * 2);
      const height = sprite?.complete && sprite.naturalHeight ? sprite.naturalHeight / SOURCE_TILE_PIXELS : 1.8;
      const left = structure.x + .5 - width / 2;
      const top = structure.y + 1 - (BUILDING_FEET[spriteKey] || (height * SOURCE_TILE_PIXELS)) / SOURCE_TILE_PIXELS;
      const insideArt = mapX >= left - .2 && mapX <= left + width + .2
        && mapY >= top - .2 && mapY <= top + height + .2;
      const centerX = hitbox.x + .5, centerY = hitbox.y + 1;
      const entry = Sim.modules.Collision.structureInteractionPoint(structure);
      const nearCollider = Math.abs(mapX - centerX) <= hitbox.halfWidth + .45
        && Math.abs(mapY - centerY) <= hitbox.halfDepth + .45;
      const nearEntry = Math.hypot(mapX - entry.x - .5, mapY - entry.y - .5) < .35;
      if (insideArt || nearCollider || nearEntry) {
        candidates.push({ structure, distance: Math.hypot(mapX - centerX, mapY - centerY), insideArt });
      }
    }
    return candidates.sort((a, b) => Number(b.insideArt) - Number(a.insideArt) || a.distance - b.distance)[0]?.structure || null;
  }


  const activeMapPointers = new Map();
  let mapDrag = null, pinchGesture = null, mapGestureMoved = false, ignoreNextMapClick = false;
  function setMapCursor(mode) {
    for (const cursorMode of ['entity', 'pan', 'panning', 'blocked']) {
      canvas.classList.toggle('map-cursor-' + cursorMode, mode === cursorMode);
    }
  }
  function syncMapCursor(panning = false) {
    if (panning) setMapCursor('panning');
    else if (hoveredMapEntity) setMapCursor('entity');
    else if (mapZoom > MIN_MAP_ZOOM + .001) setMapCursor('pan');
    else setMapCursor('blocked');
  }
  function beginMapPointer(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    activeMapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    if (activeMapPointers.size === 1) {
      mapGestureMoved = false;
      mapDrag = mapZoom > MIN_MAP_ZOOM + .001
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: mapPanX, panY: mapPanY }
        : null;
      if (event.pointerType === 'mouse') syncMapCursor(!!mapDrag);
    } else if (activeMapPointers.size >= 2) {
      const points = Array.from(activeMapPointers.values()).slice(0, 2);
      const centerX = (points[0].x + points[1].x) / 2, centerY = (points[0].y + points[1].y) / 2;
      pinchGesture = { distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), centerX, centerY };
      mapDrag = null;
      mapGestureMoved = true;
    }
  }
  function moveMapPointer(event) {
    updateManualAim(event);
    if (!activeMapPointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse' && world) {
        const rect = stage.getBoundingClientRect();
        const point = currentMapCamera().toWorld(event.clientX - rect.left, event.clientY - rect.top);
        const structure = territoryStructureAtMapPosition(point.x / TILE, point.y / TILE);
        const nextHoveredId = structure?.id ?? null;
        const hoveredEntity = pickEntity(point.x / TILE, point.y / TILE);
        const nextHoveredPersonId = hoveredEntity?.kind === 'person' ? hoveredEntity.id : null;
        const nextHoveringEntity = !!hoveredEntity;
        if (nextHoveredId !== hoveredTerritoryStructureId || nextHoveringEntity !== hoveredMapEntity
            || nextHoveredPersonId !== hoveredPersonId) {
          hoveredTerritoryStructureId = nextHoveredId;
          hoveredMapEntity = nextHoveringEntity;
          hoveredPersonId = nextHoveredPersonId;
          syncMapCursor();
          drawMap();
        } else syncMapCursor();
      }
      return;
    }
    activeMapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeMapPointers.size >= 2) {
      const points = Array.from(activeMapPointers.values()).slice(0, 2);
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const centerX = (points[0].x + points[1].x) / 2, centerY = (points[0].y + points[1].y) / 2;
      if (!pinchGesture) pinchGesture = { distance, centerX, centerY };
      if (pinchGesture.distance > 0 && distance > 0) {
        const bounds = stage.getBoundingClientRect();
        const stageX = bounds.left + bounds.width / 2, stageY = bounds.top + bounds.height / 2;
        const mapX = (pinchGesture.centerX - stageX - mapPanX) / mapZoom;
        const mapY = (pinchGesture.centerY - stageY - mapPanY) / mapZoom;
        mapZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, mapZoom * distance / pinchGesture.distance));
        mapPanX = centerX - stageX - mapX * mapZoom;
        mapPanY = centerY - stageY - mapY * mapZoom;
        pinchGesture = { distance, centerX, centerY };
        mapGestureMoved = true;
        updateMapViewport();
      }
      return;
    }
    if (mapDrag && mapDrag.pointerId === event.pointerId) {
      const dx = event.clientX - mapDrag.x, dy = event.clientY - mapDrag.y;
      if (Math.hypot(dx, dy) > 4) mapGestureMoved = true;
      if (mapGestureMoved) {
        mapPanX = mapDrag.panX + dx; mapPanY = mapDrag.panY + dy;
        updateMapViewport(); syncMapCursor(true);
      }
    }
  }
  function endMapPointer(event) {

    activeMapPointers.delete(event.pointerId);
    if (activeMapPointers.size === 1) {
      const [pointerId, point] = activeMapPointers.entries().next().value;
      pinchGesture = null;
      mapDrag = mapZoom > MIN_MAP_ZOOM + .001
        ? { pointerId, x: point.x, y: point.y, panX: mapPanX, panY: mapPanY }
        : null;
    } else if (activeMapPointers.size >= 2) {
      const points = Array.from(activeMapPointers.values()).slice(0, 2);
      pinchGesture = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        centerX: (points[0].x + points[1].x) / 2,
        centerY: (points[0].y + points[1].y) / 2
      };
    } else {
      mapDrag = null; pinchGesture = null;
      if (mapGestureMoved) {
        ignoreNextMapClick = true;
        window.setTimeout(() => { ignoreNextMapClick = false; }, 0);
      }
      mapGestureMoved = false;
      syncMapCursor();
    }
  }
  canvas.addEventListener('pointerdown', beginMapPointer);
  canvas.addEventListener('pointermove', moveMapPointer);
  canvas.addEventListener('pointerleave', () => {
    if (hoveredTerritoryStructureId == null && !hoveredMapEntity && hoveredPersonId == null) return;
    hoveredTerritoryStructureId = null;
    hoveredMapEntity = false;
    hoveredPersonId = null;
    setMapCursor('default');
    drawMap();
  });
  canvas.addEventListener('pointerup', endMapPointer);
  canvas.addEventListener('pointercancel', endMapPointer);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    zoomMapTo(mapZoom * Math.exp(-event.deltaY * .0015), event.clientX, event.clientY);
    syncMapCursor();
  }, { passive: false });
  $('mapZoomIn').addEventListener('click', () => zoomMapTo(mapZoom * 1.25));
  $('mapZoomOut').addEventListener('click', () => zoomMapTo(mapZoom / 1.25));
  $('mapZoomReset').addEventListener('click', () => resetMapViewport());





  miniMapCanvas.addEventListener('click', event => {
    if (!world) return;
    const rect = miniMapCanvas.getBoundingClientRect();
    const targetX = Math.max(0, Math.min(W - 1, (event.clientX - rect.left) / rect.width * W));
    const targetY = Math.max(0, Math.min(H - 1, (event.clientY - rect.top) / rect.height * H));
    const scale = currentMapCamera().scale;
    mapPanX = scale * (LOGICAL_SIZE / 2 - targetX * TILE);
    mapPanY = scale * (LOGICAL_SIZE / 2 - targetY * TILE);
    clampMapPan(); updateMapViewport(); drawMap();
  });

  canvas.addEventListener('click', event => {
    if (!world) return;

    if (ignoreNextMapClick) { ignoreNextMapClick = false; return; }
    canvas.focus({ preventScroll: true });
    const rect = stage.getBoundingClientRect();
    const point = currentMapCamera().toWorld(event.clientX - rect.left, event.clientY - rect.top);
    const mapX = point.x / TILE;
    const mapY = point.y / TILE;
    if (mapX >= 0 && mapX < W && mapY >= 0 && mapY < H) {
      if (manualControlId != null) {
        updateManualAim(event, true);
        const item = pickEntity(mapX, mapY);
        const actor = currentManualPerson();
        const clickedPerson = item?.kind === 'person' ? getPerson(item.id) : null;
        if (clickedPerson && actor && clickedPerson.id !== actor.id
            && clickedPerson.kingdomId === actor.kingdomId) {
          openSelection(item);
          return;
        }
        return;
      }
      openSelection(pickEntity(mapX, mapY));
    }
  });

  function advanceWorld(days = 1, source = 'clock') {
    session.advance(days, source).catch(error => {
      if (!isResetCancellation(error)) console.error('[Kingdom Worker de simulação]', error);
    });
  }
  function submitClockDays(days) {
    pendingClockDays += days;
    const targetBatch = session.speed >= 8 ? 3 : 1;
    if (pendingClockDays >= targetBatch) {
      const batch = Math.min(3, pendingClockDays);
      pendingClockDays -= batch;
      advanceWorld(batch);
    }
  }
  function flushClockDays() {
    while (pendingClockDays > 0) {
      const batch = Math.min(3, pendingClockDays);
      pendingClockDays -= batch;
      advanceWorld(batch);
    }
  }

  $('toggle').addEventListener('click', () => {
    const paused = !session.paused;
    movementInterpolator.markDiscontinuity();
    if (paused) pendingClockDays = 0;
    session.paused = paused;
    session.setPaused(paused).catch(error => {
      if (!isResetCancellation(error)) console.error('[Kingdom Worker de simulação]', error);
    });
    render();
  });
  $('step').addEventListener('click', () => {
    movementInterpolator.markDiscontinuity();
    pendingClockDays = 0;
    if (!session.paused) {
      session.paused = true;
      session.setPaused(true).catch(error => {
        if (!isResetCancellation(error)) console.error('[Kingdom Worker de simulação]', error);
      });
    }
    advanceWorld(1, 'manual');
    render();
  });
  $('localAiToggle').addEventListener('click', async () => {
    if (!localAI) return;
    if (localAI.isEnabled()) {
      if (!persistLocalAIPreference(false)) return;
      localAI.disable();
      return;
    }
    if (!persistLocalAIPreference(true)) return;
    try { await localAI.enable(); } catch (error) {
      console.error('[Kingdom IA local] não foi possível ativar a IA:', error);
      render();
    }
  });
  $('speedCycle').addEventListener('click', event => {
    flushClockDays();
    const speeds = [1, 2, 3];
    const index = speeds.indexOf(session.speed);
    session.speed = speeds[(index + 1) % speeds.length];
    const label = session.speed + '×';
    event.currentTarget.textContent = label;
    event.currentTarget.setAttribute('aria-label', 'Velocidade da simulação: ' + label);
    event.currentTarget.title = 'Acelerar para ' + speeds[(speeds.indexOf(session.speed) + 1) % speeds.length] + '×';
  });
  $('restart').addEventListener('click', () => {
    const requestedSeed = $('seedInput').value.trim() ? Number($('seedInput').value) : randomSeed();
    const seed = Number.isFinite(requestedSeed) ? Math.min(0xffffffff, Math.max(1, Math.trunc(requestedSeed))) : 1;
    $('seedInput').value = ''; 
    pendingClockDays = 0;
    clock.reset();
    session.reset(seed, !!(localAI && localAI.isEnabled())).catch(error => {
      if (!isResetCancellation(error)) console.error('[Kingdom Worker de simulação]', error);
    });
  });
  $('seedInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('restart').click(); });
  const setKingdomPanel = open => {
    showLeft = open;
    $('leftPanel').classList.toggle('is-open', open);
    $('kingdomsToggle').setAttribute('aria-expanded', String(open));
    if (open) {
      $('journal').hidden = true; $('journalToggle').setAttribute('aria-expanded', 'false');
      $('settingsTray').hidden = true; $('settingsToggle').setAttribute('aria-expanded', 'false');
      showRight = false;
      $('rightPanel').classList.remove('is-open');
    } else if (selection) {
      showRight = true;
      $('rightPanel').classList.add('is-open');
    }
    syncPanelAccess();
  };
  const setSettingsPanel = open => {
    if (open) {
      showLeft = false; $('leftPanel').classList.remove('is-open'); $('kingdomsToggle').setAttribute('aria-expanded', 'false');
      showRight = false; $('rightPanel').classList.remove('is-open');
      $('journal').hidden = true; $('journalToggle').setAttribute('aria-expanded', 'false');
    }
    $('settingsTray').hidden = !open;
    $('settingsToggle').setAttribute('aria-expanded', String(open));
    syncPanelAccess();
  };
  $('kingdomsToggle').addEventListener('click', () => setKingdomPanel(!showLeft));
  $('settingsToggle').addEventListener('click', () => setSettingsPanel($('settingsTray').hidden));
  $('hitboxToggle').addEventListener('click', event => {
    showHitboxes = !showHitboxes;
    event.currentTarget.setAttribute('aria-pressed', String(showHitboxes));
    event.currentTarget.textContent = showHitboxes ? 'Ocultar hitboxes' : 'Mostrar hitboxes';
    drawMap();
  });
  const setJournalPanel = open => {
    const panel = $('journal');
    if (open) { setKingdomPanel(false); setSettingsPanel(false); showRight = false; $('rightPanel').classList.remove('is-open'); }
    panel.hidden = !open; $('journalToggle').setAttribute('aria-expanded', String(open));
    syncPanelAccess();
  };
  $('journalToggle').addEventListener('click', () => setJournalPanel($('journal').hidden));
  document.addEventListener('pointerdown', event => {
    if (!$('journal').hidden && !$('journal').contains(event.target)
      && !$('journalToggle').contains(event.target)) setJournalPanel(false);
    if (showLeft && !$('leftPanel').contains(event.target)
      && !$('kingdomsToggle').contains(event.target)) setKingdomPanel(false);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setKingdomPanel(false); setSettingsPanel(false);
      $('journal').hidden = true; $('journalToggle').setAttribute('aria-expanded', 'false');
      showRight = false; $('rightPanel').classList.remove('is-open');
      syncPanelAccess();
      return;
    }
    if (isEditableTarget(event.target)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) toggleManualControl();
      return;
    }
    if (manualControlId == null) return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) {
      event.preventDefault();
      if (!manualHeldKeys.has(key)) { manualHeldKeys.add(key); sendManualInput(); }
      return;
    }
    if (key === 'e') {
      event.preventDefault();
      if (!event.repeat) {
        if (primaryIsHealing()) { manualHealing = true; sendManualInput(); }
        else queueManualAttack('1');
      }
      return;
    }
    if (key === 'f') {
      event.preventDefault();
      if (!event.repeat && !manualDefending) { manualDefending = true; sendManualInput(); drawMap(); }
      return;
    }
    if (/^[1-5]$/.test(key)) {
      event.preventDefault();
      if (!event.repeat) {
        if (key === '1' && primaryIsHealing()) { manualHealing = true; sendManualInput(); }
        else queueManualAttack(key);
      }
    }
  });
  window.addEventListener('keyup', event => {
    if (manualControlId == null) return;
    const key = event.key.toLowerCase();
    if (manualHeldKeys.delete(key) && ['w', 'a', 's', 'd'].includes(key)) sendManualInput();
    if (['e', '1'].includes(key) && manualHealing) { manualHealing = false; sendManualInput(); drawMap(); }
    if (key === 'f' && manualDefending) { manualDefending = false; sendManualInput(); drawMap(); }
  });
  window.addEventListener('blur', clearManualInput);
  $('inspector').addEventListener('change', event => {
    const target = event.target.closest('[data-magic-person]');
    const person = target && getPerson(Number(target.dataset.magicPerson));
    if (!person) return;
    const command = magicInspectorCommand(target, person);
    if (command) session.dispatch(command).catch(error => console.error('[Magias]', error));
  });


  $('kingdomList').addEventListener('click', e => {
    const button = e.target.closest('[data-kingdom]');
    if (button) { setKingdomPanel(false); openSelection({ kind: 'kingdom', id: Number(button.dataset.kingdom) }); }
  });
  let lastAnimationFrame = 0;
  let magicAccumulator = 0, magicTickPending = false, lastMagicFrame = 0, magicGeneration = 0;
  function frame(now) {
    const profile = renderDiagnostics.profiler.beginFrame(now);
    if (!session.paused && world && magicHasActivity(world)) {
      magicAccumulator += Math.min(100, now - (lastMagicFrame || now)) * session.speed;
      if (!magicTickPending && magicAccumulator >= 100) {
        const elapsedMs = Math.min(1000, magicAccumulator);
        const generation = magicGeneration;
        magicAccumulator -= elapsedMs; magicTickPending = true;
        session.dispatch({ type: 'magic-tick', elapsedMs })
          .catch(error => { if (!isResetCancellation(error)) console.error('[Magias]', error); })
          .finally(() => { if (generation === magicGeneration) magicTickPending = false; });
      }
    } else magicAccumulator = 0;
    lastMagicFrame = now;
    const manualTickInterval = manualHealing && !manualHeldKeys.size && !manualDefending ? 200 : 50;
    if (manualControlId != null && now - lastManualTick >= manualTickInterval) {
      const dt = Math.min(.1, (now - (lastManualTick || now - 50)) / 1000);
      lastManualTick = now;
      if (!session.paused) sendManualInput(dt);
    }
    if (lastAnimationFrame && !session.paused) animationTime += Math.min(100, now - lastAnimationFrame) * session.speed;
    lastAnimationFrame = now;
    gameAudio.update(animationTime, session.speed, session.paused);
    syncAudioActivation();
    profile?.mark('audio');
    const elapsed = !fixedEffects && lastAtmosphereUpdate ? Math.min(.1, (now - lastAtmosphereUpdate) / 1000) : 0;
    lastAtmosphereUpdate = now;
    cloudSystem.update(elapsed);
    if (atmosphereLayerOpacityForZoom(mapZoom) > .001) {
      fogUpdateAccumulator += elapsed;
      if (fogUpdateAccumulator >= 1 / 30 - .001) {
        atmosphericLayer.update(fogUpdateAccumulator);
        fogUpdateAccumulator = 0;
      }
    } else {
      fogUpdateAccumulator = 0;
    }
    profile?.mark('atmosphere');

    const days = clock.advance(now, session.paused, session.speed);
    if (days > 0) submitClockDays(days);
    profile?.mark('simulationDispatch');
    const frameInterval = 1000 / 60;
    if (pendingMapDraw || now - lastSpriteDraw >= frameInterval - .5) {
      const elapsed = now - lastSpriteDraw;
      lastSpriteDraw = elapsed >= frameInterval ? now - elapsed % frameInterval : now;
      const source = pendingMapDraw || 'animation';
      pendingMapDraw = null;
      paintMap(source);
    }
    profile?.mark('map');
    profile?.end();
    if (renderDiagnostics.profiler.enabled) renderDiagnostics.refresh(now);
    window.requestAnimationFrame(frame);
  }

  updateMapViewport();
  unlockAudio();
}
