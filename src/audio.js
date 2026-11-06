// Web Audio で合成する効果音(ファイル不要)。最初のクリックの後に鳴らせる。
let ctx = null;
let muted = false;
export const setMuted = (m) => { muted = m; bgmSync(); };

// レース中の BGM。ファイル bgm/race.mp3 はライセンス上 git・公開版に入れず、ローカルにだけ置く。
// 無いとき(公開版)は error を黙って無視し、何も出さず・何もしない。ループしない(最後まで鳴ったら止まる)。
const BGM_SRC = 'bgm/race.mp3', BGM_VOLUME = 0.3; // 効果音の gain 0.15〜0.2 より控えめ
let bgm = null, bgmWanted = false, bgmMissing = false;
function bgmSync() {
  if (!bgmWanted || bgmMissing) { if (bgm && !bgm.paused) bgm.pause(); return; }
  if (muted) { if (bgm && !bgm.paused) bgm.pause(); return; } // オフにしたら止まる(オンに戻したら続きから)
  try {
    if (!bgm) {
      bgm = new Audio();
      bgm.preload = 'auto'; bgm.loop = false; bgm.volume = BGM_VOLUME;
      bgm.addEventListener('error', () => { bgmMissing = true; });
      bgm.src = BGM_SRC;
    }
    if (bgm.paused && !bgm.ended) { const p = bgm.play(); if (p && p.catch) p.catch(() => {}); }
  } catch { /* BGM が鳴らなくても進行は止めない */ }
}
export const bgmStart = () => { bgmWanted = true; if (bgm) { bgm.pause(); bgm.currentTime = 0; } bgmSync(); };
export const bgmStop = () => {
  bgmWanted = false;
  if (bgm) { try { bgm.pause(); bgm.currentTime = 0; } catch { /* 無視 */ } }
};


function beep(freq, dur, when = 0, type = 'square', gain = 0.15) {
  if (muted) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* 音が出なくても進行は止めない */ }
}
export const unlock = () => beep(1, 0.01, 0, 'sine', 0.0001);
export const countBeep = () => beep(660, 0.18);
export const goBeep = () => beep(1320, 0.5);
export const goalFanfare = (win) => {
  const notes = win ? [523, 659, 784, 1047, 784, 1047] : [440, 392, 349];
  notes.forEach((f, i) => beep(f, 0.22, i * 0.15, win ? 'triangle' : 'sine', 0.2));
};
