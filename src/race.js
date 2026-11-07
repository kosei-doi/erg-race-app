// レースの判定ロジック(DOM に依存しない純粋なクラス)。
// 距離は GO の時点の値を 0 とした差分で測る。ゴールの到達時刻は直前のサンプルとの線形補間で求める。
// 決着は両方がゴールしてから(先にゴールした側は止まり、もう一方が漕ぎ切るまでレースは続く。kosei 2026-11-07)。途中でやめるときは中止(Esc)。

export const DRAW_EPSILON_S = 0.01; // 補間した到達時刻の差がこれ未満なら引き分け

export const LANES = ['left', 'right'];

export class Race {
  /**
   * @param {{distance:number, handicap?:number}} opt
   *   distance: チャレンジャー(right)が漕ぐ距離 / handicap: 部員(left)に足す距離
   */
  constructor({ distance, handicap = 0 }) {
    this.targets = { left: distance + Math.max(0, handicap), right: distance };
    this.startAt = null;
    this.lanes = {};
    this.firstFinishAt = null;
    this.result = null;
  }

  // baselines: GO の時点の各レーンの生の距離。now: ミリ秒の時刻
  start(baselines, now) {
    this.startAt = now;
    for (const l of LANES) {
      this.lanes[l] = {
        base: baselines[l] ?? null, // null のときは最初のサンプルを基準にする
        lastRaw: baselines[l] ?? null, // 直前の生の距離(戻りの検出用)
        delta: 0,
        prev: { t: now, delta: 0 },
        pace: 0, spm: 0, power: 0,
        finishedAt: null, // GO からの秒
      };
    }
  }

  get running() { return this.startAt !== null && !this.result; }

  // 距離の表示用の進み具合(0〜1)。各自の目標に対する割合
  progress(lane) {
    const s = this.lanes[lane];
    if (!s) return 0;
    return Math.min(1, Math.max(0, s.delta / this.targets[lane]));
  }

  update(lane, sample, now) {
    const s = this.lanes[lane];
    if (!s || this.result || s.finishedAt !== null) return;
    if (Number.isFinite(sample.pace)) s.pace = sample.pace;
    if (Number.isFinite(sample.spm)) s.spm = sample.spm;
    if (Number.isFinite(sample.power)) s.power = sample.power;
    if (!Number.isFinite(sample.dist)) return;
    if (s.base === null) s.base = sample.dist;
    if (s.lastRaw !== null && sample.dist < s.lastRaw) s.base = -s.delta; // PM5 の距離が戻った: それまでの距離を保ち、戻った後の値を足していく
    s.lastRaw = sample.dist;
    const delta = sample.dist - s.base;
    const target = this.targets[lane];
    if (delta >= target) {
      const span = delta - s.prev.delta;
      const t = span > 0 ? s.prev.t + ((target - s.prev.delta) / span) * (now - s.prev.t) : now;
      s.finishedAt = Math.max(0, (t - this.startAt) / 1000);
      s.delta = target;
      if (this.firstFinishAt === null) this.firstFinishAt = now;
    } else {
      s.delta = delta;
      s.prev = { t: now, delta };
    }
  }

  // 定期的に呼ぶ。決着したら結果を返す(以後は同じ結果を返す)
  tick(now) {
    if (this.result) return this.result;
    if (this.firstFinishAt === null) return null;
    const l = this.lanes.left.finishedAt, r = this.lanes.right.finishedAt;
    if (l === null || r === null) return null; // 両方がゴールするまで続ける
    const winner = Math.abs(l - r) < DRAW_EPSILON_S ? 'draw' : (l < r ? 'left' : 'right');
    this.result = { winner, times: { left: l, right: r } };
    return this.result;
  }
}
