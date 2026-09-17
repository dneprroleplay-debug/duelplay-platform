import fs from 'node:fs';

const files = {
  publicProfile: 'app/api/profile/[nickname]/route.ts',
  leaderboards: 'app/api/leaderboards/route.ts',
  leagues: 'app/api/leagues/route.ts',
};
for (const p of Object.values(files)) if (!fs.existsSync(p)) throw new Error(`Missing ${p}`);
const pub = fs.readFileSync(files.publicProfile,'utf8');
const lb = fs.readFileSync(files.leaderboards,'utf8');
const lg = fs.readFileSync(files.leagues,'utf8');
const checks = [
  ['public profile derives wins from finished winnerId', pub.includes('derivedWins=u.showStatsPublic ? decisiveFinishedMatches.filter(x=>x.winnerId===u.id).length : 0')],
  ['public profile derives losses from finished winnerId', pub.includes('derivedLosses=u.showStatsPublic ? decisiveFinishedMatches.filter(x=>x.winnerId!==u.id).length : 0')],
  ['public profile total is wins+losses', pub.includes('const total=u.showStatsPublic ? derivedWins + derivedLosses : 0')],
  ['public profile completion uses all decisive finished matches', pub.includes('finishedMatchCount=decisiveFinishedMatches.length')],
  ['global leaderboard queries finished decisive matches', lb.includes('status: "FINISHED", playerTwoId: { not: null }, winnerId: { not: null }')],
  ['global leaderboard does not read stale playerStats W/L', lb.includes('wins: 0,\n      losses: 0')],
  ['leagues uses finished match results', lg.includes('const finishedMatches = await prisma.match.findMany')],
  ['leagues uses derived wins/losses', lg.includes('resultStats.get(u.id)?.wins') && lg.includes('resultStats.get(u.id)?.losses')],
];
let ok=0;
for(const [name,pass] of checks){console.log(`${pass?'PASS':'FAIL'} ${name}`); if(pass) ok++;}
if(ok!==checks.length) process.exit(1);
console.log(`${ok}/${checks.length} PASS`);
