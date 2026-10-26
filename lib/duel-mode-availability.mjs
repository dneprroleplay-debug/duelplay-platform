export const ADVANCED_DUEL_MODE_IDS = Object.freeze(["LOW_GRAVITY", "SPEED_DUEL"]);

/**
 * Validate and index the intentionally small public response from GET /api/game-modes.
 * Malformed responses fail closed for advanced modes.
 */
export function indexPublicGameModeAvailability(payload) {
  if (!payload || payload.ok !== true || !Array.isArray(payload.maps)) return null;
  const indexed = Object.create(null);
  for (const item of payload.maps) {
    if (!item || typeof item.mapId !== "string" || !item.modes || typeof item.modes !== "object" || Array.isArray(item.modes)) continue;
    const entries = Object.create(null);
    for (const [modeId, status] of Object.entries(item.modes)) {
      if (status && typeof status === "object" && typeof status.available === "boolean") {
        entries[modeId] = { available: status.available, reason: typeof status.reason === "string" ? status.reason : null };
      }
    }
    indexed[item.mapId] = entries;
  }
  return Object.keys(indexed).length ? indexed : null;
}

export async function loadPublicGameModeAvailability() {
  try {
    const response = await fetch("/api/game-modes", { cache: "no-store" });
    if (!response.ok) return null;
    return indexPublicGameModeAvailability(await response.json());
  } catch {
    return null;
  }
}

/** Preserve the eight legacy modes as a fallback; advanced modes fail closed. */
export function isDuelModeAvailable(availability, mapId, modeId, mapSupported) {
  if (mapSupported !== true) return false;
  if (!availability) return !ADVANCED_DUEL_MODE_IDS.includes(modeId);
  const mapAvailability = availability[mapId];
  if (!mapAvailability || !mapAvailability[modeId]) return !ADVANCED_DUEL_MODE_IDS.includes(modeId);
  return mapAvailability[modeId].available === true;
}

/** Localized explanation for advanced modes that are still gated by the central config. */
export function advancedModeAvailabilityHint(language, mapModes, loaded = true) {
  if (!loaded) return "";
  if (!mapModes) {
    const copy = {
      RU: "Не удалось проверить конфигурацию новых режимов: Speed Duel и Low Gravity временно заблокированы.",
      UA: "Не вдалося перевірити конфігурацію нових режимів: Speed Duel і Low Gravity тимчасово заблоковані.",
      PL: "Nie można sprawdzić konfiguracji nowych trybów: Speed Duel i Low Gravity są tymczasowo zablokowane.",
      EN: "The new mode configuration could not be verified; Speed Duel and Low Gravity are temporarily locked.",
    };
    return copy[language] || copy.EN;
  }

  const locale = ["RU", "UA", "PL", "EN"].includes(language) ? language : "EN";
  const copy = {
    RU: {
      safety: "Low Gravity требует подтверждённого профиля безопасности выбранной карты.",
      disabledLow: "Low Gravity выключен в активной конфигурации.",
      mapLow: "Low Gravity не разрешён на выбранной карте.",
      disabledSpeed: "Speed Duel включается в Control Center и станет доступен после публикации конфигурации и подтверждения всех трёх серверов.",
      mapSpeed: "Speed Duel не разрешён на выбранной карте.",
      unavailable: "Доступность новых режимов сейчас не подтверждена.",
    },
    UA: {
      safety: "Low Gravity потребує підтвердженого профілю безпеки вибраної мапи.",
      disabledLow: "Low Gravity вимкнено в активній конфігурації.",
      mapLow: "Low Gravity не дозволений на вибраній мапі.",
      disabledSpeed: "Speed Duel вмикається в Control Center і стане доступним після публікації конфігурації та підтвердження всіма трьома серверами.",
      mapSpeed: "Speed Duel не дозволений на вибраній мапі.",
      unavailable: "Доступність нових режимів наразі не підтверджена.",
    },
    PL: {
      safety: "Low Gravity wymaga zweryfikowanego profilu bezpieczeństwa wybranej mapy.",
      disabledLow: "Low Gravity jest wyłączony w aktywnej konfiguracji.",
      mapLow: "Low Gravity nie jest dozwolony na wybranej mapie.",
      disabledSpeed: "Speed Duel należy włączyć w Control Center; będzie dostępny po opublikowaniu konfiguracji i potwierdzeniu przez wszystkie trzy serwery.",
      mapSpeed: "Speed Duel nie jest dozwolony na wybranej mapie.",
      unavailable: "Dostępność nowych trybów nie została potwierdzona.",
    },
    EN: {
      safety: "Low Gravity requires a verified safety profile for the selected map.",
      disabledLow: "Low Gravity is disabled in the active configuration.",
      mapLow: "Low Gravity is not allowed on the selected map.",
      disabledSpeed: "Enable Speed Duel in Control Center; it becomes available after publishing the configuration and receiving confirmation from all three servers.",
      mapSpeed: "Speed Duel is not allowed on the selected map.",
      unavailable: "The new mode availability is not currently confirmed.",
    },
  }[locale];

  const hints = [];
  const low = mapModes.LOW_GRAVITY;
  if (!low?.available) {
    if (low?.reason === "SAFETY_PROFILE_REQUIRED") hints.push(copy.safety);
    else if (low?.reason === "MODE_DISABLED") hints.push(copy.disabledLow);
    else if (low?.reason === "MAP_NOT_ALLOWED" || low?.reason === "MAP_UNSUPPORTED") hints.push(copy.mapLow);
    else hints.push(copy.unavailable);
  }
  const speed = mapModes.SPEED_DUEL;
  if (!speed?.available) {
    if (speed?.reason === "MODE_DISABLED") hints.push(copy.disabledSpeed);
    else if (speed?.reason === "MAP_NOT_ALLOWED" || speed?.reason === "MAP_UNSUPPORTED") hints.push(copy.mapSpeed);
    else hints.push(copy.unavailable);
  }
  return [...new Set(hints)].join(" ");
}
