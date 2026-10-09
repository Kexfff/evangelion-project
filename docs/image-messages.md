# Image messages

[← Documentation](README.md) · [Project home](../README.md)

Click the paperclip or paste an image; preview/remove it before sending. A caption is optional. Desktop PNG/JPEG/WebP/GIF input accepts up to 20 MB each, four per message. Large images become a static JPEG with a maximum 1600 px side and white background, potentially losing animation/transparency/detail. Small originals remain unchanged. Outgoing images must fit 2 MB each. Choose a vision-capable LLM; model discovery does not filter vision support and provider limits may differ.

Images use text-first `content` arrays with `image_url` data URLs through chat-completions, following the [OpenRouter image-input format](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding). Selecting/pasting is local; sending uploads to your LLM provider. The four newest images are preferred in recent context. Hybrid memory may retrieve one relevant older image across sessions when that budget has room, based on filename/caption/adjacent response—not pixel embeddings.

Attachments live in content-addressed files under `attachments/`, referenced by the source JSON. Legacy inline images still load. Portable exports embed image bytes; encrypted/compressed export is optional. Small preserved originals may retain metadata. Working files are plaintext. Explicit history deletion also removes unreferenced files and refreshes the backup; external copies remain. The old 50 MB archive limit is replaced by bounded larger archives. Text embeddings never contain image bytes; image-only turns can now be indexed by filename and adjacent assistant description. [Full storage, privacy and visual-recall limitations](memory-presentation.md).
