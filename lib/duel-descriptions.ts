/**
 * Localized map and mode descriptions.
 *
 * The duel catalogue in `lib/duel-maps.ts` and `lib/duel-modes.ts` is the
 * English source of truth. This module provides the RU/UA/EN/PL wording that
 * describes the same current rules, so every surface (map cards, mode picker,
 * REAL/DEMO match creation and the match page) can show a description in the
 * active language instead of a short English phrase.
 */
import { DUEL_MODES, type DuelModeId } from "@/lib/duel-modes";

export type DescriptionLanguage = "RU" | "UA" | "EN" | "PL";

const MAP_DESCRIPTIONS: Record<DescriptionLanguage, Record<string, string>> = {
  RU: {
    aim_redline: "Быстрая симметричная арена для дуэлей один на один.",
    aim_dust2: "Компактная арена в стиле Dust2, созданная специально для 1v1.",
    pool_day: "Классическая арена у бассейна с тесными линиями видимости и ностальгией CS.",
    one_v_one_aim_map: "Симметричная арена для быстрых аим-боёв 1v1.",
    minecraft_aim_map: "Аренка в стиле Minecraft для быстрых дуэлей 1v1.",
    aim_cache: "Арена в стиле Cache для быстрых дуэлей один на один.",
    fy_snow: "Компактная снежная арена для быстрых схваток.",
    one_vs_one_aim_map_arena: "Круглая арена в пустынном стиле для прямых боёв 1v1.",
    one_v_one_anubis_aim: "Арена в египетском стиле для коротких соревновательных дуэлей.",
    aim_halloween_1v1: "Арена в хеллоуинском стиле для атмосферы Halloween.",
  },
  UA: {
    aim_redline: "Швидка симетрична арена для двобоїв один на один.",
    aim_dust2: "Компактна арена у стилі Dust2, створена спеціально для 1v1.",
    pool_day: "Класична арена біля басейну з тісними лініями видимості та ностальгією CS.",
    one_v_one_aim_map: "Симетрична арена для швидких аім-боїв 1v1.",
    minecraft_aim_map: "Арена у стилі Minecraft для швидких дуелей 1v1.",
    aim_cache: "Арена у стилі Cache для швидких двобоїв один на один.",
    fy_snow: "Компактна сніжна арена для швидких сутичок.",
    one_vs_one_aim_map_arena: "Кругла арена в пустельному стилі для прямих боїв 1v1.",
    one_v_one_anubis_aim: "Арена в єгипетському стилі для коротких змагальних дуелей.",
    aim_halloween_1v1: "Арена в хеллоуїнському стилі для атмосфери Halloween.",
  },
  EN: {
    aim_redline: "Fast symmetrical aim arena for head-to-head duels.",
    aim_dust2: "Compact Dust2-style arena built specifically for 1v1.",
    pool_day: "Classic pool arena with tight sightlines and nostalgic CS gameplay.",
    one_v_one_aim_map: "Symmetrical arena made for fast 1v1 aim battles.",
    minecraft_aim_map: "Minecraft-themed aim arena for fast 1v1 duels.",
    aim_cache: "Cache-inspired aim arena for fast head-to-head duels.",
    fy_snow: "Compact snowy fight-yard style arena for quick duels.",
    one_vs_one_aim_map_arena: "Circular desert-style arena designed for direct 1v1 fights.",
    one_v_one_anubis_aim: "Anubis-themed aim arena for short competitive duels.",
    aim_halloween_1v1: "Halloween-themed aim arena for a different duel atmosphere.",
  },
  PL: {
    aim_redline: "Szybka symetryczna arena strzelecka do pojedynków jeden na jeden.",
    aim_dust2: "Kompaktowa arena w stylu Dust2 stworzona specjalnie pod 1v1.",
    pool_day: "Klasyczna arena przy basenie z ciasnymi liniami widzenia i nostalgiczną grą CS.",
    one_v_one_aim_map: "Symetryczna arena do szybkich strzelań 1v1.",
    minecraft_aim_map: "Arena w motywie Minecraft do szybkich pojedynków 1v1.",
    aim_cache: "Arena w stylu Cache do szybkich pojedynków jeden na jeden.",
    fy_snow: "Kompaktowa śnieżna arena do szybkich starć.",
    one_vs_one_aim_map_arena: "Okrągła arena w stylu pustynnym do bezpośrednich walk 1v1.",
    one_v_one_anubis_aim: "Arena w motywie Anubisa do krótkich rywalizacyjnych pojedynków.",
    aim_halloween_1v1: "Arena w motywie Halloween dla innego klimatu pojedynku.",
  },
};

const MODE_DESCRIPTIONS: Record<DescriptionLanguage, Record<DuelModeId, string>> = {
  RU: {
    SOLO_1V1: "Классическая дуэль 1v1 со стандартным арсеналом и полным уроном.",
    AWP_ONLY: "Только AWP: один выстрел решает раунд, попадание в голову — победа.",
    DEAGLE_ONLY: "Только Desert Eagle: точный прицел решает каждый раунд.",
    KNIFE_ONLY: "Только нож: ближний бой, где решает скорость реакции.",
    HEADSHOT_ONLY: "Только хедшоты: урон начисляется только за попадание в голову.",
    RANDOM_WEAPON: "Случайное оружие: перед стартом случайно выдаётся один тип оружия и категория.",
    FIRST_TO_10: "Дуэль до 10 фрагов: побеждает первый, кто набирает 10 убийств.",
    GRENADE_ONLY: "Только гранаты: 12 гранат (3 HE, 3 флеш, 3 дым, 3 молотов) выдаются в начале раунда. После смерти и респавна сохраняется точный остаток каждого типа в текущем раунде, без пополнения; набор сбрасывается только с началом нового раунда. Нож выдаётся после расхода всех гранат.",
    LOW_GRAVITY: "Пониженная гравитация. Режим доступен только на картах с подтверждённым профилем безопасности.",
    SPEED_DUEL: "Повышенная скорость передвижения игрока. Настройки активируются после подтверждения конфигурации всеми тремя серверами.",
  },
  UA: {
    SOLO_1V1: "Класичний двобій 1v1 зі стандартним набором зброї та повним уроном.",
    AWP_ONLY: "Лише AWP: один постріл вирішує раунд, влучання в голову — перемога.",
    DEAGLE_ONLY: "Лише Desert Eagle: точний приціл вирішує кожен раунд.",
    KNIFE_ONLY: "Лише ніж: ближній бій, де вирішує швидкість реакції.",
    HEADSHOT_ONLY: "Лише хедшоти: урон нараховується тільки за попадання в голову.",
    RANDOM_WEAPON: "Випадкова зброя: перед стартом випадково видається один тип зброї та категорія.",
    FIRST_TO_10: "Двобій до 10 фрагів: перемагає перший, хто набирає 10 вбивств.",
    GRENADE_ONLY: "Лише гранати: 12 гранат (3 HE, 3 флеш, 3 дім, 3 молотов) видаються на початку раунду. Після смерті та респавну зберігається точний залишок кожного типу в поточному раунді, без поповнення; набір скидається лише з початком нового раунду. Ніж видається після витрати всіх гранат.",
    LOW_GRAVITY: "Знижена гравітація. Режим доступний лише на мапах із підтвердженим профілем безпеки.",
    SPEED_DUEL: "Підвищена швидкість пересування гравця. Налаштування активуються після підтвердження конфігурації всіма трьома серверами.",
  },
  EN: {
    SOLO_1V1: "Classic 1v1 duel with the standard arsenal and full damage.",
    AWP_ONLY: "AWP only: one shot decides the round, a headshot wins it.",
    DEAGLE_ONLY: "Desert Eagle only: precise aim decides every round.",
    KNIFE_ONLY: "Knife only: close combat where reaction speed decides.",
    HEADSHOT_ONLY: "Headshots only: damage is only counted for a hit to the head.",
    RANDOM_WEAPON: "Random weapon: one weapon type and category are drawn before the start.",
    FIRST_TO_10: "Duel to 10 frags: the first player to reach 10 kills wins.",
    GRENADE_ONLY: "Grenades only: 12 grenades (3 HE, 3 flash, 3 smoke, 3 molotov) are granted at the start of a round. After a death and respawn the exact remainder of every type is kept for the current round without a refill; only a new round resets the kit. The knife is granted once every grenade is spent.",
    LOW_GRAVITY: "Reduced gravity. Available only on maps with a verified safety profile.",
    SPEED_DUEL: "Increased player movement speed. Settings activate only after all three servers confirm the configuration.",
  },
  PL: {
    SOLO_1V1: "Klasyczny pojedynek 1v1 ze standardowym arsenałem i pełnymi obrażeniami.",
    AWP_ONLY: "Tylko AWP: jeden strzał rozstrzyga rundę, strzał w głowę daje zwycięstwo.",
    DEAGLE_ONLY: "Tylko Desert Eagle: celność decyduje o każdej rundzie.",
    KNIFE_ONLY: "Tylko nóż: walka w zwarciu, w której liczy się szybkość reakcji.",
    HEADSHOT_ONLY: "Tylko headshoty: obrażenia naliczane są wyłącznie za trafienie w głowę.",
    RANDOM_WEAPON: "Losowa broń: przed startem losowo przydzielany jest jeden rodzaj broni i kategoria.",
    FIRST_TO_10: "Pojedynek do 10 fragów: wygrywa pierwszy gracz, który zdobędzie 10 killi.",
    GRENADE_ONLY: "Tylko granaty: 12 granatów (3 HE, 3 flash, 3 smoke, 3 molotov) jest przyznawanych na początku rundy. Po śmierci i respawnie pozostaje dokładna reszta każdego typu w bieżącej rundzie, bez uzupełniania; zestaw resetuje się dopiero z początkiem nowej rundy. Nóż jest przyznawany po zużyciu wszystkich granatów.",
    LOW_GRAVITY: "Obniżona grawitacja. Tryb jest dostępny wyłącznie na mapach ze zweryfikowanym profilem bezpieczeństwa.",
    SPEED_DUEL: "Zwiększona prędkość poruszania gracza. Ustawienia aktywują się po potwierdzeniu konfiguracji przez wszystkie trzy serwery.",
  },
};

const MODE_LABELS: Record<DescriptionLanguage, Record<DuelModeId, string>> = {
  RU: {
    SOLO_1V1: "Classic",
    AWP_ONLY: "Только AWP",
    DEAGLE_ONLY: "Только Desert Eagle",
    KNIFE_ONLY: "Только нож",
    HEADSHOT_ONLY: "Только в голову",
    RANDOM_WEAPON: "Случайное оружие",
    FIRST_TO_10: "До 10 убийств",
    GRENADE_ONLY: "Только гранаты",
    LOW_GRAVITY: "Low Gravity",
    SPEED_DUEL: "Speed Duel",
  },
  UA: {
    SOLO_1V1: "Classic",
    AWP_ONLY: "Лише AWP",
    DEAGLE_ONLY: "Лише Desert Eagle",
    KNIFE_ONLY: "Лише ніж",
    HEADSHOT_ONLY: "Лише в голову",
    RANDOM_WEAPON: "Випадкова зброя",
    FIRST_TO_10: "До 10 вбивств",
    GRENADE_ONLY: "Лише гранати",
    LOW_GRAVITY: "Low Gravity",
    SPEED_DUEL: "Speed Duel",
  },
  EN: {
    SOLO_1V1: "Classic",
    AWP_ONLY: "AWP Only",
    DEAGLE_ONLY: "Deagle Only",
    KNIFE_ONLY: "Knife Only",
    HEADSHOT_ONLY: "Headshot Only",
    RANDOM_WEAPON: "Random Weapon",
    FIRST_TO_10: "First to 10",
    GRENADE_ONLY: "Grenade Only",
    LOW_GRAVITY: "Low Gravity",
    SPEED_DUEL: "Speed Duel",
  },
  PL: {
    SOLO_1V1: "Classic",
    AWP_ONLY: "Tylko AWP",
    DEAGLE_ONLY: "Tylko Desert Eagle",
    KNIFE_ONLY: "Tylko nóż",
    HEADSHOT_ONLY: "Tylko w głowę",
    RANDOM_WEAPON: "Losowa broń",
    FIRST_TO_10: "Do 10 fragów",
    GRENADE_ONLY: "Tylko granaty",
    LOW_GRAVITY: "Low Gravity",
    SPEED_DUEL: "Speed Duel",
  },
};

const MODE_HEADER_LABELS: Partial<Record<DuelModeId, string>> = {
  SOLO_1V1: "Classic",
};

function localeOf(language: string | null | undefined): DescriptionLanguage {
  return language === "RU" || language === "UA" || language === "EN" || language === "PL" ? language : "EN";
}

/** Localized description of a duel map; falls back to the catalogue text. */
export function mapDescription(language: string | null | undefined, mapId: string | null | undefined, fallback = ""): string {
  if (!mapId) return fallback;
  return MAP_DESCRIPTIONS[localeOf(language)][mapId] ?? fallback;
}

/** Localized description of a duel mode; falls back to the catalogue text. */
export function modeDescription(language: string | null | undefined, modeId: string | null | undefined, fallback = ""): string {
  if (!modeId) return fallback;
  const key = (DUEL_MODES.find(mode => mode.id === modeId)?.id ?? modeId) as DuelModeId;
  return MODE_DESCRIPTIONS[localeOf(language)][key] ?? fallback;
}

/** Localized mode label (the English label is the source of truth). */
export function modeLabel(language: string | null | undefined, modeId: string | null | undefined, fallback = ""): string {
  const mode = DUEL_MODES.find(item => item.id === modeId);
  if (!mode) return fallback;
  return MODE_LABELS[localeOf(language)][mode.id] ?? mode.label;
}

export function modeHeaderLabel(language: string | null | undefined, modeId: string | null | undefined, fallback = ""): string {
  const mode = DUEL_MODES.find(item => item.id === modeId);
  if (!mode) return fallback;
  return MODE_HEADER_LABELS[mode.id] ?? MODE_LABELS[localeOf(language)][mode.id] ?? mode.label;
}
