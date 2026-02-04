package com.flowdetector.watch.data

import android.util.Log
import com.flowdetector.watch.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.*

/**
 * Repository for sensor data that implements local-first storage.
 *
 * All sensor batches are saved locally first, then synced to the server
 * when a WebSocket connection is available. This ensures no data loss
 * during connectivity interruptions.
 *
 * Sync Strategy:
 * 1. Every batch is saved to Room immediately
 * 2. If WebSocket is connected, attempt immediate sync
 * 3. On WebSocket connect, sync all pending batches
 * 4. Periodically clean up old synced data (>24h)
 */
class SensorRepository(
    private val dao: SensorBatchDao,
    private val webSocketManager: WebSocketManager
) {
    companion object {
        private const val TAG = "[SensorRepo]"
        private const val CLEANUP_INTERVAL_MS = 60 * 60 * 1000L  // 1 hour
        private const val RETENTION_PERIOD_MS = 24 * 60 * 60 * 1000L  // 24 hours
        private const val MAX_BATCH_SYNC = 100  // Max batches to sync at once
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var cleanupJob: Job? = null

    private val _pendingCount = MutableStateFlow(0)
    val pendingCount: StateFlow<Int> = _pendingCount.asStateFlow()

    /**
     * Save a batch locally and attempt to sync if connected.
     * This is the primary entry point for new sensor data.
     */
    suspend fun saveBatch(batch: SensorBatch) {
        // Always save locally first
        val id = dao.insert(batch)
        Log.d(TAG, "Saved batch locally: id=$id, timestamp=${batch.timestamp}")

        // Update pending count
        _pendingCount.value = dao.getUnsyncedCount()

        // Try to sync if connected
        if (webSocketManager.isConnected()) {
            syncUnsynced()
        }
    }

    /**
     * Create a SensorBatch from aggregated sensor data.
     * Convenience method to construct the entity from SensorService data.
     */
    fun createBatch(
        hr: HrAggregate?,
        hrv: HrvAggregate?,
        eda: EdaAggregate?,
        ppg: PpgAggregate?,
        accel: AccelAggregate?,
        timestamp: Long,
        windowMs: Long = 30000
    ): SensorBatch {
        return SensorBatch(
            timestamp = timestamp,
            windowMs = windowMs,
            // HR
            hrMean = hr?.mean,
            hrMin = hr?.min,
            hrMax = hr?.max,
            hrSamples = hr?.samples,
            // HRV
            hrvRmssd = hrv?.rmssd,
            hrvSdnn = hrv?.sdnn,
            // EDA
            edaMeanScl = eda?.meanScl,
            edaPeakScl = eda?.peakScl,
            // PPG
            ppgGreenMean = ppg?.greenMean,
            ppgGreenStd = ppg?.greenStd,
            ppgIrMean = ppg?.irMean,
            ppgIrStd = ppg?.irStd,
            ppgRedMean = ppg?.redMean,
            ppgRedStd = ppg?.redStd,
            ppgSamples = ppg?.samples,
            // Accelerometer
            accelMagnitudeMean = accel?.magnitudeMean,
            accelMagnitudeStd = accel?.magnitudeStd,
            accelStillness = accel?.stillness,
            accelSamples = accel?.samples
        )
    }

    /**
     * Sync all unsynced batches to the server.
     * Called on WebSocket connect and after saving new batches.
     */
    suspend fun syncUnsynced() {
        val unsynced = dao.getUnsynced().take(MAX_BATCH_SYNC)
        if (unsynced.isEmpty()) {
            Log.d(TAG, "No unsynced batches to send")
            return
        }

        Log.i(TAG, "Syncing ${unsynced.size} unsynced batches")
        val syncedIds = mutableListOf<Long>()

        for (batch in unsynced) {
            val json = batchToJson(batch)
            if (webSocketManager.send(json)) {
                syncedIds.add(batch.id)
            } else {
                // Connection lost, stop trying
                Log.w(TAG, "Send failed at batch ${batch.id}, stopping sync")
                break
            }
        }

        if (syncedIds.isNotEmpty()) {
            dao.markSynced(syncedIds)
            Log.i(TAG, "Marked ${syncedIds.size} batches as synced")
        }

        // Update pending count
        _pendingCount.value = dao.getUnsyncedCount()
    }

    /**
     * Start periodic cleanup of old synced data.
     */
    fun startCleanupScheduler() {
        cleanupJob?.cancel()
        cleanupJob = scope.launch {
            while (isActive) {
                delay(CLEANUP_INTERVAL_MS)
                cleanup()
            }
        }
    }

    /**
     * Stop the cleanup scheduler.
     */
    fun stopCleanupScheduler() {
        cleanupJob?.cancel()
        cleanupJob = null
    }

    /**
     * Clean up old synced batches (older than 24 hours).
     */
    suspend fun cleanup() {
        val cutoff = System.currentTimeMillis() - RETENTION_PERIOD_MS
        dao.deleteOldSynced(cutoff)
        Log.d(TAG, "Cleaned up synced batches older than ${RETENTION_PERIOD_MS / 1000 / 60 / 60}h")
    }

    /**
     * Convert a SensorBatch entity to JSON matching the protocol.
     * Output format matches BatchMessage.toJson() for compatibility.
     */
    private fun batchToJson(batch: SensorBatch): String {
        return buildJsonObject {
            put("type", "batch")
            put("windowMs", batch.windowMs)
            put("timestamp", batch.timestamp)

            // HR aggregate
            putJsonObject("hr") {
                batch.hrMean?.let { put("mean", it) }
                batch.hrMin?.let { put("min", it) }
                batch.hrMax?.let { put("max", it) }
                batch.hrSamples?.let { put("samples", it) }
            }

            // HRV aggregate
            putJsonObject("hrv") {
                batch.hrvRmssd?.let { put("rmssd", it) }
                batch.hrvSdnn?.let { put("sdnn", it) }
            }

            // EDA aggregate
            putJsonObject("eda") {
                batch.edaMeanScl?.let { put("meanScl", it) }
                batch.edaPeakScl?.let { put("peakScl", it) }
            }

            // PPG aggregate (optional)
            if (batch.ppgGreenMean != null) {
                putJsonObject("ppg") {
                    put("greenMean", batch.ppgGreenMean)
                    batch.ppgGreenStd?.let { put("greenStd", it) }
                    batch.ppgIrMean?.let { put("irMean", it) }
                    batch.ppgIrStd?.let { put("irStd", it) }
                    batch.ppgRedMean?.let { put("redMean", it) }
                    batch.ppgRedStd?.let { put("redStd", it) }
                    batch.ppgSamples?.let { put("samples", it) }
                }
            }

            // Accelerometer aggregate (optional)
            if (batch.accelMagnitudeMean != null) {
                putJsonObject("accel") {
                    put("magnitudeMean", batch.accelMagnitudeMean)
                    batch.accelMagnitudeStd?.let { put("magnitudeStd", it) }
                    batch.accelStillness?.let { put("stillness", it) }
                    batch.accelSamples?.let { put("samples", it) }
                }
            }
        }.toString()
    }

    /**
     * Get current pending count synchronously (for debugging).
     */
    suspend fun getPendingCount(): Int = dao.getUnsyncedCount()

    /**
     * Destroy the repository and cancel all jobs.
     */
    fun destroy() {
        cleanupJob?.cancel()
        scope.cancel()
    }
}
