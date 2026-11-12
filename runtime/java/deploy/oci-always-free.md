# Adminerva Java Runtime — Oracle Cloud Always Free pilot

**Status:** Deployment guide. The runtime is NOT active merely because its source files are on GitHub Pages. A Linux VM with a public HTTPS endpoint is required.

## 1. Create the free VM

Sign up at https://www.oracle.com/cloud/free/ using an account you control. Oracle typically requires phone/card verification but does not charge for Always Free usage unless you explicitly use paid resources. Select the **home region carefully**: Always Free VM resources must be created there.

In the OCI Console: **Compute → Instances → Create instance**.

- Image: **Ubuntu 24.04 ARM64** (or supported ARM64 Ubuntu LTS).
- Shape: **VM.Standard.A1.Flex**, labeled **Always Free eligible**.
- Allocation: **2 OCPUs, 12 GB RAM** (the current Always Free monthly equivalent; availability varies by region).
- SSH: provide your **own public SSH key**; keep its private half on your device.
- Storage: stay within the Always Free block-volume allocation.
- Networking: attach a public IPv4 address. Configure OCI ingress and the Linux firewall to allow only SSH (ideally only from administrator IPs), TCP 80 and TCP 443. **Do not expose port 8787 or Docker API ports.**

If the Always Free A1 shape is unavailable, do not accidentally select a billable shape. Stop and choose another available Always Free offering or wait for capacity.

## 2. Prepare the Ubuntu VM

Connect from your own device:

```bash
ssh -i ~/.ssh/your_oci_key ubuntu@YOUR_VM_PUBLIC_IP
```

Install current Node.js **22 or newer**, Git, and the official Docker Engine packages for Ubuntu using:

- https://nodejs.org/en/download
- https://docs.docker.com/engine/install/ubuntu/
- https://docs.docker.com/engine/security/rootless/

Configure **rootless Docker** for the normal `ubuntu` user, enable its user service at boot, and use cgroup v2 + systemd. Follow Docker's documentation for `uidmap`, `docker-ce-rootless-extras`, and `dockerd-rootless-setuptool.sh install`. Do not use `sudo docker` for the student runtime.

Important: resource caps are reliable only when rootless Docker is using the systemd cgroup driver and the CPU, memory, and PID cgroup controllers are delegated. Docker documents this in https://docs.docker.com/engine/security/rootless/tips/ . If CPU delegation is missing, configure `user@.service` delegation per Docker's official instructions **before accepting arbitrary student code**.

A basic environment preparation (run as normal user, not root):

```bash
git clone https://github.com/Adminerva-Org/Adminerva.git ~/Adminerva
cd ~/Adminerva/runtime/java
mkdir -p ~/.config/adminerva-runtime ~/.config/systemd/user
cp deploy/runtime.env.example ~/.config/adminerva-runtime/runtime.env
chmod 600 ~/.config/adminerva-runtime/runtime.env
bash deploy/check-host.sh
npm install --omit=dev
docker build -t adminerva/java17-runner:pilot .
```

The project ID is publicly identifiable and does **not** require service-account credentials. The runtime verifies Firebase ID tokens using Google's rotating public JWKs, with `FIREBASE_PROJECT_ID=reporeview-e7ca4`. Unlike the Firebase Admin SDK, this does not support immediate revocation checks. Access tokens expire normally; sessions are short-lived and explicitly bounded. Do not place Firebase service-account private keys on the VM.

## 3. Keep the Node service running

The sample user-level unit is `deploy/adminerva-java-runtime.service`. It expects the repository at `~/Adminerva`, Node installed as `/usr/bin/node`, and rootless Docker to be active.

```bash
cp deploy/adminerva-java-runtime.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now adminerva-java-runtime.service
systemctl --user status adminerva-java-runtime.service
curl http://127.0.0.1:8787/health
```

Only `127.0.0.1:8787` is bound by Node. Do not change it to `0.0.0.0` to expose the server directly.

The service currently uses **one in-memory scheduler instance**. Do not run multiple copies against the same user pool, or their independent queues would each permit up to eight active sessions.

## 4. Enable HTTPS and WebSockets

Use a hostname you control, such as `runtime.example.edu.ph`, and point its DNS A record to the VM's public IPv4 address. Install Caddy according to https://caddyserver.com/docs/install .

Copy `deploy/Caddyfile.example` to the server's Caddy configuration, replace the example hostname, and reload the Caddy service. Caddy manages HTTPS certificates and automatically proxies WebSocket upgrades.

On OCI networking and Ubuntu firewall, permit TCP **80 and 443** to Caddy. SSH should be limited to the administrator's IP where practical. Do not open the runtime process or Docker socket to the internet.

The HTTPS endpoint should respond:

```bash
curl https://YOUR_RUNTIME_HOSTNAME/health
```

Example response (not a measured server capacity):

```json
{"ok":true,"active":0,"queued":0,"activeLimit":8}
```

## 5. Activate Adminerva Studio only after the VM is secure

Edit `js/student/runtime-config.mjs` in the GitHub repository to use your actual origin:

```javascript
export const ADMINERVA_RUNTIME_ORIGIN = 'https://YOUR_RUNTIME_HOSTNAME';
```

Publish that single change only after the runtime is reachable, authenticated, and sandboxed; refresh the Studio script cache version if needed. Until then, **keep the origin empty** and the existing Judge0 runner remains active.

Student Studio's Java console path will then:

1. Show preliminary Java syntax/structure problems in Monaco.
2. Present a pre-run readiness dialog.
3. Save the immutable project snapshot.
4. Lock code modification while permitting read-only navigation and zoom.
5. Join a server-side queue with live position and cancellation.
6. Start a live Java process when a runtime slot is free.
7. Stream stdin/stdout over the secure WebSocket until the program exits.
8. Unlock the original project after execution finishes or cancellation is confirmed.

If the student refreshes, the service can recover the active queue request and show a temporary read-only view of the exact server-frozen code; this does not replace their saved project files.

## 6. Capacity and operating policy

| Setting | Pilot default | Notes |
|---|---:|---|
| `MAX_ACTIVE_SESSIONS` | 8 | **Ceiling**, not guaranteed throughput on 2 OCPUs |
| `MAX_PENDING_SESSIONS` | 200 | Pending authenticated requests |
| `IDLE_SESSION_SECONDS` | 300 | Five minutes without stdin/output |
| `MAX_SESSION_SECONDS` | 900 | Fifteen-minute hard limit |
| `DISCONNECT_GRACE_SECONDS` | 120 | Grace period to reconnect |
| Maximum Java project | 250 KB | Runtime source/text files |
| Per-container memory | 512 MB | Node service still needs memory |
| Per-container CPU | 0.5 CPU | Can contend on a 2-OCPU VM |
| Output limit | 1 MB | Prevent unlimited terminal streams |

The runner permits temporary file and CSV writes inside a capped in-memory workspace; these files disappear after execution and do not overwrite the saved project. Databases and external network access are not provided by this first console runtime.\n\nEven eight isolated Java processes may create significant compilation contention on a small free VM. The actual safe number must be measured on that VM. Reduce `MAX_ACTIVE_SESSIONS` if student wait times, memory pressure, or CPU utilization become excessive. **A queue of 200 does not mean 200 simultaneously running JVMs.**

When the VM is reclaimed, rebooted, or the Node service restarts, its in-memory queue is lost; students may need to request execution again. A durable scheduler can be added after the pilot.

## Important limitations

- This first execution backend handles **Java console applications**, not general unrestricted shell access.
- The current Studio interface streams true stdin/stdout but does not yet use the optional xterm.js terminal renderer.
- Runs do not get privileged network access, Maven downloads, access to Firebase credentials, or arbitrary Docker host mounts.
- Containers are defense-in-depth, not a formally proven sandbox. Keep the VM dedicated to student execution with no administrative secrets.
- The service's authentication verifies cryptographic signatures, project audience, issuer, and expiry. **Revoked Firebase tokens may remain valid until expiry** without Admin SDK revocation checks. Limit pilot participants and session lifetimes accordingly.
- Free VM availability and reclaim behavior are controlled by the hosting provider, not Adminerva.

## Before opening to a class

Confirm the Docker daemon is **rootless**, CPU/memory/PID limits are actively enforced, HTTPS/WebSockets work, Firebase tokens are verified, and users can cancel and rejoin safely. Keep the browser-facing queue disabled until these conditions hold.
