$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$requiredFiles = @(
  'lib/admin-auth.ts',
  'lib/platform-version.ts',
  'components/Common/LivePlatformSync.tsx',
  'app/api/admin/access/route.ts',
  'app/api/admin/route.ts',
  'scripts/test-admin-auth-flow.mjs'
)
foreach ($relative in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
    throw "Run this script from the DuelPlay project root. Missing: $relative"
  }
}

function Read-ProjectFile([string]$RelativePath) {
  return [System.IO.File]::ReadAllText((Join-Path $root $RelativePath))
}
function Replace-ExactlyOnce([string]$Content, [string]$Old, [string]$New, [string]$Description) {
  $count = ([regex]::Matches($Content, [regex]::Escape($Old))).Count
  if ($count -ne 1) {
    throw "Expected exactly one match for '$Description', found $count. No files were written."
  }
  return $Content.Replace($Old, $New)
}

$adminAuth = Read-ProjectFile 'lib/admin-auth.ts'
$platformVersion = Read-ProjectFile 'lib/platform-version.ts'
$liveSync = Read-ProjectFile 'components/Common/LivePlatformSync.tsx'
$accessRoute = Read-ProjectFile 'app/api/admin/access/route.ts'
$legacyAdminRoute = Read-ProjectFile 'app/api/admin/route.ts'
$testSource = Read-ProjectFile 'scripts/test-admin-auth-flow.mjs'

if ($adminAuth.Contains('export function createAdminInviteUrl(')) {
  throw 'The invite URL helper already exists. No files were written.'
}
if (-not $platformVersion.Contains('auditLog.findFirst')) {
  throw 'The platform version source differs from the expected original. No files were written.'
}
if (-not $liveSync.Contains('window.location.reload();')) {
  throw 'The live platform sync source differs from the expected original. No files were written.'
}
if ($testSource.Contains('"components/Common/LivePlatformSync.tsx"')) {
  throw 'The test file already contains the new refresh assertions. No files were written.'
}

# Create invite URLs from the configured public origin; never expose the internal localhost URL in production.
$inviteHelper = @'

export function createAdminInviteUrl(token: string, requestUrl?: string) {
  const configuredUrl = process.env.DUELPLAY_PUBLIC_URL?.trim() || (process.env.NODE_ENV === "production" ? "" : process.env.NEXT_PUBLIC_APP_URL?.trim());
  let origin = "";

  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
      if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !(process.env.NODE_ENV === "production" && localHost)) origin = parsed.origin;
    } catch {}
  }

  if (!origin && process.env.NODE_ENV === "production") {
    origin = "https://duelplaygame.com";
  }

  if (!origin && requestUrl) {
    try { origin = new URL(requestUrl).origin; } catch {}
  }

  if (!origin) origin = "http://localhost:3000";
  return new URL(`/admin/setup?token=${encodeURIComponent(token)}`, origin).toString();
}
'@
$adminAuth = $adminAuth.TrimEnd() + "`n" + $inviteHelper.TrimEnd() + "`n"

$accessRoute = Replace-ExactlyOnce $accessRoute 'import { ADMIN_INVITE_PREFIX, newAdminInviteToken } from "@/lib/admin-auth";' 'import { ADMIN_INVITE_PREFIX, newAdminInviteToken, createAdminInviteUrl } from "@/lib/admin-auth";' 'Admin Center invite helper import'
$accessRoute = Replace-ExactlyOnce $accessRoute 'adminInviteUrl = new URL(`/admin/setup?token=${inviteToken}`, request.url).toString();' 'adminInviteUrl = createAdminInviteUrl(inviteToken, request.url);' 'Admin Center invite URL'

$legacyAdminRoute = Replace-ExactlyOnce $legacyAdminRoute 'import { getCurrentAdminSession, ADMIN_INVITE_PREFIX, newAdminInviteToken } from "@/lib/admin-auth";' 'import { getCurrentAdminSession, ADMIN_INVITE_PREFIX, newAdminInviteToken, createAdminInviteUrl } from "@/lib/admin-auth";' 'legacy Admin invite helper import'
# The same URL expression occurs twice in the legacy route: role-change and explicit invite issue.
# Replace both matching substrings in one guarded operation; the second keeps its existing `const` prefix.
$legacyInviteUrlPattern = 'adminInviteUrl=new URL(`/admin/setup?token=${inviteToken}`,request.url).toString();'
$legacyInviteUrlCount = ([regex]::Matches($legacyAdminRoute, [regex]::Escape($legacyInviteUrlPattern))).Count
if ($legacyInviteUrlCount -ne 2) {
  throw "Expected exactly two legacy invite URL expressions, found $legacyInviteUrlCount. No files were written."
}
$legacyAdminRoute = $legacyAdminRoute.Replace($legacyInviteUrlPattern, 'adminInviteUrl=createAdminInviteUrl(inviteToken, request.url);')

$newPlatformVersion = @'
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedPlatformVersion: string | null = null;

export async function getPlatformVersion() {
  if (cachedPlatformVersion) return cachedPlatformVersion;

  const configuredVersion = process.env.DUELPLAY_BUILD_VERSION?.trim();
  if (configuredVersion) {
    cachedPlatformVersion = configuredVersion;
    return cachedPlatformVersion;
  }

  try {
    const buildId = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    if (buildId) {
      cachedPlatformVersion = buildId;
      return cachedPlatformVersion;
    }
  } catch {
    // During development or before a production build, use a stable fallback.
  }

  cachedPlatformVersion = process.env.NODE_ENV === "production" ? "unknown" : "development";
  return cachedPlatformVersion;
}
'@

$newLiveSync = @'
"use client";

import { useEffect, useRef, useState } from "react";

export default function LivePlatformSync() {
  const versionRef = useRef("");
  const initializedRef = useRef(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    let loading = false;

    const check = async () => {
      if (disposed || loading || document.visibilityState === "hidden") return;
      loading = true;

      try {
        const response = await fetch(`/api/platform-version?ts=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;

        const data = await response.json();
        const nextVersion = String(data.version || "");
        if (!nextVersion) return;

        if (!initializedRef.current) {
          versionRef.current = nextVersion;
          initializedRef.current = true;
          return;
        }

        if (versionRef.current && nextVersion !== versionRef.current) {
          versionRef.current = nextVersion;
          setUpdateAvailable(true);
        }
      } catch {
        // Temporary network failure: keep checking.
      } finally {
        loading = false;
      }
    };

    void check();
    const timer = window.setInterval(() => { void check(); }, 15000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-[200] w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#09090c]/95 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black">Доступно обновление DuelPlay</div>
          <p className="mt-1 text-sm leading-5 text-zinc-400">Новая версия готова. Страница не будет перезагружаться автоматически — обновись, когда будет удобно.</p>
        </div>
        <button type="button" aria-label="Скрыть сообщение об обновлении" onClick={() => setUpdateAvailable(false)} className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-white/10 hover:text-white">×</button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setUpdateAvailable(false)} className="rounded-xl border border-white/10 px-3 py-2 text-sm font-bold text-zinc-300 hover:bg-white/5">Позже</button>
        <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-black text-black">Обновить страницу</button>
      </div>
    </div>
  );
}
'@

$testFilesReplacement = @'
  "app/api/admin/access/route.ts",
  "lib/platform-version.ts",
  "components/Common/LivePlatformSync.tsx",
'@
$testSource = Replace-ExactlyOnce $testSource '  "app/api/admin/access/route.ts",' $testFilesReplacement.TrimEnd() 'test file list additions'
$testDeclarationsReplacement = @'
const setupPage = readFileSync("app/admin/setup/page.tsx", "utf8");
const versionSource = readFileSync("lib/platform-version.ts", "utf8");
const syncSource = readFileSync("components/Common/LivePlatformSync.tsx", "utf8");
'@
$testSource = Replace-ExactlyOnce $testSource 'const setupPage = readFileSync("app/admin/setup/page.tsx", "utf8");' $testDeclarationsReplacement.TrimEnd() 'test source additions'
$testAssertionsReplacement = @'
assert.match(role, /passwordHash:needsInvite\?null/);
assert.match(adminLib, /createAdminInviteUrl/);
assert.match(adminLib, /https:\/\/duelplaygame\.com/);
assert.match(access, /createAdminInviteUrl/);
assert.match(role, /createAdminInviteUrl/);
assert.match(versionSource, /BUILD_ID/);
assert.doesNotMatch(versionSource, /auditLog\.findFirst/);
assert.match(syncSource, /Доступно обновление DuelPlay/);
assert.match(syncSource, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
'@
$testSource = Replace-ExactlyOnce $testSource 'assert.match(role, /passwordHash:needsInvite\?null/);' $testAssertionsReplacement.TrimEnd() 'new invite and client refresh tests' 

$updates = [ordered]@{
  'lib/admin-auth.ts' = $adminAuth
  'lib/platform-version.ts' = $newPlatformVersion.Trim() + "`n"
  'components/Common/LivePlatformSync.tsx' = $newLiveSync.Trim() + "`n"
  'app/api/admin/access/route.ts' = $accessRoute
  'app/api/admin/route.ts' = $legacyAdminRoute
  'scripts/test-admin-auth-flow.mjs' = $testSource
}

# All expected source patterns were checked before any write. Make a backup before applying the patch.
$backupDir = Join-Path $env:TEMP ('DuelPlay-backup-invite-refresh-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($relative in $updates.Keys) {
  $sourcePath = Join-Path $root $relative
  $backupPath = Join-Path $backupDir $relative
  $parent = Split-Path -Parent $backupPath
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $backupPath
}
try {
  foreach ($relative in $updates.Keys) {
    [System.IO.File]::WriteAllText((Join-Path $root $relative), [string]$updates[$relative], $utf8NoBom)
  }
} catch {
  foreach ($relative in $updates.Keys) {
    $backupPath = Join-Path $backupDir $relative
    if (Test-Path -LiteralPath $backupPath) {
      Copy-Item -LiteralPath $backupPath -Destination (Join-Path $root $relative) -Force
    }
  }
  throw "Patch application failed; original files were restored from $backupDir. $($_.Exception.Message)"
}

Write-Host "Patch applied. Original files backed up to: $backupDir" -ForegroundColor Green
Write-Host "Changed files:" -ForegroundColor Cyan
$updates.Keys | ForEach-Object { Write-Host "  $_" }
Write-Host "Next: run npm run build and node scripts/test-admin-auth-flow.mjs. Do not push until both pass." -ForegroundColor Yellow
