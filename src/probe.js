// Measurement core: buffer and pipeline setup, a single dispatchWorkgroups()
// call, and the timing around it. performance.now() is read before buffer and
// pipeline creation and again once the result buffer's mapAsync() resolves.

import { wgslCode } from './shader.wgsl.js';

const GPUBufferUsage = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200
};

const GPUShaderStage = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4
};

const GPUMapMode = {
    READ: 0x0001,
    WRITE: 0x0002
};

async function runShader(GPUdevice, inputArray, thresholdArray, wgs_x, wgs_y, wgs_z, dwg_x, dwg_y, dwg_z, itercount, totalThread, isTestMode ) {

    const start = performance.now();
    const device = GPUdevice;

    const workgroupSize = [wgs_x, wgs_y, wgs_z];
    const dispatchSize = [dwg_x, dwg_y, dwg_z];

    const inputBuffer = device.createBuffer({
        mappedAtCreation: true,
        size: inputArray.byteLength,
        usage: GPUBufferUsage.STORAGE,
    });
    new Int32Array(inputBuffer.getMappedRange()).set(inputArray);
    inputBuffer.unmap();

    const thresholdBuffer = device.createBuffer({
        mappedAtCreation: true,
        size: thresholdArray.byteLength,
        usage: GPUBufferUsage.STORAGE,
    });
    new Int32Array(thresholdBuffer.getMappedRange()).set(thresholdArray);
    thresholdBuffer.unmap();

    const resultElementCount = 4 + 1 + 32;
    const resultBufferSize = Uint32Array.BYTES_PER_ELEMENT * resultElementCount;

    const resultBuffer = device.createBuffer({
        size: resultBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });

    const initCommandEncoder = device.createCommandEncoder();
    initCommandEncoder.clearBuffer(resultBuffer);
    device.queue.submit([initCommandEncoder.finish()]);

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
        ]
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: inputBuffer } },
            { binding: 1, resource: { buffer: thresholdBuffer } },
            { binding: 2, resource: { buffer: resultBuffer } }
        ]
    });

    const shaderModule = device.createShaderModule({
        code: wgslCode(dispatchSize, workgroupSize, itercount, totalThread, isTestMode)
    });

    const computePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module: shaderModule, entryPoint: "main" }
    });

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(computePipeline);
    passEncoder.setBindGroup(0, bindGroup);

    passEncoder.dispatchWorkgroups(dispatchSize[0], dispatchSize[1], dispatchSize[2]);
    passEncoder.end();

    const readBuffer = device.createBuffer({
        size: resultBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    commandEncoder.copyBufferToBuffer(resultBuffer, 0, readBuffer, 0, resultBufferSize);
    device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const mappedRange = readBuffer.getMappedRange();
    const resultArray = new Uint32Array(mappedRange);

    const time = (performance.now() - start) / 1000
    const successFlag = resultArray[4];

    if (successFlag === 1) {
        const index = resultArray.slice(0, 4);
        const hashBytes = resultArray.slice(5, 5 + 32);

        const hashHex = Array.from(hashBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        readBuffer.unmap();
        return {
            success: true,
            index: index,
            hash: hashHex,
            time: time
        };
    } else {
        readBuffer.unmap();
        return { success: false, time: time };
    }
};

// Fixed 76-byte input. Each thread appends its own 4-byte index to this, so
// every invocation hashes a distinct 80-byte message.
const PROBE_INPUT = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b';

// Comparison value for the shader's threshold check.
const PROBE_THRESHOLD = '0000008000000000000000000000000000000000000000000000000000000000';

function hexStringToUint32Array(hexString) {
    const byteArray = new Uint32Array(hexString.length / 2);
    for (let i = 0; i < hexString.length; i += 2) {
        byteArray[i / 2] = parseInt(hexString.substring(i, i + 2), 16);
    }
    return byteArray;
}

function averageOfRuns(values) {
    if (!values.length) return 0;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
}

const MAX_PER_DIM = 65535; // WebGPU guaranteed maxComputeWorkgroupsPerDimension

/**
 * Split a workgroup count into (x, y, z) so that every dimension stays within
 * the device limit. The shader flattens (x, y, z) back to a single index via
 * grid_width / grid_height, so the result is still ONE dispatch.
 * Returns null if the count cannot be factored exactly.
 */
function factorDispatch(wgCount, limit = MAX_PER_DIM) {
    if (wgCount <= limit) return [wgCount, 1, 1];
    let best = 1;
    for (let d = 1; d * d <= wgCount; d++) {
        if (wgCount % d !== 0) continue;
        const pair = wgCount / d;
        if (d <= limit && d > best) best = d;
        if (pair <= limit && pair > best) best = pair;
    }
    if (best <= 1) return null;
    const rest = wgCount / best;
    if (rest <= limit) return [best, rest, 1];
    const sub = factorDispatch(rest, limit);
    if (!sub || sub[2] !== 1) return null;
    return [best, sub[0], sub[1]];
}

/**
 * Work out workgroup_size and dispatchWorkgroups for a requested thread count.
 * If N cannot be hit exactly with the given workgroup size, the largest
 * reachable N <= requested is used and reported back, so the page never shows
 * a thread count the GPU did not actually run.
 */
export function planDispatch(requestedThreads, workgroupSizeX, limit = MAX_PER_DIM) {
    const wgs = [workgroupSizeX, 1, 1];
    const wgsTotal = workgroupSizeX;
    let wgCount = Math.floor(requestedThreads / wgsTotal);
    if (wgCount < 1) return null;
    for (let attempt = 0; attempt < 4096 && wgCount >= 1; attempt++, wgCount--) {
        const dwg = factorDispatch(wgCount, limit);
        if (dwg) {
            const achieved = wgsTotal * dwg[0] * dwg[1] * dwg[2];
            return { wgs, dwg, achievedThreads: achieved, requestedThreads, exact: achieved === requestedThreads };
        }
    }
    return null;
}

/** Request adapter + device, and surface the info / limits the page displays. */
export async function setupDevice(onDeviceLost) {
    if (!navigator.gpu) throw new Error('navigator.gpu is undefined: this browser has no WebGPU.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('navigator.gpu.requestAdapter() returned null.');
    const device = await adapter.requestDevice();
    if (!device) throw new Error('adapter.requestDevice() returned null.');
    if (onDeviceLost) device.lost.then((info) => onDeviceLost(info));
    const info = adapter.info || {};
    return {
        adapter,
        device,
        info: {
            vendor: info.vendor || '(not exposed)',
            architecture: info.architecture || '(not exposed)',
            description: info.description || '(not exposed)',
            device: info.device || '(not exposed)',
        },
        limits: {
            maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
            maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        },
    };
}

/**
 * One measurement point: one discarded warm-up run, then `repeatCount` timed
 * runs, then a plain mean.
 */
export async function measurePoint(device, plan, repeatCount) {
    const thresholdArray = hexStringToUint32Array(PROBE_THRESHOLD);
    const inputArray = hexStringToUint32Array(PROBE_INPUT);
    const { wgs, dwg } = plan;
    const times = [];

    await runShader(device, inputArray, thresholdArray, wgs[0], wgs[1], wgs[2], dwg[0], dwg[1], dwg[2], 1, 1, true);
    for (let run = 0; run < repeatCount; run++) {
        const res = await runShader(device, inputArray, thresholdArray, wgs[0], wgs[1], wgs[2], dwg[0], dwg[1], dwg[2], 1, 1, true);
        times.push(res.time);
    }

    const avgSeconds = averageOfRuns(times);
    const totalThreads = plan.achievedThreads;
    const avgHashesPerSec = avgSeconds > 0 ? totalThreads / avgSeconds : 0;
    return {
        totalThreads,
        workgroupSize: `${wgs[0]}, ${wgs[1]}, ${wgs[2]}`,
        dispatchWorkgroups: `${dwg[0]}, ${dwg[1]}, ${dwg[2]}`,
        repeatCount,
        times,
        avgSeconds,
        avgMs: avgSeconds * 1000,
        avgHashesPerSec,
        avgMHs: avgHashesPerSec / 1e6,
    };
}

/** Run a list of thread counts in sequence. */
export async function runSweep(device, requestedList, workgroupSizeX, repeatCount, limit, onPoint) {
    const rows = [];
    for (const requested of requestedList) {
        const plan = planDispatch(requested, workgroupSizeX, limit);
        if (!plan) {
            if (onPoint) onPoint(null, requested);
            continue;
        }
        const row = await measurePoint(device, plan, repeatCount);
        rows.push(row);
        if (onPoint) onPoint(row, requested);
    }
    return rows;
}

export { runShader, hexStringToUint32Array, PROBE_INPUT, PROBE_THRESHOLD, MAX_PER_DIM };
