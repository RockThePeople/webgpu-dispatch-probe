// UI wiring. No measurement logic lives here: it calls measurePoint()/runSweep()
// and renders what they return.

import { setupDevice, planDispatch, measurePoint, runSweep, MAX_PER_DIM } from './probe.js';
import { verifyDispatch } from './verify.js';
import { exportXlsx, exportCsv } from './export.js';

const SWEEP_MILLIONS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
const BIG_N_WARN = 64e6;

const $ = (id) => document.getElementById(id);
const el = {
    support: $('support-body'), plan: $('plan'), status: $('status'),
    verify: $('verify-body'), tbody: document.querySelector('#results tbody'),
    nValue: $('n-value'), nUnit: $('n-unit'), wgsX: $('wgs-x'), repeat: $('repeat'),
    run: $('btn-run'), sweep: $('btn-sweep'), verifyBtn: $('btn-verify'),
    xlsx: $('btn-xlsx'), csv: $('btn-csv'), warnBig: $('warn-big'),
};

let env = null;      // { device, info, limits }
let limit = MAX_PER_DIM;
let rows = [];
let busy = false;
let deviceLost = false;

const fmt = (n, d = 2) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const int = (n) => Number(n).toLocaleString();

function setStatus(msg, cls = '') {
    el.status.textContent = msg;
    el.status.className = `status ${cls}`;
}

function setBusy(on) {
    busy = on;
    const disable = on || !env || deviceLost;
    el.run.disabled = disable;
    el.sweep.disabled = disable;
    el.verifyBtn.disabled = disable;
    el.xlsx.disabled = on || !rows.length;
    el.csv.disabled = on || !rows.length;
}

function requestedThreads() {
    const v = Number(el.nValue.value) || 0;
    return Math.floor(v * Number(el.nUnit.value));
}

function currentPlan() {
    const wgs = Math.max(1, Math.floor(Number(el.wgsX.value) || 1));
    return planDispatch(requestedThreads(), wgs, limit);
}

function renderPlan() {
    const req = requestedThreads();
    const plan = currentPlan();
    el.warnBig.hidden = req < BIG_N_WARN;
    if (!plan) {
        el.plan.innerHTML = `<span class="bad">Cannot reach N = ${int(req)} with this workgroup size within the ${int(limit)} per-dimension limit.</span>`;
        return;
    }
    const [dx, dy, dz] = plan.dwg;
    const inexact = plan.exact ? '' :
        `\n  requested N  = ${int(plan.requestedThreads)}  (adjusted down so N divides exactly)`;
    el.plan.innerHTML =
        `  workgroup_size(${plan.wgs.join(', ')})\n` +
        `  dispatchWorkgroups(${dx}, ${dy}, ${dz})      <b>&larr; one dispatch, one submit</b>\n` +
        `  N = ${plan.wgs[0]} × ${int(dx * dy * dz)} = <b>${int(plan.achievedThreads)} threads</b>${inexact}\n` +
        `  max workgroups in any dimension = ${int(Math.max(dx, dy, dz))} / ${int(limit)}`;
    return plan;
}

function addRow(row) {
    if (el.tbody.querySelector('tr.empty')) el.tbody.innerHTML = '';
    const tr = document.createElement('tr');
    tr.innerHTML =
        `<td>${int(row.totalThreads)}</td>` +
        `<td>${row.workgroupSize}</td>` +
        `<td>${row.dispatchWorkgroups}</td>` +
        `<td class="runs">${row.times.map((t) => fmt(t * 1000, 1)).join(' / ')}</td>` +
        `<td>${fmt(row.avgMs, 2)}</td>` +
        `<td>${fmt(row.avgMHs, 2)}</td>`;
    el.tbody.appendChild(tr);
}

function onDeviceLost(info) {
    deviceLost = true;
    setBusy(false);
    el.run.disabled = el.sweep.disabled = el.verifyBtn.disabled = true;
    setStatus(`device lost (${info && info.reason ? info.reason : 'unknown'}) — reduce N and reload the page. ${info && info.message ? info.message : ''}`, 'bad');
}

async function init() {
    if (!navigator.gpu) {
        el.support.innerHTML =
            '<p class="bad">This browser does not expose <code>navigator.gpu</code>, so WebGPU is unavailable.</p>' +
            '<p class="note">Use Chrome 113 or newer (the paper\'s measurements used Chrome 144). ' +
            'WebGPU needs a secure context: this page over HTTPS, or <code>localhost</code> when run locally. ' +
            'On Linux you may still need <code>--enable-unsafe-webgpu</code>.</p>';
        return;
    }
    try {
        env = await setupDevice(onDeviceLost);
    } catch (e) {
        el.support.innerHTML = `<p class="bad">WebGPU present but unusable: ${e.message}</p>`;
        return;
    }
    limit = env.limits.maxComputeWorkgroupsPerDimension || MAX_PER_DIM;
    el.support.innerHTML =
        '<dl class="kv">' +
        `<dt>adapter vendor</dt><dd>${env.info.vendor}</dd>` +
        `<dt>architecture</dt><dd>${env.info.architecture}</dd>` +
        `<dt>device</dt><dd>${env.info.device}</dd>` +
        `<dt>description</dt><dd>${env.info.description}</dd>` +
        `<dt>maxComputeWorkgroupsPerDimension</dt><dd>${int(env.limits.maxComputeWorkgroupsPerDimension)}</dd>` +
        `<dt>maxComputeInvocationsPerWorkgroup</dt><dd>${int(env.limits.maxComputeInvocationsPerWorkgroup)}</dd>` +
        `<dt>maxStorageBufferBindingSize</dt><dd>${int(env.limits.maxStorageBufferBindingSize)} bytes</dd>` +
        `<dt>user agent</dt><dd>${navigator.userAgent}</dd>` +
        '</dl>';
    renderPlan();
    setBusy(false);
    setStatus('Ready.');
}

el.run.addEventListener('click', async () => {
    const plan = currentPlan();
    if (!plan) return;
    setBusy(true);
    setStatus(`Running N = ${int(plan.achievedThreads)} …`);
    try {
        const row = await measurePoint(env.device, plan, Math.max(1, Number(el.repeat.value) || 1));
        rows.push(row);
        addRow(row);
        setStatus(`Done: ${fmt(row.avgMHs, 2)} MH/s at N = ${int(row.totalThreads)}.`);
    } catch (e) {
        setStatus(`Run failed: ${e.message}`, 'bad');
    } finally {
        setBusy(false);
    }
});

el.sweep.addEventListener('click', async () => {
    const wgs = Math.max(1, Math.floor(Number(el.wgsX.value) || 1));
    const repeat = Math.max(1, Number(el.repeat.value) || 1);
    const list = SWEEP_MILLIONS.map((m) => m * 1e6);
    setBusy(true);
    try {
        let done = 0;
        const produced = await runSweep(env.device, list, wgs, repeat, limit, (row, requested) => {
            done++;
            if (row) {
                addRow(row);
                setStatus(`Sweep ${done}/${list.length}: N = ${int(row.totalThreads)} → ${fmt(row.avgMHs, 2)} MH/s`);
            } else {
                setStatus(`Sweep ${done}/${list.length}: skipped N = ${int(requested)} (cannot factor within the dimension limit)`, 'warn');
            }
        });
        rows = rows.concat(produced);
        setStatus(`Sweep finished: ${produced.length} of ${list.length} points measured.`);
    } catch (e) {
        setStatus(`Sweep failed: ${e.message}`, 'bad');
    } finally {
        setBusy(false);
    }
});

el.verifyBtn.addEventListener('click', async () => {
    const plan = currentPlan();
    if (!plan) return;
    setBusy(true);
    setStatus('Comparing GPU output against crypto.subtle …');
    try {
        const results = await verifyDispatch(env.device, plan);
        el.verify.innerHTML = results.map((r) => {
            const mark = r.ok ? '<span class="ok">PASS</span>' : '<span class="no">FAIL</span>';
            return `<div>${mark} input #${int(r.index)}<br>gpu      ${r.gpu}<br>expected ${r.expected}</div>`;
        }).join('');
        const allOk = results.every((r) => r.ok);
        setStatus(allOk
            ? `SHA-256 output matches the reference for ${results.length} input indices.`
            : 'Digest mismatch — see the correctness check panel.', allOk ? '' : 'bad');
    } catch (e) {
        setStatus(`Verification failed: ${e.message}`, 'bad');
    } finally {
        setBusy(false);
    }
});

function exportEnv() {
    return {
        info: env.info,
        limits: env.limits,
        workgroupSize: `${Math.max(1, Math.floor(Number(el.wgsX.value) || 1))}, 1, 1`,
        repeatCount: Math.max(1, Number(el.repeat.value) || 1),
    };
}

el.xlsx.addEventListener('click', () => {
    if (exportXlsx(rows, exportEnv())) setStatus(`Exported ${rows.length} rows to Excel.`);
});
el.csv.addEventListener('click', () => {
    if (exportCsv(rows, exportEnv())) setStatus(`Exported ${rows.length} rows to CSV.`);
});

for (const input of [el.nValue, el.nUnit, el.wgsX]) {
    input.addEventListener('input', renderPlan);
    input.addEventListener('change', renderPlan);
}

renderPlan();
init();
