# Class Secret Santa 2026

A responsive, static GitHub Pages site with a Supabase Edge Function backend. Names, gift hints, and matches live in the shared database; the browser is never the source of truth. The class event is scheduled for Friday, December 18, 2026.

## What classmates see

- The confirmed event date: Friday, December 18, 2026.
- A live class list and countdown to the event.
- The rules: maximum total spend €50, at least one handmade gift, and one other thoughtful gift.
- A short original bell tune that only plays after a visitor taps the music control.
- Join with a name and optional gift hints. The hints are private and appear only to the assigned giver.
- A random private reveal. Each participant receives a one-time 32-character code; it is not an account password, but it is a private key. The code is shown once, stored on the current device for convenience, and can be copied to another phone to restore access.

No names are saved until the shared backend endpoint is configured. Use a separate staging project for development and keep production data private.

## Backend setup

Use a **separate staging Supabase project** first. Keep the live project closed until staging has been tested.

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) once in its SQL Editor.
2. Deploy the Edge Function in [`supabase/functions/secret-santa/index.ts`](supabase/functions/secret-santa/index.ts). With the Supabase CLI installed and linked to the staging project, run:

   ```sh
   supabase functions deploy secret-santa
   ```

   The included `supabase/config.toml` disables JWT verification for this public event endpoint. The function still keeps database access behind the service role key.

3. Supabase automatically provides the project URL and service-role key to Edge Functions. Keep the service-role key on the server and never put it in the Pages files. A private organizer code is provisioned separately; only its SHA-256 hash is stored in `santa_event.organizer_code_hash`. Anyone with the organizer code can open/close signups and run the one-time draw.

4. Set `apiUrl` and `anonKey` in [`config.js`](config.js):

   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/secret-santa
   ```

   Set `anonKey` to the project's public anon/publishable key. The URL and anon key are public client configuration. Never put `SUPABASE_SERVICE_ROLE_KEY` or the organizer code in `config.js`.

5. Keep the staging database separate from the live database. Run [`scripts/smoke-test.mjs`](scripts/smoke-test.mjs) against staging only, setting `SECRET_SANTA_API_URL`, `SECRET_SANTA_ANON_KEY`, and `SECRET_SANTA_ORGANIZER_CODE`. It creates three fake participants and permanently completes that staging draw.

## Cross-device acceptance checks

After the staging smoke test passes, open the staging site on at least two different phones (ideally Safari and Chrome):

1. Join with clearly fake names and fake gift hints on phone A; confirm the same names appear on phone B.
2. Copy the private code from phone A and restore it on phone B; confirm the participant name loads.
3. Use the organizer controls to close signups, then use the draw button.
4. Reveal on two phones using different codes. Confirm each code only returns its own recipient and that no one draws themselves.
5. Check that public status, page source, and network responses never expose the assignment list or anyone else's gift hints.

Use fake data and discard the staging project afterwards. Only after these checks pass should a clean live Supabase project be configured and signups opened.

## GitHub Pages

1. The public repository is [`kriskarachorov/secret-santa-game`](https://github.com/kriskarachorov/secret-santa-game); these site files are at its root.
2. In that repository, open **Settings → Pages** and set the build/deployment source to **GitHub Actions**.
3. The `main` branch already has the deployment workflow. Once Pages is enabled, a push or manual workflow run publishes the static site; GitHub displays its URL in the Pages settings and the workflow deployment summary.

The public repo contains only the static front end, SQL schema, and Edge Function source. All production secrets stay in Supabase. The repo must not contain real student names, reveal codes, or gift hints.

## Organizer controls

Organizer tools stay locked until the private organizer code is entered, and the code is held in memory only for that page session. The owner can open or close signups, remove participants before the draw, view assignments after the draw, and download a private CSV of names and matches. The organizer export never contains participants’ reveal codes: those are stored only as hashes and remain with each participant. The event date is Friday, December 18, 2026. The draw is randomized with cryptographic randomness, is a derangement (no one gets themselves), and each participant can reveal their own match with their code.

## Data and privacy

- A participant's name is public to classmates on the signup list. Gift hints are not.
- A reveal code is generated by the server and only its SHA-256 hash is stored in the database. Codes are high-entropy random values. Losing the code means the organizer must remove and re-add that participant before the draw; there is no email-based recovery.
- Only the Edge Function has the service-role key. The SQL tables deny direct access to anonymous and signed-in browser clients.
- The draw cannot be undone from the website. Check the signup list before starting it.
