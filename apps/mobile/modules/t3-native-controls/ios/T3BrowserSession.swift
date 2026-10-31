import Foundation
import WebKit

@MainActor
enum T3BrowserSession {
  static func update(origin: URL, clear: Bool) async throws {
    guard origin.scheme == "https", let rawHost = origin.host else { throw URLError(.badURL) }
    let host = rawHost.lowercased()
    let store = WKWebsiteDataStore.default().httpCookieStore
    let matches: (HTTPCookie) -> Bool = { cookie in
      let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
      return host == domain || (cookie.domain.hasPrefix(".") && host.hasSuffix("." + domain))
    }
    let allCookies: [HTTPCookie] = await withCheckedContinuation { continuation in
      store.getAllCookies { continuation.resume(returning: $0) }
    }
    let cookies = allCookies.filter(matches)
    if clear {
      for cookie in cookies { await store.deleteCookie(cookie) }
    }
    for cookie in HTTPCookieStorage.shared.cookies ?? [] where matches(cookie) {
      HTTPCookieStorage.shared.deleteCookie(cookie)
    }
    if !clear {
      for cookie in cookies { HTTPCookieStorage.shared.setCookie(cookie) }
    }
  }
}
