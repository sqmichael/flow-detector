package com.flowdetector.watch

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class HandshakeMessage(
    val deviceName: String,
    val sensors: List<String>,
    val timestamp: Long
) {
    fun toJson(): String = Json.encodeToString(this)
}

@Serializable
data class HeartRateMessage(
    val bpm: Int,
    val ibi: Int?,
    val quality: Int,
    val timestamp: Long
) {
    fun toJson(): String = Json.encodeToString(this)
}

@Serializable
data class EdaMessage(
    val scl: Float,
    val timestamp: Long
) {
    fun toJson(): String = Json.encodeToString(this)
}
