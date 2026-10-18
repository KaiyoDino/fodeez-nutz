// Everything you hear is synthesized with Web Audio: chiptune sound effects and a
// looping soundtrack. No audio files.

import type { Sim } from '../sim/sim';
import type { SimEvent } from '../sim/types';

type Wave = OscillatorType | 'pulse12' | 'pulse25';

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function freq(note: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(note);
  if (!m) return 0;
  const midi = NOTE[m[1]] + (Number(m[2]) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 8 bars, 16 steps each. '-' holds, '.' rests.
const MELODY = [
  'E5 - - - C5 - D5 - E5 - - - A4 - - -',
  'F5 - - - E5 - D5 - C5 - - - A4 - - -',
  'G5 - - - E5 - C5 - E5 - G5 - C6 - - -',
  'B5 - - - A5 - G5 - D5 - - - . - - -',
  'E5 - - - C5 - D5 - E5 - - - A5 - - -',
  'A5 - G5 - F5 - E5 - C5 - - - D5 - - -',
  'D5 - - - B4 - C5 - D5 - - - G5 - - -',
  'G#5 - - - E5 - - - B4 - - - E5 - - -',
].map(b => b.split(' '));
const CHORDS = [
  ['A3', 'C4', 'E4'],
  ['F3', 'A3', 'C4'],
  ['C4', 'E4', 'G4'],
  ['G3', 'B3', 'D4'],
  ['A3', 'C4', 'E4'],
  ['F3', 'A3', 'C4'],
  ['G3', 'B3', 'D4'],
  ['E3', 'G#3', 'B3'],
];
const BASS = ['A2', 'F2', 'C3', 'G2', 'A2', 'F2', 'G2', 'E2'];
const BPM = 96;
const STEP = 60 / BPM / 4;

export class Audio {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private waves = new Map<string, PeriodicWave>();
  private musicVol = 0.6;
  private sfxVol = 0.8;
  private musicOn = false;
  private nextStep = 0;
  private stepIndex = 0;
  private timer: number | null = null;
  private intensity = 0;
  private wind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private roll: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private lastPlayed = new Map<string, number>();

  /**
   * Build the audio graph straight away. Browsers keep it silent (suspended) until the page
   * gets a click or key press, unless they allow autoplay for this site.
   */
  prime(): void {
    if (!this.ac) this.create();
  }

  /** Is sound actually playing? (False until the browser lets it start.) */
  get running(): boolean {
    return this.ac?.state === 'running';
  }

  /** Call when the audio starts running (immediately if it already is). */
  onRunning(cb: () => void): void {
    const ac = this.ac;
    if (!ac) return;
    if (ac.state === 'running') {
      cb();
      return;
    }
    const check = () => {
      if (ac.state !== 'running') return;
      ac.removeEventListener('statechange', check);
      cb();
    };
    ac.addEventListener('statechange', check);
  }

  /** Call from a user gesture (a click or key press): starts or resumes sound. */
  unlock(): void {
    if (!this.ac) this.create();
    if (this.ac && this.ac.state === 'suspended') void this.ac.resume().catch(() => undefined);
  }

  private create(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let ac: AudioContext;
    try {
      ac = new Ctor();
    } catch {
      return;
    }
    this.ac = ac;
    this.master = ac.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ac.destination);
    this.musicBus = ac.createGain();
    this.sfxBus = ac.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.applyVolumes();
    const len = ac.sampleRate;
    this.noise = ac.createBuffer(1, len, ac.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.wind = this.loopNoise('bandpass', 700);
    this.roll = this.loopNoise('lowpass', 260);
    if (this.musicOn) this.startScheduler();
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.musicBus.gain.setTargetAtTime(this.musicVol * 0.32, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.sfxVol * 0.7, t, 0.05);
  }

  suspend(hidden: boolean): void {
    if (!this.ac) return;
    if (hidden) void this.ac.suspend();
    else void this.ac.resume();
  }

  // ------------------------------------------------------------ music

  playMusic(on: boolean): void {
    this.musicOn = on;
    if (!this.ac) return;
    if (on) this.startScheduler();
    else this.stopScheduler();
  }

  /** 0..1: more instruments join as you climb. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  private startScheduler(): void {
    if (!this.ac || this.timer !== null) return;
    this.nextStep = this.ac.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stopScheduler(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const ac = this.ac!;
    while (this.nextStep < ac.currentTime + 0.15) {
      this.playStep(this.stepIndex, this.nextStep);
      this.nextStep += STEP;
      this.stepIndex = (this.stepIndex + 1) % (16 * 8);
    }
  }

  private playStep(i: number, t: number): void {
    const bar = Math.floor(i / 16);
    const step = i % 16;
    const bus = this.musicBus;
    // bass: eighth notes with an octave hop
    if (step % 2 === 0) {
      const f = freq(BASS[bar]) * (step % 8 === 4 ? 2 : 1);
      this.tone(bus, 'triangle', f, t, STEP * 1.8, 0.5);
    }
    // arpeggio
    const chord = CHORDS[bar];
    const note = chord[step % 3];
    this.tone(bus, 'pulse12', freq(note) * 2, t, STEP * 0.9, 0.09);
    // melody (comes in once you've climbed a bit)
    if (this.intensity > 0.15) {
      const m = MELODY[bar][step];
      if (m && m !== '-' && m !== '.') {
        let len = 1;
        while (step + len < 16 && MELODY[bar][step + len] === '-') len++;
        this.tone(bus, 'pulse25', freq(m), t, STEP * len * 0.92, 0.13, 0.004);
      }
    }
    // drums higher up
    if (this.intensity > 0.45) {
      if (step % 8 === 0) this.kick(bus, t, 0.6);
      if (step % 8 === 4) this.noiseHit(bus, t, 0.09, 'bandpass', 1800, 0.22);
      if (this.intensity > 0.7 && step % 2 === 0) this.noiseHit(bus, t, 0.03, 'highpass', 7000, 0.08);
    }
  }

  // ------------------------------------------------------------ building blocks

  private periodic(kind: 'pulse12' | 'pulse25'): PeriodicWave {
    let w = this.waves.get(kind);
    if (w) return w;
    const duty = kind === 'pulse12' ? 0.125 : 0.25;
    const n = 48;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    w = this.ac!.createPeriodicWave(real, imag);
    this.waves.set(kind, w);
    return w;
  }

  private tone(bus: AudioNode, wave: Wave, f: number, t: number, dur: number, vol: number, attack = 0.002, f2?: number): void {
    const ac = this.ac!;
    const osc = ac.createOscillator();
    if (wave === 'pulse12' || wave === 'pulse25') osc.setPeriodicWave(this.periodic(wave));
    else osc.type = wave;
    osc.frequency.setValueAtTime(f, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseHit(bus: AudioNode, t: number, dur: number, type: BiquadFilterType, cutoff: number, vol: number, cutoff2?: number): void {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(cutoff, t);
    if (cutoff2) filter.frequency.exponentialRampToValueAtTime(cutoff2, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private kick(bus: AudioNode, t: number, vol: number): void {
    this.tone(bus, 'sine', 150, t, 0.16, vol, 0.002, 45);
  }

  private loopNoise(type: BiquadFilterType, cutoff: number) {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    filter.Q.value = 0.7;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start();
    return { src, gain, filter };
  }

  /** Throttle a sound so a burst of identical events doesn't stack up. */
  private ok(name: string, gap: number): boolean {
    if (!this.ac) return false;
    const now = this.ac.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < gap) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  // ------------------------------------------------------------ sound effects

  ui(kind: 'move' | 'select' | 'back'): void {
    if (!this.ac || !this.ok('ui' + kind, 0.03)) return;
    const t = this.ac.currentTime;
    if (kind === 'move') this.tone(this.sfxBus, 'pulse25', 880, t, 0.04, 0.12);
    else if (kind === 'select') {
      this.tone(this.sfxBus, 'pulse25', 660, t, 0.05, 0.15);
      this.tone(this.sfxBus, 'pulse25', 990, t + 0.05, 0.08, 0.15);
    } else this.tone(this.sfxBus, 'pulse25', 520, t, 0.06, 0.12, 0.002, 330);
  }

  /** Continuous sounds that follow the dude: rolling wheels and falling wind. */
  update(sim: Sim, playing: boolean): void {
    if (!this.ac || !this.wind || !this.roll) return;
    const t = this.ac.currentTime;
    const d = sim.state.dude;
    const view = sim.dudeView();
    const fall = playing ? Math.max(0, Math.min(1, (d.vy - 10) / 25)) : 0;
    this.wind.gain.gain.setTargetAtTime(fall * 0.35, t, 0.08);
    this.wind.filter.frequency.setTargetAtTime(500 + fall * 900, t, 0.1);
    const rolling = playing && !view.airborne && !view.stuck ? Math.min(1, Math.abs(d.vx) / 6) : 0;
    this.roll.gain.gain.setTargetAtTime(rolling * 0.12, t, 0.05);
  }

  onEvents(events: SimEvent[]): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const bus = this.sfxBus;
    for (const e of events) {
      switch (e.type) {
        case 'hookFire':
          if (this.ok('fire', 0.05)) {
            this.tone(bus, 'pulse25', 320, t, 0.09, 0.22, 0.002, 1100);
            this.noiseHit(bus, t, 0.03, 'highpass', 3000, 0.15);
          }
          break;
        case 'hookAttach':
          if (this.ok('attach', 0.05)) {
            this.tone(bus, 'sine', 210, t, 0.14, 0.5, 0.002, 90);
            this.tone(bus, 'square', 620, t, 0.03, 0.08);
          }
          break;
        case 'hookCancel':
          if (this.ok('cancel', 0.05)) {
            if (e.reason === 'spent') this.tone(bus, 'square', 160, t, 0.08, 0.15);
            else if (e.reason === 'blocked') this.tone(bus, 'square', 260, t, 0.05, 0.18, 0.002, 180);
            else this.tone(bus, 'triangle', 240, t, 0.07, 0.15, 0.002, 150);
          }
          break;
        case 'hookRelease':
          if (this.ok('release', 0.05)) this.tone(bus, 'sine', 480, t, 0.06, 0.3, 0.002, 900);
          break;
        case 'land':
          if (this.ok('land', 0.06)) {
            const v = Math.min(1, e.speed / 30);
            this.noiseHit(bus, t, 0.08 + v * 0.12, 'lowpass', 400 + v * 1400, 0.15 + v * 0.45);
            if (e.speed > 8) this.tone(bus, 'sine', 90, t, 0.12, 0.25 + v * 0.4, 0.002, 45);
          }
          break;
        case 'bump':
          if (this.ok('bump', 0.06)) {
            const v = Math.min(1, e.speed / 25);
            this.tone(bus, 'square', 130, t, 0.06, 0.08 + v * 0.18, 0.001, 90);
            this.noiseHit(bus, t, 0.05, 'bandpass', 2400, 0.1 + v * 0.2);
          }
          break;
        case 'spring':
          if (this.ok('spring', 0.08)) {
            const ac = this.ac;
            const osc = ac.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(180, t);
            osc.frequency.exponentialRampToValueAtTime(620, t + 0.12);
            osc.frequency.exponentialRampToValueAtTime(260, t + 0.38);
            const lfo = ac.createOscillator();
            lfo.frequency.value = 22;
            const lfoGain = ac.createGain();
            lfoGain.gain.value = 40;
            lfo.connect(lfoGain).connect(osc.frequency);
            const g = ac.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.45, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
            osc.connect(g).connect(bus);
            osc.start(t);
            lfo.start(t);
            osc.stop(t + 0.42);
            lfo.stop(t + 0.42);
          }
          break;
        case 'goopStick':
          if (this.ok('goop', 0.1)) {
            this.noiseHit(bus, t, 0.22, 'bandpass', 900, 0.4, 250);
            this.tone(bus, 'sine', 160, t, 0.2, 0.3, 0.005, 70);
          }
          break;
        case 'goopLetGo':
          this.noiseHit(bus, t, 0.18, 'bandpass', 400, 0.35, 900);
          this.tone(bus, 'sine', 300, t, 0.12, 0.25, 0.002, 140);
          break;
        case 'goopReset':
          ['E4', 'C4', 'A3', 'F3'].forEach((n, i) => this.tone(bus, 'pulse25', freq(n), t + i * 0.13, 0.12, 0.2));
          this.tone(bus, 'triangle', freq('E3'), t + 0.55, 0.5, 0.3, 0.01, freq('C3'));
          break;
        case 'fall':
          this.tone(bus, 'triangle', 420, t, 0.45, 0.25, 0.01, 110);
          break;
        case 'cameos':
          ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => this.tone(bus, 'pulse12', freq(n), t + i * 0.07, 0.18, 0.12));
          break;
        case 'teleport':
          this.tone(bus, 'pulse25', 300, t, 0.2, 0.15, 0.002, 1200);
          break;
        case 'win': {
          const notes = ['C5', 'E5', 'G5', 'C6', 'G5', 'C6', 'E6'];
          notes.forEach((n, i) => this.tone(bus, 'pulse25', freq(n), t + i * 0.11, 0.16, 0.22));
          ['C4', 'E4', 'G4', 'C5'].forEach(n => this.tone(bus, 'triangle', freq(n), t + notes.length * 0.11, 0.9, 0.18, 0.01));
          this.kick(bus, t + notes.length * 0.11, 0.6);
          break;
        }
      }
    }
  }
}
