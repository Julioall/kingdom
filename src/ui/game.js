import { resourceSummary } from './gameplay-data.js';
import { buildingCard, kingdomOverview } from './building-card.js';
import { towerVitality, campaignTower } from '../simulation/kingdoms/fortifications.js';
import { activeLeadershipRank } from '../simulation/kingdoms/military-identity.js';
import { createMovementInterpolator } from './movement-interpolation.js';
import { createDamageBarTracker } from './health-bars.js';
import { GameSession } from '../app/session.ts';
import { SimulationClock } from '../app/simulation-loop.ts';
import Sim from './simulation-view.js';
import LocalAI from '../ai/local-engine.js';
import { readLocalAiPreference, writeLocalAiPreference } from '../ai/preference.js';
import { DAILY_FOOD_NEED, DOMESTIC_SHEEP_DAILY_FEED, FOOD_DAYS_PER_UNIT, SHEEP_ADULT_AGE_DAYS, SHEEP_JUVENILE_MIN_SCALE } from '../config/ecosystem.js';
import { isRoadTile, ROAD_RULES } from '../simulation/world/roads.js';
import { isBushAnchor } from '../simulation/ecology/plants.js';
import { CHARACTER_SPRITE_SCALE, MILITARY_SPRITES, militarySpritePose } from './military-sprites.js';
import { createAnimationRenderer, getUnitAnimation, getAnimationFrame } from './animations.js';
import { residentSpritePose, createActorAnimationClock, createActivityEffects } from './person-animations.js';
import { createGameAudio, windGainAtZoom } from './game-audio.js';
import { musicGainAtZoom } from './music-audio.js';
import { mapDecorationAt, MAP_DECORATION_SPRITES } from './map-decorations.js';
import { MILITARY_PAY, GARRISON_RECOVERY } from '../simulation/kingdoms/service.js';
import { isOperationalMilitarySource, MILITARY_SOURCE_LABELS } from '../simulation/kingdoms/military-sources.js';
import { mapCamera, spriteScale, BUILDING_FEET, alignedTileRect, SOURCE_TILE_PIXELS } from './map-camera.js';
import { structureDepthY } from './world-depth.js';
import { createCloudSystem, atmosphereZoomProfile } from './cloud-system.js';
import AtmosphericLayer from './atmospheric-layer.js';
import DirtBrush from './dirt-brush.js';
import { createLoadingScreen } from './loading-screen.js';
import { renderSocialInspectorSections } from './social-inspector.js';
import { createRenderDiagnostics } from './render-profiler-panel.js';
import { syncHudPanelAccess, syncFoodPressureAlert } from './hud-panel-access.js';
import { createTerrainChunkCache } from './terrain-chunks.js';
import { createPixelTileCache } from './pixel-tile-cache.js';
import { compareDepth, mergeDepthItems } from './depth-order.js';
import { createStaticDepthSpatialIndex } from './depth-spatial-index.js';
import { shouldDrawMineralAtZoom } from './mineral-lod.js';


const IMAGE_ASSET_EXTENSION = import.meta.env?.PROD ? 'webp' : 'png';
const imageFileName = name => `${name}.${IMAGE_ASSET_EXTENSION}`;

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
    for (const [selector, skin] of [['.topbar', 'wood'], ['.mini-map-panel', 'wood'], ['.left-panel', 'scroll'], ['.right-panel', 'paper'], ['.journal-panel', 'scroll'], ['.utility-drawer', 'wood']]) {
      const panel = document.querySelector(selector);
      if (panel && !panel.querySelector(':scope > .skin-layer')) {
        panel.classList.add('ui-skinned-panel');
        panel.dataset.uiSkin = skin;
        panel.prepend(forjaUI.skinLayer(skin));
      }
    }
  }
  const canvas = $('world');
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
  const terrainChunks = createTerrainChunkCache({ width: W, height: H, tileSize: TILE });
  const pixelTiles = createPixelTileCache();
  let terrainSyncRevision = -1, terrainSyncFallback = null, assetRevision = 0, renderTimestamp = null;
  const seasonNames = Sim.seasons;
  const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const requestedSeed = diagnosticQuery.get('seed');
  const sessionSeed = requestedSeed !== null && /^\d+$/.test(requestedSeed) && Number(requestedSeed) <= 0xffffffff
    ? Number(requestedSeed) : randomSeed();
  const PATH_VISUAL_STRENGTH = 1.5; // 50% stronger footpath shading.
  const PATH_EDGE_IRREGULARITY = 1; // DirtBrush maximum.
  const trailCanvasScale = 1;
  const trailCanvas = document.createElement('canvas');
  trailCanvas.width = trailCanvas.height = LOGICAL_SIZE * trailCanvasScale;
  const dirtBrush = new DirtBrush({ canvas: trailCanvas, size: 5, irregularity: PATH_EDGE_IRREGULARITY,
    seed: sessionSeed ^ 0x4d2b79f5, autoBind: false });
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
  let selection = null, showLeft = false, showRight = false, hoveredTerritoryStructureId = null, hoveredMapEntity = false;
  const syncPanelAccess = () => syncHudPanelAccess($('leftPanel'), $('rightPanel'), { leftOpen: showLeft, rightOpen: showRight });
  syncPanelAccess();
  let kingdomActionNotice = '';
  const isResetCancellation = error => error && error.name === 'AbortError';
  session.onUpdate = (nextWorld, _stats, reset) => {
    world = nextWorld;
    peopleById = new Map(world.people.map(person => [person.id, person]));
    animalsById = new Map(world.animals.map(animal => [animal.id, animal]));
    communitiesById = new Map(world.communities.map(community => [community.id, community]));
    kingdomsById = new Map(world.kingdoms.map(kingdom => [kingdom.id, kingdom]));
    structuresById = new Map(world.structures.map(structure => [structure.id, structure]));
    invalidateStaticDepthCache();

    movementInterpolator.observe(world, performance.now(), { reset, speed: session.speed });
    npcDamageBars.observe(world.people, performance.now(), reset);
    structureDamageBars.observe(world.structures.map(s => ({ id: s.id, alive: s.destroyedDay == null,
      lastAttackSequence: s.lastAttackSequence })), performance.now(), reset);
    activityEffects.observe(world, animationTime, reset);
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
      dirtBrush.clear();
      trailLastPositionByPerson.clear();
      trailSegmentByPerson.clear();
      pendingPersonTrailPoints.clear();
      lastTrailFlushAt = performance.now();
      selection = null;
      showRight = false;

      $('rightPanel').classList.remove('is-open');
      syncPanelAccess();
      kingdomActionNotice = '';
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
  const tinyGoldSprites = Object.create(null);
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
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
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
    fogCanvas.style.opacity = String(atmosphereLayerOpacityForZoom(mapZoom));
    cloudSpritesCanvas.style.opacity = String(atmosphereZoomProfile(mapZoom).cloudLayerOpacity);
    const next = atmosphereProfileForZoom(mapZoom);
    if (Object.keys(next).some(key => Math.abs(next[key] - atmosphericProfile[key]) >= .012)) {
      atmosphericLayer.setOptions(next);
      atmosphericProfile = next;
    }
  }
  const tinyFenceTilemap = trackedImage();
  tinyFenceTilemap.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  tinyFenceTilemap.src = 'assets/tiny-swords/fences/tileset-fences-1.png';
  const tinyMeatSprite = trackedImage();
  tinyMeatSprite.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  tinyMeatSprite.src = 'assets/tiny-swords/meat-resource.png';
  const showCropFieldGround = false;
  const cropFieldTexture = showCropFieldGround ? trackedImage() : null;
  if (cropFieldTexture) {
    cropFieldTexture.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
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
  for (let variant = 1; variant <= 6; variant++) {
    const image = trackedImage();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/minerals/' + imageFileName('gold-stone-' + variant);
    tinyGoldSprites[variant] = image;
  }
  function queueAssetRender() {
    if (assetRenderQueued) return;
    assetRenderQueued = true;
    window.requestAnimationFrame(() => {
      assetRenderQueued = false; groundCacheKey = ''; assetRevision++;
      terrainChunks.invalidateAll(); invalidateStaticDepthCache();
      if (world) render();
    });
  }
  function visualPose(kind, agent) {
    // Interpolation samples are stamped with real snapshot arrival times.
    const pose = movementInterpolator.pose(kind, agent, renderTimestamp ?? performance.now());
    if (kind !== 'person' || !agent.towerMounted) return pose;
    const tower = structuresById.get(agent.towerDutyId);
    return tower ? { ...pose, x: tower.x, y: tower.y - 3, moving: false }
      : { ...pose, moving: false };
  }
  function updateIndividualTrails(now) {
    if (!world) return;
    const visibleWear = ROAD_RULES.fastAt;
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
    const pressureForWear = wear => .65 + Math.max(0, Math.min(1,
      (wear - visibleWear) / (ROAD_RULES.maxWear - visibleWear))) * .55;
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
      const pose = visualPose('person', person);
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
        key, points, options: { size: 5, irregularity: PATH_EDGE_IRREGULARITY }
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
  function ensureTinyPalette(palette) {
    if (!tinyPalettes.includes(palette) || loadedTinyPalettes.has(palette)) return;
    loadedTinyPalettes.add(palette);
    for (const action of ['idle', 'run', 'attack', 'arrow'])
      animationRenderer.load(getUnitAnimation('arqueiro', action, palette)).catch(error => console.warn(error));
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
    const action = person.combatAction;
    const contactElapsed = action ? actorAnimationClock.elapsed('combat:' + person.id, String(action.id), animationTime) : Infinity;
    const attacking = action?.day === world.day && contactElapsed < action.durationMs;
    const defense = person.combatDefense;
    const defenseElapsed = defense ? actorAnimationClock.elapsed('defense:' + person.id, String(defense.actionId), animationTime) : Infinity;
    const defending = defense?.day === world.day && defenseElapsed >= Math.max(0, defense.atMs - 100)
      && defenseElapsed < defense.atMs + 200;
    const preparingSpear = attacking && action.weapon === 'lanceiro' && contactElapsed < action.windupMs;
    const shotElapsed = actorAnimationClock.elapsed('shot:' + person.id, String(person.lastArrowSequence || 0), animationTime);
    const shooting = !action && person.militaryClass === 'arqueiro' && person.lastArrowSequence > 0 && shotElapsed < 800;
    const restingPerson = (action || defense) && ['attack', 'defend'].includes(person.militaryAnimation)
      ? { ...person, militaryAnimationDay: -1 } : person;
    const animatedPerson = attacking || shooting ? { ...person, militaryAnimation: preparingSpear ? 'defend' : 'attack', militaryAnimationDay: world.day,
      militaryFacingX: action ? Math.cos(action.angle) : person.militaryFacingX,
      militaryFacingY: action ? Math.sin(action.angle) : person.militaryFacingY }
      : defending ? { ...person, militaryAnimation: 'defend', militaryAnimationDay: world.day } : restingPerson;
    let sprite = militarySpritePose(animatedPerson, attacking || shooting ? { ...pose, moving: false, dirX: 0, dirY: 0 } : pose, world.day);
    let animation = getUnitAnimation(sprite.unit.folder.toLowerCase(), sprite.action, palette);
    const battle = attacking || defending || shooting || animatedPerson.militaryAnimationDay === world.day;
    const elapsedMs = attacking ? action.weapon === 'lanceiro' && !preparingSpear
      ? contactElapsed - action.windupMs : contactElapsed : defending ? Math.max(0, defenseElapsed - defense.atMs + 100)
      : shooting ? shotElapsed : actorAnimationClock.elapsed(person.id, animation.id + (battle ? ':' + world.day : ''), animationTime);
    if (battle && getAnimationFrame(animation, elapsedMs, { loop: false }).done) {
      sprite = militarySpritePose(restingPerson, pose, -1);
      animation = getUnitAnimation(sprite.unit.folder.toLowerCase(), sprite.action, palette);
    }
    return { sprite, animation, elapsedMs, battle };
  }

  function drawMilitaryPerson(person, x, y, pose) {
    const { sprite, animation, elapsedMs, battle } = militaryAnimationState(person, pose);
    return animationRenderer.draw(ctx, animation, x + TILE / 2, y + TILE,
      { elapsedMs, scale: spriteScale(TILE, CHARACTER_SPRITE_SCALE), flipX: sprite.flip,
        rotation: pose.rotation || 0,
        loop: battle ? animation.loop : true });
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
  function drawTinyCliffFaces() {
    for (const t of world.tiles) {
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

  function drawTinyElevationLayer() {
    for (const t of world.tiles) {
      if (!hasElevation(t.x, t.y)) continue;
      const atlas = tinyTerrainAtlases[tinyTerrainPalette()];
      const coord = cliffTopCoord(t.x, t.y);
      drawTinyAtlasTile(atlas, coord.col, coord.row, t.x * TILE, t.y * TILE);
    }
  }

  function drawTinyRamps() {
    for (const t of world.tiles) {
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
      if (tile.terrain !== 'land' || tile.cropFieldId != null || !isRoadTile(tile, true)) continue;
      const strength = Math.min(1, (wear - ROAD_RULES.fastAt) / (ROAD_RULES.maxWear - ROAD_RULES.fastAt));
      const radius = .48 + Math.sqrt(strength) * .12;
      const alpha = (.025 + strength * .05) * PATH_VISUAL_STRENGTH;
      traceMudBlob(tile, radius, 781);
      ctx.fillStyle = 'rgba(112, 83, 53, ' + alpha + ')';
      ctx.fill();
      traceMudBlob(tile, radius * .58, 1781);
      ctx.fillStyle = 'rgba(155, 119, 75, ' + (alpha * .28) + ')';
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
        const gate = corralGates.find(item => item.structureId === s.id);
        function addFence(x, y, sourceColumn, sourceRow, key) {
          if (gate && gate.x === x && gate.y === y) return;
          const fenceTile = cell(x, y);
          if (fenceTile) add('fence', x, y, fenceTile, 2.6, s.id * 100 + key, { sourceX: sourceColumn * 32, sourceY: sourceRow * 32 });
        }
        for (let offset = -radius; offset <= radius; offset++) {
          const topColumn = offset === -radius ? 0 : offset === radius ? 4 : 2;
          addFence(centerX + offset, centerY - radius, topColumn, 0, offset + radius);
          addFence(centerX + offset, centerY + radius, topColumn, 3, offset + radius + 2 * radius + 1);
          if (offset > -radius && offset < radius) {
            const sideRow = 1 + ((offset + radius - 1) % 2);
            addFence(centerX - radius, centerY + offset, 0, sideRow, offset + radius + 4 * radius + 2);
            addFence(centerX + radius, centerY + offset, 4, sideRow, offset + radius + 6 * radius + 3);
          }
        }
      }
    }
    staticDepthItems = referenceRendering ? items : items.sort(compareDepth);
    staticDepthSpatialIndex = referenceRendering ? null : createStaticDepthSpatialIndex(staticDepthItems);
    staticDepthCacheWorld = world;
    staticDepthCacheDay = world.day;
    return staticDepthItems;
  }

  function collectDepthItems(bounds) {
    // LOD affects only the rendered list: the world's finite ore inventory,
    // mining navigation, inspection and rare deposits remain untouched.
    // The reference renderer intentionally keeps every deposit for comparison.
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
      const pose = visualPose('person', p);
      if (pose.x < bounds.minX || pose.x > bounds.maxX || pose.y < bounds.minY || pose.y > bounds.maxY) continue;
      const tile = cell(Math.round(p.x), Math.round(p.y));
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
      const flight = effect.projectile ? Math.min(1, (animationTime - effect.startedAt) / effect.duration) : 0;
      const position = recipient ? visualPose('person', recipient) : effect.projectile
        ? { x: effect.x + (effect.targetX - effect.x) * flight, y: effect.y + (effect.targetY - effect.y) * flight } : effect;
      if (position.x < bounds.minX || position.x > bounds.maxX || position.y < bounds.minY || position.y > bounds.maxY) continue;
      add('effect', position.x, position.y, cell(Math.round(position.x), Math.round(position.y)), 5, effect.id, { effect });
      if (effect.projectile || recipient?.towerMounted) items[items.length - 1].depth = Number.MAX_SAFE_INTEGER;
    }
    return referenceRendering ? items.sort(compareDepth) : mergeDepthItems(staticItems, items);
  }

  function drawDepthSortedWorld(bounds, profile = null) {
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
      else if (item.kind === 'fence') drawFenceSegment(item);
      else if (item.kind === 'structure') drawStructure(item.structure);
      else if (item.kind === 'animal') drawAnimal(item.animal, item.pose);
      else if (item.kind === 'person') drawPerson(item.person, item.pose);
      else if (item.kind === 'effect') animationRenderer.draw(ctx, item.effect.animation,
        (item.x + .5) * TILE, (item.y + (item.effect.personId != null ? 1 : .5)) * TILE,
        { elapsedMs: animationTime - item.effect.startedAt, scale: TILE / item.effect.pixels, rotation: item.effect.projectile ? Math.atan2(item.effect.targetY - item.effect.y, item.effect.targetX - item.effect.x) : 0 });
    }
    if (combatDebug) drawCombatDebugOverlay(bounds);
    profile?.mark('entities');
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

  function drawFenceSegment(item) {
    const image = tinyFenceTilemap;
    if (!image.complete || image.naturalWidth < 352 || image.naturalHeight < 768) return;
    const x = item.x * TILE + TILE / 2, y = item.y * TILE + TILE / 2;
    if (referenceRendering) { ctx.save(); ctx.imageSmoothingEnabled = false; }
    ctx.drawImage(image, item.sourceX, item.sourceY, 32, 32, x - TILE / 2, y - TILE / 2, TILE, TILE);
    if (referenceRendering) ctx.restore();
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
    // Until dedicated assets arrive, each metal deposit uses the existing gold
    // resource sprite. The mineral identity stays in the tile/snapshot data.
    const ore = Math.max(item.gold || 0, item.copper || 0, item.silver || 0, item.iron || 0);
    if (ore > .05) {
      const variant = Math.max(1, Math.min(6, Math.ceil(ore / 3.5 * 6)));
      const highlighted = activeMiningSites.has(item.x + ':' + item.y);
      if (highlighted && animationRenderer.draw(ctx, 'resource.gold-stone-' + variant + '-highlight',
        x + TILE / 2, y + TILE / 2, { elapsedMs: animationTime, scale: spriteScale(TILE), phase: item.id || 0 })) return;
      const image = tinyGoldSprites[variant];
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

  function towerDiplomacyPanel(kingdom) {
    const relations = Object.values(world.kingdomRelations || {}).filter(r => r.a === kingdom.id || r.b === kingdom.id);
    const pressure = relations.map(r => '<div class="data-row"><span>Tensão nas fronteiras</span><b>'
      + Math.round((r.tension || 0) * 100) + '% · ' + (r.towerPressure?.pairs.length || 0)
      + ' pares de torres próximos · ' + (r.towerPressure?.overlappingPairs || 0) + ' sobreposições</b></div>').join('');
    const targets = world.structures.filter(t => ['torre', 'centro_militar', 'arquearia', 'monasterio', 'mercado', 'castelo'].includes(t.type)
      && t.complete && t.destroyedDay == null && t.kingdomId != null && t.kingdomId !== kingdom.id)
      .sort((a, b) => Math.hypot(a.x - kingdom.x, a.y - kingdom.y) - Math.hypot(b.x - kingdom.x, b.y - kingdom.y))
      .filter((t, i, all) => all.findIndex(other => other.type === t.type) === i).slice(0, 6);
    const reports = (kingdom.militaryIntel || []).filter(r => ['enemy-approach', 'territory-lost'].includes(r.kind)).slice(-5).reverse();
    const alerts = reports.map(r => '<div class="data-row"><span>Dia ' + r.day + ' · aviso ao rei</span><b>'
      + esc(r.kind === 'territory-lost' ? 'Perdeu ' + r.tiles + ' células em ' + r.location.x + ',' + r.location.y
        : r.soldiersObserved + ' inimigos avistados em ' + r.location.x + ',' + r.location.y) + '</b></div>').join('');
    return pressure + alerts + '<div class="kingdom-actions">' + targets.map(t => (t.type === 'torre'
      ? '<button type="button" data-structure-command="capture-tower" data-kingdom-id="' + kingdom.id + '" data-tower-id="' + t.id + '">Capturar torre ' + t.id + '</button>' : '')
      + '<button type="button" data-structure-command="attack-installation" data-kingdom-id="' + kingdom.id
      + '" data-structure-id="' + t.id + '">Atacar ' + esc(structureDisplayName(t.type)) + ' ' + t.id + '</button>').join('')
      + '</div><p class="quiet">A captura exige enfraquecer a torre e ocupá-la por cinco dias. Ataques às demais instalações organizam um cerco com tropas e suprimentos. A paz inicial e os armistícios são respeitados.</p>';
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
    const top = s.type === 'curral' ? y - Math.round(s.radius || 3.5) * TILE
      : y + TILE - (BUILDING_FEET[spriteKey] || 150) * spriteScale(TILE);
    const barHeight = 7, barY = (s.complete ? top - barHeight - 2 : y - barHeight - 2) + constructionBarOffset;
    drawWorldHealthBar(x - 12, barY, 40, barHeight, ratio);
    if (world.day - (s.lastAttackedDay ?? -Infinity) <= 1) {
      ctx.strokeStyle = '#f6aa63'; ctx.lineWidth = 1; ctx.strokeRect(x - 13, barY - 1, 42, barHeight + 2);
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
  function drawPerson(p, pose) {
      const c = p.communityId ? getCommunity(p.communityId) : null;
      const militarySprite = MILITARY_SPRITES[p.militaryClass];
      const towerDrop = p.towerMounted
        ? ((militarySprite?.foot || 0) * .625 + (militarySprite?.size || 0) * .1)
          * spriteScale(TILE, CHARACTER_SPRITE_SCALE) : 0;
      const x = pose.x * TILE, y = pose.y * TILE + towerDrop, child = p.ageDays < 12 * 365;
      const scale = child ? .72 : 1, color = c ? c.color : ['#d9c28b', '#cfb585', '#e0c99b', '#c9b27f'][p.id % 4];
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
      const disarmed = p.role === 'soldier' && p.combatDisarmedUntilDay > world.day;
      const opening = p.role === 'soldier' && p.combatOpening?.expiresDay > world.day;
      if (disarmed || opening) {
        const badgeX = x + TILE / 2, badgeY = y + 2;
        ctx.save();
        ctx.fillStyle = 'rgba(34,31,23,.92)';
        ctx.beginPath(); ctx.arc(badgeX, badgeY, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = disarmed ? '#f2ca73' : '#a9dfa7'; ctx.lineWidth = 1.25;
        if (disarmed) {
          ctx.beginPath(); ctx.moveTo(badgeX - 1.7, badgeY - 1.7); ctx.lineTo(badgeX + 1.7, badgeY + 1.7);
          ctx.moveTo(badgeX + 1.7, badgeY - 1.7); ctx.lineTo(badgeX - 1.7, badgeY + 1.7); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(badgeX, badgeY - 2.4); ctx.lineTo(badgeX + 2.4, badgeY);
          ctx.lineTo(badgeX, badgeY + 2.4); ctx.lineTo(badgeX - 2.4, badgeY); ctx.closePath(); ctx.fillStyle = '#a9dfa7'; ctx.fill();
        }
        ctx.restore();
      }
      const now = performance.now();
      const isMonk = p.role === 'soldier' && p.militaryClass === 'monge';
      if (npcDamageBars.visible(p.id, now)) {
        const ratio = p.health < 30 ? 'red' : p.health < 60 ? 'yellow' : 'green';
        drawPersonStatusBar(x + 2.5, y - (isMonk ? 12 : 8), 11, 2, p.health / 100, ratio);
      }
      if (p.role === 'soldier' && (npcDamageBars.visible(p.id, now) || selection?.kind === 'person' && selection.id === p.id)) {
        drawPersonStatusBar(x + 2.5, y - (isMonk ? 10 : 6), 11, 2, (p.stamina ?? 100) / 100, 'yellow');
        if (isMonk) {
          drawPersonStatusBar(x + 2.5, y - 8, 11, 2, (p.mana ?? 100) / 100, 'blue');
        }
      }
      drawLeaderBadge(p, x, y);
      if (p.health < 22) { ctx.fillStyle = '#bc574d'; ctx.fillRect(x + 12, y + 2, 3, 2); }
  }

  function drawSelection() {
    if (!selection) return;
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
    if (item.kind === 'person') {
      const person = getPerson(item.id);
      if (!person || person.restingStructureId != null) return null;
      const pose = visualPose('person', person);
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
      const radius = Math.max(2, Math.round(structure.radius || 3.5));
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
  function drawOceanBackdrop(context, camera) {
    context.fillStyle = '#16536e';
    context.fillRect(0, 0, canvas.width, canvas.height);
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
    context.fillRect(0, 0, canvas.width, canvas.height);
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
    updateIndividualTrails(renderTimestamp);
    syncAtmosphereWithZoom();
    const displayContext = ctx;
    const camera = currentMapCamera();
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
    const terrainStyle = [world.seed, visualPack, transition.season, transition.nextSeason, transition.alpha, assetRevision, fallbackTerrain].join(':');
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
        drawGround(); profile?.mark('terrain');
        drawGroundPlants(); profile?.mark('plants');
        drawRoads(); profile?.mark('roads');
      } else {
        profile?.mark('preparation');
        terrainChunks.draw(ctx, camera, terrainStyle, (chunkContext, bounds, transform) => {
          const previousContext = ctx, previousTransform = mapTransform;
          try {
            ctx = chunkContext; mapTransform = transform;
            drawGround(bounds); profile?.mark('terrain');
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
      ctx.globalAlpha = .15;
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
      const ruler = getPerson(kingdom.rulerId);
      const soldiers = residents.filter(person => person.role === 'soldier').length;
      const patrolling = residents.filter(person => person.role === 'soldier' && String(person.state || '').startsWith('patrulhando')).length;
      const campaign = (world.campaigns || []).find(item => item.status !== 'complete'
        && (item.attackerId === kingdom.id || item.defenderId === kingdom.id));
      const campaignStatus = campaign ? ' · campanha ' + (campaign.status === 'engaged' ? 'em combate' : campaign.status === 'withdrawing' ? 'retirada' : 'em marcha') : '';
      return '<button class="community-card" data-kingdom="' + kingdom.id + '" title="Inspecionar reino, moradias, tesouro e mercado" style="--community:' + esc(kingdom.color) + '">' +
        '<i class="color-dot"></i><span><strong>' + esc(kingdom.name) + '</strong><small>' + residents.length + ' moradores · ' + soldiers + ' soldados (' + patrolling + ' em patrulha)' + esc(campaignStatus) + ' · ' + (kingdom.homeIds || []).length + ' casas · ' + kingdom.towerIds.map(id => world.structures.find(structure => structure.id === id && structure.complete)).filter(Boolean).length + ' torres · rei ' + esc(ruler ? ruler.name : 'sem governante') + '</small></span><em>' + fmt(kingdom.territoryTileCount) + ' células</em></button>';
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
    const region = world.regions[0] || { temperatureC: 18, rainfallMm: 0 };
    const avgTemp = world.regions.reduce((s, r) => s + r.temperatureC, 0) / world.regions.length;
    const calendar = Sim.modules.Cosmos.calendarDate(world.day);
    const global = resourceSummary(world);
    $('globalFood').textContent = fmt(global.food);
    $('globalFood').title = 'Comida física agregada (dias adultos): ' +
      'estoques comunitários ' + fmt(global.foodByAccount.community, 1) +
      ' · tesouros ' + fmt(global.foodByAccount.treasury, 1) +
      ' · mercados dos reinos ' + fmt(global.foodByAccount.market, 1) +
      ' · mercado geral sem vínculo ' + fmt(global.foodByAccount.unassignedMarket, 1) +
      '. A soma não representa acesso imediato em cada reino.';
    $('globalGold').textContent = fmt(global.gold, 0);
    $('day').textContent = fmt(calendar.dayOfYear);
    $('day').parentElement.title = 'Dia ' + world.day + ' desde a criação · 365 dias por ano';
    $('year').textContent = fmt(stats.year);
    $('animalCount').textContent = fmt(stats.animalCount);
    $('peopleCount').textContent = fmt(stats.peopleCount);
    $('kingdomCount').textContent = fmt(stats.kingdomCount);
    $('birthCount').textContent = fmt(global.births);
    $('deathCount').textContent = fmt(global.deaths);
    $('conflictCount').textContent = fmt(stats.borderIncidents);
    $('harvestCount').textContent = fmt(stats.harvests.hunting);
    $('meatCount').textContent = fmt(stats.meatCarried) + '/' + fmt(stats.meatStored);
    $('season').textContent = seasonNames[stats.season].toUpperCase();
    $('temperature').textContent = Math.round(avgTemp) + ' °C';
    $('rainfall').textContent = fmt(stats.rainfallMm, 1) + ' mm';
    syncFoodPressureAlert($('mapTags'), $('foodPressureTag'), stats.foodRiskPeople);
    $('foodRiskCount').textContent = fmt(stats.foodRiskPeople);
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
    if (item && item.kind === 'kingdom' && (!selection || selection.kind !== 'kingdom' || selection.id !== item.id)) kingdomActionNotice = '';
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
    if (selection.kind === 'kingdom') {
      const kingdom = getKingdom(selection.id);
      if (!kingdom) { selection = null; renderInspector(); return; }
      const kingdomId = kingdom.id;
      const residents = kingdom.memberIds.map(id => getPerson(id)).filter(Boolean);
      const ruler = getPerson(kingdom.rulerId);
      const homes = kingdom.homeIds.map(id => world.structures.find(s => s.id === id)).filter(Boolean);
      const housed = homes.reduce((sum, home) => sum + home.residentIds.filter(id => getPerson(id)).length, 0);
      const treasury = kingdom.treasury.stock, market = kingdom.market;
      const structures = kingdom.structureIds.map(id => world.structures.find(s => s.id === id)).filter(Boolean);
      const maintenanceHistory = (kingdom.fortificationMaintenance && kingdom.fortificationMaintenance.history || []).slice(-3).reverse();
      const maintenancePanel = maintenanceHistory.length
        ? '<h3>Manutenção recente</h3>' + maintenanceHistory.map(item =>
          '<div class="event">Dia ' + fmt(item.day, 0) + ' · ' + fmt(item.paidStructures, 0) + '/' + fmt(item.fortificationCount, 0)
          + ' pagas · ' + fmt(item.deferredStructures, 0) + ' adiadas · pagos: ' + fmt(item.paidCost.wood, 2) + ' madeira / '
          + fmt(item.paidCost.stone, 2) + ' pedra · adiados: ' + fmt(item.deferredCost.wood, 2) + ' madeira / '
          + fmt(item.deferredCost.stone, 2) + ' pedra · perda de integridade ' + fmt(item.integrityLost, 2)
          + ' · ' + fmt(item.collapsedStructureIds && item.collapsedStructureIds.length, 0) + ' colapsos</div>').join('')
        : '';
      const reserveTransfers = (Array.isArray(kingdom.reserveTransfers) ? kingdom.reserveTransfers : []).slice(-3).reverse();
      const reserveTransferPanel = reserveTransfers.length
        ? '<h3>Repasses recentes do tesouro</h3>' + reserveTransfers.map(item => {
          const reason = item.foodReason === 'emergency-community-below-one-day'
            ? 'estoque abaixo de um dia; piso de seca liberado'
            : item.foodReason === 'restore-two-day-community-buffer' ? 'buffer comunitário de dois dias'
              : item.feedReason ? 'buffer de ração do rebanho' : 'reserva comunitária';
          return '<div class="event">Dia ' + fmt(item.day) + ' · tesouro → comunidade · ' + fmt(item.food) + ' alimento / '
            + fmtRationPortions(item.feed) + ' porções de ração · tesouro restante ' + fmt(item.treasuryFood) + ' alimento · reserva comum '
            + fmt(item.communityFood) + ' · piso de seca ' + fmt(item.protectedFoodFloor) + ' · ' + esc(reason) + '</div>';
        }).join('')
        : '';
      const towers = structures.filter(s => s.type === 'torre' && s.complete && !s.frontierOutpost);
      const frontierTowers = structures.filter(s => s.frontierOutpost && (s.complete
        || s.integrity > 0 && s.builtDay == null && (s.progress || 0) < (s.required || 1)));
      const militaryCenters = (kingdom.militaryCenterIds || []).map(id => world.structures.find(s => s.id === id
        && isOperationalMilitarySource(s, 'centro_militar'))).filter(Boolean);
      const soldiers = residents.filter(person => person.role === 'soldier');
      const pendingRecruitments = residents.filter(person => person.alive && person.recruitmentOrder);
      const activeKingdomProject = structures.find(structure => structure.kingdomProject && !structure.complete && structure.integrity > 0 && structure.builtDay == null);
      const activeCommunityProject = world.structures.find(structure => structure.communityId === kingdom.communityId
        && !structure.kingdomProject && !structure.complete && structure.integrity > 0 && structure.builtDay == null);
      const patrollingSoldiers = soldiers.filter(person => String(person.state || '').startsWith('patrulhando')).length;
      const soldierCapacity = militaryCenters.reduce((sum, center) => sum + (center.capacity || 8), 0);
      const soldierSlots = militaryCenters.reduce((total, center) => {
        const stationed = new Set((center.soldierIds || []).filter(id => soldiers.some(person => person.id === id)));
        for (const person of soldiers) if (person.militaryCenterId === center.id) stationed.add(person.id);
        const pending = pendingRecruitments.filter(person => person.recruitmentOrder.militaryCenterId === center.id).length;
        return total + Math.max(0, (center.capacity || 8) - stationed.size - pending);
      }, 0);
      const hasRecruitmentSource = militaryClass => !!Sim.kingdomCommands.militaryClassSource(world, kingdomId, militaryClass);
      const missingMilitarySources = ['guerreiro', 'arqueiro', 'monge']
        .filter(militaryClass => !hasRecruitmentSource(militaryClass));
      const pausedRecruitments = pendingRecruitments.filter(person => person.recruitmentOrder.progressionStatus === 'paused');
      const constructionStatus = activeKingdomProject
        ? '<div class="note-card"><b>Obra de defesa em andamento</b><span>'
          + esc(activeKingdomProject.frontierOutpost ? 'Posto de fronteira' : structureDisplayName(activeKingdomProject.type))
          + ' · ' + activeKingdomProject.progress + '/' + activeKingdomProject.required
          + ' dias de trabalho · ' + esc(activeKingdomProject.lastConstructionWorkDay === world.day ? 'peão construindo no local' : 'aguardando peão no local')
          + ' · ' + (activeKingdomProject.siegeBlocked ? 'obra interrompida por ataque' : 'depende da chegada e proteção dos trabalhadores') + '.</span></div>' : '';
      const communityWorkStatus = activeCommunityProject && activeCommunityProject.workStatus;
      const communityWorkStatusLabels = {
        delegated: 'trabalhador designado', 'not-delegated': 'sem reserva de trabalhador',
        blocked: 'obra bloqueada', 'worker-out-of-range': 'trabalhador fora do alcance',
        'worker-approaching': 'trabalhador a caminho', 'worker-paused': 'atribuição pausada',
        'worker-working': 'trabalhador avançando', 'worker-following-local-policy': 'decisão local em curso'
      };
      const communityConstructionStatus = activeCommunityProject
        ? '<div class="note-card"><b>Obra comunitária em andamento</b><span>'
          + esc(structureDisplayName(activeCommunityProject.type)) + ' · ' + fmt(activeCommunityProject.progress, 0)
          + '/' + fmt(activeCommunityProject.required, 0) + ' dias · '
          + (Number.isFinite(activeCommunityProject.lastProgressDay)
            ? 'último avanço no dia ' + fmt(activeCommunityProject.lastProgressDay, 0) + '.'
            : 'sem avanço registrado ainda.')
          + (communityWorkStatus ? '<br>Diagnóstico do dia ' + fmt(communityWorkStatus.day, 0) + ' · '
            + esc(communityWorkStatusLabels[communityWorkStatus.status] || communityWorkStatus.status) + ' · '
            + esc(communityWorkStatus.reason || 'sem motivo informado')
            + (communityWorkStatus.workerId != null && getPerson(communityWorkStatus.workerId)
              ? ' · responsável: ' + esc(getPerson(communityWorkStatus.workerId).name) : '')
            + (Number.isFinite(communityWorkStatus.distance) ? ' · distância ' + fmt(communityWorkStatus.distance, 1) + ' células' : '')
            + (Number.isFinite(communityWorkStatus.safeNearby) ? ' · ' + fmt(communityWorkStatus.safeNearby, 0) + ' trabalhadores seguros de '
              + fmt(communityWorkStatus.availableNearby, 0) + ' adultos livres próximos' : '')
            + '</span></div>' : '<br>O diagnóstico de trabalho será registrado na próxima atualização da governança.</span></div>')
        : '';
      const recruitmentStatus = pendingRecruitments.length
        ? '<div class="note-card"><b>Treinamento em andamento</b><span>' + pendingRecruitments.map(person =>
          esc(person.name) + ' · ' + Math.max(0, person.recruitmentOrder.readyDay - world.day) + ' dias restantes').join(' · ') + '</span></div>' : '';
      const calendar = Sim.modules.Cosmos.calendarDate(world.day);
      const strategy = kingdom.strategy;
      const strategyGoalLabels = {
        'secure-shared-food': 'proteger alimento compartilhado',
        'secure-herd-feed': 'proteger a ração do rebanho',
        'repair-damaged-structures': 'reparar construções danificadas',
        'complete-community-structure': 'concluir obra comunitária',
        'gather-construction-materials': 'reunir materiais de construção',
        'maintain-autonomy': 'manter a iniciativa local'
      };
      const strategyActionLabels = { forage: 'buscar alimento', collect_feed: 'recolher ração', gather: 'reunir materiais', build: 'construir' };
      const strategyActionLabel = strategy && strategy.goal === 'repair-damaged-structures'
        ? 'reparar construções' : strategy && strategy.action
          ? strategyActionLabels[strategy.action] || strategy.action : 'sem delegação';
      const repairEvidence = strategy && strategy.evidence && strategy.evidence.repairs;
      const repairEvidenceText = repairEvidence && Array.isArray(repairEvidence.damagedStructures) && repairEvidence.damagedStructures.length
        ? repairEvidence.damagedStructures.map(item => item.type + ' ' + Math.round(item.integrity * 100) + '%'
          + (item.healthRatio == null ? '' : ' · vida ' + Math.round(item.healthRatio * 100) + '%')).join(' · ')
        : '';
      const strategyOutcomeLabels = { planned: 'aguardando execução', maintained: 'sem nova ordem civil', completed: 'tarefa concluída', blocked: 'delegação sem trabalhador ou recurso observável', refused: 'ordem recusada pelo domínio' };
      const frontier = kingdom.frontierExpansion;
      const frontierStatusLabels = {
        observing: 'observando terreno neutro', constructing: 'construindo posto', established: 'posto estabelecido',
        cooldown: 'consolidando expansão', 'awaiting-resources': 'aguardando recursos', 'no-neutral-site': 'sem local neutro seguro',
        'paused-war': 'adiada durante conflito', 'limit-reached': 'limite atual alcançado', blocked: 'obra bloqueada'
      };
      const frontierGuards = frontierTowers.filter(item => item.garrisonSoldierId != null
        && getPerson(item.garrisonSoldierId)?.alive).length;
      const frontierProject = frontierTowers.find(item => !item.complete && item.builtDay == null);
      const frontierSite = frontierProject
        ? ' · local ' + fmt(frontierProject.x, 0) + ', ' + fmt(frontierProject.y, 0) + ' · ' + frontierProject.progress + '/' + frontierProject.required + ' dias'
        : '';
      const frontierOutcome = frontier && frontier.lastOutcome;
      const frontierOutcomeText = frontierOutcome && frontierOutcome.status === 'completed'
        ? 'Último posto: ' + fmt(frontierOutcome.territoryTilesGained || 0) + ' células incorporadas em '
          + fmt(frontierOutcome.site.x, 0) + ', ' + fmt(frontierOutcome.site.y, 0) + ' no dia ' + frontierOutcome.day
          + ' · custo ' + fmt(frontierOutcome.cost.wood, 0) + ' madeira, ' + fmt(frontierOutcome.cost.stone, 0)
          + ' pedra e ' + fmt(frontierOutcome.cost.gold, 0) + ' ouro.'
        : frontierOutcome && frontierOutcome.status === 'planned'
          ? 'Obra iniciada no dia ' + frontierOutcome.day + ' em ' + fmt(frontierOutcome.site.x, 0) + ', ' + fmt(frontierOutcome.site.y, 0) + '.'
          : '';
      const frontierPanel = '<h3>Expansão e patrulha de fronteira</h3>'
        + '<div class="data-row"><span>Plano autônomo</span><b>' + esc(frontierStatusLabels[frontier && frontier.status] || 'observando terreno neutro')
        + ' · ' + frontierTowers.length + ' postos · ' + frontierGuards + ' guarnições designadas</b></div>'
        + (frontierProject ? '<div class="data-row"><span>Posto em obra</span><b>' + esc(frontierSite.slice(3)) + '</b></div>' : '')
        + '<p class="quiet">' + esc(frontier && frontier.reason || 'O reino avalia locais neutros e reserva recursos do próprio tesouro para expandir.') + '</p>'
        + (frontierOutcomeText ? '<div class="note-card"><span>' + esc(frontierOutcomeText) + '</span></div>' : '');
      const strategyPanel = strategy
        ? '<h3>Estratégia observável</h3>'
          + '<div class="data-row"><span>Objetivo / ordem civil</span><b>' + esc(strategyGoalLabels[strategy.goal] || strategy.goal) + ' · '
          + esc(strategyActionLabel) + '</b></div>'
          + '<div class="data-row"><span>Postura da guarnição</span><b>' + (strategy.garrisonMode === 'patrol' ? 'patrulha autorizada' : 'reserva') + '</b></div>'
          + '<div class="data-row"><span>Evidências agregadas</span><b>' + fmt(strategy.evidence && strategy.evidence.population) + ' moradores · '
          + fmt(strategy.evidence && strategy.evidence.sharedFood, 1) + ' alimento compartilhado · '
          + fmt(strategy.evidence && strategy.evidence.foodPerResident, 1) + ' por morador · '
          + fmt(strategy.evidence && strategy.evidence.feedStock) + '/' + fmt(strategy.evidence && strategy.evidence.feedTarget) + ' porções de ração</b></div>'
          + (repairEvidence ? '<div class="data-row"><span>Construções danificadas que o rei conhece</span><b>'
            + repairEvidence.damagedStructureCount + ' encontradas · ' + repairEvidence.criticalStructureCount + ' críticas'
            + (repairEvidenceText ? ' · ' + esc(repairEvidenceText) : '') + '</b></div>' : '')
          + '<p class="quiet">' + esc(strategy.reason || '') + '</p>'
          + (strategy.aiPlan ? '<div class="note-card"><b>' + (strategy.goal === strategy.aiPlan.goal && strategy.action === strategy.aiPlan.action ? 'Ordem experimental do rei via IA' : 'Proposta experimental do rei') + ' · ' + esc(strategy.aiPlan.label || strategy.aiPlan.id) + '</b><span>'
            + 'Justificativa do modelo, não verificada: ' + esc(strategy.aiPlan.reason || '') + ' · ' + esc(strategy.aiPlan.model || strategy.aiPlan.provider || 'modelo local')
            + ' · pedido ' + esc(strategy.aiPlan.requestId || 'legado')
            + ' · confiança ' + Math.round((strategy.aiPlan.confidence || 0) * 100) + '% · válida até o dia ' + strategy.aiPlan.expiresDay + '</span></div>' : '')
          + (strategy.lastAiCommand ? '<div class="note-card"><b>Última ordem militar da IA local · recrutamento</b><span>'
            + esc(strategy.lastAiCommand.personName) + ' iniciou treinamento; previsão de conclusão no dia ' + strategy.lastAiCommand.readyDay
            + '. Dia da ordem: ' + strategy.lastAiCommand.day + '. ' + esc(strategy.lastAiCommand.reason || '') + '</span></div>' : '')
          + (strategy.lastOutcome ? '<div class="note-card"><b>' + esc(strategyOutcomeLabels[strategy.lastOutcome.status] || strategy.lastOutcome.status) + '</b><span>'
            + esc(strategy.lastOutcome.reason || ('Dia ' + strategy.lastOutcome.day)) + '</span></div>' : '')
        : '<p class="quiet">O governante ainda não recebeu um relatório estratégico.</p>';
      const campaign = (world.campaigns || []).find(item => item.status !== 'complete'
        && (item.attackerId === kingdom.id || item.defenderId === kingdom.id));
      let campaignPanel = '<h3>Campanha e logística</h3><p class="quiet">Nenhuma campanha ativa. Uma mobilização exige causa e local de incidente conhecidos pelo reino.</p>';
      if (campaign) {
        const side = campaign.attackerId === kingdom.id ? campaign.attacker : campaign.defender;
        const activeTroops = side.troopIds.map(id => getPerson(id)).filter(Boolean);
        const dailyRation = activeTroops.length * DAILY_FOOD_NEED / FOOD_DAYS_PER_UNIT;
        const foodDays = dailyRation > 0 ? side.supply.stock.food / dailyRation : 0;
        const statusLabels = { mobilizing: 'reunindo suprimentos', marching: 'em marcha', engaged: 'em combate', withdrawing: 'retornando após armistício' };
        const roleLabel = side.role === 'attacker' ? 'força atacante' : 'defesa local';
        const evidence = campaign.evidence && campaign.evidence[side.role] || {};
        const generalOrder = side.aiOrder;
        const generalLabel = generalOrder?.action === 'advance' ? 'avançar ao objetivo'
          : generalOrder?.action === 'hold_position' ? 'manter posição'
            : generalOrder?.action === 'withdraw' ? 'retirada ordenada' : 'ordem por regras';
        const objectiveTower = campaignTower(world, campaign);
        const formation = side.formation;
        const formationStateLabels = { forming: 'formando', marching: 'marchando', maintaining: 'mantendo posição', attacking: 'atacando', retreating: 'retirando' };
        const formationTypeLabel = formation?.type === 'line' ? 'linha' : 'coluna';
        const formationLeader = formation?.leaderId ? getPerson(formation.leaderId)?.name || 'reorganizando' : 'sem líder';
        const recentCampaignEvents = (campaign.history || []).slice(-3).reverse().map(item =>
          '<li>DIA ' + fmt(item.day) + ' · ' + esc(item.text || item.type) + '</li>').join('');
        campaignPanel = '<h3>Campanha e logística</h3>'
          + '<div class="data-row"><span>Missão / estado</span><b>' + esc(roleLabel + ' · ' + (statusLabels[campaign.status] || campaign.status)) + '</b></div>'
          + '<div class="data-row"><span>Objetivo observado</span><b>' + fmt(campaign.target.x, 1) + ', ' + fmt(campaign.target.y, 1) + ' · ' + activeTroops.length + ' soldados · ' + fmt(foodDays, 1) + ' dias de ração</b></div>'
          + (objectiveTower ? '<div class="data-row"><span>Objetivo principal</span><b>' + (side.role === 'attacker' ? campaign.evidence?.mission === 'capture-tower' ? 'Capturar' : 'Destruir' : 'Proteger') + ' · vida ' + fmt(towerVitality(objectiveTower).health) + ' / ' + fmt(towerVitality(objectiveTower).maxHealth) + '</b></div>' : '')
          + '<div class="data-row"><span>Equipamento / lealdade</span><b>' + fmt(side.supply.stock.wood, 1) + ' madeira · ' + fmt(side.supply.stock.gold, 1) + ' ouro · coesão ' + fmt(side.morale, 0) + '%</b></div>'
          + (formation ? '<div class="data-row"><span>Formação / posições</span><b>' + esc(formationTypeLabel) + ' · ' + esc(formationStateLabels[formation.state] || formation.state)
            + ' · líder ' + esc(formationLeader) + ' · coesão ' + Math.round((formation.metrics?.cohesion ?? 1) * 100) + '% · fora dos postos ' + fmt(formation.metrics?.outsideSlots || 0) + '</b></div>' : '')
          + (generalOrder ? '<div class="note-card"><b>Ordem experimental do general · ' + esc(generalLabel) + '</b><span>'
            + 'Justificativa do modelo, não verificada: ' + esc(generalOrder.reason || '') + ' · ' + esc(generalOrder.model || 'modelo local')
            + ' · pedido ' + esc(generalOrder.requestId || 'desconhecido') + ' · versão ' + fmt(generalOrder.version) + ' · dia ' + fmt(generalOrder.assignedDay) + '</span></div>'
            : '<div class="data-row"><span>Plano do general</span><b>Regras determinísticas</b></div>')
          + '<div class="data-row"><span>Motivo / evidência local</span><b>' + esc(campaign.cause) + ' · ' + esc(evidence.source || 'relato da guarnição') + '</b></div>'
          + '<ul class="quiet campaign-events">' + recentCampaignEvents + '</ul>';
      }
      $('inspectEyebrow').textContent = 'REINO · ASSENTAMENTO INICIAL';
      $('inspectTitle').textContent = kingdom.name;
      root.innerHTML = kingdomOverview(world, kingdom) + '<details class="gameplay-details"><summary>Gestão, construção e defesa</summary><div class="data-row"><span>Governante</span><b>' + esc(ruler ? ruler.name : 'sem governante') + '</b></div>' +
        '<div class="data-row"><span>Calendário conhecido pelo reino</span><b>' + (world.day ? esc(seasonNames[calendar.season]) + ' · dia ' + calendar.dayOfSeason + '/' + calendar.daysInSeason + ' · ano ' + calendar.year : 'Primavera · início do ano 1') + '</b></div>' +
        '<div class="data-row"><span>Próxima estação</span><b>' + esc(seasonNames[calendar.nextSeason]) + ' · em ' + calendar.daysUntilNextSeason + ' dias</b></div>' +
        '<div class="data-row"><span>Moradores / com moradia</span><b>' + residents.length + ' / ' + housed + '</b></div>' +
        '<div class="data-row"><span>Casas ocupadas</span><b>' + homes.filter(home => home.residentIds.some(id => getPerson(id))).length + ' de ' + homes.length + ' · capacidade ' + homes.reduce((sum, home) => sum + home.capacity, 0) + '</b></div>' +
        '<div class="data-row"><span>Território controlado</span><b>' + fmt(kingdom.territoryTileCount * .01, 1) + ' hectares · ' + fmt(kingdom.territoryTileCount) + ' células · ' + towers.length + ' torres · ' + frontierTowers.filter(item => item.complete).length + ' postos</b></div>' +
        '<div class="data-row"><span>Classes / comando</span><b>' + ['guerreiro', 'lanceiro', 'arqueiro', 'monge'].map(c => soldiers.filter(p => p.militaryClass === c).length + ' ' + ({ guerreiro: 'infantes', lanceiro: 'lanceiros', arqueiro: 'arqueiros', monge: 'clérigos' })[c]).join(' · ') + '</b></div>' +
        '<div class="data-row"><span>Cadeia de comando</span><b>' + (kingdom.militaryCommand?.generalIds.length || 0) + ' general · ' + (kingdom.militaryCommand?.units.length || 0) + ' unidades de até 10</b></div>' +
        '<div class="data-row"><span>Soldados / vagas</span><b>' + soldiers.length + ' / ' + soldierCapacity + (militaryCenters.length ? ' · ' + militaryCenters.length + ' centros · ' + patrollingSoldiers + ' em patrulha' : ' · sem centro militar') + '</b></div>' +
        '<div class="data-row"><span>Tesouro · alimento / madeira / pedra / ouro</span><b>' + fmt(treasury.food, 0) + ' / ' + fmt(treasury.wood, 0) + ' / ' + fmt(treasury.stone, 0) + ' / ' + fmt(treasury.gold, 0) + '</b></div>' +
        '<div class="data-row"><span>Mercado · alimento / ouro</span><b>' + fmt(market.stock.food, 0) + ' / ' + fmt(market.stock.gold, 0) + '</b></div>' +
        '<div class="data-row"><span>Preços · alimento / madeira / pedra</span><b>' + market.prices.food + ' / ' + market.prices.wood + ' / ' + market.prices.stone + ' ouro</b></div>' +
        '<div class="data-row"><span>Imposto / reserva para seca</span><b>' + Math.round(kingdom.policy.taxRate * 100) + '% / ' + kingdom.policy.droughtReserveDays + ' dias</b></div>' +
        reserveTransferPanel +
        maintenancePanel +
        frontierPanel +
        strategyPanel +
        campaignPanel +
        towerDiplomacyPanel(kingdom) +
        '<h3>Construção e defesa</h3>' +
        constructionStatus + communityConstructionStatus + recruitmentStatus +
        '<div class="kingdom-actions"><button type="button" data-kingdom-command="torre" data-kingdom-id="' + kingdomId + '"' + (activeKingdomProject ? ' disabled' : '') + '>Construir torre · ' + Sim.kingdomCommands.timing.torre + ' dias · 34 madeira · 24 pedra · 8 ouro</button>' +
        '<button type="button" data-kingdom-command="centro_militar" data-kingdom-id="' + kingdomId + '"' + (activeKingdomProject ? ' disabled' : '') + '>Construir centro militar · ' + Sim.kingdomCommands.timing.centro_militar + ' dias · 32 madeira · 30 pedra · 12 ouro</button>' +
        '<button type="button" data-kingdom-command="recruit" data-kingdom-id="' + kingdomId + '"' + (!hasRecruitmentSource('lanceiro') || soldierSlots < 1 ? ' disabled' : '') + '>Recrutar lanceiro · ' + Sim.kingdomCommands.timing.recruit + ' dias · 10 alimento · 8 madeira · 3 ouro</button>' +
        ['guerreiro', 'arqueiro', 'monge'].map(unitClass => '<button type="button" data-kingdom-command="recruit" data-military-class="' + unitClass + '" data-kingdom-id="' + kingdomId + '"' + (!hasRecruitmentSource(unitClass) || soldierSlots < 1 ? ' disabled' : '') + '>Treinar ' + ({ guerreiro: 'infantaria', arqueiro: 'arqueiro', monge: 'clérigo' })[unitClass] + ' · 6 dias · 10 alimento · 8 madeira · 3 ouro</button>').join('') +
        ['monasterio', 'arquearia'].map(building => '<button type="button" data-kingdom-command="' + building + '" data-kingdom-id="' + kingdomId + '"' + (activeKingdomProject ? ' disabled' : '') + '>Construir ' + structureDisplayName(building) + '</button>').join('') + '</div>' +
        (soldierSlots < 1 ? '<p class="quiet">Para recrutar, construa um centro militar com vaga. Cada centro comporta até 60 militares.</p>' : '<p class="quiet">Um centro militar comporta até 60 militares. O recrutamento exige um morador adulto em boas condições. Após a promoção, ele deixa as tarefas civis para cumprir guarda, patrulha e campanha.</p>') +
        (missingMilitarySources.length ? '<p class="quiet">Sem fonte operacional: ' + missingMilitarySources.map(unitClass => esc(MILITARY_SOURCE_LABELS[unitClass === 'guerreiro' ? 'centro_militar' : unitClass === 'arqueiro' ? 'arquearia' : 'monasterio'])).join(' · ') + '. Novos membros e progressão dessas classes ficam pausados.</p>' : '') +
        (pausedRecruitments.length ? '<p class="quiet">Treinamentos pausados: ' + pausedRecruitments.map(person => esc(person.name) + ' — ' + esc(person.recruitmentOrder.pauseReason)).join(' · ') + '. O custo e o progresso são preservados.</p>' : '') +
        '<p class="quiet">Soldo: ' + MILITARY_PAY.copper + ' cobres a cada ' + MILITARY_PAY.days + ' dias, após 30 dias de serviço. Pagamento em moedas reais conforme a disponibilidade do tesouro; obrigações antigas permanecem devidas.</p>' +

        (kingdomActionNotice ? '<div class="note-card kingdom-action-notice" role="status">' + esc(kingdomActionNotice) + '</div>' : '') +

        '<p class="quiet">As casas ficam distribuídas em torno do castelo. As torres estendem o território; os centros militares abrigam os soldados. O mercado e o tesouro mantêm estoques separados.</p></details>';
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
      $('inspectEyebrow').textContent = p.role === 'soldier' ? (p.militaryRank || p.militaryGrade || 'soldado').toUpperCase() + ' · ' + (kingdom ? kingdom.name.toUpperCase() : 'SEM REINO') : kingdom ? 'MORADOR · ' + kingdom.name.toUpperCase() : 'INDIVÍDUO · SEM REINO';
      $('inspectTitle').textContent = p.name;
      root.innerHTML = '<div class="data-row"><span>Estado atual</span><b>' + esc(p.state) + '</b></div>' +
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
        (p.role === 'soldier' ? '<div class="data-row"><span>Estamina</span><b>' + Math.round(p.stamina ?? 100) + ' / 100</b></div>' : '') +
        (p.role === 'soldier' && p.combatDisarmedUntilDay > world.day
          ? '<div class="data-row"><span>Estado de combate</span><b>Desarmado · volta a lutar no dia ' + p.combatDisarmedUntilDay + '</b></div>' : '') +
        (p.role === 'soldier' && p.combatOpening?.expiresDay > world.day
          ? '<div class="data-row"><span>Abertura de parry</span><b>Contra ' + esc(getPerson(p.combatOpening.targetId)?.name || 'oponente') + '</b></div>' : '') +
        (p.role === 'soldier' && p.combatCombo?.lastDay === world.day
          ? '<div class="data-row"><span>Combo</span><b>' + p.combatCombo.count + ' / 3 golpes contra ' + esc(getPerson(p.combatCombo.targetId)?.name || 'oponente') + '</b></div>' : '') +
        (p.militaryClass === 'monge' ? '<div class="data-row"><span>Mana · cura custa 30</span><b>' + Math.round(p.mana ?? 100) + ' / 100</b></div>' : '') +
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
      const labels = { food: 'Alimento', meat: 'Carne', wood: 'Madeira', stone: 'Pedra', gold: 'Ouro', feed: 'Ração' };
      root.innerHTML = Object.entries(pile.resources).filter(([, n]) => n > .001).map(([resource, amount]) =>
        '<div class="data-row"><span>' + esc(labels[resource] || resource) + '</span><b>' + fmt(amount, 1) + '</b></div>').join('')
        + '<p class="quiet">Qualquer pessoa pode recolher os recursos. O limite de carga é de 24 unidades por viagem.</p>';
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
      const structures = world.structures.filter(s => s.communityId === c.id);
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
      const structureText = structures.length ? structures.map(s => s.type + (s.complete ? ' (concluída)' : ' (' + Math.floor(s.progress / s.required * 100) + '%)')).join(', ') : 'Nenhuma construção';
      const groundsText = c.grounds && c.grounds.hunting ? ['caça perto de ' + c.grounds.hunting.feature + ' (' + qualityLabel(c.grounds.hunting.score || 0) + ')'] : [];
      const boundaryCount = structures.filter(s => s.type === 'divisa' && s.complete).length;
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
        '<h3>Construção e área de uso</h3><div class="note-card"><b>' + esc(structureText) + '</b><span>' + activeUse + ' locais usados nos últimos 45 dias. Caçadas bem-sucedidas marcam áreas comunitárias; divisas exigem reservas e trabalho, e cruzá-las consome energia.</span></div>' +
        '<div class="note-card"><b>Áreas, propriedades e divisas</b><span>' + esc(groundsText.join(' · ') || 'Ainda sem áreas de caça marcadas') + (propertyCount ? ' · ' + propertyCount + ' propriedade(s), adquiridas por ouro, madeira e pedra' : '') + (boundaryCount ? ' · ' + boundaryCount + ' divisa(s) concluída(s)' : '') + '</span></div>' +
        '<div class="note-card"><b>Nome comunitário</b><span>' + esc(c.nameSource || 'Os primeiros membros') + ' propôs o nome usando um marco da paisagem local. Uma união pode gerar uma nova votação.</span></div>' +
        (c.history.length ? '<h3>Histórico</h3>' + c.history.slice(-5).reverse().map(item => '<div class="event">' + esc(item) + '</div>').join('') : '');
      return;
    }
    if (selection.kind === 'structure') {
      const s = world.structures.find(item => item.id === selection.id);
      if (!s) { selection = null; renderInspector(); return; }
      const kingdom = getKingdom(s.kingdomId);
      $('inspectEyebrow').textContent = kingdom ? kingdom.name.toUpperCase() : 'CONSTRUÇÃO';
      $('inspectTitle').textContent = s.frontierOutpost ? 'Posto de fronteira' : structureDisplayName(s.type);
      root.innerHTML = buildingCard(world, s) +
        (s.type === 'castelo' && kingdom ? '<button type="button" data-inspect-kingdom="' + kingdom.id + '">Abrir card do reino</button>' : '') +
        (s.type === 'castelo' && kingdom && s.complete && s.destroyedDay == null
          ? '<details class="gameplay-details" open><summary>Casa de câmbio do rei · sem emissão monetária</summary>' +
            '<p>O mercador solicita troco ao castelo. Cada troca exige moedas existentes nos dois cofres. 1 ouro = 10 pratas = 100 cobres.</p>' +
            '<div class="data-row"><span>Tesouro real · ouro / prata / cobre</span><b>' +
              fmt(kingdom.treasury.stock.gold, 0) + ' / ' + fmt(kingdom.treasury.stock.silver || 0, 0) +
              ' / ' + fmt(kingdom.treasury.stock.copper || 0, 0) + '</b></div>' +
            '<div class="data-row"><span>Mercador · ouro / prata / cobre</span><b>' +
              fmt(kingdom.market?.stock?.gold || 0, 0) + ' / ' + fmt(kingdom.market?.stock?.silver || 0, 0) +
              ' / ' + fmt(kingdom.market?.stock?.copper || 0, 0) + '</b></div>' +
            '<div class="kingdom-actions">' +
              [['gold','silver',1,'1 ouro por 10 pratas'], ['gold','copper',1,'1 ouro por 100 cobres'],
                ['silver','copper',1,'1 prata por 10 cobres'], ['silver','gold',10,'10 pratas por 1 ouro'],
                ['copper','silver',10,'10 cobres por 1 prata'], ['copper','gold',100,'100 cobres por 1 ouro']]
                .map(([fromCoin,toCoin,quantity,label]) => '<button type="button" data-castle-exchange="1" data-kingdom-id="' +
                  kingdom.id + '" data-castle-id="' + s.id + '" data-from-coin="' + fromCoin +
                  '" data-to-coin="' + toCoin + '" data-coin-quantity="' + quantity + '">' + label + '</button>').join('') +
            '</div>' +
            (kingdomActionNotice ? '<p class="quiet">' + esc(kingdomActionNotice) + '</p>' : '') + '</details>' : '') +
        (s.type === 'torre' && s.complete && s.destroyedDay == null ? '<details class="gameplay-details"><summary>Ordens militares</summary><div class="kingdom-actions">' + world.kingdoms.filter(k => k.id !== s.kingdomId).map(k => '<button type="button" data-structure-command="capture-tower" data-kingdom-id="' + k.id + '" data-tower-id="' + s.id + '">Rei de ' + esc(k.name) + ': ordenar captura</button>').join('') +
          (kingdom && !s.frontierOutpost ? '<button type="button" data-structure-command="destroy-tower" data-kingdom-id="' + kingdom.id + '" data-tower-id="' + s.id + '">Destruir torre</button>' : '') + '</div></details>' : '') +
        (['centro_militar', 'arquearia', 'monasterio', 'mercado', 'castelo'].includes(s.type) && s.complete && s.destroyedDay == null ? '<details class="gameplay-details"><summary>Ordens militares</summary><div class="kingdom-actions">' + world.kingdoms.filter(k => k.id !== s.kingdomId).map(k => '<button type="button" data-structure-command="attack-installation" data-kingdom-id="' + k.id + '" data-structure-id="' + s.id + '">Rei de ' + esc(k.name) + ': ordenar ataque</button>').join('') + '</div></details>' : '');
      const meter = root.querySelector('.construction-meter');
      if (meter && window.ForjaHUD) meter.append(window.ForjaHUD.create({ size: 'small', color: 'yellow', value: Number(meter.dataset.progress), label: 'Progresso da construção' }));
      return;
    }
    if (selection.kind === 'plant') {
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
    const structure = world.structures.filter(s => s.type === 'divisa'
      ? Math.abs(Math.hypot(s.x - x, s.y - y) - (s.radius || 4)) < .85
      : s.type === 'curral' ? Math.abs(Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) - Math.round(s.radius || 3.5)) < .85
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

    if (!activeMapPointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse' && world) {
        const rect = stage.getBoundingClientRect();
        const point = currentMapCamera().toWorld(event.clientX - rect.left, event.clientY - rect.top);
        const structure = territoryStructureAtMapPosition(point.x / TILE, point.y / TILE);
        const nextHoveredId = structure?.id ?? null;
        const nextHoveringEntity = !!pickEntity(point.x / TILE, point.y / TILE);
        if (nextHoveredId !== hoveredTerritoryStructureId || nextHoveringEntity !== hoveredMapEntity) {
          hoveredTerritoryStructureId = nextHoveredId;
          hoveredMapEntity = nextHoveringEntity;
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
    if (hoveredTerritoryStructureId == null && !hoveredMapEntity) return;
    hoveredTerritoryStructureId = null;
    hoveredMapEntity = false;
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
    const rect = stage.getBoundingClientRect();
    const point = currentMapCamera().toWorld(event.clientX - rect.left, event.clientY - rect.top);
    const mapX = point.x / TILE;
    const mapY = point.y / TILE;
    if (mapX >= 0 && mapX < W && mapY >= 0 && mapY < H) openSelection(pickEntity(mapX, mapY));
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
  $('settingsClose').addEventListener('click', () => setSettingsPanel(false));
  $('environmentToggle').addEventListener('click', () => {
    const open = !$('mapTags').classList.contains('is-open');
    $('mapTags').classList.toggle('is-open', open);
    $('environmentToggle').setAttribute('aria-expanded', String(open));
  });
  $('journalToggle').addEventListener('click', () => {
    const panel = $('journal'), open = panel.hidden;
    if (open) { setKingdomPanel(false); setSettingsPanel(false); showRight = false; $('rightPanel').classList.remove('is-open'); }
    panel.hidden = !open; $('journalToggle').setAttribute('aria-expanded', String(open));
    syncPanelAccess();
  });
  $('journalClose').addEventListener('click', () => { $('journal').hidden = true; $('journalToggle').setAttribute('aria-expanded', 'false'); });
  $('leftClose').addEventListener('click', () => setKingdomPanel(false));
  $('rightClose').addEventListener('click', () => {
    showRight = false; $('rightPanel').classList.remove('is-open');
    syncPanelAccess();
  });
  window.addEventListener('keydown', event => {

    if (event.key !== 'Escape') return;
    setKingdomPanel(false); setSettingsPanel(false);
    $('journal').hidden = true; $('journalToggle').setAttribute('aria-expanded', 'false');
    $('mapTags').classList.remove('is-open'); $('environmentToggle').setAttribute('aria-expanded', 'false');
    showRight = false; $('rightPanel').classList.remove('is-open');
    syncPanelAccess();
  });


  $('kingdomList').addEventListener('click', e => {
    const button = e.target.closest('[data-kingdom]');
    if (button) { setKingdomPanel(false); openSelection({ kind: 'kingdom', id: Number(button.dataset.kingdom) }); }
  });
  $('inspector').addEventListener('click', event => {
    const inspectStructure = event.target.closest('[data-inspect-structure]');
    if (inspectStructure) { openSelection({ kind: 'structure', id: Number(inspectStructure.dataset.inspectStructure) }); return; }
    const inspectKingdom = event.target.closest('[data-inspect-kingdom]');
    if (inspectKingdom) { openSelection({ kind: 'kingdom', id: Number(inspectKingdom.dataset.inspectKingdom) }); return; }
    const castleButton = event.target.closest('[data-castle-exchange]');
    if (castleButton) {
      const request = {
        type: 'castle-exchange',
        kingdomId: Number(castleButton.dataset.kingdomId),
        castleId: Number(castleButton.dataset.castleId),
        fromCoin: castleButton.dataset.fromCoin,
        toCoin: castleButton.dataset.toCoin,
        quantity: Number(castleButton.dataset.coinQuantity)
      };
      session.dispatch(request).then(result => {
        kingdomActionNotice = result?.ok
          ? 'Troca autorizada: ' + result.quantity + ' ' + result.fromCoin +
            ' por ' + result.received + ' ' + result.toCoin +
            '. Valor e saldos conservados.'
          : result?.reason || 'O castelo recusou a troca.';
        render();
      }).catch(error => {
        if (isResetCancellation(error)) return;
        kingdomActionNotice = error.message; render();
      });
      return;
    }
    const button = event.target.closest('[data-kingdom-command], [data-structure-command]');
    if (!button) return;
    if (button.dataset.structureCommand === 'attack-installation') {
      session.dispatch({ type: 'attack-installation', kingdomId: Number(button.dataset.kingdomId), structureId: Number(button.dataset.structureId) }).then(result => {
        if (result?.ok) gameAudio.play('war_call', `war-call:installation:${button.dataset.kingdomId}:${button.dataset.structureId}:${Date.now()}`, world.kingdoms.find(item => item.id === Number(button.dataset.kingdomId)));
        selection = { kind: 'kingdom', id: Number(button.dataset.kingdomId) };
        kingdomActionNotice = result?.ok ? 'O rei ordenou o ataque à instalação. A tropa será mobilizada com suprimentos para o cerco.' : result?.reason || 'Não foi possível ordenar o ataque.';
        render();
      }).catch(error => { if (!isResetCancellation(error)) { kingdomActionNotice = error.message; render(); } });
      return;
    }
    if (button.dataset.structureCommand === 'capture-tower') {
      session.dispatch({ type: 'capture-tower', kingdomId: Number(button.dataset.kingdomId), towerId: Number(button.dataset.towerId) }).then(result => {
        if (result?.ok) gameAudio.play('war_call', `war-call:capture:${button.dataset.kingdomId}:${button.dataset.towerId}:${Date.now()}`, world.kingdoms.find(item => item.id === Number(button.dataset.kingdomId)));
        selection = { kind: 'kingdom', id: Number(button.dataset.kingdomId) };
        kingdomActionNotice = result?.ok ? 'O rei ordenou a captura. A tropa será mobilizada com suprimentos para tomar a torre.' : result?.reason || 'Não foi possível ordenar a captura.';
        render();
      }).catch(error => { if (!isResetCancellation(error)) { kingdomActionNotice = error.message; render(); } });
      return;
    }
    if (button.dataset.structureCommand === 'destroy-tower') {
      const kingdomId = Number(button.dataset.kingdomId), towerId = Number(button.dataset.towerId);
      session.dispatch({ type: 'destroy-tower', kingdomId, towerId }).then(result => {
        selection = { kind: 'kingdom', id: kingdomId };
        kingdomActionNotice = result && result.ok
          ? 'Torre destruída. O domínio encolheu em ' + fmt(result.territoryTilesLost) + ' células.'
          : result && result.reason || 'A torre não pôde ser destruída.';
        render();
      }).catch(error => {
        if (isResetCancellation(error)) return;
        kingdomActionNotice = 'A ordem falhou: ' + error.message;
        render();
      });
      return;
    }
    const kingdomId = Number(button.dataset.kingdomId);
    const command = button.dataset.kingdomCommand;
    const request = command.startsWith('recruit')
      ? { type: 'recruit-soldier', kingdomId, militaryClass: button.dataset.militaryClass || 'lanceiro' }
      : { type: 'kingdom-structure', kingdomId, building: command };
    session.dispatch(request).then(result => {
      if (!result || !result.ok) kingdomActionNotice = result && result.reason || 'A ordem não foi concluída.';
      else if (command.startsWith('recruit')) kingdomActionNotice = result.pending
        ? result.person.name + ' começou treinamento; o tesouro pagou alimento, madeira e ouro. Pronto no dia ' + result.readyDay + '.'
        : result.person.name + ' foi recrutado como lanceiro. O tesouro pagou alimento, madeira e ouro.';
      else kingdomActionNotice = ('Construção iniciada: ' + structureDisplayName(command) + '.')
        + ' Os recursos foram debitados. Trabalho necessário: ' + result.structure.required + ' dias no local.';
      render();
    }).catch(error => {
      if (isResetCancellation(error)) return;
      kingdomActionNotice = 'A ordem falhou: ' + error.message;
      render();
    });
  });

  let lastAnimationFrame = 0;
  function frame(now) {
    const profile = renderDiagnostics.profiler.beginFrame(now);
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
