$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonRoot = Join-Path $ProjectRoot 'references\jarvisai'
$VenvRoot = Join-Path $PythonRoot '.venv'
$PythonExe = Join-Path $VenvRoot 'Scripts\python.exe'

Write-Host 'JARVIS Python capability setup' -ForegroundColor Cyan
if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw 'Python Launcher (py.exe) was not found. Install Python 3.10+ and enable the launcher, then rerun this script.'
}
if (-not (Test-Path $PythonExe)) {
  & py -m venv $VenvRoot
}
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $PythonRoot 'Requirements.txt')
& $PythonExe -m py_compile (Join-Path $PythonRoot 'Backend\ElectronBridge.py') (Join-Path $PythonRoot 'Backend\SpeechToText.py')
Write-Host "Ready. Electron will use $PythonExe automatically. The imported Python modules are supervised by Electron; do not launch Main.py or the PyQt GUI alongside JARVIS." -ForegroundColor Green
