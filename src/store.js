// 記録(localStorage)。個人名は扱わない。日付が変わったら 0 から数え直す。
const KEY = 'erg-race-v1';
const SETTINGS_KEY = 'erg-race-settings-v1';

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const empty = (day) => ({ day, wins: 0, losses: 0, draws: 0, history: [] });

export function loadToday(storage, now = new Date()) {
  const day = dayKey(now);
  try {
    const s = JSON.parse(storage.getItem(KEY) || 'null');
    if (s && s.day === day) return s;
  } catch { /* 壊れていたら作り直す */ }
  return empty(day);
}

// matchup: 'member'(部員 対 チャレンジャー)は勝利数に数える。'versus'(チャレンジャー同士の赤 対 青)は履歴にだけ残す
export function recordRace(storage, { winner, times, distance, handicap, matchup = 'member' }, now = new Date()) {
  const s = loadToday(storage, now);
  if (matchup === 'versus') {
    s.history.push({ at: now.toISOString(), matchup, winner, distance, redTime: times.right, blueTime: times.left });
    try { storage.setItem(KEY, JSON.stringify(s)); } catch { /* 容量などは無視 */ }
    return s;
  }
  if (winner === 'right') s.wins += 1; else if (winner === 'left') s.losses += 1; else s.draws += 1;
  s.history.push({ at: now.toISOString(), winner, distance, handicap, challengerTime: times.right, memberTime: times.left });
  try { storage.setItem(KEY, JSON.stringify(s)); } catch { /* 容量などは無視 */ }
  return s;
}

export const DEFAULT_SETTINGS = { mode: 'key', distance: 100, handicap: 0, muted: true, matchup: 'member' } // 音は既定でミュート;

export const DIST_MIN = 10, DIST_MAX = 10000, HCP_MAX = 10000;

// 整数の文字列だけ受け付ける(空・文字・小数・符号つき・範囲外は null)
export function parseIntInRange(v, min, max) {
  const t = String(v ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export function loadSettings(storage) {
  let s;
  try { s = { ...DEFAULT_SETTINGS, ...JSON.parse(storage.getItem(SETTINGS_KEY) || '{}') }; } catch { s = { ...DEFAULT_SETTINGS }; }
  // 壊れた・範囲外の距離とハンデは既定に戻す(古い版が保存した値もそのまま通る)
  if (parseIntInRange(s.distance, DIST_MIN, DIST_MAX) === null) s.distance = DEFAULT_SETTINGS.distance;
  if (parseIntInRange(s.handicap, 0, HCP_MAX) === null) s.handicap = DEFAULT_SETTINGS.handicap;
  s.distance = Number(s.distance); s.handicap = Number(s.handicap);
  if (!['member', 'versus'].includes(s.matchup)) s.matchup = 'member';
  return s;
}
export function saveSettings(storage, s) { try { storage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* 無視 */ } }
