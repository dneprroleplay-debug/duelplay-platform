import { formatMatchAmount } from "@/lib/match-currency";
import { cancellationDetail } from "@/lib/notification-details";

type NoticeLanguage = "RU" | "UA" | "EN" | "PL";

const CREATED_TITLES: Record<NoticeLanguage, string> = {
  RU: "ДЕМО · Матч создан",
  UA: "ДЕМО · Матч створено",
  EN: "DEMO · Match created",
  PL: "DEMO · Mecz utworzony",
};

const CREATED_BODIES: Record<NoticeLanguage, string> = {
  RU: "DEMO-матч создан. Ожидается второй игрок. Используются виртуальные кредиты DC; реальные деньги не затронуты.",
  UA: "DEMO-матч створено. Очікується другий гравець. Використовуються віртуальні кредити DC; реальні гроші не змінено.",
  EN: "Your DEMO match was created and is waiting for a second player. It uses virtual DC credits; real money was not affected.",
  PL: "Mecz DEMO został utworzony i oczekuje na drugiego gracza. Używa wirtualnych kredytów DC; rzeczywiste środki nie zostały zmienione.",
};

const TITLES: Record<NoticeLanguage, Record<string, string>> = {
  RU: { SYSTEM: "ДЕМО · Матч создан", CANCELLATION: "ДЕМО · Матч отменён", MATCH_READY: "ДЕМО · Матч готов", MATCH_FOUND: "ДЕМО · Найден матч", MATCH_STARTED: "ДЕМО · Матч начался", WIN: "ДЕМО · Победа", TECHNICAL_WIN: "ДЕМО · Техническая победа", LOSS: "ДЕМО · Матч завершён", REFUND: "ДЕМО · Возврат ставки", DISPUTE_UPDATE: "ДЕМО · Спор по матчу" },
  UA: { SYSTEM: "ДЕМО · Матч створено", CANCELLATION: "ДЕМО · Матч скасовано", MATCH_READY: "ДЕМО · Матч готовий", MATCH_FOUND: "ДЕМО · Матч знайдено", MATCH_STARTED: "ДЕМО · Матч почався", WIN: "ДЕМО · Перемога", TECHNICAL_WIN: "ДЕМО · Технічна перемога", LOSS: "ДЕМО · Матч завершено", REFUND: "ДЕМО · Повернення ставки", DISPUTE_UPDATE: "ДЕМО · Спір щодо матчу" },
  EN: { SYSTEM: "DEMO · Match created", CANCELLATION: "DEMO · Match cancelled", MATCH_READY: "DEMO · Match ready", MATCH_FOUND: "DEMO · Match found", MATCH_STARTED: "DEMO · Match started", WIN: "DEMO · Victory", TECHNICAL_WIN: "DEMO · Technical win", LOSS: "DEMO · Match finished", REFUND: "DEMO · Stake refunded", DISPUTE_UPDATE: "DEMO · Match dispute" },
  PL: { SYSTEM: "DEMO · Mecz utworzony", CANCELLATION: "DEMO · Mecz anulowany", MATCH_READY: "DEMO · Mecz gotowy", MATCH_FOUND: "DEMO · Znaleziono mecz", MATCH_STARTED: "DEMO · Mecz rozpoczął się", WIN: "DEMO · Zwycięstwo", TECHNICAL_WIN: "DEMO · Wygrana walkowerem", LOSS: "DEMO · Mecz zakończony", REFUND: "DEMO · Zwrot stawki", DISPUTE_UPDATE: "DEMO · Spór dotyczący meczu" },
};

const BODIES: Record<NoticeLanguage, Record<string, string>> = {
  RU: {
    CANCELLATION: "Виртуальная ставка возвращена. Реальный баланс не изменён.",
    MATCH_READY: "Второй игрок присоединился. Матч готов; используются только виртуальные кредиты, реальный баланс не изменён.",
    MATCH_FOUND: "Для вас найден соперник в DEMO. Используются только виртуальные кредиты; реальный баланс не изменён.",
    MATCH_STARTED: "Сервер CS2 запущен. Подключитесь, чтобы начать DEMO-дуэль; реальный баланс не изменён.",
    REFUND: "Виртуальная ставка возвращена. Реальный баланс не изменён.",
    WIN: "DEMO-матч завершён победой. Реальный баланс не изменён.",
    TECHNICAL_WIN: "Вы выиграли DEMO-матч технической победой. Реальный баланс не изменён.",
    LOSS: "DEMO-матч завершён. Реальный баланс не изменён.",
    DEFAULT: "Это событие относится к DEMO-матчу. Реальный баланс не изменён.",
  },
  UA: {
    CANCELLATION: "Віртуальну ставку повернено. Реальний баланс не змінився.",
    MATCH_READY: "Другий гравець приєднався. Матч готовий; використовуються лише віртуальні кредити, реальний баланс не змінився.",
    MATCH_FOUND: "Для вас знайдено суперника в DEMO. Використовуються лише віртуальні кредити; реальний баланс не змінився.",
    MATCH_STARTED: "Сервер CS2 запущено. Підключіться, щоб почати DEMO-дуель; реальний баланс не змінився.",
    REFUND: "Віртуальну ставку повернено. Реальний баланс не змінився.",
    WIN: "DEMO-матч завершився перемогою. Реальний баланс не змінився.",
    TECHNICAL_WIN: "Ви перемогли в DEMO-матчі технічною перемогою. Реальний баланс не змінився.",
    LOSS: "DEMO-матч завершено. Реальний баланс не змінився.",
    DEFAULT: "Ця подія стосується DEMO-матчу. Реальний баланс не змінився.",
  },
  EN: {
    CANCELLATION: "Your virtual stake was refunded. Your real balance was not changed.",
    MATCH_READY: "The second player joined. The match is ready and uses virtual credits only; your real balance was not changed.",
    MATCH_FOUND: "A DEMO opponent was found for you. Virtual credits only; your real balance was not changed.",
    MATCH_STARTED: "The CS2 server is live. Connect to start the DEMO duel; your real balance was not changed.",
    REFUND: "Your virtual stake was refunded. Your real balance was not changed.",
    WIN: "You won the DEMO match. Your real balance was not changed.",
    TECHNICAL_WIN: "You won the DEMO match by technical forfeit. Your real balance was not changed.",
    LOSS: "The DEMO match is complete. Your real balance was not changed.",
    DEFAULT: "This event belongs to a DEMO match. Your real balance was not changed.",
  },
  PL: {
    CANCELLATION: "Wirtualna stawka została zwrócona. Rzeczywiste saldo nie uległo zmianie.",
    MATCH_READY: "Dołączył drugi gracz. Mecz jest gotowy i używa wyłącznie wirtualnych kredytów; rzeczywiste saldo nie uległo zmianie.",
    MATCH_FOUND: "Znaleziono dla Ciebie przeciwnika w DEMO. Tylko wirtualne kredyty; rzeczywiste saldo nie uległo zmianie.",
    MATCH_STARTED: "Serwer CS2 działa. Połącz się, aby rozpocząć pojedynkę DEMO; rzeczywiste saldo nie uległo zmianie.",
    REFUND: "Wirtualna stawka została zwrócona. Rzeczywiste saldo nie uległo zmianie.",
    WIN: "Wygrałeś mecz DEMO. Rzeczywiste saldo nie uległo zmianie.",
    TECHNICAL_WIN: "Wygrałeś mecz DEMO walkowerem. Rzeczywiste saldo nie uległo zmianie.",
    LOSS: "Mecz DEMO został zakończony. Rzeczywiste saldo nie uległo zmianie.",
    DEFAULT: "To zdarzenie dotyczy meczu DEMO. Rzeczywiste saldo nie uległo zmianie.",
  },
};

export function getDemoNotificationTitle(language: string, type: string, payload: Record<string, unknown> = {}): string {
  const locale = (TITLES[language as NoticeLanguage] ? language : "EN") as NoticeLanguage;
  if (type === "SYSTEM" && payload.kind === "DEMO_MATCH_CREATED") return CREATED_TITLES[locale];
  return TITLES[locale][type] || `${locale === "RU" || locale === "UA" ? "ДЕМО" : "DEMO"} · ${locale === "RU" ? "Событие матча" : locale === "UA" ? "Подія матчу" : locale === "PL" ? "Zdarzenie meczu" : "Match event"}`;
}

export function getDemoNotificationBody(language: string, type: string, payload: Record<string, unknown>): string {
  const locale = (BODIES[language as NoticeLanguage] ? language : "EN") as NoticeLanguage;
  if (type === "SYSTEM" && payload.kind === "DEMO_MATCH_CREATED") return CREATED_BODIES[locale];
  if (type === "DISPUTE_UPDATE") {
    const opened = payload.kind === "DISPUTE_OPENED";
    const opponent = payload.role === "OPPONENT";
    if (locale === "RU") return opened ? (opponent ? "Соперник открыл спор по DEMO-матчу. Результат пересматривается; реальный баланс не изменён." : "Ваш спор по DEMO-матчу принят на рассмотрение. Реальный баланс не изменён.") : "Спор по DEMO-матчу решён. Виртуальные кредиты пересчитаны; реальный баланс не изменён.";
    if (locale === "UA") return opened ? (opponent ? "Суперник відкрив спір щодо DEMO-матчу. Результат переглядається; реальний баланс не змінено." : "Ваш спір щодо DEMO-матчу прийнято на розгляд. Реальний баланс не змінено.") : "Спір щодо DEMO-матчу вирішено. Віртуальні кредити перераховано; реальний баланс не змінено.";
    if (locale === "PL") return opened ? (opponent ? "Przeciwnik otworzył spór dotyczący meczu DEMO. Wynik jest weryfikowany; rzeczywiste saldo nie uległo zmianie." : "Twój spór dotyczący meczu DEMO został przyjęty do weryfikacji. Rzeczywiste saldo nie uległo zmianie.") : "Spór dotyczący meczu DEMO został rozwiązany. Wirtualne kredyty zostały przeliczone; rzeczywiste saldo nie uległo zmianie.";
    return opened ? (opponent ? "Your opponent opened a dispute for this DEMO match. The result is under review; your real balance was not changed." : "Your dispute for this DEMO match has been submitted for review. Your real balance was not changed.") : "The DEMO match dispute has been resolved. Virtual credits were recalculated; your real balance was not changed.";
  }
  const base = BODIES[locale][type] || BODIES[locale].DEFAULT;
  if (type === "CANCELLATION") {
    // Append the factual cancellation data (actual reason, who cancelled it
    // and the exact time) so the player never sees a generic sentence only.
    const detail = cancellationDetail(language, payload);
    return detail ? `${base} ${detail}` : base;
  }
  const payout = Number(payload.payout);
  if ((type === "WIN" || type === "TECHNICAL_WIN") && Number.isFinite(payout) && payout > 0) {
    const amount = formatMatchAmount("DEMO", payout);
    if (locale === "RU") return `${base} Начислено ${amount}.`;
    if (locale === "UA") return `${base} Нараховано ${amount}.`;
    if (locale === "PL") return `${base} Otrzymano ${amount}.`;
    return `${base} Credited ${amount}.`;
  }
  return base;
}
