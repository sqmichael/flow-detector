package com.flowdetector.watch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import com.samsung.android.service.health.tracking.HealthTracker
import com.samsung.android.service.health.tracking.HealthTrackerException
import com.samsung.android.service.health.tracking.HealthTrackingService
import com.samsung.android.service.health.tracking.data.DataPoint
import com.samsung.android.service.health.tracking.data.HealthTrackerType
import com.samsung.android.service.health.tracking.data.ValueKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Foreground service that bridges Samsung Health Sensor SDK
 * to WebSocketManager for streaming HR, IBI, and EDA data.
 *
 * Subscribes to HEART_RATE_CONTINUOUS and EDA_CONTINUOUS trackers
 * and forwards parsed sensor data as protocol-compliant JSON
 * to the relay server via WebSocket.
 */
class SensorService : LifecycleService() {

    companion object {
        private const val TAG = "[SensorService]"
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "flow_sensor_channel"
        const val EXTRA_SERVER_URL = "server_url"
    }

    // --- Binder for MainActivity ---

    private val binder = LocalBinder()

    inner class LocalBinder : Binder() {
        fun getService(): SensorService = this@SensorService
    }

    override fun onBind(intent: Intent): IBinder {
        super.onBind(intent)
        return binder
    }

    // --- Observable state ---

    private val _heartRate = MutableStateFlow<Int?>(null)
    val heartRate: StateFlow<Int?> = _heartRate.asStateFlow()

    private val _lastIbi = MutableStateFlow<Int?>(null)
    val lastIbi: StateFlow<Int?> = _lastIbi.asStateFlow()

    private val _currentScl = MutableStateFlow<Float?>(null)
    val currentScl: StateFlow<Float?> = _currentScl.asStateFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _connectionError = MutableStateFlow<String?>(null)
    val connectionError: StateFlow<String?> = _connectionError.asStateFlow()

    private val _isStreaming = MutableStateFlow(false)
    val isStreaming: StateFlow<Boolean> = _isStreaming.asStateFlow()

    // --- Internal state ---

    private var healthTrackingService: HealthTrackingService? = null
    private var heartRateTracker: HealthTracker? = null
    private var edaTracker: HealthTracker? = null
    private lateinit var webSocketManager: WebSocketManager

    // --- Lifecycle ---

    override fun onCreate() {
        super.onCreate()
        webSocketManager = WebSocketManager(webSocketCallback)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        // Always call startForeground immediately to satisfy the 5-second ANR deadline
        // after startForegroundService() is called by the activity.
        startForeground(NOTIFICATION_ID, createNotification())

        val serverUrl = intent?.getStringExtra(EXTRA_SERVER_URL)
        if (serverUrl != null && !_isStreaming.value) {
            Log.i(TAG, "Starting streaming from onStartCommand: $serverUrl")
            _connectionError.value = null
            webSocketManager.connect(serverUrl)
            initializeSdk()
        }

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopStreaming()
        webSocketManager.destroy()
        super.onDestroy()
    }

    // --- Public API ---

    fun startStreaming(serverUrl: String) {
        Log.i(TAG, "Starting streaming to $serverUrl")
        _connectionError.value = null

        startForeground(NOTIFICATION_ID, createNotification())
        webSocketManager.connect(serverUrl)
        initializeSdk()
    }

    fun stopStreaming() {
        Log.i(TAG, "Stopping streaming")

        heartRateTracker?.unsetEventListener()
        heartRateTracker = null

        edaTracker?.unsetEventListener()
        edaTracker = null

        try {
            healthTrackingService?.disconnectService()
        } catch (e: Exception) {
            Log.w(TAG, "Error disconnecting health service: ${e.message}")
        }
        healthTrackingService = null

        webSocketManager.disconnect()

        _heartRate.value = null
        _lastIbi.value = null
        _currentScl.value = null
        _isConnected.value = false
        _isStreaming.value = false

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // --- Samsung SDK ---

    private fun initializeSdk() {
        try {
            healthTrackingService = HealthTrackingService(connectionListener, applicationContext)
            healthTrackingService?.connectService()
            Log.i(TAG, "Samsung Health SDK connecting...")
        } catch (e: Exception) {
            Log.e(TAG, "Samsung Health SDK not available: ${e.message}")
            _connectionError.value = "Samsung Health SDK not available"
        }
    }

    private val connectionListener = object : HealthTrackingService.ConnectionListener {
        override fun onConnectionSuccess() {
            Log.i(TAG, "Samsung Health SDK connected")
            checkCapabilitiesAndStartTracking()
        }

        override fun onConnectionEnded() {
            Log.w(TAG, "Samsung Health SDK connection ended")
            _isStreaming.value = false
        }

        override fun onConnectionFailed(e: HealthTrackerException) {
            Log.e(TAG, "Samsung Health SDK connection failed: ${e.message}")
            _connectionError.value = "Samsung Health SDK not available"
        }
    }

    private fun checkCapabilitiesAndStartTracking() {
        val service = healthTrackingService ?: return
        val supported = service.trackingCapability.supportHealthTrackerTypes

        val activeSensors = mutableListOf<String>()

        if (HealthTrackerType.HEART_RATE_CONTINUOUS in supported) {
            heartRateTracker = service.getHealthTracker(HealthTrackerType.HEART_RATE_CONTINUOUS)
            heartRateTracker?.setEventListener(heartRateListener)
            activeSensors.add("heart_rate")
            Log.i(TAG, "Heart rate tracker subscribed")
        } else {
            Log.w(TAG, "HEART_RATE_CONTINUOUS not supported on this device")
        }

        if (HealthTrackerType.EDA_CONTINUOUS in supported) {
            edaTracker = service.getHealthTracker(HealthTrackerType.EDA_CONTINUOUS)
            edaTracker?.setEventListener(edaListener)
            activeSensors.add("eda")
            Log.i(TAG, "EDA tracker subscribed")
        } else {
            Log.w(TAG, "EDA_CONTINUOUS not supported — EDA sensor not available")
            _connectionError.value = "EDA sensor not available"
        }

        webSocketManager.sensors = activeSensors
        _isStreaming.value = activeSensors.isNotEmpty()

        Log.i(TAG, "Active sensors: ${activeSensors.joinToString()}")
    }

    // --- Heart Rate Listener ---

    private val heartRateListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            for (dp in dataPoints) {
                val hr = dp.getValue(ValueKey.HeartRateSet.HEART_RATE)
                val hrStatus = dp.getValue(ValueKey.HeartRateSet.HEART_RATE_STATUS)

                // Only process valid readings (status 1 = successful)
                if (hrStatus != 1) continue

                // Extract valid IBI values
                val ibiList = dp.getValue(ValueKey.HeartRateSet.IBI_LIST)
                val ibiStatusList = dp.getValue(ValueKey.HeartRateSet.IBI_STATUS_LIST)

                // Find the last valid IBI (most recent beat)
                var lastValidIbi: Int? = null
                for (i in ibiList.indices) {
                    if (ibiStatusList[i] == 0 && ibiList[i] != 0) {
                        lastValidIbi = ibiList[i]
                    }
                }

                val message = HeartRateMessage(
                    bpm = hr,
                    ibi = lastValidIbi,
                    quality = 100,
                    timestamp = System.currentTimeMillis()
                )
                webSocketManager.send(message.toJson())

                _heartRate.value = hr
                _lastIbi.value = lastValidIbi
            }
        }

        override fun onFlushCompleted() {
            Log.d(TAG, "HR tracker flush completed")
        }

        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "HR tracker error: $error")
        }
    }

    // --- EDA Listener ---

    private val edaListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            for (dp in dataPoints) {
                val scl = dp.getValue(ValueKey.EdaSet.SKIN_CONDUCTANCE) ?: continue
                val status = dp.getValue(ValueKey.EdaSet.STATUS) ?: continue

                // Only send valid EDA readings (status 0 = valid)
                if (status != 0) continue

                val message = EdaMessage(
                    scl = scl,
                    timestamp = System.currentTimeMillis()
                )
                webSocketManager.send(message.toJson())

                _currentScl.value = scl
            }
        }

        override fun onFlushCompleted() {
            Log.d(TAG, "EDA tracker flush completed")
        }

        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "EDA tracker error: $error")
        }
    }

    // --- WebSocket Callback ---

    private val webSocketCallback = object : WebSocketManager.ConnectionCallback {
        override fun onConnected() {
            _isConnected.value = true
            _connectionError.value = null
            Log.i(TAG, "WebSocket connected to relay")
        }

        override fun onDisconnected(code: Int, reason: String) {
            _isConnected.value = false
            Log.i(TAG, "WebSocket disconnected: code=$code")
        }

        override fun onError(message: String) {
            _connectionError.value = message
            Log.e(TAG, "WebSocket error: $message")
        }
    }

    // --- Notification ---

    private fun createNotification(): Notification {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Flow Sensor",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Active while streaming sensor data"
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Flow Detector")
            .setContentText("Streaming HR & EDA...")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()
    }
}
