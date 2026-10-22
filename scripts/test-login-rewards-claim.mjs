import fs from "node:fs";
import path from "node:path";
const route = fs.readFileSync(path.join(process.cwd(), "app/api/login-rewards/route.ts"), "utf8");
if (!/SELECT id FROM "User" WHERE id = \$\{me\.id\}::uuid FOR UPDATE/.test(route)) {
  throw new Error("login reward claim lock must cast me.id to uuid");
}
console.log("login reward claim UUID lock: PASS");