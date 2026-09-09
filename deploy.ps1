# ZergDesk deploy - run when the watch clock is inside the cert window (e.g. 1 June 2021)
# Usage: .\deploy.ps1 [-ip 192.168.1.141]
param([string]$ip = "192.168.1.141")

$sdb   = 'D:\tizen-studio\tools\sdb.exe'
$tizen = 'D:\tizen-studio\tools\ide\bin\tizen.bat'
$root  = 'd:\git\gearfit'

Write-Host "Connecting to watch at $ip ..."
& $sdb connect "${ip}:26101" | Out-Null
Start-Sleep -Seconds 1

$dateRaw = & $sdb -s "${ip}:26101" shell "date" 2>$null | Out-String
Write-Host "Watch clock says: $dateRaw"

if ($dateRaw -match "2021|2022") {
    Set-Location $root
    Write-Host "Clock OK - building..."
    & $tizen build-web -- app 2>&1 | Out-Null
    Remove-Item 'app\.buildResult','app\author-signature.xml','app\signature1.xml','app\ZergDesk.wgt','app\.manifest.tmp' -Recurse -Force -ErrorAction SilentlyContinue
    & $tizen package -t wgt -s GWD2021 -- app 2>&1 | Out-Null
    if (Test-Path "$root\app\ZergDesk.wgt") {
        Write-Host "Signed package ready - installing..."
        & $sdb -s "${ip}:26101" install "$root\app\ZergDesk.wgt"
    } else {
        Write-Host "Package failed - check tizen output above."
    }
} else {
    Write-Host ""
    Write-Host "Watch clock is NOT in the cert window. Set the paired phone's date to 1 June 2021,"
    Write-Host "restart the watch (or toggle its Bluetooth) so it re-syncs, then run this again."
}
