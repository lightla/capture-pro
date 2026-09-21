param(
  [string]$SourceExe = "",
  [string]$OutDir = ""
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = (Join-Path $PSScriptRoot '..\\dist-bin')
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Resolve-DefaultExePath {
  $candidates = @(
    (Join-Path $PSScriptRoot 'target\\release\\capture-pro.exe'),
    (Join-Path $PSScriptRoot 'target\\release\\CapturePro.exe'),
    (Join-Path $PSScriptRoot 'target\\release\\tauri-app.exe')
  )
  foreach ($p in $candidates) {
    if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).Path }
  }

  $exes = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'target\\release') -Filter *.exe -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '^(build-script-|cargo-|rustc-|clippy-|vcpkg)' } |
    Sort-Object Length -Descending
  if ($exes -and $exes.Count -gt 0) {
    return $exes[0].FullName
  }

  throw "Could not find built exe under src-tauri\\target\\release"
}

if ([string]::IsNullOrWhiteSpace($SourceExe)) {
  $SourceExe = Resolve-DefaultExePath
} else {
  $SourceExe = (Resolve-Path -LiteralPath $SourceExe).Path
}

$dest = Join-Path (Resolve-Path -LiteralPath $OutDir).Path 'CapturePro.exe'
Copy-Item -LiteralPath $SourceExe -Destination $dest -Force
Write-Host \"Wrote $dest\"
