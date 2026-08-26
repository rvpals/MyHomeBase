# Deploying MyHomeBase to a Synology NAS

Runbook for running the app on a **DS223 (aarch64, 2 GB RAM)** behind DSM's reverse
proxy, reachable over HTTPS from a phone. Written from an actual first install — the
troubleshooting section at the end is every error that came up, not a guess at what
might.

The Windows deployment at `C:\webapp\MHB` is unaffected by any of this; the two can run
side by side against separate databases.

## Concrete values used throughout

Substitute your own where marked. Everything else is literal.

| | |
|---|---|
| Repo (Windows) | `E:\Code\Claude_Project\MyHomeBase` |
| Build output (Windows) | `E:\Code\Claude_Project\MyHomeBase\dist-nas` |
| Existing Windows deployment | `C:\webapp\MHB`, database at `C:\webapp\MHB\data\myhomebase.db` |
| NAS host | `NAS_DS223` |
| NAS SSH user | `ssh_user` — **substitute yours** |
| NAS app directory | `/volume1/app/myhomebase` |
| NAS database | `/volume1/app/myhomebase/data/myhomebase.db` |
| Public URL | `https://mhb.yourname.synology.me` — **substitute your DDNS name** |
| Node on the NAS | `/usr/local/bin/node` → `/volume1/@appstore/Node.js_v20/usr/local/bin/node` |
| App port | 3000 (localhost only; DSM's reverse proxy publishes 443) |

> Note the app folder is `/volume1/**app**/myhomebase` — singular. Getting this wrong
> puts `MYHOMEBASE_DB` on a path that doesn't exist.

---

## The shape of it, and why

**Everything is built on the Windows PC. The NAS only runs finished bytes** — no npm, no
compiler, no build step.

That isn't a stylistic choice. A DS223 has 2 GB of RAM, a quad Cortex-A55, and is
already using swap at idle. `next build` wants 2–4 GB; on that hardware it would thrash
for an hour and most likely be OOM-killed.

Two things make a copy-only deploy possible:

1. **The app has exactly one native module that matters: `better-sqlite3`.** Its arm64
   binary is a published prebuild, so it is downloaded rather than compiled. (`sharp` is
   also in the tree but never loads — nothing imports `next/image`, and sharp isn't even
   a declared dependency.)
2. **The migration runner is bundled to plain CommonJS**, so the NAS doesn't need `tsx`
   — which would drag in esbuild's own platform binary and reintroduce the problem.

`npm run publish:nas` does all of it and produces `dist-nas/`, ready to copy.

### Why HTTPS is mandatory, not optional

The session cookie is set with `secure: NODE_ENV === "production"`. Browsers refuse to
store a `Secure` cookie from a non-trustworthy origin, and **a LAN IP is not
trustworthy** — only HTTPS and `localhost` are.

Measured on a real production build:

| Origin | Session cookie | Result |
|---|---|---|
| `http://localhost:3000` | stored | works |
| `http://192.168.4.5:3000` | **rejected** | bounced back to `/login` |

So over plain HTTP from a phone you can log in, land on the home page, and be thrown
back to the login screen on your first tap. Do Part 1 before anything else.

---

## Part 1 — HTTPS on DSM

**1. Router.** Forward ports **80** and **443** to the NAS. Port 80 is only needed for
Let's Encrypt renewals, but it is needed.

**2. DDNS.** Control Panel → **External Access → DDNS** → Add:
- Service provider: **Synology**
- Hostname: `yourname.synology.me`

**3. Certificate.** Control Panel → **Security → Certificate** → Add → *Get a
certificate from Let's Encrypt*:
- Domain name: `yourname.synology.me`
- **Subject Alternative Name: `mhb.yourname.synology.me`** ← the app's subdomain must be
  listed here or the browser reports a name mismatch

**4. Assign the certificate.** Control Panel → **Security → Certificate → Settings**
(the button above the list, *not* the certificate itself). Find
`mhb.yourname.synology.me` in the services table and point it at the Let's Encrypt
certificate. Apply.

> **This step is the one that gets missed.** Issuing a certificate and *using* it are
> separate actions in DSM. Skip it and the browser says "Your connection is not private"
> because the reverse proxy is still serving DSM's self-signed certificate.

**5. Reverse proxy.** Control Panel → **Login Portal → Advanced → Reverse Proxy** →
Create:

| Field | Value |
|---|---|
| Source protocol | HTTPS |
| Source hostname | `mhb.yourname.synology.me` |
| Source port | 443 |
| Destination protocol | HTTP |
| Destination hostname | `localhost` |
| Destination port | 3000 |

**Check:** load `https://mhb.yourname.synology.me` on a phone over cellular. A **502 Bad
Gateway with a valid padlock** is the correct result here — nothing is listening on 3000
yet. The padlock is what matters.

---

## Part 2 — SSH access

### 2.1 The user account

SSH on DSM is only permitted for members of the **administrators** group. Either use an
existing admin account or make a dedicated one:

Control Panel → **User & Group → User → Create**
- Name: `ssh_user` (or your choice)
- Join groups: tick **administrators**
- Permissions: grant read/write on the shared folder that holds `/volume1/app`
- Applications: leave defaults

### 2.2 Enable the user home service

Control Panel → **User & Group → Advanced → User Home** → tick **Enable user home
service**.

Without this the account has no home directory, so `~/.ssh` cannot exist and key
authentication is impossible.

### 2.3 Enable SSH

Control Panel → **Terminal & SNMP → Terminal** → tick **Enable SSH service**. Leave the
port at 22 unless you have a reason.

If DSM's firewall is on (Control Panel → Security → Firewall), add an allow rule for
port 22 from your LAN.

> **Do not forward port 22 on your router.** Everything here is done from inside the
> network; exposing SSH to the internet is an unnecessary risk.

### 2.4 First connection

From Windows PowerShell:

```powershell
ssh ssh_user@NAS_DS223
```

If the hostname doesn't resolve, use the LAN IP (`ssh ssh_user@192.168.4.5`). Accept the
host key on first connect. You should land at:

```
ssh_user@NAS_DS223:~$
```

Administrator accounts can use `sudo`, which will prompt for the same password.

### 2.5 Key authentication (optional, recommended)

Removes the password prompt and lets deploys be scripted.

On Windows:

```powershell
ssh-keygen -t ed25519 -C myhomebase-deploy
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh ssh_user@NAS_DS223 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Then on the NAS — **the permissions are not optional, DSM's sshd refuses keys otherwise,
and DSM often creates home directories group-writable:**

```bash
chmod 700 ~
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

Test from a new terminal:

```powershell
ssh -o BatchMode=yes ssh_user@NAS_DS223 "echo SSH_OK"
```

`SSH_OK` means keys work. `Permission denied (publickey,password)` means they don't —
almost always the permissions above, occasionally `PubkeyAuthentication` being commented
out in `/etc/ssh/sshd_config` (uncomment it, then restart SSH by toggling the Terminal
service off and on in DSM).

---

## Part 3 — NAS preparation

### Node

Install **Node.js v20** from Package Center. Next 16 requires ≥ 20.9.0; v20.19.5 is
fine. Confirm the interpreter path, which scheduled tasks will need in full:

```bash
which node && readlink -f "$(which node)"
# /usr/local/bin/node
# /volume1/@appstore/Node.js_v20/usr/local/bin/node
```

Use `/usr/local/bin/node` in scripts — Package Center maintains that symlink across
updates.

> **Node's version fixes the binary target.** A prebuilt native module is keyed to the
> ABI, not the version string: **Node 20 = ABI 115**, Node 22 = ABI 127. If you ever
> upgrade the Node package, change `NODE_ABI` in
> `E:\Code\Claude_Project\MyHomeBase\scripts\publish-nas.mjs` to match, or the app will
> fail to load the database driver.

### Folders

```bash
sudo mkdir -p /volume1/app/myhomebase/data
sudo chown -R ssh_user:users /volume1/app/myhomebase
```

### Timezone

Control Panel → **Regional Options** → set your actual timezone. The app converts
timestamps to local calendar days throughout (events, trade timeline, every date
column); a NAS left on UTC shifts dates by a day around midnight.

---

## Part 4 — Build the package (Windows)

```powershell
cd E:\Code\Claude_Project\MyHomeBase
npm run publish:nas
```

Produces `E:\Code\Claude_Project\MyHomeBase\dist-nas\` (~40 MB) and handles four things
that are easy to get wrong:

- **Materialises symlinks.** Turbopack rewrites `require("better-sqlite3")` to a
  hash-suffixed name and satisfies it with a *symlink* at
  `.next/node_modules/better-sqlite3-<hash>` pointing to an absolute Windows path.
  Copied as-is it is dead on Linux.
- **Swaps in the arm64 driver** — downloads the prebuild, verifies it really is an
  AArch64 ELF, and replaces **both** copies in the tree
  (`node_modules/better-sqlite3/build/Release/better_sqlite3.node` and the hash-named
  one under `.next/node_modules/`).
- **Deletes `data/` and `.env`**, which Next traces into the build output even though
  `outputFileTracingExcludes` says otherwise. The database matters most: `wiring.ts`
  falls back to `./data/myhomebase.db` when `MYHOMEBASE_DB` is unset, so shipping one
  means a misconfigured deploy silently serves stale data instead of failing loudly.
- **Bundles `migrate.cjs`** so migrations run without `tsx`, and
  **`set-startup-message.cjs`** the same way — `start.sh` runs it after a
  trigger-driven restart to announce the new deployment on the home screen. It
  imports from `src/lib/`, so it is bundled rather than compiled: the `@/` path
  alias has to be resolved at build time.

It refuses to finish if any symlink survives or any driver copy isn't AArch64.

---

## Part 5 — First deploy

### 5.1 Copy it across

```powershell
cd E:\Code\Claude_Project\MyHomeBase
scp -r dist-nas/. ssh_user@NAS_DS223:/volume1/app/myhomebase/
```

> Use `dist-nas/.` — **not** `dist-nas/*`. The shell glob skips dot-directories and
> silently leaves out the entire `.next` bundle.

Verify on the NAS with `ls -a` (plain `ls` hides `.next`):

```bash
ls -a /volume1/app/myhomebase
# .next  CHANGE_HISTORY.md  data  migrate.cjs  migrations  node_modules  package.json
# public  server.js  set-startup-message.cjs
```

### 5.2 Configure

```bash
cat > /volume1/app/myhomebase/.env <<'EOF'
MYHOMEBASE_DB=/volume1/app/myhomebase/data/myhomebase.db
MYHOMEBASE_MUSIC_ROOT=/volume1/MEDIA/AUDIO
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://mhb.yourname.synology.me/login/google/callback
ADMIN_SIGNUP_SECRET=
EOF
chmod 600 /volume1/app/myhomebase/.env
```

**The music root is a DSM path here, not the UNC path the Windows dev box uses**
(`//NAS_DS223/MEDIA/AUDIO`) — the same share, reached from the inside. It is read-only:
nothing in the app writes to that folder. Leaving it blank switches the Music Library's
scanning off; **it is read once at startup, so adding it to an existing install needs an
app restart** (§ *Restart*), not just a page reload.

**The journal's photo archive is NOT set here.** It lives in the app, at **My Journal →
Configuration → Photo folder**, with a **Check Access** button that reports exactly what
the app can see at that path — the year folders it found, and whether it could read files
inside them. Set it there (`/volume1/MEDIA/PHOTO/BY YEAR` on the NAS) and press Check
Access; no restart, and a wrong value can be corrected in the browser instead of over SSH.
A legacy `MYHOMEBASE_PHOTO_ROOT` is still honoured as a fallback if an install already has
one, but the setting wins.

Copy the Google and admin-secret values from
`E:\Code\Claude_Project\MyHomeBase\.env.local`. Leaving the Google ones blank simply
disables Google sign-in; password login still works.

**Google sign-in also needs the new redirect URI registered.** Google Cloud Console →
APIs & Services → Credentials → your OAuth client → **Authorised redirect URIs** → add
`https://mhb.yourname.synology.me/login/google/callback`, exactly.

### 5.3 Bring the data over

Stop the Windows app first so SQLite checkpoints cleanly, then copy **all three** files —
committed rows can still be sitting in the WAL:

```powershell
scp C:\webapp\MHB\data\myhomebase.db* ssh_user@NAS_DS223:/volume1/app/myhomebase/data/
```

```bash
ls -la /volume1/app/myhomebase/data/
# myhomebase.db (~5.8 MB), myhomebase.db-wal, myhomebase.db-shm
```

### 5.4 Migrate and start

```bash
cd /volume1/app/myhomebase
node --env-file-if-exists=.env migrate.cjs
NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 node server.js
```

Run it in the foreground the first time so errors are visible. Expect `✓ Ready`, then
load `https://mhb.yourname.synology.me` and sign in.

---

## Part 6 — Start on boot, restart on crash

Without Docker there is no restart policy, so this is built from a script plus two
scheduled tasks. The same script does three jobs — start at boot, restart after a crash,
and switch to a new build when a publish leaves a `deploy.trigger` behind. After that
last one it also runs `set-startup-message.cjs`, so the next visitor to the home screen
is told a new deployment is live; a crash-restart deliberately skips that.

A triggered deploy **also applies any pending migrations** (`migrate.cjs`) in the
window after the old process stops and before the new one binds. Like the startup
message, it's gated on that trigger, so a crash-restart never migrates — a new
schema should arrive with a new build, not because the process happened to die.
A failed migration stops the start outright rather than serving a build against a
schema that didn't land.

**Copy it from the repo** (`start.sh` at the root) rather than retyping, then:

```powershell
# from Windows
scp start.sh ssh_user@NAS_DS223:/volume1/app/myhomebase/
```
```bash
chmod +x /volume1/app/myhomebase/start.sh
```

> Keep the repo copy as the source of truth — it is **excluded from the publish** on
> purpose, so a republish can't overwrite the file the boot task runs or strip its `+x`
> bit. Re-copy it by hand on the rare occasion it changes.


Start it and confirm:

```bash
/volume1/app/myhomebase/start.sh
sleep 3
curl -sI http://localhost:3000/login | head -1      # HTTP/1.1 200 OK
```

Run it a second time — it should return instantly, and
`cat /volume1/app/myhomebase/app.pid` should be unchanged. The script is
**self-guarding**, which is what lets the same script serve as both the boot task and
the keepalive.

Control Panel → **Task Scheduler → Create**, both **User: root**, both running
`/volume1/app/myhomebase/start.sh`:

| Task | Type | Schedule |
|---|---|---|
| `MyHomeBase start` | Triggered Task → User-defined script | Event: **Boot-up** |
| `MyHomeBase keepalive` | Scheduled Task → User-defined script | Daily, repeat every **1 minute** |

**Test it for real: reboot the NAS** and confirm the site returns unaided.

---

## Part 7 — Verify

1. **Log in** on a phone — proves the certificate and the `Secure` cookie.
2. **Home carousel shows module artwork** — exercises the database, the
   `/api/modules/<slug>/carousel-image` route and the 0040 columns together.
3. **Open a ticker → Market tab** — proves outbound HTTPS and the Yahoo crumb handshake
   work from the NAS.

---

## Updating to a new release

> Day-to-day operator steps — deploy, restart, stop — live in
> [ADMIN_MANUAL.md](ADMIN_MANUAL.md). This section is the reference for what the
> publish actually does.

### The one-command way (SMB)

```powershell
cd E:\Code\Claude_Project\MyHomeBase
.\REBUILD_PUBLISH_NAS.bat
```

Builds the package and mirrors it to `\\NAS_DS223\app\myhomebase` — the share DSM
exports for `/volume1/app/myhomebase`. The destination is the `NAS_PATH` variable at the
top of the script; pass a path as an argument to override it for a one-off.

It uses `robocopy /MIR` so files removed in a release disappear rather than piling up,
**with `data\`, `.env`, `start.sh`, `app.log` and `app.pid` excluded** — robocopy never
deletes what it is told to skip, so the live database, your secrets and the NAS-side
launcher survive every republish. Verified against a seeded destination: all five
preserved, a stale file purged.

It deliberately does **not** run migrations. The destination is a Linux box and the
runner has to execute there.

### The restart happens by itself

The batch file drops a `deploy.trigger` file into the app folder after the copy lands.
`start.sh` checks for it on every scheduled run: if it's there, it stops the old process,
deletes the trigger and starts the new build. **A release needs no SSH.**

- **Automatic:** within one keepalive interval (see Part 6).
- **Immediately:** DSM → **Task Scheduler** → select **MyHomeBase keepalive** → **Run**.

The trigger is written *last*, after the copy has fully landed, so the app can never come
back up on a half-copied build. It's also excluded from the mirror, so a second publish
can't delete a pending one.

**Migrations apply themselves on a triggered deploy** — `start.sh` runs
`migrate.cjs` after stopping the old process and before starting the new one, so a
release that adds a migration needs no SSH. This used to be a hand-run step, and
being skippable it was once skipped: the release shipped a screen answering "no
such column". If a migration fails the app deliberately does **not** start; the
keepalive task retries every minute and `app.log` holds the error. Run it by hand
only to diagnose that:

```bash
cd /volume1/app/myhomebase && node --env-file-if-exists=.env migrate.cjs
```

Doing it by hand instead:

```bash
cd /volume1/app/myhomebase
kill "$(cat app.pid)" 2>/dev/null; sleep 2
./start.sh
```

### The manual way (scp)

If the share isn't mounted:

```powershell
npm run publish:nas
scp -r dist-nas/. ssh_user@NAS_DS223:/volume1/app/myhomebase/
```

Note `dist-nas/.`, not `dist-nas/*`. Unlike the batch file this only overwrites — it
never removes files a release has dropped.

---

## Backups

`/volume1/app/myhomebase/data/myhomebase.db` is the entire application state. Options,
best first:

- **Hyper Backup** the `/volume1/app/myhomebase/data` folder on a schedule.
- **Btrfs snapshots** on the parent shared folder.
- Manual: stop the app, then copy `myhomebase.db`, `myhomebase.db-wal` and
  `myhomebase.db-shm` together. Copying the `.db` alone while the app runs can miss
  recent writes still in the WAL.

Never put the database on an SMB/NFS share — SQLite locking is unreliable over network
filesystems, and WAL mode especially so.

---

## Troubleshooting

Everything below actually happened during the first install.

**"Your connection is not private"**
The certificate exists but isn't assigned. Control Panel → Security → Certificate →
**Settings** → point `mhb.yourname.synology.me` at the Let's Encrypt cert. If the error
is `NET::ERR_CERT_COMMON_NAME_INVALID` instead, the certificate is missing the `mhb.`
Subject Alternative Name.

**`Cannot find module 'better-sqlite3-<hash>'` at startup**
The hash-named module is a symlink to a Windows path. Rebuild with
`npm run publish:nas` — it materialises symlinks and now refuses to finish if any
remain. Then delete `.next` and `node_modules` on the NAS and re-copy:
```bash
cd /volume1/app/myhomebase && rm -rf .next node_modules
```

**`.next` missing after copying**
`scp -r dist-nas/*` skipped it: shell globs ignore dot-directories. Use `dist-nas/.`.
Note also that plain `ls` hides it — check with `ls -a` before concluding it's absent.

**`pgrep: command not found`**
DSM is a BusyBox environment. The `start.sh` above uses a PID file and `kill -0`
instead. (A failed `pgrep` returns 127, so an earlier `pgrep … && exit 0` guard would
*not* stop the script — it can leave a duplicate process running.)

**Login bounces straight back to `/login`**
The origin isn't trustworthy, so the `Secure` session cookie was rejected. You're
reaching the app by LAN IP or plain HTTP instead of through the reverse proxy at
`https://mhb.yourname.synology.me`.

**`Permission denied (publickey,password)` when using an SSH key**
Home directory permissions. `chmod 700 ~ && chmod 700 ~/.ssh && chmod 600
~/.ssh/authorized_keys`. DSM frequently creates homes group-writable, which sshd
rejects.

**Database errors, or data that looks out of date**
Check `MYHOMEBASE_DB` in `/volume1/app/myhomebase/.env` matches the real path — the
folder is `/volume1/app/` (singular). When it's wrong or unset the app falls back to
`./data/myhomebase.db` relative to the working directory, which can silently be a
different file.

**App won't start and the terminal shows nothing**
It's running detached — look in `/volume1/app/myhomebase/app.log`.

---

## Reference

| | |
|---|---|
| App directory | `/volume1/app/myhomebase` |
| Database | `/volume1/app/myhomebase/data/myhomebase.db` |
| Environment file | `/volume1/app/myhomebase/.env` |
| Log | `/volume1/app/myhomebase/app.log` |
| PID file | `/volume1/app/myhomebase/app.pid` |
| Start script | `/volume1/app/myhomebase/start.sh` |
| Port | 3000 (localhost only; DSM's reverse proxy publishes 443) |
| Node | `/usr/local/bin/node` — Package Center v20, **ABI 115** |
| Env vars | `MYHOMEBASE_DB`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ADMIN_SIGNUP_SECRET` |
| Build command | `npm run publish:nas` in `E:\Code\Claude_Project\MyHomeBase` → `dist-nas/` |
| Build + deploy | `.\REBUILD_PUBLISH_NAS.bat` (SMB, preserves data/env/start.sh) |
| Deploy only (manual) | `scp -r dist-nas/. ssh_user@NAS_DS223:/volume1/app/myhomebase/` |
| SMB share | `\\NAS_DS223\app\myhomebase` |
