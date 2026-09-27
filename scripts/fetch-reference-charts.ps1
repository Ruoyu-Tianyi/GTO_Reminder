param([string]$Proxy = '')
$ErrorActionPreference = 'Stop'
$referenceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../data/private/research'))
New-Item -ItemType Directory -Force -Path $referenceRoot | Out-Null
$charts = @(
    @{
        File = 'rangeconverter-6max-100bb.pdf'
        Url = 'https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash'
        Hash = '60da589b490f5c90cf106b18870956d09f0ac257fec4dce516a86f724280a967'
    },
    @{
        File = 'pokercoaching-ultimate-cash.pdf'
        Url = 'https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf'
        Hash = '2927bdf938a52d95aa53716e5bf61705216da8685d17572775c6f11a0ecd7df9'
    },
    @{
        File = 'rangeconverter-9max-100bb.pdf'
        Url = 'https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash'
        Hash = '0feb70db01ab74db6d6a8cb6e9761358f6eb04879468452f8429e027c6770b27'
    }
)
foreach ($chart in $charts) {
    $target = Join-Path $referenceRoot $chart.File
    if (Test-Path -LiteralPath $target) {
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $chart.Hash) {
            Write-Output "Verified: $($chart.File)"
            continue
        }
        throw "Existing file differs from the reviewed edition: $target. Review it before replacing it."
    }
    $temporary = "$target.download"
    $download = @{ Uri = $chart.Url; OutFile = $temporary; UseBasicParsing = $true; TimeoutSec = 180 }
    if ($Proxy) { $download.Proxy = $Proxy }
    Invoke-WebRequest @download
    if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $chart.Hash) {
        throw "The provider changed $($chart.File). The new download was left as .download for review; page indexes may no longer apply."
    }
    Move-Item -LiteralPath $temporary -Destination $target
    Write-Output "Downloaded and verified: $($chart.File)"
}
Write-Output 'Reference PDFs are local only. Start the development app and open Browse charts.'
