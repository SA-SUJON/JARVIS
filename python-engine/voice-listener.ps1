param([string]$Language = 'en')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
if ($null -eq $recognizers -or $recognizers.Count -eq 0) {
  throw 'No Windows speech recognizer is installed. Install the requested speech language pack in Windows Settings > Time & language > Language & region.'
}

$requested = ($Language -replace '_', '-').Trim()
$preferred = $recognizers | Where-Object { $_.Culture.Name -ieq $requested -or $_.Culture.Name -ilike "$requested-*" -or $_.Culture.TwoLetterISOLanguageName -ieq $requested } | Select-Object -First 1
if ($null -eq $preferred -and $requested -in @('en', '')) { $preferred = $recognizers | Where-Object { $_.Culture.Name -in @('en-US', 'en-GB') } | Select-Object -First 1 }
if ($null -eq $preferred) {
  $available = ($recognizers | ForEach-Object { $_.Culture.Name }) -join ', '
  throw "No installed Windows speech recognizer matches '$requested'. Installed recognizers: $available"
}

$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($preferred.Culture)
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
try { $recognizer.SetInputToDefaultAudioDevice() } catch { throw "Default microphone unavailable: $($_.Exception.Message)" }
[Console]::WriteLine((@{ event = 'ready'; culture = $preferred.Culture.Name; recognizer = $preferred.Name } | ConvertTo-Json -Compress))
[Console]::Out.Flush()

while ($true) {
  try {
    $result = $recognizer.Recognize()
    if ($null -ne $result -and $result.Text.Trim().Length -gt 0) {
      [Console]::WriteLine((@{ event = 'transcript'; text = $result.Text.Trim(); confidence = [math]::Round($result.Confidence, 3) } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
  } catch {
    [Console]::WriteLine((@{ event = 'error'; message = $_.Exception.Message } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 700
  }
}
