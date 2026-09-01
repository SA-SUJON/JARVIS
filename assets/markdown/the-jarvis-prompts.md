JARVIS Tasks, References And Prompts That I Use:

001[THE HOLOGRAPHIC FACE]. # Context (carry forward)
Building JARVIS, a personal AI assistant with an Electron/Node.js desktop app. This is a new, isolated visual component for that app's UI — a holographic 3D face-scan animation. Target hardware includes an 8th-gen Intel i5 laptop with integrated graphics, so performance is a real constraint, not an afterthought.

# Task
Build a holographic 3D face-scanning visual effect as a standalone, framework-agnostic module for the Electron desktop app. Reference the attached images for target aesthetic: a glowing wireframe/point-cloud face rendered as a true rotating 3D object — not a flat illustration — with a scan sequence and sci-fi HUD framing.

# Outcome — three states
1. **Idle**: wireframe face point-cloud rotates slowly and continuously on its Y-axis in 3D space. Nodes (vertices) pulse gently. Low ambient glow.
2. **Scanning**: a horizontal scan-line sweeps top-to-bottom across the face. Nodes/edges brighten as the line crosses them, then settle back. A small monospace HUD data readout (a few animated numeric/percentage values) appears beside the face, like a live analysis panel.
3. **Complete**: scan-line fades, nodes flash briefly, then return to idle rotation.

# Visual spec
- True 3D scene (Three.js/WebGL) — the head must visibly rotate in perspective, not a flat sprite trick.
- Geometry: low-poly wireframe (visible triangulated edges) + glowing point nodes at vertices. Prioritize "Stark-tech HUD" look over anatomical realism.
- Color: cyan/electric-blue on a transparent background — this composites over a dark app UI, no opaque fill.
- Corner reticle brackets framing the face's bounding box, like a camera viewfinder (see reference images).
- Sparse particle dissolve drifting outward from the silhouette edges, matching the attached reference art.
- Stay abstract/geometric — no realistic human texture or photo-face.

# Technical constraints
- Stack: Three.js. Postprocessing/bloom is optional and must be toggleable — cap point/edge count and skip expensive full-screen effects if they drop frame rate on integrated graphics. Must hold ~60fps.
- Face mesh source: your choice, state it in the plan — either (a) a small CC0/public-domain low-poly head glTF with only vertices/edges rendered, or (b) a procedurally generated low-poly head approximation. No copyrighted or branded 3D assets.
- Package as a self-contained ES module exposing `mount(container)` / `destroy()`, so it drops into the existing Electron renderer regardless of whether the surrounding shell is vanilla JS, React, or Vue.
- Include a standalone `index.html` demo so the effect can be previewed in isolation before integration.

# Scope lock
- Only create new files for this component (e.g. `/renderer/components/face-scan-hologram/`). Do not modify any existing Electron main process, preload script, or other UI files.
- No authentication, telemetry, settings persistence, or any feature beyond this visual.
- Ask before installing any dependency beyond `three` and its optional postprocessing addons.

# Plan first
Before writing code, output a short implementation plan (mesh-source decision, file structure, state-machine outline) as a task list for my review. Wait for my go-ahead before executing. As you execute, post a short ✅ update after each completed step.

# Verification
After building, load the standalone demo in the browser preview and verify: idle rotation is smooth, the scan sweep animates correctly end-to-end, frame rate holds near 60fps, and there are no console errors. Check layout at both 1280×800 and 1920×1080.

# Stop conditions
Stop and ask before: deleting or overwriting any existing project file, adding any dependency not listed above, or running any destructive terminal command.

002. Can we add a visual audio visualizer or wave animation to the JARVIS UI when it is listening or speaking?

003. Add support for  as a third fallback option in the routing logic.

004. Integrate a compass and altitude telemetry readout next to the GPS coordinates in the proximity scan screen.