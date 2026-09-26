$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
    if (-not (Test-Path -LiteralPath 'node_modules/vite')) {
        & $npmCommand.Source install
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & $npmCommand.Source run dev
} elseif (Test-Path -LiteralPath '.runtime/npm/package/bin/npm-cli.js') {
    if (-not (Test-Path -LiteralPath 'node_modules/vite')) {
        node .runtime/npm/package/bin/npm-cli.js install
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    node .runtime/npm/package/bin/npm-cli.js run dev
} else {
    throw 'Install Node.js LTS (including npm), reopen PowerShell, and run this script again.'
}
