// Простой процедурный звук: двигатель, визг шин, клаксон, удары.

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private screech!: GainNode;
  private horn!: GainNode;
  private noise!: AudioBuffer;
  muted = false;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext || w.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.05;
    this.o1 = ctx.createOscillator();
    this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator();
    this.o2.type = 'square';
    this.o1.connect(this.engFilter);
    this.o2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.o1.start();
    this.o2.start();

    // шум
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    ns.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 4;
    this.screech = ctx.createGain();
    this.screech.gain.value = 0;
    ns.connect(bp);
    bp.connect(this.screech);
    this.screech.connect(this.master);
    ns.start();

    // клаксон
    this.horn = ctx.createGain();
    this.horn.gain.value = 0;
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(this.horn);
      o.start();
    }
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 1800;
    this.horn.disconnect();
    this.horn.connect(hf);
    hf.connect(this.master);
  }

  update(speedRatio: number, throttle: number, slip: number, nitro: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 46 + speedRatio * 150 + throttle * 14 + (nitro ? 30 : 0);
    this.o1.frequency.setTargetAtTime(base, t, 0.05);
    this.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(380 + speedRatio * 900 + throttle * 300, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.045 + throttle * 0.04 + speedRatio * 0.03, t, 0.08);
    const sc = Math.max(0, Math.min(1, (slip - 120) / 260));
    this.screech.gain.setTargetAtTime(sc * 0.09, t, 0.05);
  }

  setHorn(on: boolean) {
    if (!this.ctx) return;
    this.horn.gain.setTargetAtTime(on ? 0.1 : 0, this.ctx.currentTime, 0.015);
  }

  crash(intensity: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = Math.min(1, intensity / 600);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 + k * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.4);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.3 + k * 0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.03);
    return this.muted;
  }

  destroy() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
