// JUL-278: UI-only adapter for lazy, versioned Worker actor inspection.
// No world mutation, no global cache: only one selected actor/revision is kept.
// The authoritative Worker still owns cognition, perception and memories.
function selectedContext(session, readSelection, readWorld) {
  const selection = readSelection(), world = readWorld();
  if (!world || !selection || (selection.kind !== 'person' && selection.kind !== 'animal')
    || !Number.isSafeInteger(selection.id)) return null;
  const {kind, id} = selection;
  const epoch=session.epoch, revision=session.revision, day=world.day;
  return {kind, id, epoch, revision, day,
    key: [epoch, revision, day, kind, id].join(':')};
}

export function isCurrentInspectorResponse(context, result) {
  return !!context && !!result && result.epoch === context.epoch
    && Number.isSafeInteger(result.revision) && result.revision >= context.revision
    && result.day === context.day && result.kind === context.kind
    && result.actorId === context.id
    && (result.actor == null || result.actor.id === context.id);
}

/**
 * A session query can finish after a user clicks another NPC, after reset or
 * after the Worker advances. A completion is displayed only if every identity,
 * epoch and materialized revision still matches the current selection.
 *
 * The live snapshot remains a fallback until the optional presentation DTO
 * transition is proven safe; the cached detail never replaces game.world.
 */
export function createActorInspectorDetails({session, readSelection, readWorld, onDetail, onError = () => {}}) {
  let generation = 0;
  let activeKey = null;
  let pendingKey = null;
  let completedKey = null;
  let detailedActor = null;
  let failedKey = null;
  let queries = 0, discarded = 0;

  const context = () => selectedContext(session, readSelection, readWorld);

  function invalidate() {
    generation++;
    activeKey = null;
    pendingKey = null;
    completedKey = null;
    detailedActor = null;
    failedKey = null;
  }

  function read(kind, id) {
    const current = context();
    if (!current || current.kind !== kind || current.id !== id) return null;
    if (current.key !== activeKey) {
      generation++;
      activeKey = current.key;
      pendingKey = null;
      completedKey = null;
      failedKey = null;
      detailedActor = null;
    }
    if (completedKey === current.key) return detailedActor;
    if (pendingKey === current.key || failedKey === current.key) return null;

    const queryGeneration = generation, requested = current;
    pendingKey = requested.key;
    queries++;
    let request;
    try {
      request = kind === 'person' ? session.inspectPerson(id) : session.inspectAnimal(id);
    } catch (error) { request = Promise.reject(error); }
    Promise.resolve(request).then(result => {
      if (queryGeneration !== generation || context()?.key !== requested.key
        || !isCurrentInspectorResponse(requested, result)) {
        discarded++;
        return;
      }
      pendingKey = null;
      completedKey = requested.key;
      detailedActor = result.actor;
      onDetail?.();
    }).catch(error => {
      if (queryGeneration !== generation || context()?.key !== requested.key) {
        discarded++;
        return;
      }
      pendingKey = null;
      failedKey = requested.key; // Never retry a broken request every render frame.
      if (error?.name !== 'AbortError') onError(error);
    });
    return null;
  }

  return {
    read, invalidate,
    snapshot: () => ({
      activeKey, pendingKey, completedKey, failedKey,
      queries, discarded
    })
  };
}
