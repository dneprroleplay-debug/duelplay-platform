import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const schema = read('prisma/schema.prisma');
const progression = read('lib/progression.ts');
const profile = read('app/api/profile/[nickname]/route.ts');
const analytics = read('app/api/analytics/route.ts');
const leagues = read('app/api/leagues/route.ts');
const leaderboards = read('app/api/leaderboards/route.ts');
const matchmaking = read('app/api/matchmaking/route.ts');
const ranking = read('app/api/ranking/route.ts');
const home = read('app/page.tsx');
const search = read('app/search/page.tsx');

const checks = [
  ['PlayerStats default rating is 0', /model PlayerStats[\s\S]*?rating\s+Int\s+@default\(0\)/.test(schema)],
  ['New PlayerStats created by progression starts at 0', /create:\{userId[^}]*rating:0/.test(progression)],
  ['Rating fallback in profile is 0', /stats\?\.rating\?\?0/.test(profile)],
  ['Rating fallback in analytics is 0', /rating:\s*stats\?\.rating\s*\?\?\s*0/.test(analytics)],
  ['Rating fallback in leagues is 0', /playerStats\?\.rating\s*\?\?\s*0/.test(leagues)],
  ['Rating fallback in leaderboards is 0', /playerStats\?\.rating\s*\?\?\s*0/.test(leaderboards)],
  ['Rating fallback in matchmaking is 0', /playerStats\?\.rating\s*\?\?\s*0/.test(matchmaking)],
  ['Search player rating fallback is 0', /playerStats\?\.rating\?\?0/.test(search)],
  ['Home ranking displays Rating, not Reputation', /u\.rating\}\s*<span[^>]*>RATING/.test(home)],
  ['Home ranking API reads PlayerStats.rating', /playerStats:\s*\{\s*select:\s*\{\s*rating:\s*true/.test(ranking)],
  ['Match stats aggregate kills', /update:\{kills:\{increment:kills\}/.test(progression)],
  ['Match stats aggregate deaths', /deaths:\{increment:deaths\}/.test(progression)],
  ['Match stats aggregate headshots', /headshots:\{increment:headshots\}/.test(progression)],
  ['Match stats aggregate damage', /damage:\{increment:damage\}/.test(progression)],
  ['Aggregate fallback creation starts rating at 0', /create:\{userId,rating:0,kills,deaths,headshots,damage\}/.test(progression)],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
