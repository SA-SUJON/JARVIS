import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import type * as FaceApi from '@vladmandic/face-api';
import { mount } from './components/face-scan-hologram/face-scan-hologram.js';
import './components/face-scan-hologram/face-scan-hologram.css';
import { type FaceProfile } from './FaceRecognition';

const MODEL_URL = './face-models';
const MATCH_THRESHOLD = 0.52;
const GREETING_COOLDOWN_MS = 60_000;

interface HolographicScannerProps {
  onRecognized: (profile: FaceProfile) => void;
  onClose?: () => void;
}

export default function HolographicScanner({ onRecognized, onClose }: HolographicScannerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hologramRef = useRef<any>(null);

  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceApiRef = useRef<typeof FaceApi | null>(null);

  const [trackingStatus, setTrackingStatus] = useState('INITIALIZING_OPTICS');
  const profilesRef = useRef<FaceProfile[]>([]);
  const lastGreetingRef = useRef<Record<string, number>>({});
  const onRecognizedRef = useRef(onRecognized);

  useEffect(() => {
    onRecognizedRef.current = onRecognized;
  }, [onRecognized]);

  useEffect(() => {
    let isMounted = true;
    let animId = 0;
    let bioTimer = 0;

    // 1. Mount the holographic face canvas component inside container
    if (mountRef.current) {
      const fs = mount(mountRef.current, {
        onStateChange: (state: string) => {
          setTrackingStatus(`HOLO_STATE // ${state}`);
        },
      });
      hologramRef.current = fs;
      fs.startScan();
    }

    // 2. Load enrolled biometric profiles for matching
    if (window.jarvis?.faceProfiles) {
      window.jarvis.faceProfiles().then((profiles) => {
        if (!isMounted) return;
        profilesRef.current = profiles || [];
      }).catch((err) => {
        console.warn('Biometric profiles unavailable:', err);
      });
    }

    // 3. Initialize Camera & Tracking Engines
    async function initTrackingPipeline() {
      try {
        setTrackingStatus('CONFIGURING_OPTICS');
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('CAMERA_API_UNAVAILABLE');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = hiddenVideoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        setTrackingStatus('LOADING_VISION_MODELS');

        // Resolve vision tasks WASM
        let vision: any;
        try {
          vision = await FilesetResolver.forVisionTasks('./mediapipe/wasm');
        } catch {
          vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250305/wasm'
          );
        }

        if (!isMounted) return;

        // Initialize FaceLandmarker (Blendshapes enabled, VIDEO running mode)
        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        });

        // Initialize HandLandmarker (VIDEO running mode)
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });

        if (!isMounted) {
          faceLandmarker.close();
          handLandmarker.close();
          return;
        }

        faceLandmarkerRef.current = faceLandmarker;
        handLandmarkerRef.current = handLandmarker;
        setTrackingStatus('NEURAL_TRACKING_ONLINE');

        // 4. Start independent detection loop (fed by hidden video)
        let lastVideoTime = -1;
        function runVisionTick() {
          if (!isMounted) return;
          const vid = hiddenVideoRef.current;
          if (vid && vid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            if (vid.currentTime !== lastVideoTime) {
              lastVideoTime = vid.currentTime;
              const nowMs = performance.now();

              let blendshapes = null;
              let handLandmarks = null;

              if (faceLandmarkerRef.current) {
                try {
                  const faceRes = faceLandmarkerRef.current.detectForVideo(vid, nowMs);
                  if (faceRes.faceBlendshapes && faceRes.faceBlendshapes.length > 0) {
                    blendshapes = faceRes.faceBlendshapes[0].categories;
                  }
                } catch {
                  // Frame dropped or busy
                }
              }

              if (handLandmarkerRef.current) {
                try {
                  const handRes = handLandmarkerRef.current.detectForVideo(vid, nowMs);
                  if (handRes.landmarks && handRes.landmarks.length > 0) {
                    handLandmarks = handRes.landmarks;
                  }
                } catch {
                  // Frame dropped or busy
                }
              }

              if (hologramRef.current?.applyTracking) {
                hologramRef.current.applyTracking({ blendshapes, handLandmarks });
              }
            }
          }
          animId = requestAnimationFrame(runVisionTick);
        }
        animId = requestAnimationFrame(runVisionTick);

        // 5. Optional background identity check for operator greeting
        void initBiometricIdentity(video);
      } catch (err) {
        if (!isMounted) return;
        console.error('Vision tracking initialization failed:', err);
        setTrackingStatus('TRACKING_OFFLINE // FALLBACK_SIMULATION');
      }
    }

    async function initBiometricIdentity(video: HTMLVideoElement | null) {
      if (!video) return;
      try {
        const faceapi = faceApiRef.current || await import('@vladmandic/face-api');
        if (!isMounted) return;
        faceApiRef.current = faceapi;
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);

        bioTimer = window.setInterval(async () => {
          if (!isMounted || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          if (!profilesRef.current.length) return;
          try {
            const detection = await faceapi.detectSingleFace(
              video,
              new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
            ).withFaceLandmarks(true).withFaceDescriptor();

            if (!detection) return;
            const labeled = profilesRef.current.map((p) =>
              new faceapi.LabeledFaceDescriptors(p.id, p.embeddings.map((e) => new Float32Array(e)))
            );
            const matcher = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD);
            const match = matcher.findBestMatch(detection.descriptor);
            if (match.label !== 'unknown') {
              const profile = profilesRef.current.find((item) => item.id === match.label);
              if (!profile) return;
              const now = Date.now();
              const lastGreet = lastGreetingRef.current[profile.id] || 0;
              if (now - lastGreet > GREETING_COOLDOWN_MS) {
                lastGreetingRef.current[profile.id] = now;
                onRecognizedRef.current(profile);
              }
            }
          } catch {
            // Background identity probe failure ignored
          }
        }, 1200);
      } catch (e) {
        console.warn('Biometric identification model unavailable:', e);
      }
    }

    void initTrackingPipeline();

    return () => {
      isMounted = false;
      if (animId) cancelAnimationFrame(animId);
      if (bioTimer) clearInterval(bioTimer);
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (hologramRef.current) {
        hologramRef.current.destroy();
        hologramRef.current = null;
      }
    };
  }, []);

  return (
    <div className="fsh-popup-overlay">
      {/* 
        CRITICAL PRIVACY LOCK:
        Hidden <video> element strictly isolated from visible UI.
        Never rendered or displayed at any opacity at any point.
      */}
      <video
        ref={hiddenVideoRef}
        autoPlay
        muted
        playsInline
        style={{
          display: 'none',
          visibility: 'hidden',
          position: 'absolute',
          width: 0,
          height: 0,
          pointerEvents: 'none',
          opacity: 0,
        }}
      />

      <div className="fsh-popup-panel">
        {onClose && (
          <button
            className="fsh-dismiss-btn"
            onClick={onClose}
            aria-label="Dismiss Holographic Scanner"
            title="Dismiss scanner"
          >
            [ × ]
          </button>
        )}

        <div ref={mountRef} className="fsh-hologram-mount" />
      </div>
    </div>
  );
}
