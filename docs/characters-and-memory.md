# Characters, avatars and memory

[← Documentation](README.md) · [Project home](../README.md)

The Overview’s **Your story so far** card shows conversations, messages and shared images from the saved active character’s entire local archive, including Desktop and Telegram. Both user and assistant messages count, image totals count attachments rather than unique files, and empty sessions do not count as conversations. Statistics update with app state without provider calls; deleting history reduces the totals.

**Character cards** supports multiple names, taglines, personalities, system prompts, and VRM references. Choose a card and save to activate it. Conversations and facts are scoped to the active character. Custom avatars are copied into app storage, so moving the original file will not break them.

**Avatar studio** controls position, zoom, rotation, key light color/intensity, blinking, always-on-top, and all nine supplied animations. Manually selected animations loop. With expressive behavior enabled, the companion blends subtle happy/sad/relaxed expressions and short greeting/peace-sign gestures into idle animation on replies, returning to idle when interrupted. VRM 0.x and 1.x are loaded with `@pixiv/three-vrm`, and VRMA clips are retargeted to the loaded humanoid. Lip movement is audio amplitude based, not phoneme-level visemes.

**Memory → Conversation history** is a read-only archive browser, separate from **Saved facts** and its constellation. It includes all saved sessions for the active character, not only the last 200 messages in the companion window. Browse dated session previews, search message text or attachment names, and filter Desktop/Telegram messages (legacy messages count as Desktop). Search initially shows matching messages; **Read full conversation** reveals the surrounding context without losing the search. Sessions and messages load 20 at a time, and attached images load only when opened. Browsing never resumes or switches a chat. **New conversation** preserves history and facts; **Export archive** backs them up, and deleting history still requires the native confirmation dialog. No provider calls, migrations, or automatic deletion are involved.

**Memory** has three layers:

- A persistent current conversation, with a configurable recent-message window and a 24,000-character recent-context budget.
- Editable long-term facts, ranked by keyword relevance or semantic similarity.
- Persistent older user messages, recalled across sessions using the same retrieval mode. Recent conversation context is included regardless of retrieval mode.

The **Memory** tab includes an interactive constellation of up to 36 recently updated facts. Select a star to preview its memory; lilac marks manual facts and mint marks facts from conversations. This is a local artistic illustration, **not an embedding projection or a claim about similarity**: positions and connections are decorative, no extra API requests are made, and past chat messages are not plotted. An empty collection starts without sample facts. The searchable collection supports source filters, recently updated ordering, incremental display, editing, and confirmed deletion. Fact changes save immediately; recall preferences still use **Save changes**. The layout adapts to narrower windows and respects reduced-motion preferences.

For **semantic memory**, configure and enable the **Remember · Embeddings** provider. It has its own URL, model and API key (even if you use OpenRouter for both chat and embeddings). Then enable **Semantic memory** in Memory, save, and open **Fine-tune recall → Build / update semantic index**. OpenRouter's initial embedding model is `openai/text-embedding-3-small`; compatible local embedding servers also work.

Embeddings are cached locally in `memory-vectors.json`, keyed by provider URL/model and memory content. Retrieval uses cosine similarity with a configurable minimum score and remains character-scoped. Editing/deleting facts, deleting history, or changing the embedding model invalidates affected vectors. Imports bring in source memories, not vectors: rebuild after a large import. Each turn incrementally indexes at most 32 missing documents and embeds its query; an explicit rebuild processes the whole active character archive in batches of 32. Old user messages are embedded up to their first 4,000 characters. This sends those memories and queries to your configured embedding service and may incur charges. If the service fails, the reply uses lexical recall and displays a notice.

Automatic remembering is off by default. Enabling it adds one LLM call after a completed turn to extract up to three explicitly stated user facts. These appear in Memory, where they can be corrected or deleted. A new conversation preserves facts and old messages. Deleting history removes that character's chat history after confirmation, while preserving facts.

Exports contain the saved active character's facts and all conversation sessions, without provider settings or API keys. Imports validate the archive and merge into the current character; exact duplicate facts and messages are skipped. Imported conversations are recalled as past sessions. Import/export uses native file dialogs.

See [bundled model attribution and replacement behavior](assets.md).
