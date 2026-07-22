// Document extractors — deterministic, zero external files. We hand-build a minimal
// (stored) .docx ZIP so the ZIP + OOXML path is exercised without any tooling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText } from '../lib/extract.mjs';

// A one-entry ZIP with the file STORED (method 0) — enough to prove the central-
// directory walk + local-header data offset + docx XML extraction.
function storedZip(name, content) {
  const nb = Buffer.from(name), data = Buffer.from(content);
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0, 8);
  lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(nb.length, 26); lfh.writeUInt16LE(0, 28);
  const local = Buffer.concat([lfh, nb, data]);
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(0, 10);
  cdh.writeUInt32LE(data.length, 20); cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(nb.length, 28); cdh.writeUInt32LE(0, 42);
  const central = Buffer.concat([cdh, nb]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

test('plain text passes through', () => {
  assert.equal(extractText(Buffer.from('hello world'), '.txt').text, 'hello world');
});

test('docx: ZIP + OOXML extraction, paragraphs preserved', () => {
  const xml = '<w:document><w:body>' +
    '<w:p><w:r><w:t>Records are retained seven years.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Then they are destroyed.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const r = extractText(storedZip('word/document.xml', xml), '.docx');
  assert.equal(r.ok, true);
  assert.match(r.text, /Records are retained seven years\./);
  assert.match(r.text, /Then they are destroyed\./);
});

test('docx XML entities decode', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>A &amp; B &lt; C</w:t></w:r></w:p></w:body></w:document>';
  assert.match(extractText(storedZip('word/document.xml', xml), '.docx').text, /A & B < C/);
});

test('rtf strips control words + font table', () => {
  const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0\\fnil Helvetica;}}\\f0 Hello \\b world\\b0 .}';
  const r = extractText(Buffer.from(rtf), '.rtf');
  assert.match(r.text, /Hello/); assert.match(r.text, /world/);
  assert.ok(!/fonttbl/.test(r.text) && !/Helvetica/.test(r.text), 'font table stripped');
});

test('an unreadable PDF is flagged (ok:false), never faked as empty text', () => {
  const r = extractText(Buffer.from('%PDF-1.4\nno text streams here\n%%EOF'), '.pdf');
  assert.equal(r.ok, false);
  assert.ok(r.note && /extract/i.test(r.note));
});

test('a standard-font text PDF extracts (font-aware path, no ToUnicode needed)', () => {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    '4 0 obj<</Length 60>>',
    'stream',
    'BT /F1 12 Tf (Client records are retained seven years.) Tj ET',
    'endstream',
    'endobj',
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    '%%EOF',
  ].join('\n');
  const r = extractText(Buffer.from(pdf, 'latin1'), '.pdf');
  assert.equal(r.ok, true);
  assert.match(r.text, /Client records are retained seven years\./);
});
