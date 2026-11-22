import { describe, expect, it } from 'vitest';
import { discoverPlugs } from '../src/services/power.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fake: typeof fetch = async (input) => {
  const u = new URL(String(input));
  if (u.hostname === '10.0.5.20' && u.pathname === '/cm')
    return json({ Status: { DeviceName: 'PS-01 TV', FriendlyName: ['PS-01 TV'] }, StatusNET: { Hostname: 'tasmota-AB12', Mac: 'AA:BB' }, StatusFWR: { Hardware: 'ESP32-C3' } });
  if (u.hostname === '10.0.5.21' && u.pathname === '/cm') return json({ WARNING: 'Need user=<username>&password=<password>' });
  if (u.hostname === '10.0.5.30') return u.pathname === '/shelly' ? json({ gen: 2, id: 'shellyplusplugs-1', model: 'SNPL-00112EU', mac: 'CC' }) : json({}, 404);
  if (u.hostname === '10.0.5.40') return new Response('<html>router</html>');
  throw new TypeError('fetch failed');
};

describe('plug discovery', () => {
  it('finds Tasmota and Shelly plugs on a /24 and ignores other devices', async () => {
    const r = await discoverPlugs(fake, '10.0.5', 200);
    expect(r.map((p) => [p.ip, p.driver, p.name])).toEqual([
      ['10.0.5.20', 'tasmota', 'PS-01 TV'],
      ['10.0.5.21', 'tasmota', 'Tasmota (password protected)'],
      ['10.0.5.30', 'shelly_gen2', 'shellyplusplugs-1'],
    ]);
    expect(r[1].needsPassword).toBe(true);
  });
  it('rejects a bad network', async () => {
    await expect(discoverPlugs(fake, '10.0.5.1')).rejects.toThrow('three numbers');
  });
});
