import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClip, duration, bounds, edit, getStats, encodeWav, safeFilename, createDemo } from '../src/audio.js';
const clip = (left = [0, 0.25, -0.5, 1], right) => ({ sampleRate: 8000, channels: [new Float32Array(left), ...(right ? [new Float32Array(right)] : [])] });
const seconds = frames => frames / 8000;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
test('duration uses frames, not total stereo samples', () => assert.equal(duration(clip([1, 2], [3, 4])), 2 / 8000));
test('bounds round and clamp to shared stereo sample boundaries', () => {
  assert.deepEqual(bounds(clip(), -1, 99), { start: 0, end: 4 });
  assert.deepEqual(bounds(clip(), seconds(1.2), seconds(2.8)), { start: 1, end: 3 });
});
test('bounds reject reversed, empty, out-of-range and nonfinite selections', () => {
  for (const [start, end] of [[0, 0], [1, 0], [1, 2], [-2, -1], [NaN, 2], [0, Infinity], [0, 0.000001]])
    assert.throws(() => bounds(clip(), start, end), RangeError);
});
test('trim and delete preserve stereo alignment without mutation', () => {
  const input = clip([0, .1, .2, .3], [.4, .5, .6, .7]);
  const backup = structuredClone(input);
  const trimmed = edit(input, 'trim', seconds(1), seconds(3));
  assert.deepEqual(trimmed.channels[0], input.channels[0].slice(1, 3));
  assert.deepEqual(trimmed.channels[1], input.channels[1].slice(1, 3));
  const deleted = edit(input, 'delete', seconds(1), seconds(3));
  assert.deepEqual([...deleted.channels[0]], [input.channels[0][0], input.channels[0][3]]);
  assert.deepEqual([...deleted.channels[1]], [input.channels[1][0], input.channels[1][3]]);
  assert.deepEqual(input, backup);
});
test('whole clip delete is rejected', () => assert.throws(() => edit(clip(), 'delete', 0, duration(clip()))));
test('silence only selected region and allocates new channels', () => {
  const input = clip();
  const result = edit(input, 'silence', seconds(1), seconds(3));
  assert.deepEqual([...result.channels[0]], [0, 0, 0, 1]);
  assert.notEqual(result.channels[0], input.channels[0]);
  assert.equal(input.channels[0][1], .25);
});
test('reverse selection in both channels', () => {
  const result = edit(clip([.1, .2, .3, .4], [-.1, -.2, -.3, -.4]), 'reverse', seconds(1), seconds(4));
  result.channels[0].forEach((v, i) => close(v, [.1, .4, .3, .2][i]));
  result.channels[1].forEach((v, i) => close(v, [-.1, -.4, -.3, -.2][i]));
});
test('fade endpoints and outside region are correct', () => {
  const input = clip([1, 1, 1, 1, 1]);
  assert.deepEqual([...edit(input, 'fadeIn', seconds(1), seconds(4)).channels[0]], [1, 0, .5, 1, 1]);
  assert.deepEqual([...edit(input, 'fadeOut', seconds(1), seconds(4)).channels[0]], [1, 1, .5, 0, 1]);
});
test('single-sample fades are finite and silent', () => {
  for (const action of ['fadeIn', 'fadeOut']) assert.equal(edit(clip(), action, seconds(1), seconds(2)).channels[0][1], 0);
});
test('gain uses decibels and clamps both polarities', () => {
  const input = clip([.25, -.75, .75]);
  const result = edit(input, 'gain', 0, duration(input), 20 * Math.log10(2));
  assert.deepEqual([...result.channels[0]], [.5, -1, 1]);
  assert.equal(getStats(result).clipped, 2);
  assert.deepEqual([...input.channels[0]], [.25, -.75, .75]);
});
test('gain rejects nonfinite and unreasonable factors', () => {
  for (const gain of [NaN, Infinity, -Infinity, 121, -121]) assert.throws(() => edit(clip(), 'gain', 0, duration(clip()), gain));
});
test('normalize uses shared stereo peak and preserves balance', () => {
  const input = clip([.25, -.5], [.125, -.25]);
  const output = edit(input, 'normalize', 0, duration(input));
  close(output.channels[0][1], -Math.pow(10, -1 / 20));
  close(output.channels[1][1], -Math.pow(10, -1 / 20) / 2);
});
test('normalize silence stays silent', () => {
  assert.deepEqual([...edit(clip([0, 0]), 'normalize', 0, seconds(2)).channels[0]], [0, 0]);
});
test('edits preserve out-of-selection finite PCM, even above full scale', () => {
  const input = clip([2, -.5, -2]);
  for (const action of ['silence', 'reverse', 'fadeIn', 'fadeOut', 'normalize', 'gain']) {
    const output = edit(input, action, seconds(1), seconds(2), 6);
    assert.equal(output.channels[0][0], 2);
    assert.equal(output.channels[0][2], -2);
  }
  assert.deepEqual([...edit(input, 'trim', 0, seconds(2)).channels[0]], [2, -.5]);
  assert.deepEqual([...edit(input, 'delete', seconds(1), seconds(2)).channels[0]], [2, -2]);
  assert.deepEqual([...input.channels[0]], [2, -.5, -2]);
});
test('all-zero statistics and export are finite and silent', () => {
  const input = clip([0, 0], [0, 0]);
  assert.deepEqual(getStats(input), { peak: 0, rms: 0, clipped: 0 });
  assert.ok(new Uint8Array(encodeWav(input), 44).every(value => value === 0));
});
test('selection ending exactly at clip duration includes final sample', () => {
  const input = clip([0, 0, .5]);
  assert.deepEqual(bounds(input, seconds(2), duration(input)), { start: 2, end: 3 });
  assert.deepEqual([...edit(input, 'trim', seconds(2), duration(input)).channels[0]], [.5]);
});
test('unknown edits are rejected', () => assert.throws(() => edit(clip(), 'bogus', 0, seconds(1))));
test('stats include stereo samples, selection, peak and clipping', () => {
  assert.deepEqual(getStats(clip([1, -1], [0, 0])), { peak: 1, rms: Math.sqrt(.5), clipped: 2 });
  assert.deepEqual(getStats(clip(), seconds(1), seconds(2)), { peak: .25, rms: .25, clipped: 0 });
});
test('WAV header is 16-bit PCM stereo and samples are interleaved', () => {
  const buffer = encodeWav(clip([1, -1], [.5, -.5]));
  const view = new DataView(buffer);
  const label = (start, size) => String.fromCharCode(...new Uint8Array(buffer, start, size));
  assert.equal(buffer.byteLength, 52);
  assert.equal(label(0, 4), 'RIFF'); assert.equal(label(8, 4), 'WAVE');
  assert.equal(label(12, 4), 'fmt '); assert.equal(label(36, 4), 'data');
  for (const [offset, expected] of [[4, 44], [16, 16], [24, 8000], [28, 32000], [40, 8]]) assert.equal(view.getUint32(offset, true), expected);
  for (const [offset, expected] of [[20, 1], [22, 2], [32, 4], [34, 16]]) assert.equal(view.getUint16(offset, true), expected);
  assert.deepEqual([44, 46, 48, 50].map(offset => view.getInt16(offset, true)), [32767, 16384, -32768, -16384]);
});
test('WAV selection contains only selected samples and clamps', () => {
  const view = new DataView(encodeWav(clip([0, 2, -2, 0]), seconds(1), seconds(3)));
  assert.equal(view.byteLength, 48); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getInt16(44, true), 32767); assert.equal(view.getInt16(46, true), -32768);
});
test('validation rejects invalid sample rates', () => {
  for (const sampleRate of [0, 7999, 192001, 44100.5, NaN]) assert.throws(() => validateClip({ ...clip(), sampleRate }));
});
test('validation rejects empty, mismatched or excessive channels and wrong arrays', () => {
  for (const channels of [[], [new Float32Array()], [new Float32Array(2), new Float32Array(3)], [new Float32Array(2), new Float32Array(2), new Float32Array(2)], [[1, 2]]])
    assert.throws(() => validateClip({ sampleRate: 8000, channels }));
});
test('nonfinite input rejected by validation, edits, statistics and export', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const input = clip([0, value]);
    for (const operation of [validateClip, encodeWav, getStats, input => edit(input, 'silence', 0, duration(input))]) assert.throws(() => operation(input));
  }
});
test('duration cap rejects audio longer than 180 seconds', () => {
  assert.throws(() => validateClip({ sampleRate: 8000, channels: [new Float32Array(8000 * 180 + 1)] }), /180/);
});
test('decoded memory cap rejects even audio within duration cap', () => {
  const channel = new Float32Array(8 * 1024 * 1024 + 1);
  assert.throws(() => validateClip({ sampleRate: 192000, channels: [channel, channel] }), /64 MiB/);
});
test('safe filenames remove unsafe characters and normalize extensions', () => {
  assert.equal(safeFilename('Song.MP3'), 'Song.wav');
  assert.equal(safeFilename('mix.wav'), 'mix.wav');
  assert.equal(safeFilename(''), 'wave-room.wav');
  assert.equal(safeFilename('CON'), 'audio-CON.wav');
  assert.ok(!/[<>:"/\\|?*\u0000]/.test(safeFilename('../a/b\u0000?.wav')));
  assert.ok(safeFilename('a'.repeat(300)).length <= 104);
});
test('demo is deterministic, stereo, finite, 12 seconds and unclipped', () => {
  const first = createDemo(), second = createDemo();
  assert.equal(validateClip(first), first);
  assert.equal(duration(first), 12); assert.equal(first.sampleRate, 44100);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.channels[0], first.channels[1]);
  const stats = getStats(first);
  assert.equal(stats.clipped, 0); assert.ok(stats.peak > .1 && stats.peak < 1);
  assert.ok(stats.rms > .01); assert.equal(first.channels[0][0], 0);
});
