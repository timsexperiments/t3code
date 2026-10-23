export function prependHtmlNetwork(html: string, script: string, uri: string) {
  const bootstrap = `<script>${script.replace(/<\/script/gi, "<\\/script")}\nT3HtmlNetwork.install(${JSON.stringify(uri).replace(/</g, "\\u003c")});</script>`;
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? "";
  return `${doctype}${bootstrap}${html.slice(doctype.length)}`;
}
