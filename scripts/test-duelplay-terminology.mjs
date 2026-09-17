import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/duelplay-terminology.ts", "utf8");
for (const term of ["Case", "Cases", "DuelPlay Cases", "DUELPLAY CASES", "Open Case", "Chat", "Duel", "Match", "Stake", "Rating", "Reputation", "Profile", "Privacy"]) {
  assert.match(source, new RegExp('"' + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"'));
}
assert.match(source, /RU: "Кейсы"/);
assert.match(source, /UA: "Кейси"/);
assert.match(source, /PL: "Skrzynie"/);
assert.match(source, /RU: "КЕЙСЫ DUELPLAY"/);
assert.match(source, /RU: "Поражения"/);
assert.match(source, /RU: "Ранг"/);
assert.match(source, /RU: "Чат"/);
assert.match(source, /UA: "Чат"/);
assert.match(source, /PL: "Czat"/);

for (const [term, expected] of [
  ["WIN RATE", "Процент побед"],
  ["Avg kills", "Среднее количество убийств"],
  ["Recent form", "Последние результаты / Форма"],
  ["No ranked form yet", "Пока нет данных по рейтинговым матчам"],
  ["Analytics", "Аналитика"],
  ["Clan", "Клан"],
  ["Social", "Сообщество"],
  ["Friends", "Друзья"],
  ["Rivals", "Соперники"],
  ["Weapons", "Оружие"],
  ["No clan", "Нет клана"],
  ["Headshots", "Попадания в голову"],
  ["STREAK", "Серия"],
]) {
  assert.ok(source.includes(`"${term}"`), `missing term: ${term}`);
  assert.ok(source.includes(`RU: "${expected}"`), `missing RU translation for: ${term}`);
}

const globalI18n = readFileSync("components/Common/GlobalUiI18n.tsx", "utf8");
assert.match(globalI18n, /translateDuelPlayTerm/);
console.log("DuelPlay terminology regression: PASS");
