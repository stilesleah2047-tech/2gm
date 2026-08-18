# G2M — Field Operations

Tracking for sales reps and merchandisers, day planning, and product onboarding,
for a Nairobi distributor of dried fruits, air fresheners and roll-ons.

Two pieces: a Node service backed by MongoDB, and the React dashboard it serves.
**The operations manager creates every record from the dashboard.** There is no
seed data, no spreadsheet to import and no external service to configure first.

---

## Running it

You need Node 18 or newer and a MongoDB you can reach — local, Docker or Atlas.

**Step 1 — start MongoDB.** Nothing works until this is up. Pick one:

```bash
docker run -d --name g2m-mongo -p 27017:27017 -v g2m-data:/data/db mongo:7
```

or install MongoDB Community Server (on Windows it installs as a service that
starts on boot), or use a free MongoDB Atlas cluster and put its connection
string in `server/.env` as `MONGO_URL`.

**Step 2 — install and run.** These are three separate terminals, not three
lines pasted together: `api` and `web` both stay running.

```bash
npm run setup      # once — installs both halves, writes server/.env

npm run api        # terminal 1 — service on :4000, leave it running
npm run web        # terminal 2 — dashboard on :5173, leave it running
```

**Step 3 — open <http://localhost:5173>.**

There are two separate addresses:

| Address | Who it is for |
| --- | --- |
| `/` | The operations console — planning, monitoring, setup |
| `/field` | The field app — reps and merchandisers sign in here |

They are deliberately separate pages. Someone signing in at `/field` sees their
own stops and nothing else: no company totals, no other people's routes, no
setup. Setup → Team shows the field address with a copy button.

> Opening `web/index.html` from the file system gives a blank page. It is a Vite
> source file, not a built page — the dashboard exists only while `npm run web`
> is running. To get a page you can open directly, run `npm run build` and
> `npm start`, which serves everything from :4000.

Vite proxies `/api` and `/uploads` to the service, so the browser sees one
origin and CORS never comes up.

### If the service will not start

`Could not reach MongoDB — connect ECONNREFUSED 127.0.0.1:27017` means step 1
was skipped or Mongo stopped. Start it, and `npm run api` picks it up on the
next save (it is watching) or on a restart.

**Everything in one process** — the service will serve the built dashboard:

```bash
npm run build      # writes web/dist
npm start          # dashboard and API together on :4000
```

**With Docker** — brings up MongoDB too:

```bash
npm run build && docker compose up
```

### Checking the install

```bash
npm run verify
```

Creates an employee, a store and a duty, plans a day, publishes it, checks in,
ticks the duty, closes the call, reads it back on the ops view, then deletes
everything it made. If this passes, the install works end to end. Point it
elsewhere with `BASE=https://ops.g2m.co.ke npm run verify`.

---

## First fifteen minutes

The screens are ordered so an empty database walks you through itself.

1. **Setup → Lists & shift** — set the working day, the currency, and the
   picklists that fill dropdowns elsewhere. Below them sit the limits that
   decide what counts as a problem: shortest real call, how far from the shop a
   check-in can be, shelf share floor. Everything on the monitoring screens
   reads these, so changing one changes the colours and the wording with it.
2. **Setup → Team** — add reps and merchandisers. The phone number is how they
   sign in to the field app; a four digit PIN is optional.
3. **Setup → Stores** — add the outlets you call on. Coordinates are optional,
   but without them a check-in cannot be distance-verified. Standing at the shop
   door and tapping **Use my current location** is the quickest way to get them.
4. **Setup → Duties** — *Start with the standard list* gives you eleven duties
   covering both roles; edit or replace them. A duty marked for photos gives the
   merchandiser a labelled camera button rather than a general one.
5. **Plan the day** — defaults to tomorrow, because that is when the planning
   actually happens. Assign stops and duties per person, then **Publish**.
   Next morning, *Bring forward yesterday* copies the plan in as a draft.
6. **Field app** — the Ops/Field switch, top right. Sign in with a registered
   phone number to see that person's day.

---

## How the two field screens differ, and why

Sales and merchandising share one timeline but measure different things, because
the two roles are accountable for different things.

|              | Sales team                             | Merchandising                                    |
| ------------ | -------------------------------------- | ------------------------------------------------ |
| Marker means | outcome — order, no order, collection  | **time in store** — bar width is the call length |
| Headline     | coverage, strike rate, order value     | route adherence, share of shelf, out of stock    |
| Flags        | idle gaps, GPS out of range, Sage push | short calls, no photos, weak shelf position      |
| Evidence     | order value and Sage status            | shelf photos, facings against competitors        |

The timeline leads on **time**, not a map, because the question a manager asks in
the morning is not "where is the dot" but "was the day worked?" A skipped call is
a hole in the line. A merchandiser doing eight stores at twelve minutes each
looks fine on a visit count and obviously wrong on the strip.

---

## Data model

| Collection | Holds |
| --- | --- |
| `staff` | Employees, role, phone and PIN |
| `stores` | Outlets, with coordinates for check-in verification |
| `duties` | The task catalogue, and which need photo proof |
| `settings` | Shift window, currency, thresholds, every picklist |
| `plans` | One document per date and team, with assignments and stops |
| `visits` | One per assigned stop — check-in, duties, photos, results |
| `products` | Onboarding submissions, margin already computed |

Publishing a plan writes `visits` as `pending`. A check-in moves one to `open`.
Closing it computes the duration and a verdict. **Re-publishing an edited plan
never overwrites a visit already started** — the manager can reshuffle the
afternoon without erasing the morning's work.

## Photos

The browser downscales each photo to 1600px JPEG before upload, which matters on
mobile data. Files land in `server/uploads` and are served from `/uploads`.
**Back that folder up alongside the database** — documents reference the files by
path. Moving to S3 or GridFS later changes only the `url` written in `api.js`.

---

## Before rolling this out

- **Authentication.** Field sign-in checks a phone number and optional PIN and
  returns the person id, which the app then sends with each request. That is
  adequate for a pilot on trusted handsets, not for general release. Put real
  sessions in front of the ops screens and an admin login on Setup.
- **Offline capture.** Uploads need a live connection. A merchandiser in a
  basement supermarket will see failures and have to retake the shot. Queuing
  photos in IndexedDB and flushing them when signal returns is the fix, and the
  first thing worth building next.
- **Backups.** `mongodump` on a schedule, plus the uploads folder.
- **Store coordinates.** Until stores have them the distance check reads "not
  captured" on every check-in, and the accountability story has a hole in it.

## Where this meets the rest of G2M

Sage stays the accounting system of record and EfiSales stays the tax engine —
nothing here replaces either. Sales visits carry a `sageStatus`, so an order
captured in the field can be tracked as far as the push, and the product form
captures the KRA item classification because without it EfiSales cannot raise an
ETR. Both are deliberate hand-off points rather than integrations.
