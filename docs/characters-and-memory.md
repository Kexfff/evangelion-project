# Characters, avatars and memory

[← Documentation](README.md) · [Project home](../README.md)

The Overview’s **Your story so far** card shows conversations, messages and shared images from the saved active character’s entire local archive, including Desktop and Telegram. Both user and assistant messages count, image totals count attachments rather than unique files, and empty sessions do not count as conversations. Statistics update with app state without provider calls; deleting history reduces the totals.

**Character cards** supports multiple names, taglines, personalities, system prompts, and VRM references. Choose a card and save to activate it. Conversations and facts are scoped to the active character. Custom avatars are copied into app storage, so moving the original file will not break them.

**Avatar studio** controls position, zoom, rotation, key light color/intensity, blinking, gaze, expression strength, mouth mode, always-on-top and all nine animations. Manually selected animations loop. Expressive behavior blends happy/sad/relaxed expressions and context-selected one-shot gestures into idle. Mouth shapes can use text-guided vowel estimates gated by audio amplitude; this is not true phoneme alignment. VRM 0.x/1.x and retargeted VRMA are supported. Portable character-card import/export and avatar metadata are described in the [v0.4.18 guide](memory-presentation.md).

**Memory → Conversation history** is a read-only archive browser, separate from **Saved facts** and its constellation. It includes all saved sessions for the active character, not only the last 200 messages in the companion window. Browse dated session previews, search message text or attachment names, and filter Desktop/Telegram messages (legacy messages count as Desktop). Search initially shows matching messages; **Read full conversation** reveals the surrounding context without losing the search. Sessions and messages load 20 at a time, and attached images load only when opened. Browsing never resumes or switches a chat. **New conversation** preserves history and facts; **Export archive** backs them up, and deleting history still requires the native confirmation dialog. No provider calls, migrations, or automatic deletion are involved.

**Memory** has three layers:

- A persistent current conversation, with a configurable recent-message window and a 24,000-character recent-context budget.
- Editable long-term facts, ranked by hybrid keyword/semantic relevance.
- Older attributed exchanges and conversation digests, including explicit optional LLM consolidation. Recent context is included regardless of retrieval mode.

The **Memory** tab includes an interactive constellation of up to 36 recently updated facts. Select a star to preview its memory; lilac marks manual facts and mint marks facts from conversations. This is a local artistic illustration, **not an embedding projection or a claim about similarity**: positions and connections are decorative, no extra API requests are made, and past chat messages are not plotted. An empty collection starts without sample facts. The searchable collection supports source filters, recently updated ordering, incremental display, editing, and confirmed deletion. Fact changes save immediately; recall preferences still use **Save changes**. The layout adapts to narrower windows and respects reduced-motion preferences.

For **semantic memory**, configure and enable the **Remember · Embeddings** provider. It has its own URL, model and API key (even if you use OpenRouter for both chat and embeddings). Then enable **Semantic memory** in Memory, save, and open **Fine-tune recall → Build / update semantic index**. OpenRouter's initial embedding model is `openai/text-embedding-3-small`; compatible local embedding servers also work.

Embeddings are cached in `memory.sqlite`, keyed by provider URL/model and memory content (the old vector JSON migrates). Retrieval blends keywords with cosine similarity and remains character-scoped. Editing/deleting source data or changing models invalidates vectors. Imports bring source memories, not indexes; rebuild after a large import. Each turn indexes at most 32 missing documents plus its query; explicit rebuild processes all active-character documents in batches of 32. Documents now include attributed exchanges and summaries, including assistant text marked unverified. This sends memory text to your embedding provider and may incur charges. Failed embedding requests fall back to keyword recall with a notice. The optional semantic map uses cached fact vectors only; the decorative constellation remains default.

Automatic remembering is off by default. Enabling it adds one LLM call after a completed turn to extract up to three explicitly stated user facts. These appear in Memory, where they can be corrected or deleted. A new conversation preserves facts and old messages. Deleting history removes that character's chat history after confirmation, while preserving facts.

Exports contain the saved active character's facts and conversation sessions/images, without provider settings or API keys. Passphrase encryption is available in Saved facts; the history shortcut is plaintext. Imports validate and merge, skipping exact duplicate facts/messages. Imported conversations are past sessions; derived summaries/indexes can be regenerated. [Archive limits, deletion guarantees and remaining memory work](memory-presentation.md).

See [bundled model attribution and replacement behavior](assets.md).
