export type AdminCommand = {
  permission: string;
  title: string;
  description: string;
  group: string;
  icon: string;
  tab?: string;
  danger?: boolean;
};

/**
 * Canonical navigation catalog for the admin control center.
 *
 * Every entry must point at the tab that actually implements the operation and
 * must use a distinct permission. Permissions that have no implemented
 * administrative surface are intentionally not listed here: showing a command
 * that cannot be performed is worse than hiding it.
 */
export const ADMIN_COMMAND_CATALOG: readonly AdminCommand[] = ([
  ["users.view", "Пользователи", "Просмотр списка игроков, профилей и административного контекста.", "Пользователи", "♟", "users"],
  ["users.restrict", "Ограничения пользователей", "Блокировка, приостановка и снятие ограничений с аккаунтов.", "Пользователи", "⛔", "users", true],

  ["matches.view", "Матчи", "Просмотр активных, ожидающих и завершённых матчей.", "Матчи", "⚔", "matches"],
  ["matches.cancel", "Отмена матча", "Отмена активного матча с штатным возвратом ставок.", "Матчи", "×", "matches", true],

  ["disputes.view", "Споры", "Просмотр открытых и завершённых споров и приложенных материалов.", "Споры", "⚖", "security"],
  ["disputes.resolve", "Решение спора", "Разбор доказательств и фиксация решения спора с аудитом.", "Споры", "✓", "security", true],
  ["evidence.view", "Доказательства", "Просмотр материалов, прикреплённых к спору или расследованию.", "Споры", "▣", "security"],

  ["risk.cases.review", "Risk cases", "Проверка fraud/risk-кейсов и результатов расследования.", "Безопасность", "◈", "security", true],
  ["reports.view", "Жалобы игроков", "Просмотр жалоб на читы, токсичность и подозрительное поведение.", "Безопасность", "⚑", "reports"],
  ["security.view", "Security Center", "Обзор security-событий и состояния защиты.", "Безопасность", "🛡", "security"],
  ["security.sessions.revoke", "Отозвать сессию", "Завершить выбранную пользовательскую сессию.", "Безопасность", "↪", "users", true],
  ["security.sessions.revoke_all", "Отозвать все сессии", "Экстренный logout активных сессий.", "Безопасность", "⏏", "settings", true],

  ["finance.view", "Финансы", "Просмотр финансового центра и денежных операций.", "Финансы", "$", "finance"],
  ["ledger.view", "Ledger", "Просмотр неизменяемой финансовой истории транзакций.", "Финансы", "▤", "transactions"],
  ["deposits.review", "Депозиты", "Проверка депозитных операций и их статусов.", "Финансы", "↓", "finance"],
  ["deposits.approve", "Одобрение депозита", "Подтверждение зачисления депозита после проверки.", "Финансы", "✓", "finance", true],
  ["deposits.reject", "Отклонение депозита", "Отклонение депозита с фиксацией результата в аудите.", "Финансы", "×", "finance", true],
  ["withdrawals.review", "Выводы", "Проверка заявок на вывод средств.", "Финансы", "↑", "finance"],
  ["withdrawals.approve", "Одобрение вывода", "Перевод проверенной заявки в обработку.", "Финансы", "✓", "finance", true],
  ["withdrawals.complete", "Завершение вывода", "Подтверждение фактической выплаты после обработки.", "Финансы", "◈", "finance", true],
  ["withdrawals.reject", "Отклонение вывода", "Отклонение вывода с возвратом удержания по правилам.", "Финансы", "×", "finance", true],
  ["finance.wallet.adjust", "Изменение баланса", "Административная корректировка баланса с обязательной причиной и аудитом.", "Финансы", "◈", "users", true],
  ["creator.payouts.manage", "Выплаты авторам", "Управление выплатами Creator-программы.", "Финансы", "◈", "creator", true],
  ["creator.payouts.pay", "Подтверждение выплат", "Проведение финальной выплаты авторам (Mark paid).", "Финансы", "✓", "creator", true],

  ["servers.view", "Серверы", "Просмотр состояния, доступности и текущей загрузки CS2-серверов.", "Серверы", "◈", "serverView"],
  ["servers.manage", "Параметры серверов", "Технические сведения о регистрации, процессах и подключениях серверов. Запуск и остановка выполняются Server Manager.", "Серверы", "⚙", "serverManage", true],
  ["game_modes.configure", "Игровые режимы", "Версии настроек, проверки и подтверждённая публикация на все три CS2-сервера.", "Серверы", "🎮", "gameModes", true],
  ["system.logs.view", "Технические логи", "Просмотр технических логов и диагностической информации.", "Серверы", "≡", "techOps"],
  ["system.maintenance", "Maintenance", "Системное обслуживание и режимы восстановления.", "Серверы", "⌘", "settings", true],
  ["system.incidents.view", "Системные инциденты", "Просмотр аварийных системных событий.", "Серверы", "⚠", "techOps"],
  ["system.incidents.manage", "Обработка системных инцидентов", "Подтверждение и закрытие инцидентов с записью причины в аудит.", "Серверы", "✓", "techOps", true],

  ["content.manage", "Контент-магазин", "Управление предметами, коллекциями, миссиями и достижениями.", "Контент", "✦", "content"],
  ["seasons.manage", "Сезоны", "Запуск сезонных эффектов и календаря.", "Контент", "❄", "seasons"],
  ["notifications.send", "Уведомления", "Отправка системных уведомлений игрокам.", "Контент", "◉", "notifications"],
  ["content.skins.manage", "Топ скины", "Управление пользовательскими скинами.", "Контент", "◇", "skins"],
  ["content.avatars.manage", "Аватары", "Управление общим набором аватаров.", "Контент", "✦", "avatars"],

  ["settings.content.manage", "Стиль DuelPlay", "Глобальная визуальная тема, фон и hero-изображение.", "Настройки", "◌", "settings"],
  ["settings.manage", "Платформенные настройки", "Изменение системных параметров платформы.", "Настройки", "⚙", "settings", true],
  ["feature_flags.manage", "Feature Flags", "Включение и выключение экспериментальных функций.", "Настройки", "⚡", "settings", true],

  ["support.view", "Поддержка", "Просмотр обращений игроков и контекста тикетов.", "Поддержка", "?", "support"],
  ["support.tickets.reply", "Ответ игроку", "Ответ на обращение игрока.", "Поддержка", "↩", "support"],
  ["support.tickets.manage", "Статусы тикетов", "Назначение, перевод и закрытие обращений.", "Поддержка", "✓", "support", true],
  ["support.tickets.delete", "Удаление тикета", "Удаление устаревшего тикета.", "Поддержка", "×", "support", true],

  ["analytics.view", "Аналитика", "Метрики платформы и операционные показатели.", "Аналитика", "◔", "dashboard"],
  ["admin.audit.view", "Аудит", "Просмотр истории действий администраторов.", "Аналитика", "≡", "logs"],

  ["roles.manage", "Управление доступом", "Назначение административных ролей, аудит RBAC и выдача приглашений.", "Администрирование", "♛", "roles", true],
] as Array<[string, string, string, string, string, string, boolean?]>).map((x) => ({
  permission: x[0],
  title: x[1],
  description: x[2],
  group: x[3],
  icon: x[4],
  tab: x[5],
  danger: Boolean(x[6]),
}));

export const ADMIN_COMMAND_GROUPS = [
  "Пользователи",
  "Матчи",
  "Споры",
  "Финансы",
  "Серверы",
  "Контент",
  "Поддержка",
  "Безопасность",
  "Аналитика",
  "Настройки",
  "Администрирование",
] as const;

export const ADMIN_GROUP_ICONS: Record<string, string> = {
  Пользователи: "♟",
  Матчи: "⚔",
  Споры: "⚖",
  Финансы: "$",
  Серверы: "◈",
  Контент: "✦",
  Поддержка: "?",
  Безопасность: "🛡",
  Аналитика: "◔",
  Настройки: "⚙",
  Администрирование: "♛",
};
