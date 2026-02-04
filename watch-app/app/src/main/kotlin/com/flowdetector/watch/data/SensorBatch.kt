package com.flowdetector.watch.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Room entity for storing sensor batch data locally.
 *
 * This entity stores aggregated sensor data from 30-second windows,
 * allowing the watch to continue collecting data even when WebSocket
 * is disconnected. Data is synced when connection is restored.
 */
@Entity(tableName = "sensor_batches")
data class SensorBatch(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    /** Timestamp when the batch was created (epoch ms) */
    val timestamp: Long,

    /** Window duration in milliseconds (typically 30000) */
    val windowMs: Long = 30000,

    // Heart rate aggregates
    val hrMean: Float?,
    val hrMin: Int?,
    val hrMax: Int?,
    val hrSamples: Int?,

    // HRV aggregates (from IBI data)
    val hrvRmssd: Float?,
    val hrvSdnn: Float?,

    // EDA aggregates
    val edaMeanScl: Float?,
    val edaPeakScl: Float?,

    // PPG aggregates (optional)
    val ppgGreenMean: Float? = null,
    val ppgGreenStd: Float? = null,
    val ppgIrMean: Float? = null,
    val ppgIrStd: Float? = null,
    val ppgRedMean: Float? = null,
    val ppgRedStd: Float? = null,
    val ppgSamples: Int? = null,

    // Accelerometer aggregates (optional)
    val accelMagnitudeMean: Float? = null,
    val accelMagnitudeStd: Float? = null,
    val accelStillness: Float? = null,
    val accelSamples: Int? = null,

    /** Whether this batch has been successfully synced to the server */
    val synced: Boolean = false
)
