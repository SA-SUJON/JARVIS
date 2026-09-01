import { useCallback, useEffect, useRef, useState } from 'react';
import type * as FaceApi from '@vladmandic/face-api';

type FaceProfile = Awaited<ReturnType<typeof window.jarvis.faceProfiles>>[number];

type FaceRecognitionProps = {
  operatorName: string;
  operatorWork: string;
  voice: string;
  language: string;
  voiceProfile: 'natural' | 'classic' | 'deep';
  onRecognized?: (profile: FaceProfile) => void;
};

const MODEL_URL = './face-models';
const MATCH_THRESHOLD = 0.52;
const VOICE_MATCH_THRESHOLD = 0.72;
const CONFIRMATION_FRAMES = 3;
const VOICE_SAMPLE_MS = 3200;
const VOICE_RETRY_COOLDOWN_MS = 8_000;
const GREETING_COOLDOWN_MS = 60_000;

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  writeText(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); writeText(8, 'WAVE'); writeText(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeText(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) { const value = Math.max(-1, Math.min(1, samples[index])); view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true); }
  return new Uint8Array(buffer);
}

function toBase64(bytes: Uint8Array) { let binary = ''; const chunk = 0x8000; for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length))); return btoa(binary); }
function cosineSimilarity(left: number[], right: number[]) { let dot = 0; let leftNorm = 0; let rightNorm = 0; for (let index = 0; index < Math.min(left.length, right.length); index += 1) { dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2; } return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : -1; }

export default function FaceRecognition({ operatorName, operatorWork, voice, language, voiceProfile, onRecognized }: FaceRecognitionProps) {
  const faceApiRef = useRef<typeof FaceApi | null>(null);
  const profilesRef = useRef<FaceProfile[]>([]);
  const enrollingRef = useRef(false);
  const onRecognizedRef = useRef(onRecognized);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionTimerRef = useRef<number | null>(null);
  const recognitionBusyRef = useRef(false);
  const voiceVerifyBusyRef = useRef(false);
  const candidateRef = useRef({ id: '', count: 0 });
  const lastGreetingRef = useRef({ id: '', at: 0 });
  const lastVoiceChallengeRef = useRef({ id: '', at: 0 });
  const [profiles, setProfiles] = useState<FaceProfile[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [status, setStatus] = useState('CAMERA_DISABLED');
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState(operatorName || '');
  const [relation, setRelation] = useState<'operator' | 'family'>('operator');
  const [age, setAge] = useState('');
  const [work, setWork] = useState(operatorWork || '');
  const [greeting, setGreeting] = useState('');
  const [notes, setNotes] = useState('');
  const [faceSamples, setFaceSamples] = useState<number[][]>([]);
  const [voiceSamples, setVoiceSamples] = useState<number[][]>([]);
  const [enrolling, setEnrolling] = useState(false);

  const loadProfiles = useCallback(async () => {
    try { setProfiles(await window.jarvis.faceProfiles()); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : String(loadError)); }
  }, []);

  useEffect(() => { profilesRef.current = profiles; }, [profiles]);
  useEffect(() => { enrollingRef.current = enrolling; }, [enrolling]);
  useEffect(() => { onRecognizedRef.current = onRecognized; }, [onRecognized]);
  useEffect(() => { if (!profiles.some((profile) => profile.relation === 'operator') && relation === 'operator') { if (!displayName) setDisplayName(operatorName || ''); if (!work) setWork(operatorWork || ''); } }, [operatorName, operatorWork, profiles, relation, displayName, work]);
  useEffect(() => { void loadProfiles(); return () => stopCamera(); }, [loadProfiles]);

  async function loadModels() {
    if (modelsReady) return;
    setStatus('FACE_MODELS_LOADING');
    const faceapi = faceApiRef.current || await import('@vladmandic/face-api');
    faceApiRef.current = faceapi;
    await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL), faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL), faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)]);
    setModelsReady(true);
  }

  async function startCamera() {
    setError('');
    try {
      await loadModels();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_API_UNAVAILABLE');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraActive(true); setStatus('CAMERA_ACTIVE // FACE_AND_VOICE_GATE'); startRecognitionLoop();
    } catch (cameraError) { setStatus('CAMERA_PERMISSION_REQUIRED'); setError(cameraError instanceof Error ? cameraError.message : String(cameraError)); stopCamera(); }
  }

  function stopCamera() {
    if (recognitionTimerRef.current != null) window.clearInterval(recognitionTimerRef.current);
    recognitionTimerRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false); setStatus('CAMERA_DISABLED'); candidateRef.current = { id: '', count: 0 };
  }

  async function detectDescriptor() {
    const faceapi = faceApiRef.current;
    if (!faceapi || !videoRef.current || videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    return await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.65 })).withFaceLandmarks(true).withFaceDescriptor();
  }

  function startRecognitionLoop() { if (recognitionTimerRef.current != null) window.clearInterval(recognitionTimerRef.current); recognitionTimerRef.current = window.setInterval(() => { void recognizeOnce(); }, 1200); }

  async function recordVoiceWav(durationMs = VOICE_SAMPLE_MS) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('MIC_API_UNAVAILABLE');
    const sttBefore = await window.jarvis.sttStatus().catch(() => ({ running: false, script: '' }));
    if (sttBefore.running) await window.jarvis.sttStop();
    let stream: MediaStream | null = null; let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      context = new AudioContext(); await context.resume();
      const source = context.createMediaStreamSource(stream); const processor = context.createScriptProcessor(4096, 1, 1); const mute = context.createGain(); mute.gain.value = 0;
      const chunks: Float32Array[] = []; processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor); processor.connect(mute); mute.connect(context.destination);
      await new Promise((resolve) => window.setTimeout(resolve, durationMs));
      processor.disconnect(); source.disconnect(); stream.getTracks().forEach((track) => track.stop());
      const sampleRate = context.sampleRate; await context.close(); context = null; stream = null;
      const length = chunks.reduce((total, chunk) => total + chunk.length, 0); const samples = new Float32Array(length); let offset = 0; for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
      return encodeWav(samples, sampleRate);
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      if (context) await context.close().catch(() => undefined);
      if (sttBefore.running) await window.jarvis.sttStart(language).catch(() => undefined);
    }
  }

  async function embedVoiceSample() { const wav = await recordVoiceWav(); setStatus('VOICE_EMBEDDING_LOCAL'); return await window.jarvis.voiceEmbed(toBase64(wav)); }

  async function verifyVoice(profile: FaceProfile) {
    if (!profile.voiceEmbeddings?.length || voiceVerifyBusyRef.current) { setStatus('VOICE_PROFILE_REQUIRED // NO_GREETING'); return false; }
    const now = Date.now(); if (lastVoiceChallengeRef.current.id === profile.id && now - lastVoiceChallengeRef.current.at < VOICE_RETRY_COOLDOWN_MS) return false;
    voiceVerifyBusyRef.current = true; lastVoiceChallengeRef.current = { id: profile.id, at: now }; setStatus('VOICE_VERIFICATION_REQUIRED // SPEAK_NOW');
    try {
      const embedding = await embedVoiceSample(); const score = Math.max(...profile.voiceEmbeddings.map((reference) => cosineSimilarity(reference, embedding)));
      if (score < VOICE_MATCH_THRESHOLD) { setStatus(`VOICE_MISMATCH // ${(score * 100).toFixed(0)}%`); return false; }
      setStatus(`FACE_AND_VOICE_CONFIRMED // ${(score * 100).toFixed(0)}%`); return true;
    } catch (voiceError) { setStatus('VOICE_VERIFICATION_UNAVAILABLE // NO_GREETING'); setError(voiceError instanceof Error ? voiceError.message : String(voiceError)); return false; }
    finally { voiceVerifyBusyRef.current = false; }
  }

  async function recognizeOnce() {
    const currentProfiles = profilesRef.current; if (recognitionBusyRef.current || enrollingRef.current || voiceVerifyBusyRef.current || !currentProfiles.length) return;
    recognitionBusyRef.current = true;
    try {
      const detection = await detectDescriptor(); if (!detection) { candidateRef.current = { id: '', count: 0 }; setStatus('FACE_SCAN // NO_FACE'); return; }
      const faceapi = faceApiRef.current; if (!faceapi) return;
      const labeled = currentProfiles.map((profile) => new faceapi.LabeledFaceDescriptors(profile.id, profile.embeddings.map((embedding) => new Float32Array(embedding))));
      const match = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD).findBestMatch(detection.descriptor);
      if (match.label === 'unknown') { candidateRef.current = { id: '', count: 0 }; setStatus('UNKNOWN_FACE // NO_GREETING'); return; }
      const profile = currentProfiles.find((item) => item.id === match.label); if (!profile) return;
      candidateRef.current = candidateRef.current.id === profile.id ? { id: profile.id, count: candidateRef.current.count + 1 } : { id: profile.id, count: 1 };
      setStatus(`FACE_MATCHED // ${profile.displayName.toUpperCase()} // ${(1 - match.distance).toFixed(2)} CONFIDENCE`);
      if (candidateRef.current.count < CONFIRMATION_FRAMES) return;
      if (await verifyVoice(profile)) {
        const now = Date.now();
        if (lastGreetingRef.current.id === profile.id && now - lastGreetingRef.current.at < GREETING_COOLDOWN_MS) return;
        lastGreetingRef.current = { id: profile.id, at: now };
        onRecognizedRef.current?.(profile);
      }
    } catch (recognitionError) { setStatus('FACE_RECOGNITION_ERROR'); setError(recognitionError instanceof Error ? recognitionError.message : String(recognitionError)); }
    finally { recognitionBusyRef.current = false; }
  }

  async function captureFaceSample() {
    if (!displayName.trim()) { setError('ENTER_PROFILE_NAME_FIRST'); return; }
    if (!cameraActive) { setError('START_CAMERA_FIRST'); return; }
    setError(''); setEnrolling(true); enrollingRef.current = true;
    try {
      const detection = await detectDescriptor(); if (!detection) { setError('NO_FACE_DETECTED // CENTER_FACE_AND_TRY_AGAIN'); return; }
      const nextSamples = [...faceSamples, Array.from(detection.descriptor)]; setFaceSamples(nextSamples); setStatus(`FACE_SAMPLE_${nextSamples.length}_OF_3`);
      if (nextSamples.length >= 3) setStatus('FACE_ENROLLED // CAPTURE_3_VOICE_SAMPLES');
    } catch (captureError) { setError(captureError instanceof Error ? captureError.message : String(captureError)); }
    finally { setEnrolling(false); enrollingRef.current = false; }
  }

  async function captureVoiceSample() {
    if (faceSamples.length < 3) { setError('CAPTURE_3_FACE_SAMPLES_FIRST'); return; }
    if (!displayName.trim()) { setError('ENTER_PROFILE_NAME_FIRST'); return; }
    setError(''); setEnrolling(true); enrollingRef.current = true;
    try {
      const embedding = await embedVoiceSample(); const nextSamples = [...voiceSamples, embedding]; setVoiceSamples(nextSamples); setStatus(`VOICE_SAMPLE_${nextSamples.length}_OF_3`);
      if (nextSamples.length >= 3) {
        const saved = await window.jarvis.saveFaceProfile({ displayName: displayName.trim(), relation, greeting: greeting.trim() || undefined, facts: { age: age ? Number(age) : null, work: work.trim(), notes: notes.trim() }, embeddings: faceSamples, voiceEmbeddings: nextSamples });
        setProfiles((current) => [...current.filter((item) => item.id !== saved.id), saved]); setFaceSamples([]); setVoiceSamples([]); setDisplayName(''); setAge(''); setWork(''); setGreeting(''); setNotes(''); setStatus(`PROFILE_ENROLLED // FACE_AND_VOICE // ${saved.displayName.toUpperCase()}`);
      }
    } catch (voiceError) { setStatus('VOICE_ENROLLMENT_ERROR'); setError(voiceError instanceof Error ? voiceError.message : String(voiceError)); }
    finally { setEnrolling(false); enrollingRef.current = false; }
  }

  async function removeProfile(profile: FaceProfile) { if (!window.confirm(`Delete the local face and voice profile for ${profile.displayName}?`)) return; try { await window.jarvis.deleteFaceProfile(profile.id); setProfiles((current) => current.filter((item) => item.id !== profile.id)); setStatus(`PROFILE_DELETED // ${profile.displayName.toUpperCase()}`); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : String(deleteError)); } }
  async function clearProfiles() { if (!profiles.length || !window.confirm('Delete every local face and voice biometric profile?')) return; try { await window.jarvis.clearFaceProfiles(); setProfiles([]); setStatus('BIOMETRIC_PROFILES_CLEARED'); } catch (clearError) { setError(clearError instanceof Error ? clearError.message : String(clearError)); } }

  return <section className="face-identity-panel">
    <div className="face-panel-head"><div><span className="section-title">FACE_AND_VOICE_IDENTITY // LOCAL_ONLY</span><small>No raw camera frames or audio recordings are stored. Greeting requires both biometric matches.</small></div><b className={cameraActive ? 'ok' : 'warn'}>{status}</b></div>
    <div className="face-camera-grid"><div className="face-camera-preview"><video ref={videoRef} muted playsInline aria-label="JARVIS local camera preview" /><div className="face-camera-overlay"><span>LOCAL_CAMERA_FEED</span><i className={cameraActive ? 'active' : ''} /></div></div><div className="face-camera-controls"><p>Enroll only yourself or family members who have agreed to be recognized. JARVIS requires three face samples, three voice samples, and a fresh voice challenge after a stable face match.</p><div className="face-actions"><button className="outline-btn" onClick={() => void (cameraActive ? Promise.resolve(stopCamera()) : startCamera())}>{cameraActive ? 'DISABLE CAMERA' : 'ENABLE CAMERA'}</button><button className="outline-btn" onClick={() => void captureFaceSample()} disabled={!cameraActive || enrolling}>{enrolling ? 'CAPTURING…' : `FACE SAMPLE ${Math.min(faceSamples.length + 1, 3)}/3`}</button><button className="outline-btn" onClick={() => void captureVoiceSample()} disabled={faceSamples.length < 3 || enrolling}>{enrolling ? 'LISTENING…' : `VOICE SAMPLE ${Math.min(voiceSamples.length + 1, 3)}/3`}</button></div>{error && <small className="face-error">{error}</small>}</div></div>
    <div className="face-profile-form"><label>PROFILE_NAME<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. SA SUJON" /></label><label>RELATION<select value={relation} onChange={(event) => setRelation(event.target.value as 'operator' | 'family')}><option value="operator">OPERATOR / BOSS</option><option value="family">FAMILY MEMBER</option></select></label><label>AGE<input type="number" min="0" max="150" value={age} onChange={(event) => setAge(event.target.value)} placeholder="OPTIONAL" /></label><label>WORK<input value={work} onChange={(event) => setWork(event.target.value)} placeholder="OPTIONAL" /></label><label>GREETING<input value={greeting} onChange={(event) => setGreeting(event.target.value)} placeholder={relation === 'operator' ? 'Hi Boss.' : 'Hello there.'} /></label><label>NOTES<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="OPTIONAL PROFILE CONTEXT" /></label></div>
    <div className="face-profile-list">{profiles.length ? profiles.map((profile) => <div className="face-profile-row" key={profile.id}><span className="face-profile-dot" /><div><b>{profile.displayName}</b><small>{profile.relation.toUpperCase()} // {profile.voiceEmbeddings?.length ? 'FACE_AND_VOICE_READY' : 'VOICE_ENROLLMENT_REQUIRED'}{profile.facts.work ? ` // ${profile.facts.work}` : ''}{profile.facts.age != null ? ` // AGE_${profile.facts.age}` : ''}</small></div><button className="mini-btn" onClick={() => void removeProfile(profile)}>DELETE</button></div>) : <small className="empty-note">No local profiles enrolled. Camera and microphone remain disabled until enabled.</small>}</div>
    {profiles.length > 0 && <button className="outline-btn face-clear" onClick={() => void clearProfiles()}>DELETE ALL LOCAL FACE AND VOICE PROFILES</button>}
  </section>;
}

export type { FaceProfile };
