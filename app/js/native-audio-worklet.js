// Captured audio is downmixed by Web Audio and delivered in ~21 ms stereo blocks.
// This graph's output is silent: only the native host renders its PCM packets.
class ZenithNativeAudio extends AudioWorkletProcessor {
  constructor() { super(); this.pcm = new Int16Array(2048); this.at = 0; this.generation = 0;
    this.port.onmessage = ({data}) => { this.generation = data.generation; this.at = 0; this.pcm = new Int16Array(2048); };
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const input = inputs[0];
    if (!input?.length) return true;
    const left = input[0], right = input[1] || left;
    for (let i = 0; i < left.length; i++) {
      for (let channel = 0; channel < 2; channel++) {
        const value = channel ? right[i] : left[i];
        const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
        this.pcm[this.at++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      }
      if (this.at === this.pcm.length) {
        this.port.postMessage({generation: this.generation, samples: this.pcm}, [this.pcm.buffer]);
        this.pcm = new Int16Array(2048); this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor('zenith-native-audio', ZenithNativeAudio);
