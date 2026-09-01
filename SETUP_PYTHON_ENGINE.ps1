$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$engine = Join-Path $root 'python-engine'
$venv = Join-Path $engine '.venv'
Write-Host 'JARVIS Python engine setup' -ForegroundColor Cyan
if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python 3.11+ is required. Install Python from python.org and enable the launcher.' }
$python = if (Test-Path (Join-Path $venv 'Scripts/python.exe')) { Join-Path $venv 'Scripts/python.exe' } elseif (Get-Command py -ErrorAction SilentlyContinue) { 'py' } else { 'python' }
if (-not (Test-Path (Join-Path $venv 'Scripts/python.exe'))) { if ($python -eq 'py') { & py -3 -m venv $venv } else { & python -m venv $venv } }
$python = Join-Path $venv 'Scripts/python.exe'
& $python -m pip install --upgrade pip
& $python -m pip install -r (Join-Path $engine 'Requirements.txt')
Write-Host "Python engine ready at $venv" -ForegroundColor Green
Write-Host 'Run: npm run doctor; npm run build; npm start' -ForegroundColor Yellow
