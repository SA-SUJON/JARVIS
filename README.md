# JARVIS

**JARVIS** is a native Windows Electron command center for multi-provider AI orchestration. The project uses package identity `ORG.JARVIS`, application version `1.0.0`, and the supplied Kinetic Oversight interface references as its visual baseline.

The application keeps provider credentials local. API keys entered in **SYSTEM → NEURAL LINK PARAMETERS** are encrypted with Electron `safeStorage` and written to the per-user application data directory; plaintext keys are not persisted in the renderer. At least one configured provider is required for AI chat. The deterministic utility router handles time, weather, arithmetic, and simple web lookups before consuming model tokens.

## Included capabilities

| Capability | Implementation |
|---|---|
| Native Windows shell | Electron, frameless window controls, NSIS installer metadata |
| Visual system | Kinetic Oversight glassmorphism/brutalism, electric cyan HUD, scanlines, grid, animated gauge and radar |
| Responsive composition | Desktop sidebar and bento grid with narrow-window bottom navigation and stacked mobile panels |
| AI backends | ChatGPT/OpenAI, Gemini, Claude, DeepSeek, Grok, Qwen, Kimi, MiniMax, Perplexity, and configurable Manus endpoint |
| Failover | Priority-aware sequential handover on quota, rate-limit, transport, and common service errors |
| Model discovery | Provider-specific live `/models` discovery, including Gemini and Anthropic metadata contracts |
| Utility routing | Local time, WorldTimeAPI, wttr.in weather, safe arithmetic, and DuckDuckGo instant-answer lookup |
| Voice | Edge TTS primary with Ryan, Thomas, Guy, and Christopher voice choices |
| Offline voice | Piper first, Kokoro second; model binaries and weights are loaded from `models/` |
| Wake word | Browser speech recognition listener detects “Hey JARVIS” and moves the UI into listening state |
| System posture | Approved URL opening and window controls over isolated IPC; no unrestricted shell execution is exposed |

## Quick start on Windows

Install Node.js 22 or newer, open PowerShell in this directory, and run:

```powershell
npm install
npm run dev
```

Create an installer with:

```powershell
npm run dist
```

The installer artifact is emitted to `release/` using the product name **JARVIS** and application ID **ORG.JARVIS**.

## Provider configuration

Open **SYSTEM** in the application. Paste one or more API keys, optionally set a preferred provider, and click **SYNC** to populate the live model index. The orchestration layer uses the configured key set as a failover pool. A provider without a key remains visible but is skipped at runtime. The model index is intentionally live rather than hard-coded; each provider can change its catalog independently. JARVIS now pins the requested stable Gemini model `gemini-3.6-flash` as its default; synchronization still exposes the current Google model catalog so a future model selector can opt into newer entries.

The default provider base URLs are editable in `electron/providers.ts`. OpenAI-compatible providers use `/chat/completions` and `/models`. Gemini uses the native `models.list` and `generateContent` contracts. Anthropic uses `/v1/models` and `/v1/messages`. If a provider changes its endpoint or requires a custom gateway, edit its base URL in the provider registry.

## Voice installation

Edge TTS is attempted first using `node-edge-tts`. For a real offline installation, place a Piper binary and model at:

```text
models/piper/piper.exe
models/piper/en_GB-alan-medium.onnx
```

JARVIS then checks the Kokoro fallback at:

```text
models/kokoro/kokoro.exe
models/kokoro/kokoro-v1.0.onnx
```

The Kokoro executable can also be supplied through the `KOKORO_EXECUTABLE` environment variable. The source package deliberately does not silently download large speech weights; the user controls model provenance and storage.

## Wake word note

The included wake-word path uses Chromium/Electron speech recognition when available and detects the phrase **Hey JARVIS**. For a fully offline production wake-word engine, add a locally licensed Porcupine or open wake-word model and replace the recognition adapter in `src/App.tsx`; the rest of the listening state and command pipeline is already separated behind the same state transition.

## Deployment choices

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---:|---:|
| **Current local Windows app** | Best privacy and latency for keys, local utilities, and offline speech; each user manages provider keys and model files locally | Existing PC plus provider usage | Medium |
| Centralized AI gateway | One server owns provider keys and can coordinate quotas across users; easier catalog updates, but it adds hosting cost, a trust boundary, and a network dependency | Hosting plus provider usage | High |

The current implementation uses the local Windows pattern because the requested product is a native personal assistant with admin-adjacent PC integration and offline voice continuity. The gateway option remains a clean future evolution for team or household deployment.

## No GitHub changes

This deliverable was created locally and was **not committed or pushed to GitHub**.

## Verification status

The renderer and Electron processes compile successfully with `npm run build`, and the deterministic smoke suite passes with `node scripts/smoke-test.mjs`. The source archive includes those compiled outputs. This sandbox is Linux-based and does not have Wine or NSIS available, so the Windows `.exe` installer is intentionally produced by running `BUILD_WINDOWS.ps1` on Windows rather than pretending a Windows artifact was generated here.

## Voice interaction workflow

When **WAKE_WORD_ENGINE** is enabled, allow microphone access when Windows/Electron asks. Keep JARVIS running, say **“Hey JARVIS”**, wait for the HUD to show `SPEAK_COMMAND`, then say the command and pause. You can also say the wake phrase and command together, for example: “Hey JARVIS, what is the weather in Dhaka?”

For direct capture, press the microphone button in the dialogue composer. The HUD changes to `MIC_ACTIVE // SPEAK_COMMAND`; speak one command and pause. JARVIS submits the final transcript automatically. To hear replies, keep **VOICE_RESPONSE** enabled in **SYSTEM**, choose any voice from the 302-voice catalog, and use **TEST VOICE** to verify the audio channel. Assistant audio is now transferred from the main process as an inline MP3/WAV data URL, so Windows temporary-file playback restrictions do not block speech.

If voice still does not activate, check Windows microphone permissions for JARVIS, confirm that the input device is available, and verify that the output device is not muted. The online Edge TTS path has been verified to generate a valid 24 kHz mono MP3. When Edge TTS is unavailable, JARVIS checks Piper WAV output first and Kokoro WAV output second.

## Chrome/Selenium Python speech input

The integrated build deliberately retains **one and only one STT engine**: the supplied `references/jarvisai/Backend/SpeechToText.py`. Electron starts that exact script once as a long-lived child process with `cwd` set to `references/jarvisai`, equivalent to `python Backend/SpeechToText.py`. Its main loop is unchanged except for `print(Text, flush=True)`, so every recognized utterance is delivered immediately over stdout. Electron buffers real CRLF/LF boundaries, forwards each non-empty line through `stt:transcript`, forwards Python stderr through `stt:error`, and terminates the child cleanly with the application. There is no PowerShell STT path and no replacement SpeechRecognition/PyAudio worker.

The SYSTEM screen reports the presence of the supplied Chrome/Selenium script as `NATIVE_LISTEN_READY`. The runtime requires Python, Google Chrome, Selenium, webdriver-manager, and the packages listed in `references/jarvisai/Requirements.txt`. Electron prefers `JARVIS_PYTHON` when set, otherwise it uses `references/jarvisai/.venv/Scripts/python.exe` on Windows and finally the `python` command. The Chrome/Selenium behavior and recognition logic remain the supplied implementation, including its existing Chrome options.

For a Windows setup, install Python and Chrome, then run the following from the integrated project root:

```powershell
py -m venv references\jarvisai\.venv
references\jarvisai\.venv\Scripts\python.exe -m pip install --upgrade pip
references\jarvisai\.venv\Scripts\python.exe -m pip install -r references\jarvisai\Requirements.txt
```

To validate the stream independently, run from the Python project root so its `.env` and `Data` paths resolve correctly:

```powershell
cd references\jarvisai
..\.venv\Scripts\python.exe Backend\SpeechToText.py
```

The selected input language is synchronized into the integrated Python `.env` when settings are saved. The default remains `InputLanguage=en`, with `Username=SA SUJON`, `Assistantname=JARVIS`, and `AssistantVoice=en-CA-LiamNeural`. TTS remains a separate pipeline: Edge TTS is primary, with Piper and Kokoro offline synthesis fallbacks. The SYSTEM screen continues to expose `NATIVE_LISTEN`, `PIPER`, and `KOKORO` readiness indicators.

The AI system prompt requests natural colleague-like delivery, and TTS input is cleaned of Markdown, code blocks, URLs, and excessive length before synthesis. All configured Edge voices remain selectable.

## Voice prosody profiles

SYSTEM now provides three synchronized profiles. **NATURAL** uses a near-neutral Edge rate and pitch with slightly softened Piper variance. **CLASSIC JARVIS** is a little slower and lower with longer sentence spacing. **DEEP COMMAND** is the slowest and lowest profile for deliberate command delivery. Edge TTS receives rate and pitch tuning directly; Piper receives `noise_scale`, `length_scale`, `noise_w`, and `sentence_silence` flags. Edge TTS remains the most natural path because it uses Microsoft’s neural voices. Piper is intentionally tuned for clarity and stability, but Kokoro should be selected through the fallback installation when maximum offline naturalness is required.

## MARK_04 desktop command center

The new **MARK_04** navigation screen is additive; the original CORE, NEURAL, NETWORK, SECURITY, and SYSTEM screens remain available. MARK_04 reads host telemetry through `systeminformation`, including CPU load/model, memory, temperature sensors, battery state/capacity/voltage/time remaining, storage, OS identity, network interfaces, MAC/IP data, live connections, public IP, and measured latency to Cloudflare DNS.

The PROXIMITY_SCAN panel uses high-accuracy browser/Windows geolocation when available and transparently falls back to approximate IP geolocation. Map search uses Nominatim, with an OpenStreetMap embedded map. Search results calculate distance and bearing from the current coordinate. A hardware compass is shown when the Windows/browser device exposes orientation events; otherwise the panel displays a truthful target-bearing or sensor-unavailable state.

LIVE_FEED.SH reads Windows Application Event Log entries and provides a direct ADB command channel through `adb` without exposing arbitrary shell execution to the renderer. DIR.STARK // COMMS_LINK reuses the existing AI dialogue, displays active configured agent/model/voice channels, supports file metadata attachments, and includes separate real microphone-level and speech-output visual states.

## Internet answer fallback

JARVIS now keeps the deterministic utility routes for time, weather, and calculations. For any other query, it first attempts the configured AI providers in priority order. If every configured provider is missing, rate-limited, out of credits/tokens, over its context window, overloaded, or otherwise returns a quota-like failure, JARVIS automatically switches to a sourced web lookup.

The fallback queries DuckDuckGo’s instant-answer and HTML result endpoints, extracts the top indexed result titles, snippets, and direct source URLs, and returns them visibly in the dialogue. It does not fabricate a synthetic answer after all AI links fail; time-sensitive or conflicting claims should be checked by opening the cited sources. Perplexity or another configured search-capable AI provider can still provide a synthesized answer before the deterministic web fallback when its API key is available.

## Windows startup fix for missing `systeminformation`

If Electron reports `ERR_MODULE_NOT_FOUND: Cannot find package 'systeminformation'`, run the following from the project root—the folder containing `package.json`:

```powershell
npm install
npm run build
npm run doctor
npm start
```

For a clean reproducible install, use `npm ci` instead of `npm install` when `package-lock.json` is present. The package is a production dependency, so a normal Windows installer built with Electron Builder carries it into the application package. The current native telemetry loader also treats `systeminformation` as optional at startup; if it is absent, JARVIS should still open and display truthful fallback values while `npm run doctor` identifies the missing package.

## Separate jarvisai-integrated build

This directory is a separate integration of the supplied `jarvisai.zip` project. The original `/home/ubuntu/JARVIS` source remains untouched. The supplied defaults are preserved in `.env`: `Username=SA SUJON`, `Assistantname=JARVIS`, `InputLanguage=en`, and `AssistantVoice=en-CA-LiamNeural`.

The SYSTEM screen supports thirteen provider links, including the imported Groq, Cohere, and Hugging Face backends. Keys are stored through Electron safeStorage when available and participate in model discovery and quota-aware failover. The imported legacy key fields are wired directly to their provider records.

The complete supplied Edge TTS catalog is parsed into `src/edgeVoices.ts` with 302 voices, including locale, gender, category, and personality metadata. Search the catalog from SYSTEM, select any voice, and use TEST VOICE. The selected input language is synchronized to the supplied Chrome/Selenium Python STT project, while the selected Edge voice controls speech synthesis. Assistant name and operator name are editable and are used in the HUD, chat labels, voice test, and assistant system prompt.

Run `npm install`, `npm run build`, `npm run doctor`, and `npm start` from this directory. Then run `SETUP_JARVIS_PYTHON.ps1` once on Windows to create `references\\jarvisai\\.venv` and install the complete imported backend requirements. The integrated app uses `jarvis-settings-integrated.json` in Electron user data so it does not share settings with the original JARVIS build.

## MARK_04 freeze hardening and packaging

MARK_04 prevents overlapping telemetry refreshes and refreshes at a bounded twelve-second interval. Each diagnostics, network, identity, location, ADB, and Windows event-log request is independently timeout-bounded and collected with `Promise.allSettled`, so a slow or unavailable host service produces a partial telemetry entry instead of blocking the screen. The audio-analysis component requests microphone access only while listening; speaking-only playback uses the visual output state without opening another microphone stream.

The packaged application includes the complete supplied Python project under the `jarvis-python` resources directory. Electron supervises `Backend/ElectronBridge.py`, which lazily invokes the supplied `Model.py`, `Chatbot.py`, `RealtimeSearchEngine.py`, `Automation.py`, `ImageGeneration.py`, and `TextToSpeech.py` modules. The legacy `Main.py` and `Frontend/GUI.py` are retained as source references but are not launched, preventing a second PyQt window and competing file-polling loop. The original `/home/ubuntu/JARVIS` project remains untouched, and no GitHub commit or push is part of this build.

### Imported Python capability routing

| Supplied module | Electron integration | Required runtime condition |
| --- | --- | --- |
| `Model.py` | Classifies supported natural-language requests into chat, realtime, image, and local automation intents. | Cohere key configured for AI classification; deterministic prefixes remain available as a fallback. |
| `Chatbot.py` | Handles general conversational requests through the imported Groq-backed chatbot when Groq is configured. | Groq key configured; Electron multi-provider failover remains the fallback. |
| `RealtimeSearchEngine.py` | Performs bounded live Google result collection and Groq-backed synthesis for realtime intents. | Groq key and internet access; Electron sourced web fallback remains available. |
| `Automation.py` | Executes approved imported actions such as opening or closing apps, YouTube search/playback, content generation, browser search, and volume controls. | Windows desktop permissions and the corresponding Python dependencies. |
| `ImageGeneration.py` | Generates up to four Hugging Face images and returns safe data-URL previews in the Electron chat. | HuggingFace key and internet access. |
| `TextToSpeech.py` | Provides a Python Edge TTS fallback after Electron Edge TTS and local Piper/Kokoro synthesis fail. | Python `edge-tts` and output audio support. |
| `SpeechToText.py` | Remains the single persistent Chrome/Selenium STT child process; stdout transcripts flow through `stt:transcript`. | Python, Chrome, Selenium/webdriver-manager, and microphone/browser permissions. |
| `Main.py` and `Frontend/GUI.py` | Retained as the supplied standalone reference application but intentionally not launched by Electron. | Prevents a competing PyQt window, file-polling loop, and duplicate STT/TTS lifecycle. |

Provider API keys are passed from Electron to the supervised bridge through a local JSON-lines stdin channel and are applied in process memory before lazy module import. The bridge does not write provider secrets into the Python `.env`; only non-secret identity and language settings are synchronized there.

## Unified command-deck ownership

The desktop application now uses one scrollable command-center workspace instead of separate feature screens. The unified deck presents the canonical CORE dialogue stream and composer first, followed by NEURAL provider/model telemetry and the full MARK_04 device command center. This keeps chat, AI links, live hardware, network diagnostics, GPS/map targeting, battery data, event logs, ADB execution, audio analysis, and Python capability telemetry available in one operational view without repeating the same panels across tabs.

The previous NETWORK and SECURITY placeholder screens and the duplicate screen navigation were removed. Runtime configuration remains available through a compact capacitor-style settings icon in the top-right corner. Activating it opens the SYSTEM configuration drawer for identity, language, voice, wake-word, TTS, provider keys, model sync, and backend settings. The drawer can be dismissed with its close control or by clicking outside it.

## Real power, diagnostics, proximity, and audio behavior

The unified CORE power strip now owns the former primary-core and reactor responsibilities. It reports **NUCLEAR_ENERGY** when the host reports AC connection or active charging and **BATTERY** when running from battery. The live fields include charge level, voltage, current in milliamps, current/designed capacity, estimated health, charging state, and remaining time. Systems without a battery sensor explicitly show `DESKTOP_AC` or `NO_SENSOR` rather than fabricated values.

CORE_DIAGNOSTICS now consumes real host telemetry from `systeminformation`: CPU load/model, memory usage, storage usage, GPU controller information, Wi-Fi network information, Bluetooth connection count, thermal sensors, and uptime. Missing hardware sensors remain visibly unavailable instead of being represented by mock values.

The merged proximity panel combines the existing radar/map animation with browser or IP-derived location, latitude, longitude, public IP, active interface MAC, active local ports, Nominatim location search, OpenStreetMap map rendering, and current Open-Meteo conditions. The map includes OpenStreetMap attribution, and location search is deliberately user-triggered rather than autocomplete or periodic geocoding. Open-Meteo provides the no-key current weather endpoint and current variables used by the panel.[1] The Nominatim public service requires an identifying User-Agent, attribution, caching where possible, and a maximum of one request per second; the current UI follows the direct-search pattern rather than issuing background search requests.[2]

AUDIO_ANALYSIS now appears directly after the single chatbox and is split into two channels. `USER_INPUT` uses the existing listening waveform behavior and microphone analyser only while listening. `JARVIS_OUTPUT` uses the existing speaking waveform state during TTS playback and does not open another microphone stream.

### References

[1]: https://open-meteo.com/en/docs "Open-Meteo Weather Forecast API documentation"
[2]: https://operations.osmfoundation.org/policies/nominatim/ "Nominatim Usage Policy"

## Canonical telemetry component ownership

The command deck now uses three canonical telemetry components. **LOCAL_PROXIMITY // PROXIMITY_SCAN // LINK_PARAMETERS** is one combined component containing the live map/radar layer, GPS or IP location, latitude and longitude, public IP, MAC address, local ports, weather, target search, target distance and bearing, compass, AI-agent count, voice pipeline, model-discovery state, and IPC security state. **CORE_DIAGNOSTICS** contains the device CPU, GPU, memory, storage, Wi-Fi, Bluetooth, thermal, uptime, public-IP, latency, interface, MAC/IP, and connection details. **ACTIVE_CHANNELS // NEURAL_TELEMETRY** contains provider links, active models, model discovery counts, network ping, runtime channels, module readiness, model index rows, and its model rescan action.

The previous standalone `LOCAL_PROXIMITY`, `PROXIMITY_SCAN // LIVE_LOCATION`, `NEURAL_LINK_PARAMETERS`, `NEURAL_NETWORK_STATUS // DETAILS`, and `NEURAL_TELEMETRY` surfaces are no longer rendered as separate duplicate panels. Grid minimum heights and excess gaps were reduced, while all scrollbar chrome is hidden through CSS scrollbar suppression; scrollable content remains accessible through wheel, touchpad, keyboard, and touch input.

## MARK_04 header and scroll behavior

The standalone `[ MARK_04 // DEVICE_COMMAND_CENTER ]` banner and MARK_04 // J.A.R.V.I.S hero panel have been removed. MARK_04 now renders only its functional telemetry components. The live clock and refresh action are hosted inside **ACTIVE_CHANNELS // NEURAL_TELEMETRY**, where they remain visible alongside provider and model status.

The desktop viewport keeps scrolling available but hides scrollbar chrome. Nested chat, log, ADB, settings, and voice-catalog regions also suppress scrollbar chrome and use contained overscroll behavior. The map iframe is non-interactive so it cannot capture the desktop wheel event and interrupt command-deck scrolling; map search and map interaction remain available through the surrounding panel and its user-triggered controls.

## Windows telemetry permissions and troubleshooting

The telemetry service does **not** require administrator elevation for standard CPU, GPU, memory, storage, network-adapter, battery, and Bluetooth inventory. The integrated build first uses `systeminformation` and now includes a Windows-native PowerShell fallback based on WMI, `Get-NetAdapter`, and `Get-PnpDevice` when those calls return incomplete data. The UI exposes `SYSTEMINFORMATION` or `WINDOWS_NATIVE_FALLBACK` as the active source and reports `STANDARD_USER` access rather than silently requesting UAC elevation.

For precise device location, enable **Windows Settings → Privacy & security → Location → Location services** and allow desktop applications to access location. If location is disabled, JARVIS intentionally falls back to approximate IP geolocation. A battery panel showing `DESKTOP_AC` or `NO_SENSOR` is expected on a desktop without a battery exposed by firmware; it is not a permission failure.

To diagnose the Windows host manually, run the following in a regular PowerShell window and inspect whether each command returns data:

```powershell
Get-CimInstance Win32_Battery
Get-CimInstance Win32_Processor | Select-Object Name,LoadPercentage,NumberOfCores,MaxClockSpeed
Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM
Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory
Get-NetAdapter
Get-PnpDevice -Class Bluetooth
```

If these commands return data but the app still shows `N/A`, capture the `CORE_DIAGNOSTICS` source label and the corresponding field values from the app log. If the commands themselves return no device, Windows, firmware, driver, or privacy configuration is the limiting layer rather than Electron permissions.

## Automation behavior and Windows system actions

`Automation.py` now resolves targets by capability. For `open YouTube`, `open Gmail`, `open ChatGPT`, or another known web service, JARVIS opens the browser URL directly. For a Windows application such as Notepad, Calculator, Task Manager, Paint, Explorer, Command Prompt, or PowerShell, it attempts the native executable first. If a requested application is not installed or cannot be resolved, it falls back to a browser search instead of failing silently.

The approved system-action layer supports media volume keys, workstation lock, sleep, Task Manager, Windows Settings, Wi-Fi settings, Bluetooth settings, and display settings. Results are returned to the Electron chat with the actual route and outcome, such as `native_app`, `browser_fallback`, `web_search_fallback`, or `system`. Arbitrary shell execution, destructive disk commands, shutdown, restart, and unbounded process control remain disabled by design; adding those operations would require a separate explicit confirmation flow.

The Python bridge continues to run as a supervised JSON-lines child process. API keys are passed in memory through the bridge configuration, and the legacy PyQt GUI is not launched alongside Electron.

## Telemetry pipeline repair

CORE_DIAGNOSTICS now performs its own bounded telemetry bootstrap instead of depending solely on MARK_04’s deeper refresh cycle. It independently requests diagnostics, network, and device identity data every 12 seconds, applies fulfilled payloads immediately, and reports `TELEMETRY_IPC_ERROR` if the Electron bridge does not respond. The battery gauge no longer displays a fabricated default percentage; it shows the real charge percentage or `N/A` when the host exposes no battery sensor.

The diagnostics header exposes the source as `SYSTEMINFORMATION`, `WINDOWS_NATIVE_FALLBACK`, or an explicit error state. On Windows, the native fallback queries WMI, Windows network adapters, Bluetooth Plug and Play devices, and ACPI thermal zones. This means `CPU COLLECTING` and `TELEMETRY_PROBING` should only remain visible during the bounded initial request or when the installed build is not the refreshed integrated version.

## Scroll performance and Electron responsiveness

The renderer no longer updates React state on every audio-analysis animation frame. Audio bars are updated directly in the visualizer DOM, with only a low-frequency readout update. Shared telemetry refresh is independently guarded and bounded, while scrolling is handled by a passive listener that pauses decorative scan, radar, gauge, reactor, and audio CSS animation during active wheel movement and resumes it after scrolling stops. The existing animations and timing return during idle operation.

Lower MARK_04 sections use off-screen rendering containment, the embedded map is isolated, and nested output areas use contained overscroll. These changes reduce main-thread paint pressure and prevent the map or decorative layers from monopolizing wheel scrolling. Rebuild or reinstall the refreshed integrated version before testing; an older installed executable will retain the previous renderer behavior.

## Python-first desktop architecture

The desktop renderer is now organized around one supervised Python capability service and one shared Electron telemetry stream. `ElectronBridge.py` remains a long-lived JSON-lines process that lazily imports the supplied `Chatbot.py`, `Model.py`, `RealtimeSearchEngine.py`, `Automation.py`, `ImageGeneration.py`, `TextToSpeech.py`, and the sole Chrome/Selenium `SpeechToText.py` engine. Electron owns process supervision, encrypted settings, provider failover, TTS selection, and the renderer IPC boundary; the Python service owns the imported jarvisai capability implementations.

Diagnostics, network, and identity are collected once by Electron and broadcast through `system:telemetry`. MARK_04 consumes that shared payload and refreshes only its location, weather, ADB, and event-log responsibilities. It no longer launches duplicate diagnostics or network polling. MARK_04 is memoized, the audio waveform updates directly in the DOM with a throttled readout, and the remote map mounts after the first responsive paint. These boundaries are intended to keep wheel scrolling and chat interaction independent from hardware polling, map loading, voice animation, and Python capability work.

## Windows startup

For development, run `npm install` once and then `npm run dev`. The development script starts Vite, compiles Electron TypeScript in watch mode, waits for both `http://127.0.0.1:5173` and `dist-electron/main.js`, and only then launches Electron. This avoids the race where Vite is ready but Electron’s compiled main process is not yet available.

For a production-style local launch, run `npm start`. This command intentionally runs `npm run build` first, creating `dist/index.html` and `dist-electron/main.js` before Electron opens the application. Running `electron .` directly before the build will produce `ERR_FILE_NOT_FOUND` because the renderer output does not yet exist.

The npm deprecation and audit messages are dependency-maintenance warnings, not the cause of the reported startup failure. Use `npm audit` for inspection; do not apply `npm audit fix --force` automatically because it can introduce breaking dependency upgrades into the Electron toolchain.
