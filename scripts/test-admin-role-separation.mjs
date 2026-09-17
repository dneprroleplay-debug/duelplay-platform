import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const admin = fs.readFileSync(path.join(root,"app","admin","page.tsx"),"utf8");
const layout = fs.readFileSync(path.join(root,"app","admin","operations","layout.tsx"),"utf8");
const api = fs.readFileSync(path.join(root,"app","api","admin","route.ts"),"utf8");

const checks = [
  ["Control Center link is SUPERADMIN-only in UI", admin.includes('d.me.level>=5&&<a href="/admin/operations"')],
  ["Operations route has server-side SUPERADMIN guard", layout.includes('me.role !== "SUPERADMIN"') && layout.includes('redirect("/admin")')],
  ["Platform settings API is SUPERADMIN-only", fs.readFileSync(path.join(root,"app","api","platform-settings","route.ts"),"utf8").includes('requireAdmin(5)')],
  ["Feature flags API is SUPERADMIN-only", fs.readFileSync(path.join(root,"app","api","feature-flags","route.ts"),"utf8").includes('requireAdmin(5)')],
  ["Site settings mutation API is SUPERADMIN-only", fs.readFileSync(path.join(root,"app","api","site-settings","route.ts"),"utf8").includes('requireAdmin(5)')],
  ["Admin role changes are SUPERADMIN-only", api.includes('if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});') && api.includes('if(action==="userRole")')],
  ["Owner protection remains in admin API", api.includes('protectedOwner(target)')],
  ["Wallet debit and credit both require level 3", api.includes('if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});') && !api.includes('if(amount>0 && adminLevel(me.role)<3)')],
  ["Standard theme is SUPERADMIN-only", api.includes('if(action==="standardTheme")') && api.includes('if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});')],
  ["Lower roles do not receive financial dashboard totals", api.includes('const dashboard=level>=3?fullDashboard:')],
  ["Creator payout controls are level-separated", fs.readFileSync(path.join(root,"app","api","creator-payouts","route.ts"),"utf8").includes('requireAdmin(3)') && fs.readFileSync(path.join(root,"app","api","creator-payouts","route.ts"),"utf8").includes("status==='PAID'&&adminLevel(me.role)<5")],
  ["Creator admin section is level 3+", admin.includes('["creator",L.creator,d.creatorPayouts.length,"◈"]') && admin.includes('creator:3') && admin.includes('tab==="creator"&&d.me.level>=3')],
];
let failed=0;
for (const [name,ok] of checks) { console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) failed++; }
if(failed) process.exit(1);
console.log(`Admin role separation: ${checks.length}/${checks.length} PASS`);
