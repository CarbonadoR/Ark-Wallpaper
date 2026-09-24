param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

try {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    & $node -e "const [a,b]=process.versions.node.split('.').map(Number);if(!((a===20&&b>=19)||(a===22&&b>=12)||a>=24))process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 22.12+ or 24 LTS, then reopen this launcher.' }
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    $npmCandidates = @(
        (Join-Path (Split-Path -Parent $npmCommand) 'node_modules\npm\bin\npm-cli.js'),
        (Join-Path (Split-Path -Parent $node) 'node_modules\npm\bin\npm-cli.js')
    )
    $npmCli = $npmCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $npmCli) { throw 'Cannot locate npm-cli.js. Install Node.js with npm included.' }

    $localConfig = Join-Path $PSScriptRoot 'config\runtime.local.json'
    if (-not (Test-Path -LiteralPath $localConfig)) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'config\runtime.example.json') -Destination $localConfig
    }
    $runtimeText = & $node --input-type=module -e "import {config} from './server/config.mjs'; console.log(JSON.stringify({host:config.host,port:config.port}));"
    if ($LASTEXITCODE -ne 0) { throw 'Resource configuration is invalid. Add arts/charpack/skinpack/chartable or edit config/runtime.local.json. See README-WINDOWS.txt.' }
    $runtime = $runtimeText | ConvertFrom-Json
    if ($runtime.host -notin @('127.0.0.1','localhost','::1')) { throw 'The resource service must use a loopback host.' }
    $hostPart = if ($runtime.host -eq '::1') { '[::1]' } else { $runtime.host }

    $lockHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'package-lock.json') -Algorithm SHA256).Hash
    $marker = Join-Path $PSScriptRoot 'node_modules\.release-dependencies.sha256'
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $lockHash) {
        Write-Host 'Installing dependencies and applying the Spine patch (first launch requires internet)...'
        & $node $npmCli ci --include=dev --ignore-scripts=false
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check network access and retry the launcher.' }
        [IO.File]::WriteAllText($marker, $lockHash)
    }

    $launch = @{
        projectRoot = $PSScriptRoot
        nodePath = $node
        npmCliPath = $npmCli
        serverUrl = 'http://' + $hostPart + ':' + $runtime.port
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'app\launch.local.json'), $launch, (New-Object Text.UTF8Encoding($false)))
    if ($PrepareOnly) { Write-Host 'Launch configuration prepared.'; exit 0 }
    Start-Process -FilePath (Join-Path $PSScriptRoot 'app\ArkWallpaper.exe') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
