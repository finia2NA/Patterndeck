import { useSettingsStore, setLocalSetting } from '@/hooks/state/persistent/settingsStore';
import { setSetting } from '@/lib/api';

export function useTutorial(key: string) {
  const settingKey = `tutorial_done_${key}`;
  const value = useSettingsStore(state => state.settings[settingKey]);
  const hydrated = useSettingsStore(state => state.hydrated);

  function onDone() {
    setLocalSetting(settingKey, 'true');
    setSetting(settingKey, 'true').catch(() => {});
  }

  return { visible: hydrated && value !== 'true', onDone };
}

const TUTORIAL_KEYS = ['home', 'deck_creation', 'editor'];

export async function resetAllTutorials() {
  // Update local store synchronously so UI reacts immediately
  for (const key of TUTORIAL_KEYS) {
    setLocalSetting(`tutorial_done_${key}`, 'false');
  }
  // Persist to server in the background
  await Promise.all(TUTORIAL_KEYS.map(key =>
    setSetting(`tutorial_done_${key}`, 'false')
  ));
}
