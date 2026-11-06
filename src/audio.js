// Web Audio で合成する効果音(ファイル不要)。最初のクリックの後に鳴らせる。
let ctx = null;
let muted = false;
export const setMuted = (m) => { muted = m; };

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
