#!/usr/bin/env node
/**
 * Prints the Device ID and Device key of every device in your eWeLink account, so ZENAA GAMEHUB can
 * control SONOFF R4 devices (BASICR4, MINIR4…) locally over the LAN. Run it once; nothing is saved.
 *
 * You need your own free App ID + App Secret from https://dev.ewelink.cc (see docs/08-sonoff-basicr4.md).
 *
 *   node server/scripts/ewelink-keys.mjs --appid <APP_ID> --secret <APP_SECRET> --login <email or phone> --country +233
 *
 * The password is asked for interactively (not stored, not shown). Requires Node.js 18+.
 */
import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(/\s*--/)
    .filter(Boolean)
    .map((p) => {
      const [k, ...v] = p.trim().split(/\s+/);
      return [k, v.join(' ')];
    }),
);
const { appid, secret, login } = args;
const country = args.country || '+233';
if (!appid || !secret || !login) {
  console.error('Usage: node server/scripts/ewelink-keys.mjs --appid <APP_ID> --secret <APP_SECRET> --login <email or phone> [--country +233] [--region eu|as|us|cn]');
  process.exit(1);
}

const HOSTS = { eu: 'https://eu-apia.coolkit.cc', as: 'https://as-apia.coolkit.cc', us: 'https://us-apia.coolkit.cc', cn: 'https://cn-apia.coolkit.cn' };

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(q) ? s : '');
    rl.question(q, (a) => {
      rl.close();
      process.stdout.write('\n');
      resolve(a);
    });
  });
}

const password = args.password || (await askHidden('eWeLink password: '));
const payload = { password, countryCode: country };
if (login.includes('@')) payload.email = login;
else payload.phoneNumber = login.startsWith('+') ? login : `${country}${login.replace(/^0/, '')}`;
const body = JSON.stringify(payload);
const sign = createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(body, 'utf8')).digest('base64');

async function loginAt(region) {
  const r = await fetch(`${HOSTS[region]}/v2/user/login`, {
    method: 'POST',
    headers: { Authorization: `Sign ${sign}`, 'Content-Type': 'application/json', 'X-CK-Appid': appid },
    body,
  });
  return { region, json: await r.json() };
}

let { region, json } = await loginAt(args.region && HOSTS[args.region] ? args.region : 'eu');
if (json.error === 10004 && json.data?.region && HOSTS[json.data.region]) ({ region, json } = await loginAt(json.data.region));
if (json.error !== 0) {
  console.error(`\nLogin failed: error ${json.error} ${json.msg ?? ''}`);
  if (json.error === 407) console.error('Your App ID is not allowed to use password login. See docs/08-sonoff-basicr4.md → "If the key tool fails".');
  if (json.error === 10001 || json.error === 401) console.error('Check the App ID / App Secret.');
  if (json.error === 10014 || json.error === 10011) console.error('Check the email/phone, country code and password.');
  process.exit(2);
}
const token = json.data.at;
const r = await fetch(`${HOSTS[region]}/v2/device/thing?num=0`, { headers: { Authorization: `Bearer ${token}`, 'X-CK-Appid': appid } });
const list = await r.json();
if (list.error !== 0) {
  console.error(`Could not list devices: error ${list.error} ${list.msg ?? ''}`);
  process.exit(3);
}
const devices = (list.data?.thingList ?? []).map((t) => t.itemData).filter((d) => d?.deviceid);
if (!devices.length) {
  console.log('No devices found in this eWeLink account.');
  process.exit(0);
}
console.log(`\nRegion: ${region}. Copy the Device ID and Device key into ZENAA → Stations → ✏️ → Smart plug.\n`);
for (const d of devices) {
  console.log(`• ${d.name ?? '(no name)'}  [${d.productModel ?? d.extra?.model ?? 'model ?'}${d.online === false ? ', offline' : ''}]`);
  console.log(`    Device ID : ${d.deviceid}`);
  console.log(`    Device key: ${d.devicekey ?? '(not provided by eWeLink for this device)'}\n`);
}
console.log('Keep these keys private: anyone on your Wi-Fi with a key can switch that device.');
