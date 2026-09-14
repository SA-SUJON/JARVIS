import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, Bot, ChevronDown, Cpu, Globe2, Headphones, Keyboard, KeyRound, Link2, LockKeyhole, Maximize2, MessageSquare, Mic, Mic2, Minus, Network, Plus, Radio, RefreshCw, ScanFace, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Volume2, X, Zap } from 'lucide-react';
import { CURATED_MODELS, DEFAULT_PROVIDERS, VOICES, VOICE_PROFILES, type ChatMessage, type ModelInfo, type ProviderConfig, type ProviderId, type VoiceProfile } from './types';
import './approval.css';
import Mark04, { AudioAnalysis } from './Mark04';
import { EDGE_VOICES } from './edgeVoices';
import FaceRecognition, { type FaceProfile } from './FaceRecognition';
import HolographicScanner from './HolographicScanner';


const initialMessages: ChatMessage[] = [{ role: 'assistant', content: 'Hi, Sir. JARVIS Is Available', provider: 'local', timestamp: 'NOW' }];

type PendingApproval = {
  id: string;
  requestId: string;
  taskId: string;
  summary: string;
  authority: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
};

function wakeWordMatch(text: string, assistantName: string) {
  const escaped = assistantName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`^(?:(?:hey|ok|hello|hi)\\s+)?${escaped}[:,]?\\s*(.*)`, 'i'));
}

function Panel({ children, className = '', scan = false }: { children: React.ReactNode; className?: string; scan?: boolean }) {
  return <section className={`hud-panel corner-brackets ${className}`}>{scan && <div className="panel-scan" />}{children}</section>;
}

function Gauge({ value = null, compact = false }: { value?: number | null; compact?: boolean }) {
  const size = compact ? 138 : 290;
  const displayValue = value == null ? 'N/A' : `${Math.round(value)}%`;
  return <div className="gauge-wrap" style={{ width: size, height: size }}>
    <div className="gauge-orbit orbit-a" />
    <div className="gauge-orbit orbit-b" />
    <div className="gauge-orbit orbit-c" />
    <div className="gauge-core" />
    <div className="gauge-copy"><strong>{displayValue}</strong><span>{compact ? 'OUTPUT' : 'CAPACITY'}</span></div>
  </div>;
}

function Meter({ label, value, color = 'cyan' }: { label: string; value: number; color?: 'cyan' | 'blue' | 'purple' | 'red' }) {
  return <div className="meter-row"><div className="meter-label"><span>{label}</span><b className={`tone-${color}`}>{value}%</b></div><div className="meter-track"><motion.div className={`meter-fill ${color}`} initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 1.1 }} /></div></div>;
}

function WindowControls() { return <div className="window-controls"><button aria-label="minimize" onClick={() => window.jarvis.minimize()}><Minus size={14} /></button><button aria-label="maximize" onClick={() => window.jarvis.maximize()}><Maximize2 size={12} /></button><button aria-label="close" onClick={() => window.jarvis.close()}><X size={14} /></button></div>; }

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [liveTelemetry, setLiveTelemetry] = useState<{ diagnostics?: any; network?: any; identity?: any; location?: any; weather?: any }>({});
  const handleTelemetry = useCallback((payload: { diagnostics?: any; network?: any; identity?: any; location?: any; weather?: any }) => { if (!payload.diagnostics && !payload.network && !payload.identity) return; setLiveTelemetry((current) => ({ ...current, ...payload })); }, []);
  const [providers, setProviders] = useState<ProviderConfig[]>(DEFAULT_PROVIDERS);
  const [geminiKeys, setGeminiKeys] = useState<string[]>(['']);
  const [voice, setVoice] = useState('en-CA-LiamNeural');
  const [language, setLanguage] = useState('en');
  const [assistantName, setAssistantName] = useState('JARVIS');
  const [userName, setUserName] = useState('SA SUJON');
  const [legacyKeys, setLegacyKeys] = useState<{ CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string }>({});
  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>('natural');
  const [wakeWord, setWakeWord] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelStatus, setModelStatus] = useState('AUTO_DISCOVERY_READY');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | undefined>();
  const [toast, setToast] = useState('');
  const [voiceStatus, setVoiceStatus] = useState({ nativeListen: false, piper: false, kokoro: false, edge: true, note: 'Checking voice runtime...' });
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const commandModeRef = useRef(false);
  const wakeRestartRef = useRef(true);
  const telemetryRefreshRef = useRef(false);

  const configured = useMemo(() => providers.filter((p) => p.key).length, [providers]);
  const activeProvider = providers.find((p) => p.key && p.enabled);
  const selectedModels = models.filter((m) => !selectedProvider || m.provider === selectedProvider);
  const sharedTelemetry = useMemo(() => ({ diagnostics: liveTelemetry.diagnostics, network: liveTelemetry.network, identity: liveTelemetry.identity }), [liveTelemetry.diagnostics, liveTelemetry.network, liveTelemetry.identity]);

  useEffect(() => {
    void window.jarvis.getSettings().then((settings) => {
      setProviders(settings.providers.length ? settings.providers : DEFAULT_PROVIDERS);
      const gKeys = settings.geminiKeys && settings.geminiKeys.length
        ? settings.geminiKeys
        : (settings.providers.find((p) => p.id === 'gemini')?.keys?.length
          ? settings.providers.find((p) => p.id === 'gemini')!.keys!
          : settings.providers.find((p) => p.id === 'gemini')?.key
            ? [settings.providers.find((p) => p.id === 'gemini')!.key!]
            : ['']);
      setGeminiKeys(gKeys.length ? gKeys : ['']);
      setVoice(settings.voice || 'en-CA-LiamNeural');
      setVoiceProfile(settings.voiceProfile || 'natural');
      setLanguage(settings.language || 'en');
      setAssistantName(settings.assistantName || 'JARVIS');
      setUserName(settings.userName || 'SA SUJON');
      setLegacyKeys(settings.legacyKeys || {});
      setWakeWord(settings.wakeWord);
      setVoiceEnabled(settings.voiceEnabled);
    });
    void window.jarvis.voiceStatus().then(setVoiceStatus);
    void window.jarvis.listApprovals().then((approvals) => setPendingApproval(approvals[0] || null)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const removeTelemetry = window.jarvis.onSystemTelemetry((payload) => setLiveTelemetry((current) => ({ ...current, ...payload })));
    void window.jarvis.requestTelemetry();
    return () => removeTelemetry();
  }, []);
  const chatStreamRef = useRef<HTMLDivElement>(null);
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (chatStreamRef.current) {
        chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
      }
      return;
    }
    if (chatStreamRef.current) {
      chatStreamRef.current.scrollTo({
        top: chatStreamRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, thinking]);
  useEffect(() => {
    const removeTranscript = window.jarvis.onSttTranscript((payload) => {
      const transcript = payload.text.trim(); if (!transcript) return;
      if (!commandModeRef.current) { const wakeMatch = wakeWordMatch(transcript, assistantName); if (!wakeMatch) return; const inlineCommand = wakeMatch[1]?.trim(); setListening(true); commandModeRef.current = true; setToast(inlineCommand ? 'WAKE_WORD_ACCEPTED // COMMAND_CAPTURED' : 'WAKE_WORD_ACCEPTED // SPEAK_COMMAND'); setTimeout(() => setToast(''), 2500); if (inlineCommand) { commandModeRef.current = false; void send(inlineCommand); } return; }
      commandModeRef.current = false; setListening(false); void send(transcript);
    });
    const removeError = window.jarvis.onSttError((message) => { setListening(false); setToast(`MIC_ERROR // ${message.slice(0, 110)}`); setTimeout(() => setToast(''), 5500); });
    if (wakeWord) { void window.jarvis.sttStart(language).then((result) => { if (!result.available) { setToast(`NATIVE_MIC_UNAVAILABLE // ${result.reason || 'Use Windows voice components.'}`); setTimeout(() => setToast(''), 5500); } else { setToast('PYTHON_STT_READY // SAY HEY JARVIS'); setTimeout(() => setToast(''), 2800); } }); }
    return () => { removeTranscript(); removeError(); void window.jarvis.sttStop(); };
  }, [wakeWord, language, assistantName]);

  async function persist(next: Partial<{ providers: ProviderConfig[]; geminiKeys: string[]; voice: string; voiceProfile: VoiceProfile; language: string; wakeWord: boolean; voiceEnabled: boolean; assistantName: string; userName: string; legacyKeys: { CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string } }>) { await window.jarvis.setSettings(next); setToast('CONFIGURATION_COMMITTED'); setTimeout(() => setToast(''), 1800); }
  const handleFaceRecognized = useCallback(async (profile: FaceProfile) => {
    const operatorGreetings = ['Hi Boss.', 'Hello, Sir.', 'Welcome back, Sir.', 'Neural links are active, Boss.'];
    const defaultGreeting = profile.relation === 'operator'
      ? operatorGreetings[Math.floor(Math.random() * operatorGreetings.length)]
      : `Hi ${profile.displayName}.`;
    const greeting = profile.greeting || defaultGreeting;
    setMessages((current) => [...current, { role: 'assistant', content: greeting, provider: 'local-face', timestamp: 'NOW' }]);
    if (!voiceEnabled) return;
    try {
      const result = await window.jarvis.speak({ text: greeting, voice, language, voiceProfile });
      if (!result.dataUrl) { setToast(`FACE_GREETING_UNAVAILABLE // ${result.error || 'TTS unavailable.'}`); setTimeout(() => setToast(''), 3500); return; }
      const player = new Audio(result.dataUrl); setSpeaking(true); player.onended = () => { setSpeaking(false); player.remove(); }; player.onerror = () => setSpeaking(false); await player.play();
    } catch (greetingError) { setToast(`FACE_GREETING_FAILED // ${greetingError instanceof Error ? greetingError.message : String(greetingError)}`); setTimeout(() => setToast(''), 3500); }
  }, [language, voice, voiceEnabled, voiceProfile]);
  const refreshModels = useCallback(async () => {
    setModelStatus('SCANNING_NEURAL_LINKS'); const available: ModelInfo[] = []; for (const provider of providers.filter((p) => p.key && p.enabled)) { try { const found = await window.jarvis.listModels(provider); available.push(...found); } catch { /* one provider failing must not block discovery */ } } setModels(available); setProviders((current) => current.map((provider) => { const first = available.find((model) => model.provider === provider.id); return first && !provider.model ? { ...provider, model: first.id } : provider; })); setModelStatus(`${available.length}_MODELS_INDEXED`);
  }, [providers]);
  async function speakAnswer(answer: string) {
    if (!voiceEnabled) return;
    const spoken = await window.jarvis.speak({ text: answer, voice, language, voiceProfile });
    if (spoken.dataUrl) { const player = new Audio(spoken.dataUrl); player.volume = 1; setSpeaking(true); player.onended = () => { setSpeaking(false); player.remove(); }; player.onerror = () => setSpeaking(false); await player.play(); }
    else if (spoken.error) { setToast(`VOICE_UNAVAILABLE // ${spoken.error.slice(0, 90)}`); setTimeout(() => setToast(''), 4500); }
  }
  async function send(text = draft) {
    const query = text.trim(); if (!query || thinking || approvalBusy) return; setDraft(''); setListening(false); setMessages((current) => [...current, { role: 'user', content: query, timestamp: 'NOW' }]); setThinking(true);
    try { const result = await window.jarvis.query({ query, providers, preferred: selectedProvider, history: messages }); const next: ChatMessage = { role: 'assistant', content: result.answer, provider: result.provider.toUpperCase(), timestamp: 'NOW', images: result.images }; setMessages((current) => [...current, next]); if (result.requiresApproval && result.approval) setPendingApproval(result.approval); await speakAnswer(result.answer); }
    catch (error) { setMessages((current) => [...current, { role: 'assistant', content: error instanceof Error ? error.message : 'Neural link unavailable.', provider: 'FAILOVER', timestamp: 'ERR' }]); }
    finally { setThinking(false); }
  }
  async function executeApproved() {
    if (!pendingApproval || approvalBusy) return;
    setApprovalBusy(true);
    try {
      const approved = await window.jarvis.approveApproval(pendingApproval.id);
      setPendingApproval(approved);
      const result = await window.jarvis.executeApprovedApproval(approved.id);
      const next: ChatMessage = { role: 'assistant', content: result.answer, provider: result.provider.toUpperCase(), timestamp: 'NOW', images: result.images };
      setMessages((current) => [...current, next]);
      setPendingApproval(null);
      await speakAnswer(result.answer);
    } catch (error) {
      setToast(`APPROVAL_EXECUTION_FAILED // ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => setToast(''), 6000);
      try { const approvals = await window.jarvis.listApprovals(); setPendingApproval(approvals[0] || null); } catch { setPendingApproval(null); }
    } finally { setApprovalBusy(false); }
  }
  async function rejectPendingApproval() {
    if (!pendingApproval || approvalBusy) return;
    setApprovalBusy(true);
    try { await window.jarvis.rejectApproval(pendingApproval.id); setPendingApproval(null); setToast('APPROVAL_REJECTED // ACTION_NOT_EXECUTED'); setTimeout(() => setToast(''), 3500); }
    catch (error) { setToast(`APPROVAL_REJECT_FAILED // ${error instanceof Error ? error.message : String(error)}`); setTimeout(() => setToast(''), 5000); }
    finally { setApprovalBusy(false); }
  }
  const toggleVoiceInput = useCallback(async () => {
    const next = !listening; commandModeRef.current = next; setListening(next); if (next) { const result = await window.jarvis.sttStart(language); if (!result.available) { setListening(false); commandModeRef.current = false; setToast(`NATIVE_MIC_UNAVAILABLE // ${result.reason || 'Windows speech recognition unavailable.'}`); } else { setToast('PYTHON_STT_ACTIVE // SPEAK_COMMAND'); } } else { if (!wakeWord) await window.jarvis.sttStop(); setToast('MIC_STANDBY'); } setTimeout(() => setToast(''), 3500);
  }, [listening, wakeWord, language]);
  async function onComposerKey(e: React.KeyboardEvent<HTMLInputElement>) { if (e.key === 'Enter') void send(); }

  return <div className="app-shell unified-shell"><div className="grid-overlay" /><div className="scan-line" /><header className="topbar unified-topbar"><div className="brand"><Zap size={20} className="brand-mark" /><span>{assistantName}</span><em>vMARK_04</em></div><div className="top-status"><span className="status-dot" />{configured ? `NEURAL_LINKS_${configured}/13` : 'NEURAL_LINKS_STANDBY'}<span className="divider">//</span><span className={listening ? 'tone-cyan pulse' : ''}>{listening ? 'LISTENING' : 'IDLE'}</span><button className={settingsOpen ? 'capacitor-settings active' : 'capacitor-settings'} onClick={() => setSettingsOpen((open) => !open)} aria-label="open JARVIS settings" title="Open settings"><span className="capacitor-glyph"><Settings2 size={18} /></span></button><WindowControls /></div></header>
    <main className="main-area unified-main"><div className="page-heading"><div><span className="eyebrow">[ STARK // UNIFIED COMMAND DECK ]</span><h1>JARVIS // ALL SYSTEMS</h1></div><div className="heading-actions"><span className="chip">SYS_READY</span><span className="chip muted">LIVE_CONSOLE</span></div></div>
      <div className="unified-layout"><section className="unified-core"><div className="unified-section-label"><span className="eyebrow">[ PRIMARY_CORE // DIALOGUE ]</span><span>ONE CANONICAL CHAT CHANNEL</span></div><div className="dashboard-grid"><Panel className="core-panel" scan><div className="panel-head"><span className="eyebrow">[ PRIMARY_CORE_OUTPUT ]</span><span className="data">STATUS: <b className="tone-cyan">OPTIMAL</b></span></div><div className="core-visual"><Gauge value={liveTelemetry.diagnostics?.battery?.available && liveTelemetry.diagnostics.battery.percent != null ? liveTelemetry.diagnostics.battery.percent : null} /><div className="telemetry"><div><span>TEMP</span><b>{liveTelemetry.diagnostics?.temperature?.mainCelsius != null ? `${liveTelemetry.diagnostics.temperature.mainCelsius}°C` : 'SENSOR_NA'}</b></div><div><span>VOLTAGE</span><b>{liveTelemetry.diagnostics?.battery?.voltage ? `${liveTelemetry.diagnostics.battery.voltage.toFixed(2)} V` : liveTelemetry.diagnostics?.battery?.available ? '—' : 'AC_INPUT'}</b></div><div><span>HEALTH</span><b>{liveTelemetry.diagnostics?.battery?.healthPercent ? `${Math.round(liveTelemetry.diagnostics.battery.healthPercent)}%` : liveTelemetry.diagnostics?.battery?.available ? '—' : 'HOST_AC'}</b></div></div></div><div className="core-foot"><span><Activity size={14} /> RESPONSE PIPELINE</span><b>{activeProvider?.name || 'LOCAL UTILITY ROUTER'}</b></div><div className="core-power-strip"><div className="core-power-heading"><span><Zap size={14} /> POWER_CORE</span><b>{liveTelemetry.diagnostics?.battery?.acConnected || liveTelemetry.diagnostics?.battery?.charging ? 'NUCLEAR_ENERGY' : 'BATTERY'}</b></div><div className="core-power-meter"><i style={{ width: `${liveTelemetry.diagnostics?.battery?.available ? Math.min(100, Math.max(0, liveTelemetry.diagnostics.battery.percent || 0)) : 0}%` }} /></div><div className="core-power-stats"><span>LEVEL<b>{liveTelemetry.diagnostics?.battery?.available && liveTelemetry.diagnostics.battery.percent != null ? `${Math.round(liveTelemetry.diagnostics.battery.percent)}%` : 'NO_SENSOR'}</b></span><span>VOLTAGE<b>{liveTelemetry.diagnostics?.battery?.voltage ? `${liveTelemetry.diagnostics.battery.voltage.toFixed(2)} V` : '—'}</b></span><span>CURRENT<b>{liveTelemetry.diagnostics?.battery?.currentMilliAmps ? `${Math.round(liveTelemetry.diagnostics.battery.currentMilliAmps)} mA` : '—'}</b></span><span>CAPACITY<b>{liveTelemetry.diagnostics?.battery?.currentCapacity ? `${Math.round(liveTelemetry.diagnostics.battery.currentCapacity / 1000)} / ${Math.round((liveTelemetry.diagnostics.battery.designedCapacity || 0) / 1000)} mWh` : '—'}</b></span><span>HEALTH<b>{liveTelemetry.diagnostics?.battery?.healthPercent ? `${Math.round(liveTelemetry.diagnostics.battery.healthPercent)}%` : '—'}</b></span><span>STATE<b>{liveTelemetry.diagnostics?.battery?.available ? (liveTelemetry.diagnostics.battery.charging ? 'CHARGING' : 'DISCHARGING') : 'DESKTOP_AC'}</b></span></div></div></Panel>
        <div className="right-stack"><Panel className="diagnostic-panel" scan><div className="panel-head"><span className="eyebrow">[ CORE_DIAGNOSTICS ]</span><span className="data">{liveTelemetry.diagnostics?.telemetrySource || 'TELEMETRY_PROBING'}</span></div><div className="meters"><Meter label="CPU_USAGE" value={liveTelemetry.diagnostics?.cpu?.usagePercent || 0} color="blue" /><Meter label="MEMORY_USAGE" value={liveTelemetry.diagnostics?.memory?.usagePercent || 0} color="cyan" /><Meter label="STORAGE_USAGE" value={liveTelemetry.diagnostics?.storage?.[0]?.usagePercent || 0} color="purple" /></div><div className="diagnostic-detail-grid"><span>CPU<b>{liveTelemetry.diagnostics?.cpu?.model || 'COLLECTING'}</b></span><span>GPU<b>{liveTelemetry.diagnostics?.gpu?.[0]?.model || 'NO_GPU_DATA'}</b></span><span>MEMORY<b>{liveTelemetry.diagnostics?.memory?.usedBytes ? `${(liveTelemetry.diagnostics.memory.usedBytes / 1073741824).toFixed(1)} / ${(liveTelemetry.diagnostics.memory.totalBytes / 1073741824).toFixed(1)} GB` : '—'}</b></span><span>STORAGE<b>{liveTelemetry.diagnostics?.storage?.[0]?.sizeBytes ? `${(liveTelemetry.diagnostics.storage[0].usedBytes / 1073741824).toFixed(1)} / ${(liveTelemetry.diagnostics.storage[0].sizeBytes / 1073741824).toFixed(1)} GB` : '—'}</b></span><span>WI-FI<b>{liveTelemetry.diagnostics?.wifi?.[0]?.ssid || liveTelemetry.diagnostics?.wifi?.[0]?.description || liveTelemetry.diagnostics?.wifi?.[0]?.iface || 'NO_WIFI_LINK'}</b></span><span>BLUETOOTH<b>{liveTelemetry.diagnostics?.bluetooth?.filter((item: any) => item.connected).length || 0} CONNECTED</b></span><span>THERMAL<b>{liveTelemetry.diagnostics?.temperature?.mainCelsius != null ? `${liveTelemetry.diagnostics.temperature.mainCelsius}°C` : 'SENSOR_NA'}</b></span><span>UPTIME<b>{liveTelemetry.diagnostics?.device?.uptimeSeconds ? `${Math.floor(liveTelemetry.diagnostics.device.uptimeSeconds / 3600)}H ${Math.floor(liveTelemetry.diagnostics.device.uptimeSeconds / 60) % 60}M` : '—'}</b></span><span>SOURCE<b>{liveTelemetry.diagnostics?.telemetrySource || 'PROBING'}</b></span><span>ACCESS<b>{liveTelemetry.diagnostics?.access?.administratorRequired ? 'ADMIN_REQUIRED' : 'STANDARD_USER'}</b></span></div><div className="diagnostic-network-details"><div className="diagnostic-network-head"><span>NETWORK_DETAILS</span><b>{liveTelemetry.network?.latencyMs != null ? `${liveTelemetry.network.latencyMs} ms PING` : 'PING_NA'}</b></div><div className="diagnostic-network-summary"><span>PUBLIC_IP<b>{liveTelemetry.network?.publicIp || '—'}</b></span><span>INTERFACES<b>{liveTelemetry.network?.interfaces?.length || 0}</b></span><span>CONNECTIONS<b>{liveTelemetry.network?.connections?.length || 0}</b></span></div><div className="diagnostic-interface-list">{(liveTelemetry.network?.interfaces || []).slice(0, 4).map((item: any) => <div key={`${item.iface}-${item.mac}`}><b>{item.iface || 'IFACE'}</b><span>{item.ip4 || 'NO_IPV4'} // {item.mac || 'NO_MAC'}</span><em>{item.operstate || 'UNKNOWN'}</em></div>)}</div></div></Panel></div>
        <Panel className="chat-panel" scan>
          <div className="panel-head"><span className="eyebrow"><MessageSquare size={14} /> [ JARVIS_DIALOGUE ]</span><div className="chat-tools"><span className="data">{pendingApproval ? 'APPROVAL_PENDING' : thinking ? 'PROCESSING' : 'READY'}</span><button onClick={() => setMessages(initialMessages)} aria-label="clear chat"><RefreshCw size={14} /></button></div></div>
          <div className="chat-stream" ref={chatStreamRef}>{messages.map((message, index) => <motion.div key={`${message.timestamp}-${index}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`message ${message.role}`}><div className="message-meta"><span>{message.role === 'assistant' ? assistantName : userName}</span><small>{message.provider || 'LOCAL'} // {message.timestamp}</small></div><p>{message.content}</p>{message.images?.length ? <div className="message-images">{message.images.map((image, imageIndex) => <img key={`${message.timestamp}-${imageIndex}`} src={image} alt={`Generated result ${imageIndex + 1}`} /> : null}</div> : null}</motion.div>)}{thinking && <div className="thinking"><span /><span /><span /> JARVIS IS SYNTHESIZING</div>}<div ref={chatEnd} /></div>
          <AnimatePresence initial={false}>{pendingApproval?.status === 'pending' && <motion.div className="approval-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="approval-header"><div><span className="eyebrow">[ SECURITY_GATE // HUMAN_APPROVAL ]</span><strong>AUTHORIZE STATE-CHANGING ACTION</strong></div><ShieldCheck size={18} /></div>
            <p className="approval-summary">{pendingApproval.summary}</p>
            <div className="approval-meta"><span>RISK<b className="tone-red">{pendingApproval.risk.toUpperCase()}</b></span><span>AUTHORITY<b>{pendingApproval.authority}</b></span><span>EXPIRES<b>{new Date(pendingApproval.expiresAt).toLocaleTimeString()}</b></span></div>
            <div className="approval-actions"><button className="approval-reject" onClick={() => void rejectPendingApproval()} disabled={approvalBusy}><X size={14} /> REJECT</button><button className="approval-approve" onClick={() => void executeApproved()} disabled={approvalBusy}><ShieldCheck size={14} /> {approvalBusy ? 'EXECUTING...' : 'APPROVE & CONTINUE'}</button></div>
          </motion.div>}</AnimatePresence>
          <div className="composer"><button className={listening ? 'mic active' : 'mic'} onClick={toggleVoiceInput} aria-label="toggle listening"><Mic2 size={17} /></button><button className={scannerActive ? 'mic active' : 'mic'} onClick={() => setScannerActive(!scannerActive)} aria-label="toggle scanner" title="Toggle Biometric Scanner"><ScanFace size={17} /></button><input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onComposerKey} placeholder="ENTER COMMAND // ASK JARVIS ANYTHING" disabled={approvalBusy} /><button className="send" onClick={() => void send()} aria-label="send command" disabled={approvalBusy}><Send size={16} /></button></div>
        </Panel>
        <AudioAnalysis listening={listening} speaking={speaking} />
      </div></section>
        <section className="unified-mark"><Mark04 providers={providers} models={models} listening={listening} speaking={speaking} telemetry={sharedTelemetry} onListen={toggleVoiceInput} onTelemetry={handleTelemetry} onRefreshModels={refreshModels} /></section>
      </div>
      <AnimatePresence>{settingsOpen && <motion.div className="settings-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><motion.section className="settings-drawer" initial={{ opacity: 0, x: 24, scale: .98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 24, scale: .98 }}><div className="settings-drawer-head"><div><span className="eyebrow">[ CAPACITOR // SETTINGS ]</span><strong>JARVIS CONFIGURATION</strong></div><button className="settings-close" onClick={() => setSettingsOpen(false)} aria-label="close settings"><X size={17} /></button></div><SystemPanel onFaceRecognized={handleFaceRecognized} voiceStatus={voiceStatus} voiceProfile={voiceProfile} setVoiceProfile={setVoiceProfile} providers={providers} setProviders={setProviders} geminiKeys={geminiKeys} setGeminiKeys={setGeminiKeys} voice={voice} setVoice={setVoice} language={language} setLanguage={setLanguage} assistantName={assistantName} setAssistantName={setAssistantName} userName={userName} setUserName={setUserName} legacyKeys={legacyKeys} setLegacyKeys={setLegacyKeys} voiceSearch={voiceSearch} setVoiceSearch={setVoiceSearch} wakeWord={wakeWord} setWakeWord={setWakeWord} voiceEnabled={voiceEnabled} setVoiceEnabled={setVoiceEnabled} models={selectedModels} modelStatus={modelStatus} selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider} refreshModels={refreshModels} persist={persist} /></motion.section></motion.div>}</AnimatePresence>
    </main>
    {scannerActive && (
      <HolographicScanner onRecognized={handleFaceRecognized} onClose={() => setScannerActive(false)} />
    )}
    {toast && <motion.div className="toast" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}><Radio size={14} />{toast}</motion.div>}
  </div>;

}

function SystemPanel({ onFaceRecognized, voiceStatus, voiceProfile, setVoiceProfile, providers, setProviders, geminiKeys, setGeminiKeys, voice, setVoice, language, setLanguage, assistantName, setAssistantName, userName, setUserName, legacyKeys, setLegacyKeys, voiceSearch, setVoiceSearch, wakeWord, setWakeWord, voiceEnabled, setVoiceEnabled, models, modelStatus, selectedProvider, setSelectedProvider, refreshModels, persist }: { onFaceRecognized: (profile: FaceProfile) => void; voiceStatus: { nativeListen: boolean; piper: boolean; kokoro: boolean; edge: boolean; note: string }; voiceProfile: VoiceProfile; setVoiceProfile: (value: VoiceProfile) => void; providers: ProviderConfig[]; setProviders: React.Dispatch<React.SetStateAction<ProviderConfig[]>>; geminiKeys: string[]; setGeminiKeys: React.Dispatch<React.SetStateAction<string[]>>; voice: string; setVoice: (value: string) => void; language: string; setLanguage: (value: string) => void; assistantName: string; setAssistantName: (value: string) => void; userName: string; setUserName: (value: string) => void; legacyKeys: { CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string }; setLegacyKeys: React.Dispatch<React.SetStateAction<{ CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string }>>; voiceSearch: string; setVoiceSearch: (value: string) => void; wakeWord: boolean; setWakeWord: (value: boolean) => void; voiceEnabled: boolean; setVoiceEnabled: (value: boolean) => void; models: ModelInfo[]; modelStatus: string; selectedProvider?: ProviderId; setSelectedProvider: (value?: ProviderId) => void; refreshModels: () => Promise<void>; persist: (next: Partial<{ providers: ProviderConfig[]; geminiKeys: string[]; voice: string; voiceProfile: VoiceProfile; language: string; wakeWord: boolean; voiceEnabled: boolean; assistantName: string; userName: string; legacyKeys: { CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string } }>) => Promise<void> }) {
  const languageOptions = Array.from(new Set(EDGE_VOICES.map((item) => item.locale.split('-')[0]))).sort();
  const filteredVoices = EDGE_VOICES.filter((item) => !voiceSearch || `${item.id} ${item.locale} ${item.gender} ${item.personalities.join(' ')}`.toLowerCase().includes(voiceSearch.toLowerCase()));

  const handleGeminiKeyChange = (index: number, value: string) => {
    const next = [...geminiKeys];
    next[index] = value;
    setGeminiKeys(next);
    const clean = next.filter((k) => k.trim());
    setProviders((current) =>
      current.map((p) =>
        p.id === 'gemini'
          ? { ...p, key: clean[0] || '', keys: clean, status: clean.length ? ('online' as const) : ('unconfigured' as const) }
          : p
      )
    );
  };

  const handleAddGeminiKey = () => {
    setGeminiKeys([...geminiKeys, '']);
  };

  const handleRemoveGeminiKey = (index: number) => {
    const next = geminiKeys.filter((_, i) => i !== index);
    const final = next.length ? next : [''];
    setGeminiKeys(final);
    const clean = final.filter((k) => k.trim());
    const nextProviders: ProviderConfig[] = providers.map((p) =>
      p.id === 'gemini'
        ? { ...p, key: clean[0] || '', keys: clean, status: clean.length ? ('online' as const) : ('unconfigured' as const) }
        : p
    );
    setProviders(nextProviders);
    void persist({ geminiKeys: final, providers: nextProviders });
  };

  const handleBlurGeminiKey = () => {
    const clean = geminiKeys.filter((k) => k.trim());
    const nextProviders: ProviderConfig[] = providers.map((p) =>
      p.id === 'gemini'
        ? { ...p, key: clean[0] || '', keys: clean, status: clean.length ? ('online' as const) : ('unconfigured' as const) }
        : p
    );
    void persist({ geminiKeys, providers: nextProviders });
  };

  return <div className="settings-grid"><FaceRecognition operatorName={userName} operatorWork="Student, Developer, Tech Researcher" voice={voice} language={language} voiceProfile={voiceProfile} onRecognized={onFaceRecognized} /><Panel className="security-panel" scan><div className="panel-head"><span className="eyebrow">[ SECURITY_PROTOCOLS ]</span><LockKeyhole size={16} /></div><div className="toggle-list"><Toggle label="KEYCHAIN_ENCRYPTION" detail="OS-protected API key vault" checked={true} onChange={() => undefined} /><Toggle label="SAFE_SYSTEM_ACTIONS" detail="Allowlisted native commands only" checked={true} onChange={() => undefined} /><Toggle label="WAKE_WORD_ENGINE" detail="Listen for “Hey JARVIS”" checked={wakeWord} onChange={(value) => { setWakeWord(value); void persist({ wakeWord: value }); }} /><Toggle label="VOICE_RESPONSE" detail="Speak assistant responses" checked={voiceEnabled} onChange={(value) => { setVoiceEnabled(value); void persist({ voiceEnabled: value }); }} /></div><button className="outline-btn" onClick={() => void persist({ providers, geminiKeys, legacyKeys })}><ShieldCheck size={14} /> COMMIT SECURITY PROFILE</button><button className="outline-btn" onClick={() => void window.jarvis.requestElevation()}><LockKeyhole size={14} /> REQUEST WINDOWS ADMIN CONSOLE</button></Panel><Panel className="ai-params" scan><div className="panel-head"><span className="eyebrow"><SlidersHorizontal size={14} /> [ NEURAL_LINK_PARAMETERS ]</span><span className="data tone-cyan">{modelStatus}</span></div><div className="identity-settings"><div className="section-title"><Bot size={15} /> IDENTITY_CONFIGURATION</div><div className="identity-fields"><label>ASSISTANT_NAME<input value={assistantName} onChange={(e) => setAssistantName(e.target.value)} onBlur={() => void persist({ assistantName })} /></label><label>OPERATOR_NAME<input value={userName} onChange={(e) => setUserName(e.target.value)} onBlur={() => void persist({ userName })} /></label><label>INPUT_LANGUAGE<select value={language} onChange={(e) => { setLanguage(e.target.value); void persist({ language: e.target.value }); }}>{languageOptions.map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}</select></label></div></div><div className="voice-block"><div className="voice-runtime"><span>VOICE_RUNTIME</span><b className={voiceStatus.nativeListen ? 'ok' : 'warn'}>{voiceStatus.nativeListen ? 'NATIVE_LISTEN_READY' : 'NATIVE_LISTEN_UNAVAILABLE'}</b><b className={voiceStatus.piper ? 'ok' : 'warn'}>{voiceStatus.piper ? 'PIPER_READY' : 'PIPER_MISSING'}</b><b className={voiceStatus.kokoro ? 'ok' : 'warn'}>{voiceStatus.kokoro ? 'KOKORO_READY' : 'KOKORO_OPTIONAL'}</b></div><div className="section-title"><Volume2 size={16} /> VOICE SYNTHESIS <span className="data">{filteredVoices.length}_VOICES // {language.toUpperCase()}_INPUT</span><button className="mini-btn refresh" onClick={() => void (async () => { const result = await window.jarvis.speak({ text: `${assistantName} voice channel online, ${userName}.`, voice, language, voiceProfile }); if (result.dataUrl) await new Audio(result.dataUrl).play(); else window.alert(result.error || 'Voice synthesis unavailable.'); })()}><Headphones size={12} /> TEST VOICE</button></div><div className="profile-options">{VOICE_PROFILES.map((item) => <button key={item.id} className={voiceProfile === item.id ? 'profile-card selected' : 'profile-card'} onClick={() => { setVoiceProfile(item.id); void persist({ voiceProfile: item.id }); }}><span>{item.label}</span><small>{item.detail}</small></button>)}</div><div className="voice-search"><input value={voiceSearch} onChange={(e) => setVoiceSearch(e.target.value)} placeholder="FILTER 302 EDGE TTS VOICES BY ID, LOCALE, GENDER" /><span>{filteredVoices.length} MATCHES</span></div><div className="voice-options">{filteredVoices.map((item) => <button key={item.id} className={voice === item.id ? 'voice-card selected' : 'voice-card'} onClick={() => { setVoice(item.id); void persist({ voice: item.id }); }}><span>{item.id.split('-').slice(2).join(' ')}</span><small>{item.locale} // {item.gender}</small><code>{item.personalities.join(' / ') || item.categories.join(' / ') || 'GENERAL'}</code></button>)}</div></div><div className="provider-block"><div className="section-title"><Link2 size={16} /> PROVIDER_ROUTING & MODELS <span className="data">{providers.filter((p) => p.key || (p.keys && p.keys.length > 0)).length}/{providers.length}_CONFIGURED</span></div><div className="gemini-pool-section"><div className="section-title"><Zap size={15} /> GOOGLE GEMINI MULTI-KEY POOL (FAILOVER ROTATION)<span className="data">{geminiKeys.filter((k) => k.trim()).length}_KEYS_ACTIVE</span></div><div className="gemini-pool-desc">Configure separate Google Gemini API keys (e.g. from multiple accounts). JARVIS uses Key 1 primarily, and smoothly rotates to Key 2, Key 3, and so on upon reaching free quota limits (HTTP 429) without showing errors.</div><div className="gemini-keys-list">{geminiKeys.map((keyVal, idx) => (<div className="gemini-key-row" key={idx}><span className="gemini-key-label"><i className={`key-dot ${keyVal.trim() ? 'active' : ''}`} />{idx === 0 ? 'KEY 1 (PRIMARY)' : `KEY ${idx + 1}`}</span><input className="key-input gemini-key-input" type="password" placeholder={keyVal ? '••••••••••••••••' : `PASTE GEMINI KEY ${idx + 1}...`} value={keyVal} onChange={(e) => handleGeminiKeyChange(idx, e.target.value)} onBlur={handleBlurGeminiKey} /><button className="mini-btn gemini-key-remove" onClick={() => handleRemoveGeminiKey(idx)} title="Delete key" disabled={geminiKeys.length <= 1 && !keyVal}><Trash2 size={12} /></button></div>))}</div><button className="outline-btn gemini-add-btn" onClick={handleAddGeminiKey}><Plus size={13} /> + ADD SEPARATE GEMINI KEY LINE</button></div><div className="provider-table">{providers.map((provider, index) => { const curated = CURATED_MODELS[provider.id] || []; const dynamic = models.filter((m) => m.provider === provider.id && !curated.some((c) => c.id === m.id)); return (<div className="provider-row-enhanced" key={provider.id}><div className="provider-name"><span className={`provider-dot ${provider.key || (provider.keys && provider.keys.length > 0) ? 'online' : ''}`} /><b>{provider.name}</b><small>{provider.baseUrl}</small></div><select value={selectedProvider || ''} onChange={(e) => setSelectedProvider((e.target.value || undefined) as ProviderId | undefined)} aria-label={`preferred provider for ${provider.name}`}><option value="">AUTO</option><option value={provider.id}>THIS</option></select><select className="model-select" value={provider.model || ''} onChange={(e) => { const modelVal = e.target.value; const nextProviders = providers.map((p) => (p.id === provider.id ? { ...p, model: modelVal } : p)); setProviders(nextProviders); void persist({ providers: nextProviders }); }} aria-label={`model for ${provider.name}`}>{curated.map((m) => (<option key={m.id} value={m.id}>{m.label} {m.tier === 'free' ? '[FREE]' : '[PAID]'}</option>))}{dynamic.map((m) => (<option key={m.id} value={m.id}>{m.name || m.id} [API]</option>))}{!curated.length && !dynamic.length && (<option value={provider.model || 'default'}>{provider.model || 'DEFAULT MODEL'}</option>)}</select>{provider.id === 'gemini' ? (<div className="gemini-pool-badge"><Zap size={10} /><span>{geminiKeys.filter((k) => k.trim()).length} KEY(S) IN POOL</span></div>) : (<input className="key-input" type="password" placeholder={provider.key ? '••••••••••••' : 'PASTE_API_KEY'} value={provider.key || ''} onChange={(e) => setProviders((current) => current.map((item) => (item.id === provider.id ? { ...item, key: e.target.value, status: e.target.value ? 'online' : 'unconfigured' } : item)))} onBlur={() => void persist({ providers })} />)}<button className="mini-btn" onClick={() => { const nextProviders = providers.map((item) => (item.id === provider.id ? { ...item, enabled: !item.enabled } : item)); setProviders(nextProviders); void persist({ providers: nextProviders }); }}>{provider.enabled ? 'ON' : 'OFF'}</button><span className="priority">P{index + 1}</span></div>); })}</div><div className="legacy-key-section"><div className="section-title"><KeyRoundIcon /> IMPORTED_BACKEND_KEYS <span className="data">COHERE // GROQ // HF</span></div>{(['CohereAPIKey', 'GroqAPIKey', 'HuggingFaceAPIKey'] as const).map((key) => <label className="legacy-key-row" key={key}><span>{key}</span><input type="password" placeholder="OPTIONAL LEGACY KEY" value={legacyKeys[key] || ''} onChange={(e) => { const value = e.target.value; setLegacyKeys((current) => ({ ...current, [key]: value })); const providerId = key === 'CohereAPIKey' ? 'cohere' : key === 'GroqAPIKey' ? 'groq' : 'huggingface'; setProviders((current) => current.map((item) => item.id === providerId ? { ...item, key: value, status: value ? 'online' : 'unconfigured' } : item)); }} onBlur={() => void persist({ legacyKeys, providers })} /></label>)}</div></div><div className="model-block"><div className="section-title"><Cpu size={16} /> LIVE_MODEL_INDEX <button className="mini-btn refresh" onClick={() => void refreshModels()}><RefreshCw size={12} /> SYNC</button></div><div className="model-chips">{models.slice(0, 18).map((model) => <span key={`${model.provider}-${model.id}`} className="model-chip">{model.provider.toUpperCase()}::{model.id}</span>)}{models.length === 0 && <span className="empty-note">Add keys, then sync to retrieve currently available models.</span>}</div></div></Panel></div>;
}

function KeyRoundIcon() { return <KeyRound size={15} />; }

function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-row"><span><b>{label}</b><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i /></label>; }

export default App;
