package expo.modules.t3nativecontrols

import com.facebook.react.modules.network.CustomClientBuilder
import com.facebook.react.modules.websocket.WebSocketModule
import android.content.Intent
import android.text.format.DateFormat
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import java.io.IOException

class T3NativeControlsModule : Module() {
  private var filePreviewPromise: Promise? = null
  private val environmentUploads = ConcurrentHashMap<String, Call>()
  private val environmentUploadClient = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false).build()

  @Suppress("TooGenericExceptionCaught") // Clear the pending promise before rethrowing.
  override fun definition() = ModuleDefinition {
    Name("T3NativeControls")
    Events("environmentTransferProgress")
    Function("configureEnvironmentWebSocket") {
      // React Native uses one WebSocket client builder per app.
      WebSocketModule.setCustomClientBuilder(CustomClientBuilder { builder ->
        builder.followRedirects(false).followSslRedirects(false)
      })
    }

    AsyncFunction("uploadEnvironmentFile") { id: String, url: String, fileUri: String,
                                            headers: Map<String, String>, promise: Promise ->
      require(URI(url).scheme.equals("https", ignoreCase = true)) { "Service authentication requires HTTPS." }
      val file = File(URI(fileUri))
      val body = object : RequestBody() {
        override fun contentType() = headers["Content-Type"]?.toMediaTypeOrNull()
        override fun contentLength() = file.length()
        override fun writeTo(sink: BufferedSink) {
          file.inputStream().use { source ->
            val buffer = ByteArray(64 * 1024)
            var sent = 0L
            var lastProgress = 0L
            while (true) {
              val count = source.read(buffer)
              if (count < 0) break
              sink.write(buffer, 0, count)
              sent += count
              val now = android.os.SystemClock.elapsedRealtime()
              if (now - lastProgress >= 100 || sent == file.length()) {
                sendEvent("environmentTransferProgress", mapOf("id" to id, "sent" to sent, "total" to file.length()))
                lastProgress = now
              }
            }
          }
        }
      }
      val request = Request.Builder().url(url).post(body).apply {
        headers.forEach { (name, value) -> header(name, value) }
      }.build()
      val call = environmentUploadClient.newCall(request)
      environmentUploads[id] = call
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
          environmentUploads.remove(id)
          promise.reject("ERR_ENVIRONMENT_UPLOAD", "The attachment upload failed.", error)
        }
        override fun onResponse(call: Call, response: Response) {
          response.use {
            environmentUploads.remove(id)
            promise.resolve(mapOf("status" to it.code))
          }
        }
      })
    }.runOnQueue(Queues.MAIN)
    Function("cancelEnvironmentTransfer") { id: String ->
      // Queue cancellation after upload registration.
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        environmentUploads[id]?.cancel()
      }
    }
    OnDestroy {
      environmentUploads.values.forEach { it.cancel() }
      environmentUploads.clear()
    }

    Function("is24HourFormat") {
      val context = appContext.reactContext ?: error("The app is not active.")
      DateFormat.is24HourFormat(context)
    }

    AsyncFunction("openFile") { uri: String, mimeType: String, promise: Promise ->
      check(filePreviewPromise == null) { "A document viewer is already open." }
      val activity = appContext.currentActivity ?: error("The app is not active.")
      val file = File(URI(uri)).canonicalFile
      require(file.isFile) { "The file is no longer available." }
      val contentUri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.FileSystemFileProvider",
        file
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      filePreviewPromise = promise
      try {
        activity.startActivityForResult(intent, 7343)
      } catch (error: Exception) {
        filePreviewPromise = null
        throw error
      }
    }

    OnActivityResult { _, (requestCode) ->
      if (requestCode == 7343) {
        filePreviewPromise?.resolve(null)
        filePreviewPromise = null
      }
    }

    Function("getShowcasePairingUrl") {
      appContext.currentActivity?.intent?.getStringExtra("showcasePairingUrl")
    }

    Function("getShowcaseScene") {
      val storedScene = appContext.reactContext
        ?.filesDir
        ?.resolve("t3-showcase-scene")
        ?.takeIf { it.isFile }
        ?.readText()
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
      storedScene ?: appContext.currentActivity?.intent?.getStringExtra("showcaseScene")
    }

    // The palette is fixed for the whole capture, so it only ever arrives as a
    // launch extra — unlike the scene, which the runner rewrites in place.
    Function("getShowcaseTheme") {
      appContext.currentActivity?.intent?.getStringExtra("showcaseTheme")
    }

    Function("prepareShowcaseCapture") {
      // Android app data is cleared by the host runner before launch.
    }

    Function("markShowcaseReady") { scene: String ->
      appContext.reactContext
        ?.filesDir
        ?.resolve("t3-showcase-ready")
        ?.writeText(scene)
    }
  }
}
