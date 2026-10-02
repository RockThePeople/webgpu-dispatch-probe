// SHA-256 WGSL compute shader (verbatim from the paper's measurement code).
// Source: webgpu_FE/src/shader.js at commit bf29544, lines 132-332 -- unmodified.
// Thread -> input mapping: nonce = baseNonceOffset + gid.x + gid.y*grid_width + gid.z*grid_width*grid_height
// so every invocation hashes a distinct 80-byte message (76-byte header || 4-byte big-endian nonce).
// See THIRD_PARTY_NOTICES.md for the origin of the SHA-256 core.

const wgslCode = (dispatchSize, workgroupSize, iterCount, totalThread, isTestMode) => {
    const gridWidthX = workgroupSize[0] * dispatchSize[0];
    const gridHeightY = workgroupSize[1] * dispatchSize[1];
    const baseNonceOffset = iterCount * totalThread;
    const earlyExitLogic = isTestMode
        ? "// [TEST MODE] Early Exit Disabled for Benchmarking"
        : "if (atomicLoad(&outputState[4]) == 1u) { return; }";

    return `
struct SHA256_CTX {
    data : array<u32, 64>,
    datalen : u32,
    bitlen : array<u32, 2>,
    state : array<u32, 8>,
    info : u32,
};

@group(0) @binding(0) var<storage, read> input : array<u32>;
@group(0) @binding(1) var<storage, read> targetHash : array<u32>;
@group(0) @binding(2) var<storage, read_write> outputState : array<atomic<u32>>;

const SHA256_BLOCK_SIZE = 32;
const inputLen :u32 = 76;
const totalLen :u32 = 80;

const k = array<u32, 64> (
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
);

fn ROTLEFT(a : u32, b : u32) -> u32{return (((a) << (b)) | ((a) >> (32-(b))));}
fn ROTRIGHT(a : u32, b : u32) -> u32{return (((a) >> (b)) | ((a) << (32-(b))));}
fn CH(x : u32, y : u32, z : u32) -> u32{return (((x) & (y)) ^ (~(x) & (z)));}
fn MAJ(x : u32, y : u32, z : u32) -> u32{return (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)));}
fn EP0(x : u32) -> u32{return (ROTRIGHT(x,2) ^ ROTRIGHT(x,13) ^ ROTRIGHT(x,22));}
fn EP1(x : u32) -> u32{return (ROTRIGHT(x,6) ^ ROTRIGHT(x,11) ^ ROTRIGHT(x,25));}
fn SIG0(x : u32) -> u32{return (ROTRIGHT(x,7) ^ ROTRIGHT(x,18) ^ ((x) >> 3));}
fn SIG1(x : u32) -> u32{return (ROTRIGHT(x,17) ^ ROTRIGHT(x,19) ^ ((x) >> 10));}

fn sha256_transform(ctx : ptr<function, SHA256_CTX>) {
    var a : u32; var b : u32; var c : u32; var d : u32;
    var e : u32; var f : u32; var g : u32; var h : u32;
    var i : u32 = 0; var j : u32 = 0;
    var t1 : u32; var t2 : u32;
    var m : array<u32, 64>;
    while(i < 16) {
        m[i] = ((*ctx).data[j] << 24) | ((*ctx).data[j + 1] << 16) | ((*ctx).data[j + 2] << 8) | ((*ctx).data[j + 3]);
        i++; j += 4;
    }            
    while(i < 64) {
        m[i] = SIG1(m[i - 2]) + m[i - 7] + SIG0(m[i - 15]) + m[i - 16];
        i++;
    }
    a = (*ctx).state[0]; b = (*ctx).state[1]; c = (*ctx).state[2]; d = (*ctx).state[3];
    e = (*ctx).state[4]; f = (*ctx).state[5]; g = (*ctx).state[6]; h = (*ctx).state[7];
    for (i = 0; i < 64; i++) {
        t1 = h + EP1(e) + CH(e,f,g) + k[i] + m[i];
        t2 = EP0(a) + MAJ(a,b,c);
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }
    (*ctx).state[0] += a; (*ctx).state[1] += b; (*ctx).state[2] += c; (*ctx).state[3] += d;
    (*ctx).state[4] += e; (*ctx).state[5] += f; (*ctx).state[6] += g; (*ctx).state[7] += h;
}

fn sha256_update(ctx : ptr<function, SHA256_CTX>, data : ptr<function, array<u32, totalLen>>, len : u32) {
    for (var i : u32 = 0; i < len; i++) {
        (*ctx).data[(*ctx).datalen] = (*data)[i];
        (*ctx).datalen++;
        if ((*ctx).datalen == 64) {
            sha256_transform(ctx);
            if ((*ctx).bitlen[0] > 0xffffffff - 512) { (*ctx).bitlen[1]++; };
            (*ctx).bitlen[0] += 512;
            (*ctx).datalen = 0;
        }
    }
}

fn sha256_update_2(ctx : ptr<function, SHA256_CTX>, data : ptr<function, array<u32, SHA256_BLOCK_SIZE>>){
    for (var i : u32 = 0; i < SHA256_BLOCK_SIZE; i++) {
        (*ctx).data[(*ctx).datalen] = (*data)[i];
        (*ctx).datalen++;
        if ((*ctx).datalen == 64) {
            sha256_transform(ctx);
            if ((*ctx).bitlen[0] > 0xffffffff - 512) { (*ctx).bitlen[1]++; };
            (*ctx).bitlen[0] += 512;
            (*ctx).datalen = 0;
        }
    }
}

fn sha256_final(ctx : ptr<function, SHA256_CTX>, hash:  ptr<function, array<u32, SHA256_BLOCK_SIZE>>) {
    var i : u32 = (*ctx).datalen;
    if ((*ctx).datalen < 56) {
        (*ctx).data[i] = 0x80; i++;
        while (i < 56){ (*ctx).data[i] = 0x00; i++; }
    } else {
        (*ctx).data[i] = 0x80; i++;
        while (i < 64){ (*ctx).data[i] = 0x00; i++; }
        sha256_transform(ctx);
        for (var i: u32 = 0; i < 56 ; i++) { (*ctx).data[i] = 0; }
    }
    if ((*ctx).bitlen[0] > 0xffffffff - (*ctx).datalen * 8) { (*ctx).bitlen[1]++; }
    (*ctx).bitlen[0] += (*ctx).datalen * 8;
    (*ctx).data[63] = (*ctx).bitlen[0];
    (*ctx).data[62] = (*ctx).bitlen[0] >> 8;
    (*ctx).data[61] = (*ctx).bitlen[0] >> 16;
    (*ctx).data[60] = (*ctx).bitlen[0] >> 24;
    (*ctx).data[59] = (*ctx).bitlen[1];
    (*ctx).data[58] = (*ctx).bitlen[1] >> 8;
    (*ctx).data[57] = (*ctx).bitlen[1] >> 16;
    (*ctx).data[56] = (*ctx).bitlen[1] >> 24;
    sha256_transform(ctx);
    for (i = 0; i < 4; i++) {
        (*hash)[i]      = ((*ctx).state[0] >> (24 - i * 8)) & 0x000000ff;
        (*hash)[i + 4]  = ((*ctx).state[1] >> (24 - i * 8)) & 0x000000ff;
        (*hash)[i + 8]  = ((*ctx).state[2] >> (24 - i * 8)) & 0x000000ff;
        (*hash)[i + 12] = ((*ctx).state[3] >> (24 - i * 8)) & 0x000000ff;
        (*hash)[i + 16] = ((*ctx).state[4] >> (24 - i * 8)) & 0x000000ff;
        (*hash)[i + 20] = ((*ctx).state[5] >> (24 - i * 8)) & 0x000000ff;
        (*hash)[i + 24] = ((*ctx).state[6] >> (24 - i * 8)) & 0x000000ff;
        (*hash)[i + 28] = ((*ctx).state[7] >> (24 - i * 8)) & 0x000000ff;
    }
}

fn u32_array_less_than(hash : ptr<function, array<u32, SHA256_BLOCK_SIZE>>) -> bool {
    for (var i : u32 = 0; i < SHA256_BLOCK_SIZE; i++) {
        if (i >= arrayLength(&targetHash)) { break; } 
        if ((*hash)[i] > targetHash[i]) { return false; }
        else if ((*hash)[i] < targetHash[i]) { return true; }
    }
    return true;
}

// [수정됨] Bitwise Operation을 사용하여 32비트 정수 전체 범위를 바이트 배열로 변환
fn nonce_to_array(n: u32) -> array<u32, 4> {
    var result : array<u32, 4>;
    // Big Endian 방식 (일반적인 SHA-256 입력 처리)
    result[0] = (n >> 24) & 0xFF;
    result[1] = (n >> 16) & 0xFF;
    result[2] = (n >> 8) & 0xFF;
    result[3] = n & 0xFF;
    return result;
}

@compute @workgroup_size(${workgroupSize[0]}, ${workgroupSize[1]}, ${workgroupSize[2]})
fn main(@builtin(global_invocation_id) global_invocation_id : vec3<u32>) {
    ${earlyExitLogic}

    var ctx : SHA256_CTX;
    var hash : array<u32, SHA256_BLOCK_SIZE>;
    var local_input : array<u32, 80>;
    var nonce_array : array<u32, 4>;

    let grid_width : u32 = ${gridWidthX}u;
    let grid_height : u32 = ${gridHeightY}u;

    // [수정됨] baseNonceOffset을 문자열 치환 시 바로 적용하고, u32 캐스팅 명시
    let nonce : u32 = u32(${baseNonceOffset}) + 
                      global_invocation_id.x + 
                      (global_invocation_id.y * grid_width) +
                      (global_invocation_id.z * grid_width * grid_height);

    for(var i:u32 = 0; i<inputLen; i++){ local_input[i] = input[i]; }
    nonce_array = nonce_to_array(nonce);
    for(var i:u32 = 0; i<4; i++){ local_input[i+inputLen] = nonce_array[i]; }

    // First Hash
    ctx.datalen = 0; ctx.bitlen[0] = 0; ctx.bitlen[1] = 0;
    ctx.state = array<u32, 8>(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
    sha256_update(&ctx, &local_input, totalLen);
    sha256_final(&ctx, &hash);
  
    // Second Hash
    ctx.datalen = 0; ctx.bitlen[0] = 0; ctx.bitlen[1] = 0;
    ctx.state = array<u32, 8>(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
    sha256_update_2(&ctx, &hash);
    sha256_final(&ctx, &hash);

    if(u32_array_less_than(&hash)) {
        let old_value = atomicExchange(&outputState[4], 1u);
        if (old_value == 0u) {
            atomicStore(&outputState[0], nonce_array[0]);
            atomicStore(&outputState[1], nonce_array[1]);
            atomicStore(&outputState[2], nonce_array[2]);
            atomicStore(&outputState[3], nonce_array[3]);
            
            for (var k = 0u; k < 32u; k++) {
                atomicStore(&outputState[5u + k], hash[k]);
            }
        }
    }
}
`;
};

export { wgslCode };
