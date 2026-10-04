// Correctness check: re-runs single threads through the same shader and compares
// the GPU output against crypto.subtle's SHA-256, applied twice. Kept outside
// the timed path.

import { runShader, hexStringToUint32Array, PROBE_INPUT } from './probe.js';

const PASS_ALL_THRESHOLD = 'ff'.repeat(32);

function toHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reference double SHA-256 of (76-byte input || big-endian index). */
async function expectedDigest(inputBytes, index) {
    const msg = new Uint8Array(80);
    msg.set(inputBytes, 0);
    msg[76] = (index >>> 24) & 0xff;
    msg[77] = (index >>> 16) & 0xff;
    msg[78] = (index >>> 8) & 0xff;
    msg[79] = index & 0xff;
    const first = await crypto.subtle.digest('SHA-256', msg);
    const second = await crypto.subtle.digest('SHA-256', first);
    return toHex(new Uint8Array(second));
}

/**
 * Verify one input index on the GPU.
 * itercount = index and totalThread = 1 make baseIndex = index, and with a
 * 1x1x1 workgroup and a 1x1x1 dispatch the only invocation has
 * global_invocation_id = (0,0,0), so it processes exactly that index. The
 * all-0xFF threshold makes the shader always write its output out.
 */
async function verifyIndex(device, index) {
    const inputArray = hexStringToUint32Array(PROBE_INPUT);
    const thresholdArray = hexStringToUint32Array(PASS_ALL_THRESHOLD);
    const inputBytes = Uint8Array.from(inputArray);

    const res = await runShader(device, inputArray, thresholdArray, 1, 1, 1, 1, 1, 1, index, 1, true);
    const expected = await expectedDigest(inputBytes, index);

    if (!res || !res.success) {
        return { index, ok: false, gpu: '(no output written)', expected };
    }
    const reportedIndex = (res.index[0] << 24) | (res.index[1] << 16) | (res.index[2] << 8) | res.index[3];
    return {
        index,
        ok: res.hash === expected && (reportedIndex >>> 0) === (index >>> 0),
        gpu: res.hash,
        expected,
        reportedIndex: reportedIndex >>> 0,
    };
}

/**
 * Check the first, middle and last thread of a planned dispatch. Throughput
 * runs use baseIndex = 1, so thread i of such a run processes index 1 + i; the
 * same indices are re-checked here one thread at a time.
 */
export async function verifyDispatch(device, plan) {
    const n = plan.achievedThreads;
    const indices = [1, 1 + Math.floor((n - 1) / 2), 1 + (n - 1)];
    const unique = [...new Set(indices.map((v) => v >>> 0))];
    const results = [];
    for (const index of unique) {
        results.push(await verifyIndex(device, index));
    }
    return results;
}

export { verifyIndex, expectedDigest };
