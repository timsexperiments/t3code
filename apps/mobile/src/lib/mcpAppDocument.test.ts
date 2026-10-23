// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import { mcpAppOuterDocument } from "./mcpAppDocument";

function load(html: string, messages: string[]) {
  document.documentElement.innerHTML = html;
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: { postMessage: (message: string) => messages.push(message) },
  });
  const script = document.querySelector("script");
  if (!script) throw new Error("Missing host script");
  window.eval(script.textContent ?? "");
  const frame = document.querySelector("iframe");
  if (!frame) throw new Error("Missing app frame");
  return frame;
}

describe("MCP app document", () => {
  it("embeds the fetched document without executing it in the host frame", () => {
    const html = "<!doctype html><script>window.attacker=true;</script><p>Local app</p>";
    const frame = load(mcpAppOuterDocument(html, "", "host-secret"), []);
    expect(frame.srcdoc).toBe(html);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(window).not.toHaveProperty("attacker");
  });

  it("relays only app-frame messages and stops after navigation", () => {
    const messages: string[] = [];
    const frame = load(mcpAppOuterDocument("<p>App</p>", "", "host-secret"), messages);
    const send = (source: Window | null) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          data: { method: "ui/initialize" },
        }),
      );
    send(null);
    expect(messages).toEqual([]);
    send(frame.contentWindow);
    expect(JSON.parse(messages[0]!)).toEqual({
      secret: "host-secret",
      message: { method: "ui/initialize" },
    });
    frame.dispatchEvent(new Event("load"));
    frame.dispatchEvent(new Event("load"));
    expect(JSON.parse(messages[1]!)).toEqual({
      secret: "host-secret",
      message: { t3: "navigated" },
    });
    send(frame.contentWindow);
    expect(messages).toHaveLength(2);
  });
});
