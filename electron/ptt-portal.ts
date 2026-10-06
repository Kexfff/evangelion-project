import dbus from "dbus-next";
import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { pttPortalTrigger } from "../src/shared/ptt";
import type { BindShortcut } from "./ptt-service";

const destination = "org.freedesktop.portal.Desktop";
const path = "/org/freedesktop/portal/desktop";
const iface = "org.freedesktop.portal.GlobalShortcuts";
const token = () => `eva_${randomUUID().replaceAll("-", "")}`;
type Values = Record<string, dbus.Variant>;

/** Session-scoped portal, not a system-wide keyboard hook. Only our shortcut's signals. */
export const bindPortalShortcut: BindShortcut = async (
  config,
  edge,
  changed,
  signal,
) => {
  if (process.platform !== "linux")
    throw new Error(
      "Global hold/release is currently supported through the Linux shortcut portal. Choose app-focused mode on this platform.",
    );
  signal.throwIfAborted();
  const bus = dbus.sessionBus();
  let closed = false;
  let session = "";
  let owner = "";
  let requestPath = "";
  let pending: ((error: Error) => void) | undefined;
  const call = (
    member: string,
    signature = "",
    body: unknown[] = [],
    target = path,
    inter = iface,
    dest = destination,
  ) =>
    bus.call(
      new dbus.Message({
        destination: dest,
        path: target,
        interface: inter,
        member,
        signature,
        body,
      }),
    );
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    pending?.(new Error("Shortcut registration cancelled."));
    // Disconnecting closes all sessions/requests belonging to this connection,
    // including ones whose reply raced cancellation.
    if (session)
      bus.send(
        new dbus.Message({
          destination,
          path: session,
          interface: "org.freedesktop.portal.Session",
          member: "Close",
          flags: 1,
        }),
      );
    if (requestPath)
      bus.send(
        new dbus.Message({
          destination,
          path: requestPath,
          interface: "org.freedesktop.portal.Request",
          member: "Close",
          flags: 1,
        }),
      );
    bus.disconnect();
  };
  signal.addEventListener("abort", close, { once: true });
  bus.on("error", () => {
    if (!closed) {
      changed(null);
      close();
    }
  });
  // Bound all D-Bus waits, including an unavailable session bus/backend.
  const bounded = async <T>(work: Promise<T>, ms = 10000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          pending = reject;
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Desktop shortcut request timed out. Retry or choose app-focused mode.",
                ),
              ),
            ms,
          );
          if (closed) reject(new Error("Shortcut registration cancelled."));
        }),
      ]);
    } finally {
      clearTimeout(timer);
      pending = undefined;
    }
  };
  const shortcutInfo = (values: Values) => {
    const entry = (
      values.shortcuts?.value as [string, Values][] | undefined
    )?.find(([id]) => id === "press_to_talk");
    const label = entry?.[1].trigger_description?.value;
    return typeof label === "string" && label ? label.slice(0, 180) : null;
  };
  const request = async (
    method: string,
    leading: unknown[],
    signature: string,
    options: Values = {},
  ) => {
    const requestToken = token();
    const busName = (bus as dbus.MessageBus & { name: string }).name;
    requestPath = `${path}/request/${busName.slice(1).replaceAll(".", "_")}/${requestToken}`;
    const expected = requestPath;
    let onMessage: (m: dbus.Message) => void = () => {};
    const response = new Promise<Values>((resolve, reject) => {
      onMessage = (m) => {
        if (
          m.type !== dbus.MessageType.SIGNAL ||
          m.sender !== owner ||
          m.path !== expected ||
          m.interface !== "org.freedesktop.portal.Request" ||
          m.member !== "Response"
        )
          return;
        if (m.body[0] === 0) resolve(m.body[1]);
        else
          reject(
            new Error(
              m.body[0] === 1
                ? "Shortcut permission cancelled. Retry or choose app-focused mode."
                : method === "CreateSession"
                  ? "Desktop cannot create a global shortcut session. On Niri, the GNOME portal may advertise shortcuts without a working backend. Choose app-focused mode."
                  : "Desktop could not bind this shortcut. Choose another key or app-focused mode.",
            ),
          );
      };
      bus.on("message", onMessage);
    });
    // Attach rejection handling before sending; a Response can precede the method reply.
    try {
      const result = call(method, signature, [
        ...leading,
        { ...options, handle_token: new dbus.Variant("s", requestToken) },
      ]);
      const [reply, values] = await bounded(
        Promise.all([result, response]),
        60000,
      );
      if (reply?.body[0] !== expected)
        throw new Error("Unsupported desktop portal request handle.");
      requestPath = "";
      return values;
    } finally {
      (bus as unknown as EventEmitter).removeListener("message", onMessage);
    }
  };
  try {
    // A round trip waits for Hello and provides the trusted signal sender.
    const reply = await bounded(
      call(
        "GetNameOwner",
        "s",
        [destination],
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "org.freedesktop.DBus",
      ).catch(async () => {
        await call(
          "StartServiceByName",
          "su",
          [destination, 0],
          "/org/freedesktop/DBus",
          "org.freedesktop.DBus",
          "org.freedesktop.DBus",
        );
        return call(
          "GetNameOwner",
          "s",
          [destination],
          "/org/freedesktop/DBus",
          "org.freedesktop.DBus",
          "org.freedesktop.DBus",
        );
      }),
    );
    owner = reply!.body[0];
    await bounded(
      call(
        "AddMatch",
        "s",
        [`type='signal',sender='${owner}',path_namespace='${path}'`],
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "org.freedesktop.DBus",
      ),
    );
    await bounded(
      call(
        "AddMatch",
        "s",
        [
          `type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='${destination}'`,
        ],
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "org.freedesktop.DBus",
      ),
    );
    bus.on("message", (m) => {
      if (
        !closed &&
        m.type === dbus.MessageType.SIGNAL &&
        m.sender === "org.freedesktop.DBus" &&
        m.interface === "org.freedesktop.DBus" &&
        m.member === "NameOwnerChanged" &&
        m.body[0] === destination &&
        m.body[2] !== owner
      ) {
        changed(null);
        close();
      }
    });
    // Stable identity across source/packaged launches; do not impersonate another app.
    await bounded(
      call(
        "Register",
        "sa{sv}",
        ["dev.evangelion.companion", {}],
        path,
        "org.freedesktop.host.portal.Registry",
      ).catch(() => null),
    );
    const values = await request("CreateSession", [], "a{sv}", {
      session_handle_token: new dbus.Variant("s", token()),
    });
    session = values.session_handle?.value;
    if (typeof session !== "string" || !session.startsWith(`${path}/session/`))
      throw new Error("Desktop did not create a shortcut session.");
    bus.on("message", (m) => {
      if (closed || m.type !== dbus.MessageType.SIGNAL || m.sender !== owner)
        return;
      if (
        m.path === session &&
        m.interface === "org.freedesktop.portal.Session" &&
        m.member === "Closed"
      ) {
        changed(null);
        close();
        return;
      }
      if (m.path !== path || m.interface !== iface || m.body[0] !== session)
        return;
      if (m.member === "ShortcutsChanged")
        changed(
          shortcutInfo({ shortcuts: new dbus.Variant("a(sa{sv})", m.body[1]) }),
        );
      if (m.body[1] === "press_to_talk") {
        if (m.member === "Activated") edge(true);
        if (m.member === "Deactivated") edge(false);
      }
    });
    const bound = await request(
      "BindShortcuts",
      [
        session,
        [
          [
            "press_to_talk",
            {
              description: new dbus.Variant("s", "Eva · Press to talk"),
              preferred_trigger: new dbus.Variant(
                "s",
                pttPortalTrigger(config),
              ),
            },
          ],
        ],
        "",
      ],
      "oa(sa{sv})sa{sv}",
    );
    const label = shortcutInfo(bound);
    if (!label)
      throw new Error(
        "No shortcut was assigned by the desktop. Retry and choose a key, or use app-focused mode.",
      );
    changed(label);
    return { close };
  } catch (error) {
    close();
    if (
      error instanceof Error &&
      /shortcut|desktop|permission/i.test(error.message)
    )
      throw error;
    throw new Error(
      "Global shortcut portal unavailable. Choose app-focused mode, or configure your desktop’s shortcut portal and retry.",
    );
  }
};
