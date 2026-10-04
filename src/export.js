// Result export: one metadata block describing the run, then one row per
// measurement point, written as .xlsx or .csv.

import { buildXlsx } from './xlsx-min.js';

/** Environment block recorded alongside every export. */
export function buildMetadata(env) {
    return [
        ['WebGPU Dispatch Probe -- measurement export'],
        ['measured at (ISO)', new Date().toISOString()],
        ['user agent', navigator.userAgent],
        ['adapter vendor', env.info.vendor],
        ['adapter architecture', env.info.architecture],
        ['adapter device', env.info.device],
        ['adapter description', env.info.description],
        ['maxComputeWorkgroupsPerDimension', env.limits.maxComputeWorkgroupsPerDimension],
        ['maxComputeInvocationsPerWorkgroup', env.limits.maxComputeInvocationsPerWorkgroup],
        ['maxStorageBufferBindingSize', env.limits.maxStorageBufferBindingSize],
        ['workgroup_size (x, y, z)', env.workgroupSize],
        ['repeat runs per point', env.repeatCount],
        ['warm-up runs discarded per point', 1],
        ['timing method', 'performance.now() around buffer+pipeline creation, single dispatchWorkgroups, and mapAsync() completion; no timestamp-query'],
        ['averaging', 'plain mean of the repeat runs'],
        [],
    ];
}

const HEADERS = [
    'totalThreads', 'avgSeconds', 'avgHashesPerSec',
    'avgMs', 'avgMHs', 'workgroup_size', 'dispatchWorkgroups', 'repeatCount',
];

function rowToArray(row, maxRepeats) {
    const base = [
        row.totalThreads,
        Number(row.avgSeconds.toFixed(6)),
        Number(row.avgHashesPerSec.toFixed(8)),
        Number(row.avgMs.toFixed(4)),
        Number(row.avgMHs.toFixed(4)),
        row.workgroupSize,
        row.dispatchWorkgroups,
        row.repeatCount,
    ];
    for (let i = 0; i < maxRepeats; i++) {
        base.push(row.times[i] !== undefined ? Number(row.times[i].toFixed(8)) : '');
    }
    return base;
}

function buildTable(rows, env) {
    const maxRepeats = rows.reduce((m, r) => Math.max(m, r.times.length), 0);
    const header = [...HEADERS];
    for (let i = 0; i < maxRepeats; i++) header.push(`run${i + 1}_seconds`);
    return [...buildMetadata(env), header, ...rows.map((r) => rowToArray(r, maxRepeats))];
}

function filenameStem(env) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dev = (env.info.description || env.info.vendor || 'gpu').replace(/[^\w.-]+/g, '_');
    return `probe_${dev}_${stamp}`;
}

function download(blob, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

export function exportXlsx(rows, env) {
    if (!rows.length) return false;
    const out = buildXlsx('measurements', buildTable(rows, env));
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `${filenameStem(env)}.xlsx`);
    return true;
}

export function exportCsv(rows, env) {
    if (!rows.length) return false;
    const esc = (v) => {
        const s = v === undefined || v === null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = buildTable(rows, env).map((r) => r.map(esc).join(',')).join('\n');
    download(new Blob([text], { type: 'text/csv' }), `${filenameStem(env)}.csv`);
    return true;
}
