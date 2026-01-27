package com.flowdetector.watch

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.long
import kotlinx.serialization.json.float
import org.junit.Assert.*
import org.junit.Test

/**
 * Verifies that serialized JSON matches the WatchMessage protocol
 * defined in src/lib/biometrics/types.ts.
 *
 * The browser parser (use-watch-stream.ts) expects exact field names
 * and types. These tests ensure byte-for-byte compatibility.
 */
class MessageSerializerTest {

    private val json = Json { encodeDefaults = true }

    @Test
    fun `handshake message has correct fields`() {
        val msg = HandshakeMessage(
            deviceName = "Galaxy Watch8",
            sensors = listOf("heart_rate", "eda"),
            timestamp = 1706334120000
        )
        val parsed = json.decodeFromString<JsonObject>(msg.toJson())

        assertEquals("handshake", parsed["type"]?.jsonPrimitive?.content)
        assertEquals(1, parsed["protocolVersion"]?.jsonPrimitive?.int)
        assertEquals("Galaxy Watch8", parsed["deviceName"]?.jsonPrimitive?.content)
        assertEquals(2, parsed["sensors"]?.jsonArray?.size)
        assertEquals("heart_rate", parsed["sensors"]?.jsonArray?.get(0)?.jsonPrimitive?.content)
        assertEquals("eda", parsed["sensors"]?.jsonArray?.get(1)?.jsonPrimitive?.content)
        assertEquals(1706334120000, parsed["timestamp"]?.jsonPrimitive?.long)
    }

    @Test
    fun `heart rate message with IBI has correct fields`() {
        val msg = HeartRateMessage(
            bpm = 72,
            ibi = 833,
            quality = 100,
            timestamp = 1706334121000
        )
        val parsed = json.decodeFromString<JsonObject>(msg.toJson())

        assertEquals("hr", parsed["type"]?.jsonPrimitive?.content)
        assertEquals(72, parsed["bpm"]?.jsonPrimitive?.int)
        assertEquals(833, parsed["ibi"]?.jsonPrimitive?.int)
        assertEquals(100, parsed["quality"]?.jsonPrimitive?.int)
        assertEquals(1706334121000, parsed["timestamp"]?.jsonPrimitive?.long)
    }

    @Test
    fun `heart rate message with null IBI serializes as null not omitted`() {
        val msg = HeartRateMessage(
            bpm = 72,
            ibi = null,
            quality = 100,
            timestamp = 1706334121000
        )
        val jsonStr = msg.toJson()
        val parsed = json.decodeFromString<JsonObject>(jsonStr)

        // ibi must be present in JSON as null, not omitted
        assertTrue("ibi field must be present", parsed.containsKey("ibi"))
        assertEquals(JsonNull, parsed["ibi"])

        // Also verify the raw string contains "ibi":null
        assertTrue("JSON must contain \"ibi\":null", jsonStr.contains("\"ibi\":null"))
    }

    @Test
    fun `eda message has correct fields`() {
        val msg = EdaMessage(
            scl = 2.5f,
            timestamp = 1706334121000
        )
        val parsed = json.decodeFromString<JsonObject>(msg.toJson())

        assertEquals("eda", parsed["type"]?.jsonPrimitive?.content)
        assertEquals(2.5f, parsed["scl"]?.jsonPrimitive?.float)
        assertEquals(1706334121000, parsed["timestamp"]?.jsonPrimitive?.long)
    }

    @Test
    fun `handshake with heart_rate only sensor list`() {
        val msg = HandshakeMessage(
            deviceName = "Galaxy Watch7",
            sensors = listOf("heart_rate"),
            timestamp = 1706334120000
        )
        val parsed = json.decodeFromString<JsonObject>(msg.toJson())

        assertEquals(1, parsed["sensors"]?.jsonArray?.size)
        assertEquals("heart_rate", parsed["sensors"]?.jsonArray?.get(0)?.jsonPrimitive?.content)
    }
}
