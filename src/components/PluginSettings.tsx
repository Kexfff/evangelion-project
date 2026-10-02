import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import {
  capabilities,
  defaultTelegramSettings,
  type PluginAction,
  type PluginSnapshot,
} from "../shared/plugins";

const labels = {
  "channel:chat": "Chat — shared character history and memory (required)",
  "channel:images": "Images — download and send attached images to your LLM",
  "channel:voice": "Voice — send voice notes to ASR and generate TTS replies",
  "channel:notify": "Notifications — deliver reminders and proactive messages",
};
export function PluginSettings({ data }: { data?: PluginSnapshot }) {
  const [config, setConfig] = useState(data?.config ?? defaultTelegramSettings);
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const saved = JSON.stringify(data?.config);
  useEffect(() => {
    setConfig(data?.config ?? defaultTelegramSettings);
  }, [saved]);
  useEffect(() => {
    if (data?.paired || !data?.config.enabled) setCode("");
  }, [data?.paired, data?.config.enabled]);
  async function run(
    work: () => Promise<unknown>,
    message = "Plugin updated.",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Plugin operation failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  function action(value: PluginAction) {
    if (
      (value === "remove" || value === "unpair") &&
      !window.confirm(
        value === "remove"
          ? "Remove Telegram configuration, pairing, diagnostics and token? Shared chat history and memory will remain."
          : "Revoke the paired account and disable Telegram?",
      )
    )
      return;
    void run(async () => {
      const result = await bridge.pluginAction(value);
      if (value === "pair" && result) setCode(result);
    });
  }
  return (
    <section className="card plugin-settings">
      <div className="section-heading">
        <h2>Telegram plugin</h2>
        <p>
          One companion, shared conversation and memory. Plugin changes apply
          immediately and do not use Save changes.
        </p>
      </div>
      <p>
        Bundled version {data?.availableVersion ?? "1.0.0"} · API 1 ·{" "}
        {data?.status ?? "Desktop required"}
      </p>
      <p>
        Trusted built-in adapters only. The network worker has bounded requests
        and a heap limit; it is not a sandbox for third-party code. External MCP
        tools have their own connections and permissions above.
      </p>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      {!data?.installedVersion ? (
        <button
          className="button primary"
          disabled={busy}
          onClick={() => action("install")}
        >
          Install bundled Telegram
        </button>
      ) : (
        <>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action("disable")}
            >
              Disable immediately
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action("restart")}
            >
              Restart connection
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action("update")}
            >
              Update from bundled catalog
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action("remove")}
            >
              Remove Telegram
            </button>
          </div>
          <fieldset disabled={busy}>
            <legend>Connection and explicit permissions</legend>
            <label className="field">
              <span>Bot token</span>
              <input
                aria-label="Bot token"
                type="password"
                autoComplete="new-password"
                value={token}
                placeholder={
                  data.hasToken
                    ? "Saved — leave blank to keep"
                    : "Token from @BotFather"
                }
                onChange={(e) => setToken(e.target.value)}
              />
              <small>
                Stored in the credential vault, never returned to the UI. Saving
                a replacement token revokes pairing.
              </small>
            </label>
            {capabilities.map((capability) => (
              <label className="toggle-row" key={capability}>
                <span>{labels[capability]}</span>
                <input
                  type="checkbox"
                  checked={config.grants.includes(capability)}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      grants: e.target.checked
                        ? [...c.grants, capability]
                        : c.grants.filter((g) => g !== capability),
                      ...(e.target.checked
                        ? {}
                        : capability === "channel:voice"
                          ? { voiceReplies: false }
                          : capability === "channel:notify"
                            ? { notifications: false }
                            : {}),
                    }))
                  }
                />
              </label>
            ))}
            <label className="toggle-row">
              <span>Enable Telegram</span>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) =>
                  setConfig({ ...config, enabled: e.target.checked })
                }
              />
            </label>
            <label className="toggle-row">
              <span>Send voice replies in addition to text</span>
              <input
                type="checkbox"
                disabled={!config.grants.includes("channel:voice")}
                checked={config.voiceReplies}
                onChange={(e) =>
                  setConfig({ ...config, voiceReplies: e.target.checked })
                }
              />
            </label>
            <label className="toggle-row">
              <span>Deliver autonomous messages to Telegram</span>
              <input
                type="checkbox"
                disabled={!config.grants.includes("channel:notify")}
                checked={config.notifications}
                onChange={(e) =>
                  setConfig({ ...config, notifications: e.target.checked })
                }
              />
            </label>
            <p>
              When connected, notifications go to Telegram instead of desktop
              speech. Consciousness opt-ins, approvals, quiet hours, budgets and
              pause still apply. The app must be running; minimizing the avatar
              is fine. System suspend/lock still pauses autonomy.
            </p>
            <button
              className="button primary"
              onClick={() =>
                void run(async () => {
                  await bridge.configureTelegram(config, token || undefined);
                  setToken("");
                  setCode("");
                }, "Telegram configuration saved.")
              }
            >
              Save Telegram configuration
            </button>
          </fieldset>
          <h3>Private account pairing</h3>
          {data.paired ? (
            <>
              <p>
                Allowed user {data.paired.userId} · chat {data.paired.chatId} ·
                character {data.paired.characterId}
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => action("unpair")}
              >
                Unpair account
              </button>
            </>
          ) : (
            <>
              <p>
                Enable the plugin, generate a one-time command, then send it
                privately to your bot within five minutes. Keep this command
                secret. Only one private account is allowed; groups and unpaired
                senders are ignored.
              </p>
              <button
                className="button secondary"
                disabled={busy || !data.config.enabled}
                onClick={() => action("pair")}
              >
                Generate pairing command
              </button>
              {code && (
                <label className="field">
                  <span>One-time pairing command (expires in 5 minutes)</span>
                  <input
                    readOnly
                    value={code}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
            </>
          )}
          <p>
            Pairing is bound to the character selected when the command is
            generated. Switch back to that character to chat. New desktop
            conversations also become Telegram’s current conversation; older
            memories remain shared.
          </p>
          <h3>Diagnostics</h3>
          <p>
            Inbound messages: 12/minute. Images: 2 MB each. Voice: 60 seconds/10
            MB. Albums are processed as separate image messages. Failed or
            interrupted updates are not automatically replayed.
          </p>
          {data.diagnostics.length ? (
            <ul>
              {[...data.diagnostics].reverse().map((entry, i) => (
                <li key={`${entry.at}-${i}`}>
                  <time>{entry.at}</time> — {entry.message}
                </li>
              ))}
            </ul>
          ) : (
            <p>No plugin activity yet.</p>
          )}
        </>
      )}
    </section>
  );
}
