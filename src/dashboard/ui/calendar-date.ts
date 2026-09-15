import type { TimeSpanValue } from './time-model.ts';

import { isNumber } from '../../utils/is/is-number.ts';
import { isString } from '../../utils/is/is-string.ts';

/**
 * A wall-clock reading of one instant in one IANA time zone.
 * A plain immutable record.
 *
 * `timestamp` is the instant; every other field describes its wall clock in `zone`.
 * After `addZonedMonths`/`addZonedYears` the offset is the one captured at construction.
 */
export interface ZonedDate {
  /**
   * The instant as milliseconds since the Unix epoch.
   */
  timestamp: number;

  /**
   * The wall-clock year.
   */
  year: number;

  /**
   * The wall-clock month, `1` (January) to `12` (December).
   */
  month: number;

  /**
   * The wall-clock day of the month, starting at `1`.
   */
  day: number;

  /**
   * The wall-clock day of the week, `0` (Sunday) to `6` (Saturday).
   */
  weekday: number;

  /**
   * The wall-clock hour, `0` to `23`.
   */
  hour: number;

  /**
   * The wall-clock minute, `0` to `59`.
   */
  minute: number;

  /**
   * The wall-clock second, `0` to `59`.
   */
  second: number;

  /**
   * The wall-clock millisecond, `0` to `999`.
   */
  millisecond: number;

  /**
   * The UTC offset in minutes east of UTC.
   * Fractional for zones whose historic local mean time carried second precision.
   */
  offset: number;

  /**
   * The IANA time zone the wall-clock fields are expressed in.
   */
  zone: string;
}

const PART_POSITIONS: Record<string, number | undefined> = {
  year: 0,
  month: 1,
  day: 2,
  hour: 3,
  minute: 4,
  second: 5,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The 24-hour `Intl.DateTimeFormat` that reads numeric wall-clock parts in `zone`, built once per zone.
 */
function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      hour12: false,
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/**
 * Composes wall-clock fields into the millisecond value they would read as UTC.
 * `setUTCFullYear` avoids `Date.UTC`'s mapping of years 0-99 onto 1900-1999.
 * Out-of-range fields roll over exactly like `Date`, so day 31 of a 30-day month lands in the next month.
 */
function wallValue(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

/**
 * The wall clock of `timestamp` in `zone` as `[year, month, day, hour, minute, second]`.
 */
function wallParts(timestamp: number, zone: string): number[] {
  const filled = [0, 0, 0, 0, 0, 0];
  for (const { type, value } of formatterFor(zone).formatToParts(new Date(timestamp))) {
    const position = PART_POSITIONS[type];
    if (position !== undefined) filled[position] = Number.parseInt(value, 10);
  }
  // Some platforms format midnight as hour 24.
  if (filled[3] === 24) filled[3] = 0;
  return filled;
}

/**
 * The zone's UTC offset at `timestamp`, in whole milliseconds.
 * The instant truncates to second precision.
 */
function zoneOffset(timestamp: number, zone: string): number {
  const [year, month, day, hour, minute, second] = wallParts(timestamp, zone) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return wallValue(year, month, day, hour, minute, second, 0) - (timestamp - (timestamp % 1000));
}

/**
 * Finds the instant whose wall clock in `zone` reads `wall` (a wall value in UTC milliseconds).
 * Works in integer millisecond space.
 *
 * `seed` is the offset guess to start from.
 * That offset is what decides between the two valid instants of a DST-overlap wall time.
 * A wall time inside a DST gap resolves to the instant after the transition with the later offset.
 * So 02:30 in a zone that jumps from 02:00 to 03:00 reads back as 03:30.
 */
function fixOffset(wall: number, seed: number, zone: string): [number, number] {
  let guess = wall - seed;
  const first = zoneOffset(guess, zone);
  if (first === seed) return [guess, seed];
  guess -= first - seed;
  const second = zoneOffset(guess, zone);
  if (first === second) return [guess, first];
  return [wall - Math.min(first, second), Math.max(first, second)];
}

/**
 * Builds the `ZonedDate` for `timestamp` from a known `offset` in milliseconds, without asking `Intl`.
 */
function fromWall(timestamp: number, offset: number, zone: string): ZonedDate {
  const wall = new Date(timestamp + offset);
  return {
    timestamp,
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    weekday: wall.getUTCDay(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
    millisecond: wall.getUTCMilliseconds(),
    offset: offset / 60000,
    zone,
  };
}

/**
 * Reads the instant `timestamp` as a wall clock in `zone`.
 *
 * The fields come straight from `Intl.DateTimeFormat`, so years before 1000 stay correct.
 *
 * @example
 * ```ts
 * zonedFromTimestamp(0, 'America/New_York')
 * // -> { timestamp: 0, year: 1969, month: 12, day: 31, hour: 19, ..., offset: -300, ... }
 * ```
 */
export function zonedFromTimestamp(timestamp: number, zone: string): ZonedDate {
  const [year, month, day, hour, minute, second] = wallParts(timestamp, zone) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = wallValue(year, month, day, hour, minute, second, 0);
  return {
    timestamp,
    year,
    month,
    day,
    weekday: new Date(wall).getUTCDay(),
    hour,
    minute,
    second,
    millisecond: ((timestamp % 1000) + 1000) % 1000,
    offset: (wall - (timestamp - (timestamp % 1000))) / 60000,
    zone,
  };
}

/**
 * Resolves a wall-clock time in `zone` to an instant.
 * A wall time inside a DST gap rolls forward by the width of the gap.
 * A wall time inside a DST overlap resolves to the occurrence matching the zone's offset at `reference`.
 * Out-of-range fields roll over like `Date`, so day 31 of February lands in early March.
 *
 * @example
 * ```ts
 * zonedFromWallClock('America/New_York', 2024, 3, 10, 2, 30).hour // -> 3 (the 02:00-03:00 gap)
 * zonedFromWallClock('UTC', 2024, 3, 5).timestamp                 // -> 1709596800000
 * ```
 */
export function zonedFromWallClock(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  reference = Date.now(),
): ZonedDate {
  const wall = wallValue(year, month, day, hour, minute, second, 0);
  const [timestamp, offset] = fixOffset(wall, zoneOffset(reference, zone), zone);
  return fromWall(timestamp, offset, zone);
}

/**
 * The wall-clock midnight of `date`'s day in its zone.
 * When midnight falls into a DST gap the result is the first instant after the transition.
 * `reference` seeds the overlap pick exactly as in `zonedFromWallClock`.
 */
export function startOfZonedDay(date: ZonedDate, reference = Date.now()): ZonedDate {
  return zonedFromWallClock(date.zone, date.year, date.month, date.day, 0, 0, 0, reference);
}

/**
 * Moves `date` to `year` and `month` on the wall clock, clamping the day and keeping its offset.
 */
function shiftWall(date: ZonedDate, year: number, month: number): ZonedDate {
  const day = Math.min(date.day, daysInMonth(year, month));
  const previous = wallValue(
    date.year,
    date.month,
    date.day,
    date.hour,
    date.minute,
    date.second,
    date.millisecond,
  );
  const wall = wallValue(year, month, day, date.hour, date.minute, date.second, date.millisecond);
  return {
    ...date,
    timestamp: date.timestamp + (wall - previous),
    year,
    month,
    day,
    weekday: new Date(wall).getUTCDay(),
  };
}

/**
 * Adds `months` (negative to subtract) on the wall clock.
 * The day clamps to the target month's length, so January 31 plus one month is the last day of February.
 * The offset captured at construction stays fixed - the zone is not re-resolved.
 * So a step across a DST change shifts the instant by the stale offset.
 *
 * @example
 * ```ts
 * addZonedMonths(zonedFromWallClock('UTC', 2024, 1, 31), 1).day // -> 29
 * ```
 */
export function addZonedMonths(date: ZonedDate, months: number): ZonedDate {
  const total = date.month - 1 + months;
  const year = date.year + Math.floor(total / 12);
  return shiftWall(date, year, (((total % 12) + 12) % 12) + 1);
}

/**
 * Adds `years` (negative to subtract) on the wall clock.
 * February 29 clamps to February 28 in a non-leap target year.
 * The fixed-offset semantics match `addZonedMonths`.
 */
export function addZonedYears(date: ZonedDate, years: number): ZonedDate {
  return shiftWall(date, date.year + years, date.month);
}

/**
 * Clamps `date` between `min` and `max` by instant, returning one of the three inputs unchanged.
 * On equal instants the date itself wins, so the returned object keeps its own wall clock.
 */
export function clampZoned(date: ZonedDate, min: ZonedDate, max: ZonedDate): ZonedDate {
  const lower = min.timestamp > date.timestamp ? min : date;
  return max.timestamp < lower.timestamp ? max : lower;
}

/**
 * The number of days in the given month of the proleptic Gregorian calendar.
 * `month` is `1` to `12`.
 *
 * @example
 * ```ts
 * daysInMonth(2024, 2) // -> 29
 * daysInMonth(2023, 2) // -> 28
 * daysInMonth(1900, 2) // -> 28
 * ```
 */
export function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

const REGEX_PARSE =
  /^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/;

/**
 * Parses a calendar `min`/`max`/`initial` input into a timestamp.
 * A number passes through.
 * A date or date-time string with no zone suffix reads as local time.
 * So `'2024-12-15'` is local midnight - unlike `Date.parse`, which reads date-only strings as UTC.
 * Anything else, including `Z`-suffixed ISO strings, falls back to the `Date` parser.
 */
export function parseDateInput(input: number | string): number {
  if (isNumber(input)) return input;
  if (!/Z$/i.test(input)) {
    const match = REGEX_PARSE.exec(input);
    if (match) {
      const day = match[3] === undefined || match[3] === '' ? 1 : Number(match[3]);
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1 || 0,
        day,
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
        Number((match[7] ?? '0').slice(0, 3)),
      ).getTime();
    }
  }
  return new Date(input).getTime();
}

/**
 * Parses a date-time into a timestamp: a number passes through, a string goes through `Date.parse`.
 * The calendar range resolves its `min`/`max` this way, so `'2024-12-15'` is UTC midnight here.
 *
 * @example
 * ```ts
 * parseDateTime('2024-12-15T00:00:00.000Z') // -> 1734220800000
 * parseDateTime(1734220800000)              // -> 1734220800000
 * ```
 */
export function parseDateTime(date: number | string): number {
  return isNumber(date) ? date : Date.parse(date);
}

/**
 * Converts a jose-style duration string to whole seconds.
 * One signed `<value> <unit>` segment with an optional `ago`/`from now` suffix; a year is 365.25 days.
 * Kept private because it differs observably from `parseDuration` in `src/utils/duration`.
 */
function joseSeconds(duration: string): number {
  const regex =
    /^(\+|-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
  const matched = regex.exec(duration);

  if (!matched || (matched[4] && matched[1])) {
    throw new TypeError('Invalid time period format');
  }

  const value = Number.parseFloat(matched[2]!);
  const unit = matched[3]!.toLowerCase();

  let seconds: number;

  switch (unit) {
    case 'sec':
    case 'secs':
    case 'second':
    case 'seconds':
    case 's':
      seconds = Math.round(value);
      break;
    case 'minute':
    case 'minutes':
    case 'min':
    case 'mins':
    case 'm':
      seconds = Math.round(value * 60);
      break;
    case 'hour':
    case 'hours':
    case 'hr':
    case 'hrs':
    case 'h':
      seconds = Math.round(value * 3600);
      break;
    case 'day':
    case 'days':
    case 'd':
      seconds = Math.round(value * 86400);
      break;
    case 'week':
    case 'weeks':
    case 'w':
      seconds = Math.round(value * 604800);
      break;
    default:
      seconds = Math.round(value * 31557600);
      break;
  }

  return matched[1] === '-' || matched[4] === 'ago' ? -seconds : seconds;
}

/**
 * Parses a time span into milliseconds.
 * A number passes through.
 * A string is a jose-style duration (`'1 hour'`, `'30 minutes'`, year = 365.25 days).
 * A malformed string throws a `TypeError`.
 * An object sums its `days`, `hours`, `minutes`, and `seconds`.
 *
 * @example
 * ```ts
 * parseTimeSpan('1 hour')     // -> 3600000
 * parseTimeSpan({ hours: 1 }) // -> 3600000
 * parseTimeSpan(1800000)      // -> 1800000
 * ```
 */
export function parseTimeSpan(span: TimeSpanValue): number {
  if (isNumber(span)) return span;
  if (isString(span)) return joseSeconds(span) * 1000;
  const { days = 0, hours = 0, minutes = 0, seconds = 0 } = span;
  return (days * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Resolves a time zone identifier.
 * An empty value or `'local'` becomes the environment's zone from `Intl`; anything else passes through.
 */
export function resolveTimezone(timezone?: string): string {
  return !timezone || timezone === 'local'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : timezone;
}

/**
 * Every IANA time zone name the calendar accepts.
 */
export const timezones = [
  'Africa/Abidjan',
  'Africa/Accra',
  'Africa/Addis_Ababa',
  'Africa/Algiers',
  'Africa/Asmara',
  'Africa/Asmera',
  'Africa/Bamako',
  'Africa/Bangui',
  'Africa/Banjul',
  'Africa/Bissau',
  'Africa/Blantyre',
  'Africa/Brazzaville',
  'Africa/Bujumbura',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Ceuta',
  'Africa/Conakry',
  'Africa/Dakar',
  'Africa/Dar_es_Salaam',
  'Africa/Djibouti',
  'Africa/Douala',
  'Africa/El_Aaiun',
  'Africa/Freetown',
  'Africa/Gaborone',
  'Africa/Harare',
  'Africa/Johannesburg',
  'Africa/Juba',
  'Africa/Kampala',
  'Africa/Khartoum',
  'Africa/Kigali',
  'Africa/Kinshasa',
  'Africa/Lagos',
  'Africa/Libreville',
  'Africa/Lome',
  'Africa/Luanda',
  'Africa/Lubumbashi',
  'Africa/Lusaka',
  'Africa/Malabo',
  'Africa/Maputo',
  'Africa/Maseru',
  'Africa/Mbabane',
  'Africa/Mogadishu',
  'Africa/Monrovia',
  'Africa/Nairobi',
  'Africa/Ndjamena',
  'Africa/Niamey',
  'Africa/Nouakchott',
  'Africa/Ouagadougou',
  'Africa/Porto-Novo',
  'Africa/Sao_Tome',
  'Africa/Timbuktu',
  'Africa/Tripoli',
  'Africa/Tunis',
  'Africa/Windhoek',
  'America/Adak',
  'America/Anchorage',
  'America/Anguilla',
  'America/Antigua',
  'America/Araguaina',
  'America/Argentina/Buenos_Aires',
  'America/Argentina/Catamarca',
  'America/Argentina/ComodRivadavia',
  'America/Argentina/Cordoba',
  'America/Argentina/Jujuy',
  'America/Argentina/La_Rioja',
  'America/Argentina/Mendoza',
  'America/Argentina/Rio_Gallegos',
  'America/Argentina/Salta',
  'America/Argentina/San_Juan',
  'America/Argentina/San_Luis',
  'America/Argentina/Tucuman',
  'America/Argentina/Ushuaia',
  'America/Aruba',
  'America/Asuncion',
  'America/Atikokan',
  'America/Atka',
  'America/Bahia',
  'America/Bahia_Banderas',
  'America/Barbados',
  'America/Belem',
  'America/Belize',
  'America/Blanc-Sablon',
  'America/Boa_Vista',
  'America/Bogota',
  'America/Boise',
  'America/Buenos_Aires',
  'America/Cambridge_Bay',
  'America/Campo_Grande',
  'America/Cancun',
  'America/Caracas',
  'America/Catamarca',
  'America/Cayenne',
  'America/Cayman',
  'America/Chicago',
  'America/Chihuahua',
  'America/Ciudad_Juarez',
  'America/Coral_Harbour',
  'America/Cordoba',
  'America/Costa_Rica',
  'America/Coyhaique',
  'America/Creston',
  'America/Cuiaba',
  'America/Curacao',
  'America/Danmarkshavn',
  'America/Dawson',
  'America/Dawson_Creek',
  'America/Denver',
  'America/Detroit',
  'America/Dominica',
  'America/Edmonton',
  'America/Eirunepe',
  'America/El_Salvador',
  'America/Ensenada',
  'America/Fort_Nelson',
  'America/Fort_Wayne',
  'America/Fortaleza',
  'America/Glace_Bay',
  'America/Godthab',
  'America/Goose_Bay',
  'America/Grand_Turk',
  'America/Grenada',
  'America/Guadeloupe',
  'America/Guatemala',
  'America/Guayaquil',
  'America/Guyana',
  'America/Halifax',
  'America/Havana',
  'America/Hermosillo',
  'America/Indiana/Indianapolis',
  'America/Indiana/Knox',
  'America/Indiana/Marengo',
  'America/Indiana/Petersburg',
  'America/Indiana/Tell_City',
  'America/Indiana/Vevay',
  'America/Indiana/Vincennes',
  'America/Indiana/Winamac',
  'America/Indianapolis',
  'America/Inuvik',
  'America/Iqaluit',
  'America/Jamaica',
  'America/Jujuy',
  'America/Juneau',
  'America/Kentucky/Louisville',
  'America/Kentucky/Monticello',
  'America/Knox_IN',
  'America/Kralendijk',
  'America/La_Paz',
  'America/Lima',
  'America/Los_Angeles',
  'America/Louisville',
  'America/Lower_Princes',
  'America/Maceio',
  'America/Managua',
  'America/Manaus',
  'America/Marigot',
  'America/Martinique',
  'America/Matamoros',
  'America/Mazatlan',
  'America/Mendoza',
  'America/Menominee',
  'America/Merida',
  'America/Metlakatla',
  'America/Mexico_City',
  'America/Miquelon',
  'America/Moncton',
  'America/Monterrey',
  'America/Montevideo',
  'America/Montreal',
  'America/Montserrat',
  'America/Nassau',
  'America/New_York',
  'America/Nipigon',
  'America/Nome',
  'America/Noronha',
  'America/North_Dakota/Beulah',
  'America/North_Dakota/Center',
  'America/North_Dakota/New_Salem',
  'America/Nuuk',
  'America/Ojinaga',
  'America/Panama',
  'America/Pangnirtung',
  'America/Paramaribo',
  'America/Phoenix',
  'America/Port-au-Prince',
  'America/Port_of_Spain',
  'America/Porto_Acre',
  'America/Porto_Velho',
  'America/Puerto_Rico',
  'America/Punta_Arenas',
  'America/Rainy_River',
  'America/Rankin_Inlet',
  'America/Recife',
  'America/Regina',
  'America/Resolute',
  'America/Rio_Branco',
  'America/Rosario',
  'America/Santa_Isabel',
  'America/Santarem',
  'America/Santiago',
  'America/Santo_Domingo',
  'America/Sao_Paulo',
  'America/Scoresbysund',
  'America/Shiprock',
  'America/Sitka',
  'America/St_Barthelemy',
  'America/St_Johns',
  'America/St_Kitts',
  'America/St_Lucia',
  'America/St_Thomas',
  'America/St_Vincent',
  'America/Swift_Current',
  'America/Tegucigalpa',
  'America/Thule',
  'America/Thunder_Bay',
  'America/Tijuana',
  'America/Toronto',
  'America/Tortola',
  'America/Vancouver',
  'America/Virgin',
  'America/Whitehorse',
  'America/Winnipeg',
  'America/Yakutat',
  'America/Yellowknife',
  'Antarctica/Casey',
  'Antarctica/Davis',
  'Antarctica/DumontDUrville',
  'Antarctica/Macquarie',
  'Antarctica/Mawson',
  'Antarctica/McMurdo',
  'Antarctica/Palmer',
  'Antarctica/Rothera',
  'Antarctica/South_Pole',
  'Antarctica/Syowa',
  'Antarctica/Troll',
  'Antarctica/Vostok',
  'Arctic/Longyearbyen',
  'Asia/Aden',
  'Asia/Almaty',
  'Asia/Amman',
  'Asia/Anadyr',
  'Asia/Aqtau',
  'Asia/Aqtobe',
  'Asia/Ashgabat',
  'Asia/Ashkhabad',
  'Asia/Atyrau',
  'Asia/Baghdad',
  'Asia/Bahrain',
  'Asia/Baku',
  'Asia/Bangkok',
  'Asia/Barnaul',
  'Asia/Beirut',
  'Asia/Bishkek',
  'Asia/Brunei',
  'Asia/Calcutta',
  'Asia/Chita',
  'Asia/Choibalsan',
  'Asia/Chongqing',
  'Asia/Chungking',
  'Asia/Colombo',
  'Asia/Dacca',
  'Asia/Damascus',
  'Asia/Dhaka',
  'Asia/Dili',
  'Asia/Dubai',
  'Asia/Dushanbe',
  'Asia/Famagusta',
  'Asia/Gaza',
  'Asia/Harbin',
  'Asia/Hebron',
  'Asia/Ho_Chi_Minh',
  'Asia/Hong_Kong',
  'Asia/Hovd',
  'Asia/Irkutsk',
  'Asia/Istanbul',
  'Asia/Jakarta',
  'Asia/Jayapura',
  'Asia/Jerusalem',
  'Asia/Kabul',
  'Asia/Kamchatka',
  'Asia/Karachi',
  'Asia/Kashgar',
  'Asia/Kathmandu',
  'Asia/Katmandu',
  'Asia/Khandyga',
  'Asia/Kolkata',
  'Asia/Krasnoyarsk',
  'Asia/Kuala_Lumpur',
  'Asia/Kuching',
  'Asia/Kuwait',
  'Asia/Macao',
  'Asia/Macau',
  'Asia/Magadan',
  'Asia/Makassar',
  'Asia/Manila',
  'Asia/Muscat',
  'Asia/Nicosia',
  'Asia/Novokuznetsk',
  'Asia/Novosibirsk',
  'Asia/Omsk',
  'Asia/Oral',
  'Asia/Phnom_Penh',
  'Asia/Pontianak',
  'Asia/Pyongyang',
  'Asia/Qatar',
  'Asia/Qostanay',
  'Asia/Qyzylorda',
  'Asia/Rangoon',
  'Asia/Riyadh',
  'Asia/Saigon',
  'Asia/Sakhalin',
  'Asia/Samarkand',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Srednekolymsk',
  'Asia/Taipei',
  'Asia/Tashkent',
  'Asia/Tbilisi',
  'Asia/Tehran',
  'Asia/Tel_Aviv',
  'Asia/Thimbu',
  'Asia/Thimphu',
  'Asia/Tokyo',
  'Asia/Tomsk',
  'Asia/Ujung_Pandang',
  'Asia/Ulaanbaatar',
  'Asia/Ulan_Bator',
  'Asia/Urumqi',
  'Asia/Ust-Nera',
  'Asia/Vientiane',
  'Asia/Vladivostok',
  'Asia/Yakutsk',
  'Asia/Yangon',
  'Asia/Yekaterinburg',
  'Asia/Yerevan',
  'Atlantic/Azores',
  'Atlantic/Bermuda',
  'Atlantic/Canary',
  'Atlantic/Cape_Verde',
  'Atlantic/Faeroe',
  'Atlantic/Faroe',
  'Atlantic/Jan_Mayen',
  'Atlantic/Madeira',
  'Atlantic/Reykjavik',
  'Atlantic/South_Georgia',
  'Atlantic/St_Helena',
  'Atlantic/Stanley',
  'Australia/ACT',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Broken_Hill',
  'Australia/Canberra',
  'Australia/Currie',
  'Australia/Darwin',
  'Australia/Eucla',
  'Australia/Hobart',
  'Australia/LHI',
  'Australia/Lindeman',
  'Australia/Lord_Howe',
  'Australia/Melbourne',
  'Australia/North',
  'Australia/NSW',
  'Australia/Perth',
  'Australia/Queensland',
  'Australia/South',
  'Australia/Sydney',
  'Australia/Tasmania',
  'Australia/Victoria',
  'Australia/West',
  'Australia/Yancowinna',
  'Brazil/Acre',
  'Brazil/DeNoronha',
  'Brazil/East',
  'Brazil/West',
  'Canada/Atlantic',
  'Canada/Central',
  'Canada/Eastern',
  'Canada/Mountain',
  'Canada/Newfoundland',
  'Canada/Pacific',
  'Canada/Saskatchewan',
  'Canada/Yukon',
  'CET',
  'Chile/Continental',
  'Chile/EasterIsland',
  'CST6CDT',
  'Cuba',
  'EET',
  'Egypt',
  'Eire',
  'EST',
  'EST5EDT',
  'Etc/GMT',
  'Etc/GMT+0',
  'Etc/GMT+1',
  'Etc/GMT+10',
  'Etc/GMT+11',
  'Etc/GMT+12',
  'Etc/GMT+2',
  'Etc/GMT+3',
  'Etc/GMT+4',
  'Etc/GMT+5',
  'Etc/GMT+6',
  'Etc/GMT+7',
  'Etc/GMT+8',
  'Etc/GMT+9',
  'Etc/GMT-0',
  'Etc/GMT-1',
  'Etc/GMT-10',
  'Etc/GMT-11',
  'Etc/GMT-12',
  'Etc/GMT-13',
  'Etc/GMT-14',
  'Etc/GMT-2',
  'Etc/GMT-3',
  'Etc/GMT-4',
  'Etc/GMT-5',
  'Etc/GMT-6',
  'Etc/GMT-7',
  'Etc/GMT-8',
  'Etc/GMT-9',
  'Etc/GMT0',
  'Etc/Greenwich',
  'Etc/UCT',
  'Etc/Universal',
  'Etc/UTC',
  'Etc/Zulu',
  'Europe/Amsterdam',
  'Europe/Andorra',
  'Europe/Astrakhan',
  'Europe/Athens',
  'Europe/Belfast',
  'Europe/Belgrade',
  'Europe/Berlin',
  'Europe/Bratislava',
  'Europe/Brussels',
  'Europe/Bucharest',
  'Europe/Budapest',
  'Europe/Busingen',
  'Europe/Chisinau',
  'Europe/Copenhagen',
  'Europe/Dublin',
  'Europe/Gibraltar',
  'Europe/Guernsey',
  'Europe/Helsinki',
  'Europe/Isle_of_Man',
  'Europe/Istanbul',
  'Europe/Jersey',
  'Europe/Kaliningrad',
  'Europe/Kiev',
  'Europe/Kirov',
  'Europe/Kyiv',
  'Europe/Lisbon',
  'Europe/Ljubljana',
  'Europe/London',
  'Europe/Luxembourg',
  'Europe/Madrid',
  'Europe/Malta',
  'Europe/Mariehamn',
  'Europe/Minsk',
  'Europe/Monaco',
  'Europe/Moscow',
  'Europe/Nicosia',
  'Europe/Oslo',
  'Europe/Paris',
  'Europe/Podgorica',
  'Europe/Prague',
  'Europe/Riga',
  'Europe/Rome',
  'Europe/Samara',
  'Europe/San_Marino',
  'Europe/Sarajevo',
  'Europe/Saratov',
  'Europe/Simferopol',
  'Europe/Skopje',
  'Europe/Sofia',
  'Europe/Stockholm',
  'Europe/Tallinn',
  'Europe/Tirane',
  'Europe/Tiraspol',
  'Europe/Ulyanovsk',
  'Europe/Uzhgorod',
  'Europe/Vaduz',
  'Europe/Vatican',
  'Europe/Vienna',
  'Europe/Vilnius',
  'Europe/Volgograd',
  'Europe/Warsaw',
  'Europe/Zagreb',
  'Europe/Zaporozhye',
  'Europe/Zurich',
  'Factory',
  'GB',
  'GB-Eire',
  'GMT',
  'GMT+0',
  'GMT-0',
  'GMT0',
  'Greenwich',
  'Hongkong',
  'HST',
  'Iceland',
  'Indian/Antananarivo',
  'Indian/Chagos',
  'Indian/Christmas',
  'Indian/Cocos',
  'Indian/Comoro',
  'Indian/Kerguelen',
  'Indian/Mahe',
  'Indian/Maldives',
  'Indian/Mauritius',
  'Indian/Mayotte',
  'Indian/Reunion',
  'Iran',
  'Israel',
  'Jamaica',
  'Japan',
  'Kwajalein',
  'Libya',
  'MET',
  'Mexico/BajaNorte',
  'Mexico/BajaSur',
  'Mexico/General',
  'MST',
  'MST7MDT',
  'Navajo',
  'NZ',
  'NZ-CHAT',
  'Pacific/Apia',
  'Pacific/Auckland',
  'Pacific/Bougainville',
  'Pacific/Chatham',
  'Pacific/Chuuk',
  'Pacific/Easter',
  'Pacific/Efate',
  'Pacific/Enderbury',
  'Pacific/Fakaofo',
  'Pacific/Fiji',
  'Pacific/Funafuti',
  'Pacific/Galapagos',
  'Pacific/Gambier',
  'Pacific/Guadalcanal',
  'Pacific/Guam',
  'Pacific/Honolulu',
  'Pacific/Johnston',
  'Pacific/Kanton',
  'Pacific/Kiritimati',
  'Pacific/Kosrae',
  'Pacific/Kwajalein',
  'Pacific/Majuro',
  'Pacific/Marquesas',
  'Pacific/Midway',
  'Pacific/Nauru',
  'Pacific/Niue',
  'Pacific/Norfolk',
  'Pacific/Noumea',
  'Pacific/Pago_Pago',
  'Pacific/Palau',
  'Pacific/Pitcairn',
  'Pacific/Pohnpei',
  'Pacific/Ponape',
  'Pacific/Port_Moresby',
  'Pacific/Rarotonga',
  'Pacific/Saipan',
  'Pacific/Samoa',
  'Pacific/Tahiti',
  'Pacific/Tarawa',
  'Pacific/Tongatapu',
  'Pacific/Truk',
  'Pacific/Wake',
  'Pacific/Wallis',
  'Pacific/Yap',
  'Poland',
  'Portugal',
  'PRC',
  'PST8PDT',
  'ROC',
  'ROK',
  'Singapore',
  'Turkey',
  'UCT',
  'Universal',
  'US/Alaska',
  'US/Aleutian',
  'US/Arizona',
  'US/Central',
  'US/East-Indiana',
  'US/Eastern',
  'US/Hawaii',
  'US/Indiana-Starke',
  'US/Michigan',
  'US/Mountain',
  'US/Pacific',
  'US/Samoa',
  'UTC',
  'W-SU',
  'WET',
  'Zulu',
] as const;

/**
 * An IANA time zone name from `timezones`.
 */
export type Timezone = (typeof timezones)[number];
