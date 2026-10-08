# DuelPlay Admin Center — RBAC + Unified Workspace

## Что входит
- Единый админ-вход: `/admin/access`.
- `/admin` и `/admin/operations` перенаправляют в `/admin/access`, чтобы не оставалось двух старых центров управления.
- 10 уровней в порядке 1–10 + `FOUNDER 999`.
- Кликать можно только по своей карточке уровня.
- `FOUNDER 999` визуально выделен и не является обычной назначаемой ролью; backend разрешает Founder только защищённому владельцу.
- После MFA первый вход показывает full-screen onboarding; последующие входы открывают рабочий центр.
- В рабочем центре справа — «Мои команды». Каждая команда открывается на весь экран.
- Enter выполняет основное действие формы/кнопки, Esc закрывает full-screen workspace.
- Realtime без F5: административные счётчики и активные матчи обновляются автоматически; открытые legacy-вкладки перечитывают данные без перезагрузки страницы.
- Тема/фон DuelPlay синхронизируются автоматически. Локальное событие `duelplay:theme-changed` сохраняется, а ThemeProvider дополнительно сверяет серверное состояние.
- Legacy `/admin` больше не содержит управление RBAC в таблице пользователей; роли назначаются через Admin Access Center.

## Уровни
1. SUPERADMIN
2. FINANCIAL ADMIN
3. ADMIN
4. MODERATOR
5. SUPPORT
6. AUDITOR
7. TECH ADMIN
8. CONTENT ADMIN
9. ANALYST
10. SECURITY ADMIN
999. FOUNDER

Полный перечень permissions и человеческих описаний находится в `ADMIN_CENTER_OPERATIONS.md`.

## Founder
Не задавайте Founder через `User.role` и не выдавайте Founder через обычный RBAC select.
Для производственного владельца задайте `DUELPLAY_OWNER_STEAM_ID` в окружении Coolify/VPS. Значение должно соответствовать SteamID владельца. Не коммитьте это значение в репозиторий.

## Database
Изменение схемы аддитивное: добавляется `AdminRoleAssignment`.
Для чистого окружения применяйте миграции Prisma штатным способом:
`npx prisma migrate deploy`.

## Важно
Не трогайте рабочие CS2 manager / plugin / nickname / avatar файлы при интеграции этого пакета.
