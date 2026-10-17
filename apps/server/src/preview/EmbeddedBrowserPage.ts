import type { Page } from "playwright-core";

export const EMBEDDED_ORIGIN = "https://t3-embedded.invalid";
const documentUrl = `${EMBEDDED_ORIGIN}/`;
export interface EmbeddedBrowserDocument {
  readonly allowDownloads?: boolean;
  readonly url: string;
  readonly load: (url: string) => Promise<{
    readonly body: Uint8Array;
    readonly headers: Record<string, string>;
  } | null>;
}

export async function mountEmbeddedBrowserPage(
  page: Page,
  document: EmbeddedBrowserDocument,
  receive: (message: unknown) => void,
) {
  let active = true;
  await page.exposeBinding("__t3EmbeddedPost", ({ frame }, message: unknown) => {
    if (active && frame === page.mainFrame() && frame.url() === documentUrl) receive(message);
  });
  const outer = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,iframe{margin:0;border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts allow-forms${document.allowDownloads ? " allow-downloads" : ""}"></iframe>
<script>(()=>{const frame=document.querySelector('iframe');let live=true,loads=0;
frame.onload=()=>{if(++loads>1){live=false;window.__t3EmbeddedPost({t3:'navigated'});}};
window.addEventListener('message',event=>{if(live&&event.source===frame.contentWindow)window.__t3EmbeddedPost(event.data);});
window.__t3EmbeddedReceive=message=>{if(live)frame.contentWindow.postMessage(message,'*');};
frame.src=${JSON.stringify(document.url).replace(/</g, "\\u003c")};})();</script>`;
  await page.route(`${new URL(document.url).origin}/**`, async (route) => {
    if (route.request().url() === documentUrl) return route.fallback();
    if (route.request().method() !== "GET" && route.request().method() !== "HEAD")
      return route.abort("accessdenied");
    const resource = await document.load(route.request().url()).catch(() => null);
    if (!resource) return route.abort("accessdenied");
    await route.fulfill({ body: Buffer.from(resource.body), headers: resource.headers });
  });
  await page.route(documentUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: outer }),
  );
  await page.goto(documentUrl);
  return {
    send: (message: unknown) =>
      page.evaluate(`window.__t3EmbeddedReceive?.(${JSON.stringify(message)});`),
    dispose: () => {
      active = false;
    },
  };
}
