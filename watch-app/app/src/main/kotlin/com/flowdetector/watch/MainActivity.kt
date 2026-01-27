package com.flowdetector.watch

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import androidx.wear.input.RemoteInputIntentHelper
import android.app.RemoteInput as AndroidRemoteInput

private const val TAG = "[WatchUI]"
private const val PREFS_NAME = "flow_prefs"
private const val KEY_SERVER_IP = "server_ip"
private const val DEFAULT_IP = "192.168.1.100"
private const val IP_INPUT_KEY = "ip_address"

class MainActivity : ComponentActivity() {

    private var sensorService: SensorService? = null
    private var isBound = false
    private val _service = mutableStateOf<SensorService?>(null)

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            sensorService = (binder as SensorService.LocalBinder).getService()
            _service.value = sensorService
            isBound = true
            Log.i(TAG, "Bound to SensorService")
        }

        override fun onServiceDisconnected(name: ComponentName) {
            sensorService = null
            _service.value = null
            isBound = false
            Log.i(TAG, "Unbound from SensorService")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Intent(this, SensorService::class.java).also { intent ->
            bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        setContent {
            val service by _service
            FlowDetectorWatchApp(
                service = service,
                prefs = prefs,
                onStartStreaming = { url ->
                    // Pass URL via intent extra so onStartCommand can self-start
                    // streaming even if the service binding hasn't completed yet.
                    val intent = Intent(this, SensorService::class.java).apply {
                        putExtra(SensorService.EXTRA_SERVER_URL, url)
                    }
                    startForegroundService(intent)
                },
                onStopStreaming = {
                    sensorService?.stopStreaming()
                }
            )
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isBound) {
            unbindService(connection)
            isBound = false
        }
    }
}

@Composable
fun FlowDetectorWatchApp(
    service: SensorService?,
    prefs: SharedPreferences,
    onStartStreaming: (String) -> Unit,
    onStopStreaming: () -> Unit
) {
    var ipAddress by remember {
        mutableStateOf(prefs.getString(KEY_SERVER_IP, DEFAULT_IP) ?: DEFAULT_IP)
    }
    var permissionGranted by remember { mutableStateOf(false) }
    var permissionError by remember { mutableStateOf<String?>(null) }

    // Observe service state
    val heartRate by service?.heartRate?.collectAsState() ?: remember { mutableStateOf(null) }
    val isConnected by service?.isConnected?.collectAsState() ?: remember { mutableStateOf(false) }
    val isStreaming by service?.isStreaming?.collectAsState() ?: remember { mutableStateOf(false) }
    val error by service?.connectionError?.collectAsState() ?: remember { mutableStateOf(null) }

    // Permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        permissionGranted = granted
        if (!granted) {
            permissionError = "Sensor permission denied"
        }
    }

    // Request permission on first composition
    LaunchedEffect(Unit) {
        val permission = if (Build.VERSION.SDK_INT >= 36) {
            "com.samsung.android.hardware.sensormanager.permission.READ_ADDITIONAL_HEALTH_DATA"
        } else {
            Manifest.permission.BODY_SENSORS
        }
        permissionLauncher.launch(permission)
    }

    // IP input result handler
    val ipInputLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val results = RemoteInputIntentHelper.getResults(result.data ?: return@rememberLauncherForActivityResult)
        val newIp = results?.getCharSequence(IP_INPUT_KEY)?.toString()
        if (!newIp.isNullOrBlank()) {
            ipAddress = newIp
            prefs.edit().putString(KEY_SERVER_IP, newIp).apply()
        }
    }

    MaterialTheme {
        Scaffold(
            timeText = { TimeText() }
        ) {
            ScalingLazyColumn(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                // Heart rate display
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = heartRate?.toString() ?: "--",
                            style = MaterialTheme.typography.display1,
                            color = Color.Red
                        )
                        Text(
                            text = "BPM",
                            style = MaterialTheme.typography.caption1,
                            color = Color.Gray
                        )
                    }
                }

                // Connection status
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .background(
                                    if (isConnected) Color.Green else Color.Red,
                                    CircleShape
                                )
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (isConnected) "Connected" else "Disconnected",
                            style = MaterialTheme.typography.caption2,
                            color = if (isConnected) Color.Green else Color.Gray
                        )
                    }
                }

                // Server IP
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = ipAddress,
                        style = MaterialTheme.typography.caption2,
                        color = Color.Gray,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    CompactChip(
                        onClick = {
                            val remoteInputs = listOf(
                                AndroidRemoteInput.Builder(IP_INPUT_KEY)
                                    .setLabel("Server IP")
                                    .build()
                            )
                            val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
                            RemoteInputIntentHelper.putRemoteInputsExtra(intent, remoteInputs)
                            ipInputLauncher.launch(intent)
                        },
                        label = { Text("Edit IP") }
                    )
                }

                // Connect / Disconnect button
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = {
                            if (isConnected || isStreaming) {
                                onStopStreaming()
                            } else {
                                if (!isValidIp(ipAddress)) {
                                    // Handled via error state
                                    return@Button
                                }
                                prefs.edit().putString(KEY_SERVER_IP, ipAddress).apply()
                                val url = "ws://$ipAddress:8765/watch"
                                onStartStreaming(url)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(0.8f)
                    ) {
                        Text(if (isConnected || isStreaming) "Disconnect" else "Connect")
                    }
                }

                // Error display
                val displayError = permissionError ?: error
                if (displayError != null) {
                    item {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = displayError,
                            color = if (displayError == "EDA sensor not available") Color.Yellow else Color.Red,
                            style = MaterialTheme.typography.caption2,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 16.dp)
                        )
                    }
                }
            }
        }
    }
}

private fun isValidIp(ip: String): Boolean {
    val parts = ip.split(".")
    if (parts.size != 4) return false
    return parts.all { part ->
        val num = part.toIntOrNull() ?: return false
        num in 0..255
    }
}

