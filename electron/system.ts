import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const require = createRequire(import.meta.url);
const systemInformation: Record<string, (...args: any[]) => Promise<any>> | null = (() => {
  try {
    return require('systeminformation') as Record<string, (...args: any[]) => Promise<any>>;
  } catch {
    return null;
  }
})();

function exec(command: string, args: string[], timeout = 8000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        code: error ? (typeof (error as NodeJS.ErrnoException).code === 'number' ? Number((error as NodeJS.ErrnoException).code) : 1) : 0,
      })
    );
  });
}

async function siCall<T>(method: string, fallback: T): Promise<T> {
  try {
    return systemInformation?.[method] ? ((await systemInformation[method]()) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Cached hardware and network data to eliminate redundant system calls
let cachedStaticHardware: {
  osInfo?: any;
  cpu?: any;
  graphics?: any;
  storage?: any[];
  storageCollectedAt?: number;
} = {};

let cachedDeviceIdentity: any = null;
let cachedPublicIp: { ip: string | null; collectedAt: number } = { ip: null, collectedAt: 0 };
let cachedConnections: { list: any[]; collectedAt: number } = { list: [], collectedAt: 0 };
let cachedLocation: { data: any; collectedAt: number } = { data: null, collectedAt: 0 };
let cachedLogs: { lines: string[]; collectedAt: number } = { lines: [], collectedAt: 0 };

async function getPublicIp(): Promise<string | null> {
  const now = Date.now();
  if (cachedPublicIp.ip && now - cachedPublicIp.collectedAt < 900000) {
    return cachedPublicIp.ip;
  }
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const text = (await res.text()).trim();
      if (text) {
        cachedPublicIp = { ip: text, collectedAt: now };
        return text;
      }
    }
  } catch {
    /* fallback to previous cached value */
  }
  return cachedPublicIp.ip;
}

async function loadStaticHardware() {
  if (cachedStaticHardware.osInfo && cachedStaticHardware.cpu && cachedStaticHardware.graphics) {
    return cachedStaticHardware;
  }
  const [osInfo, cpu, graphics] = await Promise.all([
    siCall<any>('osInfo', {}),
    siCall<any>('cpu', {}),
    siCall<any>('graphics', { controllers: [], displays: [] }),
  ]);
  cachedStaticHardware.osInfo = osInfo;
  cachedStaticHardware.cpu = cpu;
  cachedStaticHardware.graphics = graphics;
  return cachedStaticHardware;
}

export async function getCoreDiagnostics() {
  const now = Date.now();

  // 1. Ensure static hardware (OS, CPU brand, GPU) is cached
  const staticHw = await loadStaticHardware();

  // 2. Storage size is cached for 5 minutes
  if (!cachedStaticHardware.storage || !cachedStaticHardware.storageCollectedAt || now - cachedStaticHardware.storageCollectedAt > 300000) {
    cachedStaticHardware.storage = await siCall('fsSize', [] as any[]);
    cachedStaticHardware.storageCollectedAt = now;
  }

  // 3. Fast dynamic measurements
  const [loadValue, tempValue, batteryValue, netInterfaces] = await Promise.all([
    siCall('currentLoad', { currentLoad: null, cpus: [] }),
    siCall<any>('cpuTemperature', { main: null, cores: [], max: null }),
    siCall('battery', {
      hasBattery: false,
      percent: -1,
      isCharging: false,
      voltage: -1,
      current: -1,
      designedCapacity: -1,
      currentCapacity: -1,
      acConnected: false,
      timeRemaining: -1,
    }),
    siCall('networkInterfaces', [] as any[]),
  ]);

  // Fast memory calculation using Node's instant native os module
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = Number(((usedMem / Math.max(totalMem, 1)) * 100).toFixed(1));

  // Extract connected Wi-Fi info from network interfaces without active radio scanning
  const nets = Array.isArray(netInterfaces) ? netInterfaces : [];
  const wifiNets = nets
    .filter((n: any) => /wi-?fi|wireless|wlan|802\.11/i.test(n.iface || n.type || ''))
    .map((item: any) => ({
      ssid: item.ssid || item.iface,
      bssid: item.mac,
      channel: null,
      signalLevel: null,
      frequency: null,
      security: null,
      iface: item.iface,
      description: item.type,
      mac: item.mac,
      operstate: item.operstate,
      speed: item.speed,
    }));

  const osVal = staticHw.osInfo || {};
  const cpuVal = staticHw.cpu || {};
  const gpuVal = staticHw.graphics?.controllers || [];
  const disks = cachedStaticHardware.storage || [];

  return {
    timestamp: new Date().toISOString(),
    dependency: { systeminformation: Boolean(systemInformation), windowsNativeProbe: true },
    telemetrySource: 'HARDWARE_ACCELERATED',
    access: { administratorRequired: false, note: 'Standard Windows telemetry active with cached hardware profiles.' },
    device: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      os: osVal.distro || osVal.platform || 'Windows host',
      release: osVal.release || os.release(),
      kernel: osVal.kernel || os.type(),
      uptimeSeconds: os.uptime(),
    },
    cpu: {
      usagePercent: Number(
        Number(Number.isFinite(loadValue.currentLoad) ? loadValue.currentLoad : 0).toFixed(1)
      ),
      cores: loadValue.cpus?.length || cpuVal.cores || os.cpus().length,
      model: cpuVal.brand || cpuVal.model || os.cpus()[0]?.model || 'Processor',
      speedGHz: cpuVal.speed || null,
    },
    memory: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      availableBytes: freeMem,
      usagePercent: memUsagePercent,
    },
    temperature: {
      mainCelsius: typeof tempValue.main === 'number' ? Number(tempValue.main.toFixed(1)) : null,
      maxCelsius: typeof tempValue.max === 'number' ? Number(tempValue.max.toFixed(1)) : null,
      cores: tempValue.cores || [],
    },
    battery: {
      available: Boolean(batteryValue.hasBattery),
      percent: batteryValue.hasBattery ? batteryValue.percent : null,
      charging: batteryValue.hasBattery ? batteryValue.isCharging : null,
      acConnected: batteryValue.hasBattery ? batteryValue.acConnected : null,
      powerSource: batteryValue.hasBattery ? (batteryValue.acConnected || batteryValue.isCharging ? 'AC' : 'BATTERY') : null,
      voltage: batteryValue.voltage > 0 ? batteryValue.voltage : null,
      currentMilliAmps: batteryValue.current > 0 ? batteryValue.current : null,
      currentCapacity: batteryValue.currentCapacity > 0 ? batteryValue.currentCapacity : null,
      designedCapacity: batteryValue.designedCapacity > 0 ? batteryValue.designedCapacity : null,
      healthPercent:
        batteryValue.designedCapacity > 0 && batteryValue.currentCapacity > 0
          ? Number(((batteryValue.currentCapacity / batteryValue.designedCapacity) * 100).toFixed(1))
          : null,
      timeRemainingMinutes: batteryValue.timeRemaining > 0 ? batteryValue.timeRemaining : null,
    },
    gpu: gpuVal.map((item: any) => ({
      model: item.model,
      vendor: item.vendor,
      vramBytes: item.vram ?? item.vramBytes,
      utilizationPercent: item.utilizationGpu,
      refreshRate: item.refreshRate,
      mode: item.mode,
    })),
    wifi: wifiNets,
    bluetooth: [],
    storage: disks.map((item: any) => ({
      mount: item.mount,
      sizeBytes: item.size,
      usedBytes: item.used,
      usagePercent: item.size ? Number(((item.used / item.size) * 100).toFixed(1)) : 0,
    })),
  };
}

export async function getNetworkStatus() {
  const now = Date.now();
  const [netsRaw, netStatsRaw, publicIp, latency] = await Promise.all([
    siCall('networkInterfaces', [] as any[]),
    siCall('networkStats', [] as any[]),
    getPublicIp(),
    siCall('inetLatency', null as number | null),
  ]);

  // Throttle network socket connections scan to once per 60 seconds (netstat is CPU intensive)
  if (!cachedConnections.list.length || now - cachedConnections.collectedAt > 60000) {
    siCall('networkConnections', [] as any[]).then((conns) => {
      if (Array.isArray(conns)) {
        cachedConnections = { list: conns.slice(0, 40), collectedAt: Date.now() };
      }
    }).catch(() => undefined);
  }

  const nets = Array.isArray(netsRaw) ? netsRaw : netsRaw ? [netsRaw] : [];
  const netStats = Array.isArray(netStatsRaw) ? netStatsRaw : netStatsRaw ? [netStatsRaw] : [];

  return {
    timestamp: new Date().toISOString(),
    dependency: { systeminformation: Boolean(systemInformation) },
    hostname: os.hostname(),
    latencyMs: typeof latency === 'number' && latency >= 0 ? latency : null,
    interfaces: nets.map((item: any) => ({
      iface: item.iface,
      type: item.type,
      ip4: item.ip4,
      ip6: item.ip6,
      mac: item.mac,
      speedMbps: item.speed,
      dhcp: item.dhcp,
      internal: item.internal,
      operstate: item.operstate,
    })),
    throughput: netStats.map((item: any) => ({
      iface: item.iface,
      rxBytes: item.rx_bytes,
      txBytes: item.tx_bytes,
      rxSec: item.rx_sec,
      txSec: item.tx_sec,
    })),
    connections: (cachedConnections.list || []).map((item: any) => ({
      protocol: item.protocol,
      localAddress: item.localAddress,
      localPort: item.localPort,
      peerAddress: item.peerAddress,
      peerPort: item.peerPort,
      state: item.state,
    })),
    publicIp,
  };
}

export async function getDeviceIdentity() {
  if (cachedDeviceIdentity) return cachedDeviceIdentity;
  const [system, baseboard, graphics, bios] = await Promise.all([
    siCall('system', {}),
    siCall('baseboard', {}),
    siCall('graphics', { controllers: [], displays: [] }),
    siCall('bios', {}),
  ]);
  cachedDeviceIdentity = {
    dependency: { systeminformation: Boolean(systemInformation) },
    system,
    baseboard,
    graphics,
    bios,
    hostname: os.hostname(),
  };
  return cachedDeviceIdentity;
}

function parseArgs(input: string) {
  return input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) || [];
}

export async function runAdb(commandLine: string) {
  const args = parseArgs(commandLine);
  if (!args.length) return { ok: false, stdout: '', stderr: 'Enter an ADB command, for example: devices -l', code: 2 };
  const result = await exec('adb', args, 10000);
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr, code: result.code };
}

export async function getAdbStatus() {
  const result = await exec('adb', ['devices', '-l'], 4000);
  return {
    installed: result.code !== 1 || !/not recognized|not found/i.test(result.stderr),
    available: result.code === 0,
    output: result.stdout || result.stderr,
    devices: result.stdout
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('List of devices'))
      .map((line) => line.trim()),
  };
}

export async function currentLocation() {
  const now = Date.now();
  // Cache location for 30 minutes to prevent API quota drain and network delays
  if (cachedLocation.data && now - cachedLocation.collectedAt < 1800000) {
    return cachedLocation.data;
  }
  try {
    const response = await fetch('https://ipapi.co/json/', {
      headers: { 'User-Agent': 'JARVIS/1.0 (location service)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Location service returned ${response.status}`);
    const data = (await response.json()) as {
      latitude?: number;
      longitude?: number;
      city?: string;
      region?: string;
      country_name?: string;
      timezone?: string;
      ip?: string;
    };
    const resolved = {
      source: 'ip-geolocation',
      approximate: true,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      city: data.city ?? null,
      region: data.region ?? null,
      country: data.country_name ?? null,
      timezone: data.timezone ?? null,
      ip: data.ip ?? null,
    };
    cachedLocation = { data: resolved, collectedAt: now };
    return resolved;
  } catch (error) {
    if (cachedLocation.data) return cachedLocation.data;
    return {
      source: 'unavailable',
      approximate: true,
      error: error instanceof Error ? error.message : String(error),
      latitude: null,
      longitude: null,
    };
  }
}

export async function searchLocation(query: string) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': 'JARVIS/1.0 location search' }, signal: AbortSignal.timeout(6000) }
  );
  if (!response.ok) throw new Error(`Map search returned ${response.status}`);
  return (await response.json()) as Array<{ display_name: string; lat: string; lon: string; type?: string; address?: Record<string, string> }>;
}

export async function getWeather(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { available: false, error: 'WEATHER_COORDINATES_UNAVAILABLE' };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m&timezone=auto`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'JARVIS/1.0 weather panel' }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Weather service returned ${response.status}`);
    const data = (await response.json()) as any;
    return {
      available: true,
      source: 'Open-Meteo',
      latitude,
      longitude,
      timezone: data.timezone,
      timestamp: data.current?.time,
      current: data.current || {},
    };
  } catch (error) {
    return { available: false, source: 'Open-Meteo', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getSystemLogs() {
  const now = Date.now();
  if (cachedLogs.lines.length && now - cachedLogs.collectedAt < 60000) {
    return { source: 'Windows Application Event Log (cached)', lines: cachedLogs.lines };
  }

  if (process.platform === 'win32') {
    try {
      const result = await exec(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ErrorActionPreference='SilentlyContinue'; Get-EventLog -LogName Application -Newest 20 | ForEach-Object { '{0} // {1} // {2}' -f $_.TimeGenerated.ToString('s'), $_.EntryType, ($_.Source + ': ' + $_.Message -replace '[\\r\\n]+',' ') }",
        ],
        6000
      );
      if (result.code === 0 && result.stdout.trim()) {
        const lines = result.stdout.split(/\r?\n/).filter(Boolean);
        cachedLogs = { lines, collectedAt: now };
        return { source: 'Windows Application Event Log', lines };
      }
    } catch {
      /* fallback below */
    }
  }

  const fallback = [
    `${new Date().toISOString()} // JARVIS Core telemetry pipeline active`,
    `${new Date().toISOString()} // Host platform: ${os.platform()} ${os.release()} (${os.arch()})`,
    `${new Date().toISOString()} // Host system: ${os.hostname()} // Node ${process.version}`,
    `${new Date().toISOString()} // System memory: ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(1)} GB total`,
  ];
  cachedLogs = { lines: fallback, collectedAt: now };
  return { source: 'JARVIS local runtime', lines: fallback };
}
