/**
 * データ検証スクリプト
 *   node scripts/validate.mjs
 * - すべての反応式が「つり合っている」「最も簡単な整数比」であることを確認
 * - 反応式に登場する化学式がすべて物質データに登録されていることを確認
 */
import { allGenerated as generated, pickEquation as pick } from "../src/generator.js";
import { checkBalance, equationToUnicode, parseFormula } from "../src/chem.js";
import { EQUATIONS, SUBSTANCES, substanceByFormula, quizSubstances, judgeEquations, buildEquations, equationsByLevel } from "../src/data.js";

let errors = 0;

function fail(msg) {
  errors++;
  console.error("NG: " + msg);
}

// 物質データの重複チェック
const seen = new Set();
for (const s of SUBSTANCES) {
  if (seen.has(s.f)) fail("物質が重複: " + s.f);
  seen.add(s.f);
  const atoms = parseFormula(s.f);
  if (Object.keys(atoms).length === 0) fail("化学式をパースできない: " + s.f);
}

// 反応式チェック
const ids = new Set();
for (const e of EQUATIONS) {
  if (ids.has(e.id)) fail("反応式 id が重複: " + e.id);
  ids.add(e.id);

  const res = checkBalance(e);
  if (!res.balanced) {
    fail(
      e.id + " がつり合っていない: " + equationToUnicode(e) +
      "  left=" + JSON.stringify(res.leftAtoms) +
      " right=" + JSON.stringify(res.rightAtoms)
    );
  }
  if (!res.simplest) {
    fail(e.id + " の係数が最も簡単な整数比でない: " + equationToUnicode(e));
  }
  for (const side of [e.left, e.right]) {
    for (const item of side) {
      if (!substanceByFormula(item.formula)) {
        fail(e.id + " の化学式が物質データにない: " + item.formula);
      }
      if (item.coeff < 1 || item.coeff > 6 || item.coeff !== Math.floor(item.coeff)) {
        fail(e.id + " の係数が 1〜6 の整数でない: " + item.coeff);
      }
    }
  }
}

// 同じ辺に同じ化学式が2回出ていないか
// （組み立てモードは化学式から正解の係数を引くため、重複すると判定できない）
for (const e of EQUATIONS) {
  for (const [label, side] of [["左辺", e.left], ["右辺", e.right]]) {
    const seenF = new Set();
    for (const item of side) {
      if (seenF.has(item.formula)) {
        fail(e.id + " の" + label + "に同じ化学式が2回出ている: " + item.formula);
      }
      seenF.add(item.formula);
    }
  }
}

// 説明文に生成物の名前が書かれているかの検査
// 組み立てモードでは、生徒が説明文の物質名を手掛かりにカードを探すため、
// 生成物が書かれていない／名前が SUBSTANCES とずれていると問題が解けなくなる。
//
// 「銅」は「酸化銅」の、「水」は「水素」の一部でもあるため、説明文全体を対象に
// すると素通りしてしまう。そこで「〜と、」で前半（反応物・操作）と後半（生成物）に
// 分け、後半だけを検査する。この分割ができること自体が書式の検査にもなる。
function nameVariants(name) {
  // 「塩化水素（塩酸）」→ 括弧の前後どちらの表記でも可とする
  const out = [name];
  const m = name.match(/^(.+?)（(.+?)）$/);
  if (m) {
    out.push(m[1]);
    out.push(m[2]);
  }
  return out;
}

for (const e of EQUATIONS) {
  const at = e.desc.indexOf("と、");
  if (at < 0) {
    fail(
      e.id +
        " の説明文が「〈反応物〉を〈操作〉すると、〈生成物〉ができる」の書式でない: " +
        e.desc
    );
    continue;
  }
  const productPart = e.desc.slice(at + 2);
  const checked = new Set();
  for (const item of e.right) {
    if (checked.has(item.formula)) continue;
    checked.add(item.formula);
    const sub = substanceByFormula(item.formula);
    if (!sub) continue; // 物質データ未登録は上のチェックで報告済み
    const mentioned = nameVariants(sub.name).some(
      (v) => productPart.indexOf(v) >= 0
    );
    if (!mentioned) {
      fail(
        e.id + " の説明文に生成物「" + sub.name + "」が書かれていない: " + e.desc
      );
    }
  }
}

// プール数の確認（タイムアタックの出題数を満たすか）
const basicSub = quizSubstances(1).length;
const chalSub = quizSubstances(2).length;
const basicEq = equationsByLevel(1).length;
const chalEq = equationsByLevel(2).length;
const jd = judgeEquations().length;
const bd = buildEquations().length;

console.log("物質: 基本 " + basicSub + " / チャレンジ " + chalSub);
console.log("反応式: 基本 " + basicEq + " / チャレンジ " + chalEq);
console.log("○×ジャッジ対象: " + jd + " / 組み立て対象: " + bd);

if (basicSub < 20) fail("化学式マッチ（基本）の物質が 20 未満");
if (chalSub < 20) fail("化学式マッチ（チャレンジ）の物質が 20 未満");
if (basicEq < 10) fail("係数バランス（基本）の反応式が 10 未満");
if (chalEq < 10) fail("係数バランス（チャレンジ）の反応式が 10 未満");
if (jd < 20) fail("○×ジャッジの反応式が 20 未満");
if (bd < 5) fail("組み立ての反応式が 5 未満");

// 係数バランス（基本）は1カ所を空欄にする。
// 印字済みの係数が必ず1つは残るよう、係数スロットが2つ以上必要
for (const e of equationsByLevel(1)) {
  const slots = e.left.length + e.right.length;
  if (slots < 2) {
    fail(
      e.id + " は係数スロットが " + slots + " 個しかなく、" +
        "係数バランス（基本）で手がかりが残らない"
    );
  }
}

// 出題される答えの偏りを見る（「2 を連打すれば通る」状態になっていないか）
const valueTally = {};
for (const e of equationsByLevel(1)) {
  for (const t of e.left.concat(e.right)) {
    valueTally[t.coeff] = (valueTally[t.coeff] || 0) + 1;
  }
}
console.log(
  "係数バランス（基本）の係数の内訳: " +
    Object.keys(valueTally)
      .sort()
      .map((k) => k + "が" + valueTally[k])
      .join(" / ")
);

/* ---- 無限ラボ（自動生成）の検査 ---- */

/* 目算法で解けるか。「ある元素について係数未定の物質が1つだけ」なら確定できる、
   を繰り返して全部決まるかを見る。詰まる反応は未定係数法が必要＝中学生には無理 */
function inspectable(e) {
  const species = e.left.concat(e.right);
  const sign = species.map((_, i) => (i < e.left.length ? 1 : -1));
  const atoms = species.map((t) => parseFormula(t.formula));
  const elements = [...new Set(atoms.flatMap((a) => Object.keys(a)))];
  for (let start = 0; start < species.length; start++) {
    const c = species.map(() => null);
    c[start] = species[start].coeff;
    let progress = true;
    while (progress) {
      progress = false;
      for (const el of elements) {
        const idx = [];
        for (let i = 0; i < species.length; i++) if (atoms[i][el]) idx.push(i);
        const unknown = idx.filter((i) => c[i] === null);
        if (unknown.length !== 1) continue;
        const u = unknown[0];
        let sum = 0;
        for (const i of idx) if (i !== u) sum += atoms[i][el] * sign[i] * c[i];
        c[u] = -sum / (atoms[u][el] * sign[u]);
        progress = true;
      }
    }
    if (c.every((v) => v !== null)) return true;
  }
  return false;
}

const gen = generated();
const genIds = new Set();
const genKeys = new Set();
for (const e of gen) {
  if (genIds.has(e.id)) fail("生成した反応式の id が重複: " + e.id);
  genIds.add(e.id);
  const res = checkBalance(e, e.left.map((t) => t.coeff), e.right.map((t) => t.coeff));
  const show =
    e.left.map((t) => t.coeff + t.formula).join(" + ") +
    " → " +
    e.right.map((t) => t.coeff + t.formula).join(" + ");
  if (!res.balanced) fail("生成した反応式がつり合わない: " + e.id + " " + show);
  if (!res.simplest) fail("生成した反応式が最簡整数比でない: " + e.id + " " + show);
  if (!inspectable(e)) {
    fail("目算法で解けない反応式（未定係数法が必要）: " + e.id + " " + show);
  }
  for (const t of e.left.concat(e.right)) {
    try {
      parseFormula(t.formula);
    } catch (err) {
      fail("生成した化学式がパースできない: " + t.formula + " (" + e.id + ")");
    }
  }
  // 同じ辺に同じ物質が2回出ていないか
  for (const side of [e.left, e.right]) {
    const fs = side.map((t) => t.formula);
    if (new Set(fs).size !== fs.length) fail("同じ辺に同じ物質: " + e.id);
  }
  const key =
    e.left.map((t) => t.formula).sort().join("+") +
    ">" +
    e.right.map((t) => t.formula).sort().join("+");
  if (genKeys.has(key)) fail("生成した反応式が重複: " + e.id + " " + show);
  genKeys.add(key);
}
const byLayer = {};
const byKind = {};
for (const e of gen) {
  byLayer[e.layer] = (byLayer[e.layer] || 0) + 1;
  byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  // 価数で決まる反応は、係数が大きくても手は動かないので深い層に置かない
  if (e.kind === "valence" && e.layer > 2) {
    fail("価数で決まる反応が深い層にある: " + e.id + " (層" + e.layer + ")");
  }
  if (e.kind !== "valence" && e.kind !== "count") fail("kind が不正: " + e.id);
}
console.log(
  "無限ラボの自動生成: " +
    gen.length +
    " 式（層ごと " +
    Object.keys(byLayer).sort().map((k) => k + "→" + byLayer[k]).join(" / ") +
    " ／ 価数で決まる系 " + byKind.valence +
    "・数えて求める系 " + byKind.count + "）"
);
for (const lv of [1, 2, 3, 4]) {
  if (!byLayer[lv] || byLayer[lv] < 8) fail("無限ラボ 第" + lv + "層の反応式が少なすぎる");
}
// 深い層でどんな反応が出るかを確認できるようにしておく
const deep = {};
for (let i = 0; i < 4000; i++) {
  const e = pick(6);
  deep[e.kind] = (deep[e.kind] || 0) + 1;
}
const countRate = Math.round((deep.count / 4000) * 100);
console.log("  第5層以降の出題: 数えて求める系 " + countRate + "% / 価数で決まる系 " + (100 - countRate) + "%");
if (countRate < 60) fail("第5層以降で、数えて求める系が少なすぎる");
if (countRate > 95) fail("第5層以降が難しい反応ばかりになっている");

if (errors > 0) {
  console.error("\n" + errors + " 件のエラー");
  process.exit(1);
} else {
  console.log("\nすべて OK（" + EQUATIONS.length + " 反応式 / " + SUBSTANCES.length + " 物質）");
}
