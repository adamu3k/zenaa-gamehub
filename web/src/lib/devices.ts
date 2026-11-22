/**
 * Smart-plug / relay catalogue: which ZENAA plug type to use for each device.
 * "Best" is the most reliable local option; "also" lists alternatives. Always check the exact model and
 * hardware revision printed on the device — manufacturers change chips between batches.
 */
export type DriverKey =
  | 'sonoff_lan'
  | 'sonoff_diy'
  | 'ewelink_cloud'
  | 'tasmota'
  | 'shelly_gen1'
  | 'shelly_gen2'
  | 'esphome'
  | 'home_assistant'
  | 'generic_http';

export interface DeviceInfo {
  brand: string;
  model: string;
  kind: string;
  best: DriverKey;
  also: DriverKey[];
  note: string;
  channels?: number;
}

export const DRIVER_LABEL: Record<DriverKey | 'none', string> = {
  none: 'None — no automatic power',
  sonoff_lan: 'SONOFF eWeLink LAN (R4 & stock firmware)',
  sonoff_diy: 'SONOFF DIY mode (R3 / MINI)',
  ewelink_cloud: 'eWeLink cloud (any SONOFF, by device ID)',
  tasmota: 'Tasmota / OpenBeken firmware',
  shelly_gen1: 'Shelly Gen 1',
  shelly_gen2: 'Shelly Plus / Pro / Gen 3',
  esphome: 'ESPHome device',
  home_assistant: 'Home Assistant (Kasa, Tapo, Tuya, Zigbee, TVs…)',
  generic_http: 'Custom HTTP (any ON / OFF web address)',
};

export const DRIVER_HINT: Record<DriverKey | 'none', string> = {
  none: 'Connect a smart plug to switch the TV/monitor on when a session starts and off when it ends.',
  sonoff_lan: 'Stock eWeLink firmware with "LAN Control" on. Needs IP + device ID; the key is filled in automatically if you imported your eWeLink account (Integrations).',
  sonoff_diy: 'Older SONOFF switched into DIY mode — only IP and device ID, no key. Not for R4 models.',
  ewelink_cloud: 'Works with every eWeLink device using only its device ID, through the internet. Import your eWeLink account first (Integrations). Slower and needs internet.',
  tasmota: 'Most reliable: any ESP8266/ESP32 plug flashed with Tasmota (or a BK7231 plug with OpenBeken). Use Find to scan for it.',
  shelly_gen1: 'Shelly 1 / Plug S (first generation).',
  shelly_gen2: 'Shelly Plus / Pro / Gen 3 devices — keep device authentication off on your LAN.',
  esphome: 'ESPHome with `web_server:` in the YAML. Enter the switch ID (e.g. relay).',
  home_assistant: 'Anything Home Assistant controls: TP-Link Kasa/Tapo, Tuya/Smart Life, Meross, Zigbee plugs, smart TVs. Needs a long-lived token.',
  generic_http: 'Your own board or service: ZENAA calls the ON address to switch on and the OFF address to switch off.',
};

export const DEVICES: DeviceInfo[] = [
  // ── SONOFF (ITEAD) ──
  { brand: 'SONOFF', model: 'BASICR4', kind: 'Inline relay 10 A', best: 'tasmota', also: ['sonoff_lan', 'ewelink_cloud'], note: 'ESP32-C3. Flash Tasmota over USB-serial (docs/09) or keep stock firmware with LAN Control (docs/08).' },
  { brand: 'SONOFF', model: 'BASICR3', kind: 'Inline relay 10 A', best: 'sonoff_diy', also: ['tasmota', 'ewelink_cloud'], note: 'Supports DIY mode — IP + device ID only, no key, no flashing.' },
  { brand: 'SONOFF', model: 'BASICR2 / BASIC', kind: 'Inline relay 10 A', best: 'tasmota', also: ['ewelink_cloud'], note: 'ESP8266 — classic Tasmota device (serial flash).' },
  { brand: 'SONOFF', model: 'RFR3', kind: 'Inline relay + 433 MHz', best: 'sonoff_diy', also: ['tasmota', 'ewelink_cloud'], note: 'DIY mode supported.' },
  { brand: 'SONOFF', model: 'MINIR2 / MINI', kind: 'Mini relay 10 A', best: 'sonoff_diy', also: ['tasmota', 'ewelink_cloud'], note: 'DIY mode supported (jumper on old MINI).' },
  { brand: 'SONOFF', model: 'MINIR3', kind: 'Mini relay 16 A', best: 'sonoff_diy', also: ['tasmota', 'ewelink_cloud'], note: 'DIY mode supported.' },
  { brand: 'SONOFF', model: 'MINIR4', kind: 'Mini relay 10 A', best: 'sonoff_lan', also: ['ewelink_cloud', 'tasmota'], note: 'ESP32. Some batches have secure boot and cannot be flashed — use LAN Control or cloud.' },
  { brand: 'SONOFF', model: 'MINIR4M (Matter)', kind: 'Mini relay, Matter', best: 'home_assistant', also: ['ewelink_cloud'], note: 'Add to Home Assistant with Matter, then use the HA entity.' },
  { brand: 'SONOFF', model: 'D1 Dimmer', kind: 'Dimmer', best: 'sonoff_diy', also: ['ewelink_cloud'], note: 'DIY mode supported; dimmer used as on/off.' },
  { brand: 'SONOFF', model: 'S26R2 / S26 (plug)', kind: 'Wall plug', best: 'tasmota', also: ['sonoff_lan', 'ewelink_cloud'], note: 'ESP8285 inside — Tasmota by serial; otherwise LAN Control or cloud.' },
  { brand: 'SONOFF', model: 'S31 / S31 Lite (US plug)', kind: 'Wall plug, power meter', best: 'tasmota', also: ['sonoff_lan', 'ewelink_cloud'], note: 'ESP8266 — popular Tasmota plug.' },
  { brand: 'SONOFF', model: 'S40 / S60 (plug)', kind: 'Wall plug', best: 'sonoff_lan', also: ['ewelink_cloud'], note: 'Use LAN Control; check the chip before trying to flash.' },
  { brand: 'SONOFF', model: 'POWR2', kind: 'Inline relay, power meter', best: 'tasmota', also: ['sonoff_lan', 'ewelink_cloud'], note: 'ESP8266.' },
  { brand: 'SONOFF', model: 'POWR3 / POWR316 / POWR320D', kind: 'Inline relay 16–20 A, power meter', best: 'tasmota', also: ['sonoff_lan', 'ewelink_cloud'], note: 'ESP32 — Tasmota supported.' },
  { brand: 'SONOFF', model: 'DUALR3', kind: '2-channel relay', best: 'tasmota', also: ['sonoff_lan', 'ewelink_cloud'], channels: 2, note: 'Two stations from one device: channel 1 and 2 (Tasmota) or outlet 0 and 1 (eWeLink).' },
  { brand: 'SONOFF', model: '4CHR3 / 4CHPROR3', kind: '4-channel relay', best: 'tasmota', also: ['sonoff_lan', 'ewelink_cloud'], channels: 4, note: 'Four TVs from one box. Channel 1–4 (Tasmota) or outlet 0–3 (eWeLink).' },
  { brand: 'SONOFF', model: 'TH10 / TH16 / THR316 / THR320', kind: 'Relay + sensor', best: 'tasmota', also: ['sonoff_lan', 'ewelink_cloud'], note: 'Works as a normal relay.' },
  { brand: 'SONOFF', model: 'M5 / T-series / TX wall switches', kind: 'Wall light switch', best: 'sonoff_lan', also: ['ewelink_cloud'], note: 'Only if the TV socket is wired through it — usually not for TVs.' },
  { brand: 'SONOFF', model: 'ZBMINI / S26R2ZB / Zigbee plugs', kind: 'Zigbee', best: 'home_assistant', also: [], note: 'Needs a Zigbee coordinator (e.g. SONOFF ZBDongle-E) in Home Assistant / Zigbee2MQTT.' },
  // ── Shelly ──
  { brand: 'Shelly', model: 'Plus Plug S / Plug S Gen3 / Plus Plug UK/IT/US', kind: 'Wall plug', best: 'shelly_gen2', also: [], note: 'Excellent local API — no account needed.' },
  { brand: 'Shelly', model: 'Plus 1 / Plus 1PM / 1 Gen3 / 1PM Gen3 / Mini Gen3', kind: 'Inline relay', best: 'shelly_gen2', also: [], note: 'Install behind the TV socket (electrician).' },
  { brand: 'Shelly', model: 'Plus 2PM / Pro 2 / Pro 4PM', kind: 'Multi-channel relay', best: 'shelly_gen2', also: [], channels: 4, note: 'Channel 0, 1, 2… one per station.' },
  { brand: 'Shelly', model: 'Shelly 1 / 1PM / Plug S (Gen 1)', kind: 'Relay / plug', best: 'shelly_gen1', also: [], note: 'First generation API.' },
  // ── Pre-flashed open firmware ──
  { brand: 'Athom', model: 'Smart Plug V2/V3 (Tasmota or ESPHome edition)', kind: 'Wall plug', best: 'tasmota', also: ['esphome'], note: 'Ships with open firmware — plug in, join Wi-Fi, use Find.' },
  { brand: 'NOUS', model: 'A1T', kind: 'Wall plug (EU)', best: 'tasmota', also: [], note: 'Ships with Tasmota.' },
  { brand: 'Tuya / Smart Life', model: 'Generic plugs (Gosund, Teckin, Nedis, Lidl, AliExpress…)', kind: 'Wall plug', best: 'home_assistant', also: ['tasmota'], note: 'Through Home Assistant (Tuya / LocalTuya). BK7231 chips can be flashed with OpenBeken, ESP chips with Tasmota — then use the Tasmota type.' },
  // ── Other brands through Home Assistant ──
  { brand: 'TP-Link', model: 'Kasa HS100 / HS103 / HS110 / KP115 / EP10', kind: 'Wall plug', best: 'home_assistant', also: [], note: 'Home Assistant "TP-Link Smart Home" integration (local).' },
  { brand: 'TP-Link', model: 'Tapo P100 / P105 / P110 / P115', kind: 'Wall plug', best: 'home_assistant', also: [], note: 'Home Assistant "TP-Link Smart Home"/Tapo integration.' },
  { brand: 'Meross', model: 'MSS110 / MSS210 / MSS310', kind: 'Wall plug', best: 'home_assistant', also: [], note: 'Home Assistant "Meross LAN" custom integration.' },
  { brand: 'Broadlink', model: 'SP4 / SP mini', kind: 'Wall plug', best: 'home_assistant', also: [], note: 'Home Assistant Broadlink integration (local).' },
  { brand: 'Xiaomi / Aqara', model: 'Mi Smart Plug / Aqara Smart Plug', kind: 'Wi-Fi or Zigbee plug', best: 'home_assistant', also: [], note: 'Home Assistant Xiaomi Miio / Aqara / Zigbee.' },
  { brand: 'IKEA / Philips Hue', model: 'TRÅDFRI / INSPELNING / Hue smart plug', kind: 'Zigbee plug', best: 'home_assistant', also: [], note: 'Zigbee via Home Assistant.' },
  { brand: 'Samsung / LG / Sony / Hisense', model: 'Smart TVs (screen off without a plug)', kind: 'TV', best: 'home_assistant', also: [], note: 'Home Assistant media_player entity. Switching ON often needs Wake-on-LAN. For Android/Google TVs see the ZENAA TV app.' },
  // ── DIY ──
  { brand: 'DIY', model: 'ESP8266 / ESP32 + relay module (Wemos D1 mini, NodeMCU, ESP-01 relay)', kind: 'Home-made relay', best: 'tasmota', also: ['esphome', 'generic_http'], note: 'Flash Tasmota (web installer) or ESPHome. Use a relay rated for mains and an enclosure; let an electrician wire mains.' },
  { brand: 'DIY', model: 'Arduino / ESP with your own sketch', kind: 'Home-made relay', best: 'generic_http', also: [], note: 'Expose /relay/on, /relay/off and /relay/status — see the sample sketch in docs/11.' },
  { brand: 'DIY', model: 'Raspberry Pi + relay HAT', kind: 'Home-made relay', best: 'generic_http', also: [], note: 'Small web server (Python/Node) with ON/OFF URLs.' },
  { brand: 'Any', model: 'Node-RED, Hubitat, openHAB, IFTTT/webhooks', kind: 'Automation hub', best: 'generic_http', also: ['home_assistant'], note: 'Call a webhook for ON and OFF.' },
];
