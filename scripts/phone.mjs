// Starts the dev server on the local network (HTTPS, needed for the camera) and
// prints a QR code so a phone on the same Wi-Fi can open it. Also writes .qr/phone.png.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

const PORT = 5173;
const ip = Object.values(networkInterfaces())
  .flat()
  .find((n) => n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254'))?.address;

if (!ip) {
  console.error('No network address found — is Wi-Fi on?');
  process.exit(1);
}

const url = `https://${ip}:${PORT}/`;
mkdirSync('.qr', { recursive: true });
await QRCode.toFile('.qr/phone.png', url, { width: 512, margin: 2 });
console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
console.log(`  Phone URL: ${url}`);
console.log('  Same Wi-Fi as this computer. Self-signed certificate: accept the browser warning once');
console.log('  (iOS: "Details anzeigen" → "diese Website besuchen"; Android: "Erweitert" → "Weiter").\n');

spawn('npx', ['vite', '--host', '--port', String(PORT), '--strictPort'], { stdio: 'inherit' });
