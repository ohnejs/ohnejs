# Account settings

Every signed-in user has an account page: open the kebab menu (the three dots) in the header and
pick "My account", or go to `/account`. It holds the settings that control how the dashboard looks
for that one user. Nothing here changes the data your app stores, only how the dashboard shows it.

The settings are fields on the `Users` collection, so they are saved with the account and follow the
user across devices. A save takes effect at once. When you switch the dashboard language, every
label re-renders in place. When you change the time zone, every date on the page changes with it. No
reload is needed.

## The settings

| Setting               | Default                                                                  | What it does                                                                                     |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| First name, last name |                                                                          | The person's name                                                                                |
| Content language      | Follows the app's [default locale](../project/config.md#content-locales) | The locale that records open in, the same choice the header's switcher makes                     |
| Dashboard language    | Follows the app's [default language](../project/config.md#messages)      | The language of the dashboard itself, from your [message catalogs](../i18n/messages.md#catalogs) |
| Time zone             | Follows the device's zone                                                | The IANA zone that dates and times are shown and edited in, like `Europe/Berlin`                 |
| Date format           | `LL`                                                                     | The pattern used to render dates                                                                 |
| Time format           | `LTS`                                                                    | The pattern used to render times                                                                 |
| Smart clipboard       | off                                                                      | Watches the clipboard, so a block copied in another tab pastes here                              |
| Password              |                                                                          | A new password, which signs out your other devices. If left blank, the current one stays         |

## Date and time formats

The format settings are token patterns, and a preview beside each input shows the pattern applied
to the current moment as you type:

- `YYYY-MM-DD` renders `2025-02-24`, and `HH:mm` renders `21:30`.
- Any other character renders unchanged.
- `[...]` escapes text that would otherwise read as tokens: `[Week] W` renders `Week 9`.

The presets render in the [dashboard language](./data.md#switching-the-language). `LL` reads
"February 24, 2025" in English and "24. Februar 2025" in German, and `LTS` reads "9:30:25 PM" and
"21:30:25".

Your own dashboard code can use the same tokens:

- `formatDatePattern` from `ohnejs/utils` formats a date with a pattern.
- `formatDateTime`, `formatDate`, `formatTime`, and `formatRelative` from `ohnejs/dashboard` apply
  the signed-in user's settings for you.

Every token is listed under [format tokens](#format-tokens).

## Where the settings apply

- A [`dateTime`](../database/field-types.md#datetime) field renders the instant in the date and
  time formats, in the user's zone, and hovering it shows how long ago that was. A field declared
  with `relativeTime: true` swaps the two, and one declared with `timezone` always uses its own
  zone, as [date and time fields](../database/collections.md#date-and-time-fields) describes.
- The [`Updated` column](../database/collections.md#table-columns) of every collection table and
  the activity feed on the overview show how much time has passed, with the exact instant on hover.
- A [`date`](../database/field-types.md#date) field renders its calendar day in the date format. A
  day is not an instant, so the time zone does not apply.
- A [`time`](../database/field-types.md#time) field renders its clock in the time format. The zone
  does not apply there either.
- The calendar pickers open in the user's zone and name their months and days in the dashboard
  language.

## Smart clipboard

Copying a [block](../database/blocks.md#the-blocks-field) or a list item in the dashboard puts a
small JSON payload on the clipboard. With smart clipboard on, the dashboard reads the clipboard
whenever its window gains focus, so a payload copied in another tab or window is ready to paste at
once. The browser asks for permission to read the clipboard the first time. If you deny it, the
setting has no effect.

## Signing out other devices

The footer of the account page holds a button that ends every other
[session](../auth/authentication.md#sessions) of the account. A phone or a second browser is signed
out at its next request, while the current session stays.

## Extending the page

An app that [adds fields to `Users`](../auth/authentication.md#adding-fields-to-users) can offer
them on the account page. The page is a [field layout](./field-layouts.md) with one card per group
of settings. The `auth:account-layout` [hook](../project/hooks.md#the-hooks-at-a-glance) is a
[filter](../project/hooks.md#actions-and-filters) that receives this layout. Return a new layout, or
change it in place:

```ts
// boot/account.ts
import { hook } from 'ohnejs';

hook('auth:account-layout', (layout) => {
  layout.unshift({ card: ['displayName'] });
});
```

- The hook fires per request with `{ user }` as its second argument, so the layout can differ per
  user.
- A name that is not a writable field of `Users` is dropped. A row or card that becomes empty is
  dropped too.
- An empty layout hides the page and its menu entry.
- `email` and [`roles`](../auth/roles.md#assigning-roles) are never placed by default. An
  administrator changes those through the `Users` collection.

The fields that the layout names are exactly what `PATCH /auth/me` accepts, so the form and the
endpoint always match. The endpoints are covered under
[authentication](../auth/authentication.md#the-endpoints).

## Format tokens

Date tokens:

| Token   | Meaning                                                |
| ------- | ------------------------------------------------------ |
| `YY`    | Two-digit year (e.g. 23)                               |
| `YYYY`  | Four-digit year (e.g. 2023)                            |
| `M`     | The month, beginning at 1 (e.g. 1-12)                  |
| `MM`    | The month, 2-digits (e.g. 01-12)                       |
| `MMM`   | The abbreviated month name (e.g. Jan-Dec)              |
| `MMMM`  | The full month name (e.g. January-December)            |
| `D`     | The day of the month (e.g. 1-31)                       |
| `DD`    | The day of the month, 2-digits (e.g. 01-31)            |
| `d`     | The day of the week, with Sunday as 0 (e.g. 0-6)       |
| `dd`    | The min name of the day of the week (e.g. Su-Sa)       |
| `ddd`   | The short name of the day of the week (e.g. Sun-Sat)   |
| `dddd`  | The name of the day of the week (e.g. Sunday-Saturday) |
| `Q`     | Quarter (e.g. 1-4)                                     |
| `Do`    | Day of Month with ordinal (e.g. 1st 2nd ... 31st)      |
| `w`     | Week of year (e.g. 1 2 ... 52 53)                      |
| `ww`    | Week of year, 2-digits (e.g. 01 02 ... 52 53)          |
| `W`     | ISO Week of year (e.g. 1 2 ... 52 53)                  |
| `WW`    | ISO Week of year, 2-digits (e.g. 01 02 ... 52 53)      |
| `wo`    | Week of year with ordinal (e.g. 1st 2nd ... 52nd 53rd) |
| `L`     | Localized date, 2-digits (e.g. 02/24/2025)             |
| `l`     | Localized date, 1-digit (e.g. 2/24/2025)               |
| `LL`    | Localized date, long (e.g. February 24, 2025)          |
| `ll`    | Localized date, short (e.g. Feb 24, 2025)              |
| `[...]` | Escaped characters (e.g. [Year])                       |

Time tokens:

| Token   | Meaning                                                          |
| ------- | ---------------------------------------------------------------- |
| `H`     | The hour (e.g. 0-23)                                             |
| `HH`    | The hour, 2-digits (e.g. 00-23)                                  |
| `h`     | The hour, 12-hour clock (e.g. 1-12)                              |
| `hh`    | The hour, 12-hour clock, 2-digits (e.g. 01-12)                   |
| `m`     | The minute (e.g. 0-59)                                           |
| `mm`    | The minute, 2-digits (e.g. 00-59)                                |
| `s`     | The second (e.g. 0-59)                                           |
| `ss`    | The second, 2-digits (e.g. 00-59)                                |
| `SSS`   | The millisecond, 3-digits (e.g. 000-999)                         |
| `Z`     | The offset from UTC, ±HH:mm (e.g. +05:00)                        |
| `ZZ`    | The offset from UTC, ±HHmm (e.g. +0500)                          |
| `A`     | AM PM                                                            |
| `a`     | am pm                                                            |
| `k`     | The hour, beginning at 1 (e.g. 1-24)                             |
| `kk`    | The hour, 2-digits, beginning at 1 (e.g. 01-24)                  |
| `z`     | Abbreviated named offset (e.g. GMT+1)                            |
| `zzz`   | Unabbreviated named offset (e.g. Central European Standard Time) |
| `LT`    | Localized time without seconds (e.g. 8:30 PM)                    |
| `LTS`   | Localized time with seconds (e.g. 8:30:25 PM)                    |
| `[...]` | Escaped characters (e.g. [Hours])                                |
