# Registra o MD Reader no menu "Abrir com" do Windows Explorer (somente HKCU).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\register-open-with.ps1 [-ExePath "C:\...\MD Reader.exe"] [-Unregister]

param(
    [string]$ExePath = "",
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$extensions = @('.md', '.markdown', '.mdown', '.mkd')
$appKeyName = 'MDReader.exe'
$progId = 'MDReader.Document'

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
    Write-Host "MD Reader removido do 'Abrir com'."
    return
}

if (-not $ExePath) {
    $ExePath = Join-Path $PSScriptRoot '..\release\win-unpacked\MD Reader.exe'
}
$ExePath = (Resolve-Path $ExePath).Path
if (-not (Test-Path $ExePath)) { throw "Executável não encontrado: $ExePath" }

$command = '"' + $ExePath + '" "%1"'

# ProgId: define ícone, nome amigável e comando de abertura.
New-Item -Path "HKCU:\Software\Classes\$progId\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId" -Name '(default)' -Value 'Documento Markdown'
New-Item -Path "HKCU:\Software\Classes\$progId\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId\DefaultIcon" -Name '(default)' -Value "$ExePath,0"
Set-ItemProperty -Path "HKCU:\Software\Classes\$progId\shell\open\command" -Name '(default)' -Value $command

# Applications\MDReader.exe: é o que faz o app aparecer na lista "Abrir com".
$appKey = "HKCU:\Software\Classes\Applications\$appKeyName"
New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'MD Reader'
Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(default)' -Value $command
New-Item -Path "$appKey\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$appKey\DefaultIcon" -Name '(default)' -Value "$ExePath,0"
New-Item -Path "$appKey\SupportedTypes" -Force | Out-Null
foreach ($ext in $extensions) {
    Set-ItemProperty -Path "$appKey\SupportedTypes" -Name $ext -Value ''
    New-Item -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Name $progId -Value ([byte[]]@()) -Type Binary
}

# Avisa o Explorer para recarregar as associações.
Add-Type -Namespace Win32 -Name Shell -MemberDefinition @"
[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
"@
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "MD Reader registrado no 'Abrir com' para: $($extensions -join ', ')"
Write-Host "Executável: $ExePath"
