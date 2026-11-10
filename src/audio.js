/** Pure, immutable PCM tools. Selections are half-open [start, end). */
export const MAX_DURATION = 180;
export const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const clamp = value => Math.max(-1, Math.min(1, value));

export function validateClip(clip) {
  if (!clip || !Number.isInteger(clip.sampleRate) || clip.sampleRate < 8000 || clip.sampleRate > 192000)
    throw new RangeError('Sample rate must be between 8,000 and 192,000 Hz.');
  if (!Array.isArray(clip.channels) || clip.channels.length < 1 || clip.channels.length > 2)
    throw new TypeError('Audio must contain one or two channels.');
  const frames = clip.channels[0]?.length;
  if (!Number.isInteger(frames) || frames < 1) throw new RangeError('Audio is empty.');
  if (frames / clip.sampleRate > MAX_DURATION) throw new RangeError('Audio must be 180 seconds or shorter.');
  let bytes = 0;
  for (const channel of clip.channels) {
    if (!(channel instanceof Float32Array) || channel.length !== frames)
      throw new TypeError('Channels must be equal-length Float32Arrays.');
    bytes += channel.byteLength;
  }
  if (bytes > MAX_DECODED_BYTES) throw new RangeError('Decoded audio exceeds 64 MiB.');
  for (const channel of clip.channels)
    for (const value of channel)
      if (!Number.isFinite(value)) throw new TypeError('Audio contains nonfinite samples.');
  return clip;
}

export function duration(clip) {
  return clip.channels[0].length / clip.sampleRate;
}

function selection(clip, startSeconds, endSeconds) {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds)
    throw new RangeError('Select a nonempty audio range.');
  const length = clip.channels[0].length;
  const start = Math.max(0, Math.min(length, Math.round(startSeconds * clip.sampleRate)));
  const end = Math.max(0, Math.min(length, Math.round(endSeconds * clip.sampleRate)));
  if (end <= start) throw new RangeError('Select at least one sample.');
  return { start, end };
}

export function bounds(clip, startSeconds = 0, endSeconds = duration(clip)) {
  validateClip(clip);
  return selection(clip, startSeconds, endSeconds);
}

export function edit(clip, action, startSeconds, endSeconds, amount = 0) {
  validateClip(clip);
  const { start, end } = selection(clip, startSeconds, endSeconds);
  const actions = ['trim', 'delete', 'silence', 'reverse', 'fadeIn', 'fadeOut', 'normalize', 'gain'];
  if (!actions.includes(action)) throw new TypeError(`Unknown edit: ${action}`);
  if (action === 'gain' && (!Number.isFinite(amount) || Math.abs(amount) > 120))
    throw new RangeError('Gain must be a finite value between -120 and 120 dB.');
  const count = end - start;
  if (action === 'delete' && count === clip.channels[0].length)
    throw new RangeError('Deleting the entire clip would leave no audio. Use Silence instead.');
  let factor = action === 'gain' ? 10 ** (amount / 20) : 1;
  if (action === 'normalize') {
    let peak = 0;
    for (const channel of clip.channels)
      for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(channel[i]));
    factor = peak ? Math.pow(10, -1 / 20) / peak : 1;
  }
  const channels = clip.channels.map(channel => {
    let result;
    if (action === 'trim') result = channel.slice(start, end);
    else if (action === 'delete') {
      result = new Float32Array(channel.length - count);
      result.set(channel.subarray(0, start));
      result.set(channel.subarray(end), start);
    } else {
      result = channel.slice();
      for (let i = start; i < end; i++) {
        const position = count === 1 ? 0 : (i - start) / (count - 1);
        if (action === 'silence') result[i] = 0;
        else if (action === 'reverse') result[i] = channel[end - 1 - (i - start)];
        else if (action === 'fadeIn') result[i] = channel[i] * position;
        else if (action === 'fadeOut') result[i] = channel[i] * (count === 1 ? 0 : 1 - position);
        else result[i] = clamp(channel[i] * factor);
      }
    }
    return result;
  });
  return { sampleRate: clip.sampleRate, channels };
}

export function getStats(clip, startSeconds = 0, endSeconds = duration(clip)) {
  validateClip(clip);
  const { start, end } = selection(clip, startSeconds, endSeconds);
  let peak = 0, squares = 0, clipped = 0;
  for (const channel of clip.channels) {
    for (let i = start; i < end; i++) {
      const value = channel[i];
      const absolute = Math.abs(value);
      peak = Math.max(peak, absolute);
      squares += value * value;
      if (absolute >= 1) clipped++;
    }
  }
  return { peak, rms: Math.sqrt(squares / ((end - start) * clip.channels.length)), clipped };
}

export function encodeWav(clip, startSeconds = 0, endSeconds = duration(clip)) {
  validateClip(clip);
  const { start, end } = selection(clip, startSeconds, endSeconds);
  const channelCount = clip.channels.length;
  const dataSize = (end - start) * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const label = (offset, text) => [...text].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true); view.setUint32(24, clip.sampleRate, true);
  view.setUint32(28, clip.sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = start; i < end; i++) {
    for (const channel of clip.channels) {
      const sample = clamp(channel[i]);
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return buffer;
}

export function safeFilename(name) {
  let clean = String(name ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '').replace(/\.(wav|mp3|m4a|aac|ogg|flac|aiff?|webm)$/i, '')
    .replace(/[.\s]+$/g, '').slice(0, 100);
  if (!clean) clean = 'wave-room';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)) clean = `audio-${clean}`;
  return `${clean}.wav`;
}

export function createDemo() {
  const sampleRate = 44100;
  const length = sampleRate * 12;
  const channels = [new Float32Array(length), new Float32Array(length)];
  const notes = [261.6256, 329.6276, 391.9954, 523.2511, 440, 391.9954, 329.6276, 293.6648];
  let seed = 1739;
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    const beat = Math.floor(time / 0.375);
    const phase = time - beat * 0.375;
    const frequency = notes[beat % notes.length];
    const attack = Math.min(1, phase / 0.008);
    const chime = attack * Math.exp(-phase * 8) * (Math.sin(2 * Math.PI * frequency * phase) * 0.22
      + Math.sin(2 * Math.PI * frequency * 2 * phase) * 0.065);
    const kickPhase = time % 0.75;
    const kick = Math.sin(2 * Math.PI * (48 * kickPhase + 5 * (1 - Math.exp(-kickPhase * 24))))
      * Math.exp(-kickPhase * 19) * Math.min(1, kickPhase / 0.003) * 0.24;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const hat = (seed / 4294967296 * 2 - 1) * Math.exp(-phase * 110) * 0.045;
    const pad = Math.sin(2 * Math.PI * 130.8128 * time) * 0.035 + Math.sin(2 * Math.PI * 195.9977 * time) * 0.025;
    const fade = Math.min(1, time / 0.025, (12 - time) / 0.35);
    const pan = Math.sin(beat * 1.3) * 0.32;
    channels[0][i] = (chime * (1 - pan) + kick + hat + pad) * fade;
    channels[1][i] = (chime * (1 + pan) + kick - hat * 0.7 + pad) * fade;
  }
  return { sampleRate, channels };
}
