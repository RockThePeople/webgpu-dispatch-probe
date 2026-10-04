# WebGPU Dispatch Probe

WebGPU compute probe used in *Device-Aware Dispatch Sizing and QoE-Aware Work Allocation for WebGPU Compute* (under review).

Each thread computes SHA-256 twice over its own 80-byte input, and the total thread count *N* is issued as a single `dispatchWorkgroups()` call. The page reports execution time and throughput per *N* and exports the results to Excel or CSV.

## Run

```bash
npm ci
npm run dev
```

Open the printed `localhost` URL in Chrome with WebGPU enabled.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
