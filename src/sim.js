// 練習・確認モードの擬似データ(PM5 なし)。tick(now) が PM5 と同じ形のサンプルを返す。
// 自動モードはストローク単位で動く: SPM と比(recoveryRatio)からドライブ・リカバリーを作り、
// 距離はドライブで速く・リカバリーで遅く進む(止まらない)。スタートは静止から短く速いレートで加速する。根拠は README「自動の擬似データ」。
import { wattsFromPace } from './pm5-parse.js';
import { StrokeClock, driveFraction, strokeSeconds } from './stroke.js';

export const KEYS = { left: 'a', right: 'l' };

/** レーンごとの目安(100m 向け)。pace は秒/500m、spm は巡航のレート */
export const PROFILES = {
  challenger: { pace: [120, 150], spm: [28, 36] }, // 来場者: 2:00〜2:30
  member: { pace: [95, 110], spm: [32, 38] },       // 部員: 1:35〜1:50
};

/** 種つきの乱数(0以上1未満)。同じ種なら同じ列 */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const SPEED_SWING = 0.26; // ストローク内の速さの振れ(平均に対して。PM5 は艇でなくフライホイールの速さなので艇より大きめ)
const RAMP_TAU = 1.1;    // 静止からの立ち上がりの時定数(秒)

/** ストローク内の速さの形(正規化前)。ドライブで上がり、リカバリーで下がる */
function shape(phase, d) {
  if (phase < d) return smooth(phase / d);
  return Math.pow(1 - (phase - d) / (1 - d), 2.2);
}
const meanCache = new Map();
function shapeMean(d) {
  const k = d.toFixed(3);
  if (!meanCache.has(k)) { let s = 0; const n = 200; for (let i = 0; i < n; i++) s += shape((i + 0.5) / n, d); meanCache.set(k, s / n); }
  return meanCache.get(k);
}
/** 位相 phase・ドライブ割合 d での速さの倍率(1 が平均) */
export function speedMultiplier(phase, d) { return 1 + SPEED_SWING * (shape(phase, d) - shapeMean(d)) / shapeMean(d); }

export class SimLane {
  /** @param {'key'|'auto'} kind  @param {{speed?:number, scale?:number, seed?:number, profile?:'challenger'|'member'}} opt
   *  speed は profile が無いときの巡航の速さ(m/s)。scale は試験用の速さの倍率(ストロークの時間は変えない) */
  constructor(kind, { speed = 4, scale = 1, seed = 1, profile = null } = {}) {
    this.kind = kind; this.speed = speed; this.scale = scale; this.seed = seed; this.profile = profile;
    this.dist = 0; this.v = 0; this.last = null; this.presses = [];
    this.active = false; // レース中だけ自動は動く
    this.clock = new StrokeClock(); // キー練習の strokeState 用
    this.reset(seed);
  }

  /** 自動の1回ぶんの巡航値を種から決め、静止に戻す(レースごとに呼ぶ。距離は戻さない) */
  reset(seed = this.seed) {
    this.seed = seed;
    const r = rng(seed);
    const pr = this.profile ? PROFILES[this.profile] : null;
    const lerp = (a, b, t) => a + (b - a) * t;
    this.cruisePace = pr ? lerp(pr.pace[0], pr.pace[1], r()) : 500 / this.speed;
    this.cruiseSpm = pr ? lerp(pr.spm[0], pr.spm[1], r()) : 26;
    this.startStrokes = 3 + Math.floor(r() * 4);   // 3〜6 本
    this.startSpm = 38 + r() * 4;                    // 38〜42
    this.rand = r;
    this.t = 0; this.phase = 0; this.strokeIndex = 0;
    this.strokeSpm = this.rateFor(0);
    this.strokeDist = 0; this.strokeTime = 0; this.paceV = 0;
    this.v = 0;
  }

  /** i 本目のストロークのレート。最初の startStrokes 本は高く、2 本かけて巡航へ落ち着く */
  rateFor(i) {
    const n = this.startStrokes, jitter = ((this.rand ? this.rand() : 0.5) - 0.5) * 2; // ±1
    let spm;
    if (i < n) spm = this.startSpm;
    else if (i < n + 2) spm = this.startSpm + (this.cruiseSpm - this.startSpm) * ((i - n + 1) / 3);
    else spm = this.cruiseSpm;
    return Math.max(18, spm + (i < n ? 0 : jitter));
  }

  press(now) { this.presses.push(now); this.dist += 0.8 * this.scale; }

  /** 自動: dt 秒だけ進める(細かく刻んで、ストロークの切り替えで取りこぼさない) */
  step(dt) {
    while (dt > 1e-9) {
      const h = Math.min(dt, 0.01);
      const d = driveFraction(this.strokeSpm), T = strokeSeconds(this.strokeSpm);
      const ramp = 1 - Math.exp(-this.t / RAMP_TAU);
      const vCruise = 500 / this.cruisePace;
      const inStart = this.strokeIndex < this.startStrokes;
      const vMean = vCruise * (inStart ? 1.03 : 1) * ramp; // スタートの強い漕ぎで巡航よりわずかに速い(立ち上がりは ramp が決める)
      this.v = vMean * speedMultiplier(this.phase, d);
      this.dist += this.v * this.scale * h;
      this.strokeDist += this.v * h; this.strokeTime += h;
      this.t += h;
      this.phase += h / T;
      if (this.phase >= 1) {
        this.phase -= 1;
        if (this.strokeTime > 0) this.paceV = this.strokeDist / this.strokeTime; // PM5 の現在のペースはストロークごとの平均
        this.strokeDist = 0; this.strokeTime = 0;
        this.strokeIndex++;
        this.strokeSpm = this.rateFor(this.strokeIndex);
      }
      dt -= h;
    }
  }

  /** レースの開始: 静止から。種を替えて巡航値を引き直す */
  begin(seed = this.seed) { this.reset(seed); this.last = null; this.active = true; }

  tick(now) {
    const dt = this.last === null ? 0 : (now - this.last) / 1000;
    this.last = now;
    if (this.kind === 'auto') {
      let spm = 0, strokeState = 0, pace = 0;
      if (this.active) {
        this.step(Math.min(dt, 1));
        spm = Math.round(this.strokeSpm);
        const vNow = this.paceV > 0 ? this.paceV : (this.strokeTime > 0.3 ? this.strokeDist / this.strokeTime : 0);
        pace = vNow > 0 ? 500 / (vNow * this.scale) : 0;
        strokeState = this.phase < driveFraction(this.strokeSpm) ? 2 : 4;
      } else this.v = 0;
      return { dist: this.dist, pace, spm, power: wattsFromPace(pace), strokeState };
    }
    this.presses = this.presses.filter((t) => now - t < 2000);
    const rate = this.presses.length / 2; // 1 秒あたりの打鍵数
    this.v = rate * 0.8 * this.scale;
    const pace = this.v > 0.3 ? 500 / this.v : 0;
    const sr = Math.round(rate * 30);
    return { dist: this.dist, pace, spm: sr, power: wattsFromPace(pace), strokeState: this.clock.tick(dt, sr).strokeState };
  }
}
