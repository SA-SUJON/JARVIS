$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = $null
foreach ($candidate in @('py -3.11', 'py -3', 'python')) {
  try {
    $check = Invoke-Expression "$candidate --version" 2>$null
    if ($LASTEXITCODE -eq 0) { $python = $candidate; break }
  } catch { }
}
if (-not $python) { throw 'Python 3.10+ was not found. Install Python from https://www.python.org/downloads/windows/ and rerun this script.' }

$venv = Join-Path $root 'references\jarvisai\.venv'
if (-not (Test-Path $venv)) { Invoke-Expression "$python -m venv `"$venv`"" }
$venvPython = Join-Path $venv 'Scripts\python.exe'
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $root 'references\jarvisai\Requirements.txt')
& $venvPython -m pip install SpeechRecognition PyAudio
Write-Host "Python STT environment ready: $venvPython" -ForegroundColor Cyan
Write-Host 'JARVIS will automatically use this environment on the next start.' -ForegroundColor Green
