const LOCAL_AI_PREFERENCE_KEY = 'kingdom.localAi.enabled';

export function readLocalAiPreference(storage) {
  return storage.getItem(LOCAL_AI_PREFERENCE_KEY) === 'true';
}

export function writeLocalAiPreference(storage, enabled) {
  storage.setItem(LOCAL_AI_PREFERENCE_KEY, String(enabled));
}
