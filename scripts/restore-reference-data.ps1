param([string]$Python = '', [string]$Proxy = '', [switch]$SkipDownload)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectDirectory
if (-not $Python) {
    $pythonCommand = Get-Command python.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($pythonCommand) { $Python = $pythonCommand.Source }
    if ($env:USERPROFILE) {
        $bundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
        if (Test-Path -LiteralPath $bundledPython -PathType Leaf) { $Python = $bundledPython }
    }
}
if (-not $Python) { throw 'Python 3 is required. Pass -Python with the path to your Python executable.' }
& $Python -c 'import pypdf, PIL, numpy'
if ($LASTEXITCODE -ne 0) { throw 'This Python needs pypdf, Pillow and numpy. Install them in your chosen Python environment, then rerun.' }
if (-not $SkipDownload) {
    & (Join-Path $PSScriptRoot 'fetch-reference-charts.ps1') -Proxy $Proxy
    if ($LASTEXITCODE -ne 0) { throw 'Reference download failed.' }
}
foreach ($script in @('transcribe-reference-rfi.py', 'transcribe-reference-responses.py', 'transcribe-pokercoaching.py', 'transcribe-reference-later.py')) {
    & $Python (Join-Path $PSScriptRoot $script)
    if ($LASTEXITCODE -ne 0) { throw "Transcription failed: $script" }
}
Write-Host 'Reference charts restored locally. Refresh the application. Solver datasets are reproduced separately with solve-local-preflop.py.'
