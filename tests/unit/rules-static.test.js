// Static checks on database.rules.json that need no emulator. They would have caught a regex that lost its backslash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8'));

function collect(node, path, out) {
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') out.push({ path: `${path}/${k}`, value: v });
    else if (v && typeof v === 'object') collect(v, `${path}/${k}`, out);
  }
  return out;
}
const strings = collect(rules.rules, '', []);
const regexes = [];
for (const s of strings) {
  for (const m of s.value.matchAll(/matches\(\/(.*?)\/\)/g)) regexes.push({ path: s.path, source: m[1] });
}

test('rules contain the expected regex checks', () => {
  assert.ok(regexes.length >= 10, `found ${regexes.length}`);
});

test('no regex has a bare "d{" (a lost backslash that would never match digits)', () => {
  for (const r of regexes) assert.ok(!/(^|[^\\[0-9-])d\{/.test(r.source), `${r.path}: ${r.source}`);
});

test('date and time regexes accept real values and reject junk', () => {
  for (const r of regexes) {
    const re = new RegExp(r.source);
    if (r.source.includes('{4}-')) {
      assert.ok(re.test('2026-10-05'), `${r.path} should accept a date`);
      assert.ok(!re.test('05/10/2026') && !re.test('dddd-dd-dd'), `${r.path} should reject junk`);
    } else if (r.source.includes('{2}:')) {
      assert.ok(re.test('14:00') && re.test('07:30'), `${r.path} should accept HH:MM`);
      assert.ok(!re.test('dd:dd') && !re.test('1400'), `${r.path} should reject junk`);
    } else if (r.source.includes('https')) {
      assert.ok(re.test('https://drive.google.com/x'), `${r.path} should accept https`);
      assert.ok(!re.test('javascript:alert(1)') && !re.test('http://x'), `${r.path} should reject non-https`);
    }
  }
});
