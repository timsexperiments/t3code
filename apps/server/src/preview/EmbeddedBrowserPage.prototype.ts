import type { Page } from "playwright-core";

const documentUrl = "https://t3-embedded.invalid/";

// Prototype: callers supply captured content; this does not expose a public HTML-loading route.
export async function mountEmbeddedBrowserPage(
  page: Page,
  html: string,
  receive: (message: unknown) => void,
) {
  let active = true;
  await page.exposeBinding("__t3EmbeddedPost", ({ frame }, message: unknown) => {
    if (active && frame === page.mainFrame() && frame.url() === documentUrl) receive(message);
  });
  const outer = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,iframe{margin:0;border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts allow-forms"></iframe>
<script>(()=>{const frame=document.querySelector('iframe');let live=true,loads=0;
frame.onload=()=>{if(++loads>1)live=false;};
window.addEventListener('message',event=>{if(live&&event.source===frame.contentWindow)window.__t3EmbeddedPost(event.data);});
window.__t3EmbeddedReceive=message=>{if(live)frame.contentWindow.postMessage(message,'*');};
frame.srcdoc=${JSON.stringify(html).replace(/</g, "\\u003c")};})();</script>`;
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
