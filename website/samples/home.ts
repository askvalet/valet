// The house: lights, the thermostat, the weather, the calendar. The floor plan is a made-up flat.
import { DAY, HOUR, MIN, ahead, over, route } from './helpers.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Fixture } from './types.ts';

// ── Home Assistant
const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes });
const light = (id: string, name: string, on: boolean, brightness = 200, rgb?: number[]) => entity(`light.${id}`, on ? 'on' : 'off', { friendly_name: name, brightness: on ? brightness : undefined, rgb_color: on ? rgb : undefined, supported_color_modes: ['color_temp', 'rgb'] });
const clock = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const climate = (attrs: Record<string, unknown>, state = 'heat') => entity('climate.hallway', state, { friendly_name: 'Hallway', hvac_modes: ['off', 'heat', 'auto'], preset_modes: ['none', 'home', 'sleep', 'away'], preset_mode: 'home', hvac_action: 'idle', temperature: 20.5, current_temperature: 19.8, min_temp: 7, max_temp: 30, target_temp_step: .5, ...attrs });
const rooms = { 1: ['Living room', 0, 0, 5200, 4200, 'Wood'], 2: ['Kitchen', 5200, 0, 8600, 4200, 'Tile'], 3: ['Bedroom', 0, 4200, 4200, 7600, 'Wood'], 4: ['Bathroom', 4200, 4200, 6000, 7600, 'Tile'], 5: ['Office', 6000, 4200, 8600, 7600, 'Wood'] };
const mapAttributes = {
  rooms: Object.fromEntries(Object.entries(rooms).map(([id, [name, x0, y0, x1, y1, floor_material]]) => [id, { room_id: Number(id), name, x0, y0, x1, y1, floor_material }])),
  furnitures: [{ type: 'sofa', room_id: 1, x0: 600, y0: 500, width: 2200, height: 900, angle: 0 }, { type: 'dining_table', room_id: 2, x0: 6200, y0: 1400, width: 1400, height: 900, angle: 0 }, { type: 'bed', room_id: 3, x0: 800, y0: 5000, width: 1800, height: 2000, angle: 0 }, { type: 'desk', room_id: 5, x0: 6600, y0: 6400, width: 1400, height: 700, angle: 0 }],
  charger_position: { x: 8200, y: 300, a: 180 }, vacuum_position: { x: 2600, y: 2400, a: 30 },
};
const states = (extra: ReturnType<typeof entity>[] = []) => [
  light('living_room', 'Living room', true, 180, [255, 196, 137]), light('kitchen', 'Kitchen', true, 255), light('bedroom', 'Bedroom', false), light('office', 'Office', true, 120, [120, 170, 255]), light('bathroom', 'Bathroom', false),
  entity('switch.coffee', 'on', { friendly_name: 'Coffee machine' }), entity('sensor.outdoor', '11.4', { friendly_name: 'Outside', unit_of_measurement: '°C' }), entity('sensor.humidity', '46', { friendly_name: 'Humidity', unit_of_measurement: '%' }),
  entity('scene.movie_night', 'scening', { friendly_name: 'Movie night' }), entity('select.heating_mode', 'Comfort', { friendly_name: 'Heating mode', options: ['Comfort', 'Eco', 'Away'] }),
  entity('media_player.living_room', 'playing', { friendly_name: 'Living room TV', media_title: 'The Long Tide' }), entity('light.porch', 'unavailable', { friendly_name: 'Porch' }),
  entity('vacuum.robot', 'docked', { friendly_name: 'Robot', status: 'charging', battery_level: 88, fan_speed: 'Standard', fan_speed_list: ['Quiet', 'Standard', 'Strong'], main_brush_left: 62, side_brush_left: 41, filter_left: 18, error: 'No error' }),
  entity('camera.robot_map', 'idle', mapAttributes),
  entity('sensor.first_bus', clock(5, 31)), entity('sensor.sunrise', clock(6, 50)), entity('sensor.midday_bus', clock(12, 3)), entity('sensor.school_bus', clock(15, 31)), entity('sensor.sunset', clock(17, 14)), entity('sensor.last_bus', clock(18, 34)),
  climate({}), ...extra,
];
const haConfig = { unit_system: { temperature: '°C' } };
const haHttp = (list = states()) => route([['/api/states', list], ['/api/config', haConfig]]);
const withClimate = (...a: Parameters<typeof climate>) => haHttp(states().map(s => s.entity_id === 'climate.hallway' ? climate(...a) : s));
const withVacuum = (state: string, status: string, error = 'No error') => haHttp(states().map(s => s.entity_id === 'vacuum.robot' ? { ...s, state, attributes: { ...s.attributes, status, error } } : s));

// ── Open-Meteo
const weather = (o: { codes?: number[]; base?: number; day?: number } = {}) => (url: string) => {
  const f = url.includes('fahrenheit'), t = (c: number) => Math.round((f ? c * 1.8 + 32 : c) * 10) / 10, base = o.base ?? 13, codes = o.codes ?? [2, 2, 1, 3, 3, 61, 61, 63, 3, 2, 1, 0, 0];
  const hours = Array.from({ length: 13 }, (_, i) => new Date(Date.now() + i * HOUR).toISOString().slice(0, 13) + ':00');
  const days = Array.from({ length: 6 }, (_, i) => new Date(Date.now() + i * DAY).toISOString().slice(0, 10));
  return { timezone: 'UTC', current: { temperature_2m: t(base), apparent_temperature: t(base - 2), weather_code: codes[0], is_day: o.day ?? 1, precipitation: codes[0] >= 51 ? .6 : 0 },
    hourly: { time: hours, temperature_2m: hours.map((_, i) => t(base + 3 * Math.sin(i / 4))), precipitation_probability: codes.map(c => c >= 51 ? 70 : 8), precipitation: codes.map(c => c >= 51 ? 1.2 : 0), weather_code: codes, is_day: hours.map(() => o.day ?? 1) },
    daily: { time: days, temperature_2m_max: days.map((_, i) => t(base + 4 + (i * 3) % 5)), temperature_2m_min: days.map((_, i) => t(base - 5 + i % 3)), weather_code: [2, 61, 3, 0, 1, 80], precipitation_probability_max: [20, 80, 30, 5, 10, 60] } };
};

// ── A calendar feed
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');
const allDay = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const midnight = new Date(new Date().toDateString()).getTime();
const timed = (title: string, day: number, h: number, m: number, mins: number, location?: string) => ['BEGIN:VEVENT', `SUMMARY:${title}`, `DTSTART:${stamp(midnight + day * DAY + h * HOUR + m * MIN)}`, `DTEND:${stamp(midnight + day * DAY + h * HOUR + (m + mins) * MIN)}`, ...(location ? [`LOCATION:${location}`] : []), 'END:VEVENT'].join('\n');
const whole = (title: string, day: number, days = 1) => ['BEGIN:VEVENT', `SUMMARY:${title}`, `DTSTART;VALUE=DATE:${allDay(midnight + day * DAY)}`, `DTEND;VALUE=DATE:${allDay(midnight + (day + days) * DAY)}`, 'END:VEVENT'].join('\n');
const ics = (events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\n');
const FAMILY = ics([timed('Daycare drop-off', 0, 8, 30, 20), timed('Dentist', 1, 15, 0, 45, 'Harbour Dental'), timed('Swimming lesson', 2, 17, 30, 45, 'Community pool'), whole('Long weekend', 4, 3), timed('Parent-teacher meeting', 8, 17, 0, 30)]);
const WORK = ics([timed('Team standup', 1, 9, 30, 15), timed('Design review', 2, 11, 0, 60), timed('Quarterly planning', 3, 13, 0, 90, 'Room 4')]);
const HOME_CAL = ics([whole('Bins out', 1), timed('Furnace service', 5, 13, 0, 120)]);
const calendarHttp = route([['family', FAMILY], ['work', WORK], ['home', HOME_CAL]]);

// ── rgb-control
const zone = (color: number[], n = 1) => Array.from({ length: n }, () => ({ state: { mode: 'Static', color, brightness: 80 } }));
const parts = [['fans0', 'Top fans', 3, [90, 150, 255]], ['fans1', 'Floor fans', 3, [90, 150, 255]], ['pump', 'Cooler', 1, [255, 255, 255]], ['ram', 'Memory', 4, [120, 90, 255]], ['gpu', 'GPU', 1, [60, 220, 200]]] as const;
const rgbState = (o: Record<string, number> = {}) => ({
  cards: parts.map(([id, title, n, color]) => ({ id, title, modes: ['Static', 'Breathing', 'Rainbow', 'Off'], zones: zone([...color], n) })), layout: { fans0: 'top', fans1: 'hidden' },
  presets: [{ id: 'ocean', name: 'Ocean', swatch: ['#2f8fff', '#35d0c0'] }, { id: 'white', name: 'All white', swatch: ['#ffffff'] }, { id: 'off', name: 'All off', swatch: ['#222222'] }],
  telemetry: { hub_rpm: [920, 760], cpu_temp: 48, gpu_temp: 41, gpu_power: 38, liquid_temp: 31.4, pump_rpm: 2400, ram_used: 21, ram_total: 64, ...o },
});

export const home: Record<string, Fixture> = {
  homeassistant: {
    config: { url: 'http://homeassistant:8123', token: 'x', href: 'https://ha.example.com',
      cards: {
        lights: { title: 'Lights', icon: 'bulb', entities: ['light.living_room', 'light.kitchen', 'light.bedroom', 'light.office', { id: 'light.porch', name: 'Porch' }, 'scene.movie_night'] },
        house: { title: 'House', icon: 'home', entities: ['sensor.outdoor', 'sensor.humidity', 'select.heating_mode', 'switch.coffee', 'media_player.living_room', 'vacuum.robot'] },
      },
      schedules: { buses: { title: 'Bus times', icon: 'clock', soon: 15, entities: [{ id: 'sensor.first_bus', name: 'First bus' }, { id: 'sensor.sunrise', name: 'Sunrise', muted: true }, { id: 'sensor.midday_bus', name: 'Midday bus' }, { id: 'sensor.school_bus', name: 'School bus' }, { id: 'sensor.sunset', name: 'Sunset' }, { id: 'sensor.last_bus', name: 'Last bus' }] } },
      thermostats: { hallway: { entity: 'climate.hallway', title: 'Hallway' } },
      floorplans: { flat: { title: 'Home', map: 'camera.robot_map', vacuum: 'vacuum.robot', rooms: { 'Living room': ['light.living_room'], Kitchen: ['light.kitchen'], Bedroom: ['light.bedroom'], Bathroom: ['light.bathroom'], Office: ['light.office'] } } },
    },
    http: haHttp(),
    states: [
      { widget: 'hallway', state: 'heating', label: 'Heating', http: withClimate({ hvac_action: 'heating', temperature: 22, current_temperature: 19.5 }) },
      { widget: 'hallway', state: 'cooling', label: 'Cooling', http: withClimate({ hvac_action: 'cooling', temperature: 23, current_temperature: 25.5 }, 'cool') },
      { widget: 'hallway', state: 'schedule', label: 'On its schedule', http: withClimate({ preset_mode: 'none' }, 'auto') },
      { widget: 'hallway', state: 'range', label: 'A range', http: withClimate({ temperature: null, target_temp_low: 19, target_temp_high: 24, hvac_action: 'idle', preset_mode: 'none' }, 'heat_cool') },
      { widget: 'hallway', state: 'hold', label: 'Temporary hold', http: withClimate({ preset_mode: 'temporary_hold', preset_modes: ['none', 'temporary_hold'] }) },
      { widget: 'hallway', state: 'off', label: 'Off', http: withClimate({ hvac_action: 'off' }, 'off') },
      { widget: 'hallway', state: 'unavailable', label: 'Unavailable', http: withClimate({}, 'unavailable') },
      { widget: 'flat', state: 'cleaning', label: 'Cleaning', http: withVacuum('cleaning', 'cleaning') },
      { widget: 'flat', state: 'stuck', label: 'Vacuum stuck', http: withVacuum('error', 'error', 'Main brush jammed') },
      { widget: 'buses', state: 'soon', label: 'Coming up soon', http: over([['/api/states', states().map(s => s.entity_id === 'sensor.sunset' ? { ...s, state: ahead(9 * MIN) } : s)]], haHttp()) },
    ],
  },
  weather: {
    config: { latitude: 43.65, longitude: -79.38 },
    http: weather(),
    states: [
      { widget: 'now', state: 'rain', label: 'Rain', http: weather({ codes: [63, 63, 61, 61, 80, 80, 61, 3, 3, 3, 2, 2, 1], base: 9 }) },
      { widget: 'now', state: 'snow', label: 'Below freezing', http: weather({ codes: [73, 73, 75, 71, 3, 3, 3, 3, 71, 71, 3, 3, 2], base: -4 }) },
      { widget: 'now', state: 'hot', label: 'A hot day', http: weather({ codes: [0, 0, 0, 1, 1, 0, 0, 2, 2, 95, 95, 2, 1], base: 33 }) },
      { widget: 'now', state: 'night', label: 'At night', http: weather({ codes: [0, 0, 1, 1, 2, 2, 3, 3, 2, 1, 1, 0, 0], day: 0, base: 7 }) },
      { widget: 'now', state: 'fahrenheit', label: 'Fahrenheit', config: { units: 'imperial' } },
    ],
  },
  calendar: {
    config: { calendars: [{ url: 'https://cal.example.com/family.ics', name: 'Family', color: '#5ac8fa' }, { url: 'https://cal.example.com/work.ics', name: 'Work', color: '#ff9f6b' }, { url: 'https://cal.example.com/home.ics', name: 'Home', color: '#bf8bff' }], days: 14, title: 'Coming up' },
    http: calendarHttp,
    states: ['upcoming', 'agenda'].map(widget => ({ widget, state: 'empty', label: 'Nothing coming up', http: () => ics([]) })),
  },
  camera: {
    config: { title: 'Cameras', cameras: [{ name: 'Driveway', url: 'http://10.0.0.20/snapshot.jpg' }, { name: 'Street', url: 'http://10.0.0.21/snapshot.jpg' }, { name: 'Back yard', url: 'http://10.0.0.22/snapshot.jpg' }, { name: 'Gate', url: 'http://10.0.0.23/snapshot.jpg' }] },
    image: ref => `/art/cameras/${['driveway', 'street', 'backyard', 'gate'][Number(ref.split(':')[1]) % 4]}.jpg`,
    states: [{ widget: 'cameras', state: 'one', label: 'One camera', config: { title: 'Back yard', cameras: [{ name: 'Back yard', url: 'http://10.0.0.22/snapshot.jpg' }] } }],
  },
  'rgb-control': {
    config: { url: 'http://desktop.example:8098', build: { radiatorFans: 3, floorFans: 3, cooler: 'aio', ram: 4 } },
    http: route([['/api/state', rgbState()]]),
    states: [
      { widget: 'pc', state: 'look', label: 'Look, don\'t touch', config: { controls: false } },
      { widget: 'pc', state: 'hot', label: 'Running hot', http: route([['/api/state', rgbState({ gpu_temp: 86, gpu_power: 310, cpu_temp: 83, liquid_temp: 46 })]]) },
    ],
  },
  todo: {
    config: { title: 'To do' },
    // the list keeps a file in VALET_DATA, which the catalog points somewhere temporary
    before() { mkdirSync(process.env.VALET_DATA!, { recursive: true }); writeFileSync(join(process.env.VALET_DATA!, 'todo-todo.json'), JSON.stringify([['Replace the furnace filter', false], ['Renew the domain', false], ['Print the lease addendum', true], ['Back up the old laptop', false], ['Book the boiler service', true]].map(([text, done], i) => ({ id: `t${i}`, text, done })))); },
  },
  clock: { config: { title: 'Clocks', clocks: [{ name: 'Toronto', zone: 'America/Toronto' }, { name: 'London', zone: 'Europe/London' }, { name: 'Karachi', zone: 'Asia/Karachi' }, { name: 'Tokyo', zone: 'Asia/Tokyo' }] } },
};
