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
