// 上から見たシングルスカルの1ストロークを、位相(0〜1)の関数で表す。DOM に依存しない純粋な関数。
// 位相: 0 = キャッチ、0〜driveFraction = ドライブ、driveFraction〜1 = リカバリー(1 は次のキャッチの直前)。
// 角度は「オールの垂直(艇に直角)からの角」。+ は艇首側(画面の上)へ開く、- は艇尾側(下)へ寄る。
// 根拠と出典は README「漕ぎの動きの根拠」。

export const CATCH_ANGLE = 65;   // 度。キャッチで艇首側へ開く(エリートのスカルの平均 61〜66 度)
export const FINISH_ANGLE = -42; // 度。フィニッシュで艇尾側へ寄る(同 42〜44 度)
export const SLIDE_CATCH_Y = 112; // 座面の位置(SVG の y。大きいほど艇尾側)。キャッチ
export const SLIDE_FINISH_Y = 86; // フィニッシュ
export const LEAN_CATCH = 10;     // 上体が艇尾側へ倒れる量(SVG の y)
export const LEAN_FINISH = -10;   // 艇首側へ倒れる量
export const FEATHER_WIDTH = 1;   // 上から見たブレードの見かけの幅(寝かせた=広い面が見える)
export const SQUARE_WIDTH = 0.2;  // スクエア(立てた=縁だけが見える)

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

/** リカバリー : ドライブ の時間比。低いレート(20 以下)で 2:1、レートが上がると 1:1(40 以上)へ近づく */
export function recoveryRatio(spm) {
  if (!(spm > 0)) return 2;
  return Math.min(2, Math.max(1, 2 - (spm - 20) / 20));
}

/** 1ストロークのうちドライブが占める割合(0〜1) */
export function driveFraction(spm) { return 1 / (1 + recoveryRatio(spm)); }

/** 秒。spm が 0 のときは 0 */
export function strokeSeconds(spm) { return spm > 0 ? 60 / spm : 0; }

const wrap = (p) => { p %= 1; return p < 0 ? p + 1 : p; };

/** ドライブ(0〜1)の進み具合 u、リカバリー(0〜1)の進み具合 u へ分ける */
function split(phase, d) {
  const p = wrap(phase);
  return p < d ? { drive: true, u: p / d } : { drive: false, u: (p - d) / (1 - d) };
}

/** オールの角度(度)。キャッチで最大(艇首側)、フィニッシュで最小(艇尾側)。左右は対称 */
export function oarAngle(phase, spm = 25) {
  const d = driveFraction(spm);
  const { drive, u } = split(phase, d);
  if (drive) return lerp(CATCH_ANGLE, FINISH_ANGLE, lerp(u, smooth(u), 0.6));
  return lerp(FINISH_ANGLE, CATCH_ANGLE, lerp(u, smooth(u), 0.6));
}

/** ブレードのスクエア度(1 = スクエア、0 = フェザー)。
 *  ドライブ中はスクエア。フィニッシュで素早くフェザーへ、リカバリーの終わり 25% でスクエアへ戻し、キャッチ(位相 1→0)ではスクエア */
export function bladeSquare(phase, spm = 25) {
  const d = driveFraction(spm);
  const { drive, u } = split(phase, d);
  if (drive) return 1;
  if (u < 0.12) return 1 - smooth(u / 0.12);
  if (u > 0.75) return smooth((u - 0.75) / 0.25);
  return 0;
}

/** 上から見たブレードの見かけの幅(SQUARE_WIDTH〜FEATHER_WIDTH) */
export function bladeWidth(phase, spm = 25) {
  return lerp(FEATHER_WIDTH, SQUARE_WIDTH, bladeSquare(phase, spm));
}

/** スライドの進み(0 = キャッチ側(艇尾)、1 = フィニッシュ側(艇首))。
 *  ドライブは脚が先に押す(前半に速い)、リカバリーは腕→体→脚の順なので、座面は後半に動く */
export function slideProgress(phase, spm = 25) {
  const d = driveFraction(spm);
  const { drive, u } = split(phase, d);
  if (drive) return 1 - Math.pow(1 - u, 1.7);
  return 1 - Math.pow(u, 1.6);
}

/** 上体の倒れ(0 = キャッチの前傾、1 = フィニッシュの後傾)。ドライブの中ほどから開き、リカバリーの前半に起こした形から体を倒す */
export function leanProgress(phase, spm = 25) {
  const d = driveFraction(spm);
  const { drive, u } = split(phase, d);
  if (drive) return smooth((u - 0.25) / 0.75); // 脚が先、そのあと体
  return 1 - smooth(u / 0.55); // 腕が先に出たあと体を前へ(リカバリーの前半で戻す)
}

/** 腕の曲がり(0 = 伸ばしきり、1 = 引きつけきり) */
export function armBend(phase, spm = 25) {
  const d = driveFraction(spm);
  const { drive, u } = split(phase, d);
  if (drive) return smooth((u - 0.6) / 0.4); // ドライブの最後に腕
  return 1 - smooth(u / 0.3); // リカバリーの最初に腕を伸ばす
}

/** サージの速さが最小になる位相(キャッチの直後)。最大はその反対側(0.55 = リカバリーの前半〜中ほど) */
export const SURGE_SLOWEST = 0.05;

/** 艇の速さの揺れ(サージ)の位置。-1〜1。艇(シェル)の速さはリカバリー中が平均より速く、キャッチの直後が最も遅い(位置は速度の積分)。見た目だけに使う */
export function surge(phase) {
  return Math.sin(2 * Math.PI * (wrap(phase) - SURGE_SLOWEST - 0.5));
}

/** 艇の速さの揺れ(相対値。1 が平均)。キャッチの直後(位相 0.05)が最小、リカバリーの前半〜中ほどが最大 */
export function surgeSpeed(phase) {
  return 1 - 0.5 * Math.cos(2 * Math.PI * (wrap(phase) - SURGE_SLOWEST));
}

/** 漕いでいない(SPM 0)ときの静止の姿勢: フェザー、リカバリーの途中の形 */
export const REST_PHASE = 0.7;

/** 1つの位相の姿勢をまとめて返す(描画用)。spm が 0 以下なら、フェザーで止まった姿勢 */
export function poseAt(phase, spm) {
  if (!(spm > 0)) {
    const p = REST_PHASE, s = 25;
    return { angle: oarAngle(p, s), square: 0, bladeWidth: FEATHER_WIDTH, seatY: seatY(p, s), lean: leanY(p, s), arm: armBend(p, s), surge: 0, resting: true };
  }
  return { angle: oarAngle(phase, spm), square: bladeSquare(phase, spm), bladeWidth: bladeWidth(phase, spm),
    seatY: seatY(phase, spm), lean: leanY(phase, spm), arm: armBend(phase, spm), surge: surge(phase), resting: false };
}

export function seatY(phase, spm = 25) { return lerp(SLIDE_CATCH_Y, SLIDE_FINISH_Y, slideProgress(phase, spm)); }
export function leanY(phase, spm = 25) { return lerp(LEAN_CATCH, LEAN_FINISH, leanProgress(phase, spm)); }

// ---- PM5 の strokeState(一般状態 0x0031 のバイト10)---
// 0 = ホイールが最低速度に達するのを待つ、1 = ホイールの加速を待つ、2 = ドライブ、3 = ドライブ後の保持(ドウェル)、4 = リカバリー
export function strokeKind(state) {
  if (state === 2) return 'drive';
  if (state === 3 || state === 4) return 'recovery';
  return 'idle';
}

/**
 * strokeState と SPM から位相を推定する。通知は粗い(約 0.5 秒おき)ので、通知の間はドライブ・リカバリーの長さの見積もりで補間する。
 * 状態の切り替えより位相が先に進んだら端で待ち(ドライブは finish、リカバリーはキャッチ直前)、
 * 遅れていたら素早く追いつく(動きが飛ばない)。
 */
export class StrokeTracker {
  constructor() { this.phase = 0; this.kind = 'idle'; this.last = null; this.rush = false; }

  /** @param {number|undefined} state strokeState(未知なら undefined)  @param {number} spm  @param {number} now ミリ秒 */
  update(state, spm, now) {
    const dt = this.last === null ? 0 : Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!(spm > 0)) { this.kind = 'idle'; this.rush = false; return this.phase; }
    const d = driveFraction(spm), T = strokeSeconds(spm);
    const kind = Number.isFinite(state) ? strokeKind(state) : null; // null: 状態が分からない(位相は SPM だけで進める)
    this.kind = kind ?? this.kind;
    const rate = 1 / T; // 1 秒あたりの位相の進み(位相は時間の割合なので、ドライブでもリカバリーでも同じ)
    let p = this.phase;
    if (kind === null) { this.phase = wrap(p + rate * dt); return this.phase; }
    if (kind === 'idle') { this.phase = Math.min(p, 0.999); return this.phase; }
    const fast = 3; // 遅れを取り戻す速さの倍率
    if (kind === 'drive') {
      if (p > d) { // (p === d はフィニッシュで待っている状態)まだリカバリーの形なら、素早くキャッチまで進めてドライブへ(まだ 1 未満なら、後戻りさせずそのまま返す)
        p += rate * fast * dt;
        if (p >= 1) p = 0;
      } else {
        p += rate * dt;
        if (p > d) p = d; // ドライブが長引いたらフィニッシュで待つ
      }
    } else {
      if (p < d) { p += rate * fast * dt; if (p > d) p = d; } // まだドライブの形なら、素早くフィニッシュまで進めてリカバリーへ
      else p = Math.min(0.999, p + rate * dt); // リカバリーが長引いたらキャッチ直前で待つ
    }
    this.phase = p;
    return p;
  }
}

/** 練習モードの擬似ストローク: SPM と比から位相を進め、PM5 と同じ形の strokeState(2 ドライブ / 4 リカバリー / 0 停止)も返す */
export class StrokeClock {
  constructor() { this.phase = 0; }
  tick(dtSec, spm) {
    if (!(spm > 0)) return { phase: this.phase, strokeState: 0 };
    const T = strokeSeconds(spm);
    this.phase = wrap(this.phase + Math.min(0.2, Math.max(0, dtSec)) / T);
    return { phase: this.phase, strokeState: this.phase < driveFraction(spm) ? 2 : 4 };
  }
}
