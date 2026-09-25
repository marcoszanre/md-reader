# Registers MD Reader in the Windows Explorer "Open with" menu (HKCU only).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\register-open-with.ps1 [-ExePath "C:\path\to\MD Reader.exe"] [-Unregister]

param(
    [string]$ExePath = "",
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$extensions = @('.md', '.markdown', '.mdown', '.mkd')
$appKeyName = 'MDReader.exe'
$progId = 'MDReader.Document'

# New-Item -Force on an existing registry key recreates it and deletes its values (for example,
# other apps' OpenWithProgids entries), so keys are only created when missing.
function Ensure-Key($path) {
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
}

function Remove-KeyIfExists($path) {
    if (Test-Path $path) { Remove-Item -Path $path -Recurse -Force }
}

if ($Unregister) {
    Remove-KeyIfExists "HKCU:\Software\Classes\Applications\$appKeyName"
    Remove-KeyIfExists "HKCU:\Software\Classes\$progId"
    foreach ($ext in $extensions) {
        $owp = "HKCU:\Software\Classes\$ext\OpenWithProgids"
        if (Test-Path $owp) { Remove-ItemProperty -Path $owp -Name $progId -ErrorAction SilentlyContinue }
    }
    Write-Host "MD Reader removed from 'Open with'."
    return
}

if (-not $ExePath) {
    $ExePath = Join-Path $PSScriptRoot '..\release\win-unpacked\MD Reader.exe'
}
$ExePath = (Resolve-Path $ExePath).Path
if (-not (Test-Path $ExePath)) { throw "Executable not found: $ExePath" }

$command = '"' + $ExePath + '" "%1"'

# ProgId: defines the icon, friendly name, and open command.
Ensure-Key "HKCU:\Software\Classes\$progId\shell\open\command"
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId" -Name '(default)' -Value 'Markdown document'
Ensure-Key "HKCU:\Software\Classes\$progId\DefaultIcon"
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId\DefaultIcon" -Name '(default)' -Value "$ExePath,0"
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId\shell\open\command" -Name '(default)' -Value $command

# Applications\MDReader.exe makes the app appear in the "Open with" list.
$appKey = "HKCU:\Software\Classes\Applications\$appKeyName"
Ensure-Key "$appKey\shell\open\command"
Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'MD Reader'
Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(default)' -Value $command
Ensure-Key "$appKey\DefaultIcon"
Set-ItemProperty -Path "$appKey\DefaultIcon" -Name '(default)' -Value "$ExePath,0"
Ensure-Key "$appKey\SupportedTypes"
foreach ($ext in $extensions) {
    Set-ItemProperty -Path "$appKey\SupportedTypes" -Name $ext -Value ''
    Ensure-Key "HKCU:\Software\Classes\$ext\OpenWithProgids"
    Set-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Name $progId -Value ([byte[]]@()) -Type Binary
}

# Notifies Explorer to reload file associations.
Add-Type -Namespace Win32 -Name Shell -MemberDefinition @"
[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
"@
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "MD Reader registered in 'Open with' for: $($extensions -join ', ')"
Write-Host "Executable: $ExePath"
