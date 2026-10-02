# WebGPU Dispatch Probe

A single-page WebGPU probe that hashes one independent SHA-256 input per thread and
measures how execution time and throughput scale with the total dispatch volume *N*.

Reference implementation for **_Device-Aware Dispatch Sizing and QoE-Aware Work
Allocation for WebGPU Compute_** (under review).

**Live demo:** <https://rockthepeople.github.io/webgpu-dispatch-probe/>

> The page goes live once the Pages workflow has run for the first time. Pages is
> already configured to build from GitHub Actions; see [Deployment](#deployment).

## What this is

- A SHA-256 WGSL compute shader. Each invocation derives its own nonce from
  `global_invocation_id`, so every thread hashes a **distinct 80-byte message**
  (76-byte block header ‖ 4-byte big-endian nonce) with double SHA-256.
- The total dispatch volume is `N = workgroup_size × workgroup count`, chosen by the
  caller and submitted as **one `dispatchWorkgroups()` call in one queue submit**. When
  the workgroup count exceeds the per-dimension limit (65535), it is spread over y and z
  and the shader flattens `(x, y, z)` back to a single nonce index — still one dispatch.
- Per-*N* execution time and throughput (MH/s), with a configurable repeat count, and
  export to Excel or CSV.
- An on-page correctness check that compares the GPU digest against
  `crypto.subtle.digest('SHA-256', …)` applied twice.

Out of scope, by design: the PSP auction, the coordinator, socket transport, video
playback, frame-rate measurement, and coefficient fitting. This repository is only the
measurement probe.

## Run

**Live:** open the GitHub Pages link above. Pages is served over HTTPS, which satisfies
WebGPU's secure-context requirement.

**Local:**

```bash
npm ci
npm run dev      # then open the printed http://localhost:5173/ URL
```

`localhost` counts as a secure context, so WebGPU works without HTTPS.

**Requirements:** a Chrome with WebGPU enabled (Chrome 113+; the paper's measurements
used **Chrome 144**). On Linux, WebGPU may still need `--enable-unsafe-webgpu`. The page
prints the adapter vendor, architecture and description plus
`maxComputeWorkgroupsPerDimension`, `maxComputeInvocationsPerWorkgroup` and
`maxStorageBufferBindingSize`, so you can record exactly what you ran on.

> Large *N* can trip the GPU watchdog and lose the device. The page handles
> `device.lost` and tells you instead of hanging; reduce *N* and reload.

## Measurement procedure used in the paper

### Devices

| Device | OS | Backend | Driver |
|---|---|---|---|
| MacBook Pro M1 Pro | macOS 26 | Metal | — |
| MacBook Air M2 | macOS 26 | Metal | — |
| NVIDIA RTX 2060 Super | Ubuntu 22.04 | Vulkan | 580.95.05 |
| NVIDIA RTX 2070 Super | Ubuntu 22.04 | Vulkan | 580.95.05 |
| NVIDIA RTX A5000 | Ubuntu 22.04 | Vulkan | 580.95.05 |
| NVIDIA RTX 3090 | Ubuntu 22.04 | Vulkan | 580.95.05 |

Browser: Chrome 144 on all devices.

### Throughput r(n)

Run the sweep on this page (1, 2, 4, …, 1024 × 10⁶ threads), then export the result
file. Each point discards one warm-up run and then averages the repeat runs with a plain
mean.

<!-- TODO(authors): confirm the repeat count used for the published numbers.
     The paper states a 5-run average; the measurement code's default was 3.
     This page defaults to 3 (the code default) until that is confirmed. -->

### Timing method

`performance.now()` is read before buffer and pipeline creation and again after the
result buffer's `mapAsync()` resolves; `mapAsync()` completion is the GPU-work barrier.
No timestamp-query is used. Shader-module and pipeline creation fall **inside** the timed
window, exactly as in the code that produced the paper's numbers — this inflates the
measured time at small *N*, where that fixed cost is a large fraction of the total.

### Concurrent video frame rate

Frame rate was recorded **manually** by the authors from YouTube's playback statistics
while a dispatch was running in the same browser. It is not measured by this page and no
code for it is included here.

<!-- TODO(authors): fill in -- which YouTube video (URL/length), the quality setting
     pinned (1080p, 30 fps), which statistics panel or log the value was read from
     ("Stats for nerds" → ?), exactly which field was recorded, how long each
     observation ran, and how the repeats were averaged. -->

### Fig. 3 GPU process trace

<!-- TODO(authors): fill in -- the collection tool (chrome://tracing, Perfetto, …),
     the categories enabled, and the capture procedure for the idle / 1M-thread /
     256M-thread traces. -->

### Not included here

Frame-rate measurement and coefficient fitting were performed manually and are not part
of this repository.

## Deployment

GitHub Pages is already enabled for this repository with the source set to **GitHub
Actions**, and `vite.config.js` sets `base: '/webgpu-dispatch-probe/'` to match the
repository name. `.github/workflows/pages.yml` runs `npm ci && npm run build` on every
push to `main` and publishes `dist/`.

## Data

The authors' raw measurement files will be added under [`data/`](data/).

<!-- TODO(authors): add the Excel raw data for the six devices above. -->

## Third-party code

The SHA-256 WGSL core is derived from third-party code whose exact origin is still being
confirmed. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — this matters for
licensing, because one candidate origin is Apache-2.0.

## License

MIT, except as noted in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). See
[LICENSE](LICENSE).

## Citation

<!-- TODO(authors): add the citation block once the paper has a venue/DOI. -->

```
Device-Aware Dispatch Sizing and QoE-Aware Work Allocation for WebGPU Compute.
Under review, 2026.
```
