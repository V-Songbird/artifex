'use strict';

// Stand-ins for the browser media APIs, so a check can read WHAT a soundtrack or
// a film export scheduled, and WHEN, without a browser. They record; they do
// not make sound or pictures.

/** An OfflineAudioContext that records the graph built on it. */
function fakeAudio() {
  const record = { contexts: [], oscillators: [] };
  const param = (value) => {
    const p = { value, events: [] };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
      'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues']) {
      p[m] = (...args) => { p.events.push([m, ...args]); return p; };
    }
    return p;
  };
  const node = (fields) => Object.assign({ connect: (target) => target, disconnect() {} }, fields);
  const buffer = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  };
  class Context {
    constructor(channels, length, sampleRate) {
      Object.assign(this, { channels, length, sampleRate, currentTime: 0, destination: node({}) });
      record.contexts.push(this);
    }

    createOscillator() {
      const o = node({ type: 'sine', frequency: param(440), detune: param(0), at: null, end: null });
      o.start = (at = 0) => { o.at = at; };
      o.stop = (at = 0) => { o.end = at; };
      record.oscillators.push(o);
      return o;
    }

    createGain() { return node({ gain: param(1) }); }

    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }); }

    createStereoPanner() { return node({ pan: param(0) }); }

    createBuffer(channels, length, sampleRate) { return buffer(channels, length, sampleRate); }

    startRendering() { return Promise.resolve(buffer(this.channels, this.length, this.sampleRate)); }
  }
  return { Context, record };
}

/**
 * An OpusHead (RFC 7845, section 5.1), the description a browser's Opus encoder
 * gives: little-endian, by default stereo at 48 kHz with the 312-sample pre-skip
 * Edge's encoder reports.
 */
function opusHead({ channels = 2, preSkip = 312, rate = 48000, gain = 0, family = 0, table = [] } = {}) {
  const head = new Uint8Array(19 + table.length);
  const le = new DataView(head.buffer);
  head.set(Array.from('OpusHead', (ch) => ch.charCodeAt(0)));
  head[8] = 1;
  head[9] = channels;
  le.setUint16(10, preSkip, true);
  le.setUint32(12, rate, true);
  le.setInt16(16, gain, true);
  head[18] = family;
  head.set(table, 19);
  return head;
}

/**
 * VideoEncoder, VideoFrame, AudioEncoder and AudioData stand-ins. Each encoded
 * frame is four bytes naming its index; `supported` decides which configs are
 * accepted, `colorSpace` is what the encoder reports, `aac` and `opus` whether
 * each encodes, `describe` whether the audio encoder describes its stream,
 * `failAt` a frame index whose encode reports an error, and `stall` an encoder
 * whose queue never drains.
 */
function fakeCodecs({ supported = () => true, colorSpace, aac = true, opus = true, describe = true, failAt = -1, stall = false } = {}) {
  const log = { frames: [], audioFrames: 0 };
  const space = colorSpace === undefined
    ? { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true }
    : colorSpace;
  const chunk = (type, timestamp, data) => ({ type, timestamp, byteLength: data.length, copyTo: (dest) => dest.set(data) });

  class VideoFrame {
    constructor(source, init) {
      Object.assign(this, { timestamp: init.timestamp, duration: init.duration, closed: false });
      log.frames.push(this);
    }

    close() { this.closed = true; }
  }

  class VideoEncoder {
    static async isConfigSupported(config) { return { supported: supported(config), config }; }

    constructor({ output, error }) {
      Object.assign(this, { output, error, state: 'unconfigured', encodeQueueSize: stall ? 5 : 0, sent: 0 });
    }

    configure(config) { this.config = config; this.state = 'configured'; }

    encode(frame, options) {
      if (this.sent === failAt) { this.error(new Error('fixture encoder failed')); return; }
      const key = !!(options && options.keyFrame);
      const meta = this.sent === 0
        ? { decoderConfig: { codec: this.config.codec, description: Uint8Array.of(1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 0), colorSpace: space } }
        : undefined;
      this.output(chunk(key ? 'key' : 'delta', frame.timestamp, Uint8Array.of(this.sent & 255, (this.sent >> 8) & 255, key ? 1 : 0, 7)), meta);
      this.sent++;
    }

    async flush() {}

    close() { this.state = 'closed'; }
  }

  class AudioData {
    constructor(init) { Object.assign(this, init); }

    close() {}
  }

  // Emits one chunk per frame of samples received -- 1024 for AAC, 960 (20 ms)
  // for Opus -- and the remainder on flush. The first chunk carries the decoder
  // description: an AudioSpecificConfig, or an OpusHead.
  class AudioEncoder {
    static async isConfigSupported(config) {
      return { supported: config.codec === 'mp4a.40.2' ? aac : config.codec === 'opus' && opus, config };
    }

    constructor({ output, error }) { Object.assign(this, { output, error, held: 0, sent: 0 }); }

    configure(config) { this.config = config; this.frame = config.codec === 'opus' ? 960 : 1024; }

    encode(data) {
      this.held += data.numberOfFrames;
      log.audioFrames += data.numberOfFrames;
      while (this.held >= this.frame) this.emit();
    }

    emit() {
      const isOpus = this.config.codec === 'opus';
      const description = isOpus ? opusHead({ channels: this.config.numberOfChannels, rate: this.config.sampleRate }) : Uint8Array.of(0x11, 0x90);
      const meta = this.sent === 0 && describe ? { decoderConfig: { description } } : undefined;
      // 0xfc opens one 20 ms fullband CELT frame, the packet Edge's Opus encoder sends.
      const data = Uint8Array.of(isOpus ? 0xfc : 0x21, this.sent & 255);
      this.output(chunk('key', Math.round((this.sent * this.frame * 1e6) / this.config.sampleRate), data), meta);
      this.held = Math.max(0, this.held - this.frame);
      this.sent++;
    }

    async flush() { if (this.held > 0) this.emit(); }

    close() {}
  }

  return { VideoEncoder, VideoFrame, AudioEncoder, AudioData, log };
}

module.exports = { fakeAudio, fakeCodecs, opusHead };
