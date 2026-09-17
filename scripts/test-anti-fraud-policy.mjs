import fs from "node:fs";
const checks = [
  ["lib/anti-fraud.ts", "assertAccountCanPlay", "account play gate"],
  ["lib/anti-fraud.ts", "recordFraudSignal", "fraud signal recorder"],
  ["lib/anti-fraud.ts", "assertAccountCanWithdraw", "withdrawal freeze gate"],
  ["app/api/matches/route.ts", "assessUserRisk", "risk assessment on duel creation"],
  ["app/api/matches/[id]/join/route.ts", "assertAccountCanPlay", "risk status gate on join"],
  ["app/api/cases/route.ts", "enforceRateLimit", "case rate limit"],
  ["app/api/cases/route.ts", "assertAccountCanPlay", "case status gate"],
  ["app/api/wallet/transactions/route.ts", "assertAccountCanWithdraw", "withdrawal freeze"],
  ["app/api/admin/route.ts", "fraudReview", "admin fraud review"],
  ["app/api/admin/route.ts", "CONFIRMED_BANNED", "fraud-confirmed ban"],
  ["prisma/schema.prisma", "model FraudCase", "fraud persistence"],
  ["prisma/schema.prisma", "model SecurityEvent", "security event persistence"],
];
let failed=0;
for(const [file,needle,label] of checks){const text=fs.readFileSync(file,"utf8");const ok=text.includes(needle);console.log(`${ok?"PASS":"FAIL"} · ${label}`);if(!ok)failed++;}
process.exit(failed?1:0);
