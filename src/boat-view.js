// 艇の SVG(index.html の #boat-svg)をレーンごとに展開し、src/stroke.js の姿勢を反映する。
// 画面(main.js)と、連続コマの撮影用ページ(tests/frames.html)が同じ描画を使う。

const PIVOT_Y = 112, INBOARD = 34, BLADE_W = 14;

/** svg の中身を template(#boat-svg)の複製に置き換え、動かす部品を返す */
export function buildBoat(svg, template) {
  const g = template.cloneNode(true);
  g.removeAttribute('id');
  svg.replaceChildren(g);
  const q = (c) => g.querySelector(c), qa = (c) => [...g.querySelectorAll(c)];
  return { oarL: q('.oar-l'), oarR: q('.oar-r'), inL: q('.oar-in-l'), inR: q('.oar-in-r'), bladeL: q('.oar-l .blade'), bladeR: q('.oar-r .blade'), seat: q('.seat'),
    torso: [q('.torso'), q('.torso-fill')], armL: qa('.arm-l'), armR: qa('.arm-r'), head: q('.head') };
}

/** 姿勢(poseAt の返り値)を SVG に反映する */
export function applyBoatPose(P, pose) {
  const a = pose.angle, rad = a * Math.PI / 180;
  P.oarL.setAttribute('transform', `rotate(${a.toFixed(2)} 50 ${PIVOT_Y})`);
  P.oarR.setAttribute('transform', `rotate(${(-a).toFixed(2)} 110 ${PIVOT_Y})`);
  P.inL.setAttribute('transform', `rotate(${a.toFixed(2)} 50 ${PIVOT_Y})`); // ハンドル側のシャフト(艇体の上の層)
  P.inR.setAttribute('transform', `rotate(${(-a).toFixed(2)} 110 ${PIVOT_Y})`);
  const h = Math.max(2.4, BLADE_W * pose.bladeWidth);
  for (const b of [P.bladeL, P.bladeR]) { b.setAttribute('height', h.toFixed(2)); b.setAttribute('y', (PIVOT_Y - h / 2).toFixed(2)); }
  // 手の位置はオールの内側の端(オールが艇首側へ開くキャッチで、手は艇尾側へ来る)
  const hlx = 50 + INBOARD * Math.cos(rad), hly = PIVOT_Y + INBOARD * Math.sin(rad);
  const hrx = 110 - INBOARD * Math.cos(rad), hry = hly;
  const sy = pose.seatY, sh = sy + pose.lean;
  P.seat.setAttribute('y', (sy - 4).toFixed(2));
  for (const t of P.torso) { t.setAttribute('y1', sy.toFixed(2)); t.setAttribute('y2', sh.toFixed(2)); }
  for (const e of P.armL) { e.setAttribute('y1', sh.toFixed(2)); e.setAttribute('x2', hlx.toFixed(2)); e.setAttribute('y2', hly.toFixed(2)); }
  for (const e of P.armR) { e.setAttribute('y1', sh.toFixed(2)); e.setAttribute('x2', hrx.toFixed(2)); e.setAttribute('y2', hry.toFixed(2)); }
  P.head.setAttribute('transform', `translate(80 ${(sh - 5).toFixed(2)})`);
}
