$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$livePath = Join-Path $root 'components/Common/LivePlatformSync.tsx'
$testPath = Join-Path $root 'scripts/test-admin-auth-flow.mjs'
if (!(Test-Path -LiteralPath $livePath -PathType Leaf) -or !(Test-Path -LiteralPath $testPath -PathType Leaf)) {
  throw 'Run this script from the DuelPlay project root. No files were written.'
}
$live = [System.IO.File]::ReadAllText($livePath)
$test = [System.IO.File]::ReadAllText($testPath)
if (!$live.Contains('window.location.reload()') -or !$live.Contains('updateAvailable')) {
  throw 'LivePlatformSync is not the expected patched version. No files were written.'
}
function Replace-Once([string]$Content, [string]$Pattern, [string]$Replacement, [string]$Description, [System.Text.RegularExpressions.RegexOptions]$Options = [System.Text.RegularExpressions.RegexOptions]::None) {
  $count = [System.Text.RegularExpressions.Regex]::Matches($Content, $Pattern, $Options).Count
  if ($count -ne 1) { throw "Expected exactly one match for '$Description', found $count. No files were written." }
  $match = [System.Text.RegularExpressions.Regex]::Match($Content, $Pattern, $Options)
  return $Content.Substring(0, $match.Index) + $match.Result($Replacement) + $Content.Substring($match.Index + $match.Length)
}
$single = [System.Text.RegularExpressions.RegexOptions]::Singleline
$live = Replace-Once $live '<div className="text-sm font-black">.*?</div>' '<div className="text-sm font-black">{"\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 DuelPlay"}</div>' 'update heading' $single
$live = Replace-Once $live '<p className="mt-1 text-sm leading-5 text-zinc-400">.*?</p>' '<p className="mt-1 text-sm leading-5 text-zinc-400">{"\u041D\u043E\u0432\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F \u0433\u043E\u0442\u043E\u0432\u0430. \u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0442\u044C\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u2014 \u043E\u0431\u043D\u043E\u0432\u0438\u0441\u044C, \u043A\u043E\u0433\u0434\u0430 \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u043E\u0431\u043D\u043E."}</p>' 'update description' $single
$live = Replace-Once $live 'aria-label="[^"]*"(?= onClick=\{\(\) => setUpdateAvailable\(false\)\})' 'aria-label={"\u0421\u043A\u0440\u044B\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0431 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438"}' 'update close aria label'
$live = Replace-Once $live '(<button type="button" aria-label=\{.*?className="rounded-lg[^\"]*">).*?(</button>)' '$1{"\u00D7"}$2' 'update close button text' $single
$live = Replace-Once $live '(<button type="button" onClick=\{\(\) => setUpdateAvailable\(false\)\} className="rounded-xl border[^\"]*">).*?(</button>)' '$1{"\u041F\u043E\u0437\u0436\u0435"}$2' 'later button text' $single
$live = Replace-Once $live '(<button type="button" onClick=\{\(\) => window\.location\.reload\(\)\} className="rounded-xl bg-\[var\(--theme-accent\)\][^\"]*">).*?(</button>)' '$1{"\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443"}$2' 'refresh button text' $single
$test = Replace-Once $test '(?m)^assert\.match\(syncSource, /(?!onClick).*?\);\r?$' 'assert.match(syncSource, /updateAvailable/);' 'static refresh assertion' ([System.Text.RegularExpressions.RegexOptions]::Multiline)
$backupDir = Join-Path $env:TEMP ('DuelPlay-backup-encoding-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
Copy-Item -LiteralPath $livePath -Destination (Join-Path $backupDir 'LivePlatformSync.tsx')
Copy-Item -LiteralPath $testPath -Destination (Join-Path $backupDir 'test-admin-auth-flow.mjs')
[System.IO.File]::WriteAllText($livePath, $live, $utf8NoBom)
[System.IO.File]::WriteAllText($testPath, $test, $utf8NoBom)
Write-Output "Encoding correction applied. Original files backed up to: $backupDir"
Write-Output 'Changed files:'
Write-Output '  components/Common/LivePlatformSync.tsx'
Write-Output '  scripts/test-admin-auth-flow.mjs'
Write-Output 'Next: run node scripts/test-admin-auth-flow.mjs and npm run build. Do not push until both pass.'
