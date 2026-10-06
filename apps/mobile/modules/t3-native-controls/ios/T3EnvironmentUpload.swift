import Foundation

/** Credentialed file transfers share a foreground session that refuses redirects. */
final class T3EnvironmentUpload: NSObject, URLSessionTaskDelegate, URLSessionDataDelegate {
  private var session: URLSession?
  private var task: URLSessionUploadTask?
  private let progress: (Int64, Int64) -> Void
  private let completion: (Result<Int, Error>) -> Void
  private var lastProgress: TimeInterval = 0

  init(progress: @escaping (Int64, Int64) -> Void, completion: @escaping (Result<Int, Error>) -> Void) {
    self.progress = progress
    self.completion = completion
  }

  func start(url: URL, file: URL, headers: [String: String]) {
    guard url.scheme?.lowercased() == "https", file.isFileURL else {
      completion(.failure(URLError(.unsupportedURL)))
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.allHTTPHeaderFields = headers
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    self.session = session
    let task = session.uploadTask(with: request, fromFile: file)
    self.task = task
    task.resume()
  }

  func cancel() { task?.cancel() }

  func urlSession(_ session: URLSession, task: URLSessionTask,
                  willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                  completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                  totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    let now = Date.timeIntervalSinceReferenceDate
    if now - lastProgress >= 0.1 || totalBytesSent == totalBytesExpectedToSend {
      progress(totalBytesSent, totalBytesExpectedToSend)
      lastProgress = now
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    // The upload endpoint has no response body to retain.
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let result: Result<Int, Error>
    if let error { result = .failure(error) }
    else if let response = task.response as? HTTPURLResponse { result = .success(response.statusCode) }
    else { result = .failure(URLError(.badServerResponse)) }
    session.finishTasksAndInvalidate()
    self.session = nil
    self.task = nil
    completion(result)
  }
}
