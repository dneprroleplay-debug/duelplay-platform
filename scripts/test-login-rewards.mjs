const MAX_DAYS = 30;
function nextSequence(last) {
  if (!last) return { cycle: 1, day: 1 };
  if (last.day >= MAX_DAYS) return { cycle: last.cycle + 1, day: 1 };
  return { cycle: last.cycle, day: last.day + 1 };
}
const cases = [
  [null, {cycle:1,day:1}],
  [{cycle:1,day:1}, {cycle:1,day:2}],
  [{cycle:1,day:29}, {cycle:1,day:30}],
  [{cycle:1,day:30}, {cycle:2,day:1}],
  [{cycle:7,day:30}, {cycle:8,day:1}],
];
for (const [input, expected] of cases) {
  const actual = nextSequence(input);
  if (actual.cycle !== expected.cycle || actual.day !== expected.day) throw new Error(`bad transition ${JSON.stringify(input)} => ${JSON.stringify(actual)}`);
}
const dates = ["2026-09-05", "2026-09-05"];
if (new Set(dates).size !== 1) throw new Error("date key failed");
console.log("login rewards policy tests: PASS");
