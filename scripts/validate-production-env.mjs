import assert from "node:assert/strict";

const required = [
  "DATABASE_URL",
  "DUELPLAY_SERVER_MANAGER_SECRET",
  "CS2_RESULT_SECRET",
  "DUELPLAY_JOB_SECRET",
  "DUELPLAY_MFA_ENCRYPTION_KEY",
  "DUELPLAY_ADMIN_AUTH_SECRET",
  "DUELPLAY_API_URL",
  "STEAM_RETURN_URL",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];

const problems = [];
const value = (key) => process.env[key]?.trim() || "";
for (const key of required) if (!value(key)) problems.push(`${key} is required`);

if (value("NODE_ENV") && value("NODE_ENV") !== "production") problems.push(`NODE_ENV must be production (received ${value("NODE_ENV")})`);
if (/^https?:\/\/localhost(?::\d+)?\/?$/i.test(value("DUELPLAY_API_URL"))) problems.push("DUELPLAY_API_URL must not point to localhost");
if (/^https?:\/\/localhost(?::\d+)?\/?$/i.test(value("STEAM_RETURN_URL"))) problems.push("STEAM_RETURN_URL must not point to localhost");
if (value("DUELPLAY_LOCAL_TEST_MODE").toLowerCase() === "true") problems.push("DUELPLAY_LOCAL_TEST_MODE must be false in production");
if (value("NODE_ENV") === "production" && value("DUELPLAY_TEST_ACCOUNTS_SECRET")) problems.push("DUELPLAY_TEST_ACCOUNTS_SECRET must be empty in production");
if (value("DUELPLAY_SERVER_MANAGER_SECRET") && value("CS2_RESULT_SECRET") && value("DUELPLAY_SERVER_MANAGER_SECRET") === value("CS2_RESULT_SECRET")) problems.push("DUELPLAY_SERVER_MANAGER_SECRET and CS2_RESULT_SECRET must be different");
if (value("DUELPLAY_MFA_ENCRYPTION_KEY") && !/^[0-9a-f]{64}$/i.test(value("DUELPLAY_MFA_ENCRYPTION_KEY"))) problems.push("DUELPLAY_MFA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
if (value("DUELPLAY_ADMIN_AUTH_SECRET") && value("DUELPLAY_ADMIN_AUTH_SECRET").length < 32) problems.push("DUELPLAY_ADMIN_AUTH_SECRET should be at least 32 characters");
for (const key of ["DUELPLAY_SERVER_MANAGER_SECRET", "CS2_RESULT_SECRET", "DUELPLAY_JOB_SECRET", "DUELPLAY_TEST_ACCOUNTS_SECRET"]) {
  const v = value(key);
  if (v && /^change[-_ ]?me|^CHANGE_ME/i.test(v)) problems.push(`${key} still uses a placeholder value`);
  if (v && (key === "DUELPLAY_SERVER_MANAGER_SECRET" || key === "CS2_RESULT_SECRET") && v.length < 32) problems.push(`${key} should be at least 32 characters`);
}
if (value("STEAM_RETURN_URL") && !/^https:\/\/duelplaygame\.com\/api\/auth\/steam\/callback\/?$/i.test(value("STEAM_RETURN_URL"))) problems.push("STEAM_RETURN_URL must target the production Steam callback on duelplaygame.com");

assert.equal(problems.length, 0, problems.join("\n"));
console.log("production env validation: PASS");
