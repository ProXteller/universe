# Hosting UniVerse for free

This puts UniVerse on a small Linux server in Microsoft Azure, paid for by **Azure for Students**: no credit card,
free for 12 months, and renewable every year while you're a student. Everything lives on that server, not on your
Mac: the app, the database, the photos and videos people upload, and a nightly backup.

After the one-time setup (about 30–45 minutes), updating the live app is just `git push`. The server checks GitHub
every 2 minutes, builds the new version, and switches to it. If a change doesn't build, or the app doesn't start, the
old version stays live, so a bad push never takes the site down.

The same files work on any Ubuntu 24.04 server that accepts cloud-init "custom data", for example Oracle Cloud's
Always Free tier.

## What's in this folder

| File | What it is |
|---|---|
| `cloud-init.yaml` | The one thing you paste when you create the server. It installs everything. |
| `vm/bin/universe-config` | The command you run on the server to configure it (address, admins, email, status). |
| `vm/bin/universe-deploy` | Pulls the newest commit from GitHub, builds it, and switches to it (with automatic rollback). |
| `vm/bin/universe-backup` | Nightly database backup, kept for 14 days. |
| `vm/systemd/*`, `vm/Caddyfile.template`, `vm/bootstrap.sh` | The service, timers, HTTPS web server config and first-boot setup. |
| `make-cloud-init.mjs` | Rebuilds `cloud-init.yaml` after you change anything in `vm/`. |

---

## One-time setup

### 0. Push your latest code to GitHub

The server deploys whatever is on the `main` branch of your GitHub repo, so push the version you want live:

```bash
cd ~/Desktop/Projects/universe
git push
```

### 1. Get Azure for Students

Go to **azure.microsoft.com/free/students**, click **Start free**, and sign in with your Texas State email. It asks you
to verify that you're a student. No credit card is needed. You get $100 of credit plus a set of free services for 12
months, including one small server.

### 2. Create the server

In the Azure portal: **Create a resource → Virtual machine**, then fill in:

| Setting | Value |
|---|---|
| Resource group | **Create new** → `universe` |
| Virtual machine name | `universe` |
| Region | Any US region that has the size below (e.g. East US, Central US) |
| Image | **Ubuntu Server 24.04 LTS – x64 Gen2** |
| Size | **B2ats v2** (free for 12 months). If it's not offered, **B1s** (also free). |
| Authentication type | SSH public key. Let Azure generate a new key pair and download it when asked. You won't need it day to day; keep it somewhere safe. |
| Public inbound ports | **Allow selected ports**: SSH (22), HTTP (80), HTTPS (443) |
| Disks → OS disk type | Standard SSD |
| **Advanced → Custom data** | Paste the **entire** contents of `deploy/cloud-init.yaml` |

Click **Review + create → Create**. The server boots and installs everything on its own, which takes about 5–10 minutes.

### 3. Give the server a web address

Open the new VM. On **Overview**, next to **DNS name**, click **Not configured**. Enter a label such as
`universe-ssvay`, then **Save**. Back on Overview, the DNS name now looks like
`universe-ssvay.eastus.cloudapp.azure.com`. That's your app's address for now.

### 4. Let the server read your GitHub repo

On the VM, open **Operations → Run command → RunShellScript**, paste this and click **Run**:

```bash
universe-config deploy-key
```

It prints one line starting with `ssh-ed25519`. Copy that line, then on GitHub go to your **universe** repo →
**Settings → Deploy keys → Add deploy key**. Title it `Azure server`, paste the key, leave **Allow write access**
unticked, and click **Add key**.

This key was created on the server and only lets it *read* this one repo. Your GitHub password and other repos stay
out of it.

### 5. Turn on HTTPS and make yourself the admin

Run command again, with your own address and email:

```bash
universe-config domain universe-ssvay.eastus.cloudapp.azure.com
universe-config admin your-email@txstate.edu
```

Within about 5 minutes the first deploy finishes. Check it with:

```bash
universe-config status
```

You're looking for `Live: commit …` and `App: running`. Then open `https://<your address>` on your phone or laptop.

### 6. Turn on sign-in emails

Sign-in codes are emailed, so nobody can log in until email works. UniVerse uses **Resend** (free: 3,000 emails a
month, 100 a day).

**Right away, just for you.** Create a Resend account at **resend.com** using the **same email you made admin**.
Go to **API Keys → Create API key** (Sending access), copy the key, and run:

```bash
universe-config email re_your_key_here "UniVerse <onboarding@resend.dev>"
```

Resend's test sender only delivers to your own Resend email, so you can sign in and try the live app, but students
can't yet.

**For everyone.** You need a domain:

1. Claim the **GitHub Student Developer Pack** (education.github.com/pack). Among other things it includes a free
   1-year domain (for example a `.me` domain through Namecheap).
2. In Resend: **Domains → Add domain**, enter your domain, and Resend shows a few DNS records.
3. In Namecheap: **Domain List → Manage → Advanced DNS**. Add each record exactly as Resend shows it, then click
   **Verify** in Resend. This usually takes minutes, sometimes a few hours.
4. Switch the sender:

   ```bash
   universe-config email re_your_key_here "UniVerse <login@yourdomain.me>"
   ```

**Optional: use your domain for the app too.** In Namecheap, add an **A record** for host `@` pointing to the
server's **Public IP address** (on the VM's Overview page). Then run:

```bash
universe-config domain yourdomain.me
```

---

## Making changes after launch

Nothing changes in how you work: edit on your Mac, try it locally (`npm run dev`), then:

```bash
git add -A
git commit -m "what you changed"
git push
```

About 2–5 minutes later it's live. To check, run `universe-config status` (Azure → VM → Run command).

- **If the new version doesn't build or doesn't start**, the old one keeps running. `status` shows the skipped commit.
  Fix it and push again.
- **Your data is never touched by a deploy.** It lives in `/var/lib/universe` on the server. Each version of the app
  lives in its own folder under `/opt/universe/releases`.
- **`npm run db:reset` only ever affects your Mac.** The live database is separate.
- **Changing the database structure:** new tables and columns must be *added*, never dropped or renamed, so the live
  posts survive. (Buzz's new `title` / `media` / `scope` columns are added this way, in
  `server/src/services/buzz/schema.ts`.)

## Commands

Run these in **Azure → VM → Operations → Run command → RunShellScript** (or over SSH with `sudo`).

| Command | What it does |
|---|---|
| `universe-config status` | What's live, the address, admins, email, disk space, the deploy key |
| `universe-config domain <name>` | Serve the app at `https://<name>` |
| `universe-config admin <email> [moderator]` | Let someone sign in as staff (they can moderate Buzz) |
| `universe-config email <key> "<Name <from@domain>>"` | Turn on sign-in emails |
| `universe-config deploy` | Deploy the newest commit right now |
| `universe-config logs` | The app's recent log |
| `universe-config backup` | Back up the database now (nightly backups run on their own) |

If a setting stops the app from starting (for example a malformed email), `universe-config` puts the previous settings
back automatically.

## Costs and limits

- **Azure for Students:** $100 credit plus free services for 12 months, no credit card, renewable each year while
  you're a student. The server itself (B2ats v2 or B1s) is in the free allowance. Its disk and public IP address may
  cost a few dollars a month, which come out of the $100 credit. Azure doesn't charge you without your say: when the
  credit runs out, it emails you and only continues if you choose to switch to pay-as-you-go. Otherwise the server is
  switched off. Check **Cost Management** once in a while to see what it uses.
- **Size:** the server has 1 GB of memory, which is plenty for a pilot with a few hundred students. When you outgrow
  it, resize the VM in Azure (a few clicks) or move to a bigger host.
- **Backups:** the database is backed up every night to `/var/lib/universe/backups` (14 days). Uploaded photos and
  videos are on the same disk, which Azure stores redundantly, but they aren't copied anywhere else.

## Later: moving to Vercel + Supabase

That's a good long-term setup, but it's a bigger change than switching hosts. Vercel can host the web app but not this
server (it needs to run all the time for real-time chat), and Supabase means moving the database from SQLite to
Postgres and uploads to Supabase Storage. Plan it as its own project once the features settle. Until then, this server
runs the app exactly as it runs on your Mac.

## Changing the server setup itself

Edit files in `deploy/vm/`, then run `node deploy/make-cloud-init.mjs` and push. Running servers pick up changes to
`vm/bin`, `vm/systemd` and the Caddy template on their next deploy. `cloud-init.yaml` only matters when you create a
new server.
