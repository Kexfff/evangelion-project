# Memory, voice and presentation — v0.4.18

[Documentation](README.md) · [Active plan](../PLAN.MD)

## Remembering a conversation

Eva now recalls attributed user/assistant exchanges, rather than only isolated old user messages. Hybrid ranking retains useful keyword matches even when a document has no embedding. Irrelevant zero-score facts are excluded, duplicate recall text is suppressed and context remains bounded. Local 12-message extractive digests keep attribution and dates. Assistant statements and generated summaries are explicitly unverified reference data, never instructions or durable user facts.

**Memory → Inside her memory** offers a recall playground. Keyword-only testing is local; semantic testing makes embedding requests. It excludes the active short-term context, showing what would be recalled from longer-term memory, with source type and match reason. This is a diagnostic, not a guarantee that the LLM will use each result correctly.

**Consolidate next conversation** processes up to 40 older messages using one request to the configured LLM. It summarizes decisions, corrections and open plans in the conversation’s language. Provider charges apply; nothing runs automatically. Original messages stay intact. Source hashes prevent saving a stale summary after edits/deletion, and deleting source history invalidates its generated summaries. The next click processes another uncovered group. Portable memory archives contain original messages/facts; derived summaries and indexes can be rebuilt after import.

## Storage, export and forgetting

`companion.json` remains the validated source for settings, textual memories and summaries. New writes replace inline image bytes with content-hash references into `attachments/`. Identical images share one file. Legacy inline images still load and are externalized on the next write. Close the app and copy the **whole profile**, not just the JSON, for a filesystem backup. Keep the attachments directory when restoring `companion.json.bak`.

`memory.sqlite` holds a rebuildable FTS5 document index and embeddings. The former vector JSON cache migrates to it. Search is character-scoped; vectors are namespaced by endpoint/model and content hash. This improves disk organization/search but is **not** a complete scalable-store migration: source histories and vectors still materialize in memory, exact vector scoring is linear, and updates still validate the whole source store.

The Saved facts archive controls default to encryption. A passphrase of at least 10 characters derives an AES-256-GCM key through scrypt; compressed content and format are authenticated. Passphrases are not persisted and cannot be recovered. Plain JSON remains available, and the history-tab export shortcut is explicitly plaintext. Expanded exports are bounded to 192 MB and archive files to 256 MB; encrypted decompression is bounded. Old plaintext archives still import. No API keys/settings/plugin grants are exported.

**Privacy & housekeeping** is explicit, not a scheduled expiration policy: zero days means keep all. Native confirmation precedes removing old conversations or finished reminders. Saved facts, the current conversation and pending/running reminders are kept. Cleanup replaces the rolling backup, removes unreferenced attachment files across the profile and compacts the derived index. Fact deletion and history clearing also scrub those app-managed recoverable copies. The working database is not encrypted. Filesystem snapshots, external exports, provider copies and forensic recovery are outside this guarantee. Deleting a fact does not delete the source conversation; related information can still be recalled from it.

## Images and maps

Desktop images accept up to 20 MB input. Large images are reduced to a maximum 1600 px side and encoded as a static JPEG (white background); this can discard animation/transparency and fine detail. Small originals are preserved, including metadata. The outgoing 2 MB/image and four-image limits remain. Telegram’s existing media limits are unchanged.

Long-term visual recall searches filenames, user captions and adjacent assistant descriptions; it can attach one relevant historic image when the newest images leave room. Image bytes are not sent to text embeddings. There is no pixel-based image embedding model, OCR or silent extra captioning request.

**Show semantic map** uses already-indexed facts: centered PCA and original-vector cosine links (threshold 0.60). It does not make provider requests. Up to 80 indexed facts are shown; sparse, identical or low-rank vectors can overlap. Two-dimensional proximity is only an approximation. The artistic constellation remains the default.

## Voice and avatar

**Voice → Speech detector** adds bundled offline Silero V5 neural VAD through [vad-web](https://github.com/ricky0123/vad) and ONNX Runtime. It uses the existing microphone lease, gain, device and timing controls, with no CDN fetches. Neural inference cannot identify the user or separate speakers. Slow/failing inference stops capture with an error instead of silently changing detectors. The lightweight energy detector remains the default; keyboard PTT uses its existing accidental-tap energy check.

**Stream recognition text** requests `stream=true` from `/audio/transcriptions`, handling `transcript.text.delta` and `transcript.text.done` SSE events, plus cumulative `transcription.partial` / `transcription.done` events used by [this Qwen-compatible server](https://github.com/uaysk/qwen3-asr-openai). It displays provisional text but submits only a complete transcript. JSON responses still work; unsupported providers may reject streaming. No automatic retry re-uploads audio. This is response streaming after utterance upload, not continuous realtime microphone transport. Telegram keeps its existing buffered recognition path.

The user's setup is **Qwen3-ASR-0.6B through OpenRouter** and **OmniVoice through local VoiceStudio**. [OpenRouter documents completed-file transcription](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/), including compatible multipart uploads. Its ASR model picker now requests the transcription-specific catalog. Leave recognition streaming off for this setup unless OpenRouter explicitly adds that capability; upstream Qwen streaming does not establish gateway realtime support. [VoiceStudio's speech API](https://voicestudio.sh/docs/api-reference/audio) uses the compatible `/v1/audio/speech` route, so the TTS base URL is `http://127.0.0.1:3900/v1`, not the web UI root. Use the existing line or full-response mode for longer local synthesis chunks. The published speech contract does not expose phoneme timing; it is not evidence of native low-latency streaming. The local `/openapi.json` probe returned HTTP 401 on 2026-10-09, so the installed version's exact capabilities remain unverified. No service settings, credentials or models were changed; no audio generation or paid transcription was requested.

Avatar studio adds natural/pointer/forward gaze, expression strength and text-guided vowel mouth shapes. Shapes are estimated from spoken text and audio playhead, gated by actual audio energy and smoothly mixed. They are **not** a phonemizer or provider-timestamped alignment; unsupported scripts/stream duration estimates can look inaccurate. Simple amplitude mouth animation remains selectable. Question/excited reply cues choose among the supplied one-shot gestures without overriding manually chosen animations.

Character cards export saved identity/prompts plus an embedded custom VRM and optional author/source/license/notes metadata. Imports create an inactive character after confirmation, with no providers, credentials, memories or permissions. Review prompts before activation. This is Evangelion’s versioned JSON format, not PNG/Tavern card compatibility, and metadata does not establish redistribution rights.

## Remaining depth

See §3.4 in PLAN.MD for paginated authoritative SQLite storage, larger multilingual retrieval benchmarks, true pixel retrieval, continuous ASR transport and provider-aligned phonemes. CPU/GPU profiling is deferred at the user’s request. New voice paths still need physical-microphone and real-provider quality acceptance; test fixtures are not evidence of acoustic quality.
