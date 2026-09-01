# Windows voice findings

Microsoft documents that `SpeechRecognitionEngine.SetInputToDefaultAudioDevice()` routes recognition through the default Windows audio input device, and that installed recognizers/language packs are required for recognition. Microsoft’s microphone support guidance requires **Microphone access**, **Let apps access your microphone**, and the desktop-app microphone setting to be enabled under Windows **Settings > Privacy & security > Microphone**.

The JARVIS listener therefore needs to: enumerate/select an installed recognizer, report its culture and microphone device status, set the default audio device explicitly, and emit structured startup errors instead of silently looping.

References:

1. [SpeechRecognitionEngine.SetInputToDefaultAudioDevice](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.setinputtodefaultaudiodevice)
2. [SpeechRecognitionEngine.InstalledRecognizers](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.installedrecognizers)
3. [Turn on app permissions for your microphone in Windows](https://support.microsoft.com/en-us/windows/privacy/turn-on-app-permissions-for-your-microphone-in-windows)
4. [Windows camera, microphone, and privacy](https://support.microsoft.com/en-us/windows/privacy/windows-camera-microphone-and-privacy)
