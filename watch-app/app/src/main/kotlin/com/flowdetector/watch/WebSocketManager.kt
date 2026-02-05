package com.flowdetector.watch

import android.os.Build
import android.util.Log
import kotlinx.coroutines.*
import okhttp3.*
import java.util.concurrent.TimeUnit

/**
 * OkHttp WebSocket client with exponential backoff reconnection.
 *
 * Connects to the relay server at ws://<ip>:8765/watch and sends
 * a HandshakeMessage immediately on open. Reconnects automatically
 * on failure unless intentionally disconnected or rejected with
 * close code 4001 (another watch already connected).
 */
class WebSocketManager(private val callback: ConnectionCallback) {

    interface ConnectionCallback {
        fun onConnected()
        fun onDisconnected(code: Int, reason: String)
        fun onError(message: String)
    }

    /**
     * Additional callback for sync triggers.
     * Set by SensorRepository to trigger sync when connection is established.
     */
    var onConnectedForSync: (() -> Unit)? = null

    @Volatile
    private var webSocket: WebSocket? = null

    @Volatile
    private var connected = false

    @Volatile
    private var isIntentionalClose = false

    private var reconnectDelay = INITIAL_DELAY_MS

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // No read timeout for WebSocket
        .pingInterval(15, TimeUnit.SECONDS)    // Client-side keepalive for NAT traversal
        .build()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var reconnectJob: Job? = null

    /** Set before calling connect() */
    var deviceName: String = Build.MODEL
    var sensors: List<String> = emptyList()

    companion object {
        private const val TAG = "[WatchSocket]"
        private const val INITIAL_DELAY_MS = 1000L
        private const val MAX_DELAY_MS = 30_000L
        private const val CLOSE_CODE_DUPLICATE = 4001
    }

    fun connect(url: String) {
        isIntentionalClose = false
        reconnectDelay = INITIAL_DELAY_MS
        doConnect(url)
    }

    private fun doConnect(url: String) {
        // Graceful close to avoid 1006 on server (cancel() causes abnormal closure)
        webSocket?.close(1000, "Reconnecting")
        webSocket = null

        val request = Request.Builder()
            .url(url)
            .build()
        Log.i(TAG, "Connecting to $url")
        webSocket = client.newWebSocket(request, createListener(url))
    }

    fun disconnect() {
        Log.i(TAG, "Intentional disconnect")
        isIntentionalClose = true
        reconnectJob?.cancel()
        reconnectJob = null
        webSocket?.close(1000, "User disconnected")
        webSocket = null
    }

    fun send(message: String): Boolean {
        return webSocket?.send(message) ?: false
    }

    /**
     * Check if WebSocket is currently connected.
     * Used by SensorRepository to determine if sync should be attempted.
     */
    fun isConnected(): Boolean = connected

    fun destroy() {
        Log.i(TAG, "Destroying WebSocketManager")
        isIntentionalClose = true
        reconnectJob?.cancel()
        scope.cancel()
        webSocket?.cancel()
        client.dispatcher.executorService.shutdown()
    }

    private fun createListener(url: String) = object : WebSocketListener() {

        override fun onOpen(ws: WebSocket, response: Response) {
            Log.i(TAG, "Connected to relay server")
            connected = true
            reconnectDelay = INITIAL_DELAY_MS

            // Cancel any pending reconnect job to prevent race conditions
            reconnectJob?.cancel()
            reconnectJob = null

            val handshake = HandshakeMessage(
                deviceName = deviceName,
                sensors = sensors,
                timestamp = System.currentTimeMillis()
            )
            ws.send(handshake.toJson())
            Log.d(TAG, "Sent handshake: ${handshake.deviceName}, sensors: ${sensors.joinToString()}")

            callback.onConnected()

            // Trigger sync of pending batches
            onConnectedForSync?.invoke()
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            Log.i(TAG, "Connection closed: code=$code, reason=$reason")
            connected = false
            webSocket = null
            callback.onDisconnected(code, reason)

            if (code == CLOSE_CODE_DUPLICATE) {
                Log.w(TAG, "Another watch is already connected — not reconnecting")
                callback.onError("Another watch is already connected")
                return
            }

            scheduleReconnect(url)
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            Log.e(TAG, "Connection failure: ${t.message}")
            connected = false
            webSocket = null
            // Notify UI of disconnect (onFailure doesn't call onClosed)
            callback.onDisconnected(1006, t.message ?: "abnormal closure")
            callback.onError("Connection failed — retrying...")
            scheduleReconnect(url)
        }
    }

    private fun scheduleReconnect(url: String) {
        if (isIntentionalClose) return

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            Log.d(TAG, "Reconnecting in ${reconnectDelay}ms")
            delay(reconnectDelay)
            reconnectDelay = (reconnectDelay * 2).coerceAtMost(MAX_DELAY_MS)
            doConnect(url)
        }
    }
}
