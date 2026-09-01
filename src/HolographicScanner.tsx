import { useEffect, useRef, useState } from 'react';
import type * as FaceApi from '@vladmandic/face-api';
import { type FaceProfile } from './FaceRecognition';

const MODEL_URL = './face-models';
const MATCH_THRESHOLD = 0.52;
const GREETING_COOLDOWN_MS = 60_000;

interface HolographicScannerProps {
  onRecognized: (profile: FaceProfile) => void;
  onClose?: () => void;
}

export default function HolographicScanner({ onRecognized }: HolographicScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionTimerRef = useRef<number | null>(null);
  const faceApiRef = useRef<typeof FaceApi | null>(null);
  
  const [status, setStatus] = useState('INITIALIZING_OPTICS');
  const [targetInfo, setTargetInfo] = useState<{ name: string; confidence: number; relation: string } | null>(null);
  const [hasProfiles, setHasProfiles] = useState(false);
  const [greetingBanner, setGreetingBanner] = useState<string | null>(null);
  
  // Refs to avoid stale closures in background loops
  const profilesRef = useRef<FaceProfile[]>([]);
  const lastGreetingRef = useRef<Record<string, number>>({});
  const busyRef = useRef(false);
  const activeRef = useRef(false);
  const onRecognizedRef = useRef(onRecognized);

  useEffect(() => {
    onRecognizedRef.current = onRecognized;
  }, [onRecognized]);

  useEffect(() => {
    let isMounted = true;
    activeRef.current = true;

    // Load enrolled profiles for matching
    window.jarvis.faceProfiles().then(profiles => {
      if (!isMounted) return;
      profilesRef.current = profiles || [];
      setHasProfiles((profiles || []).length > 0);
    }).catch((err) => {
      console.error('Failed to load face profiles:', err);
    });

    async function initCamera() {
      try {
        setStatus('LOADING_NEURAL_MODELS');
        const faceapi = faceApiRef.current || await import('@vladmandic/face-api');
        if (!isMounted) return;
        faceApiRef.current = faceapi;
        
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);

        if (!isMounted) return;

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('CAMERA_API_UNAVAILABLE');
        }
        
        setStatus('ESTABLISHING_VIDEO_LINK');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, 
          audio: false 
        });
        
        if (!isMounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {
            // Autoplay could throw if quickly unmounted
          }
        }

        setStatus('BIOMETRIC_SCAN_ACTIVE');
        
        // Start recognition loop with activeRef guard
        if (recognitionTimerRef.current) {
          window.clearInterval(recognitionTimerRef.current);
        }
        recognitionTimerRef.current = window.setInterval(() => {
          void runDetectionStep();
        }, 600);
      } catch (err) {
        if (!isMounted) return;
        setStatus('OPTICS_FAILURE // CAMERA_UNAVAILABLE');
        console.error('Optics failure:', err);
      }
    }

    void initCamera();

    return () => {
      isMounted = false;
      activeRef.current = false;
      if (recognitionTimerRef.current) {
        window.clearInterval(recognitionTimerRef.current);
        recognitionTimerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  async function runDetectionStep() {
    if (busyRef.current || !activeRef.current) return;
    const faceapi = faceApiRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!faceapi || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    
    busyRef.current = true;
    try {
      // Resize canvas to match video display size
      if (canvas && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
      }

      const detection = await faceapi.detectSingleFace(
        video, 
        new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 })
      ).withFaceLandmarks(true).withFaceDescriptor();

      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      if (!detection) {
        setTargetInfo(null);
        setStatus(profilesRef.current.length > 0 ? 'BIOMETRIC_SCAN_ACTIVE // SCANNING...' : 'BIOMETRIC_SCAN_ACTIVE // NO_PROFILES_ENROLLED');
        return;
      }

      const box = detection.detection.box;
      const landmarks = detection.landmarks;
      const currentProfiles = profilesRef.current;

      // Draw HUD brackets and landmarks on canvas
      if (ctx && canvas) {
        drawHoloHud(ctx, canvas.width, box, landmarks, targetInfo?.name);
      }

      // Check if any profiles are enrolled for biometric matching
      if (!currentProfiles.length) {
        setTargetInfo(null);
        setStatus(`FACE_DETECTED [${Math.round(detection.detection.score * 100)}%] // ENROLL_IN_SETTINGS`);
        return;
      }

      const labeled = currentProfiles.map((profile) => 
        new faceapi.LabeledFaceDescriptors(profile.id, profile.embeddings.map((embedding) => new Float32Array(embedding)))
      );
      
      const match = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD).findBestMatch(detection.descriptor);
      
      if (match.label === 'unknown') {
        setTargetInfo(null);
        setStatus(`UNKNOWN_ENTITY // MATCH_DISTANCE_${match.distance.toFixed(2)}`);
        return;
      }

      const profile = currentProfiles.find((item) => item.id === match.label);
      if (!profile) return;

      const confidence = Math.max(1, Math.min(99, Math.round((1 - match.distance) * 100)));
      setTargetInfo({ name: profile.displayName, confidence, relation: profile.relation });
      setStatus(`TARGET_LOCKED // ${profile.displayName.toUpperCase()} [${confidence}%]`);

      const now = Date.now();
      const lastGreetTime = lastGreetingRef.current[profile.id] || 0;
      
      // Greet if it's been longer than the cooldown
      if (now - lastGreetTime > GREETING_COOLDOWN_MS) {
        lastGreetingRef.current[profile.id] = now;
        const bannerText = profile.relation === 'operator' 
          ? `OPERATOR IDENTIFIED: ${profile.displayName.toUpperCase()} // WELCOME BACK`
          : `AUTHENTICATED: ${profile.displayName.toUpperCase()}`;
        setGreetingBanner(bannerText);
        setTimeout(() => setGreetingBanner(null), 4000);
        onRecognizedRef.current(profile);
      }
    } catch (err) {
      console.error('Recognition step error:', err);
    } finally {
      busyRef.current = false;
    }
  }

  function drawHoloHud(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    box: { x: number; y: number; width: number; height: number },
    landmarks: FaceApi.FaceLandmarks68,
    targetName?: string
  ) {
    // Mirror horizontally to match mirrored video feed
    const mirroredX = canvasWidth - (box.x + box.width);
    const y = box.y;
    const w = box.width;
    const h = box.height;
    const cornerLength = Math.min(22, w * 0.25);

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00e5ff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;

    // Top-Left corner
    ctx.beginPath();
    ctx.moveTo(mirroredX, y + cornerLength);
    ctx.lineTo(mirroredX, y);
    ctx.lineTo(mirroredX + cornerLength, y);
    ctx.stroke();

    // Top-Right corner
    ctx.beginPath();
    ctx.moveTo(mirroredX + w - cornerLength, y);
    ctx.lineTo(mirroredX + w, y);
    ctx.lineTo(mirroredX + w, y + cornerLength);
    ctx.stroke();

    // Bottom-Left corner
    ctx.beginPath();
    ctx.moveTo(mirroredX, y + h - cornerLength);
    ctx.lineTo(mirroredX, y + h);
    ctx.lineTo(mirroredX + cornerLength, y + h);
    ctx.stroke();

    // Bottom-Right corner
    ctx.beginPath();
    ctx.moveTo(mirroredX + w - cornerLength, y + h);
    ctx.lineTo(mirroredX + w, y + h);
    ctx.lineTo(mirroredX + w, y + h - cornerLength);
    ctx.stroke();

    // Center crosshair
    const cx = mirroredX + w / 2;
    const cy = y + h / 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();

    // Subtle facial landmarks
    if (landmarks && landmarks.positions) {
      ctx.fillStyle = 'rgba(0, 229, 255, 0.6)';
      ctx.shadowBlur = 4;
      landmarks.positions.forEach((pt, index) => {
        // Draw every 2nd point for cleaner sci-fi aesthetic
        if (index % 2 === 0) {
          const ptMirroredX = canvasWidth - pt.x;
          ctx.beginPath();
          ctx.arc(ptMirroredX, pt.y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // Target label badge
    if (targetName) {
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      const label = `[ ${targetName.toUpperCase()} ]`;
      const textWidth = ctx.measureText(label).width;
      
      ctx.fillStyle = 'rgba(4, 16, 24, 0.85)';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1;
      ctx.fillRect(mirroredX, Math.max(10, y - 24), textWidth + 12, 18);
      ctx.strokeRect(mirroredX, Math.max(10, y - 24), textWidth + 12, 18);
      
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(label, mirroredX + 6, Math.max(10, y - 24) + 13);
    }

    ctx.restore();
  }

  return (
    <div className="holographic-scanner">
      {/* Live mirrored video feed with sci-fi filter */}
      <video 
        ref={videoRef} 
        autoPlay 
        muted 
        playsInline 
        width="640" 
        height="480" 
        className="holo-video"
      />
      
      {/* Real-time Face Tracking HUD Canvas */}
      <canvas ref={canvasRef} className="holo-canvas" />

      {/* Pure CSS Holographic HUD Animation */}
      <div className="holo-grid" />
      
      {!targetInfo && (
        <div className="holo-reticle">
          <div className="holo-corner top-left" />
          <div className="holo-corner top-right" />
          <div className="holo-corner bottom-left" />
          <div className="holo-corner bottom-right" />
          <div className="holo-crosshair" />
        </div>
      )}
      
      <div className="holo-scanline" />

      {greetingBanner && (
        <div className="holo-greeting-banner">
          <span className="holo-greeting-pulse" />
          {greetingBanner}
        </div>
      )}
      
      <div className="holo-status">
        <span className={`holo-dot ${targetInfo ? 'locked' : ''}`} />
        {status}
      </div>

      {!hasProfiles && (
        <div className="holo-enroll-tip">
          <span>NO BIOMETRIC PROFILES ENROLLED</span>
          <small>Open Settings ⚙ to register Operator face & voice profile</small>
        </div>
      )}
    </div>
  );
}
