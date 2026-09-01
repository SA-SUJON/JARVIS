# Voice prosody findings

Edge TTS supports voice, rate, pitch, and volume controls. The project’s `node-edge-tts` package exposes the same controls as constructor options, with percentage strings accepted for rate and volume and frequency/percentage pitch values. Custom arbitrary SSML is not a reliable extension point for the Edge service, so JARVIS should use supported prosody options plus punctuation-aware text normalization.

Piper exposes `length_scale`, `noise_scale`, `noise_w`, and sentence silence controls through its synthesis API. The packaged Piper CLI can accept corresponding voice/config parameters depending on runtime version; the safest portable tuning is to adjust the model configuration or use wrapper-level sentence punctuation and silence while retaining the model’s phoneme settings. Piper is inherently less expressive than neural online voices, so Kokoro is the higher-naturalness offline option when its ONNX model and voices file are installed.

References:

1. [rany2/edge-tts README](https://github.com/rany2/edge-tts)
2. [rhasspy/piper voice synthesis implementation](https://github.com/rhasspy/piper/blob/master/src/python_run/piper/voice.py)
3. [Kokoro ONNX README](https://github.com/thewh1teagle/kokoro-onnx)
