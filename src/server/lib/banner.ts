import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

export interface DetectedLanEndpoint {
  iface: string;
  ip: string;
  url: string;
}

function isPrivateLanIpv4(ip: string): boolean {
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function scoreInterface(iface: string, ip: string): number {
  const lower = iface.toLowerCase();
  let score = 0;
  if (lower === 'en0' || lower === 'wlan0' || lower === 'wi-fi') score += 100;
  else if (lower.startsWith('en') || lower.startsWith('eth') || lower.startsWith('wl')) score += 80;
  else if (lower.startsWith('bridge')) score += 40;
  else if (lower.startsWith('utun') || lower.startsWith('awdl') || lower.startsWith('docker')) {
    score -= 60;
  }
  if (ip.startsWith('192.168.')) score += 30;
  else if (ip.startsWith('172.20.10.')) score += 28; // iOS Personal Hotspot
  else if (isPrivateLanIpv4(ip)) score += 15;
  return score;
}

export function detectLanEndpoints(port: number): DetectedLanEndpoint[] {
  const nets = networkInterfaces();
  const found: DetectedLanEndpoint[] = [];
  const seenIps = new Set<string>();

  for (const [iface, entries] of Object.entries(nets)) {
    if (!entries) continue;
    const lower = iface.toLowerCase();
    if (lower.startsWith('lo') || lower.startsWith('awdl') || lower.startsWith('llw')) {
      continue;
    }

    for (const net of entries) {
      const isV4 = net.family === 'IPv4' || (net.family as unknown) === 4;
      if (!isV4 || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue; // Ignore self-assigned APIPA
      if (seenIps.has(net.address)) continue;

      // Skip VPN utun interfaces unless they carry a standard private LAN subnet
      if (lower.startsWith('utun') && !isPrivateLanIpv4(net.address)) continue;

      seenIps.add(net.address);
      found.push({
        iface,
        ip: net.address,
        url: `http://${net.address}:${port}`,
      });
    }
  }

  return found.sort(
    (a, b) => scoreInterface(b.iface, b.ip) - scoreInterface(a.iface, a.ip)
  );
}

export function printOpenVolleyBanner(options: {
  port: number;
  hostname: string;
  isProduction: boolean;
}) {
  const { port, hostname, isProduction } = options;
  const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

  const c = {
    reset: useColor ? '\x1b[0m' : '',
    bold: useColor ? '\x1b[1m' : '',
    dim: useColor ? '\x1b[2m' : '',
    amber: useColor ? '\x1b[38;5;214m' : '',
    gold: useColor ? '\x1b[38;5;220m' : '',
    emerald: useColor ? '\x1b[38;5;48m' : '',
    cyan: useColor ? '\x1b[38;5;117m' : '',
    slate: useColor ? '\x1b[38;5;246m' : '',
    red: useColor ? '\x1b[38;5;203m' : '',
  };

  const lanEndpoints =
    hostname === '127.0.0.1' || hostname === 'localhost'
      ? []
      : detectLanEndpoints(port);
  const hasDist = existsSync('./dist/client/index.html');

  const logoLines = [
    `${c.gold}${c.bold}   ____                   _    __      ____           ${c.reset}`,
    `${c.gold}${c.bold}  / __ \\____  ___  ____  | |  / /___  / / /__  __  __ ${c.reset}`,
    `${c.amber}${c.bold} / / / / __ \\/ _ \\/ __ \\ | | / / __ \\/ / / _ \\/ / / / ${c.reset}`,
    `${c.amber}${c.bold}/ /_/ / /_/ /  __/ / / / | |/ / /_/ / / /  __/ /_/ /  ${c.reset}`,
    `${c.amber}${c.bold}\\____/ .___/\\___/_/ /_/  |___/\\____/_/_/\\___/\\__, /   ${c.reset}`,
    `${c.gold}${c.bold}    /_/                                     /____/    ${c.reset}`,
  ];

  const divider = `${c.slate}  ──────────────────────────────────────────────────────────${c.reset}`;
  const modeBadge = isProduction
    ? `${c.emerald}${c.bold}PRODUCTION${c.reset} ${c.slate}(Single-Server Bun + Hono)${c.reset}`
    : `${c.amber}${c.bold}DEVELOPMENT${c.reset} ${c.slate}(Watch API + Vite Proxy)${c.reset}`;

  const lines: string[] = [
    '',
    ...logoLines,
    `  ${c.bold}OpenVolley v0.1.0${c.reset} ${c.slate}• Live Score, Bracket, Arena TV & Broadcast Studio${c.reset}`,
    divider,
    `  ${c.slate}Mode       :${c.reset} ${modeBadge}`,
    `  ${c.slate}Local (PC) :${c.reset} ${c.cyan}${c.bold}http://localhost:${port}${c.reset}`,
  ];

  if (lanEndpoints.length > 0) {
    lanEndpoints.forEach((ep, idx) => {
      const label = idx === 0 ? 'Mobile/LAN :' : '            ';
      lines.push(
        `  ${c.slate}${label}${c.reset} ${c.emerald}${c.bold}${ep.url}${c.reset} ${c.dim}(${ep.iface})${c.reset}`
      );
    });
  } else {
    lines.push(
      `  ${c.slate}Mobile/LAN :${c.reset} ${c.dim}Tidak ada IP Wi-Fi/LAN aktif terdeteksi (bind ${hostname}:${port})${c.reset}`
    );
  }

  lines.push(
    divider,
    `  ${c.slate}Rute Cepat :${c.reset} ${c.bold}/${c.reset} ${c.dim}Portal${c.reset}  •  ${c.bold}/tv${c.reset} ${c.dim}Layar Arena${c.reset}  •  ${c.bold}/back-office${c.reset} ${c.dim}Panitia & Media${c.reset}`
  );

  if (isProduction && !hasDist) {
    lines.push(
      `  ${c.red}${c.bold}Perhatian  :${c.reset} ${c.red}Folder dist/client belum tersedia. Jalankan "bun run build" terlebih dahulu.${c.reset}`
    );
  }

  lines.push(divider, '');
  console.log(lines.join('\n'));
}
