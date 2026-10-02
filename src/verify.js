// Correctness check (P4).
//
// Runs the UNMODIFIED measurement shader with a single thread and an all-0xFF
// target -- so the thread's digest is always written out -- then compares it
// against window.crypto.subtle's SHA-256. This is deliberately kept out of the
// timed path: it uses its own runShader() calls and never touches the loop in
// measurePoint().
//
// What the shader hashes, per src/shader.wgsl.js:
//   message = input[0..75] (76-byte header) || nonce as 4 big-endian bytes
//   digest  = SHA-256(SHA-256(message))
// A JS transliteration of the WGSL was checked against Node's crypto for
// nonce = 0, 1, 12345, 0xdeadbeef and 0xffffffff: all five matched, so a
// mismatch on this page means the GPU, not the expectation, is wrong.

import { runShader, hexStringToUint32Array, PROBE_HEADER } from './probe.js';

const ALL_FF_TARGET = 'ff'.repeat(32);

function toHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reference double SHA-256 of (76-byte header || big-endian nonce). */
async function expectedDigest(headerBytes, nonce) {
    const msg = new Uint8Array(80);
    msg.set(headerBytes, 0);
    msg[76] = (nonce >>> 24) & 0xff;
    msg[77] = (nonce >>> 16) & 0xff;
    msg[78] = (nonce >>> 8) & 0xff;
    msg[79] = nonce & 0xff;
    const first = await crypto.subtle.digest('SHA-256', msg);
    const second = await crypto.subtle.digest('SHA-256', first);
    return toHex(new Uint8Array(second));
}

/**
 * Verify one nonce on the GPU.
 * itercount = nonce and totalThread = 1 make baseNonceOffset = nonce, and with
 * a 1x1x1 workgroup and a 1x1x1 dispatch the only invocation has
 * global_invocation_id = (0,0,0), so it hashes exactly that nonce.
 */
async function verifyNonce(device, nonce) {
    const headerArray = hexStringToUint32Array(PROBE_HEADER);
    const targetArray = hexStringToUint32Array(ALL_FF_TARGET);
    const headerBytes = Uint8Array.from(headerArray);

    const res = await runShader(device, headerArray, targetArray, 1, 1, 1, 1, 1, 1, nonce, 1, true);
    const expected = await expectedDigest(headerBytes, nonce);

    if (!res || !res.success) {
        return { nonce, ok: false, gpu: '(no digest written)', expected };
    }
    const reportedNonce = (res.nonce[0] << 24) | (res.nonce[1] << 16) | (res.nonce[2] << 8) | res.nonce[3];
    return {
        nonce,
        ok: res.hash === expected && (reportedNonce >>> 0) === (nonce >>> 0),
        gpu: res.hash,
        expected,
        reportedNonce: reportedNonce >>> 0,
    };
}

/**
 * Check the first, middle and last thread of a planned dispatch.
 * baseNonceOffset is 1 for throughput runs, so thread i of that run hashes
 * nonce 1 + i; the same nonces are re-checked here one thread at a time.
 */
export async function verifyDispatch(device, plan) {
    const n = plan.achievedThreads;
    const nonces = [1, 1 + Math.floor((n - 1) / 2), 1 + (n - 1)];
    const unique = [...new Set(nonces.map((v) => v >>> 0))];
    const results = [];
    for (const nonce of unique) {
        results.push(await verifyNonce(device, nonce));
    }
    return results;
}

export { verifyNonce, expectedDigest };
