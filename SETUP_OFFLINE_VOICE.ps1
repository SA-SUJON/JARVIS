$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$piperDir = Join-Path $root 'models\piper'
$kokoroDir = Join-Path $root 'models\kokoro'
New-Item -ItemType Directory -Force -Path $piperDir, $kokoroDir | Out-Null

Write-Host 'JARVIS // OFFLINE VOICE SETUP' -ForegroundColor Cyan

$piperZip = Join-Path $env:TEMP 'piper_windows_amd64.zip'
Invoke-WebRequest -Uri 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' -OutFile $piperZip
Expand-Archive -Force $piperZip (Join-Path $env:TEMP 'jarvis-piper')
Copy-Item -Recurse -Force (Join-Path $env:TEMP 'jarvis-piper\piper\*') $piperDir
Invoke-WebRequest -Uri 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx?download=true' -OutFile (Join-Path $piperDir 'en_GB-alan-medium.onnx')
Invoke-WebRequest -Uri 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json?download=true' -OutFile (Join-Path $piperDir 'en_GB-alan-medium.onnx.json')

Invoke-WebRequest -Uri 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx' -OutFile (Join-Path $kokoroDir 'kokoro-v1.0.onnx')
Invoke-WebRequest -Uri 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin' -OutFile (Join-Path $kokoroDir 'voices-v1.0.bin')

if (Get-Command py -ErrorAction SilentlyContinue) {
  py -3.12 -m pip install --upgrade kokoro-onnx soundfile
} else {
  Write-Warning 'Python launcher `py` was not found. Install Python 3.12, then run: py -3.12 -m pip install --upgrade kokoro-onnx soundfile'
}

Write-Host 'Offline voice assets installed. Restart JARVIS and use SYSTEM > TEST VOICE.' -ForegroundColor Green
