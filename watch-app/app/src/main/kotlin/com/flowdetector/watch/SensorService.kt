package com.flowdetector.watch

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.os.Binder
import android.os.IBinder
import android.os.Looper
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.samsung.android.service.health.tracking.ConnectionListener
import com.samsung.android.service.health.tracking.HealthTracker
import com.samsung.android.service.health.tracking.HealthTrackerException
import com.samsung.android.service.health.tracking.HealthTrackingService
import com.samsung.android.service.health.tracking.data.DataPoint
import com.samsung.android.service.health.tracking.data.HealthTrackerType
import com.samsung.android.service.health.tracking.data.ValueKey
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.flowdetector.watch.data.AppDatabase
import com.flowdetector.watch.data.SensorRepository
import kotlin.math.pow
import kotlin.math.sqrt

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
        private const val BATCH_WINDOW_MS = 30_000L
        private const val HR_CARRY_FORWARD_MAX_AGE_MS = 90_000L
        private const val HR_STATUS_VALID = 1
        private const val HR_STATUS_LOW_QUALITY = 2
    }

    // ── Batch Buffer ─────────────────────────────────────────────────

    private data class HrSample(val bpm: Int, val timestamp: Long)
    private data class IbiSample(val ibi: Int, val timestamp: Long)
    private data class EdaSample(val scl: Float, val timestamp: Long)
    private data class PpgSample(val green: Int, val ir: Int, val red: Int, val timestamp: Long)
    private data class AccelSample(val x: Float, val y: Float, val z: Float, val timestamp: Long)

    private val hrBuffer = mutableListOf<HrSample>()
    private val ibiBuffer = mutableListOf<IbiSample>()
    private val edaBuffer = mutableListOf<EdaSample>()
    private val ppgBuffer = mutableListOf<PpgSample>()
    private val accelBuffer = mutableListOf<AccelSample>()
    private val bufferLock = Any()
    private var batchJob: Job? = null
    private var hrAcceptedCount = 0
    private var hrRejectedStatusCount = 0
    private var hrRejectedValueCount = 0
    private var lastRejectedHrStatus: Int? = null
    private var lastValidHrBpm: Int? = null
    private var lastValidHrTimestampMs: Long = 0L

    /**
     * Calculate RMSSD (Root Mean Square of Successive Differences) from IBI values.
     */
    private fun calculateRmssd(ibiValues: List<Int>): Float {
        if (ibiValues.size < 2) return 0f
        var sumSquaredDiffs = 0.0
        for (i in 1 until ibiValues.size) {
            val diff = ibiValues[i] - ibiValues[i - 1]
            sumSquaredDiffs += diff.toDouble().pow(2)
        }
        return sqrt(sumSquaredDiffs / (ibiValues.size - 1)).toFloat()
    }

    /**
     * Calculate SDNN (Standard Deviation of NN intervals) from IBI values.
     */
    private fun calculateSdnn(ibiValues: List<Int>): Float {
        if (ibiValues.size < 2) return 0f
        val mean = ibiValues.average()
        val variance = ibiValues.map { (it - mean).pow(2) }.average()
        return sqrt(variance).toFloat()
    }

    /**
     * Calculate standard deviation of a list of floats.
     */
    private fun calculateStdDev(values: List<Float>): Float {
        if (values.size < 2) return 0f
        val mean = values.average()
        val variance = values.map { (it - mean).pow(2) }.average()
        return sqrt(variance).toFloat()
    }

    /**
     * Calculate stillness score from accelerometer magnitude variance.
     * Returns 0-1, where 1 = perfectly still, 0 = very active.
     * Uses stdDev threshold of 0.5 m/s² as reference for "movement".
     * (0.1 was too sensitive - sensor noise alone caused stdDev > 0.1)
     */
    private fun calculateStillness(magnitudeStdDev: Float): Float {
        // Stillness = 1 - (stdDev / threshold), clamped to 0-1
        // threshold of 0.5 m/s² is more tolerant of sensor noise while still detecting real movement
        val threshold = 0.5f
        val stillness = (1f - (magnitudeStdDev / threshold)).coerceIn(0f, 1f)
        Log.d(TAG, "Stillness calc: stdDev=${magnitudeStdDev}, threshold=$threshold, stillness=$stillness")
        return stillness
    }

    /**
     * Flush the current batch to local storage (and sync if connected).
     * Data is ALWAYS saved locally first to prevent data loss.
     */
    private fun flushBatch() {
        data class BufferSnapshot(
            val hr: List<HrSample>,
            val ibi: List<IbiSample>,
            val eda: List<EdaSample>,
            val ppg: List<PpgSample>,
            val accel: List<AccelSample>,
            val acceptedHrCount: Int,
            val rejectedStatusCount: Int,
            val rejectedValueCount: Int,
            val lastRejectedStatus: Int?,
            val lastKnownHr: Int?,
            val lastKnownHrTimestampMs: Long
        )
        val snapshot = synchronized(bufferLock) {
            BufferSnapshot(
                hrBuffer.toList().also { hrBuffer.clear() },
                ibiBuffer.toList().also { ibiBuffer.clear() },
                edaBuffer.toList().also { edaBuffer.clear() },
                ppgBuffer.toList().also { ppgBuffer.clear() },
                accelBuffer.toList().also { accelBuffer.clear() },
                hrAcceptedCount.also { hrAcceptedCount = 0 },
                hrRejectedStatusCount.also { hrRejectedStatusCount = 0 },
                hrRejectedValueCount.also { hrRejectedValueCount = 0 },
                lastRejectedHrStatus.also { lastRejectedHrStatus = null },
                lastValidHrBpm,
                lastValidHrTimestampMs
            )
        }
        val hrSamples = snapshot.hr
        val ibiSamples = snapshot.ibi
        val edaSamples = snapshot.eda
        val ppgSamples = snapshot.ppg
        val accelSamples = snapshot.accel
        val timestamp = System.currentTimeMillis()

        // Need at least some meaningful sensor data to send a batch
        if (hrSamples.isEmpty() && edaSamples.isEmpty() && ppgSamples.isEmpty()) {
            Log.d(TAG, "Skipping empty batch (no HR, EDA, or PPG)")
            return
        }

        // HR aggregates (nullable — SDK delivers intermittently)
        // Carry forward the most recent valid HR for short gaps to stabilize stream continuity.
        val lastKnownHrAgeMs = if (snapshot.lastKnownHrTimestampMs > 0L) {
            timestamp - snapshot.lastKnownHrTimestampMs
        } else {
            Long.MAX_VALUE
        }
        val useCarryForwardHr =
            hrSamples.isEmpty() &&
                snapshot.lastKnownHr != null &&
                lastKnownHrAgeMs in 0..HR_CARRY_FORWARD_MAX_AGE_MS

        val hrAggregate = if (hrSamples.isNotEmpty()) {
            val hrValues = hrSamples.map { it.bpm }
            HrAggregate(
                mean = hrValues.average().toFloat(),
                min = hrValues.minOrNull() ?: 0,
                max = hrValues.maxOrNull() ?: 0,
                samples = hrValues.size
            )
        } else if (useCarryForwardHr) {
            val carried = snapshot.lastKnownHr!!
            HrAggregate(
                mean = carried.toFloat(),
                min = carried,
                max = carried,
                samples = 1
            )
        } else null

        // HRV from IBI (filter valid range 300-2000ms)
        val hrvAggregate = if (ibiSamples.isNotEmpty()) {
            val validIbi = ibiSamples.map { it.ibi }.filter { it in 300..2000 }
            HrvAggregate(
                rmssd = calculateRmssd(validIbi),
                sdnn = calculateSdnn(validIbi)
            )
        } else null

        // EDA aggregates
        val edaAggregate = if (edaSamples.isNotEmpty()) {
            val sclValues = edaSamples.map { it.scl }
            EdaAggregate(
                meanScl = sclValues.average().toFloat(),
                peakScl = sclValues.maxOrNull() ?: 0f
            )
        } else null

        // PPG aggregates (optional - only if we have samples)
        val ppgAggregate = if (ppgSamples.isNotEmpty()) {
            val greenValues = ppgSamples.map { it.green.toFloat() }
            val irValues = ppgSamples.map { it.ir.toFloat() }
            val redValues = ppgSamples.map { it.red.toFloat() }
            PpgAggregate(
                greenMean = greenValues.average().toFloat(),
                greenStd = calculateStdDev(greenValues),
                irMean = irValues.average().toFloat(),
                irStd = calculateStdDev(irValues),
                redMean = redValues.average().toFloat(),
                redStd = calculateStdDev(redValues),
                samples = ppgSamples.size
            )
        } else null

        // Accelerometer aggregates (optional - only if we have samples)
        val accelAggregate = if (accelSamples.isNotEmpty()) {
            // Calculate magnitude for each sample: sqrt(x² + y² + z²)
            val magnitudes = accelSamples.map { sample ->
                sqrt(sample.x.pow(2) + sample.y.pow(2) + sample.z.pow(2))
            }
            val magnitudeStd = calculateStdDev(magnitudes)
            AccelAggregate(
                magnitudeMean = magnitudes.average().toFloat(),
                magnitudeStd = magnitudeStd,
                stillness = calculateStillness(magnitudeStd),
                samples = accelSamples.size
            )
        } else null

        // Location snapshot (latest sample, transient — not persisted)
        // Discard if: stale (>5min), bad GPS time, or too imprecise (>500m)
        val locationAggregate = latestLocation?.let { loc ->
            val ageMs = System.currentTimeMillis() - loc.time
            when {
                loc.time == 0L -> null  // Bad GPS time on some coarse fixes
                ageMs > 5 * 60 * 1000L -> null  // Stale fix (e.g. indoors)
                loc.accuracy > 500f -> null  // Too imprecise to be useful
                else -> LocationAggregate(
                    latitude = loc.latitude.toFloat(),
                    longitude = loc.longitude.toFloat(),
                    accuracy = loc.accuracy
                )
            }
        }

        val hrInfo = if (useCarryForwardHr) {
            "HR=${snapshot.lastKnownHr} (carry ${lastKnownHrAgeMs / 1000}s)"
        } else {
            hrAggregate?.let { "HR=${it.mean.toInt()} (${it.samples})" } ?: "HR=none"
        }
        val hrvInfo = hrvAggregate?.let { "RMSSD=${it.rmssd.toInt()}ms" } ?: ""
        val edaInfo = edaAggregate?.let { "SCL=${it.meanScl}" } ?: ""
        val ppgInfo = ppgAggregate?.let { " PPG=${it.samples}samples" } ?: ""
        val accelInfo = accelAggregate?.let { " Stillness=${(it.stillness * 100).toInt()}%" } ?: ""
        val locInfo = locationAggregate?.let { " Loc=present ±${it.accuracy.toInt()}m" } ?: ""
        val hrDiagInfo =
            " HRdiag(ok=${snapshot.acceptedHrCount},statusDrop=${snapshot.rejectedStatusCount},valueDrop=${snapshot.rejectedValueCount},lastStatus=${snapshot.lastRejectedStatus ?: "none"})"
        Log.i(TAG, "Saving batch: $hrInfo, $hrvInfo, $edaInfo$ppgInfo$accelInfo$locInfo$hrDiagInfo")

        // Send location-enriched batch via WebSocket if connected,
        // then save to Room (without location — transient context only)
        lifecycleScope.launch {
            // Try to send the full message (with location) directly
            val directSent = if (webSocketManager.isConnected()) {
                val batchMsg = BatchMessage(
                    hr = hrAggregate,
                    hrv = hrvAggregate,
                    eda = edaAggregate,
                    ppg = ppgAggregate,
                    accel = accelAggregate,
                    location = locationAggregate,
                    timestamp = timestamp
                )
                webSocketManager.send(batchMsg.toJson())
            } else false

            // Save to Room (without location) for durability
            val batch = sensorRepository.createBatch(
                hr = hrAggregate,
                hrv = hrvAggregate,
                eda = edaAggregate,
                ppg = ppgAggregate,
                accel = accelAggregate,
                timestamp = timestamp,
                windowMs = BATCH_WINDOW_MS
            )
            sensorRepository.saveBatch(batch, preSynced = directSent)
        }
    }

    /**
     * Start the 30-second batch timer.
     */
    private fun startBatchTimer() {
        batchJob?.cancel()
        batchJob = lifecycleScope.launch {
            while (isActive) {
                delay(BATCH_WINDOW_MS)
                flushBatch()
            }
        }
    }

    /**
     * Stop the batch timer and flush remaining data.
     */
    private fun stopBatchTimer() {
        batchJob?.cancel()
        batchJob = null
        flushBatch() // Send any remaining buffered data
    }

    private val binder = LocalBinder()
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

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

    private val _pendingBatches = MutableStateFlow(0)
    val pendingBatches: StateFlow<Int> = _pendingBatches.asStateFlow()

    // --- Internal state ---

    private lateinit var sensorRepository: SensorRepository
    private var healthTrackingService: HealthTrackingService? = null
    private var heartRateTracker: HealthTracker? = null
    private var edaTracker: HealthTracker? = null
    private var ppgTracker: HealthTracker? = null
    private lateinit var webSocketManager: WebSocketManager

    // Android SensorManager for accelerometer (simpler than Samsung SDK)
    private val sensorManager by lazy { getSystemService(Context.SENSOR_SERVICE) as SensorManager }
    private var accelerometer: Sensor? = null

    // Location via Google Play Services (coarse, battery-efficient)
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    @Volatile private var latestLocation: Location? = null
    private var locationCallback: LocationCallback? = null

    // --- Lifecycle ---

    override fun onCreate() {
        super.onCreate()
        webSocketManager = WebSocketManager(webSocketCallback)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        // Initialize Room database and repository
        val database = AppDatabase.getInstance(applicationContext)
        sensorRepository = SensorRepository(database.sensorBatchDao(), webSocketManager)

        // Wire up sync trigger on WebSocket connect
        webSocketManager.onConnectedForSync = {
            lifecycleScope.launch {
                sensorRepository.syncUnsynced()
                _pendingBatches.value = sensorRepository.getPendingCount()
            }
        }

        // Observe pending count from repository
        lifecycleScope.launch {
            sensorRepository.pendingCount.collect { count ->
                _pendingBatches.value = count
            }
        }

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        @Suppress("WakelockTimeout") // Intentional: streaming runs until user taps Disconnect
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "FlowDetector::SensorStreaming"
        )

        // WiFi lock prevents the radio from sleeping when screen is off
        val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wifiManager.createWifiLock(
            WifiManager.WIFI_MODE_FULL_HIGH_PERF,
            "FlowDetector::WifiStreaming"
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
            wifiLock?.acquire()
            webSocketManager.connect(serverUrl)
            initializeSdk()
        }

        // START_STICKY: system will restart this service if killed
        return START_STICKY
    }

    override fun onDestroy() {
        stopStreaming()
        sensorRepository.destroy()
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
        wifiLock?.acquire()
        startForeground(NOTIFICATION_ID, createNotification())
        webSocketManager.connect(serverUrl)
        initializeSdk()
    }

    fun stopStreaming() {
        Log.i(TAG, "Stopping streaming")

        // Stop batch timer, flush remaining data, and stop cleanup scheduler
        stopBatchTimer()
        sensorRepository.stopCleanupScheduler()

        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        if (wifiLock?.isHeld == true) {
            wifiLock?.release()
        }

        heartRateTracker?.unsetEventListener()
        heartRateTracker = null
        edaTracker?.unsetEventListener()
        edaTracker = null
        ppgTracker?.unsetEventListener()
        ppgTracker = null
        // Unregister Android accelerometer listener and stop location
        sensorManager.unregisterListener(accelSensorListener)
        stopLocationUpdates()
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

        // Log all supported tracker types for debugging
        Log.i(TAG, "Supported tracker types: ${supported.map { it.name }}")

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

        // PPG provides raw photoplethysmography data (green, IR, red channels)
        // Try combined trackers first, then fall back to individual channel trackers
        var ppgSubscribed = false

        // Try PPG_CONTINUOUS first (25Hz combined)
        if (!ppgSubscribed && HealthTrackerType.PPG_CONTINUOUS in supported) {
            try {
                ppgTracker = service.getHealthTracker(HealthTrackerType.PPG_CONTINUOUS)
                ppgTracker?.setEventListener(ppgListener)
                activeSensors.add("ppg")
                ppgSubscribed = true
                Log.i(TAG, "PPG_CONTINUOUS tracker subscribed (25Hz)")
            } catch (e: Exception) {
                Log.w(TAG, "PPG_CONTINUOUS failed: ${e.message}")
            }
        }

        // Fallback to PPG_ON_DEMAND (100Hz combined)
        if (!ppgSubscribed && HealthTrackerType.PPG_ON_DEMAND in supported) {
            try {
                ppgTracker = service.getHealthTracker(HealthTrackerType.PPG_ON_DEMAND)
                ppgTracker?.setEventListener(ppgListener)
                activeSensors.add("ppg")
                ppgSubscribed = true
                Log.i(TAG, "PPG_ON_DEMAND tracker subscribed (100Hz)")
            } catch (e: Exception) {
                Log.w(TAG, "PPG_ON_DEMAND failed: ${e.message}")
            }
        }

        // Fallback to PPG_GREEN (single channel - might work without partner approval)
        if (!ppgSubscribed && HealthTrackerType.PPG_GREEN in supported) {
            try {
                ppgTracker = service.getHealthTracker(HealthTrackerType.PPG_GREEN)
                ppgTracker?.setEventListener(ppgGreenListener)
                activeSensors.add("ppg_green")
                ppgSubscribed = true
                Log.i(TAG, "PPG_GREEN tracker subscribed (single channel)")
            } catch (e: Exception) {
                Log.w(TAG, "PPG_GREEN failed: ${e.message}")
            }
        }

        if (!ppgSubscribed) {
            Log.w(TAG, "No PPG tracker available (tried CONTINUOUS, ON_DEMAND, GREEN)")
        }

        // Accelerometer via Android SensorManager (not Samsung SDK)
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (accelerometer != null) {
            sensorManager.registerListener(accelSensorListener, accelerometer, SensorManager.SENSOR_DELAY_NORMAL)
            activeSensors.add("accelerometer")
            Log.i(TAG, "Accelerometer registered via SensorManager")
        } else {
            Log.w(TAG, "Accelerometer sensor not available")
        }

        // Location via FusedLocationProviderClient (coarse, one per batch window)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED
        ) {
            startLocationUpdates()
            activeSensors.add("location")
        } else {
            Log.w(TAG, "ACCESS_COARSE_LOCATION not granted, skipping location")
        }

        webSocketManager.sensors = activeSensors
        _isStreaming.value = activeSensors.isNotEmpty()
        Log.i(TAG, "Active sensors: ${activeSensors.joinToString()}")

        // Start 30-second batch timer and cleanup scheduler
        if (activeSensors.isNotEmpty()) {
            startBatchTimer()
            sensorRepository.startCleanupScheduler()
            Log.i(TAG, "Batch timer started (${BATCH_WINDOW_MS / 1000}s windows)")
        }
    }

    // --- Heart Rate Listener ---

    private val heartRateListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            val now = System.currentTimeMillis()
            for (dp in dataPoints) {
                try {
                    val hr = dp.getValue(ValueKey.HeartRateSet.HEART_RATE)
                    val hrStatus = dp.getValue(ValueKey.HeartRateSet.HEART_RATE_STATUS)
                    val statusAccepted =
                        hrStatus == HR_STATUS_VALID || hrStatus == HR_STATUS_LOW_QUALITY
                    val hrValueAccepted = hr in 30..220
                    if (!statusAccepted || !hrValueAccepted) {
                        synchronized(bufferLock) {
                            if (!statusAccepted) {
                                hrRejectedStatusCount++
                                lastRejectedHrStatus = hrStatus
                            } else {
                                hrRejectedValueCount++
                            }
                        }
                        continue
                    }

                    // Buffer HR sample
                    synchronized(bufferLock) {
                        hrBuffer.add(HrSample(hr, now))
                        hrAcceptedCount++
                        lastValidHrBpm = hr
                        lastValidHrTimestampMs = now
                    }
                    _heartRate.value = hr

                    // Extract and buffer IBI values
                    try {
                        val ibiList = dp.getValue(ValueKey.HeartRateSet.IBI_LIST)
                        val ibiStatusList = dp.getValue(ValueKey.HeartRateSet.IBI_STATUS_LIST)
                        for (i in ibiList.indices) {
                            if (i < ibiStatusList.size && ibiStatusList[i] == 0 && ibiList[i] != 0) {
                                synchronized(bufferLock) {
                                    ibiBuffer.add(IbiSample(ibiList[i], now))
                                }
                                _lastIbi.value = ibiList[i]
                            }
                        }
                    } catch (e: Exception) {
                        Log.d(TAG, "IBI data not available: ${e.message}")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Skipping incomplete HR data point: ${e.message}")
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
            val now = System.currentTimeMillis()
            for (dp in dataPoints) {
                try {
                    val scl = dp.getValue(ValueKey.EdaSet.SKIN_CONDUCTANCE)
                    val status = dp.getValue(ValueKey.EdaSet.STATUS)

                    // Only buffer valid EDA readings (status 0 = valid)
                    if (status != 0) continue

                    synchronized(bufferLock) {
                        edaBuffer.add(EdaSample(scl, now))
                    }
                    _currentScl.value = scl
                } catch (e: Exception) {
                    Log.w(TAG, "Skipping incomplete EDA data point: ${e.message}")
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

    // --- PPG Listener ---

    private val ppgListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            val now = System.currentTimeMillis()
            for (dp in dataPoints) {
                try {
                    // Samsung SDK 1.4.0: PPG values are single Int per DataPoint
                    val green = dp.getValue(ValueKey.PpgSet.PPG_GREEN)
                    val ir = dp.getValue(ValueKey.PpgSet.PPG_IR)
                    val red = dp.getValue(ValueKey.PpgSet.PPG_RED)

                    synchronized(bufferLock) {
                        ppgBuffer.add(PpgSample(
                            green = green,
                            ir = ir,
                            red = red,
                            timestamp = now
                        ))
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Skipping incomplete PPG data point: ${e.message}")
                }
            }
        }

        override fun onFlushCompleted() {
            Log.d(TAG, "PPG tracker flush completed")
        }

        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "PPG tracker error: $error")
        }
    }

    // --- PPG Green-only Listener (fallback for single channel) ---

    private val ppgGreenListener = object : HealthTracker.TrackerEventListener {
        override fun onDataReceived(dataPoints: MutableList<DataPoint>) {
            val now = System.currentTimeMillis()
            for (dp in dataPoints) {
                try {
                    // PPG_GREEN tracker uses ValueKey.PpgGreenSet.PPG_GREEN
                    val green = dp.getValue(ValueKey.PpgGreenSet.PPG_GREEN)

                    synchronized(bufferLock) {
                        ppgBuffer.add(PpgSample(
                            green = green,
                            ir = 0,  // Not available in single channel mode
                            red = 0,
                            timestamp = now
                        ))
                    }
                } catch (e: Exception) {
                    // Only log first error to avoid spam
                    Log.w(TAG, "PPG_GREEN getValue error: ${e.message}")
                }
            }
        }

        override fun onFlushCompleted() {
            Log.d(TAG, "PPG_GREEN tracker flush completed")
        }

        override fun onError(error: HealthTracker.TrackerError) {
            Log.e(TAG, "PPG_GREEN tracker error: $error")
        }
    }

    // --- Location Updates (FusedLocationProviderClient) ---

    @Suppress("MissingPermission") // Permission checked before calling
    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(BATCH_WINDOW_MS)
            .setPriority(Priority.PRIORITY_LOW_POWER)
            .setMinUpdateIntervalMillis(BATCH_WINDOW_MS)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { loc ->
                    latestLocation = loc
                    Log.d(TAG, "Location: ${loc.latitude},${loc.longitude} ±${loc.accuracy}m")
                }
            }
        }

        fusedLocationClient.requestLocationUpdates(request, locationCallback!!, Looper.getMainLooper())
        Log.i(TAG, "Location updates started (interval=${BATCH_WINDOW_MS / 1000}s, LOW_POWER)")
    }

    private fun stopLocationUpdates() {
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
            locationCallback = null
        }
        latestLocation = null
    }

    // --- Accelerometer Listener (Android SensorManager) ---

    private val accelSensorListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            synchronized(bufferLock) {
                accelBuffer.add(AccelSample(
                    x = event.values[0],
                    y = event.values[1],
                    z = event.values[2],
                    timestamp = System.currentTimeMillis()
                ))
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
            // Accelerometer accuracy rarely changes, no action needed
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
