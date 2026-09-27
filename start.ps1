param([ValidateRange(1024, 65535)][int]$Port = 5173)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# A normal PowerShell window does not inherit the Codex runtime's PATH.
$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $nodeExecutable) {
    $nodeCandidates = @()
    foreach ($baseDirectory in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($baseDirectory) { $nodeCandidates += Join-Path $baseDirectory 'nodejs/node.exe' }
    }
    if ($env:LOCALAPPDATA) { $nodeCandidates += Join-Path $env:LOCALAPPDATA 'Programs/nodejs/node.exe' }
    if ($env:USERPROFILE) {
        $nodeCandidates += Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    }
    $nodeExecutable = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $nodeExecutable) {
    throw 'Node.js was not found. Install Node.js 22 LTS (including npm), reopen PowerShell, and run this script again.'
}

$nodeDirectory = Split-Path -Parent $nodeExecutable
$originalPath = $env:Path
try {
    # Child processes need Node too. This changes only this process, not Windows settings.
    $env:Path = "$nodeDirectory;$originalPath"
    $viteEntry = Join-Path $PSScriptRoot 'node_modules/vite/bin/vite.js'
    if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) {
        $npmCandidates = @(
            (Join-Path $nodeDirectory 'node_modules/npm/bin/npm-cli.js'),
            (Join-Path $PSScriptRoot '.runtime/npm/package/bin/npm-cli.js')
        )
        $npmEntry = $npmCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
        if ($npmEntry) { & $nodeExecutable $npmEntry install }
        elseif ($npmCommand) { & $npmCommand.Source install }
        else { throw 'Dependencies are missing and npm was not found. Install Node.js with npm, then run this script again.' }
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    Write-Host 'Starting GTO Reminder. Open the Local address below; press Ctrl+C to stop.'
    & $nodeExecutable $viteEntry --host 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) { throw "The development server exited with code $LASTEXITCODE." }
} finally {
    $env:Path = $originalPath
}
