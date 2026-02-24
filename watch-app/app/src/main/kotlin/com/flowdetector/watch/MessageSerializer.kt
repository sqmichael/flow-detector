package com.flowdetector.watch

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Protocol messages matching the WatchMessage discriminated union
 * defined in src/lib/biometrics/types.ts.
 *
 * The relay server (server/watch-relay.ts) parses the "type" field
 * from the handshake message. All other messages are relayed as-is
 * to browser clients.
 */

private val json = Json { encodeDefaults = true }

@Serializable
data class HandshakeMessage(
    val type: String = "handshake",
    val protocolVersion: Int = 1,
    val deviceName: String,
    val sensors: List<String>,
    val timestamp: Long
) {
    fun toJson(): String = json.encodeToString(this)
}

@Serializable
data class HeartRateMessage(
    val type: String = "hr",
    val bpm: Int,
    val ibi: Int? = null,
    val quality: Int,
    val timestamp: Long
) {
    fun toJson(): String = json.encodeToString(this)
}

@Serializable
data class EdaMessage(
    val type: String = "eda",
    val scl: Float,
    val timestamp: Long
) {
    fun toJson(): String = json.encodeToString(this)
}

@Serializable
data class HrAggregate(
    val mean: Float,
    val min: Int,
    val max: Int,
    val samples: Int
)

@Serializable
data class HrvAggregate(
    val rmssd: Float,
    val sdnn: Float,
    val samples: Int
)

@Serializable
data class EdaAggregate(
    val meanScl: Float,
    val peakScl: Float
)

@Serializable
data class PpgAggregate(
    val greenMean: Float,
    val greenStd: Float,
    val irMean: Float,
    val irStd: Float,
    val redMean: Float,
    val redStd: Float,
    val samples: Int
)

@Serializable
data class AccelAggregate(
    val magnitudeMean: Float,
    val magnitudeStd: Float,
    val stillness: Float, // 0-1, higher = more still
    val samples: Int
)

@Serializable
data class LocationAggregate(
    val latitude: Float,
    val longitude: Float,
    val accuracy: Float
)

/**
 * 30-second aggregated batch message.
 * Reduces bandwidth from ~3-5 MB/day (1Hz) to ~200 KB/day.
 */
@Serializable
data class BatchMessage(
    val type: String = "batch",
    val windowMs: Long = 30000,
    val hr: HrAggregate? = null,
    val hrv: HrvAggregate? = null,
    val eda: EdaAggregate? = null,
    val ppg: PpgAggregate? = null,
    val accel: AccelAggregate? = null,
    val location: LocationAggregate? = null,
    val timestamp: Long
) {
    fun toJson(): String = json.encodeToString(this)
}
