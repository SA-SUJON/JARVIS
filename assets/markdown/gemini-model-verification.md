# Gemini model verification

Google’s official Gemini API documentation identifies `gemini-3.6-flash` as the stable public model ID for Gemini 3.6 Flash. The official latest-model guide currently lists `gemini-3.7-flash` as a newer GA Flash model, but this project intentionally pins the Gemini default to the user-requested `gemini-3.6-flash`.

Gemini 3.6 Flash’s official model page lists a 1,048,576-token input limit, 65,536-token output limit, text and multimodal inputs, function calling, structured outputs, search grounding, and thinking support. The latest-model guidance also says Gemini 3.x no longer supports the older `temperature`, `top_p`, and `top_k` sampling parameters, so the JARVIS Gemini request path must omit them.

References:

1. [Gemini 3.6 Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
2. [Gemini latest model guide](https://ai.google.dev/gemini-api/docs/latest-model)
3. [Gemini API release notes](https://ai.google.dev/gemini-api/docs/changelog)
