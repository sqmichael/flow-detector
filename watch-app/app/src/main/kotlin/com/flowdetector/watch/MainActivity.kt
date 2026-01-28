package com.flowdetector.watch

import android.Manifest
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import android.provider.Settings
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import androidx.wear.input.RemoteInputIntentHelper
import android.app.RemoteInput as AndroidRemoteInput

private const val TAG = "[WatchUI]"
private const val PREFS_NAME = "flow_prefs"
private const val KEY_SERVER_IP = "server_ip"
private const val DEFAULT_IP = "10.0.2.2"
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
    
    // Check initial permission state
    val context = LocalContext.current
    val activity = context as ComponentActivity
    
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        permissionGranted = granted
    }

    LaunchedEffect(Unit) {
        val permissionCheck = androidx.core.content.ContextCompat.checkSelfPermission(
            context, Manifest.permission.BODY_SENSORS
        )
        if (permissionCheck == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permissionGranted = true
        } else {
            permissionLauncher.launch(Manifest.permission.BODY_SENSORS)
        }
    }

    MaterialTheme {
        if (permissionGranted) {
            MainContent(
                service = service,
                ipAddress = ipAddress,
                onIpAddressChanged = { newIp ->
                    ipAddress = newIp
                    prefs.edit().putString(KEY_SERVER_IP, newIp).apply()
                },
                onStartStreaming = onStartStreaming,
                onStopStreaming = onStopStreaming
            )
        } else {
            PermissionRationale(
                onRequestPermission = {
                    permissionLauncher.launch(Manifest.permission.BODY_SENSORS)
                },
                onOpenSettings = {
                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.fromParts("package", context.packageName, null)
                    }
                    context.startActivity(intent)
                }
            )
        }
    }
}

@Composable
fun PermissionRationale(
    onRequestPermission: () -> Unit,
    onOpenSettings: () -> Unit
) {
    Scaffold(
        timeText = { TimeText() }
    ) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            item {
                Text(
                    text = "Sensors Needed",
                    style = MaterialTheme.typography.title2,
                    textAlign = TextAlign.Center
                )
            }
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "This app requires body sensors access to detect flow states.",
                    style = MaterialTheme.typography.body2,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Chip(
                    onClick = onRequestPermission,
                    label = { Text("Grant Permission") },
                    colors = ChipDefaults.primaryChipColors()
                )
            }
            item {
                Spacer(modifier = Modifier.height(8.dp))
                CompactChip(
                    onClick = onOpenSettings,
                    label = { Text("Open Settings") },
                    colors = ChipDefaults.secondaryChipColors()
                )
            }
        }
    }
}

@Composable
fun MainContent(
    service: SensorService?,
    ipAddress: String,
    onIpAddressChanged: (String) -> Unit,
    onStartStreaming: (String) -> Unit,
    onStopStreaming: () -> Unit
) {
    // Observe service state
    val heartRate by service?.heartRate?.collectAsState() ?: remember { mutableStateOf(null) }
    val isConnected by service?.isConnected?.collectAsState() ?: remember { mutableStateOf(false) }
    val isStreaming by service?.isStreaming?.collectAsState() ?: remember { mutableStateOf(false) }
    val error by service?.connectionError?.collectAsState() ?: remember { mutableStateOf(null) }

    var isConnecting by remember { mutableStateOf(false) }
    var ipError by remember { mutableStateOf<String?>(null) }
    
    // Reset connecting state when connected or error occurs
    LaunchedEffect(isConnected, error) {
        if (isConnected || error != null) {
            isConnecting = false
        }
    }

    val listState = rememberScalingLazyListState()

    // IP input result handler
    val ipInputLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val results = result.data?.let { RemoteInput.getResultsFromIntent(it) }
        val newIp = results?.getCharSequence(IP_INPUT_KEY)?.toString()
        if (!newIp.isNullOrBlank()) {
            onIpAddressChanged(newIp)
            ipError = null // Clear error on new input
        }
    }

    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) }
    ) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            state = listState
        ) {
            // Header / Status
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .background(
                                when {
                                    isConnected -> Color.Green
                                    isConnecting -> Color.Yellow
                                    else -> Color.Red
                                },
                                CircleShape
                            )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = when {
                            isConnected -> "Connected"
                            isConnecting -> "Connecting..."
                            else -> "Disconnected"
                        },
                        style = MaterialTheme.typography.caption2,
                        color = if (isConnected) Color.Green else Color.Gray
                    )
                }
            }

            // Heart Rate
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = heartRate?.toString() ?: "--",
                        style = MaterialTheme.typography.display1,
                        color = if (heartRate != null) MaterialTheme.colors.primary else Color.Gray
                    )
                    Text(
                        text = "BPM",
                        style = MaterialTheme.typography.caption1,
                        color = Color.Gray
                    )
                }
            }

            // Server IP Section
            item {
                Spacer(modifier = Modifier.height(12.dp))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "Server IP:",
                        style = MaterialTheme.typography.caption2,
                        color = Color.LightGray
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    
                    Chip(
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
                        label = { 
                            Text(
                                text = ipAddress,
                                style = MaterialTheme.typography.body2,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth()
                            ) 
                        },
                        colors = ChipDefaults.secondaryChipColors(),
                        modifier = Modifier.height(40.dp)
                    )
                    
                    if (ipError != null) {
                        Text(
                            text = ipError!!,
                            style = MaterialTheme.typography.caption2,
                            color = MaterialTheme.colors.error,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                }
            }

            // Connect Button
            item {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = {
                        if (isConnected || isStreaming) {
                            onStopStreaming()
                        } else {
                            if (!isValidIp(ipAddress)) {
                                ipError = "Invalid IP Format"
                                return@Button
                            }
                            ipError = null
                            isConnecting = true
                            val url = "ws://$ipAddress:8765/watch"
                            onStartStreaming(url)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(0.9f),
                    enabled = !isConnecting || isConnected // Allow disconnect if connected
                ) {
                    if (isConnecting && !isConnected) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp,
                            indicatorColor = MaterialTheme.colors.onPrimary
                        )
                    } else {
                        Text(if (isConnected || isStreaming) "Disconnect" else "Connect")
                    }
                }
            }

            // General Errors
            if (error != null) {
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = error ?: "",
                        color = if (error?.contains("EDA") == true) Color.Yellow else MaterialTheme.colors.error,
                        style = MaterialTheme.typography.caption2,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 16.dp)
                    )
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
