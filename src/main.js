import { Race, LANES } from './race.js';
import { Pm5Link, bluetoothAvailable } from './pm5-ble.js';
import { SimLane, KEYS } from './sim.js';
import { buildBoat, applyBoatPose } from './boat-view.js';
import { StrokeTracker, poseAt, driveFraction } from './stroke.js';
import { formatPace, formatTime, wattsFromPace } from './pm5-parse.js';
import * as audio from './audio.js';
import { loadToday, recordRace, loadSettings, saveSettings, parseIntInRange, DIST_MIN, DIST_MAX, HCP_MAX } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
const simSeed = Number(params.get('simseed')) || 0; // 試験用: 自動モードの乱数の種(無ければレースごとに乱数)
const simScale = Number(params.get('simspeed')) || 1; // 試験用: 自動モードの速さの倍率
// 試験用: countms を指定すると Attention → GO の間を countms×2 ミリ秒に固定する。指定が無ければ本物の発艇のように 1.5〜3 秒のランダム
const COUNT_MS = Number(params.get('countms')) || 0;
const attentionGap = () => (COUNT_MS ? COUNT_MS * 2 : 1500 + Math.random() * 1500);

const app = $('#app');
const settings = loadSettings(localStorage);
if (['real', 'key', 'auto'].includes(params.get('mode'))) settings.mode = params.get('mode');

const CONN_TEXT = { idle: '未接続', connecting: '接続中…', connected: '接続OK', reconnecting: '再接続中…', lost: '切断!', error: 'Bluetooth 不可' };
const LANE_NAME = { left: '部員', right: 'チャレンジャー' };

const el = {};
for (const l of LANES) {
  const root = $(`#lane-${l}`);
  el[l] = { root, dist: $('.dist', root), pace: $('.pace', root), spm: $('.spm', root), power: $('.power', root),
    rowed: $('.rowed-m', root), connText: $('.conn-text', root), device: $('.device', root), btn: $('.connect-btn', root), target: $('.target', root), water: $('.water', root) };
}

// 艇の SVG をレーンごとに展開する(オール・漕ぎ手を JS で動かすため。<use> の中は個別に触れない)
const boatParts = {};
for (const l of LANES) boatParts[l] = buildBoat($('.boat svg', el[l].root), $('#boat-svg'));
const trackers = { left: new StrokeTracker(), right: new StrokeTracker() };
const wasDrive = { left: false, right: false };

// ---- 状態 ----
let phase = 'waiting';
let race = null;
let links = {}; // real: Pm5Link
let sims = {}; // key/auto: SimLane
const raw = { left: { dist: NaN, pace: 0, spm: 0, power: 0, at: 0 }, right: { dist: NaN, pace: 0, spm: 0, power: 0, at: 0 } };
const shown = { left: 0, right: 0 }; // 画面上の距離(m)。滑らかに増やす
let timers = [];

// ---- 描画の呼び出し ----
// rAF は countdown・racing・結果の演出の間だけ回し続ける。待機・準備OK・結果の表示中は、サンプルの通知とキー入力のたびに1回だけ描く(省電力)
let rafId = 0;
let loopUntil = 0; // 結果の演出の間、この時刻まで回し続ける
const loopWanted = (now) => phase === 'countdown' || phase === 'racing' || now < loopUntil;
function requestDraw() { if (!rafId) rafId = requestAnimationFrame(frame); }

const LOCKED_PHASES = ['countdown', 'racing'];
function setPhase(p) {
  phase = p; app.dataset.phase = p;
  const locked = LOCKED_PHASES.includes(p); // レース中は接続の方法・距離・ハンデを変えられない
  setMode.disabled = setDist.disabled = setHcp.disabled = locked;
  for (const b of distPresets) b.disabled = locked;
  if (locked) $('#settings').hidden = true;
}

// ---- 入力元の組み立て ----
function setupSources() {
  for (const l of LANES) links[l]?.disconnect?.();
  links = {}; sims = {};
  app.dataset.mode = settings.mode;
  for (const l of LANES) {
    raw[l] = { dist: NaN, pace: 0, spm: 0, power: 0, at: 0 };
    if (settings.mode === 'real') {
      links[l] = new Pm5Link((s) => onRealSample(l, s), (status, name) => onConn(l, status, name));
      onConn(l, 'idle', '');
    } else {
      sims[l] = new SimLane(settings.mode, { speed: l === 'left' ? 4.0 : 3.7, scale: settings.mode === 'auto' ? simScale : 1, seed: l === 'left' ? 2 : 1, profile: l === 'left' ? 'member' : 'challenger' });
      el[l].root.dataset.conn = 'connected';
      el[l].connText.textContent = '接続OK';
      el[l].device.textContent = settings.mode === 'key' ? `キー ${KEYS[l].toUpperCase()} を連打` : '擬似データ';
    }
  }
  updateReady();
}

function onConn(l, status, name) {
  el[l].root.dataset.conn = status;
  el[l].connText.textContent = CONN_TEXT[status] ?? status;
  el[l].device.textContent = name || '';
  el[l].btn.textContent = status === 'lost' ? '再接続' : (status === 'connected' ? 'つなぎ直す' : 'PM5 をつなぐ');
  updateReady();
}

function onRealSample(l, s) {
  const now = performance.now();
  raw[l] = { ...raw[l], ...s, at: now }; // 距離を持たない通知(追加状態)では前の距離を残す
  if (race?.running) race.update(l, s, now);
  requestDraw();
}

function isReady() {
  if (settings.mode !== 'real') return true;
  return LANES.every((l) => links[l]?.status === 'connected');
}

function updateReady() {
  const ready = isReady();
  app.dataset.ready = String(ready);
  if (phase === 'waiting' || phase === 'ready') {
    setPhase(ready ? 'ready' : 'waiting');
    $('#start-btn').disabled = !ready;
    $('#status-msg').textContent = ready
      ? '準備OK! スタートを押してください'
      : (settings.mode === 'real' ? '左右の PM5 を両方つないでください(つながらないときは設定で練習モード)' : '');
  }
}

for (const l of LANES) {
  el[l].btn.addEventListener('click', async () => {
    audio.unlock();
    const link = links[l];
    if (!link) return;
    // 全画面だと機器選択のダイアログが出ない・全画面が解けることがあるので、先に全画面を抜ける
    const wasFs = !!document.fullscreenElement;
    if (wasFs) { try { await document.exitFullscreen(); } catch { /* 無視 */ } }
    const other = links[l === 'left' ? 'right' : 'left'];
    // 同じ PM5 を左右に選べないようにする
    const reject = (d) => (other?.device && other.wantConnected && other.device.id === d.id
      ? `その PM5 は${l === 'left' ? '右' : '左'}につながっています(別の PM5 を選んでください)` : null);
    try { if (link.status === 'lost') await link.reconnect(reject); else await link.pair(reject); }
    catch (e) {
      if (wasFs && (e?.name === 'SecurityError' || e?.name === 'NotAllowedError')) $('#status-msg').textContent = '全画面を抜けました。もう一度押してください';
      else if (e?.name !== 'NotFoundError') $('#status-msg').textContent = `${LANE_NAME[l]}: ${e?.message || e}`;
    }
    finally { el[l].btn.blur(); } // フォーカスを残さない(あとの Space / Enter / Esc がレースの操作として効くように)
  });
}
if (settings.mode === 'real' && !bluetoothAvailable()) {
  // 画面に出す。localhost か https の Chrome でないと navigator.bluetooth は無い
  setTimeout(() => { $('#status-msg').textContent = 'この画面では Bluetooth が使えません(Chrome で開いているか確認。Safari・Firefox は不可)'; }, 0);
}

// ---- レースの流れ ----
function clearTimers() { timers.forEach(clearTimeout); timers = []; }
const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };

function startCountdown() {
  if (!(phase === 'ready')) return;
  audio.unlock();
  setPhase('countdown');
  $('#settings').hidden = true;
  const box = $('#countdown'), num = $('#count-num');
  const gap = attentionGap();
  const show = (t, call, beep) => { num.textContent = t; box.dataset.call = call; num.style.animation = 'none'; void num.offsetWidth; num.style.animation = ''; beep(); };
  box.hidden = false;
  show('Attention', 'attention', audio.countBeep);
  later(() => { show('GO!', 'go', audio.goBeep); goRace(); }, gap);
  later(() => { box.hidden = true; }, gap + 700);
}

function goRace() {
  const now = performance.now();
  race = new Race({ distance: Number(settings.distance), handicap: Number(settings.handicap) });
  const base = {};
  const runSeed = simSeed || ((Math.random() * 0x7fffffff) | 0) + 1; // 自動モード: レースごとに巡航のペース・レート・スタートの本数が少し変わる
  for (const l of LANES) {
    // GO の時点の値を 0 とする。実機でまだ値が来ていなければ null(最初の値が基準)
    const d = settings.mode === 'real' ? raw[l].dist : sims[l].dist;
    base[l] = Number.isFinite(d) ? d : null;
    shown[l] = 0;
    if (sims[l]) { sims[l].last = null; sims[l].active = true; if (sims[l].kind === 'auto') sims[l].begin(runSeed + (l === 'left' ? 7919 : 0)); } // 待機中は tick していないので時間差の基準を作り直す
  }
  race.start(base, now);
  $('#elapsed').textContent = '0.00';
  setPhase('racing');
  requestDraw();
}

function abortRace() {
  if (!LOCKED_PHASES.includes(phase)) return;
  clearTimers();
  $('#countdown').hidden = true;
  race = null;
  for (const l of LANES) { shown[l] = 0; render(l, 0, { pace: 0, spm: 0, power: 0 }); el[l].root.style.setProperty('--p', '0'); stroke(l, performance.now(), 0, false); }
  setPhase('waiting');
  if (settings.mode !== 'real') setupSources(); // 擬似データの距離を 0 に戻す(実機の接続は切らない)
  updateReady();
  requestDraw();
}

function finishRace(result) {
  for (const l of LANES) sims[l] && (sims[l].active = false);
  setPhase('finished');
  loopUntil = performance.now() + 1000; // 結果の演出の間は描き続ける
  const rec = recordRace(localStorage, { ...result, distance: Number(settings.distance), handicap: Number(settings.handicap) });
  renderWins(rec);
  const card = $('.result-card'), title = $('#result-title'), sub = $('#result-sub'), times = $('#result-times');
  card.dataset.winner = result.winner;
  if (result.winner === 'right') { title.textContent = 'チャレンジャーの勝ち!'; sub.textContent = 'トッピング無料!'; }
  else if (result.winner === 'left') { title.textContent = '部員の勝ち!'; sub.textContent = 'また挑戦してね!'; }
  else { title.textContent = '引き分け!'; sub.textContent = 'もう一回!'; }
  const t = (x) => (x == null ? '未ゴール' : `${formatTime(x)} 秒`);
  times.textContent = `チャレンジャー ${t(result.times.right)}　/　部員 ${t(result.times.left)}`;
  $('#result').hidden = false;
  audio.goalFanfare(result.winner === 'right');
}

function nextRace() {
  if (phase !== 'finished') return;
  $('#result').hidden = true;
  race = null;
  for (const l of LANES) { shown[l] = 0; render(l, 0, { pace: 0, spm: 0, power: 0 }); }
  setPhase('waiting');
  if (settings.mode !== 'real') setupSources(); // 擬似データの距離を 0 に戻す(実機の接続は切らない)
  updateReady();
  renderWins(); // 画面を開いたまま日付をまたいでも、前日の数が残らないように
  requestDraw();
}

// 押した後はフォーカスを外す(その後の Space / Enter がボタン上で無視されないように)
$('#start-btn').addEventListener('click', (e) => { e.currentTarget.blur(); startCountdown(); });
$('#next-btn').addEventListener('click', (e) => { e.currentTarget.blur(); nextRace(); });
$('#abort-btn').addEventListener('click', (e) => { e.currentTarget.blur(); abortRace(); });

// ---- 描画 ----
// レーンの目標距離(右=レース距離、左=レース距離+ハンデ。Race の targets と同じ考え)
function laneTarget(l) {
  if (race) return race.targets[l];
  const d = Number(settings.distance), h = Math.max(0, Number(settings.handicap) || 0);
  return l === 'left' ? d + h : d;
}

// dist は進んだ距離。大きい数字は残り(目標 - 進んだ距離、切り上げ、0 未満にしない)、進んだ距離は小さく出す
function render(l, dist, s) {
  const e = el[l];
  e.dist.textContent = String(Math.max(0, Math.ceil(laneTarget(l) - dist)));
  e.rowed.textContent = String(Math.floor(dist));
  e.pace.textContent = formatPace(s.pace);
  e.spm.textContent = String(Math.round(s.spm || 0));
  e.power.textContent = String(Math.round(s.power || 0));
}

function applyPose(l, pose) {
  applyBoatPose(boatParts[l], pose);
  el[l].root.style.setProperty('--surge', (pose.surge * 0.45).toFixed(3)); // 見た目の位置だけ(vh)。距離の数字には足さない
}

// ブレードが抜けた所に渦(パドル)を残す。水に固定なので、艇が進むと後ろへ流れ、時間で消える
function spawnPuddles(l) {
  const water = el[l].water, wr = water.getBoundingClientRect(), P = boatParts[l];
  if (water.querySelectorAll('.puddle').length > 10) return;
  for (const b of [P.bladeL, P.bladeR]) {
    const r = b.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'puddle';
    d.style.left = `${r.left + r.width / 2 - wr.left}px`;
    d.style.top = `${r.top + r.height / 2 - wr.top}px`;
    d.addEventListener('animationend', () => d.remove());
    water.appendChild(d);
  }
}

const START_SPM_GUESS = 38; // 実機でレースの最初の SPM が 0 の間の仮の値(スタートは 36〜40)

// ストロークの動き: レース中だけ位相を進める。SPM が 0 ならフェザーで止める
function stroke(l, now, spm, running) {
  const tr = trackers[l];
  // 実機は最初の数本の SPM が 0 のことがある。ドライブ・リカバリーの通知が来ているなら、仮の SPM で動かす(漕いでいない・通知が無いときはフェザーで止まる)
  const ss = raw[l].strokeState;
  if (running && !(spm > 0) && settings.mode === 'real' && (ss === 2 || ss === 4)) spm = START_SPM_GUESS;
  if (!running || !(spm > 0)) {
    tr.update(undefined, 0, now);
    wasDrive[l] = false;
    applyPose(l, poseAt(0, 0));
    return;
  }
  const phase = tr.update(raw[l].strokeState, spm, now);
  const driving = phase < driveFraction(spm);
  if (wasDrive[l] && !driving) spawnPuddles(l);
  wasDrive[l] = driving;
  applyPose(l, poseAt(phase, spm));
}

function renderTargets() {
  const d = Number(settings.distance), h = Number(settings.handicap) || 0;
  el.right.target.textContent = `ゴールまで ${d} m`;
  if (!race) for (const l of LANES) el[l].dist.textContent = String(laneTarget(l)); // 待機中は残り=目標(設定を変えたらすぐ変わる)
  el.left.target.textContent = h > 0 ? `ハンデ +${h} m → ${d + h} m` : `ゴールまで ${d} m`;
}

function renderWins(rec = loadToday(localStorage)) {
  $('#wins-count').textContent = String(rec.wins);
  $('#wins-detail').textContent = `(${rec.wins + rec.losses + rec.draws}戦)`;
}

function frame(now) {
  rafId = 0;
  draw(now);
  if (loopWanted(now)) requestDraw();
}

function draw(now) {
  // 擬似データのサンプルを取り込む
  for (const l of LANES) {
    const sim = sims[l];
    if (!sim) continue;
    const s = sim.tick(now);
    raw[l] = { ...s, at: now };
    if (race?.running) race.update(l, s, now);
  }

  if (race) {
    const result = race.tick(now);
    for (const l of LANES) {
      const st = race.lanes[l];
      const target = race.targets[l];
      let est = st.delta;
      if (st.finishedAt !== null) est = target;
      else if (race.running && st.pace > 0 && st.spm > 0) { // 漕ぎやめたら(SPM 0)補間しない
        const since = Math.min(0.5, (now - st.prev.t) / 1000);
        est = Math.min(target - 0.01, st.delta + (500 / st.pace) * since);
      }
      shown[l] = Math.max(shown[l], est); // 後戻りしない
      render(l, shown[l], st);
      el[l].root.style.setProperty('--p', String(Math.min(1, shown[l] / target)));
      stroke(l, now, race.running ? st.spm : 0, race.running);
    }
    if (race.running) $('#elapsed').textContent = formatTime((now - race.startAt) / 1000);
    if (result && phase === 'racing') finishRace(result);
  } else {
    // レース前: 現在値(ペース・SPM)だけ見せて、距離は 0 のまま
    for (const l of LANES) {
      const s = raw[l];
      const pace = s.pace || 0;
      render(l, 0, { pace, spm: s.spm, power: s.power ?? wattsFromPace(pace) });
      el[l].root.style.setProperty('--p', '0');
      stroke(l, now, 0, false);
    }
  }
}

// ---- キー操作 ----
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (settings.mode === 'key') {
    for (const l of LANES) if (k === KEYS[l]) sims[l]?.press(performance.now());
  }
  const t = e.target;
  if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  // 設定パネルの「閉じる」ボタンだけは Space / Enter を本来の動き(押す)に任せる。それ以外のボタンの上ではレースの操作
  const inSettings = !!(t && t.closest && t.closest('#settings'));
  if (inSettings && (k === ' ' || k === 'enter')) return;
  if (t && t.tagName === 'BUTTON' && (k === ' ' || k === 'enter')) e.preventDefault(); // ボタンが押される(ダイアログが開くなど)のを止める
  if (k === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleFullscreen(); return; }
  if (k === 'escape') { abortRace(); return; }
  if (settings.mode === 'key') { requestDraw(); setTimeout(requestDraw, 2100); } // 待機中の表示(押すのをやめたら 0 に戻す)
  if (k === ' ' || k === 'enter') {
    if (phase === 'ready') startCountdown(); else if (phase === 'finished') nextRace();
  }
});

window.addEventListener('keyup', (e) => { // Space は keyup でボタンが押されるので、そちらも止める
  const t = e.target;
  if (e.key === ' ' && t && t.tagName === 'BUTTON' && !(t.closest && t.closest('#settings'))) e.preventDefault();
});

// ---- 設定 ----
const setMode = $('#set-mode'), setDist = $('#set-distance'), setHcp = $('#set-handicap'), setMuted = $('#set-muted'), setClear = $('#set-clear');
function syncSettingsUi() {
  setMode.value = settings.mode; setDist.value = String(settings.distance);
  setHcp.value = String(settings.handicap); setMuted.checked = !!settings.muted;
  $('#mute-btn').textContent = settings.muted ? '音: オフ' : '音: オン';
  audio.setMuted(!!settings.muted);
  renderTargets();
  requestDraw();
}
const distPresets = [...document.querySelectorAll('#dist-presets button')];
const setMsg = $('#set-msg');
function commitSettings() {
  if (LOCKED_PHASES.includes(phase)) { syncSettingsUi(); return; }
  settings.mode = setMode.value;
  // 距離・ハンデは範囲内の整数だけ受け付ける。だめなら直前の値に戻して知らせる
  const d = parseIntInRange(setDist.value, DIST_MIN, DIST_MAX), h = parseIntInRange(setHcp.value, 0, HCP_MAX);
  const bad = [];
  if (d === null) bad.push(`距離は ${DIST_MIN}〜${DIST_MAX} m の整数で入れてください`); else settings.distance = d;
  if (h === null) bad.push(`ハンデは 0〜${HCP_MAX} m の整数で入れてください`); else settings.handicap = h;
  setMsg.textContent = bad.length ? `${bad.join('。')}。前の値(距離 ${settings.distance} m・ハンデ ${settings.handicap} m)に戻しました` : '';
  settings.muted = setMuted.checked;
  saveSettings(localStorage, settings);
  syncSettingsUi();
}
setDist.addEventListener('change', commitSettings);
for (const b of distPresets) b.addEventListener('click', () => { setDist.value = b.dataset.dist; commitSettings(); });
setHcp.addEventListener('change', commitSettings);
setMuted.addEventListener('change', commitSettings);
setMode.addEventListener('change', () => {
  if (phase === 'countdown' || phase === 'racing') { setMode.value = settings.mode; return; }
  commitSettings(); setupSources();
});
$('#settings-btn').addEventListener('click', () => { $('#settings').hidden = !$('#settings').hidden; });
$('#settings-close').addEventListener('click', () => {
  if (setClear.checked) { try { localStorage.removeItem('erg-race-v1'); } catch { /* 無視 */ } setClear.checked = false; renderWins(); }
  $('#settings').hidden = true;
});
$('#mute-btn').addEventListener('click', () => { settings.muted = !settings.muted; saveSettings(localStorage, settings); syncSettingsUi(); });

// ---- 全画面(タブ・アドレスバーが消える) ----
const fsBtn = $('#fs-btn');
function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}
function syncFsBtn() { fsBtn.textContent = document.fullscreenElement ? '全画面をやめる' : '全画面'; }
if (document.fullscreenEnabled) fsBtn.hidden = false;
fsBtn.addEventListener('click', () => { toggleFullscreen(); fsBtn.blur(); });
document.addEventListener('fullscreenchange', syncFsBtn);

// ---- 起動 ----
syncSettingsUi();
setupSources();
renderWins();
requestDraw();

window.addEventListener('beforeunload', clearTimers);
