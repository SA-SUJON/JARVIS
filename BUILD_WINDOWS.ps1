$ErrorActionPreference = 'Stop'
Write-Host 'JARVIS // WINDOWS BUILD PIPELINE' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required.' }
node --version
npm --version
npm install --no-audit --no-fund
npm run check
npm run dist
Write-Host 'Installer created under .\release' -ForegroundColor Green
