import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, LocateFixed, MapPin, Network, Radio, RefreshCw, Search, Terminal, Trash2, Volume2 } from 'lucide-react';
import type { ModelInfo, ProviderConfig } from './types';

type Mark04Props = {
  providers: ProviderConfig[];
  models: ModelInfo[];
  listening: boolean;
  speaking: boolean;
  onListen: () => void;
  onTelemetry?: (payload: { diagnostics?: any; network?: any; identity?: any; location?: Location | null; weather?: any }) => void;
  onRefreshModels?: () => Promise<void>;
  telemetry?: { diagnostics?: any; network?: any; identity?: any };
};

type Location = { source?: string; approximate?: boolean; latitude: number | null; longitude: number | null; city?: string | null; region?: string | null; country?: string | null; timezone?: string | null; ip?: string | null };

function bytes(value: number | null | undefined) { if (!value || value < 1) return '—'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; }
function ago(iso: string | undefined) { return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
function haversine(a: [number, number], b: [number, number]) { const r = 6371; const dLat = (b[0] - a[0]) * Math.PI / 180; const dLon = (b[1] - a[1]) * Math.PI / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return 2 * r * Math.asin(Math.sqrt(x)); }
function bearing(a: [number, number], b: [number, number]) { const y = Math.sin((b[1] - a[1]) * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180); const x = Math.cos(a[0] * Math.PI / 180) * Math.sin(b[0] * Math.PI / 180) - Math.sin(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.cos((b[1] - a[1]) * Math.PI / 180); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
function weatherLabel(code: number | null | undefined) { const labels: Record<number, string> = { 0: 'CLEAR_SKY', 1: 'MAINLY_CLEAR', 2: 'PARTLY_CLOUDY', 3: 'OVERCAST', 45: 'FOG', 48: 'RIME_FOG', 51: 'LIGHT_DRIZZLE', 53: 'DRIZZLE', 55: 'HEAVY_DRIZZLE', 61: 'LIGHT_RAIN', 63: 'RAIN', 65: 'HEAVY_RAIN', 71: 'LIGHT_SNOW', 73: 'SNOW', 75: 'HEAVY_SNOW', 80: 'RAIN_SHOWERS', 81: 'SHOWERS', 82: 'HEAVY_SHOWERS', 95: 'THUNDERSTORM', 96: 'STORM_HAIL', 99: 'SEVERE_STORM' }; return code == null ? 'WEATHER_UNAVAILABLE' : labels[code] || `WMO_CODE_${code}`; }
function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 10000) { return Promise.race([promise, new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs))]); }

export function AudioAnalysis({ listening, speaking }: { listening: boolean; speaking: boolean }) {
  const [displayLevel, setDisplayLevel] = useState(0);
  const audioRef = useRef<{ context: AudioContext; stream: MediaStream; analyser: AnalyserNode; frame: number } | null>(null);
  const levelRef = useRef(0);
  const userWaveRef = useRef<HTMLDivElement>(null);
  const outputWaveRef = useRef<HTMLDivElement>(null);

  const setBars = (container: HTMLDivElement | null, active: boolean, value: number) => {
    if (!container) return;
    const children = container.children;
    const len = children.length;
    for (let index = 0; index < len; index++) {
      const bar = children[index] as HTMLElement;
      const factor = 0.6 + ((index * 13) % 19) / 20;
      const scale = active ? Math.min(3.2, 0.3 + value * 3.5 * factor) : 0.2;
      bar.style.transform = `scaleY(${scale})`;
    }
  };

  useEffect(() => {
    const active = listening || speaking;
    if (!active) {
      levelRef.current = 0;
      setDisplayLevel(0);
      setBars(userWaveRef.current, false, 0);
      setBars(outputWaveRef.current, false, 0);
      if (audioRef.current) {
        cancelAnimationFrame(audioRef.current.frame);
        audioRef.current.stream.getTracks().forEach((track) => track.stop());
        void audioRef.current.context.close();
        audioRef.current = null;
      }
      return;
    }

    if (speaking && !listening) {
      levelRef.current = 0.38;
      setDisplayLevel(0.38);
      setBars(userWaveRef.current, false, 0);
      setBars(outputWaveRef.current, true, 0.38);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      levelRef.current = speaking ? 0.38 : 0;
      setDisplayLevel(levelRef.current);
      setBars(userWaveRef.current, listening, levelRef.current);
      setBars(outputWaveRef.current, speaking, Math.max(levelRef.current, 0.38));
      return;
    }

    let cancelled = false;
    const displayTimer = window.setInterval(() => {
      if (active) setDisplayLevel(levelRef.current);
    }, 400);

    void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const value = sum / (data.length * 255);
        levelRef.current = value;
        setBars(userWaveRef.current, listening, value);
        setBars(outputWaveRef.current, speaking, speaking ? Math.max(value, 0.38) : 0);
        if (audioRef.current) audioRef.current.frame = requestAnimationFrame(tick);
      };
      audioRef.current = { context, stream, analyser, frame: requestAnimationFrame(tick) };
    }).catch(() => {
      levelRef.current = 0;
      setDisplayLevel(0);
      setBars(userWaveRef.current, false, 0);
    });

    return () => {
      cancelled = true;
      window.clearInterval(displayTimer);
      if (audioRef.current) {
        cancelAnimationFrame(audioRef.current.frame);
        audioRef.current.stream.getTracks().forEach((track) => track.stop());
        void audioRef.current.context.close();
        audioRef.current = null;
      }
    };
  }, [listening, speaking]);

  const renderWave = (waveRef: React.RefObject<HTMLDivElement | null>) => (
    <div ref={waveRef} className="mark-wave" aria-label="live audio level">
      {Array.from({ length: 36 }, (_, index) => (
        <i key={index} style={{ transformOrigin: 'bottom', transform: 'scaleY(0.2)' }} />
      ))}
    </div>
  );

  return (
    <div className="audio-analysis-split">
      <div className={`mark-audio-analysis audio-channel ${listening ? 'is-listening' : ''}`}>
        <div className="mark-audio-head"><span><Volume2 size={14} /> [ USER_INPUT ]</span><b>{listening ? 'MIC_INPUT // LIVE' : 'CHANNEL_STANDBY'}</b></div>
        {renderWave(userWaveRef)}
        <small>USER SPEECH // {listening ? `${Math.round(displayLevel * 100)}% // TRANSCRIPT CAPTURE ACTIVE` : 'AWAITING INPUT'}</small>
      </div>
      <div className={`mark-audio-analysis audio-channel ${speaking ? 'is-speaking' : ''}`}>
        <div className="mark-audio-head"><span><Volume2 size={14} /> [ JARVIS_OUTPUT ]</span><b>{speaking ? 'VOICE_OUTPUT // LIVE' : 'CHANNEL_STANDBY'}</b></div>
        {renderWave(outputWaveRef)}
        <small>AGENT SPEECH // {speaking ? 'SYNTHESIS PLAYBACK ACTIVE' : 'AWAITING RESPONSE'}</small>
      </div>
    </div>
  );
}

function Section({ title, icon, children, className = '' }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) { return <section className={`mark-section ${className}`}><div className="mark-section-title"><span>{icon}{title}</span><i /></div>{children}</section>; }
const LazyMap = memo(function LazyMap({ src }: { src: string }) { const [ready, setReady] = useState(false); useEffect(() => { setReady(false); if (!src) return; const timer = window.setTimeout(() => setReady(true), 700); return () => window.clearTimeout(timer); }, [src]); return src && ready ? <iframe title="OpenStreetMap live location" src={src} loading="lazy" /> : <div className="mark-map-unavailable"><MapPin size={25} />{src ? 'MAP_LAYER_STANDBY' : 'LOCATION_UNAVAILABLE'}</div>; });

const Mark04 = memo(function Mark04({ providers, models, listening, speaking, onListen, onTelemetry, onRefreshModels, telemetry }: Mark04Props) {
  const refreshInFlight = useRef(false);
  const [location, setLocation] = useState<Location | null>(null); const [weather, setWeather] = useState<any>(null); const [target, setTarget] = useState<{ display_name: string; lat: string; lon: string; type?: string } | null>(null); const [search, setSearch] = useState(''); const [results, setResults] = useState<Array<{ display_name: string; lat: string; lon: string; type?: string }>>([]); const [heading, setHeading] = useState<number | null>(null); const [adbCommand, setAdbCommand] = useState('devices -l'); const [adbOutput, setAdbOutput] = useState('ADB channel idle.'); const [adbReady, setAdbReady] = useState<{ installed: boolean; available: boolean; devices: string[] } | null>(null); const [logs, setLogs] = useState<string[]>([]); const [now, setNow] = useState(new Date());
  const diagnostics = telemetry?.diagnostics || null; const network = telemetry?.network || null; const identity = telemetry?.identity || null;
  const readLocation = async (): Promise<Location> => {
    if (navigator.geolocation) {
      const precise = await new Promise<Location | null>((resolve) =>
        navigator.geolocation.getCurrentPosition(
          (position) => resolve({ source: 'windows-geolocation', approximate: false, latitude: position.coords.latitude, longitude: position.coords.longitude, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
          () => resolve(null),
          { enableHighAccuracy: false, maximumAge: 600000, timeout: 6000 }
        )
      );
      if (precise) return precise;
    }
    return await window.jarvis.currentLocation() as Location;
  };
  const refresh = async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const [l, a, log] = await Promise.allSettled([
        withTimeout(readLocation(), 'LOCATION', 6000),
        withTimeout(window.jarvis.adbStatus(), 'ADB', 4000),
        withTimeout(window.jarvis.systemLogs(), 'SYSTEM_LOGS', 6000)
      ]);
      if (l.status === 'fulfilled') setLocation(l.value);
      if (a.status === 'fulfilled') setAdbReady(a.value);
      if (log.status === 'fulfilled') setLogs(log.value.lines || []);
      onTelemetry?.({ location: l.status === 'fulfilled' ? l.value : location, weather });
    } catch (error) {
      setLogs((current) => [`${new Date().toISOString()} MARK04_REFRESH_ERROR ${error instanceof Error ? error.message : String(error)}`, ...current]);
    } finally {
      refreshInFlight.current = false;
    }
  };
  useEffect(() => {
    void refresh();
    // Live clock updates every second without triggering heavy system refreshes
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (location?.latitude == null || location.longitude == null) { setWeather(null); return; } void withTimeout(window.jarvis.weather(location.latitude, location.longitude), 'WEATHER', 6000).then(setWeather).catch(() => setWeather({ available: false, error: 'WEATHER_UNAVAILABLE' })); }, [location?.latitude, location?.longitude]);
  useEffect(() => { onTelemetry?.({ location, weather }); }, [location, weather, onTelemetry]);
  useEffect(() => { const listener = (event: DeviceOrientationEvent) => { if (typeof event.alpha === 'number') setHeading(Math.round((360 - event.alpha) % 360)); }; window.addEventListener('deviceorientationabsolute', listener as EventListener); window.addEventListener('deviceorientation', listener as EventListener); return () => { window.removeEventListener('deviceorientationabsolute', listener as EventListener); window.removeEventListener('deviceorientation', listener as EventListener); }; }, []);
  async function locate() { await refresh(); }
  async function findTarget() { if (!search.trim()) return; try { setResults(await window.jarvis.searchLocation(search.trim())); } catch (error) { setLogs((current) => [`${new Date().toISOString()} MAP_SEARCH_ERROR ${error instanceof Error ? error.message : String(error)}`, ...current]); } }
  async function runAdbCommand(cmd?: string) {
    const targetCmd = (typeof cmd === 'string' && cmd.trim()) ? cmd.trim() : adbCommand;
    const result = await window.jarvis.adb(targetCmd);
    setAdbOutput([result.stdout, result.stderr].filter(Boolean).join('\n') || `ADB exited with code ${result.code}`);
    setLogs((current) => [`${new Date().toISOString()} ADB ${targetCmd} // CODE_${result.code}`, ...current]);
  }
  const coords = location?.latitude != null && location.longitude != null ? [location.latitude, location.longitude] as [number, number] : null; const targetCoords = target ? [Number(target.lat), Number(target.lon)] as [number, number] : null; const computedBearing = coords && targetCoords ? bearing(coords, targetCoords) : null; const displayHeading = heading ?? computedBearing; const mapPoint = targetCoords || coords; const mapSrc = mapPoint ? `https://www.openstreetmap.org/export/embed.html?bbox=${mapPoint[1] - .04}%2C${mapPoint[0] - .03}%2C${mapPoint[1] + .04}%2C${mapPoint[0] + .03}&layer=mapnik&marker=${mapPoint[0]}%2C${mapPoint[1]}` : '';
  const activeChannels = useMemo(() => [...providers.filter((provider) => provider.enabled && provider.key).map((provider) => ({ name: provider.name, detail: provider.model || 'AUTO_MODEL', kind: 'AI_AGENT' })), { name: 'EDGE_TTS', detail: 'ONLINE_NEURAL_VOICE', kind: 'VOICE' }, { name: 'PIPER', detail: 'OFFLINE_ONNX_VOICE', kind: 'VOICE' }, ...models.slice(0, 6).map((model) => ({ name: model.id, detail: model.provider.toUpperCase(), kind: 'MODEL' })), { name: 'WEB_SEARCH', detail: 'DUCKDUCKGO_SOURCED_FALLBACK', kind: 'UTILITY' }, { name: 'PYTHON_BRIDGE', detail: 'JSONL_SUPERVISED_RUNTIME', kind: 'RUNTIME' }, { name: 'PYTHON_AUTOMATION', detail: 'APP_MEDIA_SYSTEM_ACTIONS', kind: 'RUNTIME' }, { name: 'PYTHON_REALTIME', detail: 'GOOGLE_SOURCES_PLUS_GROQ', kind: 'RUNTIME' }, { name: 'PYTHON_IMAGE', detail: 'HUGGINGFACE_DIFFUSION', kind: 'RUNTIME' }, { name: 'PYTHON_TTS', detail: 'EDGE_TTS_FALLBACK', kind: 'RUNTIME' }], [providers, models]);
  const moduleRows = [{ label: 'VISUAL_PROCESSING', value: identity?.graphics?.controllers?.length ? 100 : 0, detail: identity?.graphics?.controllers?.map((item: any) => item.model).join(', ') || 'GPU_DATA_UNAVAILABLE' }, { label: 'NATURAL_LANG', value: Math.min(100, models.length ? 100 : providers.filter((item) => item.key).length * 10), detail: `${models.length} LIVE_MODELS_INDEXED` }, { label: 'PREDICTIVE', value: diagnostics?.temperature?.mainCelsius != null ? 100 : 0, detail: diagnostics?.temperature?.mainCelsius != null ? 'THERMAL_TREND_SOURCE_READY' : 'THERMAL_SENSOR_UNAVAILABLE' }, { label: 'DEFENSE_NET', value: adbReady?.available ? 100 : 80, detail: adbReady?.available ? 'ADB_DEVICE_CONTROL_READY' : 'ISOLATED_IPC_GUARDRAILS_ACTIVE' }];
  return (
    <div className="mark04-shell">
      <div className="mark04-grid">
        <div className="mark-column">
          <Section title="LOCAL_PROXIMITY // PROXIMITY_SCAN // LINK_PARAMETERS" icon={<MapPin size={15} />} className="map-section">
            <div className="mark-map-wrap">
              <LazyMap src={mapSrc} />
              <div className="mark-radar-overlay">
                <div className="mark-radar-sweep" />
                <span />
                <span />
              </div>
            </div>
            <div className="map-attribution">© OpenStreetMap contributors // LIVE LOCATION LAYER</div>
            <div className="mark-location-line">
              <span><LocateFixed size={13} />{location?.approximate ? 'IP_APPROXIMATION' : 'GPS_SOURCE'}</span>
              <b>{coords ? `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}` : 'NO_COORDINATES'}</b>
            </div>
            <div className="mark-location-search">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void findTarget(); }}
                placeholder="SEARCH ANY LOCATION // NOMINATIM"
              />
              <button onClick={() => void findTarget()} aria-label="search location"><Search size={14} /></button>
            </div>
            {results.length > 0 && (
              <div className="mark-search-results">
                {results.map((item) => (
                  <button key={`${item.lat}-${item.lon}`} onClick={() => { setTarget(item); setResults([]); }}>
                    {item.display_name}
                  </button>
                ))}
              </div>
            )}
            <div className="proximity-meta-grid">
              <span>LATITUDE<b>{coords ? coords[0].toFixed(6) : '—'}</b></span>
              <span>LONGITUDE<b>{coords ? coords[1].toFixed(6) : '—'}</b></span>
              <span>PUBLIC_IP<b>{location?.ip || network?.publicIp || '—'}</b></span>
              <span>MAC<b>{network?.interfaces?.find((item: any) => item.mac && !item.internal)?.mac || '—'}</b></span>
              <span>PORTS<b>{network?.connections?.slice(0, 4).map((item: any) => item.localPort).filter(Boolean).join(', ') || '—'}</b></span>
              <span>WEATHER<b>{weatherLabel(weather?.current?.weather_code)}</b></span>
            </div>
            <div className="weather-strip">
              <strong>{weather?.available && weather.current?.temperature_2m != null ? `${weather.current.temperature_2m}°C` : '—'}</strong>
              <span>{weather?.available ? `${weather.current.relative_humidity_2m ?? '—'}% RH // FEELS ${weather.current.apparent_temperature ?? '—'}°C // WIND ${weather.current.wind_speed_10m ?? '—'} KM/H` : (weather?.error || 'WEATHER_DATA_PENDING')}</span>
            </div>
            <div className="mark-target-line">
              <span>TARGETING_PARAMS</span>
              <b>{target && coords && targetCoords ? `${haversine(coords, targetCoords).toFixed(1)} KM // ${bearing(coords, targetCoords).toFixed(0)}° BEARING` : target ? target.display_name : 'NO_TARGET_SELECTED'}</b>
            </div>
            <div className="proximity-link-parameters">
              <div className="mark-param-grid">
                <span>AI_AGENTS<b>{providers.filter((item) => item.key).length}/10</b></span>
                <span>VOICE_PIPELINE<b>EDGE → PIPER → KOKORO</b></span>
                <span>MODEL_DISCOVERY<b>{models.length ? 'SYNCED' : 'AWAITING_KEYS'}</b></span>
                <span>IPC_SECURITY<b>CONTEXT_ISOLATED</b></span>
              </div>
              <div className="mark-compass">
                <div className="mark-compass-face" style={{ transform: `rotate(${heading || 0}deg)` }}>
                  <span>N</span><span>E</span><span>S</span><span>W</span><i />
                </div>
                <div>
                  <span>COMPASS_HEADING</span>
                  <strong>{displayHeading == null ? 'SENSOR_UNAVAILABLE' : `${displayHeading.toFixed(0)}°`}</strong>
                  <small>{heading == null ? 'TARGET_BEARING // NO_MAGNETOMETER' : 'DEVICE_ORIENTATION // LIVE_MAGNETOMETER'}</small>
                </div>
              </div>
            </div>
          </Section>
        </div>

        <div className="mark-column">
          <Section title="ACTIVE_CHANNELS // NEURAL_TELEMETRY" icon={<Network size={15} />} className="channels-section">
            <div className="mark-section-clock">
              <span className="mark-live-dot" />
              LIVE_CLOCK <b>{now.toLocaleTimeString()}</b>
              <button onClick={() => void refresh()} title="Refresh live telemetry" aria-label="refresh telemetry"><RefreshCw size={13} /></button>
            </div>
            <div className="mark-neural-hero">
              <div><span>LIVE_PROVIDER_LINKS</span><strong>{providers.filter((item) => item.enabled && item.key).length}</strong></div>
              <div><span>INDEXED_MODELS</span><strong>{models.length || '—'}</strong></div>
              <div><span>NETWORK_PING</span><strong>{network?.latencyMs != null ? `${network.latencyMs} ms` : '—'}</strong></div>
            </div>
            <div className="mark-module-grid">
              {moduleRows.map((item) => (
                <div className="mark-module" key={item.label}>
                  <div><span>{item.label}</span><b>{item.value}%</b></div>
                  <div className="mark-module-bar"><i style={{ width: `${item.value}%` }} /></div>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
            <div className="mark-channel-list">
              <div className="mark-subtitle">
                <span><Radio size={13} /> ACTIVE_CHANNELS</span>
                <b>{activeChannels.length} ONLINE</b>
              </div>
              <div className="mark-channel-scroll">
                {activeChannels.map((item) => (
                  <div className="mark-channel" key={`${item.kind}-${item.name}`}>
                    <i /><b>{item.name}</b><span>{item.kind} // {item.detail}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="neural-telemetry-index">
              <div className="mark-subtitle">
                <span><Network size={13} /> NEURAL_TELEMETRY // MODEL_INDEX</span>
                <button className="mini-btn" onClick={() => void onRefreshModels?.()} aria-label="rescan models">RESCAN</button>
              </div>
              <div className="neural-telemetry-metrics">
                <span>ACTIVE_LINKS<b>{providers.filter((item) => item.enabled && item.key).length}</b></span>
                <span>DISCOVERED_MODELS<b>{models.length || '—'}</b></span>
                <span>NETWORK_PING<b>{network?.latencyMs != null ? `${network.latencyMs} ms` : '—'}</b></span>
              </div>
              <div className="neural-telemetry-scroll">
                {models.length > 0 ? (
                  models.map((model) => (
                    <div className="mark-channel" key={`MODEL-${model.provider}-${model.id}`}>
                      <i /><b>{model.id}</b><span>MODEL // {model.provider.toUpperCase()}</span>
                    </div>
                  ))
                ) : (
                  <div className="mark-empty">No external models synced. Click RESCAN or add API keys.</div>
                )}
              </div>
            </div>
          </Section>
        </div>
      </div>

      <div className="mark-wide-grid">
        <Section title="LIVE_FEED.SH // RUNTIME_LOG" icon={<Terminal size={15} />} className="log-section">
          <div className="mark-log-controls">
            <span className="log-badge"><span className="mark-live-dot" /> LIVE EVENT BUFFER</span>
            <div className="log-actions">
              <span className="log-count">{logs.length} EVENTS</span>
              <button className="mini-btn" onClick={() => setLogs([])} title="Clear logs" aria-label="clear log buffer">
                <Trash2 size={12} /> CLEAR
              </button>
            </div>
          </div>
          <div className="mark-log-window">
            {logs.length ? (
              logs.map((line, index) => (
                <p key={`${line}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span>{line}</p>
              ))
            ) : (
              <p className="mark-log-empty">Waiting for Windows event log and JARVIS runtime events…</p>
            )}
          </div>
        </Section>

        <Section title="HARDWARE_BRIDGE // ADB_SUBSYSTEM" icon={<Cpu size={15} />} className="adb-section">
          <div className="adb-status-bar">
            <div className="adb-status-tag">
              <span className={`status-indicator ${adbReady?.available ? 'online' : adbReady?.installed ? 'standby' : 'offline'}`} />
              <b>{adbReady?.available ? 'BRIDGE_ONLINE' : adbReady?.installed ? 'STANDBY' : 'NOT_FOUND'}</b>
            </div>
            <span className={`adb-device-pill ${adbReady?.available ? 'mark-good' : 'mark-warn'}`}>
              {adbReady?.available ? `${adbReady.devices.length} CONNECTED DEVICE(S)` : adbReady?.installed ? 'NO USB/WIFI DEVICE' : 'ADB NOT DETECTED'}
            </span>
          </div>
          <div className="adb-quick-bar">
            <button type="button" onClick={() => { setAdbCommand('devices -l'); void runAdbCommand('devices -l'); }}>devices -l</button>
            <button type="button" onClick={() => { setAdbCommand('shell dumpsys battery'); void runAdbCommand('shell dumpsys battery'); }}>battery</button>
            <button type="button" onClick={() => { setAdbCommand('shell getprop ro.product.model'); void runAdbCommand('shell getprop ro.product.model'); }}>model</button>
            <button type="button" onClick={() => { setAdbCommand('shell wm size'); void runAdbCommand('shell wm size'); }}>screen</button>
          </div>
          <div className="mark-adb-row">
            <input
              value={adbCommand}
              onChange={(event) => setAdbCommand(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void runAdbCommand(); }}
              placeholder="ADB COMMAND // devices -l"
            />
            <button onClick={() => void runAdbCommand()}><Terminal size={13} /> EXECUTE</button>
          </div>
          <pre className="mark-adb-output">{adbOutput}</pre>
        </Section>
      </div>
    </div>
  );
});
function SlidersIcon() { return <span className="mark-sliders">≡</span>; }

export default Mark04;
