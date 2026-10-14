import { createWebViewEnvironmentNetwork } from "../../lib/webview-network.browser";

export function install(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const browserFetch = window.fetch.bind(window);
  const network = createWebViewEnvironmentNetwork();
  window.fetch = (input, init) => {
    const request = new Request(
      typeof input === "string" || input instanceof URL ? new URL(input, baseUrl) : input,
      init,
    );
    const url = new URL(request.url);
    return url.origin === origin &&
      url.pathname.startsWith("/api/assets/") &&
      (request.method === "GET" || request.method === "HEAD")
      ? network.fetch(request)
      : browserFetch(request);
  };
}
