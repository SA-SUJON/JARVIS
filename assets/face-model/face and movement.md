## Context (carry forward)
- Project: JARVIS Electron desktop app. 2D canvas holographic face-scan HUD already built in face-scan-hologram.js (+ .css/.html). Zero external deps, Canvas2D only — no WebGL, no Three.js, no 3D.
- Current render system: buildFace() authors a static anatomical mesh once (SILHOUETTE_L/FEATURES → px[]/py[] via layout()). update(dt)/draw() currently only drive brightness pulses (breath, edgeWave) on that fixed mesh. State machine IDLE→SCANNING→COMPLETE is a canned choreography. There is currently ZERO live camera or detection wired in anywhere in this file.
- Locked architecture for live tracking: a hidden <video> element (camera source via getUserMedia, NEVER rendered to screen) feeds detection; the existing visible canvas renders ONLY the hologram. These two must stay fully separate — recognition accuracy must never depend on anything being visually shown.
- Tracking library: @mediapipe/tasks-vision — FaceLandmarker (outputFaceBlendshapes: true, numFaces: 1, runningMode: 'VIDEO') + HandLandmarker (runningMode: 'VIDEO'), both fed by the hidden video, running on their own loop independent of the hologram's rAF tick.
- Face-movement approach: do NOT replace the authored mesh with raw MediaPipe points — it must keep its current hand-sculpted look. Instead, tag existing points with a `group` field in buildFace()'s FEATURES loop (mouth, jaw, browL, browR, eyeL, eyeR). At runtime, offset only those grouped px[]/py[] values from live blendshape scores (jawOpen, mouthSmileLeft/Right, browInnerUp, etc.) inside update(dt), before draw() reads them. Every other draw function (edges/nodes/glow/pulse/scan choreography) stays untouched — it will inherit the movement automatically since it already reads px/py.
- Hand rendering: separate, simpler system. Draw raw 21-point-per-hand skeletons straight from HandLandmarker output, styled with this file's existing rgba(CYAN/ACCENT,...) palette, using MediaPipe's standard hand connection topology.
- Bridge: mount()'s returned object gets a new method, e.g. applyTracking({ blendshapes, handLandmarks }), called by the detection loop whenever a fresh result lands. Smooth all incoming values with an EMA/low-pass filter before applying — raw per-frame values are visibly jittery.

## Task
The hologram is currently mounted inline in the app's main chat/UI flow. Change it to a floating, dismissible popup panel, and add the live tracking described above.

### 1. Panel relocation
- Remove the current inline mount point.
- Mount the component into a new floating overlay panel instead: `position: fixed`, anchored top-left of the viewport, highest z-index in the app.
- Reuse whatever currently triggers this component's mount()/startScan() call to open the panel — locate it in the codebase yourself, do not invent a new trigger.
- Give the panel a small dismiss control.

### 2. Panel frame — see attached reference photo
Build the panel's border as a curved tension-display-frame shape, not a plain rectangle:
- Top and bottom edges are shallow outward-bowing arcs, not straight lines.
- Left and right edges pinch inward slightly at vertical mid-height (hourglass/wave silhouette), flaring back out toward the corners.
- A thin vertical divider line runs down the panel's center, echoing the support pole in the reference photo.
- Implement with cubic Bézier curves (SVG path or Canvas path) — do not approximate with straight segments.
- Style: double-stroke glow (dim outer glow + bright core) using this file's existing CYAN/ACCENT rgba tokens, consistent with how EDGE_STYLE renders elsewhere in the file. Semi-transparent dark panel background. Do not introduce a new color palette.

### 3. Live face + hand tracking
Implement exactly the locked architecture above:
- Hidden <video>, getUserMedia, never rendered — verify no raw camera pixel ever reaches a visible element.
- FaceLandmarker + HandLandmarker via @mediapipe/tasks-vision, VIDEO mode, numFaces: 1, outputFaceBlendshapes: true.
- Add `group` tagging in buildFace()'s FEATURES loop and a new applyExpressionOffsets() function called at the top of update(dt).
- Add a new drawHands() call inside draw(), after drawNodes().
- Add the applyTracking() method to mount()'s returned object.

## Constraints
- MUST NOT display the raw camera feed anywhere in the UI, at any opacity, at any point.
- MUST NOT restructure the existing SCANNING/COMPLETE choreography, particle system, or drawEdges/drawNodes internals beyond what's needed to read the new offset values.
- MUST NOT add Three.js, WebGL, or any 3D dependency — Canvas2D only.
- Scope: only face-scan-hologram.js, face-scan-hologram.css, and whatever file currently mounts the component. Do not touch unrelated parts of the app.
- Ask before installing new dependencies or running any destructive terminal command.

## Deliverable / process
1. First produce an implementation plan (task list artifact) covering the file changes above — no code yet — for review.
2. On approval, implement.
3. After building, use the browser agent to verify: panel opens top-left on trigger, frame matches the curved reference shape at both 1440px and 375px, no raw camera video is ever visible, and the mesh visibly reacts to smiling, mouth movement, and a hand held in front of the camera.
4. After each step, output a one-line summary of what was completed.