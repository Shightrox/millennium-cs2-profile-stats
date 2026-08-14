[CmdletBinding()]
param(
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $repositoryRoot 'plugin.json'
$packagePath = Join-Path $repositoryRoot 'package.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json

if ($manifest.version -ne $package.version) {
    throw 'plugin.json and package.json versions must match.'
}

if (-not $SkipBuild) {
    Push-Location $repositoryRoot
    try {
        pnpm typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Type-check failed.' }
        pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    }
    finally {
        Pop-Location
    }
}

$artifactsDirectory = Join-Path $repositoryRoot 'artifacts'
$stagingDirectory = Join-Path $artifactsDirectory '.staging-cs2-profile-stats'
$pluginDirectory = Join-Path $stagingDirectory $manifest.name
$archivePath = Join-Path $artifactsDirectory ("{0}-v{1}.zip" -f $manifest.name, $manifest.version)

if (-not $stagingDirectory.StartsWith($artifactsDirectory, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to use a staging directory outside artifacts.'
}

if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

New-Item -ItemType Directory -Path (Join-Path $pluginDirectory '.millennium\Dist') -Force | Out-Null

$files = @('plugin.json', 'README.md', 'CHANGELOG.md', 'LICENSE')
foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot $file) -Destination $pluginDirectory
}

Copy-Item -LiteralPath (Join-Path $repositoryRoot 'backend') -Destination $pluginDirectory -Recurse
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'static') -Destination $pluginDirectory -Recurse
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'assets') -Destination $pluginDirectory -Recurse
Copy-Item -Path (Join-Path $repositoryRoot '.millennium\Dist\*') -Destination (Join-Path $pluginDirectory '.millennium\Dist')

Compress-Archive -LiteralPath $pluginDirectory -DestinationPath $archivePath -CompressionLevel Optimal
Remove-Item -LiteralPath $stagingDirectory -Recurse -Force

Write-Output $archivePath
