import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
const require = createRequire(import.meta.url);
const systemInformation = (() => { try {
    return require('systeminformation');
}
catch {
    return null;
} })();
function exec(command, args, timeout = 8000) {
    return new Promise((resolve) => {
        execFile(command, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), code: error ? (typeof error.code === 'number' ? Number(error.code) : 1) : 0 }));
    });
}
async function siCall(method, fallback) {
    try {
        return systemInformation?.[method] ? await systemInformation[method]() : fallback;
    }
    catch {
        return fallback;
    }
}
async function getWindowsNativeTelemetry() {
    if (process.platform !== 'win32')
        return { available: false, temperature: null, battery: null, cpu: null, memory: null, gpu: [], wifi: [], bluetooth: [] };
    const script = `$ErrorActionPreference='SilentlyContinue'; $battery=Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus,DesignVoltage,FullChargeCapacity,DesignCapacity,Voltage,Current; $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1 Name,LoadPercentage,NumberOfCores,MaxClockSpeed; $os=Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 TotalVisibleMemorySize,FreePhysicalMemory; $gpu=Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,AdapterRAM,CurrentRefreshRate,VideoModeDescription; $adapters=Get-NetAdapter | Where-Object { $_.Name -match 'Wi-Fi|Wireless|WLAN|802.11' -or $_.InterfaceDescription -match 'Wi-Fi|Wireless|WLAN|802.11' } | Select-Object Name,InterfaceDescription,Status,MacAddress,LinkSpeed; $bt=Get-PnpDevice -Class Bluetooth | Select-Object FriendlyName,InstanceId,Status; $temp=Get-CimInstance -Namespace root/wmi -Class MSAcpi_ThermalZoneTemperature | Select-Object -First 1 CurrentTemperature; [pscustomobject]@{battery=$battery;cpu=$cpu;memory=$os;gpu=@($gpu);wifi=@($adapters);bluetooth=@($bt);temperature=$temp} | ConvertTo-Json -Depth 4 -Compress`;
    const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], 12000);
    if (result.code !== 0 || !result.stdout.trim())
        return { available: false, temperature: null, battery: null, cpu: null, memory: null, gpu: [], wifi: [], bluetooth: [] };
    try {
        const parsed = JSON.parse(result.stdout.trim());
        const battery = parsed.battery || null;
        const cpu = parsed.cpu || null;
        const memory = parsed.memory || null;
        const temperature = parsed.temperature || null;
        return { available: true, temperature: temperature?.CurrentTemperature ? { mainCelsius: Number(temperature.CurrentTemperature) / 10 - 273.15 } : null, battery: battery ? { available: true, percent: Number(battery.EstimatedChargeRemaining ?? -1), status: Number(battery.BatteryStatus ?? 0), voltage: Number(battery.Voltage || battery.DesignVoltage || 0) / 1000, currentCapacity: Number(battery.FullChargeCapacity || 0), designedCapacity: Number(battery.DesignCapacity || 0), currentMilliAmps: Number(battery.Current || 0), charging: [6, 7, 8, 9].includes(Number(battery.BatteryStatus)), acConnected: [2, 6, 7, 8, 9].includes(Number(battery.BatteryStatus)) } : null, cpu: cpu ? { model: cpu.Name, usagePercent: Number(cpu.LoadPercentage ?? -1), cores: Number(cpu.NumberOfCores ?? 0), speedGHz: Number(cpu.MaxClockSpeed || 0) / 1000 } : null, memory: memory ? { totalBytes: Number(memory.TotalVisibleMemorySize || 0) * 1024, availableBytes: Number(memory.FreePhysicalMemory || 0) * 1024 } : null, gpu: Array.isArray(parsed.gpu) ? parsed.gpu.map((item) => ({ model: item.Name, vendor: item.AdapterCompatibility, vramBytes: Number(item.AdapterRAM || 0), refreshRate: item.CurrentRefreshRate, mode: item.VideoModeDescription })) : [], wifi: Array.isArray(parsed.wifi) ? parsed.wifi.map((item) => ({ iface: item.Name, description: item.InterfaceDescription, mac: item.MacAddress, operstate: item.Status, speed: item.LinkSpeed })) : [], bluetooth: Array.isArray(parsed.bluetooth) ? parsed.bluetooth.map((item) => ({ name: item.FriendlyName, id: item.InstanceId, status: item.Status, connected: item.Status === 'OK' })) : [] };
    }
    catch {
        return { available: false, temperature: null, battery: null, cpu: null, memory: null, gpu: [], wifi: [], bluetooth: [] };
    }
}
export async function getCoreDiagnostics() {
    const [loadValue, memValue, tempValue, disks, batteryValue, osValue, cpuValue, graphicsValue, wifiValue, bluetoothValue, nativeValue] = await Promise.all([
        siCall('currentLoad', { currentLoad: null, cpus: [] }),
        siCall('mem', { total: 0, used: 0, free: 0, available: 0 }),
        siCall('cpuTemperature', { main: null, cores: [], max: null }),
        siCall('fsSize', []),
        siCall('battery', { hasBattery: false, percent: -1, isCharging: false, voltage: -1, current: -1, designedCapacity: -1, currentCapacity: -1, acConnected: false, timeRemaining: -1 }),
        siCall('osInfo', {}),
        siCall('cpu', {}),
        siCall('graphics', { controllers: [], displays: [] }),
        siCall('wifiNetworks', []),
        siCall('bluetoothDevices', []),
        getWindowsNativeTelemetry()
    ]);
    const resolvedBattery = batteryValue.hasBattery ? batteryValue : nativeValue.battery || batteryValue;
    const resolvedCpu = cpuValue.brand || cpuValue.speed ? cpuValue : nativeValue.cpu || cpuValue;
    const resolvedMemory = memValue.total > 0 ? memValue : nativeValue.memory || { total: os.totalmem(), used: os.totalmem() - os.freemem(), available: os.freemem() };
    const resolvedGpu = Array.isArray(graphicsValue.controllers) && graphicsValue.controllers.length ? graphicsValue.controllers : nativeValue.gpu;
    const resolvedWifi = Array.isArray(wifiValue) && wifiValue.length ? wifiValue : nativeValue.wifi;
    const resolvedBluetooth = Array.isArray(bluetoothValue) && bluetoothValue.length ? bluetoothValue : nativeValue.bluetooth;
    const telemetrySource = nativeValue.available && (!systemInformation || !Array.isArray(graphicsValue.controllers) || !graphicsValue.controllers.length || !Array.isArray(wifiValue) || !wifiValue.length || !Array.isArray(bluetoothValue) || !bluetoothValue.length || !batteryValue.hasBattery) ? 'WINDOWS_NATIVE_FALLBACK' : 'SYSTEMINFORMATION';
    return {
        timestamp: new Date().toISOString(),
        dependency: { systeminformation: Boolean(systemInformation), windowsNativeProbe: Boolean(nativeValue.available) },
        telemetrySource,
        access: { administratorRequired: false, note: 'Standard Windows telemetry does not require elevation. Location may require Windows privacy permission; hardware fields use systeminformation and a PowerShell WMI fallback.' },
        device: { hostname: os.hostname(), platform: process.platform, arch: process.arch, os: osValue.distro || osValue.platform || 'Unknown Windows host', release: osValue.release || os.release(), kernel: osValue.kernel || os.type(), uptimeSeconds: os.uptime() },
        cpu: { usagePercent: Number(Number(Number.isFinite(loadValue.currentLoad) ? loadValue.currentLoad : resolvedCpu.usagePercent || 0).toFixed(1)), cores: loadValue.cpus?.length || resolvedCpu.cores || os.cpus().length, model: resolvedCpu.brand || resolvedCpu.model || os.cpus()[0]?.model || 'Unknown CPU', speedGHz: resolvedCpu.speed || resolvedCpu.speedGHz || null },
        memory: { totalBytes: resolvedMemory.total, usedBytes: resolvedMemory.used ?? Math.max(resolvedMemory.total - (resolvedMemory.available || 0), 0), availableBytes: resolvedMemory.available, usagePercent: Number((((resolvedMemory.used ?? Math.max(resolvedMemory.total - (resolvedMemory.available || 0), 0)) / Math.max(resolvedMemory.total, 1)) * 100).toFixed(1)) },
        temperature: { mainCelsius: typeof tempValue.main === 'number' ? Number(tempValue.main.toFixed(1)) : nativeValue.temperature?.mainCelsius != null ? Number(nativeValue.temperature.mainCelsius.toFixed(1)) : null, maxCelsius: typeof tempValue.max === 'number' ? Number(tempValue.max.toFixed(1)) : nativeValue.temperature?.mainCelsius != null ? Number(nativeValue.temperature.mainCelsius.toFixed(1)) : null, cores: tempValue.cores || [] },
        battery: { available: Boolean(resolvedBattery.hasBattery || resolvedBattery.available), percent: resolvedBattery.hasBattery || resolvedBattery.available ? resolvedBattery.percent : null, charging: resolvedBattery.hasBattery || resolvedBattery.available ? (resolvedBattery.isCharging ?? resolvedBattery.charging) : null, acConnected: resolvedBattery.hasBattery || resolvedBattery.available ? resolvedBattery.acConnected ?? resolvedBattery.acConnected : null, powerSource: resolvedBattery.hasBattery || resolvedBattery.available ? ((resolvedBattery.acConnected || resolvedBattery.isCharging || resolvedBattery.charging) ? 'AC' : 'BATTERY') : null, voltage: resolvedBattery.voltage > 0 ? resolvedBattery.voltage : null, currentMilliAmps: resolvedBattery.current > 0 ? resolvedBattery.current : resolvedBattery.currentMilliAmps > 0 ? resolvedBattery.currentMilliAmps : null, currentCapacity: resolvedBattery.currentCapacity > 0 ? resolvedBattery.currentCapacity : null, designedCapacity: resolvedBattery.designedCapacity > 0 ? resolvedBattery.designedCapacity : null, healthPercent: resolvedBattery.designedCapacity > 0 && resolvedBattery.currentCapacity > 0 ? Number(((resolvedBattery.currentCapacity / resolvedBattery.designedCapacity) * 100).toFixed(1)) : null, timeRemainingMinutes: resolvedBattery.timeRemaining > 0 ? resolvedBattery.timeRemaining : null },
        gpu: (Array.isArray(resolvedGpu) ? resolvedGpu : []).map((item) => ({ model: item.model, vendor: item.vendor, vramBytes: item.vram ?? item.vramBytes, utilizationPercent: item.utilizationGpu, refreshRate: item.refreshRate, mode: item.mode })),
        wifi: (Array.isArray(resolvedWifi) ? resolvedWifi : []).map((item) => ({ ssid: item.ssid, bssid: item.bssid, channel: item.channel, signalLevel: item.signalLevel, frequency: item.frequency, security: item.security, iface: item.iface, description: item.description, mac: item.mac, operstate: item.operstate, speed: item.speed })),
        bluetooth: (Array.isArray(resolvedBluetooth) ? resolvedBluetooth : []).map((item) => ({ name: item.name, mac: item.mac, connected: item.connected ?? item.status === 'OK', batteryLevel: item.batteryLevel, id: item.id })),
        storage: (Array.isArray(disks) ? disks : []).map((item) => ({ mount: item.mount, sizeBytes: item.size, usedBytes: item.used, usagePercent: item.size ? Number(((item.used / item.size) * 100).toFixed(1)) : 0 }))
    };
}
export async function getNetworkStatus() {
    const [netsRaw, netStatsRaw, connsRaw, external, latency] = await Promise.all([
        siCall('networkInterfaces', []), siCall('networkStats', []), siCall('networkConnections', []),
        exec(process.platform === 'win32' ? 'powershell.exe' : 'sh', process.platform === 'win32' ? ['-NoProfile', '-Command', '(Invoke-RestMethod -Uri https://api.ipify.org)'] : ['-c', 'curl -s --max-time 3 https://api.ipify.org'], 5000),
        siCall('inetLatency', null)
    ]);
    const nets = Array.isArray(netsRaw) ? netsRaw : netsRaw ? [netsRaw] : [];
    const netStats = Array.isArray(netStatsRaw) ? netStatsRaw : netStatsRaw ? [netStatsRaw] : [];
    const conns = Array.isArray(connsRaw) ? connsRaw : connsRaw ? [connsRaw] : [];
    return { timestamp: new Date().toISOString(), dependency: { systeminformation: Boolean(systemInformation) }, hostname: os.hostname(), latencyMs: typeof latency === 'number' && latency >= 0 ? latency : null, interfaces: nets.map((item) => ({ iface: item.iface, type: item.type, ip4: item.ip4, ip6: item.ip6, mac: item.mac, speedMbps: item.speed, dhcp: item.dhcp, internal: item.internal, operstate: item.operstate })), throughput: netStats.map((item) => ({ iface: item.iface, rxBytes: item.rx_bytes, txBytes: item.tx_bytes, rxSec: item.rx_sec, txSec: item.tx_sec })), connections: conns.slice(0, 80).map((item) => ({ protocol: item.protocol, localAddress: item.localAddress, localPort: item.localPort, peerAddress: item.peerAddress, peerPort: item.peerPort, state: item.state })), publicIp: external.code === 0 ? external.stdout.trim() : null };
}
export async function getDeviceIdentity() {
    const [system, baseboard, graphics, bios] = await Promise.all([siCall('system', {}), siCall('baseboard', {}), siCall('graphics', { controllers: [], displays: [] }), siCall('bios', {})]);
    return { dependency: { systeminformation: Boolean(systemInformation) }, system, baseboard, graphics, bios, hostname: os.hostname() };
}
function parseArgs(input) { return input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) || []; }
export async function runAdb(commandLine) { const args = parseArgs(commandLine); if (!args.length)
    return { ok: false, stdout: '', stderr: 'Enter an ADB command, for example: devices -l', code: 2 }; const result = await exec('adb', args, 30000); return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr, code: result.code }; }
export async function getAdbStatus() { const result = await exec('adb', ['devices', '-l'], 8000); return { installed: result.code !== 1 || !/not recognized|not found/i.test(result.stderr), available: result.code === 0, output: result.stdout || result.stderr, devices: result.stdout.split(/\r?\n/).filter((line) => line && !line.startsWith('List of devices')).map((line) => line.trim()) }; }
export async function currentLocation() {
    try {
        const response = await fetch('https://ipapi.co/json/', { headers: { 'User-Agent': 'JARVIS/1.0 (location service)' } });
        if (!response.ok)
            throw new Error(`Location service returned ${response.status}`);
        const data = await response.json();
        return { source: 'ip-geolocation', approximate: true, latitude: data.latitude ?? null, longitude: data.longitude ?? null, city: data.city ?? null, region: data.region ?? null, country: data.country_name ?? null, timezone: data.timezone ?? null, ip: data.ip ?? null };
    }
    catch (error) {
        return { source: 'unavailable', approximate: true, error: error instanceof Error ? error.message : String(error), latitude: null, longitude: null };
    }
}
export async function searchLocation(query) { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'JARVIS/1.0 location search' } }); if (!response.ok)
    throw new Error(`Map search returned ${response.status}`); return await response.json(); }
export async function getWeather(latitude, longitude) { if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    return { available: false, error: 'WEATHER_COORDINATES_UNAVAILABLE' }; const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m&timezone=auto`; try {
    const response = await fetch(url, { headers: { 'User-Agent': 'JARVIS/1.0 weather panel' } });
    if (!response.ok)
        throw new Error(`Weather service returned ${response.status}`);
    const data = await response.json();
    return { available: true, source: 'Open-Meteo', latitude, longitude, timezone: data.timezone, timestamp: data.current?.time, current: data.current || {} };
}
catch (error) {
    return { available: false, source: 'Open-Meteo', error: error instanceof Error ? error.message : String(error) };
} }
export async function getSystemLogs() { if (process.platform === 'win32') {
    const result = await exec('powershell.exe', ['-NoProfile', '-Command', "Get-WinEvent -LogName Application -MaxEvents 30 | ForEach-Object { '{0} // {1} // {2}' -f $_.TimeCreated.ToString('s'), $_.LevelDisplayName, ($_.ProviderName + ': ' + $_.Message -replace '[\\r\\n]+',' ') }"], 12000);
    return { source: 'Windows Application Event Log', lines: (result.stdout || result.stderr).split(/\r?\n/).filter(Boolean) };
} return { source: 'JARVIS local runtime', lines: [`${new Date().toISOString()} // Development host: ${os.platform()} ${os.release()}`, `${new Date().toISOString()} // Windows Event Log unavailable on this host`] }; }
