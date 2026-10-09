// @effect-diagnostics nodeBuiltinImport:off - Test drives the existing browser pool outside Effect.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import {
  makeMcpAppHost,
  McpAppHostRefusal,
} from "../../../../packages/client-runtime/src/mcpApps/host.ts";
import { ServerBrowserContexts } from "./ServerBrowserContexts.ts";
import { captureViewport, click, editableAtPoint } from "./ServerBrowserPage.ts";
import { mountEmbeddedBrowserPage } from "./EmbeddedBrowserPage.ts";

const executable = process.env.T3_EMBEDDED_BROWSER_EXECUTABLE;

it.skipIf(!executable).each([true, false])(
  "renders an isolated MCP app and preserves host approval (%s)",
  async (approved) => {
    const root = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-embedded-embedded-test-"),
    );
    const contexts = new ServerBrowserContexts({
      profilesDir: root,
      executable: async () => {
        if (!executable) throw new Error("Set T3_EMBEDDED_BROWSER_EXECUTABLE.");
        return executable;
      },
    });
    try {
      const context = await contexts.contextFor("incognito", "embedded-test-viewer");
      const page = await context.newPage();
      await page.setViewportSize({ width: 390, height: 600 });
      const cdp = await context.newCDPSession(page);
      const ready = Promise.withResolvers<void>();
      const result = Promise.withResolvers<unknown>();
      const assets = Promise.withResolvers<unknown>();
      const requested: string[] = [];
      const calls: unknown[] = [];
      const host = makeMcpAppHost({
        app: {
          attachmentId: "embedded-test-app",
          server: "embedded-test",
          tool: "counter",
          resourceUri: "ui://embedded-test/counter",
        },
        hostVersion: "embedded-test",
        post: (message) => {
          void mounted.then((bridge) => bridge.send(message));
        },
        hostContext: () => ({
          theme: "light",
          styles: { variables: {} },
          displayMode: "inline",
          availableDisplayModes: ["inline", "fullscreen"],
          containerDimensions: { width: 390, height: 600 },
          platform: "mobile",
        }),
        callTool: async (input) => {
          if (!approved) throw new McpAppHostRefusal("Declined by the user.");
          calls.push(input);
          return { content: [{ type: "text", text: "counter=1" }] };
        },
        readResource: async () => ({ contents: [] }),
        openLink: async () => undefined,
        sendMessage: async () => undefined,
        updateModelContext: async () => undefined,
        requestDisplayMode: async (mode) => mode,
        downloadFile: async () => undefined,
        onRequestTeardown: () => undefined,
        onSizeChanged: () => undefined,
      });
      const html = `<script type="module" src="/assets/app.js"></script><img src="/assets/icon.svg"><style>body{font:20px sans-serif}button{width:200px;height:80px}</style><button>Run tool</button><output></output><input style="position:absolute;left:20px;top:160px;width:200px;height:40px">
<script>addEventListener("load",()=>parent.postMessage({method:"embedded-test/assets",params:window.assetScriptLoaded},"*"));const send=m=>parent.postMessage({jsonrpc:'2.0',...m},'*');
window.addEventListener('message',e=>{
 if(e.data.id===1){send({method:'ui/notifications/initialized'});send({method:'embedded-test/ready'});}
 if(e.data.id===2){document.querySelector('output').textContent=JSON.stringify(e.data);send({method:'embedded-test/result',params:e.data});}
});
document.querySelector('button').onclick=()=>send({id:2,method:'tools/call',params:{name:'counter',arguments:{increment:1}}});
send({id:1,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Prototype',version:'1'}}});</script>`;
      const mounted = mountEmbeddedBrowserPage(
        page,
        {
          url: "https://t3-embedded.invalid/app.html",
          load: async (url) => {
            const path = new URL(url).pathname;
            if (path !== "/app.html") requested.push(path);
            const body =
              path === "/app.html"
                ? html
                : path.endsWith(".js")
                  ? "window.assetScriptLoaded=true;"
                  : '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>';
            return {
              body: new TextEncoder().encode(body),
              headers: {
                "Content-Type":
                  path === "/app.html"
                    ? "text/html"
                    : path.endsWith(".js")
                      ? "text/javascript"
                      : "image/svg+xml",
              },
            };
          },
        },
        (message) => {
          if (typeof message === "object" && message !== null && "method" in message) {
            if (message.method === "embedded-test/ready") ready.resolve();
            if (message.method === "embedded-test/assets" && "params" in message)
              assets.resolve(message.params);
            if (message.method === "embedded-test/result" && "params" in message)
              result.resolve(message.params);
          }
          host.receive(message);
        },
      );
      const bridge = await mounted;
      await ready.promise;
      expect(await assets.promise).toBe(true);
      expect(requested.sort()).toEqual(["/assets/app.js", "/assets/icon.svg"]);
      const appFrame = page.mainFrame().childFrames()[0];
      if (!appFrame) throw new Error("Embedded frame did not load.");
      await appFrame.evaluate(
        "window.__t3EmbeddedPost({jsonrpc:'2.0',id:99,method:'tools/call',params:{name:'counter',arguments:{increment:99}}})",
      );
      expect(calls).toHaveLength(0);
      expect(await editableAtPoint(page, 80, 50)).toBe(false);
      expect(await editableAtPoint(page, 80, 180)).toBe(true);
      await click(page, { x: 80, y: 180 });
      await page.keyboard.insertText("embedded input");
      expect(await appFrame.locator("input").inputValue()).toBe("embedded input");
      await click(page, { x: 80, y: 50 });
      const response = await result.promise;
      expect(response).toMatchObject(
        approved
          ? { id: 2, result: { content: [{ type: "text", text: "counter=1" }] } }
          : { id: 2, error: { message: "Declined by the user." } },
      );
      expect(calls).toHaveLength(approved ? 1 : 0);
      const frame = await captureViewport(page, cdp, { format: "jpeg", quality: 70, scale: 1 });
      expect(Buffer.from(frame, "base64").subarray(0, 2)).toEqual(Buffer.from([255, 216]));
      bridge.dispose();
      host.dispose();
    } finally {
      await contexts.close();
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
