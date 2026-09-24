param([ValidatePattern('^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$')][string]$Version = '0.1.0')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (git status --porcelain) { throw 'Commit all source changes before packaging a release.' }
$commit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine the source commit.' }
$releaseRoot = Join-Path $projectRoot ('build\releases\v' + $Version + '\' + $commit.Substring(0, 8))
if (Test-Path -LiteralPath $releaseRoot) { throw 'Release directory already exists. Inspect existing artifacts before packaging again.' }
New-Item -ItemType Directory -Path $releaseRoot | Out-Null

& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
$sourceZip = Join-Path $releaseRoot 'source.zip'
git archive --format=zip "--output=$sourceZip" HEAD
if ($LASTEXITCODE -ne 0) { throw 'Source archive failed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$checksums = @()
foreach ($arch in @('x64','arm64')) {
    $stage = Join-Path $releaseRoot ('stage-' + $arch)
    [IO.Compression.ZipFile]::ExtractToDirectory($sourceZip, $stage)
    Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $stage -Recurse
    foreach ($name in @('Start-Wallpaper.cmd','Start-Wallpaper.ps1','README-WINDOWS.txt')) {
        Copy-Item -LiteralPath (Join-Path $stage ('windows\release\' + $name)) -Destination $stage
    }
    $native = Join-Path $stage 'app'
    & dotnet publish windows/ArkWallpaper/ArkWallpaper.csproj -c Release -r "win-$arch" --self-contained true -o $native -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw "Native $arch build failed." }
    $info = @{ version = $Version; commit = $commit; architecture = $arch } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $stage 'release-info.json'), $info, (New-Object Text.UTF8Encoding($false)))
    $forbidden = Get-ChildItem -LiteralPath $stage -Recurse -Force | Where-Object {
        $_.Name -in @('AGENTS.md','launch.local.json','runtime.local.json','metadata.local.json','scenes.local.json','node_modules','.git') -or
        $_.Extension -in @('.log','.pdb') -or
        ($_.PSIsContainer -and $_.Name -in @('arts','charpack','skinpack','chartable'))
    }
    if ($forbidden) { throw 'Release staging contains local configuration, resources or build diagnostics.' }
    $filename = "Ark-Wallpaper-v$Version-windows-$arch.zip"
    $archive = Join-Path $releaseRoot $filename
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
    $checksums += (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $filename
    Write-Host "Packaged $filename"
}
[IO.File]::WriteAllLines((Join-Path $releaseRoot 'SHA256SUMS.txt'), [string[]]$checksums, (New-Object Text.UTF8Encoding($false)))
Write-Host "Release artifacts: $releaseRoot"
