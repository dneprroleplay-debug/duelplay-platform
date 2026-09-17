import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const header = read("../components/Header/Header.tsx");
const perf = read("../components/Common/PerformanceModeControl.tsx");
const season = read("../components/Common/SeasonIntensityControl.tsx");
const globalI18n = read("../components/Common/GlobalUiI18n.tsx");

const checks = [
  ["header closed nickname is protected", /data-player-name className=\"hidden max-w-28 truncate sm:inline\">\{user\.nickname\}/.test(header)],
  ["header dropdown nickname is protected", /data-player-name className=\"font-bold\">\{user\.nickname\}/.test(header)],
  ["LIVE is explicitly protected", /"LIVE"/.test(globalI18n)],
  ["W and L are explicitly protected", /"W".*"L"/s.test(globalI18n)],
  ["performance popup uses English canonical text", /<b className=\"text-sm\">Performance<\/b>/.test(perf) && /For your screen only/.test(perf)],
  ["season popup uses English canonical text", /<b className=\"text-sm\">Season effects<\/b>/.test(season) && /For your screen only/.test(season)],
  ["performance Russian hardcoded text removed", !/Производительность|Только для вашего экрана|AUTO подбирает режим/.test(perf)],
  ["season Russian hardcoded text removed", !/Сезонные эффекты|Настройка только для вашего экрана|Минимум|Максимум|Эффекты нельзя/.test(season)],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
process.exitCode = failed ? 1 : 0;
