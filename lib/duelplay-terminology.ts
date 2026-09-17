export type DuelPlayLanguage = "RU" | "UA" | "EN" | "PL";

type Entry = Record<DuelPlayLanguage, string>;

// Product terminology: these are deliberate DuelPlay translations, not generic
// machine translations. Keep this list small and add a term only when its
// product meaning matters. English is the canonical source.
export const DUELPLAY_TERMINOLOGY: Record<string, Entry> = {
  "Case": { RU: "Кейс", UA: "Кейс", EN: "Case", PL: "Skrzynia" },
  "Cases": { RU: "Кейсы", UA: "Кейси", EN: "Cases", PL: "Skrzynie" },
  "Choose a map": { RU: "Выберите карту", UA: "Обери карту", EN: "Choose a map", PL: "Wybierz mapę" },
  "Cases — open and claim an item": { RU: "Кейсы — открой и забери предмет", UA: "Кейси — відкрий і забери предмет", EN: "Cases — open and claim an item", PL: "Skrzynie — otwórz i odbierz przedmiot" },
  "DuelPlay Cases": { RU: "Кейсы DuelPlay", UA: "Кейси DuelPlay", EN: "DuelPlay Cases", PL: "Skrzynie DuelPlay" },
  "DUELPLAY CASES": { RU: "КЕЙСЫ DUELPLAY", UA: "КЕЙСИ DUELPLAY", EN: "DUELPLAY CASES", PL: "SKRZYNIE DUELPLAY" },
  "CASE": { RU: "КЕЙС", UA: "КЕЙС", EN: "CASE", PL: "SKRZYNIA" },
  "Starter Case": { RU: "Стартовый кейс", UA: "Стартовий кейс", EN: "Starter Case", PL: "Starter Case" },
  "A quick chance to get your first DuelPlay item.": { RU: "Быстрый шанс получить первый предмет DuelPlay.", UA: "Швидкий шанс отримати перший предмет DuelPlay.", EN: "A quick chance to get your first DuelPlay item.", PL: "Szybka szansa na zdobycie pierwszego przedmiotu DuelPlay." },
  "Neon Duel Case": { RU: "Неоновый кейс Duel", UA: "Неоновий кейс Duel", EN: "Neon Duel Case", PL: "Neonowy case Duel" },
  "A neon case with rare rewards.": { RU: "Неоновый кейс с редкими наградами.", UA: "Неоновий кейс із рідкісними нагородами.", EN: "A neon case with rare rewards.", PL: "Neonowa skrzynia z rzadkimi nagrodami." },
  "Premium Arsenal": { RU: "Премиальный арсенал", UA: "Преміальний арсенал", EN: "Premium Arsenal", PL: "Premiumowy arsenał" },
  "A premium case for hunters of rare items.": { RU: "Премиальный кейс для охотников за редкими предметами.", UA: "Преміальний кейс для мисливців за рідкісними предметами.", EN: "A premium case for hunters of rare items.", PL: "Premiumowa skrzynia dla łowców rzadkich przedmiotów." },
  "Open Case": { RU: "Открыть кейс", UA: "Відкрити кейс", EN: "Open Case", PL: "Otwórz skrzynię" },
  "My Inventory": { RU: "Мой инвентарь", UA: "Мій інвентар", EN: "My Inventory", PL: "Mój ekwipunek" },
  "Chat": { RU: "Чат", UA: "Чат", EN: "Chat", PL: "Czat" },
  "Duel": { RU: "Дуэль", UA: "Дуель", EN: "Duel", PL: "Pojedynek" },
  "Match": { RU: "Матч", UA: "Матч", EN: "Match", PL: "Mecz" },
  "Matches": { RU: "Матчи", UA: "Матчі", EN: "Matches", PL: "Mecze" },
  "Stake": { RU: "Ставка", UA: "Ставка", EN: "Stake", PL: "Stawka" },
  "Rating": { RU: "Рейтинг", UA: "Рейтинг", EN: "Rating", PL: "Ranking" },
  "Reputation": { RU: "Репутация", UA: "Репутація", EN: "Reputation", PL: "Reputacja" },
  "Profile": { RU: "Профиль", UA: "Профіль", EN: "Profile", PL: "Profil" },
  "Privacy": { RU: "Приватность", UA: "Приватність", EN: "Privacy", PL: "Prywatność" },
  "Challenges": { RU: "Испытания", UA: "Виклики", EN: "Challenges", PL: "Wyzwania" },
  "Leagues": { RU: "Лиги", UA: "Ліги", EN: "Leagues", PL: "Ligi" },
  "Cosmetic Shop": { RU: "Магазин косметики", UA: "Магазин косметики", EN: "Cosmetic Shop", PL: "Sklep z kosmetykami" },
  "XP Boosters": { RU: "Бустеры XP", UA: "Бустери XP", EN: "XP Boosters", PL: "Boostery XP" },
  "WINS": { RU: "Победы", UA: "Перемоги", EN: "WINS", PL: "Wygrane" },
  "LOSSES": { RU: "Поражения", UA: "Поразки", EN: "LOSSES", PL: "Przegrane" },
  "WIN RATE": { RU: "Процент побед", UA: "Відсоток перемог", EN: "WIN RATE", PL: "Procent wygranych" },
  "RATING": { RU: "Рейтинг", UA: "Рейтинг", EN: "RATING", PL: "Ranking" },
  "RANK": { RU: "Ранг", UA: "Ранг", EN: "RANK", PL: "Ranga" },
  "Damage": { RU: "Урон", UA: "Шкода", EN: "Damage", PL: "Obrażenia" },
  "Deaths": { RU: "Смерти", UA: "Смерті", EN: "Deaths", PL: "Zgony" },
  "Fatalities": { RU: "Смерти", UA: "Смерті", EN: "Fatalities", PL: "Zgony" },
  "Close-up photos": { RU: "Фото крупным планом", UA: "Фото крупним планом", EN: "Close-up photos", PL: "Zdjęcia zbliżeniowe" },
  "STREAK": { RU: "Серия", UA: "Серія", EN: "STREAK", PL: "Seria" },
  "Profile completion": { RU: "Заполнение профиля", UA: "Заповнення профілю", EN: "Profile completion", PL: "Uzupełnienie profilu" },
  "Analytics": { RU: "Аналитика", UA: "Аналітика", EN: "Analytics", PL: "Analityka" },
  "Clan": { RU: "Клан", UA: "Клан", EN: "Clan", PL: "Klan" },
  "Social": { RU: "Сообщество", UA: "Спільнота", EN: "Social", PL: "Społeczność" },
  "Friends": { RU: "Друзья", UA: "Друзі", EN: "Friends", PL: "Znajomi" },
  "Rivals": { RU: "Соперники", UA: "Суперники", EN: "Rivals", PL: "Rywale" },
  "Weapons": { RU: "Оружие", UA: "Зброя", EN: "Weapons", PL: "Broń" },
  "No clan": { RU: "Нет клана", UA: "Немає клану", EN: "No clan", PL: "Brak klanu" },
  "Avg score": { RU: "Средний счёт", UA: "Середній рахунок", EN: "Avg score", PL: "Średni wynik" },
  "Best streak": { RU: "Лучшая серия", UA: "Найкраща серія", EN: "Best streak", PL: "Najlepsza seria" },
  "Headshots": { RU: "Попадания в голову", UA: "Влучання в голову", EN: "Headshots", PL: "Trafienia w głowę" },
  "Avg kills": { RU: "Среднее количество убийств", UA: "Середня кількість вбивств", EN: "Avg kills", PL: "Średnia liczba zabójstw" },
  "Avg damage": { RU: "Средний урон", UA: "Середня шкода", EN: "Avg damage", PL: "Średnie obrażenia" },
  "Recent form": { RU: "Последние результаты / Форма", UA: "Останні результати / Форма", EN: "Recent form", PL: "Ostatnie wyniki / Forma" },
  "No ranked form yet": { RU: "Пока нет данных по рейтинговым матчам", UA: "Поки немає даних за рейтинговими матчами", EN: "No ranked form yet", PL: "Brak danych z meczów rankingowych" },
};

const SOURCE_TO_KEY: Record<string, string> = {};
const HISTORICAL_ALIASES: Record<string, string> = {
  "Дела": "Cases",
  "Дела — открыть дело и подать заявку на получение предмета": "Cases — open and claim an item",
  "Чехлы": "Cases",
  "Чехлы DuelPlay": "DuelPlay Cases",
  "Чехлы DUELPLAY": "DUELPLAY CASES",
  "ПРИМЕР": "CASE",
  "Пример": "CASE",
  "Примеры": "CASE",
  "Убытки": "LOSSES",
  "Обязательно": "RANK",
  "Повреждения": "Damage",
  "Фотографии в крупный план": "Close-up photos",
  "Смертельные случаи": "Fatalities",
};

for (const [alias, source] of Object.entries(HISTORICAL_ALIASES)) SOURCE_TO_KEY[alias] = source;

for (const [source, values] of Object.entries(DUELPLAY_TERMINOLOGY)) {
  SOURCE_TO_KEY[source.trim()] = source;
  for (const value of Object.values(values)) SOURCE_TO_KEY[value.trim()] = source;
}

export function translateDuelPlayTerm(language: DuelPlayLanguage, text: string): string | null {
  const raw = text.trim();
  const key = SOURCE_TO_KEY[raw];
  if (!key) return null;
  const translated = DUELPLAY_TERMINOLOGY[key]?.[language];
  return translated ? text.replace(raw, translated) : null;
}
