package com.flowdetector.watch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.samsung.android.service.health.tracking.ConnectionListener
import com.samsung.android.service.health.tracking.HealthTracker
import com.samsung.android.service.health.tracking.HealthTrackerException
import com.samsung.android.service.health.tracking.HealthTrackingService
import com.samsung.android.service.health.tracking.data.DataPoint
import com.samsung.android.service.health.tracking.data.HealthTrackerType
import com.samsung.android.service.health.tracking.data.ValueKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Foreground service that bridges Samsung Health Sensor SDK
 * to WebSocketManager for streaming HR, IBI, and EDA data.
 *
 * Uses the Ongoing Activity API to stay visible on the watch face,
 * which signals to Samsung's resource manager that this is an active
 * health monitoring task and prevents the Freecessor from freezing it.
 */
class SensorService : LifecycleService() {

    companion object {
        private const val TAG = "[SensorService]"
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "flow_sensor_channel"
        const val EXTRA_SERVER_URL = "server_url"
    }

    private val binder = LocalBinder()
    private var wakeLock: PowerManager.WakeLock? = null

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
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        @Suppress("WakelockTimeout") // Intentional: streaming runs until user taps Disconnect
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "FlowDetector::SensorStreaming"
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        // Always call startForeground immediately to satisfy the 5-second ANR deadline
        startForeground(NOTIFICATION_ID, createNotification())

        val serverUrl = intent?.getStringExtra(EXTRA_SERVER_URL)
        if (serverUrl != null && !_isStreaming.value) {
            Log.i(TAG, "Starting streaming from onStartCommand: $serverUrl")
            _connectionError.value = null
            @Suppress("WakelockTimeout")
            wakeLock?.acquire()
            webSocketManager.connect(serverUrl)
            initializeSdk()
        }

        // START_STICKY: system will restart this service if killed
        return START_STICKY
    }

    override fun onDestroy() {
        stopStreaming()
        webSocketManager.destroy()
        super.onDestroy()
    }

    // --- Public API ---

    /**
     * Called from bound clients. onStartCommand is the primary entry point;
     * this is kept for cases where the service is already bound and running.
     */
    fun startStreaming(serverUrl: String) {
        Log.i(TAG, "Starting streaming to $serverUrl")
        _connectionError.value = null
        @Suppress("WakelockTimeout")
        wakeLock?.acquire()
        startForeground(NOTIFICATION_ID, createNotification())
        webSocketManager.connect(serverUrl)
        initializeSdk()
    }

    fun stopStreaming() {
        Log.i(TAG, "Stopping streaming")

        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }

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

    private val connectionListener = object : ConnectionListener {
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
            Log.w(TAG, "HEART_RATE_CONTINUOUS not supported")
        }

        if (HealthTrackerType.EDA_CONTINUOUS in supported) {
            edaTracker = service.getHealthTracker(HealthTrackerType.EDA_CONTINUOUS)
            edaTracker?.setEventListener(edaListener)
            activeSensors.add("eda")
            Log.i(TAG, "EDA tracker subscribed")
        } else {
            Log.w(TAG, "EDA_CONTINUOUS not supported")
            _connectionError.value = "EDA sensor not available"
        }

        webSocketManager.sensors = activeSensors
        _isStreaming.value = activeSensors.isNotEmpty()
        Log.i(TAG, "Active sensors: ${activeSensors.joinToString()}")
    }

    // --- Heart Rate Listener ---

    private val heartRateListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            lifecycleScope.launch {
                for (dp in dataPoints) {
                    try {
                        val hr = dp.getValue(ValueKey.HeartRateSet.HEART_RATE)
                        val hrStatus = dp.getValue(ValueKey.HeartRateSet.HEART_RATE_STATUS)
                        if (hrStatus != 1) continue

                        // IBI list may be empty (no beat detected in this window)
                        var lastValidIbi: Int? = null
                        try {
                            val ibiList = dp.getValue(ValueKey.HeartRateSet.IBI_LIST)
                            val ibiStatusList = dp.getValue(ValueKey.HeartRateSet.IBI_STATUS_LIST)
                            for (i in ibiList.indices) {
                                if (i < ibiStatusList.size && ibiStatusList[i] == 0 && ibiList[i] != 0) {
                                    lastValidIbi = ibiList[i]
                                }
                            }
                        } catch (e: Exception) {
                            // IBI data not available in this packet — that's fine,
                            // we still send the HR reading with ibi=null
                            Log.d(TAG, "IBI data not available: ${e.message}")
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
                    } catch (e: Exception) {
                        Log.w(TAG, "Skipping incomplete HR data point: ${e.message}")
                    }
                }
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
            lifecycleScope.launch {
                for (dp in dataPoints) {
                    try {
                        val scl = dp.getValue(ValueKey.EdaSet.SKIN_CONDUCTANCE)
                        val status = dp.getValue(ValueKey.EdaSet.STATUS)

                        // Only send valid EDA readings (status 0 = valid)
                        if (status != 0) continue

                        val message = EdaMessage(
                            scl = scl,
                            timestamp = System.currentTimeMillis()
                        )
                        webSocketManager.send(message.toJson())

                        _currentScl.value = scl
                    } catch (e: Exception) {
                        Log.w(TAG, "Skipping incomplete EDA data point: ${e.message}")
                    }
                }
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

    // --- Notification with Ongoing Activity ---

    private fun createNotification(): Notification {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Flow Sensor",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Active while streaming sensor data"
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)

        val tapIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notificationBuilder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Flow Detector")
            .setContentText("Streaming HR & EDA...")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)

        // Ongoing Activity ties the notification to the watch face and launcher,
        // signaling to Samsung's resource manager that this is an active task.
        // Must be applied BEFORE building the notification.
        val ongoingActivity = OngoingActivity.Builder(this, NOTIFICATION_ID, notificationBuilder)
            .setStaticIcon(android.R.drawable.ic_menu_mylocation)
            .setTouchIntent(tapIntent)
            .setStatus(
                Status.Builder()
                    .addTemplate("Streaming sensors")
                    .build()
            )
            .build()

        ongoingActivity.apply(this)

        return notificationBuilder.build()
    }
}
