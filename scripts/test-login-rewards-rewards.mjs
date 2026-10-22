import fs from "node:fs";
import path from "node:path";
const seed = fs.readFileSync(path.join(process.cwd(), "prisma/seed.ts"), "utf8");
const amounts = [20,20,25,25,30,30,75,25,30,35,35,40,40,100,100,40,40,45,45,50,150,45,50,50,55,55,60,200,75,1000];
for (let day = 1; day <= 30; day++) {
  const re = new RegExp(`loginReward\\.upsert\\({where:\\{day:${day}\\},update:\\{reward:\\{balance:(\\d+)(?:,cosmeticSlug:"([^"]+)")?\\},active:true\\},create:\\{day:${day},reward:\\{balance:(\\d+)(?:,cosmeticSlug:"([^"]+)")?\\},active:true\\}\\}\\)`);
  const m = seed.match(re);
  if (!m) throw new Error(`missing reward for day ${day}`);
  if (Number(m[1]) !== amounts[day-1] || Number(m[3]) !== amounts[day-1]) throw new Error(`wrong amount for day ${day}`);
  if (m[2] !== m[4]) throw new Error(`inconsistent cosmetic slug for day ${day}`);
}
const expectedFrames = {7:"frame-neon-pulse",15:"frame-electric-storm",30:"frame-inferno-crown"};
for (const [day, slug] of Object.entries(expectedFrames)) {
  const re = new RegExp(`loginReward\\.upsert\\({where:\\{day:${day}\\},update:\\{reward:\\{balance:\\d+,cosmeticSlug:"${slug}"\\},active:true\\},create:\\{day:${day},reward:\\{balance:\\d+,cosmeticSlug:"${slug}"\\},active:true\\}\\}\\)`);
  if (!re.test(seed)) throw new Error(`missing frame for day ${day}`);
}
const total = amounts.reduce((s,x)=>s+x,0);
if (total !== 2590) throw new Error(`bad total ${total}`);
const slugs = ["frame-neon-pulse","frame-electric-storm","frame-inferno-crown"];
for (const slug of slugs) {
  const count = (seed.match(new RegExp(`\\["${slug}"`, "g")) || []).length;
  if (count !== 1) throw new Error(`duplicate or missing cosmetic slug ${slug}: ${count}`);
}
console.log(`login rewards rewards: PASS (${amounts.length} days, ${total} credits, ${slugs.length} frames)`);