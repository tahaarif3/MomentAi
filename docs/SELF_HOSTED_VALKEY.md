# Self-hosted Valkey for App Platform

This deployment runs Valkey on a dedicated 1 GB DigitalOcean Droplet and lets
App Platform reach it only through a VPC private IP. The web browser never
connects to Valkey.

## Required topology

1. Create a 1 GB Ubuntu Droplet in the VPC datacenter compatible with the App
   Platform app's region.
2. In App Platform, enable that VPC under **Networking > Private Network**.
3. Create a DigitalOcean cloud firewall for the Droplet. Allow TCP 6379 only
   from the App Platform VPC private egress IP; do not allow it from the
   public internet. Allow SSH only from the operator's trusted IP address.
4. Install Docker Engine and the Docker Compose plugin on the Droplet.

## Deploy Valkey

```bash
git clone https://github.com/tahaarif3/MomentAi.git
cd MomentAi
git switch codex/queue-cost-optimizations
cd deploy/valkey
cp .env.example .env
```

Edit `.env`: set `VALKEY_PRIVATE_IP` to the Droplet's VPC private IPv4, then
generate a password with `openssl rand -hex 32`.

```bash
sudo docker compose up -d
sudo docker compose ps
sudo docker exec momentai-valkey sh -c 'valkey-cli -a "$VALKEY_PASSWORD" ping'
```

The final command must return `PONG`.

## Configure App Platform

In App Platform's environment variables, set `REDIS_URL` to:

```text
redis://:URL_ENCODED_VALKEY_PASSWORD@VALKEY_PRIVATE_IP:6379
```

The documented hex password can be used directly in this URL. If you choose a
different password format, URL-encode characters such as `@`, `:`, `/`, or `#`.

Deploy the app, then generate one playlist and verify the app logs include
`[Redis] Connected successfully` and `[Worker] BullMQ playlist generation worker started`.

## Backups and recovery

The container uses append-only-file persistence. Enable weekly Droplet backups
or regular snapshots in DigitalOcean; Docker volumes do not protect against a
lost Droplet. Never run `docker compose down -v`, because `-v` deletes queue
data.

## Switching to DigitalOcean Managed Valkey later

No code migration is needed. Create the managed Valkey cluster, allow the App
Platform VPC, and replace only `REDIS_URL` with the TLS connection URI provided
by DigitalOcean (normally `rediss://...`). Redeploy App Platform, confirm a
playlist completes, then retire the Droplet after its pending jobs drain.
