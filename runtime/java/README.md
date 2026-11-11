# Adminerva Java Interactive Runtime — deployment required

This directory contains a standalone, open-source, authenticated Java runner. **It is not hosted by GitHub Pages and is not active until deployed on a separate Linux runtime server.** The Student Studio continues using Judge0 until `js/student/runtime-config.mjs` is configured.

## Pilot configuration

- `MAX_ACTIVE_SESSIONS=8` is the scheduler's default ceiling, **not a guaranteed capacity** on a free VM.
- `MAX_PENDING_SESSIONS=200` controls queued requests.
- One queued/active request per Firebase UID.
- Every queue request contains an immutable snapshot of the project's Java source.
- A queued student may read, switch, search, zoom, and scroll code, but cannot modify it until the execution finishes or the request is cancelled.
- Java runs in an isolated rootless Docker container: no network, capped memory, CPU, PIDs and lifetime, dropped capabilities, read-only frozen source mount, and an ephemeral writable working directory.
- Sessions occupy slots while waiting for Java `System.in` input.

## Requirements

A dedicated Linux machine with Node.js 22+, **rootless Docker with systemd/cgroup v2**, image storage, and a valid HTTPS domain/reverse proxy that supports WebSockets. Configure `FIREBASE_PROJECT_ID` to verify Firebase Auth ID tokens using Google's public JWKs. **No Firebase Admin private key is required or should be placed on the VM.** Keep the runtime isolated from Adminerva administrative infrastructure.

**Oracle Cloud Always Free setup:** see [deploy/oci-always-free.md](deploy/oci-always-free.md) for the full VM, SSH, TLS, systemd, and activation walkthrough.

Build:

```bash
cd runtime/java
docker build -t adminerva/java17-runner:pilot .
npm install
ALLOWED_ORIGIN=https://adminerva-org.github.io FIREBASE_PROJECT_ID=reporeview-e7ca4 MAX_ACTIVE_SESSIONS=8 MAX_PENDING_SESSIONS=200 npm start
```

Environment also supports `PORT=8787`, `DOCKER_IMAGE=adminerva/java17-runner:pilot`, `IDLE_SESSION_SECONDS=300`, `MAX_SESSION_SECONDS=900`, `DISCONNECT_GRACE_SECONDS=120`.

The server binds to `127.0.0.1` by default. Publish through an HTTPS reverse proxy with WebSocket upgrade support, then set `ADMINERVA_RUNTIME_ORIGIN` in `js/student/runtime-config.mjs` to that exact HTTPS origin. The proxy must pass `Authorization` headers. If origin is left blank, no queue is simulated, and the existing Judge0 path is unchanged.

## API

- `POST /v1/executions` with Firebase ID token and `{files:{'Main.java':'...'},entry:'Main.java'}`: captures immutable source and starts/queues execution; returns a session ID, queue position, and WebSocket stream secret.
- `GET /v1/executions/current` with Firebase ID token: recover your queued/running request, stream credentials, and immutable review snapshot after refresh.
- `GET /v1/executions/:id` with Firebase ID token: current server state.
- `DELETE /v1/executions/:id` with Firebase ID token: cancel queue or terminate process.
- WebSocket `/v1/executions/:id/stream` with protocols `adminerva-runtime` and `key.<streamToken>`: live JSON events (`status`, `stdout`, `stderr`, `exit`), incoming `stdin` and `stop`.
- `GET /health`: total active and queued counts, without individual identity data.

## Security and operational limits

This pilot scheduler is **single-instance and in-memory**. Server restarts lose the queue, and multiple replicas are unsupported. Container runtime security must be assessed on the selected host before allowing student-generated arbitrary code. Use a dedicated VM, a rootless Docker daemon with actively enforced cgroup limits, network and filesystem isolation, log/retention policy, and constrained reverse proxy. The runtime refuses to start as root or against a non-rootless/non-systemd Docker daemon. The Java `runner` image runs as non-root, but a container is not a perfect security boundary.

Eight simultaneous Java processes can exceed the CPU or memory allowance of a small free server. Set `MAX_ACTIVE_SESSIONS` lower until concurrency, compilation latency, and sandbox isolation are validated on actual infrastructure. The queue limit and runtime limit are independent.
