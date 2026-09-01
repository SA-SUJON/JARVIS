param([string]$Language = 'en')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Emit([hashtable]$Payload) {
  $json = $Payload | ConvertTo-Json -Compress
  [Console]::WriteLine($json)
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Speech
  $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
  if ($recognizers.Count -eq 0) {
    throw 'No Windows speech recognizer is installed. Install an English speech recognition language pack in Windows Settings > Time & language > Language & region.'
  }

  $requested = if ([string]::IsNullOrWhiteSpace($Language)) { 'en' } else { $Language.ToLowerInvariant() }
  $preferred = $recognizers | Where-Object {
    $cultureName = $_.Culture.Name.ToLowerInvariant()
    $isoName = $_.Culture.TwoLetterISOLanguageName.ToLowerInvariant()
    $cultureName -eq $requested -or $cultureName.StartsWith($requested + '-') -or $isoName -eq $requested
  } | Select-Object -First 1
  if ($null -eq $preferred) { $preferred = $recognizers | Where-Object { $_.Culture.Name -in @('en-US', 'en-GB') } | Select-Object -First 1 }
  if ($null -eq $preferred) { $preferred = $recognizers | Select-Object -First 1 }
  if ($null -eq $preferred) { throw "No recognizer matches requested language '$Language'." }

  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($preferred.Culture)
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $recognizer.SetInputToDefaultAudioDevice()
  Emit @{ event = 'ready'; culture = $preferred.Culture.Name; recognizer = $preferred.Name; requestedLanguage = $Language; microphone = 'default-audio-device' }

  while ($true) {
    try {
      $result = $recognizer.Recognize()
      if ($null -ne $result -and -not [string]::IsNullOrWhiteSpace($result.Text)) {
        Emit @{ event = 'transcript'; text = $result.Text.Trim(); confidence = [math]::Round($result.Confidence, 3); culture = $preferred.Culture.Name }
      }
    } catch {
      Emit @{ event = 'error'; message = $_.Exception.Message; category = 'recognition' }
      Start-Sleep -Milliseconds 700
    }
  }
} catch {
  Emit @{ event = 'fatal'; message = $_.Exception.Message; category = 'startup'; type = $_.Exception.GetType().FullName }
  exit 2
}
