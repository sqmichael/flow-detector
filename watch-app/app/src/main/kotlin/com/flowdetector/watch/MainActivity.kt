package com.flowdetector.watch

import android.Manifest
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
import androidx.core.content.ContextCompat
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*

private const val TAG = "[WatchUI]"
private const val PREFS_NAME = "flow_prefs"
private const val KEY_SERVER_IP = "server_ip"
private const val DEFAULT_IP = "10.0.2.2"

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
    var sensorPermissionGranted by remember { mutableStateOf(false) }
    var showIpInput by remember { mutableStateOf(false) }

    val context = LocalContext.current

    val sensorPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        sensorPermissionGranted = granted
    }

    // Check sensor permission on launch
    LaunchedEffect(Unit) {
        val sensorCheck = ContextCompat.checkSelfPermission(context, Manifest.permission.BODY_SENSORS)
        sensorPermissionGranted = (sensorCheck == android.content.pm.PackageManager.PERMISSION_GRANTED)
    }

    MaterialTheme {
        if (!sensorPermissionGranted) {
            PermissionRationale(
                onRequestPermission = { sensorPermissionLauncher.launch(Manifest.permission.BODY_SENSORS) },
                onOpenSettings = {
                    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.fromParts("package", context.packageName, null)
                    }
                    context.startActivity(intent)
                }
            )
        }
        else if (showIpInput) {
            IpInputScreen(
                initialIp = ipAddress,
                onConfirm = { newIp ->
                    if (isValidIp(newIp)) {
                        ipAddress = newIp
                        prefs.edit().putString(KEY_SERVER_IP, newIp).apply()
                        showIpInput = false
                    }
                },
                onCancel = { showIpInput = false }
            )
        }
        else {
            MainContent(
                service = service,
                ipAddress = ipAddress,
                onEditIp = { showIpInput = true },
                onStartStreaming = onStartStreaming,
                onStopStreaming = onStopStreaming
            )
        }
    }
}

@Composable
fun PermissionRationale(onRequestPermission: () -> Unit, onOpenSettings: () -> Unit) {
    Scaffold(timeText = { TimeText() }) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            item { Text("Sensors Needed", style = MaterialTheme.typography.title2, textAlign = TextAlign.Center) }
            item { Spacer(modifier = Modifier.height(8.dp)) }
            item { Text("This app requires body sensors access for continuous data streaming.", style = MaterialTheme.typography.body2, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 16.dp)) }
            item { Spacer(modifier = Modifier.height(16.dp)) }
            item { Chip(onClick = onRequestPermission, label = { Text("Grant Permission") }, colors = ChipDefaults.primaryChipColors()) }
            item { Spacer(modifier = Modifier.height(8.dp)) }
            item { CompactChip(onClick = onOpenSettings, label = { Text("Open App Settings") }, colors = ChipDefaults.secondaryChipColors()) }
        }
    }
}

@Composable
fun IpInputScreen(initialIp: String, onConfirm: (String) -> Unit, onCancel: () -> Unit) {
    var currentIp by remember { mutableStateOf(initialIp) }

    Scaffold(timeText = { TimeText() }, vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) }) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
            contentPadding = PaddingValues(top = 24.dp, bottom = 24.dp)
        ) {
            item { Text(text = currentIp.ifBlank { "Enter IP" }, style = MaterialTheme.typography.title3, modifier = Modifier.padding(bottom = 8.dp)) }
            item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { NumberButton("1") { currentIp += "1" }; NumberButton("2") { currentIp += "2" }; NumberButton("3") { currentIp += "3" } } }
            item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { NumberButton("4") { currentIp += "4" }; NumberButton("5") { currentIp += "5" }; NumberButton("6") { currentIp += "6" } } }
            item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { NumberButton("7") { currentIp += "7" }; NumberButton("8") { currentIp += "8" }; NumberButton("9") { currentIp += "9" } } }
            item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { NumberButton(".") { if (!currentIp.endsWith(".")) currentIp += "." }; NumberButton("0") { currentIp += "0" }; Button(onClick = { if (currentIp.isNotEmpty()) currentIp = currentIp.dropLast(1) }, modifier = Modifier.size(48.dp)) { Text("<-") } } }
            item { Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) { Button(onClick = onCancel, colors = ButtonDefaults.secondaryButtonColors(), modifier = Modifier.size(48.dp)) { Text("X") }; Spacer(Modifier.width(16.dp)); Button(onClick = { onConfirm(currentIp) }, enabled = isValidIp(currentIp), modifier = Modifier.size(48.dp)) { Text("OK") } } }
        }
    }
}

@Composable
fun NumberButton(number: String, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = Modifier.size(48.dp)) { Text(number, style = MaterialTheme.typography.title3) }
}

@Composable
fun MainContent(
    service: SensorService?,
    ipAddress: String,
    onEditIp: () -> Unit,
    onStartStreaming: (String) -> Unit,
    onStopStreaming: () -> Unit
) {
    val heartRate by service?.heartRate?.collectAsState() ?: remember { mutableStateOf(null) }
    val currentScl by service?.currentScl?.collectAsState() ?: remember { mutableStateOf(null) }
    val isConnected by service?.isConnected?.collectAsState() ?: remember { mutableStateOf(false) }
    val isStreaming by service?.isStreaming?.collectAsState() ?: remember { mutableStateOf(false) }
    val error by service?.connectionError?.collectAsState() ?: remember { mutableStateOf(null) }
    var isConnecting by remember { mutableStateOf(false) }
    var ipError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(isConnected, error) { if (isConnected || error != null) isConnecting = false }

    val listState = rememberScalingLazyListState()

    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = listState) }) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            state = listState
        ) {
            item { Row(verticalAlignment = Alignment.CenterVertically) { Box(modifier = Modifier.size(10.dp).background(if (isConnected) Color.Green else Color.Red, CircleShape)); Spacer(modifier = Modifier.width(6.dp)); Text(if (isConnected) "Connected" else "Disconnected", style = MaterialTheme.typography.caption2, color = if (isConnected) Color.Green else Color.Gray) } }
            item { Spacer(modifier = Modifier.height(8.dp)) }
            item { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(text = heartRate?.toString() ?: "--", style = MaterialTheme.typography.display1, color = Color.Red); Text(text = "BPM", style = MaterialTheme.typography.caption1, color = Color.Gray) } }
            item { Spacer(modifier = Modifier.height(2.dp)) }
            item { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(text = currentScl?.let { String.format("%.2f", it) } ?: "--", style = MaterialTheme.typography.title2, color = Color(0xFF4FC3F7)); Text(text = "SCL (\u00B5S)", style = MaterialTheme.typography.caption1, color = Color.Gray) } }
            item { Spacer(modifier = Modifier.height(4.dp)) }
            item { Text(text = ipAddress, style = MaterialTheme.typography.caption2, color = Color.Gray, textAlign = TextAlign.Center); Spacer(modifier = Modifier.height(4.dp)); CompactChip(onClick = onEditIp, label = { Text("Edit IP") }) }
            item { Spacer(modifier = Modifier.height(8.dp)) }
            item { 
                Button(
                    onClick = { 
                        if (isConnected || isStreaming) {
                            onStopStreaming()
                        } else {
                            if (!isValidIp(ipAddress)) {
                                ipError = "Invalid IP"
                                return@Button
                            }
                            ipError = null
                            isConnecting = true
                            onStartStreaming("ws://$ipAddress:8765/watch")
                        }
                    }, 
                    modifier = Modifier.fillMaxWidth(0.8f), 
                    enabled = !isConnecting
                ) { 
                    Text(if (isConnected || isStreaming) "Disconnect" else "Connect") 
                }
            }
            val displayError = ipError ?: error
            if (displayError != null) { item { Spacer(modifier = Modifier.height(4.dp)); Text(text = displayError, color = Color.Red, style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 16.dp)) } }
        }
    }
}

private fun isValidIp(ip: String): Boolean {
    if (ip.endsWith(".")) return false
    val parts = ip.split('.')
    if (parts.size != 4) return false
    return parts.all { part -> if (part.isEmpty()) return@all false; part.toIntOrNull()?.let { it in 0..255 } ?: false }
}
