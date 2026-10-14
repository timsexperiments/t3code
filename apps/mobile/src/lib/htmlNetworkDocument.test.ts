// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import { prependHtmlNetwork } from "./htmlNetworkDocument";

describe("HTML network bootstrap", () => {
  it("executes before the document scripts and preserves standards mode", () => {
    const html = prependHtmlNetwork(
      '<!doctype html><html><head><script>window.order.push("document");</script></head><body>Page</body></html>',
      'var T3HtmlNetwork={install:function(){window.order=["bootstrap"];}};',
      "https://environment.test/api/assets/token/test.html",
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.compatMode).toBe("CSS1Compat");
    for (const script of parsed.querySelectorAll("script")) window.eval(script.textContent ?? "");
    expect(window).toHaveProperty("order", ["bootstrap", "document"]);
  });

  it("keeps closing-script text and the document URL inside the bootstrap", () => {
    const html = prependHtmlNetwork(
      "<p>Page</p>",
      'var T3HtmlNetwork={install:function(uri){window.savedUri=uri;}};window.label="</script><p>escaped</p>";',
      "https://environment.test/api/assets/token/</script>.html",
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelectorAll("script")).toHaveLength(1);
    window.eval(parsed.querySelector("script")?.textContent ?? "");
    expect(window).toHaveProperty(
      "savedUri",
      "https://environment.test/api/assets/token/</script>.html",
    );
    expect(parsed.body.textContent).toBe("Page");
  });
});
