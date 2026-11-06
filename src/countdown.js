// スタートを押してから Attention までの「数え」の長さ(秒)。DOM に依存しない純粋な部分。
export const COUNTDOWN_DEFAULT = 10;
export const COUNTDOWN_MAX = 60;

// URL の ?countdown=N を秒数にする。0 は数えない。無い・整数でない・範囲外(負・60 超)は既定の 10
export function parseCountdown(v) {
  if (v === null || v === undefined || !/^\d{1,3}$/.test(String(v).trim())) return COUNTDOWN_DEFAULT;
  const n = Number(v);
  return n <= COUNTDOWN_MAX ? n : COUNTDOWN_DEFAULT;
}

// 数える秒数 n から、画面に出す数字を [{ at: 押してからのミリ秒, text }] で返す(n, n-1, …, 1。1 秒おき)
export function countSteps(n) {
  const steps = [];
  for (let i = 0; i < n; i++) steps.push({ at: i * 1000, text: String(n - i) });
  return steps;
}
