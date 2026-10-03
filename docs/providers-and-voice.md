# Providers and voice

[← Documentation](README.md) · [Project home](../README.md)

## First conversation

1. Open **Providers**. Enable the language model provider, enter your OpenRouter API key, and choose a model ID. The default API base is `https://openrouter.ai/api/v1`, with `openrouter/auto` as the initial routing model. Save, then use **Fetch models** and test the connection. Each service has its own model catalog; manual IDs remain available for servers without a compatible `/models` endpoint.
2. Configure ASR and TTS independently. Enter the base URL (including `/v1`, if required), model ID, optional API key, and TTS voice supported by your service. The initial localhost URLs are examples; no audio server is bundled or started. OpenRouter is the default for text generation, not an assumed audio backend.
3. Save settings and test each enabled service. Connection tests issue small real requests and may incur charges. Both voice chat and the ASR test send 16 kHz mono PCM WAV audio.
4. In **Voice & audio**, select microphone and speakers/headphones. **Refresh devices** requests permission to display device names; **Test microphone** shows a local-only level meter, and **Test output** plays a short quiet tone. Adjust microphone gain and the voice detection threshold for your setup.
5. Open the companion and type a message, or click the microphone to record and click again to send. With **Hands-free voice detection** enabled, clicking the microphone starts continuous local listening: speech is sent after the configured pause, and each utterance is capped at 60 seconds. Click the microphone again or press Stop to disable listening. Listening never starts automatically at launch.
6. With **Interrupt when I speak** enabled, detected speech cancels the current generation and queued audio before transcribing your new utterance. This operates while hands-free listening is enabled. Echo cancellation is on by default; headphones are recommended if speakers trigger unwanted interruptions.
7. **Speech delivery** offers **Sentence by sentence**, **Line by line**, and **Full response**. Sentence mode starts TTS at sentence boundaries. Line mode keeps short sentences together until an explicit newline (not visual wrapping), then synthesizes that line as one request; the unfinished last line is spoken when the reply ends. With no newlines, line mode waits for the full reply. This provides more context to local TTS models at the cost of some startup latency. Full response always waits for completion. Existing sentence/full-response settings are preserved. Exceptionally long lines split only at the speech API's 12,000-character limit.
8. **Stream speech audio** feeds incoming MP3 chunks to Media Source Extensions so playback can begin before the download finishes. The provider must actually stream its HTTP body for that latency benefit. Unsupported containers (such as WAV) use buffered playback. Audio streaming is independent of Speech delivery and works with all three modes. Manual **Read aloud** still synthesizes the whole saved reply.

Provider adapters and discovery use these OpenAI-compatible HTTP endpoints:

| Service         | Request                                                                           | Expected response                                                  |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| LLM             | `POST {base}/chat/completions`, JSON with model, messages, stream                 | SSE `choices[].delta.content`, or JSON `choices[].message.content` |
| ASR             | `POST {base}/audio/transcriptions`, multipart file/model/response_format/language | JSON `{ "text": "…" }`                                             |
| TTS             | `POST {base}/audio/speech`, JSON model/input/voice/speed/response_format          | MP3 audio bytes                                                    |
| Embeddings      | `POST {base}/embeddings`, JSON model/input/encoding_format                        | Float vectors in `data[].embedding`, ordered using `index`         |
| Model discovery | `GET {base}/models` (`/embeddings/models` for OpenRouter embeddings)              | `data[].id`                                                        |

Provider errors show an actionable status without reflecting potentially sensitive upstream response bodies. Requests time out after 90 seconds. Chat replies and transport/auth/quota failures are not automatically retried. Automatic fact extraction has the bounded format-recovery exception below.

### OpenRouter model providers

In **Providers → Language model**, use an OpenRouter base URL (`https://openrouter.ai/api/v1`), choose a model, then **Fetch providers**. The picker fetches the [public endpoint catalog for that model](https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model), showing provider names, routing IDs, advertised tool support and catalog input/output prices per million tokens. Discovery can use the unsaved model ID; it sends no API key or conversation content. Router aliases/presets may not have a usable endpoint list—choose a concrete model when needed.

Check the providers you want and click **Save changes**. Choices are retained separately for each model across restarts. **Automatic** leaves routing to OpenRouter; **Only selected providers** sends its [`provider.only` restriction](https://openrouter.ai/docs/guides/routing/provider-selection#allowing-only-specific-providers) on every LLM request: streaming/non-streaming chat, tool-call rounds, memory extraction, consciousness and Minecraft planning. Fallback can occur within the selected list, not outside it. Account-level restrictions still apply, so a restricted request may fail when no allowed endpoint can serve it. A base provider tag can match all its variants; a variant/region tag narrows the selection according to OpenRouter's routing rules.

An empty restricted list cannot be saved; switch explicitly to Automatic to remove the restriction. Refresh failures or disappearing providers never clear saved choices automatically. Choices do not affect other models, non-OpenRouter APIs, ASR/TTS or embedding requests. Catalog capability labels do not guarantee that a particular model/provider will produce correct tool calls; the DSML-text issue remains separate.

### Automatic memory extraction

When enabled in Memory, this is a separate background LLM request after the chat reply is saved. It uses temperature 0.1 and a 2,048-token output cap; OpenRouter requests also ask to disable optional reasoning through its [reasoning parameter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Ordinary chat settings are unchanged. Complete JSON arrays, `{"facts":[...]}` objects and a single JSON code block are accepted; facts remain validated, deduplicated and limited to three short strings. Partial JSON and reasoning text are never stored as facts.

Invalid, empty or token-truncated extraction output gets **one fresh attempt**, capped at 4,096 tokens. This can incur an additional LLM charge; both requests and reported usage appear in Consciousness activity. Unsupported JSON-mode/function-calling features are not required. HTTP failures are not retried. Cancellation and deleted source messages do not generate false extraction warnings or restore deleted facts. If extraction still fails, the warning and `memory-failed` activity entry identify the failure category without logging the model output, credentials or provider response body. Your chat reply and existing memories remain saved; add any missing fact manually. Failed past extractions are not replayed automatically.
