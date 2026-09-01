# Face and voice identity verification

JARVIS supports an optional local dual-biometric greeting gate. The special greeting is released only after a stable face match and a matching speaker embedding for the same enrolled profile. Ordinary typed commands and the existing Chrome/Selenium `SpeechToText.py` voice-command path remain separate and continue to operate normally.

The face side uses the bundled browser `@vladmandic/face-api` models. The voice side uses the optional Python Resemblyzer encoder, which produces a 256-value voice embedding from a short speech sample. Resemblyzer documents speaker verification from a few seconds of reference speech and is Apache-2.0 licensed.[1]

Enrollment requires three face samples and three voice samples. Only embeddings are persisted; raw camera frames and raw microphone recordings are not persisted. Electron encrypts the serialized profile store with the operating system's `safeStorage`. If secure storage or the speaker-verification dependency is unavailable, JARVIS fails closed for the special greeting and does not revert to face-only recognition.

During recognition, JARVIS requires three consecutive face matches. It then asks the person in front of the camera to speak for approximately three seconds, computes a local voice embedding, and compares it against the same profile's voice samples. A successful dual match triggers the configured greeting, subject to a cooldown. An unknown face, a voice mismatch, unavailable microphone, or unavailable speaker model never triggers the greeting.

This is an identity convenience feature, not a security boundary. It must not be used alone for Windows unlock, administrator elevation, payment authorization, or destructive actions. Replay attacks and other spoofing scenarios require a future challenge-response or dedicated liveness design.

## Windows setup

Run `SETUP_JARVIS_PYTHON.ps1` once from the desktop project directory. It creates the supplied Python environment and installs `Requirements.txt`, including the optional Resemblyzer dependency. Then start the application with `npm run dev` or use the build-first `npm start` path.

Open the capacitor settings panel, enable the camera, complete the three face captures, then complete the three voice captures. Enroll family members only with their knowledge and permission. Use the delete controls to remove an individual profile or all local face and voice profiles.

## References

[1]: https://github.com/resemble-ai/Resemblyzer "Resemblyzer — voice embeddings and speaker verification"
[2]: https://github.com/vladmandic/face-api "FaceAPI — browser and Node.js face detection and recognition"
