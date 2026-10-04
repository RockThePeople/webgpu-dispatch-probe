// Minimal, dependency-free .xlsx writer: one worksheet from an array of arrays,
// numbers as numbers and everything else as inline strings, stored uncompressed.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
        // strip control characters that are illegal in XML 1.0
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
function columnName(index) {
    let name = '';
    let n = index;
    for (;;) {
        name = String.fromCharCode(65 + (n % 26)) + name;
        n = Math.floor(n / 26) - 1;
        if (n < 0) break;
    }
    return name;
}

function sheetXml(aoa) {
    const rows = aoa.map((cells, r) => {
        const body = (cells || []).map((value, c) => {
            if (value === null || value === undefined || value === '') return '';
            const ref = `${columnName(c)}${r + 1}`;
            if (typeof value === 'number' && Number.isFinite(value)) {
                return `<c r="${ref}"><v>${value}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        }).join('');
        return `<row r="${r + 1}">${body}</row>`;
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${rows}</sheetData></worksheet>`;
}

function zip(files) {
    const locals = [];
    const central = [];
    let offset = 0;

    for (const { name, data } of files) {
        const nameBytes = utf8(name);
        const crc = crc32(data);

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);   // local file header signature
        local.setUint16(4, 20, true);           // version needed
        local.setUint16(6, 0x0800, true);       // flags: UTF-8 names
        local.setUint16(8, 0, true);            // method: stored
        local.setUint16(10, 0, true);           // time
        local.setUint16(12, 0x21, true);        // date (1996-01-01)
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true); // compressed size
        local.setUint32(22, data.length, true); // uncompressed size
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);           // extra length
        locals.push(new Uint8Array(local.buffer), nameBytes, data);

        const dir = new DataView(new ArrayBuffer(46));
        dir.setUint32(0, 0x02014b50, true);     // central directory signature
        dir.setUint16(4, 20, true);             // version made by
        dir.setUint16(6, 20, true);             // version needed
        dir.setUint16(8, 0x0800, true);
        dir.setUint16(10, 0, true);
        dir.setUint16(12, 0, true);
        dir.setUint16(14, 0x21, true);
        dir.setUint32(16, crc, true);
        dir.setUint32(20, data.length, true);
        dir.setUint32(24, data.length, true);
        dir.setUint16(28, nameBytes.length, true);
        dir.setUint16(30, 0, true);             // extra
        dir.setUint16(32, 0, true);             // comment
        dir.setUint16(34, 0, true);             // disk number
        dir.setUint16(36, 0, true);             // internal attrs
        dir.setUint32(38, 0, true);             // external attrs
        dir.setUint32(42, offset, true);        // offset of local header
        central.push(new Uint8Array(dir.buffer), nameBytes);

        offset += 30 + nameBytes.length + data.length;
    }

    const centralSize = central.reduce((n, part) => n + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);         // end of central directory
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    const parts = [...locals, ...central, new Uint8Array(end.buffer)];
    const total = parts.reduce((n, part) => n + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
}

/** Build a single-sheet .xlsx from an array of arrays. Returns a Uint8Array. */
export function buildXlsx(sheetName, aoa) {
    const safeName = escapeXml(String(sheetName).slice(0, 31) || 'Sheet1');
    return zip([
        {
            name: '[Content_Types].xml',
            data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '</Types>'),
        },
        {
            name: '_rels/.rels',
            data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                '</Relationships>'),
        },
        {
            name: 'xl/workbook.xml',
            data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
        },
        {
            name: 'xl/_rels/workbook.xml.rels',
            data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                '</Relationships>'),
        },
        { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml(aoa)) },
    ]);
}
