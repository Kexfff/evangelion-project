<div align="center">

<img src="public/favicon.svg" width="56" height="56" alt="Evangelion Project" />

# evangelion_project

**A voice. A memory. A little presence on your desktop.**

An animated AI companion with natural conversation, persistent memory, and a world of her own.

[Get started](docs/getting-started.md) · [Documentation](docs/README.md) · [Roadmap](PLAN.MD)

</div>

## Make yourself at home

- **Talk naturally.** Text, images, and voice—with streaming speech and interruption.
- **Be remembered.** Editable facts, conversation summaries, hybrid recall, and encrypted memory exports.
- **Bring her to life.** An animated VRM avatar in a transparent desktop window, with settings in their own workspace.
- **Stay connected.** Private Telegram chat shares the same character and memories.
- **Set her rhythm.** Opt-in conversation openers, mood simulation, and approved reminders.
- **Extend her abilities.** Trusted MCP connections with per-tool permissions and approvals.
- **Share your world.** An app-managed Minecraft Java companion with following, verified goals, and independent gameplay.

Use your own OpenAI-compatible LLM, ASR, and TTS services. OpenRouter is the initial LLM provider; audio services are configured separately.

## Quick start

Requires **Node.js 22.13+**, npm, and a desktop session with WebGL.

```sh
npm install
npm run dev
```

Open **Settings → Providers**, configure your services, and save. No LLM or audio inference server is bundled. [Full setup guide →](docs/getting-started.md)

## Explore

| Guide                                                | What you’ll find                                        |
| ---------------------------------------------------- | ------------------------------------------------------- |
| [Voice & providers](docs/providers-and-voice.md)     | Connect services and find your conversation rhythm.     |
| [Characters & memory](docs/characters-and-memory.md) | Shape her personality and explore what she remembers.   |
| [Consciousness](docs/consciousness.md)               | Configure initiative, behavior, and reminders.          |
| [Telegram](docs/telegram.md)                         | Take the conversation with you.                         |
| [MCP tools](docs/mcp.md)                             | Connect trusted tools with explicit permissions.        |
| [Minecraft](docs/minecraft.md)                       | Join a Java LAN world and control game permissions.     |
| [Privacy & storage](docs/storage-and-privacy.md)     | Understand what stays local and what reaches providers. |
| [Development](docs/development.md)                   | Build, test, and extend the application.                |

Consciousness is a configurable behavior simulation, not actual sentience. Independent Minecraft gameplay is opt-in. App-focused press-to-talk is available; global keyboard control and general desktop control remain on the [roadmap](PLAN.MD).

---

Inspired by [AIRI](https://github.com/moeru-ai/airi). Built with Electron, React, TypeScript, and Three.js. The bundled **AvatarSample_B** model credits **VRoid**; see [asset attribution and metadata](docs/assets.md).
