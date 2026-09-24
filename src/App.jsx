import React, { useEffect, useRef, useState } from "react";
import {
  parseFormula,
  countAtoms,
  checkBalance,
  elementsInEquation,
} from "./chem.js";
import {
  EQUATIONS,
  substanceName,
  equationsByLevel,
  judgeEquations,
  buildEquations,
  quizSubstances,
} from "./data.js";
import { pickEquation } from "./generator.js";

/**
 * 化学反応式マスター（中2理科「化学変化」）
 *
 * 古い iPadOS/Safari では Optional Chaining (?.) / Nullish Coalescing (??)
 * がモジュール読み込み時のエラーになるため、このファイルでは使わない。
 * （element-quiz と同じ方針）
 */

/* ================= 汎用ユーティリティ ================= */

function isNil(v) {
  return v === null || v === undefined;
}

function coalesce(v, fallback) {
  return isNil(v) ? fallback : v;
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function sampleN(array, n) {
  return shuffle(array).slice(0, n);
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function formatSeconds(sec) {
  const rounded = Math.round(sec * 10) / 10;
  return rounded.toFixed(1);
}

function posKey(side, idx) {
  return side + String(idx);
}

/* ================= モード定義 ================= */

const MODES = {
  FORMULA_BASIC: "formula_basic",
  FORMULA_CHALLENGE: "formula_challenge",
  COEFF_BASIC: "coeff_basic",
  COEFF_CHALLENGE: "coeff_challenge",
  JUDGE: "judge",
  BUILD: "build",
  LAB: "lab",
};

const MODE_CONFIG = {};

/* グレード基準タイム（秒）
   正解演出中はタイマーが止まるため、純粋な解答時間で評価される

   maxMiss: これを超える誤答をした回は記録を残さない（でたらめなタップで
   ベスト記録や裏モード解放を取られるのを防ぐ）。当てずっぽうで突破できる
   モードほど厳しくしている：
   ・化学式マッチ … 誤答した選択肢が消えるので当てずっぽうでも必ず正解できる。
     4択ランダムだと20問で平均30ミスになるため 12 で確実に弾ける
   ・○×ジャッジ … 2択でランダムだと平均10ミス。＋5秒ペナルティと併せて 7
   ・係数バランス基本 … 中学範囲の係数は 1 と 2 でほぼ占められており（基本17式
     で 1が36・2が16・3と4が各1）、空欄1カ所だと答えが実質2択になる。
     数字を連打するだけで通ってしまわないよう 10問中3ミスまでに絞る。
     pickBlankSlots で答えを散らしてあるため、いちばん有利な連打でも
     平均6.3ミスになり、この値でほぼ確実に弾ける（緩めると効かなくなる：
     4 で 15%、5 で 33% が通ってしまう）
   ・係数バランス チャレンジ／組み立てラボ … 係数が全部1の反応式が
     42式中16式（組み立て対象は22式中11式）あるため、「全部1」を入れて
     判定するだけで4〜5割は当たってしまう。この探りを弾ける値にする

   maxSkip: 「わからない」でスキップできる回数の上限。誤答とは別枠にして、
   正直にスキップした回が誤答扱いで記録から外れないようにしている

   skipPenalty: 「わからない」でスキップしたときに加算される秒数。
   S ランクの1問あたりの持ち時間のおよそ1.5倍にしてあり、
   「解くよりスキップのほうが速い」状態にはならないようにしている

   recordVersion: 出題内容を変えて過去のベスト記録と比べられなくなったときに
   上げる。保存キーが変わり、そのモードの記録だけがリセットされる */
MODE_CONFIG[MODES.FORMULA_BASIC] = {
  title: "化学式マッチ（基本）",
  shortLabel: "化学式・き",
  questions: 20,
  maxMiss: 12,
  maxSkip: 6,
  skipPenalty: 6,
  grades: { ss: 35, s: 65, a: 100, b: 145 },
  masterTitle: "化学式マスター!!",
};
MODE_CONFIG[MODES.FORMULA_CHALLENGE] = {
  title: "化学式マッチ（チャレンジ）",
  shortLabel: "化学式・チ",
  questions: 20,
  maxMiss: 12,
  maxSkip: 6,
  skipPenalty: 6,
  grades: { ss: 35, s: 65, a: 100, b: 145 },
  masterTitle: "化学式マスター!!",
};
MODE_CONFIG[MODES.COEFF_BASIC] = {
  title: "係数バランス（基本）",
  shortLabel: "係数・き",
  questions: 10,
  maxMiss: 3,
  maxSkip: 3,
  skipPenalty: 12,
  grades: { ss: 50, s: 85, a: 135, b: 200 },
  // 出題の偏りを直したので、旧仕様（「2」が半分以上を占めていた頃）の
  // 記録とは比べられない。このモードのベスト記録だけリセットする
  recordVersion: 2,
  masterTitle: "バランスマスター!!",
};
MODE_CONFIG[MODES.COEFF_CHALLENGE] = {
  title: "係数バランス（チャレンジ）",
  shortLabel: "係数・チ",
  questions: 10,
  maxMiss: 5,
  maxSkip: 3,
  skipPenalty: 20,
  grades: { ss: 90, s: 150, a: 240, b: 350 },
  masterTitle: "バランスマスター!!",
};
MODE_CONFIG[MODES.JUDGE] = {
  title: "○×ジャッジ",
  shortLabel: "○×",
  questions: 20,
  maxMiss: 7,
  maxSkip: 6,
  skipPenalty: 5,
  grades: { ss: 28, s: 42, a: 65, b: 95 },
  masterTitle: "ジャッジマスター!!",
};
/* 無限ラボだけは「タイムの短さ」ではなく「到達問題数の多さ」を competition する。
   scoreKind: "count" を付けたモードは、記録の良し悪しの向きが逆になる。

   持ち時間は60秒から始まり、1問正解するごとに層に応じた秒数が加算される。
   加算は「その層で普通に考えて解くのにかかる時間」より少し長くしてあり、
   正確でありさえすればゆっくり考えても詰まない（瞬発力ゲームにしない）。
   層が上がると加算が思考時間を下回っていくので、いつかは必ず時間切れになる */
MODE_CONFIG[MODES.LAB] = {
  title: "無限ラボ",
  shortLabel: "∞ラボ",
  scoreKind: "count",
  questionsPerLayer: 5,
  startMs: 60000,
  wrongPenaltyMs: 10000,
  nearMissPenaltyMs: 3000,
  skipPenaltyMs: 15000,
  // 到達問題数のグレード基準（多いほど良い）。
  // 1問10〜15秒で解く想定での見積もりなので、実際の到達数を見て調整する
  grades: { ss: 35, s: 26, a: 18, b: 10 },
  // 持ち時間の上限を層ごとに下げる仕様に変えたため、それ以前の記録
  // （上限が一定で無限に伸ばせた頃のもの）とは比べられない。
  // 保存キーを分けて、このモードの記録だけリセットする
  recordVersion: 2,
  masterTitle: "ラボマスター!!",
};

MODE_CONFIG[MODES.BUILD] = {
  title: "組み立てラボ",
  shortLabel: "組み立て",
  questions: 5,
  maxMiss: 3,
  maxSkip: 2,
  skipPenalty: 45,
  grades: { ss: 110, s: 185, a: 280, b: 400 },
  masterTitle: "反応式マスター!!",
};

/* 裏モードの解放条件：
   STEP1・STEP2 の全4モードで S ランク以上（ベスト記録が S 基準タイム以内） */
const BASE_MODES = [
  MODES.FORMULA_BASIC,
  MODES.FORMULA_CHALLENGE,
  MODES.COEFF_BASIC,
  MODES.COEFF_CHALLENGE,
];
const SECRET_MODES = [MODES.JUDGE, MODES.BUILD];
/* 真の裏モード（無限ラボ）の解放条件：STEP3・STEP4 の両方で S ランク以上 */
const DEEP_SECRET_MODES = [MODES.LAB];

/** 記録の良し悪しが「大きいほど良い」モードか */
function isCountMode(mode) {
  return MODE_CONFIG[mode].scoreKind === "count";
}

/** 記録の値。タイムのモードは秒、無限ラボは到達問題数 */
function recordValueOf(rec) {
  if (!rec) return null;
  if (typeof rec.score === "number" && isFinite(rec.score)) return rec.score;
  if (typeof rec.sec === "number" && isFinite(rec.sec)) return rec.sec;
  return null;
}

/** value のほうが prev より良い記録か（prev が null なら常に良い） */
function isBetterRecord(mode, value, prev) {
  if (prev === null || prev === undefined) return true;
  return isCountMode(mode) ? value > prev : value < prev;
}

function hasSGradeForMode(bestByMode, mode) {
  const v = recordValueOf(bestByMode && bestByMode[mode]);
  if (v === null) return false;
  const s = MODE_CONFIG[mode].grades.s;
  return isCountMode(mode) ? v >= s : v <= s;
}

function isSecretUnlocked(bestByMode) {
  for (let i = 0; i < BASE_MODES.length; i++) {
    if (!hasSGradeForMode(bestByMode, BASE_MODES[i])) return false;
  }
  return true;
}

/** 真の裏モードの解放条件：裏モードが解放済みで、STEP3・STEP4 が S ランク */
function isDeepSecretUnlocked(bestByMode) {
  if (!isSecretUnlocked(bestByMode)) return false;
  for (let i = 0; i < SECRET_MODES.length; i++) {
    if (!hasSGradeForMode(bestByMode, SECRET_MODES[i])) return false;
  }
  return true;
}

function gradeFor(mode, sec) {
  const g = MODE_CONFIG[mode].grades;
  if (isCountMode(mode)) {
    // 到達問題数は多いほど良いので、判定の向きが逆になる
    if (sec >= g.ss) {
      return {
        grade: "SS",
        title: "ラボレジェンド!!!",
        comment: "この深さは伝説級。原子の数が見えている者だけが到達できる領域です。",
      };
    }
    if (sec >= g.s) {
      return {
        grade: "S",
        title: MODE_CONFIG[mode].masterTitle,
        comment: "未知の反応式でも落ち着いて数えられている証拠です。",
      };
    }
    if (sec >= g.a) {
      return { grade: "A", title: "すばらしい！", comment: "深いところまで到達。Sランクはもう目の前です。" };
    }
    if (sec >= g.b) {
      return { grade: "B", title: "順調！", comment: "焦らず1問ずつ。正確に解けば持ち時間は増えていきます。" };
    }
    return { grade: "C", title: "これから伸びる", comment: "まずは炭素・水素・酸素の順に数える手順を固めよう。" };
  }
  if (sec < g.ss) {
    return {
      grade: "SS",
      title: "反応式レジェンド!!!",
      comment:
        "この速さは伝説級！原子の数が見えている者だけが到達できる領域です。",
    };
  }
  if (sec <= g.s) {
    return {
      grade: "S",
      title: MODE_CONFIG[mode].masterTitle,
      comment: "速さも正確さも申し分なし。マスターの称号を授けます。",
    };
  }
  if (sec <= g.a) {
    return {
      grade: "A",
      title: "すばらしい！",
      comment: "とても良いペース！Sランクはもう目の前です。",
    };
  }
  if (sec <= g.b) {
    return {
      grade: "B",
      title: "順調！",
      comment: "間違えた問題を復習すると、タイムは大きく縮みます。",
    };
  }
  return {
    grade: "C",
    title: "これから伸びる",
    comment: "焦らず1問ずつ。復習モードで確実にレベルアップを。",
  };
}

/* ================= ベスト記録（端末に保存） ================= */

function bestStorageKey(mode) {
  // 出題内容を変えたモードは recordVersion を上げてキーを分ける。
  // 難度が変わった前後のタイムを同じベスト記録として扱わないため
  const cfg = MODE_CONFIG[mode];
  const ver = cfg && cfg.recordVersion ? cfg.recordVersion : 1;
  const suffix = ver > 1 ? "_r" + String(ver) : "";
  return "chemeq_best_v1_" + String(mode) + suffix;
}

function readBestRecord(mode) {
  try {
    if (typeof window === "undefined") return null;
    const ls = window.localStorage;
    if (!ls) return null;
    const raw = ls.getItem(bestStorageKey(mode));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj) return null;
    const at = typeof obj.at === "number" ? obj.at : null;
    if (typeof obj.score === "number" && isFinite(obj.score)) {
      return { score: obj.score, at: at };
    }
    if (typeof obj.sec === "number" && isFinite(obj.sec)) {
      return { sec: obj.sec, at: at };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function writeBestRecord(mode, value) {
  try {
    if (typeof window === "undefined") return;
    const ls = window.localStorage;
    if (!ls) return;
    const body = isCountMode(mode)
      ? { score: value, at: Date.now() }
      : { sec: value, at: Date.now() };
    ls.setItem(bestStorageKey(mode), JSON.stringify(body));
  } catch (e) {
    // ignore
  }
}

/* ================= 効果音（WebAudio・設定は端末に保存） ================= */

var SOUND = { on: false };
var audioCtxHolder = { ctx: null };

/** 効果音は基本 OFF（静かに取り組む授業を想定）。ON にした設定だけ保存される */
function readSoundPref() {
  try {
    if (typeof window === "undefined") return false;
    const ls = window.localStorage;
    if (!ls) return false;
    return ls.getItem("chemeq_sound_v1") === "on";
  } catch (e) {
    return false;
  }
}

function writeSoundPref(on) {
  try {
    if (typeof window === "undefined") return;
    const ls = window.localStorage;
    if (!ls) return;
    ls.setItem("chemeq_sound_v1", on ? "on" : "off");
  } catch (e) {
    // ignore
  }
}

function ensureAudioCtx() {
  if (audioCtxHolder.ctx) return audioCtxHolder.ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtxHolder.ctx = new AC();
  } catch (e) {
    audioCtxHolder.ctx = null;
  }
  return audioCtxHolder.ctx;
}

/** iOS は ユーザー操作の中で resume しないと音が出ない */
function resumeAudio() {
  if (!SOUND.on) return;
  const ctx = ensureAudioCtx();
  if (ctx && ctx.state === "suspended" && typeof ctx.resume === "function") {
    try {
      ctx.resume();
    } catch (e) {
      // ignore
    }
  }
}

function beep(freq, durMs, delayMs, type, vol) {
  if (!SOUND.on) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + (delayMs || 0) / 1000;
    const dur = durMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    const v = typeof vol === "number" ? vol : 0.1;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(v, t0 + 0.012);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (e) {
    // ignore
  }
}

function playCorrect() {
  beep(880, 90, 0);
  beep(1318.5, 150, 85);
}
function playWrong() {
  beep(165, 160, 0, "square", 0.055);
}
function playInfo() {
  beep(330, 120, 0, "sine", 0.08);
}
function playTick() {
  beep(660, 70, 0, "sine", 0.09);
}
function playStart() {
  beep(880, 200, 0);
}
function playFinish() {
  beep(659.3, 110, 0);
  beep(880, 110, 120);
  beep(1318.5, 260, 240);
}
function playUnlock(baseDelayMs) {
  const d = baseDelayMs || 0;
  beep(784, 100, d);
  beep(987.8, 100, d + 110);
  beep(1174.7, 100, d + 220);
  beep(1568, 320, d + 330);
}

/* ================= 化学式の表示 ================= */

function formulaSegments(formula) {
  const segs = [];
  let cur = "";
  let curSub = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula.charAt(i);
    const isDigit = ch >= "0" && ch <= "9";
    if (isDigit !== curSub && cur !== "") {
      segs.push({ t: cur, sub: curSub });
      cur = "";
    }
    curSub = isDigit;
    cur += ch;
  }
  if (cur !== "") segs.push({ t: cur, sub: curSub });
  return segs;
}

function FormulaText(props) {
  const segs = formulaSegments(props.formula);
  return (
    <span className={coalesce(props.className, "")} style={{ whiteSpace: "nowrap" }}>
      {segs.map(function (s, i) {
        if (s.sub) {
          return (
            <sub key={i} className="chem">
              {s.t}
            </sub>
          );
        }
        return <span key={i}>{s.t}</span>;
      })}
    </span>
  );
}

/**
 * 完成した反応式の表示（係数 1 は省略する正式な書き方）
 * leftCoeffs / rightCoeffs を渡すとその係数で表示する
 */
function EquationStatic(props) {
  const eq = props.eq;
  const leftCoeffs = props.leftCoeffs;
  const rightCoeffs = props.rightCoeffs;
  const size = coalesce(props.size, "text-xl sm:text-2xl");

  function renderSide(side, coeffs, keyPrefix) {
    const nodes = [];
    for (let i = 0; i < side.length; i++) {
      if (i > 0) {
        nodes.push(
          <span key={keyPrefix + "p" + i} className="mx-1.5 text-white/60">
            ＋
          </span>
        );
      }
      const c = coeffs ? coeffs[i] : side[i].coeff;
      if (c > 1) {
        nodes.push(
          <span key={keyPrefix + "c" + i} className="mr-0.5 font-extrabold text-amber-300">
            {c}
          </span>
        );
      }
      nodes.push(
        <FormulaText key={keyPrefix + "f" + i} formula={side[i].formula} className="font-extrabold" />
      );
    }
    return nodes;
  }

  return (
    <span
      className={
        "inline-flex flex-wrap items-baseline justify-center leading-relaxed " + size
      }
    >
      {renderSide(eq.left, leftCoeffs, "L")}
      <span className="mx-2 font-bold text-sky-300">→</span>
      {renderSide(eq.right, rightCoeffs, "R")}
    </span>
  );
}

/* ================= 原子カウント（ヒント）パネル ================= */

function AtomHintPanel(props) {
  const eq = props.eq;
  const leftCoeffs = props.leftCoeffs; // null 要素は 0 として数える
  const rightCoeffs = props.rightCoeffs;

  function toNums(coeffs, side) {
    const out = [];
    for (let i = 0; i < side.length; i++) {
      const v = coeffs ? coeffs[i] : side[i].coeff;
      out.push(typeof v === "number" ? v : 0);
    }
    return out;
  }

  const la = countAtoms(eq.left, toNums(leftCoeffs, eq.left));
  const ra = countAtoms(eq.right, toNums(rightCoeffs, eq.right));
  const els = elementsInEquation(eq);

  return (
    <div className="mx-auto mt-4 w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-3 animate-fadein">
      <div className="mb-2 text-center text-[11px] font-bold text-white/60">
        原子数チェック（左辺 : 右辺）
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {els.map(function (el) {
          const l = coalesce(la[el], 0);
          const r = coalesce(ra[el], 0);
          const ok = l === r && l > 0;
          return (
            <div
              key={el}
              className={
                "flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-sm font-bold " +
                (ok
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                  : "border-rose-400/40 bg-rose-500/15 text-rose-200")
              }
            >
              <span>{el}</span>
              <span className="text-xs font-bold opacity-90">
                {l} : {r}
              </span>
              <span>{ok ? "○" : "×"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================= 問題の生成 ================= */

const ELEMENTS_CACHE = {};
function elementsOf(formula) {
  if (!ELEMENTS_CACHE[formula]) {
    const atoms = parseFormula(formula);
    const list = [];
    for (const el in atoms) {
      if (Object.prototype.hasOwnProperty.call(atoms, el)) list.push(el);
    }
    ELEMENTS_CACHE[formula] = list;
  }
  return ELEMENTS_CACHE[formula];
}

function sharedElementCount(fa, fb) {
  const ea = elementsOf(fa);
  const eb = elementsOf(fb);
  let count = 0;
  for (let i = 0; i < ea.length; i++) {
    if (eb.indexOf(ea[i]) >= 0) count++;
  }
  return count;
}

function pickDistractors(answer, pool, n) {
  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    if (s.f === answer.f) continue;
    const score = sharedElementCount(answer.f, s.f) * 2 + Math.random() * 2.5;
    scored.push({ s: s, score: score });
  }
  scored.sort(function (x, y) {
    return y.score - x.score;
  });
  const out = [];
  for (let i = 0; i < scored.length && out.length < n; i++) {
    out.push(scored[i].s);
  }
  return out;
}

function makeFormulaQuestions(level) {
  const pool = quizSubstances(level);
  const subs = sampleN(pool, 20);
  return subs.map(function (sub) {
    const dir = Math.random() < 0.5 ? "n2f" : "f2n";
    const options = shuffle([sub].concat(pickDistractors(sub, pool, 3)));
    return { kind: "formula", sub: sub, dir: dir, options: options };
  });
}

/** 反応式の係数スロット一覧 */
function coeffSlots(eq) {
  const slots = [];
  for (let i = 0; i < eq.left.length; i++) {
    slots.push({ side: "L", idx: i, coeff: eq.left[i].coeff });
  }
  for (let i = 0; i < eq.right.length; i++) {
    slots.push({ side: "R", idx: i, coeff: eq.right[i].coeff });
  }
  return slots;
}

/**
 * 空欄にするスロットを選ぶ（係数バランス・基本）
 *
 * 以前は「係数2以上の場所を優先」していたが、中学範囲の係数は 1 と 2 で
 * ほぼ占められているため、答えが「2」に偏り（52.9%）、数字の 2 を連打する
 * だけで半分以上正解できてしまっていた。
 * ここでは1セット（10問）の中で答えの数字が散らばるように、
 * まだ出ていない値を優先して選ぶ。これで「2」の的中率は 35% まで下がり、
 * めったに出なかった 3・4 も 1割ほど混ざるようになる。
 * want は空欄の数。印字済みの係数が必ず1つは残るようにして、
 * 手がかりゼロにはしない。
 */
function pickBlankSlots(eq, want, valueUse) {
  const rest = coeffSlots(eq);
  const take = Math.max(1, Math.min(want, rest.length - 1));
  const chosen = [];
  for (let n = 0; n < take; n++) {
    // スロット単位で選ぶと、係数1のスロットが多い式が多いぶん答えが1に偏る。
    // まず「値」の種類の中からいちばん出ていないものを選び、
    // そのあとで該当スロットを引く
    const values = [];
    for (let i = 0; i < rest.length; i++) {
      if (values.indexOf(rest[i].coeff) < 0) values.push(rest[i].coeff);
    }
    const order = shuffle(values); // 同数のときはランダムに
    let pick = order[0];
    for (let i = 1; i < order.length; i++) {
      if (coalesce(valueUse[order[i]], 0) < coalesce(valueUse[pick], 0)) {
        pick = order[i];
      }
    }
    const cand = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].coeff === pick) cand.push(i);
    }
    const slot = rest.splice(cand[randInt(0, cand.length - 1)], 1)[0];
    valueUse[pick] = coalesce(valueUse[pick], 0) + 1;
    chosen.push(slot);
  }
  return chosen;
}

/**
 * 係数バランスの出題
 * - 基本（level 1）: 空欄は1カ所だけ。残りの係数は印字済み（中2の式から出題）
 * - チャレンジ（level 2）: すべての係数を入力（全反応式から出題）
 * givenL / givenR: 印字済みの係数（null の場所が空欄）
 */
function makeCoeffQuestions(level) {
  const pool = level === 1 ? equationsByLevel(1) : EQUATIONS;
  const valueUse = {};
  return sampleN(pool, 10).map(function (eq) {
    let givenL;
    let givenR;
    if (level === 1) {
      const blanks = pickBlankSlots(eq, 1, valueUse);
      const isBlank = function (side, idx) {
        for (let i = 0; i < blanks.length; i++) {
          if (blanks[i].side === side && blanks[i].idx === idx) return true;
        }
        return false;
      };
      givenL = eq.left.map(function (t, i) {
        return isBlank("L", i) ? null : t.coeff;
      });
      givenR = eq.right.map(function (t, i) {
        return isBlank("R", i) ? null : t.coeff;
      });
    } else {
      givenL = eq.left.map(function () {
        return null;
      });
      givenR = eq.right.map(function () {
        return null;
      });
    }
    return { kind: "coeff", eq: eq, givenL: givenL, givenR: givenR };
  });
}

function coeffsOf(side) {
  const out = [];
  for (let i = 0; i < side.length; i++) out.push(side[i].coeff);
  return out;
}

function makeJudgeQuestion(eq, wantWrong) {
  const lc = coeffsOf(eq.left);
  const rc = coeffsOf(eq.right);
  if (!wantWrong) {
    return { kind: "judge", eq: eq, shownLeft: lc, shownRight: rc, correct: true };
  }
  // 係数を 1〜2 か所だけ変えて、必ずつり合わない式を作る
  for (let attempt = 0; attempt < 60; attempt++) {
    const wl = lc.slice();
    const wr = rc.slice();
    const changes = Math.random() < 0.3 ? 2 : 1;
    for (let c = 0; c < changes; c++) {
      const total = wl.length + wr.length;
      const pos = randInt(0, total - 1);
      const arr = pos < wl.length ? wl : wr;
      const idx = pos < wl.length ? pos : pos - wl.length;
      const orig = arr[idx];
      let next = orig;
      if (Math.random() < 0.6) {
        next = orig + (Math.random() < 0.5 ? -1 : 1);
        if (next < 1) next = orig + 1;
        if (next > 6) next = orig - 1;
      } else {
        while (next === orig) next = randInt(1, 4);
      }
      arr[idx] = next;
    }
    const res = checkBalance(eq, wl, wr);
    if (!res.balanced) {
      return { kind: "judge", eq: eq, shownLeft: wl, shownRight: wr, correct: false };
    }
  }
  // 保険（通常は到達しない）：左辺先頭の係数を +1
  const wl2 = lc.slice();
  wl2[0] = wl2[0] + 1;
  return { kind: "judge", eq: eq, shownLeft: wl2, shownRight: rc, correct: false };
}

function makeJudgeQuestions() {
  const pool = judgeEquations();
  const eqs = sampleN(pool, 20);
  const flags = [];
  for (let i = 0; i < eqs.length; i++) flags.push(i % 2 === 0);
  const shuffledFlags = shuffle(flags);
  return eqs.map(function (eq, i) {
    return makeJudgeQuestion(eq, shuffledFlags[i]);
  });
}

function uniqueFormulasOf(eq) {
  const list = [];
  function collect(side) {
    for (let i = 0; i < side.length; i++) {
      if (list.indexOf(side[i].formula) < 0) list.push(side[i].formula);
    }
  }
  collect(eq.left);
  collect(eq.right);
  return list;
}

function makeBuildCards(eq) {
  const correct = uniqueFormulasOf(eq);
  const eqEls = elementsInEquation(eq);
  const wanted = Math.max(0, 8 - correct.length);
  const scored = [];
  const all = quizSubstances(1).concat(quizSubstances(2));
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    if (correct.indexOf(s.f) >= 0) continue;
    let shared = 0;
    const els = elementsOf(s.f);
    for (let k = 0; k < els.length; k++) {
      if (eqEls.indexOf(els[k]) >= 0) shared++;
    }
    if (shared === 0) continue;
    scored.push({ f: s.f, score: shared * 2 + Math.random() * 3 });
  }
  scored.sort(function (x, y) {
    return y.score - x.score;
  });
  const distractors = [];
  for (let i = 0; i < scored.length && distractors.length < wanted; i++) {
    distractors.push(scored[i].f);
  }
  return shuffle(correct.concat(distractors));
}

function makeBuildQuestions() {
  const pool = buildEquations();
  return sampleN(pool, 5).map(function (eq) {
    return { kind: "build", eq: eq, cards: makeBuildCards(eq) };
  });
}

/** 係数スロットを扱う問題か（係数バランスと無限ラボで処理を共有する） */
function isCoeffKind(q) {
  return !!q && (q.kind === "coeff" || q.kind === "lab");
}

/** 無限ラボの出題を1問つくる。層が上がるほど難しい反応式が出る */
function makeLabQuestion(layer) {
  const eq = pickEquation(layer);
  const givenL = eq.left.map(function () {
    return null;
  });
  const givenR = eq.right.map(function () {
    return null;
  });
  return { kind: "lab", eq: eq, layer: layer, givenL: givenL, givenR: givenR };
}

/**
 * 無限ラボで1問正解したときに増える持ち時間（ミリ秒）
 *
 * 加算は「層」ではなく「その反応式の重さ」で決める。
 * 4FeS2 + 11O2 → 2Fe2O3 + 8SO2 と SnO2 + C → Sn + CO2 では
 * かかる時間がまるで違うので、層でひとくくりにすると
 * 重い式を引いたときだけ理不尽に苦しくなってしまう。
 *
 * 重さの目安は「係数の余剰」＝係数の合計−物質数。
 * 1 以外の係数をどれだけ書くことになるかで、解答時間によく比例する。
 * 想定解答時間をおよそ 8秒＋0.6秒×余剰 とみて、その1.25倍を返す。
 *
 * 層が上がると倍率が下がっていき、いつかは必ず時間切れになる。
 * ここと LAB_MAX_BANK_MS を触れば、全体の長さを調整できる。
 */
function labBonusMs(layer, excess, clearedAfter) {
  const weight = typeof excess === "number" && isFinite(excess) ? excess : 0;
  const base = Math.min(36000, 12000 + 750 * weight);
  const factor = layer <= 4 ? 1 : Math.max(0.35, 1 - 0.13 * (layer - 4));
  // 表示と実際がずれないよう、秒単位に丸めておく。
  // 深い層では上限のほうが小さくなるので、そこで頭打ちにする
  // （上限2秒の層で「＋5秒」と出ると嘘になる）
  const ms = Math.round((base * factor) / 1000) * 1000;
  return Math.min(ms, labMaxBankMs(clearedAfter));
}

/* 持ち時間の上限（ミリ秒）。
 *
 * 上限がないと、早く解ける生徒ほど貯金が増え続けて、加算が減っても終わらない。
 * 加算の倍率には下限（0.35）があるので、それより速く解ける生徒——1問を数秒で
 * 片付ける生徒——は文字通り無限に続けられてしまっていた（1000問以上の記録が出た）。
 *
 * 50問までは80秒のまま。ここに届く生徒はほとんどいないので体感の変化はない。
 * そこから1問ごとに 7% ずつ絞っていく。
 *
 * 層ごと（5問ごと）に段差で下げると、上限が「速い生徒の解答時間の幅」
 * （だいたい1〜13秒）を数層で通り抜けてしまい、上位の差が数問しかつかない。
 * 1問ごとに連続で絞ると、同じ幅を25問ほどかけて通過するので差が開く。
 *
 * 絞り始めると上限がそのまま「1問に使える時間」になる。
 * 1問7秒の生徒は75問、3秒なら89問、1.5秒なら100問あたりで手が止まる。
 *
 * 100問で上限が0になるため、どれだけ速くても100問で必ず詰む。
 * 速さに依存しない天井で、LAB_MAX_QUESTIONS を変えれば動かせる。 */
const LAB_BANK_START_MS = 80000;
const LAB_SQUEEZE_FROM = 50; // ここから絞り始める（クリア問題数）
const LAB_SQUEEZE_RATE = 0.93; // 1問ごとの減衰率
const LAB_MAX_QUESTIONS = 100;

/** cleared 問クリアした時点での持ち時間の上限 */
function labMaxBankMs(cleared) {
  const n = typeof cleared === "number" && isFinite(cleared) ? cleared : 0;
  if (n < LAB_SQUEEZE_FROM) return LAB_BANK_START_MS;
  if (n >= LAB_MAX_QUESTIONS) return 0;
  return Math.round(
    LAB_BANK_START_MS * Math.pow(LAB_SQUEEZE_RATE, n - LAB_SQUEEZE_FROM)
  );
}

function buildQuestionsForMode(mode) {
  // 無限ラボは1問ずつ生成して終わりがないので、最初の1問だけ作る
  if (mode === MODES.LAB) return [makeLabQuestion(1)];
  if (mode === MODES.FORMULA_BASIC) return makeFormulaQuestions(1);
  if (mode === MODES.FORMULA_CHALLENGE) return makeFormulaQuestions(2);
  if (mode === MODES.COEFF_BASIC) return makeCoeffQuestions(1);
  if (mode === MODES.COEFF_CHALLENGE) return makeCoeffQuestions(2);
  if (mode === MODES.JUDGE) return makeJudgeQuestions();
  return makeBuildQuestions();
}

/* ================= セルフテスト ================= */

function runSelfTests() {
  try {
    console.assert(
      JSON.stringify(parseFormula("Ca(OH)2")) === JSON.stringify({ Ca: 1, O: 2, H: 2 }),
      "parseFormula Ca(OH)2"
    );
    for (let i = 0; i < EQUATIONS.length; i++) {
      const res = checkBalance(EQUATIONS[i]);
      console.assert(
        res.balanced && res.simplest,
        "equation balanced: " + EQUATIONS[i].id
      );
    }
    for (let i = 0; i < 30; i++) {
      const eq = EQUATIONS[randInt(0, EQUATIONS.length - 1)];
      const q = makeJudgeQuestion(eq, true);
      const res = checkBalance(eq, q.shownLeft, q.shownRight);
      console.assert(!res.balanced, "judge wrong version is unbalanced");
    }
    // モードを足したときの書き忘れを拾う
    for (const key in MODES) {
      if (!Object.prototype.hasOwnProperty.call(MODES, key)) continue;
      const m = MODES[key];
      console.assert(!!MODE_CONFIG[m], "MODE_CONFIG に " + m + " がない");
      console.assert(
        !!MODE_CONFIG[m] && !!MODE_CONFIG[m].grades,
        "grades がない: " + m
      );
      // 保存キーがモードごとに違うこと（コピペでかぶらせない）
      for (const key2 in MODES) {
        if (!Object.prototype.hasOwnProperty.call(MODES, key2)) continue;
        if (MODES[key2] === m) continue;
        console.assert(
          bestStorageKey(MODES[key2]) !== bestStorageKey(m),
          "保存キーが重複: " + m
        );
      }
    }
  } catch (e) {
    // テスト失敗でもアプリは止めない
    console.log("selftest error", e);
  }
}

/* ================= 小さな UI 部品 ================= */

function ActionButton(props) {
  const variant = coalesce(props.variant, "primary");
  const compact = !!props.compact;
  const base =
    "w-full rounded-2xl px-4 font-bold shadow-sm transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 " +
    (compact ? "py-3 text-sm" : "py-4 text-base");
  if (variant === "primary") {
    return (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        className={
          base +
          " " +
          (props.disabled
            ? "bg-white/10 text-white/35"
            : "bg-white text-slate-950 hover:bg-white/95")
        }
      >
        {props.children}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={
        base +
        " border border-white/10 bg-white/5 text-white/85 hover:bg-white/10 " +
        (props.disabled ? "opacity-50" : "")
      }
    >
      {props.children}
    </button>
  );
}

function Chip(props) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/70">
      {props.children}
    </span>
  );
}

function Overlay(props) {
  const kind = props.kind; // correct | wrong | info
  const styles = {
    correct: "bg-emerald-500/15 border-emerald-400/30",
    wrong: "bg-rose-500/15 border-rose-400/30",
    info: "bg-amber-500/15 border-amber-400/30",
  };
  const accent = {
    correct: "text-emerald-200",
    wrong: "text-rose-200",
    info: "text-amber-200",
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6 animate-fadein"
      role="status"
      aria-live="polite"
    >
      <div
        className={
          "w-full max-w-md rounded-3xl border backdrop-blur-md animate-popin " +
          styles[kind]
        }
      >
        <div className="px-6 py-7 text-center">
          <div className={"text-4xl font-extrabold tracking-tight " + accent[kind]}>
            {props.title}
          </div>
          {props.sub ? (
            <div className="mt-2 text-sm font-bold text-white/75">{props.sub}</div>
          ) : null}
          {props.children ? <div className="mt-3">{props.children}</div> : null}
          <div className="mt-4 text-[10px] font-bold text-white/40">
            ⏸ タイマー停止中
          </div>
        </div>
      </div>
    </div>
  );
}

function HelpModal(props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-5 animate-fadein"
      role="dialog"
      aria-modal="true"
      aria-label="遊び方"
      onClick={props.onClose}
    >
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      <div
        className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/85 p-5 shadow-xl backdrop-blur-xl animate-popin"
        onClick={function (e) {
          e.stopPropagation();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white/70">遊び方</div>
            <div className="text-lg font-bold tracking-tight text-white">
              化学反応式マスター
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="min-h-[44px] rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-bold text-white/80 hover:bg-white/10"
          >
            閉じる
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm text-white/80">
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-3">
            <div className="font-bold text-cyan-200">STEP1 化学式マッチ</div>
            <div className="mt-1">
              物質名と化学式を対応づける。正しい選択肢をタップ。
            </div>
          </div>
          <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-3">
            <div className="font-bold text-violet-200">STEP2 係数バランス</div>
            <div className="mt-1">
              ▢に数字を入れて左右の原子数をそろえる。
              <span className="font-bold">基本は空欄1カ所</span>
              （他の係数は印字済み）で、入力した時点で判定される。
              チャレンジは全係数を入力し、「判定する」で答え合わせ。
              入力をやり直すときは「クリア」で全欄を一度に消せる。
              係数は<span className="font-bold">最も簡単な整数比</span>で、
              通常は書かない「1」もこのゲームでは入力する。
            </div>
          </div>
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3">
            <div className="font-bold text-amber-200">STEP3 ○×ジャッジ</div>
            <div className="mt-1">
              反応式がつり合っていれば○、誤りなら×を瞬時に判定。
              ミスは＋5秒のペナルティ。
            </div>
          </div>
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3">
            <div className="font-bold text-rose-200">STEP4 組み立てラボ</div>
            <div className="mt-1">
              説明文に出てくる物質を、まずカードで左辺と右辺に
              <span className="font-bold">すべて並べる</span>。
              そろうと係数欄が使えるようになるので、そこで係数を決める。
              化学反応式を書くときの手順そのままの流れ。
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3">
            <div className="font-bold text-emerald-200">FINAL 無限ラボ</div>
            <div className="mt-1">
              教科書にない反応式（燃焼・還元・焙焼・工業的製法など）も出てくる、
              <span className="font-bold">終わりのないサバイバル</span>。
              持ち時間60秒から始まり、1問正解するごとに時間が増える
              （層が上がるほど増える時間は短くなる）。誤答は−10秒、
              スキップは−15秒。時間が尽きるまでに何問クリアできるかを競う。
              <span className="font-bold">
                50問を超えると持ち時間の上限が1問ごとに下がっていき、
                やがて上限そのものが1問の持ち時間になる。
              </span>
              どれだけ速くても100問で限界。
              係数が2桁になる問題もあるので、テンキーは数字を続けて押せば
              10以上も入力できる。係数欄の移動は
              <span className="font-bold">「次へ ▶」</span>でもできる。
            </div>
          </div>
          <ul className="space-y-1 pl-1 text-xs text-white/65">
            <li>・スタート後 3・2・1 のカウントダウンでタイムアタック開始。</li>
            <li>
              ・ミスしても続行できるが、その分タイムを消費する。係数の誤答の
              あとは少しのあいだ数字キーが止まるので、原子数チェックを見て
              から入れ直そう。
            </li>
            <li>
              ・わからないときは画面いちばん下の「わからない」で答えを見て
              スキップできる（2度押しで確定。タイムにペナルティが加算され、
              ミスとして復習リストに入る）。
            </li>
            <li>・結果画面の「復習」で、間違えた問題だけやり直せる。</li>
            <li>
              ・ベスト記録はこの端末に保存される。ただし誤答やスキップが
              多すぎる回は記録されない（あてずっぽう対策）。
            </li>
            <li>・連続正解でコンボ🔥が伸びる。ノーミスを狙おう。</li>
            <li>・正解表示中はタイマーが停止。落ち着いて式を確認できる。</li>
            <li>・効果音はホーム右上のボタンで ON にできる（初期設定は OFF）。</li>
            <li className="font-bold text-emerald-200/90">
              ・無限ラボは真の裏モード。STEP3・STEP4 でもSランクをとると
              解放される。
            </li>
            <li className="font-bold text-amber-200/90">
              ・STEP3・STEP4 は裏モード。STEP1・STEP2 の全4モードで
              Sランク以上をとると解放される（それまではカードが
              モノクロで、タップしても始まらない）。
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ================= ホーム画面のモードカード ================= */

const ACCENT_STYLES = {
  cyan: {
    card: "border-cyan-400/25 bg-gradient-to-br from-cyan-500/15 via-cyan-500/5 to-transparent",
    badge: "bg-cyan-400/20 text-cyan-100 border-cyan-300/30",
    btn: "border-cyan-300/25 bg-cyan-400/10",
    btnHover: " hover:bg-cyan-400/20",
  },
  violet: {
    card: "border-violet-400/25 bg-gradient-to-br from-violet-500/15 via-violet-500/5 to-transparent",
    badge: "bg-violet-400/20 text-violet-100 border-violet-300/30",
    btn: "border-violet-300/25 bg-violet-400/10",
    btnHover: " hover:bg-violet-400/20",
  },
  amber: {
    card: "border-amber-400/25 bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent",
    badge: "bg-amber-400/20 text-amber-100 border-amber-300/30",
    btn: "border-amber-300/25 bg-amber-400/10",
    btnHover: " hover:bg-amber-400/20",
  },
  rose: {
    card: "border-rose-400/25 bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent",
    badge: "bg-rose-400/20 text-rose-100 border-rose-300/30",
    btn: "border-rose-300/25 bg-rose-400/10",
    btnHover: " hover:bg-rose-400/20",
  },
  emerald: {
    card: "border-emerald-400/25 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent",
    badge: "bg-emerald-400/20 text-emerald-100 border-emerald-300/30",
    btn: "border-emerald-300/25 bg-emerald-400/10",
    btnHover: " hover:bg-emerald-400/20",
  },
};

function LogoMark() {
  // ファビコンと同じ「分子 → 分子」のマーク
  return (
    <svg
      viewBox="0 0 100 100"
      className="h-11 w-11 shrink-0 rounded-2xl shadow-lg shadow-sky-500/10 sm:h-12 sm:w-12"
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="24" fill="#0b1526" />
      <circle cx="26" cy="36" r="12" fill="#38bdf8" />
      <circle cx="42" cy="45" r="8" fill="#7dd3fc" />
      <circle cx="29" cy="55" r="8" fill="#7dd3fc" />
      <rect x="20" y="72" width="32" height="9" rx="4.5" fill="#e2e8f0" />
      <path d="M54 66 L54 87 L70 76.5 Z" fill="#e2e8f0" />
      <circle cx="76" cy="40" r="14" fill="#fbbf24" />
      <circle cx="62" cy="55" r="9" fill="#fcd34d" />
    </svg>
  );
}

function ModeCard(props) {
  const st = ACCENT_STYLES[props.accent];
  // h-full + flex-col でカードの高さをそろえ、ボタン行を下端に固定する。
  // locked（未開放の裏モード）はカード全体をモノクロにして、遊べないことを示す
  return (
    <div
      style={
        props.locked ? { filter: "grayscale(1)", opacity: 0.6 } : undefined
      }
      className={
        "relative flex h-full w-full flex-col rounded-3xl border p-5 shadow-lg shadow-black/20 " +
        st.card
      }
    >
      <div className="flex items-center gap-2">
        <span
          className={
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide " +
            st.badge
          }
        >
          {props.step}
        </span>
        <span className="text-lg font-extrabold tracking-tight text-white">
          {props.title}
        </span>
      </div>
      <div className="mt-2 flex-1 text-xs leading-relaxed text-white/60">
        {props.detail}
      </div>
      <div className="mt-4 flex gap-2">{props.children}</div>
    </div>
  );
}

function StartButton(props) {
  // ボタン自体にそのモードのベスト記録を表示する（記録とボタンの対応を直感的に）
  const st = props.accent ? ACCENT_STYLES[props.accent] : null;
  const tone = st ? st.btn : "border-white/15 bg-white/10";
  const toneHover = st ? st.btnHover : " hover:bg-white/15";
  const recValue = recordValueOf(props.best);
  const hasRec = recValue !== null;
  const countMode = props.mode ? isCountMode(props.mode) : false;
  let recNode = null;
  if (props.mode) {
    if (hasRec) {
      const g = gradeFor(props.mode, recValue).grade;
      const gColor =
        g === "SS"
          ? "text-amber-300 [text-shadow:0_0_8px_rgba(251,191,36,0.55)]"
          : g === "S"
            ? "text-emerald-300"
            : g === "A"
              ? "text-sky-300"
              : "text-white/80";
      recNode = (
        <span className="mt-1.5 flex items-center gap-1 text-[10px] font-bold leading-none text-white/55">
          <span>
            ベスト {countMode ? recValue + "問" : formatSeconds(recValue) + "s"}
          </span>
          <span className={"text-[13px] font-bold leading-none " + gColor}>{g}</span>
        </span>
      );
    } else {
      recNode = (
        <span className="mt-1.5 block text-[10px] font-bold leading-none text-white/35">
          {countMode ? "ベスト --問" : "ベスト --.-s"}
        </span>
      );
    }
  }
  const content = (
    <span className="flex flex-col items-center justify-center">
      <span>{props.children}</span>
      {recNode}
    </span>
  );
  // inert: 裏モードが未解放のあいだ、見た目はそのままでタップしても反応しない
  if (props.inert) {
    return (
      <button
        type="button"
        className={
          "flex-1 rounded-2xl border px-3 py-2.5 text-sm font-bold text-white " + tone
        }
      >
        {content}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={
        "flex-1 rounded-2xl border px-3 py-2.5 text-sm font-bold text-white transition active:scale-[0.99] " +
        tone +
        toneHover
      }
    >
      {content}
    </button>
  );
}

/* ================= 実行画面の部品 =================
 * この3つは必ずモジュールのトップレベルに置くこと。
 * App の内側で定義すると、レンダリングのたびに関数の同一性が変わり、
 * React が「別のコンポーネント」とみなして DOM を作り直してしまう。
 * タイマーで毎秒10回再描画されるため、作り直しも毎秒10回起き、
 * iPad（WebKit）では指を置いた要素が消えて click が発火しなくなる。
 */

function CoeffSlotButton(props) {
  const selected = props.selected;
  const value = props.value;
  // disabled: 組み立てモードで物質がそろうまで、係数欄を淡色にして触れなくする
  const disabled = !!props.disabled;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={disabled}
      className={
        "mr-0.5 inline-flex h-12 w-11 items-center justify-center rounded-xl border-2 align-middle text-xl font-bold transition " +
        (disabled
          ? "border-white/5 bg-transparent text-transparent"
          : selected
            ? "border-sky-400 bg-sky-400/25 text-white"
            : value === null
              ? "border-dashed border-white/30 bg-white/5 text-white/35"
              : "border-white/15 bg-white/10 text-amber-300")
      }
      style={
        selected && !disabled
          ? { boxShadow: "0 0 0 4px rgba(56,189,248,0.18)" }
          : undefined
      }
    >
      {/* 無効なあいだは中身を出さない（埋めるマスがひと目で分かるように）。
          幅は保ったままなので、有効化されてもレイアウトがずれない */}
      {disabled ? "" : value === null ? "?" : value}
    </button>
  );
}

function StageChip(props) {
  return (
    <span
      className={
        "rounded-full border px-3 py-1 text-[11px] font-bold transition " +
        (props.active
          ? "border-sky-300/40 bg-sky-400/15 text-sky-100"
          : "border-white/10 text-white/30")
      }
    >
      {props.children}
    </span>
  );
}

/** 経過時間の表示。ここだけが毎秒10回更新されるよう切り離してある
 *  （App 全体を再描画すると、その間の DOM 変更でタップが不安定になる） */
/** 無限ラボの残り時間。0 になったら onExpire を1度だけ呼ぶ */
function LabClock(props) {
  const read = props.read;
  const [ms, setMs] = useState(read());
  const firedRef = useRef(false);
  const cbRef = useRef(props.onExpire);
  cbRef.current = props.onExpire;
  useEffect(function () {
    const t = setInterval(function () {
      const v = read();
      setMs(v);
      if (v <= 0 && !firedRef.current) {
        firedRef.current = true;
        cbRef.current();
      }
    }, 100);
    return function () {
      clearInterval(t);
    };
  }, []);
  const sec = Math.max(0, ms) / 1000;
  const low = sec <= 10;
  return (
    <span className={low ? "text-rose-300" : undefined}>{formatSeconds(sec)}</span>
  );
}

function ElapsedTime(props) {
  const read = props.read;
  const [sec, setSec] = useState(read());
  useEffect(function () {
    const t = setInterval(function () {
      setSec(read());
    }, 100);
    return function () {
      clearInterval(t);
    };
    // read は ref だけを見る関数なので、張り替えなくても最新値が取れる
  }, []);
  return <>{formatSeconds(sec)}</>;
}

/* ================= メインアプリ ================= */


export default function App() {
  const [screen, setScreen] = useState("home"); // home | countdown | run | result
  const [mode, setMode] = useState(MODES.FORMULA_BASIC);
  const [phase, setPhase] = useState("main"); // main | review
  const [countdownStep, setCountdownStep] = useState(0);

  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const questionsRef = useRef([]);
  const qIndexRef = useRef(0);

  const startMsRef = useRef(null);
  const penaltyRef = useRef(0);
  const [penaltySec, setPenaltySec] = useState(0);

  // 正解演出（オーバーレイ）中はタイマーを止める
  const pauseStartRef = useRef(null);
  const totalPausedMsRef = useRef(0);

  const missedRef = useRef({});
  // finishRun は setTimeout の中から呼ばれるので、state だと最後の1問の
  // ミスが反映される前の値を掴んでしまう。判定用に ref でも持っておく
  const wrongTapsRef = useRef(0);
  const [wrongTaps, setWrongTaps] = useState(0);
  // スキップは誤答とは別に数える（正直にスキップした回を誤答扱いにしないため）
  const skipsRef = useRef(0);

  // 連続正解コンボ
  const streakRef = useRef(0);
  const maxStreakRef = useRef(0);
  const [streak, setStreak] = useState(0);

  const [soundOn, setSoundOn] = useState(function () {
    const v = readSoundPref();
    SOUND.on = v;
    return v;
  });

  const [overlay, setOverlay] = useState(null);
  const advanceTimerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const [toast, setToast] = useState(null);

  // 化学式マッチ用
  const [disabledOpts, setDisabledOpts] = useState({});
  const [optFlash, setOptFlash] = useState(null);

  // 係数バランス・組み立て用
  const [coeffL, setCoeffL] = useState([]);
  const [coeffR, setCoeffR] = useState([]);
  const [subL, setSubL] = useState([]);
  const [subR, setSubR] = useState([]);
  const [selPos, setSelPos] = useState({ side: "L", idx: 0 });
  const [hintOn, setHintOn] = useState(false);
  const [badPos, setBadPos] = useState({});
  // シェイク演出。key の変化で再マウントさせてアニメを再生し、
  // 終わったらクラスを外す（クラスが付きっぱなしだと、次回マウント時に
  // 誤答していないのに揺れてしまう）
  const [shakeKey, setShakeKey] = useState(0);
  const [shakeOn, setShakeOn] = useState(false);
  const shakeTimerRef = useRef(null);
  const [checkLock, setCheckLock] = useState(false);

  // 「わからない」ボタン。誤タップで大きなペナルティを取られないよう、
  // 1回目のタップでは確認状態にするだけにする（一定時間で自動解除）
  const [skipArmed, setSkipArmed] = useState(false);
  const skipTimerRef = useRef(null);

  // 誤答の直後に数字キーを少しのあいだ止める。
  // 連打での総当たりを成立させないためと、原子数チェックを目に入れさせるため
  const [inputLock, setInputLock] = useState(false);
  const inputLockTimerRef = useRef(null);

  // 無限ラボ：持ち時間の期限（絶対時刻）と、到達した問題数・層
  const labDeadlineRef = useRef(0);
  const clearedRef = useRef(0);
  const [cleared, setCleared] = useState(0);
  const [labBonus, setLabBonus] = useState(null);
  const bonusTimerRef = useRef(null);

  const [lastResult, setLastResult] = useState(null);
  const [bestByMode, setBestByMode] = useState({});
  const [showHelp, setShowHelp] = useState(false);

  /* ---------- 初期化 ---------- */

  useEffect(function () {
    runSelfTests();
    // モードの一覧は MODE_CONFIG から拾う。手書きの配列にすると、
    // モードを足したときに書き足し忘れて記録が読み込まれなくなる
    // （無限ラボの記録がリロードで消えていたのはこれが原因）
    const map = {};
    for (const key in MODE_CONFIG) {
      if (!Object.prototype.hasOwnProperty.call(MODE_CONFIG, key)) continue;
      const rec = readBestRecord(key);
      if (rec) map[key] = rec;
    }
    setBestByMode(map);
    return function () {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      if (inputLockTimerRef.current) clearTimeout(inputLockTimerRef.current);
      if (bonusTimerRef.current) clearTimeout(bonusTimerRef.current);
    };
  }, []);

  /* ---------- タイマー ---------- */

  function currentElapsedSec() {
    if (startMsRef.current === null) return 0;
    let pausedMs = totalPausedMsRef.current;
    if (pauseStartRef.current !== null) {
      pausedMs += Date.now() - pauseStartRef.current;
    }
    return (
      (Date.now() - startMsRef.current - pausedMs) / 1000 + penaltyRef.current
    );
  }

  function pauseTimer() {
    if (pauseStartRef.current === null) {
      pauseStartRef.current = Date.now();
    }
  }

  function resumeTimer() {
    if (pauseStartRef.current !== null) {
      const paused = Date.now() - pauseStartRef.current;
      totalPausedMsRef.current += paused;
      // 無限ラボは期限そのものを後ろへずらして、演出中の時間を消費させない
      if (labDeadlineRef.current) labDeadlineRef.current += paused;
      pauseStartRef.current = null;
    }
  }

  /** 無限ラボの残り時間（ミリ秒）。演出で止まっている間は減らない */
  function labRemainingMs() {
    if (!labDeadlineRef.current) return 0;
    const now = pauseStartRef.current !== null ? pauseStartRef.current : Date.now();
    return labDeadlineRef.current - now;
  }

  /** 持ち時間を増減する。ボーナスは画面にも短く出す */
  function addLabMs(ms, clearedAfter) {
    labDeadlineRef.current += ms;
    if (ms > 0) {
      // その時点の上限を超えないようにする
      const now = pauseStartRef.current !== null ? pauseStartRef.current : Date.now();
      const cap = now + labMaxBankMs(coalesce(clearedAfter, 0));
      if (labDeadlineRef.current > cap) labDeadlineRef.current = cap;
    }
    setLabBonus({ ms: ms, key: Date.now() });
    if (bonusTimerRef.current) clearTimeout(bonusTimerRef.current);
    bonusTimerRef.current = setTimeout(function () {
      setLabBonus(null);
      bonusTimerRef.current = null;
    }, 900);
  }

  /* ---------- カウントダウン ---------- */

  useEffect(
    function () {
      if (screen !== "countdown") return undefined;
      if (countdownStep < 3) {
        playTick();
        const t = setTimeout(function () {
          setCountdownStep(countdownStep + 1);
        }, 650);
        return function () {
          clearTimeout(t);
        };
      }
      playStart();
      const t2 = setTimeout(function () {
        startMsRef.current = Date.now();
        pauseStartRef.current = null;
        totalPausedMsRef.current = 0;
        if (mode === MODES.LAB) {
          labDeadlineRef.current = Date.now() + MODE_CONFIG[MODES.LAB].startMs;
        }
        setScreen("run");
      }, 500);
      return function () {
        clearTimeout(t2);
      };
    },
    [screen, countdownStep]
  );

  /* ---------- 実行制御 ---------- */

  /** 誤答時のシェイク演出を1回だけ再生する */
  function triggerShake() {
    setShakeKey(function (k) {
      return k + 1;
    });
    setShakeOn(true);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(function () {
      setShakeOn(false);
      shakeTimerRef.current = null;
    }, 400); // tailwind.config.js の shake（0.35s）より少し長く
  }

  function clearTransientTimers() {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    if (shakeTimerRef.current) {
      clearTimeout(shakeTimerRef.current);
      shakeTimerRef.current = null;
    }
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current);
      skipTimerRef.current = null;
    }
    if (inputLockTimerRef.current) {
      clearTimeout(inputLockTimerRef.current);
      inputLockTimerRef.current = null;
    }
    if (bonusTimerRef.current) {
      clearTimeout(bonusTimerRef.current);
      bonusTimerRef.current = null;
    }
  }

  function resetQuestionState(q) {
    setDisabledOpts({});
    setOptFlash(null);
    setHintOn(false);
    setBadPos({});
    setCheckLock(false);
    setSkipArmed(false);
    setInputLock(false);
    setOverlay(null);
    if (isCoeffKind(q)) {
      // 印字済みの係数はそのまま入り、空欄（null）だけ入力対象になる
      setCoeffL(q.givenL.slice());
      setCoeffR(q.givenR.slice());
      let sel = null;
      for (let i = 0; i < q.givenL.length; i++) {
        if (q.givenL[i] === null && !sel) sel = { side: "L", idx: i };
      }
      for (let i = 0; i < q.givenR.length; i++) {
        if (q.givenR[i] === null && !sel) sel = { side: "R", idx: i };
      }
      setSelPos(sel ? sel : { side: "L", idx: 0 });
    }
    if (q && q.kind === "build") {
      const l = [];
      const r = [];
      const sl = [];
      const sr = [];
      for (let i = 0; i < q.eq.left.length; i++) {
        l.push(null);
        sl.push(null);
      }
      for (let i = 0; i < q.eq.right.length; i++) {
        r.push(null);
        sr.push(null);
      }
      setCoeffL(l);
      setCoeffR(r);
      setSubL(sl);
      setSubR(sr);
      setSelPos({ side: "L", idx: 0 });
    }
  }

  function startRun(nextMode, nextPhase, qs) {
    clearTransientTimers();
    setMode(nextMode);
    setPhase(nextPhase);
    setQuestions(qs);
    questionsRef.current = qs;
    setQIndex(0);
    qIndexRef.current = 0;
    missedRef.current = {};
    penaltyRef.current = 0;
    setPenaltySec(0);
    wrongTapsRef.current = 0;
    setWrongTaps(0);
    skipsRef.current = 0;
    clearedRef.current = 0;
    setCleared(0);
    setLabBonus(null);
    labDeadlineRef.current = 0;
    streakRef.current = 0;
    maxStreakRef.current = 0;
    setStreak(0);
    setShakeKey(0);
    setShakeOn(false);
    setToast(null);
    resumeAudio();
    resetQuestionState(qs[0]);
    setCountdownStep(0);
    setScreen("countdown");
  }

  function startMode(nextMode) {
    // 裏モードは解放されるまで反応しない
    if (SECRET_MODES.indexOf(nextMode) >= 0 && !isSecretUnlocked(bestByMode)) {
      return;
    }
    if (
      DEEP_SECRET_MODES.indexOf(nextMode) >= 0 &&
      !isDeepSecretUnlocked(bestByMode)
    ) {
      return;
    }
    startRun(nextMode, "main", buildQuestionsForMode(nextMode));
  }

  function startReview() {
    if (!lastResult || !lastResult.missedQuestions.length) return;
    // 化学式マッチは選択肢の並びも変えて、位置おぼえを防ぐ
    const qs = lastResult.missedQuestions.map(function (q) {
      if (q.kind !== "formula") return q;
      return { kind: q.kind, sub: q.sub, dir: q.dir, options: shuffle(q.options) };
    });
    startRun(lastResult.mode, "review", shuffle(qs));
  }

  /** この問題を「間違えた問題」として記録し、コンボを切る */
  function markQuestionMissed() {
    missedRef.current[qIndexRef.current] = true;
    streakRef.current = 0;
    setStreak(0);
  }

  /** 誤答の記録 */
  function markMissed() {
    markQuestionMissed();
    wrongTapsRef.current += 1;
    setWrongTaps(wrongTapsRef.current);
    playWrong();
  }

  /** スキップの記録。復習リストには入るが、誤答の回数には数えない */
  function markSkipped() {
    markQuestionMissed();
    skipsRef.current += 1;
  }

  /** 誤答の直後だけ数字キーを止める（総当たり対策・ヒントを見せるため） */
  function lockInputBriefly() {
    setInputLock(true);
    if (inputLockTimerRef.current) clearTimeout(inputLockTimerRef.current);
    inputLockTimerRef.current = setTimeout(function () {
      setInputLock(false);
      inputLockTimerRef.current = null;
    }, 1200);
  }

  /** 1問解けた（正解イベント）。ノーミスの問題だけコンボが続く */
  function onSolved() {
    playCorrect();
    if (missedRef.current[qIndexRef.current]) {
      streakRef.current = 0;
      setStreak(0);
      return;
    }
    streakRef.current += 1;
    if (streakRef.current > maxStreakRef.current) {
      maxStreakRef.current = streakRef.current;
    }
    setStreak(streakRef.current);
  }

  function finishRun() {
    // 無限ラボは時間切れからも呼ばれるので、進行中のタイマーを止めておく
    clearTransientTimers();
    const isLab = mode === MODES.LAB;
    // 無限ラボの「記録」はタイムではなく到達問題数
    const sec = isLab ? clearedRef.current : currentElapsedSec();
    const qs = questionsRef.current;
    const missedQuestions = [];
    for (let i = 0; i < qs.length; i++) {
      if (missedRef.current[i]) missedQuestions.push(qs[i]);
    }
    // 誤答・スキップが多すぎる回は記録を残さない（でたらめなタップ対策）。
    // 誤答とスキップは上限を分けて数える
    const cfg = MODE_CONFIG[mode];
    const missCount = wrongTapsRef.current;
    const skipCount = skipsRef.current;
    // 無限ラボは誤答・スキップが持ち時間を直接削るので、回数の上限は設けない
    const tooManyMisses = !isLab && missCount > cfg.maxMiss;
    const tooManySkips = !isLab && skipCount > cfg.maxSkip;
    const noRecord = tooManyMisses || tooManySkips;
    let isNewBest = false;
    const prevUnlocked = isSecretUnlocked(bestByMode);
    let nowUnlocked = prevUnlocked;
    const prevDeepUnlocked = isDeepSecretUnlocked(bestByMode);
    let nowDeepUnlocked = prevDeepUnlocked;
    // 到達0問の回は記録として残さない（「ベスト更新」が出るのがおかしいため）
    const worthRecording = !isCountMode(mode) || sec > 0;
    if (phase === "main" && !noRecord && worthRecording) {
      // 画面の状態ではなく、保存されている記録と比べる。
      // 読み込み漏れなどで state が空でも、良い記録を上書きしない
      const stored = readBestRecord(mode);
      const prev = recordValueOf(stored);
      if (isBetterRecord(mode, sec, prev)) {
        isNewBest = true;
        writeBestRecord(mode, sec);
        const nextMap = {};
        for (const k in bestByMode) {
          if (Object.prototype.hasOwnProperty.call(bestByMode, k)) {
            nextMap[k] = bestByMode[k];
          }
        }
        nextMap[mode] = isCountMode(mode)
          ? { score: sec, at: Date.now() }
          : { sec: sec, at: Date.now() };
        setBestByMode(nextMap);
        nowUnlocked = isSecretUnlocked(nextMap);
        nowDeepUnlocked = isDeepSecretUnlocked(nextMap);
      }
    }
    const unlockedSecret = !prevUnlocked && nowUnlocked;
    const unlockedDeep = !prevDeepUnlocked && nowDeepUnlocked;
    setLastResult({
      mode: mode,
      phase: phase,
      sec: sec,
      missedQuestions: missedQuestions,
      isNewBest: isNewBest,
      reachedLimit: isLab && clearedRef.current >= LAB_MAX_QUESTIONS,
      unlockedSecret: unlockedSecret,
      unlockedDeep: unlockedDeep,
      cleared: clearedRef.current,
      maxStreak: maxStreakRef.current,
      wrongTaps: missCount,
      skips: skipCount,
      tooManyMisses: tooManyMisses,
      tooManySkips: tooManySkips,
    });
    playFinish();
    if (unlockedSecret || unlockedDeep) playUnlock(600);
    setOverlay(null);
    setScreen("result");
  }

  function goNext() {
    clearTransientTimers();
    resumeTimer();
    setOverlay(null);
    const next = qIndexRef.current + 1;
    if (mode === MODES.LAB) {
      // 終わりがないモード。時間切れになるまで next の問題を作り続ける
      if (labRemainingMs() <= 0) {
        finishRun();
        return;
      }
      const cfg = MODE_CONFIG[MODES.LAB];
      const layer = Math.floor(clearedRef.current / cfg.questionsPerLayer) + 1;
      // 50問を超えると持ち時間の上限が1問ごとに下がる。貯金があっても切り詰める
      const cap = labMaxBankMs(clearedRef.current);
      const now = Date.now();
      if (labDeadlineRef.current > now + cap) labDeadlineRef.current = now + cap;
      if (cap <= 0) {
        // 天井に到達＝ここで必ず終わり（100問クリア）
        finishRun();
        return;
      }
      if (clearedRef.current === LAB_SQUEEZE_FROM) {
        showToast("ここから持ち時間の上限が少しずつ下がる");
      }
      const q = makeLabQuestion(layer);
      const list = questionsRef.current.concat([q]);
      questionsRef.current = list;
      setQuestions(list);
      qIndexRef.current = next;
      setQIndex(next);
      resetQuestionState(q);
      return;
    }
    if (next >= questionsRef.current.length) {
      finishRun();
      return;
    }
    qIndexRef.current = next;
    setQIndex(next);
    resetQuestionState(questionsRef.current[next]);
  }

  function scheduleAdvance(ms) {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(goNext, ms);
  }

  function quitToHome() {
    clearTransientTimers();
    setToast(null);
    setOverlay(null);
    setScreen("home");
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    SOUND.on = next;
    writeSoundPref(next);
    if (next) {
      resumeAudio();
      playTick();
    }
  }

  function showToast(text) {
    setToast({ text: text, key: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(function () {
      setToast(null);
    }, 1600);
  }

  /* ---------- わからない（スキップ） ---------- */

  /** スキップしたときに見せる「答え」 */
  function skipAnswerNode(q) {
    if (q.kind === "formula") {
      return (
        <span className="inline-flex flex-wrap items-baseline justify-center gap-2">
          <span className="text-lg font-bold text-white/80">{q.sub.name}</span>
          <span className="text-white/40">＝</span>
          <FormulaText formula={q.sub.f} className="text-2xl font-extrabold" />
        </span>
      );
    }
    return <EquationStatic eq={q.eq} />;
  }

  function skipAnswerSub(q) {
    if (q.kind === "formula") {
      return q.dir === "n2f" ? "この物質の化学式" : "この化学式の物質名";
    }
    if (q.kind === "judge") {
      return q.correct ? "表示されていた式は正しかった" : "正しくは：";
    }
    if (q.kind === "lab") return q.eq.cat;
    return q.eq.desc;
  }

  function onSkip() {
    const q = questionsRef.current[qIndexRef.current];
    if (!q) return;
    if (overlay || checkLock) return;
    // 1回目のタップは「確認」。iPad で誤って触れてもペナルティにならない
    if (!skipArmed) {
      setSkipArmed(true);
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      skipTimerRef.current = setTimeout(function () {
        setSkipArmed(false);
        skipTimerRef.current = null;
      }, 3000);
      return;
    }
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current);
      skipTimerRef.current = null;
    }
    setSkipArmed(false);
    const isLab = mode === MODES.LAB;
    const penalty = isLab
      ? Math.round(MODE_CONFIG[MODES.LAB].skipPenaltyMs / 1000)
      : MODE_CONFIG[mode].skipPenalty;
    if (isLab) {
      addLabMs(-MODE_CONFIG[MODES.LAB].skipPenaltyMs);
    } else {
      penaltyRef.current += penalty;
      setPenaltySec(penaltyRef.current);
    }
    // 復習リストには入れるが、誤答の回数とは別枠で数える。
    // 自分から選んだ操作なので、ミスの効果音も鳴らさない
    markSkipped();
    playInfo();
    setCheckLock(true);
    pauseTimer();
    setOverlay({
      kind: "info",
      title: "スキップ（＋" + penalty + "秒）",
      sub: skipAnswerSub(q),
      node: skipAnswerNode(q),
    });
    scheduleAdvance(2000);
  }

  /* ---------- 化学式マッチ ---------- */

  function onTapFormulaOption(idx) {
    const q = questionsRef.current[qIndexRef.current];
    if (!q || q.kind !== "formula") return;
    if (overlay) return;
    if (optFlash && optFlash.kind === "correct") return; // 正解直後の連続タップを無視
    if (disabledOpts[idx]) return;
    const opt = q.options[idx];
    if (opt.f === q.sub.f) {
      onSolved();
      pauseTimer();
      setOptFlash({ idx: idx, kind: "correct" });
      // 他のモードと同じく「正解！」のカットインを出す。
      // 物質名と化学式を並べて、対応づけをその場で印象づける
      setOverlay({
        kind: "correct",
        title: "正解！",
        node: (
          <span className="inline-flex flex-wrap items-baseline justify-center gap-2">
            <span className="text-lg font-bold text-white/80">{q.sub.name}</span>
            <span className="text-white/40">＝</span>
            <FormulaText formula={q.sub.f} className="text-2xl font-extrabold" />
          </span>
        ),
      });
      scheduleAdvance(750);
    } else {
      markMissed();
      setOptFlash({ idx: idx, kind: "wrong" });
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(function () {
        setOptFlash(null);
      }, 350);
      // 直前の状態から積み上げる（連続タップで取りこぼさないように）
      setDisabledOpts(function (prev) {
        const next = {};
        for (const k in prev) {
          if (Object.prototype.hasOwnProperty.call(prev, k)) next[k] = true;
        }
        next[idx] = true;
        return next;
      });
    }
  }

  /* ---------- 係数バランス ---------- */

  function currentSlots(q) {
    // 係数スロットの一覧（選択の自動送りに使う）
    const list = [];
    for (let i = 0; i < q.eq.left.length; i++) list.push({ side: "L", idx: i });
    for (let i = 0; i < q.eq.right.length; i++) list.push({ side: "R", idx: i });
    return list;
  }

  function coeffValueAt(side, idx) {
    return side === "L" ? coeffL[idx] : coeffR[idx];
  }

  function setCoeffValue(side, idx, value) {
    if (side === "L") {
      setCoeffL(function (prev) {
        const next = prev.slice();
        next[idx] = value;
        return next;
      });
    } else {
      setCoeffR(function (prev) {
        const next = prev.slice();
        next[idx] = value;
        return next;
      });
    }
  }

  function advanceSelection(q, fromSide, fromIdx, filledSide, filledIdx, forCoeff) {
    // filledSide/filledIdx に今入力した。次の空きスロットを選ぶ
    const slots = currentSlots(q);
    let start = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].side === fromSide && slots[i].idx === fromIdx) {
        start = i;
        break;
      }
    }
    for (let step = 1; step <= slots.length; step++) {
      const s = slots[(start + step) % slots.length];
      let empty;
      if (q.kind === "build" && !forCoeff) {
        const arr = s.side === "L" ? subL : subR;
        empty = arr[s.idx] === null && !(s.side === filledSide && s.idx === filledIdx);
      } else {
        const arr = s.side === "L" ? coeffL : coeffR;
        empty = arr[s.idx] === null && !(s.side === filledSide && s.idx === filledIdx);
      }
      if (empty) {
        setSelPos({ side: s.side, idx: s.idx });
        return;
      }
    }
    // 空きがなければそのまま
    setSelPos({ side: fromSide, idx: fromIdx });
  }

  function isEditableCoeffSlot(q, side, idx) {
    if (!isCoeffKind(q)) return true;
    const given = side === "L" ? q.givenL : q.givenR;
    return given[idx] === null;
  }

  function onTapNumber(n) {
    const q = questionsRef.current[qIndexRef.current];
    if (!q || (!isCoeffKind(q) && q.kind !== "build")) return;
    if (overlay || checkLock || inputLock) return;
    // 組み立てモードは物質をすべて並べてから係数を入力する
    if (q.kind === "build" && !allSubsFilled(q)) return;
    if (!isEditableCoeffSlot(q, selPos.side, selPos.idx)) return;
    setCoeffValue(selPos.side, selPos.idx, n);

    // 空欄が1カ所だけのとき（係数バランス・基本）は、入力した時点で判定する。
    // setState は非同期なので、入力後の並びを自分で作って渡す
    if (q.kind === "coeff" && blankCountOf(q) === 1) {
      const nextL = coeffL.slice();
      const nextR = coeffR.slice();
      if (selPos.side === "L") nextL[selPos.idx] = n;
      else nextR[selPos.idx] = n;
      runCoeffCheck(q, nextL, nextR);
      return;
    }

    // 次の空き係数スロットへ
    const slots = currentSlots(q);
    let start = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].side === selPos.side && slots[i].idx === selPos.idx) {
        start = i;
        break;
      }
    }
    for (let step = 1; step <= slots.length; step++) {
      const s = slots[(start + step) % slots.length];
      const arr = s.side === "L" ? coeffL : coeffR;
      if (arr[s.idx] === null) {
        setSelPos({ side: s.side, idx: s.idx });
        return;
      }
    }
  }

  function allCoeffFilled(q) {
    for (let i = 0; i < q.eq.left.length; i++) {
      if (coeffL[i] === null || coeffL[i] === undefined) return false;
    }
    for (let i = 0; i < q.eq.right.length; i++) {
      if (coeffR[i] === null || coeffR[i] === undefined) return false;
    }
    return true;
  }

  /** 係数バランスの空欄数（基本は1、チャレンジは全スロット） */
  function blankCountOf(q) {
    if (!isCoeffKind(q)) return 0;
    let c = 0;
    for (let i = 0; i < q.givenL.length; i++) {
      if (q.givenL[i] === null) c++;
    }
    for (let i = 0; i < q.givenR.length; i++) {
      if (q.givenR[i] === null) c++;
    }
    return c;
  }

  /** 入力済みの係数が1つでもあるか（クリアボタンの有効判定） */
  function hasAnyCoeffInput(q) {
    if (!q) return false;
    if (isCoeffKind(q)) {
      for (let i = 0; i < q.givenL.length; i++) {
        if (q.givenL[i] === null && !isNil(coeffL[i])) return true;
      }
      for (let i = 0; i < q.givenR.length; i++) {
        if (q.givenR[i] === null && !isNil(coeffR[i])) return true;
      }
      return false;
    }
    for (let i = 0; i < coeffL.length; i++) {
      if (!isNil(coeffL[i])) return true;
    }
    for (let i = 0; i < coeffR.length; i++) {
      if (!isNil(coeffR[i])) return true;
    }
    return false;
  }

  /** 入力した係数を一括で取り消す（印字済みの係数と、配置した物質はそのまま） */
  function onClearCoeffs() {
    const q = questionsRef.current[qIndexRef.current];
    if (!q || (!isCoeffKind(q) && q.kind !== "build")) return;
    if (overlay || checkLock || inputLock) return;
    let sel = null;
    if (isCoeffKind(q)) {
      setCoeffL(q.givenL.slice());
      setCoeffR(q.givenR.slice());
      for (let i = 0; i < q.givenL.length && !sel; i++) {
        if (q.givenL[i] === null) sel = { side: "L", idx: i };
      }
      for (let i = 0; i < q.givenR.length && !sel; i++) {
        if (q.givenR[i] === null) sel = { side: "R", idx: i };
      }
    } else {
      setCoeffL(q.eq.left.map(function () { return null; }));
      setCoeffR(q.eq.right.map(function () { return null; }));
      sel = { side: "L", idx: 0 };
    }
    setSelPos(sel ? sel : { side: "L", idx: 0 });
    // 係数が空の状態では原子数パネルは意味をなさないので閉じる
    setHintOn(false);
  }

  /** 係数の正誤判定。入力途中の配列を渡せるよう、状態ではなく引数で受け取る */
  function runCoeffCheck(q, l, r) {
    const res = checkBalance(q.eq, l, r);
    if (res.balanced && res.simplest) {
      onSolved();
      pauseTimer();
      setCheckLock(true);
      setOverlay({
        kind: "correct",
        title: "正解！",
        sub: q.eq.desc,
        node: <EquationStatic eq={q.eq} leftCoeffs={l} rightCoeffs={r} />,
      });
      scheduleAdvance(1300);
    } else if (res.balanced && !res.simplest) {
      playInfo();
      showToast("つり合っているが、もっと簡単な整数比にできる");
      triggerShake();
    } else {
      markMissed();
      setHintOn(true);
      triggerShake();
      lockInputBriefly();
    }
  }

  function onCheckCoeff() {
    const q = questionsRef.current[qIndexRef.current];
    if (!isCoeffKind(q)) return;
    if (overlay || checkLock || inputLock) return;
    if (!allCoeffFilled(q)) return;
    if (q.kind === "lab") runLabCheck(q, coeffL, coeffR);
    else runCoeffCheck(q, coeffL, coeffR);
  }

  /* ---------- 無限ラボ ---------- */

  /** 無限ラボの正誤判定。正解で持ち時間が増え、誤答で減る */
  function runLabCheck(q, l, r) {
    const res = checkBalance(q.eq, l, r);
    const cfg = MODE_CONFIG[MODES.LAB];
    if (res.balanced && res.simplest) {
      onSolved();
      clearedRef.current += 1;
      setCleared(clearedRef.current);
      const bonus = labBonusMs(q.layer, q.eq.excess, clearedRef.current);
      addLabMs(bonus, clearedRef.current);
      pauseTimer();
      setCheckLock(true);
      setOverlay({
        kind: "correct",
        title: "正解！ ＋" + Math.round(bonus / 1000) + "秒",
        sub: q.eq.cat,
        node: <EquationStatic eq={q.eq} leftCoeffs={l} rightCoeffs={r} />,
      });
      scheduleAdvance(1300);
    } else if (res.balanced && !res.simplest) {
      // ミス扱いにはしないが、ここを無料にすると「全部2」で
      // 係数が全部1の式をただで見分けられてしまうので、少しだけ削る
      playInfo();
      addLabMs(-cfg.nearMissPenaltyMs);
      showToast("つり合っているが、もっと簡単な整数比にできる");
      triggerShake();
    } else {
      markMissed();
      addLabMs(-cfg.wrongPenaltyMs);
      setHintOn(true);
      triggerShake();
      lockInputBriefly();
    }
  }

  /** 無限ラボの数字入力。2桁まで積み上げる（係数が13や25になるため） */
  function onTapDigit(d) {
    const q = questionsRef.current[qIndexRef.current];
    if (!q || q.kind !== "lab") return;
    if (overlay || checkLock || inputLock) return;
    if (!isEditableCoeffSlot(q, selPos.side, selPos.idx)) return;
    const arr = selPos.side === "L" ? coeffL : coeffR;
    const cur = arr[selPos.idx];
    let next;
    if (isNil(cur) || cur >= 10) next = d; // 空か、すでに2桁なら入れ直し
    else next = cur * 10 + d;
    if (!next) return; // 先頭の 0 は受け付けない
    setCoeffValue(selPos.side, selPos.idx, next);
  }

  /** 次の係数欄へ移る（Tab のように使う。化学式をタップしなくてよい） */
  function onTapNextSlot() {
    const q = questionsRef.current[qIndexRef.current];
    if (!q) return;
    if (overlay || checkLock || inputLock) return;
    const slots = currentSlots(q);
    if (!slots.length) return;
    let at = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].side === selPos.side && slots[i].idx === selPos.idx) {
        at = i;
        break;
      }
    }
    // 印字済みの欄は飛ばす（無限ラボは全部空欄だが、念のため）
    for (let step = 1; step <= slots.length; step++) {
      const cand = slots[(at + step) % slots.length];
      if (isEditableCoeffSlot(q, cand.side, cand.idx)) {
        setSelPos({ side: cand.side, idx: cand.idx });
        return;
      }
    }
  }

  /** 無限ラボの1桁消し */
  function onTapBackspace() {
    const q = questionsRef.current[qIndexRef.current];
    if (!q || q.kind !== "lab") return;
    if (overlay || checkLock || inputLock) return;
    const arr = selPos.side === "L" ? coeffL : coeffR;
    const cur = arr[selPos.idx];
    if (isNil(cur)) return;
    const next = cur >= 10 ? Math.floor(cur / 10) : null;
    setCoeffValue(selPos.side, selPos.idx, next);
  }

  /* ---------- 組み立てラボ ---------- */

  function subValueAt(side, idx) {
    return side === "L" ? subL[idx] : subR[idx];
  }

  function setSubValue(side, idx, value) {
    if (side === "L") {
      setSubL(function (prev) {
        const next = prev.slice();
        next[idx] = value;
        return next;
      });
    } else {
      setSubR(function (prev) {
        const next = prev.slice();
        next[idx] = value;
        return next;
      });
    }
  }

  function usedCardFormulas() {
    const used = {};
    for (let i = 0; i < subL.length; i++) {
      if (subL[i]) used[subL[i]] = { side: "L", idx: i };
    }
    for (let i = 0; i < subR.length; i++) {
      if (subR[i]) used[subR[i]] = { side: "R", idx: i };
    }
    return used;
  }

  function onTapCard(formula) {
    const q = questionsRef.current[qIndexRef.current];
    if (!q || q.kind !== "build") return;
    if (overlay || checkLock) return;
    setBadPos({});
    const used = usedCardFormulas();
    if (used[formula]) {
      // 使用中カードをタップ → その場所から外して選び直せるようにする。
      // 物質が変わると係数の意味も変わるので、係数も空に戻す
      const pos = used[formula];
      setSubValue(pos.side, pos.idx, null);
      setCoeffValue(pos.side, pos.idx, null);
      setSelPos({ side: pos.side, idx: pos.idx });
      return;
    }
    // 選択中の位置に置く（置きかえも可）。すでに別の物質が入っていた枠を
    // 上書きする場合、前の物質に対して入れた係数は意味を失うので空に戻す
    const prevSub = selPos.side === "L" ? subL[selPos.idx] : subR[selPos.idx];
    if (prevSub && prevSub !== formula) {
      setCoeffValue(selPos.side, selPos.idx, null);
    }
    setSubValue(selPos.side, selPos.idx, formula);

    // setState は非同期なので、「置いた後」の並びを自分で作って段階を判定する
    const nextL = subL.slice();
    const nextR = subR.slice();
    if (selPos.side === "L") nextL[selPos.idx] = formula;
    else nextR[selPos.idx] = formula;

    if (subsComplete(q, nextL, nextR)) {
      // 物質がそろった → 係数の入力へ。左辺の先頭を選択状態にする
      setSelPos({ side: "L", idx: 0 });
    } else {
      advanceSelection(q, selPos.side, selPos.idx, selPos.side, selPos.idx, false);
    }
  }

  /** 指定した並びで物質がすべて埋まっているか（setState 前の値でも判定できる） */
  function subsComplete(q, l, r) {
    for (let i = 0; i < q.eq.left.length; i++) {
      if (!l[i]) return false;
    }
    for (let i = 0; i < q.eq.right.length; i++) {
      if (!r[i]) return false;
    }
    return true;
  }

  function allSubsFilled(q) {
    return subsComplete(q, subL, subR);
  }

  /**
   * 組み立てモードの段階。
   * 物質がそろうまでは "subs"（係数欄と数字キーは無効）、
   * そろったら "coeff"（係数を入力できる）。
   */
  function buildStage(q) {
    return allSubsFilled(q) ? "coeff" : "subs";
  }

  function buildChosenEq(q) {
    // ユーザーの並びで擬似反応式を作る（原子カウントパネル用）
    function side(subArr, srcSide) {
      const out = [];
      for (let i = 0; i < srcSide.length; i++) {
        out.push({ coeff: 1, formula: subArr[i] ? subArr[i] : "H" });
      }
      return out;
    }
    return {
      left: side(subL, q.eq.left),
      right: side(subR, q.eq.right),
    };
  }

  function onCheckBuild() {
    const q = questionsRef.current[qIndexRef.current];
    if (!q || q.kind !== "build") return;
    if (overlay || checkLock || inputLock) return;
    if (!allSubsFilled(q) || !allCoeffFilled(q)) return;

    // 1) 物質の組み合わせを判定（左右それぞれ、順序は不問）
    function sideCheck(chosen, expectedSide) {
      const remaining = [];
      for (let i = 0; i < expectedSide.length; i++) {
        remaining.push(expectedSide[i].formula);
      }
      const bad = [];
      for (let i = 0; i < chosen.length; i++) {
        const at = remaining.indexOf(chosen[i]);
        if (at >= 0) {
          remaining.splice(at, 1);
        } else {
          bad.push(i);
        }
      }
      return bad;
    }
    const badL = sideCheck(subL, q.eq.left);
    const badR = sideCheck(subR, q.eq.right);
    if (badL.length > 0 || badR.length > 0) {
      markMissed();
      const bp = {};
      for (let i = 0; i < badL.length; i++) bp[posKey("L", badL[i])] = true;
      for (let i = 0; i < badR.length; i++) bp[posKey("R", badR[i])] = true;
      setBadPos(bp);
      triggerShake();
      showToast("赤い枠の物質を確認しよう");
      return;
    }

    // 2) 係数を判定（各化学式に対応する正しい係数と比較）
    function expectedCoeffFor(expectedSide, formula) {
      for (let i = 0; i < expectedSide.length; i++) {
        if (expectedSide[i].formula === formula) return expectedSide[i].coeff;
      }
      return -1;
    }
    let ok = true;
    for (let i = 0; i < subL.length; i++) {
      if (coeffL[i] !== expectedCoeffFor(q.eq.left, subL[i])) ok = false;
    }
    for (let i = 0; i < subR.length; i++) {
      if (coeffR[i] !== expectedCoeffFor(q.eq.right, subR[i])) ok = false;
    }

    if (ok) {
      onSolved();
      pauseTimer();
      setCheckLock(true);
      setOverlay({
        kind: "correct",
        title: "正解！",
        sub: q.eq.desc,
        node: <EquationStatic eq={q.eq} />,
      });
      scheduleAdvance(1400);
    } else {
      // つり合ってはいるが最簡でないだけなら、係数バランスと同じく
      // ミス扱いにせず「もっと簡単な整数比に」と促すだけにする
      const chosen = buildChosenEq(q);
      const res = checkBalance(
        { left: chosen.left, right: chosen.right },
        coeffL,
        coeffR
      );
      if (res.balanced && !res.simplest) {
        playInfo();
        showToast("つり合っているが、もっと簡単な整数比にできる");
        triggerShake();
      } else {
        markMissed();
        setHintOn(true);
        triggerShake();
        lockInputBriefly();
      }
    }
  }

  /* ---------- ○×ジャッジ ---------- */

  function onJudge(saidCorrect) {
    const q = questionsRef.current[qIndexRef.current];
    if (!q || q.kind !== "judge") return;
    if (overlay || checkLock) return;
    setCheckLock(true);
    pauseTimer();
    const right = saidCorrect === q.correct;
    if (right) {
      onSolved();
      if (q.correct) {
        setOverlay({ kind: "correct", title: "正解！", sub: "つり合っている" });
        scheduleAdvance(650);
      } else {
        setOverlay({
          kind: "correct",
          title: "正解！",
          sub: "正しくは：",
          node: <EquationStatic eq={q.eq} />,
        });
        scheduleAdvance(1150);
      }
    } else {
      markMissed();
      penaltyRef.current += 5;
      setPenaltySec(penaltyRef.current);
      setOverlay({
        kind: "wrong",
        title: "不正解…（＋5秒）",
        sub: q.correct ? "これは正しい式" : "正しくは：",
        node: <EquationStatic eq={q.eq} />,
      });
      scheduleAdvance(1500);
    }
  }

  /* ================= 描画 ================= */

  const currentQ = questions[qIndex];

  function renderHeader() {
    const isLab = mode === MODES.LAB;
    const layer = isLab
      ? Math.floor(clearedRef.current / MODE_CONFIG[MODES.LAB].questionsPerLayer) + 1
      : 0;
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-white/55">
            {MODE_CONFIG[mode].title}
            {phase === "review" ? "（復習）" : ""}
            {isLab ? "　第" + layer + "層" : ""}
          </div>
          <div className="text-lg font-bold tabular-nums text-white">
            {isLab ? cleared : qIndex + 1}
            <span className="text-white/50">
              {isLab ? " 問クリア" : " / " + questions.length}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {streak >= 2 ? (
            <span className="rounded-full border border-orange-400/40 bg-orange-500/15 px-2.5 py-1 text-xs font-bold text-orange-200">
              🔥{streak}
            </span>
          ) : null}
          {penaltySec > 0 ? (
            <span className="rounded-full border border-rose-400/40 bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-200">
              ＋{penaltySec}s
            </span>
          ) : null}
          {labBonus ? (
            <span
              key={labBonus.key}
              className={
                "rounded-full border px-2.5 py-1 text-xs font-bold animate-popin " +
                (labBonus.ms > 0
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                  : "border-rose-400/40 bg-rose-500/15 text-rose-200")
              }
            >
              {(labBonus.ms > 0 ? "＋" : "−") + Math.abs(Math.round(labBonus.ms / 1000)) + "s"}
            </span>
          ) : null}
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-lg font-extrabold tabular-nums text-white">
            {isLab ? (
              <LabClock read={labRemainingMs} onExpire={finishRun} />
            ) : (
              <ElapsedTime read={currentElapsedSec} />
            )}
            <span className="ml-0.5 text-xs font-bold text-white/50">s</span>
            {/* 上限が下がっている層では、その値も見せておく。
                いきなり時計が減ると不具合に見えるため */}
            {isLab && labMaxBankMs(cleared) < LAB_BANK_START_MS ? (
              <div className="text-[10px] font-bold leading-none text-amber-200/80">
                上限 {formatSeconds(labMaxBankMs(cleared) / 1000)}s
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={quitToHome}
            className="min-h-[44px] rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-bold text-white/70 hover:bg-white/10"
          >
            中断
          </button>
        </div>
      </div>
    );
  }

  function renderProgressBar() {
    let pct;
    if (mode === MODES.LAB) {
      // 終わりがないモードなので、代わりに「その層の進み具合」を出す
      const per = MODE_CONFIG[MODES.LAB].questionsPerLayer;
      pct = Math.round(((cleared % per) / per) * 100);
    } else {
      pct = questions.length ? Math.round((qIndex / questions.length) * 100) : 0;
    }
    return (
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-sky-400/80 transition-all duration-300"
          style={{ width: String(pct) + "%" }}
        />
      </div>
    );
  }

  /* ----- 化学式マッチ画面 ----- */

  function renderFormulaRun(q) {
    const isN2F = q.dir === "n2f";
    return (
      <div className="mt-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-6 text-center">
          <div className="text-xs font-bold text-white/55">
            {isN2F ? "この物質の化学式は？" : "この化学式の物質名は？"}
          </div>
          {/* 物質名（日本語）と化学式（添字あり）で文字の高さが違うため、
              枠の高さを固定して中央ぞろえにする。問題が変わっても
              下の選択肢ボタンの位置がずれない */}
          <div className="mt-3 flex h-20 items-center justify-center sm:h-24">
            {isN2F ? (
              <span className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                {q.sub.name}
              </span>
            ) : (
              <FormulaText
                formula={q.sub.f}
                className="text-4xl font-extrabold tracking-tight sm:text-5xl"
              />
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {q.options.map(function (opt, idx) {
            const disabled = !!disabledOpts[idx];
            const flashKind =
              optFlash && optFlash.idx === idx ? optFlash.kind : null;
            const styleObj = {};
            if (flashKind === "correct") {
              styleObj.outline = "3px solid rgba(52,211,153,0.95)";
              styleObj.outlineOffset = "-3px";
              styleObj.boxShadow = "0 0 0 5px rgba(52,211,153,0.18)";
            }
            if (flashKind === "wrong") {
              styleObj.outline = "3px solid rgba(251,113,133,0.95)";
              styleObj.outlineOffset = "-3px";
              styleObj.boxShadow = "0 0 0 5px rgba(251,113,133,0.18)";
            }
            return (
              <button
                key={idx}
                type="button"
                disabled={disabled}
                onClick={function () {
                  onTapFormulaOption(idx);
                }}
                style={Object.keys(styleObj).length ? styleObj : undefined}
                className={
                  // 長い物質名が2行になっても高さが変わらないよう固定
                  "flex h-20 items-center justify-center rounded-2xl border px-3 py-2 text-center transition active:scale-[0.99] " +
                  (disabled
                    ? "border-white/10 bg-white/5 text-white/30"
                    : "border-white/10 bg-white/10 text-white hover:bg-white/15")
                }
              >
                {isN2F ? (
                  <FormulaText formula={opt.f} className="text-2xl font-bold" />
                ) : (
                  <span className="text-base font-bold leading-snug sm:text-lg">
                    {opt.name}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /* ----- 係数スロット ----- */

  function renderCoeffEquation(q) {
    function renderSide(side, sideKey) {
      const nodes = [];
      const given = sideKey === "L" ? q.givenL : q.givenR;
      for (let i = 0; i < side.length; i++) {
        if (i > 0) {
          nodes.push(
            <span key={sideKey + "p" + i} className="mx-1.5 text-white/60 text-2xl font-bold">
              ＋
            </span>
          );
        }
        const value = sideKey === "L" ? coeffL[i] : coeffR[i];
        const selected = selPos.side === sideKey && selPos.idx === i;
        const isGiven = given[i] !== null;
        nodes.push(
          <span
            key={sideKey + "t" + i}
            // 係数の枠は小さいので、化学式をタップしてもその枠を選べるようにする。
            // role="button" にすることで iOS でもダブルタップ拡大の待ちが入らない
            role={isGiven ? undefined : "button"}
            onClick={
              isGiven
                ? undefined
                : function () {
                    setSelPos({ side: sideKey, idx: i });
                  }
            }
            className={
              "inline-flex items-center whitespace-nowrap rounded-xl py-1 " +
              (isGiven ? "" : "cursor-pointer")
            }
          >
            {isGiven ? (
              // 印字済みの係数は正式な書き方（1 は書かない）で表示
              given[i] > 1 ? (
                <span className="mr-0.5 text-2xl font-extrabold text-white/85 sm:text-3xl">
                  {given[i]}
                </span>
              ) : null
            ) : (
              <CoeffSlotButton
                value={isNil(value) ? null : value}
                selected={selected}
                onClick={function () {
                  setSelPos({ side: sideKey, idx: i });
                }}
              />
            )}
            <FormulaText
              formula={side[i].formula}
              className="text-2xl font-extrabold sm:text-3xl"
            />
          </span>
        );
      }
      return nodes;
    }
    return (
      <div
        key={shakeKey}
        className={
          "flex flex-wrap items-center justify-center " +
          (shakeOn ? "animate-shake" : "")
        }
      >
        {renderSide(q.eq.left, "L")}
        <span className="mx-2 text-2xl font-bold text-sky-300 sm:mx-3">→</span>
        {renderSide(q.eq.right, "R")}
      </div>
    );
  }

  /**
   * 数字キー＋操作ボタン。
   * opts: { checkFn, checkEnabled, padEnabled, showCheck, onClear, clearEnabled }
   */
  /** 無限ラボ用のテンキー（2桁入力。係数が13や25になるため） */
  function renderLabPad(opts) {
    const enabled = opts.padEnabled !== false;
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
    const keyClass =
      "h-14 rounded-2xl border text-2xl font-bold transition " +
      (enabled
        ? "border-white/10 bg-white/10 text-white hover:bg-white/15 active:scale-[0.97]"
        : "border-white/5 bg-white/[0.03] text-white/20");
    return (
      <div className="mx-auto mt-5 w-full max-w-md">
        <div className="grid grid-cols-6 gap-2">
          {keys.map(function (n) {
            return (
              <button
                key={n}
                type="button"
                disabled={!enabled}
                onClick={function () {
                  onTapDigit(n);
                }}
                className={keyClass}
              >
                {n}
              </button>
            );
          })}
          <button
            type="button"
            disabled={!enabled}
            onClick={onTapBackspace}
            className={keyClass}
            aria-label="1文字消す"
          >
            ⌫
          </button>
          <button
            type="button"
            disabled={!enabled}
            onClick={onTapNextSlot}
            className={
              "h-14 rounded-2xl border text-sm font-bold transition " +
              (enabled
                ? "border-sky-300/30 bg-sky-400/15 text-sky-100 hover:bg-sky-400/25 active:scale-[0.97]"
                : "border-white/5 bg-white/[0.03] text-white/20")
            }
            aria-label="次の係数欄へ"
          >
            次へ ▶
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={opts.onClear}
            disabled={!opts.clearEnabled}
            className={
              "shrink-0 rounded-2xl border px-5 py-4 text-base font-bold transition active:scale-[0.99] " +
              (opts.clearEnabled
                ? "border-white/10 bg-white/5 text-white/85 hover:bg-white/10"
                : "border-white/5 bg-white/[0.03] text-white/25")
            }
          >
            クリア
          </button>
          <div className="flex-1">
            <ActionButton onClick={opts.checkFn} disabled={!opts.checkEnabled}>
              判定する
            </ActionButton>
          </div>
        </div>
      </div>
    );
  }

  function renderNumberPad(opts) {
    const nums = [1, 2, 3, 4, 5, 6];
    // padEnabled 省略時は有効（係数バランスは常に入力できる）
    const enabled = opts.padEnabled !== false;
    const showCheck = opts.showCheck !== false;
    return (
      <div className="mx-auto mt-5 w-full max-w-md">
        <div className="grid grid-cols-6 gap-2">
          {nums.map(function (n) {
            return (
              <button
                key={n}
                type="button"
                disabled={!enabled}
                onClick={function () {
                  onTapNumber(n);
                }}
                className={
                  "h-14 rounded-2xl border text-2xl font-bold transition " +
                  (enabled
                    ? "border-white/10 bg-white/10 text-white hover:bg-white/15 active:scale-[0.97]"
                    : "border-white/5 bg-white/[0.03] text-white/20")
                }
              >
                {n}
              </button>
            );
          })}
        </div>
        {showCheck || opts.onClear ? (
          <div className="mt-3 flex gap-2">
            {opts.onClear ? (
              <button
                type="button"
                onClick={opts.onClear}
                disabled={!opts.clearEnabled}
                className={
                  "shrink-0 rounded-2xl border px-5 py-4 text-base font-bold transition active:scale-[0.99] " +
                  (opts.clearEnabled
                    ? "border-white/10 bg-white/5 text-white/85 hover:bg-white/10"
                    : "border-white/5 bg-white/[0.03] text-white/25")
                }
              >
                クリア
              </button>
            ) : null}
            {showCheck ? (
              <div className="flex-1">
                <ActionButton onClick={opts.checkFn} disabled={!opts.checkEnabled}>
                  判定する
                </ActionButton>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCoeffRun(q) {
    let blankCount = 0;
    for (let i = 0; i < q.givenL.length; i++) {
      if (q.givenL[i] === null) blankCount++;
    }
    for (let i = 0; i < q.givenR.length; i++) {
      if (q.givenR[i] === null) blankCount++;
    }
    return (
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Chip>{q.eq.cat}</Chip>
          <div className="text-center text-sm font-bold text-white/70">
            {q.eq.desc}
          </div>
        </div>
        <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 px-4 py-8">
          {renderCoeffEquation(q)}
          {hintOn ? (
            <AtomHintPanel eq={q.eq} leftCoeffs={coeffL} rightCoeffs={coeffR} />
          ) : null}
        </div>
        <div
          className={
            "mt-2 text-center text-[11px] font-bold " +
            (inputLock ? "text-amber-200/80" : "text-white/45")
          }
        >
          {inputLock
            ? "左右の原子の数を確かめよう…"
            : blankCount === 1
            ? "▢に入る係数を入力すると、その場で判定される（1 が入るときも「1」）"
            : "マスを選んで数字をタップ（係数 1 も入力する）"}
        </div>
        {renderNumberPad({
          checkFn: onCheckCoeff,
          checkEnabled: allCoeffFilled(q) && !overlay && !checkLock && !inputLock,
          // 空欄が1カ所のときは入力した時点で判定するので、判定ボタンは出さない
          showCheck: blankCount !== 1,
          padEnabled: !inputLock,
          onClear: blankCount > 1 ? onClearCoeffs : null,
          clearEnabled:
            hasAnyCoeffInput(q) && !overlay && !checkLock && !inputLock,
        })}
      </div>
    );
  }

  /* ----- 無限ラボ画面 ----- */

  function renderLabRun(q) {
    return (
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Chip>{q.eq.cat}</Chip>
          <span className="text-xs font-bold text-white/45">第{q.layer}層</span>
          {/* 重い式ほど加算が大きいことを先に見せる。
              「これは時間をかけていい問題だ」と分かるように */}
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-200/90">
            正解で ＋
            {Math.round(labBonusMs(q.layer, q.eq.excess, cleared + 1) / 1000)}秒
          </span>
        </div>
        <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 px-4 py-8">
          {renderCoeffEquation(q)}
          {hintOn ? (
            <AtomHintPanel eq={q.eq} leftCoeffs={coeffL} rightCoeffs={coeffR} />
          ) : null}
        </div>
        <div
          className={
            "mt-2 text-center text-[11px] font-bold " +
            (inputLock ? "text-amber-200/80" : "text-white/45")
          }
        >
          {inputLock
            ? "左右の原子の数を確かめよう…"
            : "数字を続けて押せば2桁も入力できる。「次へ」で右の欄へ移る"}
        </div>
        {renderLabPad({
          checkFn: onCheckCoeff,
          checkEnabled: allCoeffFilled(q) && !overlay && !checkLock && !inputLock,
          padEnabled: !inputLock,
          onClear: onClearCoeffs,
          clearEnabled:
            hasAnyCoeffInput(q) && !overlay && !checkLock && !inputLock,
        })}
      </div>
    );
  }

  /* ----- ○×ジャッジ画面 ----- */

  function renderJudgeRun(q) {
    return (
      <div className="mt-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-10 text-center">
          <div className="text-xs font-bold text-white/55">
            この化学反応式、あってる？
          </div>
          <div className="mt-4">
            <EquationStatic
              eq={q.eq}
              leftCoeffs={q.shownLeft}
              rightCoeffs={q.shownRight}
              size="text-2xl sm:text-3xl"
            />
          </div>
        </div>
        <div className="mx-auto mt-5 grid w-full max-w-md grid-cols-2 gap-3">
          <button
            type="button"
            onClick={function () {
              onJudge(true);
            }}
            className="h-24 rounded-3xl border border-emerald-400/30 bg-emerald-500/15 text-5xl font-extrabold text-emerald-200 transition hover:bg-emerald-500/25 active:scale-[0.98]"
          >
            ○
          </button>
          <button
            type="button"
            onClick={function () {
              onJudge(false);
            }}
            className="h-24 rounded-3xl border border-rose-400/30 bg-rose-500/15 text-5xl font-extrabold text-rose-200 transition hover:bg-rose-500/25 active:scale-[0.98]"
          >
            ×
          </button>
        </div>
        <div className="mt-3 text-center text-[11px] font-bold text-white/45">
          つり合っていれば ○・誤りなら ×（ミスは＋5秒）
        </div>
      </div>
    );
  }

  /* ----- 組み立てラボ画面 ----- */

  function renderBuildEquation(q) {
    // 物質を並べている間は係数欄を無効にし、選択のハイライトも物質側だけに出す
    const stage = buildStage(q);
    function renderSide(side, sideKey, subArr) {
      const nodes = [];
      for (let i = 0; i < side.length; i++) {
        if (i > 0) {
          nodes.push(
            <span key={sideKey + "p" + i} className="mx-1 text-xl font-bold text-white/60">
              ＋
            </span>
          );
        }
        const selected = selPos.side === sideKey && selPos.idx === i;
        const value = sideKey === "L" ? coeffL[i] : coeffR[i];
        const sub = subArr[i];
        const isBad = !!badPos[posKey(sideKey, i)];
        nodes.push(
          <span key={sideKey + "t" + i} className="inline-flex items-center whitespace-nowrap py-1.5">
            <CoeffSlotButton
              value={isNil(value) ? null : value}
              selected={stage === "coeff" && selected}
              disabled={stage === "subs"}
              onClick={function () {
                setSelPos({ side: sideKey, idx: i });
              }}
            />
            <button
              type="button"
              onClick={function () {
                setSelPos({ side: sideKey, idx: i });
                if (sub) {
                  // 配置済みの物質をタップで外す。係数も意味を失うので空に戻す
                  setSubValue(sideKey, i, null);
                  setCoeffValue(sideKey, i, null);
                }
              }}
              className={
                "inline-flex h-12 min-w-[64px] items-center justify-center rounded-xl border-2 px-2 transition " +
                (isBad
                  ? "border-rose-400 bg-rose-500/20"
                  : stage === "subs" && selected
                    ? "border-sky-400 bg-sky-400/15"
                    : sub
                      ? "border-white/15 bg-white/10"
                      : "border-dashed border-white/30 bg-white/5")
              }
            >
              {sub ? (
                <FormulaText formula={sub} className="text-xl font-extrabold" />
              ) : (
                <span className="text-sm font-bold text-white/35">？</span>
              )}
            </button>
          </span>
        );
      }
      return nodes;
    }
    return (
      <div
        key={shakeKey}
        className={
          "flex flex-wrap items-center justify-center " +
          (shakeOn ? "animate-shake" : "")
        }
      >
        {renderSide(q.eq.left, "L", subL)}
        <span className="mx-2 text-2xl font-bold text-sky-300">→</span>
        {renderSide(q.eq.right, "R", subR)}
      </div>
    );
  }

  function renderBuildRun(q) {
    const used = usedCardFormulas();
    const stage = buildStage(q);
    const canCheck =
      allSubsFilled(q) && allCoeffFilled(q) && !overlay && !checkLock && !inputLock;
    return (
      <div className="mt-5">
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 px-4 py-4 text-center">
          <div className="text-[11px] font-bold text-rose-200/80">実験・操作</div>
          <div className="mt-1 text-base font-bold leading-relaxed text-white sm:text-lg">
            {q.eq.desc}
          </div>
        </div>

        {/* 解く手順：まず物質を並べ、そろってから係数を決める */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <StageChip active={stage === "subs"}>① 物質を並べる</StageChip>
          <span className="text-xs font-bold text-white/25">→</span>
          <StageChip active={stage === "coeff"}>② 係数を決める</StageChip>
        </div>

        <div className="mt-3 rounded-3xl border border-white/10 bg-white/5 px-3 py-6">
          {renderBuildEquation(q)}
          {/* 物質が欠けていると buildChosenEq が穴埋めの H を混ぜてしまい、
              実際には存在しない元素が並ぶ。そろっているときだけ表示する */}
          {hintOn && stage === "coeff" ? (
            <AtomHintPanel
              eq={buildChosenEq(q)}
              leftCoeffs={coeffL}
              rightCoeffs={coeffR}
            />
          ) : null}
        </div>

        <div
          key={inputLock ? "lock" : stage}
          className={
            "mt-2 text-center text-[11px] font-bold animate-fadein " +
            (inputLock ? "text-amber-200/80" : "text-white/45")
          }
        >
          {inputLock
            ? "左右の原子の数を確かめよう…"
            : stage === "subs"
            ? "説明文に出てくる物質をカードから選び、左辺と右辺に並べよう"
            : "左右の原子の数がそろうように係数を入力（物質を直すときはカードをタップ）"}
        </div>

        <div className="mx-auto mt-3 grid w-full max-w-lg grid-cols-4 gap-2">
          {q.cards.map(function (f) {
            const isUsed = !!used[f];
            return (
              <button
                key={f}
                type="button"
                onClick={function () {
                  onTapCard(f);
                }}
                className={
                  "flex h-14 items-center justify-center rounded-2xl border px-1 transition active:scale-[0.97] " +
                  (isUsed
                    ? "border-dashed border-white/15 bg-white/5 text-white/30"
                    : "border-white/10 bg-white/10 text-white hover:bg-white/15")
                }
              >
                <FormulaText formula={f} className="text-lg font-bold" />
              </button>
            );
          })}
        </div>

        {renderNumberPad({
          checkFn: onCheckBuild,
          checkEnabled: canCheck,
          padEnabled: stage === "coeff" && !inputLock,
          onClear: onClearCoeffs,
          clearEnabled:
            stage === "coeff" &&
            hasAnyCoeffInput(q) &&
            !overlay &&
            !checkLock &&
            !inputLock,
        })}
      </div>
    );
  }

  /* ----- わからない（スキップ）ボタン ----- */

  /* どのモードでも画面のいちばん下に置く（renderRun のスペーサーで押し下げる）。
     位置が画面下端で固定なので、問題の種類が変わっても探さずに済む。
     解答中に指が当たらないよう、解答エリアからは大きく離し、
     ボタン自体も横幅いっぱいには広げない（当たり判定を小さくする）。
     さらに誤タップ防止のため2度押し式にしてある */
  function renderSkipButton() {
    const isLab = mode === MODES.LAB;
    const penalty = isLab
      ? Math.round(MODE_CONFIG[MODES.LAB].skipPenaltyMs / 1000)
      : MODE_CONFIG[mode].skipPenalty;
    const mark = isLab ? "−" : "＋";
    const disabled = !!overlay || checkLock;
    let tone =
      "border-white/10 bg-white/[0.04] text-white/45 hover:bg-white/10 hover:text-white/75";
    if (disabled) tone = "border-white/5 bg-white/[0.03] text-white/20";
    else if (skipArmed)
      tone = "border-amber-300/50 bg-amber-500/20 text-amber-100";
    return (
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onSkip}
          disabled={disabled}
          className={
            "inline-flex min-h-[44px] items-center justify-center rounded-full border px-6 text-xs font-bold transition active:scale-[0.98] " +
            tone
          }
        >
          {skipArmed
            ? "もう一度タップでスキップ（" + mark + penalty + "秒）"
            : "わからない（スキップ " + mark + penalty + "秒）"}
        </button>
      </div>
    );
  }

  /* ----- 実行画面 ----- */

  function renderRun() {
    if (!currentQ) return null;
    let body = null;
    if (currentQ.kind === "formula") body = renderFormulaRun(currentQ);
    if (currentQ.kind === "coeff") body = renderCoeffRun(currentQ);
    if (currentQ.kind === "lab") body = renderLabRun(currentQ);
    if (currentQ.kind === "judge") body = renderJudgeRun(currentQ);
    if (currentQ.kind === "build") body = renderBuildRun(currentQ);
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 pb-24 pt-4 sm:px-6">
        {renderHeader()}
        {renderProgressBar()}
        {body}
        {/* 解答エリアとスキップボタンの間を空けるスペーサー。
            画面に余裕があればボタンを下端まで押し下げ、
            内容が多いモードでも最低 56px は離す */}
        <div className="min-h-[56px] flex-1" aria-hidden="true" />
        {renderSkipButton()}
      </div>
    );
  }

  /* ----- カウントダウン ----- */

  function renderCountdown() {
    const labels = ["3", "2", "1", "START!"];
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div
          key={countdownStep}
          className="text-center text-7xl font-extrabold tracking-tight text-white animate-countpop sm:text-8xl"
        >
          {labels[countdownStep]}
        </div>
      </div>
    );
  }

  /* ----- 結果画面 ----- */

  function renderResultQuestionRow(q, i) {
    if (q.kind === "formula") {
      return (
        <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
          <span className="text-sm font-bold text-white/80">{q.sub.name}</span>
          <FormulaText formula={q.sub.f} className="text-lg font-bold" />
        </div>
      );
    }
    return (
      <div key={i} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
        <div className="text-[11px] font-bold text-white/50">
          {coalesce(q.eq.desc, q.eq.cat)}
        </div>
        <div className="mt-1 text-center">
          <EquationStatic eq={q.eq} size="text-base sm:text-lg" />
        </div>
      </div>
    );
  }

  function nextRankInfo(mode, sec) {
    const g = MODE_CONFIG[mode].grades;
    const grade = gradeFor(mode, sec).grade;
    if (grade === "SS") return null;
    if (grade === "S") return { rank: "SS", limit: g.ss, strict: true };
    if (grade === "A") return { rank: "S", limit: g.s, strict: false };
    if (grade === "B") return { rank: "A", limit: g.a, strict: false };
    return { rank: "B", limit: g.b, strict: false };
  }

  function renderResult() {
    if (!lastResult) return null;
    const isLab = lastResult.mode === MODES.LAB;
    const gr = gradeFor(lastResult.mode, lastResult.sec);
    const missed = lastResult.missedQuestions;
    const next =
      lastResult.phase === "main" && !isLab
        ? nextRankInfo(lastResult.mode, lastResult.sec)
        : null;
    // 誤答・スキップ数は lastResult（確定値）から読む
    const missCount = coalesce(lastResult.wrongTaps, wrongTaps);
    const skipCount = coalesce(lastResult.skips, 0);
    const noMiss = missCount === 0 && skipCount === 0;
    // 復習は問題数も評価基準も本番と違うため、グレード用の見出し・講評は使わない
    const isReview = lastResult.phase === "review";
    // 記録が残らない回は、タイムだけ速くてもランクや称号は出さない
    // （誤答だらけで「速さも正確さも申し分なし」と出るのはおかしいため）
    const voided = !!lastResult.tooManyMisses || !!lastResult.tooManySkips;
    const headline = isReview
      ? "復習おつかれさま"
      : voided
        ? "ランクなし"
        : gr.title;
    const comment = isReview
      ? noMiss
        ? "今回はすべて正解。この調子で本番のタイムも縮めよう。"
        : "まだ迷う問題がある。もう一度復習してみよう。"
      : voided
        ? "1問ずつ確実に解けるようになると、タイムも自然に縮みます。"
        : gr.comment;
    const gradeColor =
      gr.grade === "SS"
        ? "text-amber-300 [text-shadow:0_0_18px_rgba(251,191,36,0.6)]"
        : gr.grade === "S"
          ? "text-emerald-300"
          : gr.grade === "A"
            ? "text-sky-300"
            : "text-white";
    return (
      <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-8 sm:px-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
          <div className="text-xs font-bold text-white/55">
            {MODE_CONFIG[lastResult.mode].title}
            {lastResult.phase === "review" ? "（復習）" : ""}
          </div>
          <div className="mt-4 text-6xl font-extrabold tabular-nums text-white">
            {isLab ? lastResult.sec : formatSeconds(lastResult.sec)}
            <span className="ml-1 text-2xl text-white/50">{isLab ? "問" : "s"}</span>
          </div>
          {isLab ? (
            <div className="mt-1 text-xs font-bold text-white/50">
              第
              {Math.floor(
                Math.max(0, lastResult.sec - 1) /
                  MODE_CONFIG[MODES.LAB].questionsPerLayer
              ) + 1}
              層まで到達
            </div>
          ) : null}
          {lastResult.phase === "main" ? (
            <div
              className={
                "mt-3 text-5xl font-extrabold " +
                (voided ? "text-white/25" : gradeColor)
              }
            >
              {voided ? "—" : gr.grade}
            </div>
          ) : null}
          <div className="mt-3 text-lg font-bold text-white">{headline}</div>
          <div className="mx-auto mt-1 max-w-sm text-sm text-white/65">
            {comment}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {lastResult.isNewBest ? (
              <span className="inline-flex items-center rounded-full border border-amber-300/40 bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-200">
                ★ ベスト記録を更新！
              </span>
            ) : null}
            {noMiss ? (
              <span className="inline-flex items-center rounded-full border border-emerald-300/40 bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-200">
                ✨ ノーミス達成！
              </span>
            ) : null}
          </div>
          {next && !voided ? (
            <div className="mt-3 text-xs font-bold text-white/60">
              次は
              <span className="mx-1 text-sm font-bold text-white">
                {next.rank}
              </span>
              ランク：{next.limit}秒{next.strict ? "未満" : "以内"}
              <span className="ml-1 text-white/45">
                （あと {formatSeconds(Math.max(0, lastResult.sec - next.limit))} 秒）
              </span>
            </div>
          ) : null}
          {lastResult.tooManyMisses || lastResult.tooManySkips ? (
            <div className="mx-auto mt-4 max-w-sm rounded-2xl border border-amber-300/40 bg-amber-400/10 px-4 py-3 text-xs font-bold leading-relaxed text-amber-200">
              {lastResult.tooManyMisses
                ? "誤答が " +
                  MODE_CONFIG[lastResult.mode].maxMiss +
                  " 回を超えたため、今回の記録は保存されません。"
                : "スキップが " +
                  MODE_CONFIG[lastResult.mode].maxSkip +
                  " 回を超えたため、今回の記録は保存されません。"}
              <br />
              {lastResult.tooManyMisses
                ? "あてずっぽうではなく、1問ずつ確実に答えてみよう。"
                : "まずは復習モードで、解ける問題を増やしてみよう。"}
            </div>
          ) : null}
          {lastResult.reachedLimit ? (
            <div className="mt-4 rounded-2xl border border-amber-300/60 bg-gradient-to-r from-amber-500/25 via-rose-500/20 to-violet-500/25 px-4 py-4 animate-popin">
              <div className="text-xl font-bold text-amber-200 [text-shadow:0_0_14px_rgba(251,191,36,0.6)]">
                🏆 限界深度 到達！！
              </div>
              <div className="mt-1.5 text-xs font-bold leading-relaxed text-white/80">
                {LAB_MAX_QUESTIONS}問すべて突破。これ以上は誰も潜れない、
                無限ラボの底です。
              </div>
            </div>
          ) : null}
          {lastResult.unlockedDeep ? (
            <div className="mt-4 rounded-2xl border border-emerald-300/50 bg-gradient-to-r from-emerald-500/20 via-sky-500/20 to-violet-500/20 px-4 py-4 animate-popin">
              <div className="text-xl font-bold text-emerald-200 [text-shadow:0_0_14px_rgba(52,211,153,0.5)]">
                ✨ 真の裏モード解放！！
              </div>
              <div className="mt-1.5 text-xs font-bold leading-relaxed text-white/80">
                STEP3・STEP4 もSランク達成。終わりのない「無限ラボ」が
                プレイ可能になった！
              </div>
            </div>
          ) : null}
          {lastResult.unlockedSecret ? (
            <div className="mt-4 rounded-2xl border border-amber-300/50 bg-gradient-to-r from-amber-500/20 via-rose-500/20 to-violet-500/20 px-4 py-4 animate-popin">
              <div className="text-xl font-bold text-amber-200 [text-shadow:0_0_14px_rgba(251,191,36,0.5)]">
                🎉 裏モード解放！！
              </div>
              <div className="mt-1.5 text-xs font-bold leading-relaxed text-white/80">
                全モードSランク達成。「○×ジャッジ」と「組み立てラボ」が
                プレイ可能になった！
              </div>
            </div>
          ) : null}
          <div className="mt-4 text-xs font-bold text-white/50">
            {isLab ? "落とした問題" : "誤答"}：{missCount} 回
            {skipCount > 0 ? " ／ スキップ：" + skipCount + " 回" : ""} ／
            最大コンボ：{coalesce(lastResult.maxStreak, 0)}
          </div>
        </div>

        {missed.length > 0 ? (
          <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-bold text-white">
              間違えた問題（{missed.length}）
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
              {missed.map(renderResultQuestionRow)}
            </div>
          </div>
        ) : null}

        <div className="mt-5 space-y-3">
          {missed.length > 0 && !isLab ? (
            <ActionButton onClick={startReview}>
              復習する（間違えた {missed.length} 問）
            </ActionButton>
          ) : null}
          <ActionButton
            variant={missed.length > 0 && !isLab ? "secondary" : "primary"}
            onClick={function () {
              startMode(lastResult.mode);
            }}
          >
            もう一度チャレンジ
          </ActionButton>
          <ActionButton variant="secondary" onClick={quitToHome}>
            ホームへ
          </ActionButton>
        </div>
      </div>
    );
  }

  /* ----- ホーム ----- */

  function renderHome() {
    const secretUnlocked = isSecretUnlocked(bestByMode);
    const deepUnlocked = isDeepSecretUnlocked(bestByMode);
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <LogoMark />
              <div>
                <div className="text-[10px] font-bold tracking-[0.22em] text-sky-300/80">
                  CHEMICAL EQUATION MASTER
                </div>
                <h1 className="mt-0.5 bg-gradient-to-r from-white via-sky-100 to-sky-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
                  化学反応式マスター
                </h1>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleSound}
              aria-label={soundOn ? "効果音をオフにする" : "効果音をオンにする"}
              className={
                "rounded-2xl border px-3.5 py-3 text-base font-bold transition " +
                (soundOn
                  ? "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  : "border-white/10 bg-white/5 text-white/35 hover:bg-white/10")
              }
            >
              {soundOn ? "🔊" : "🔇"}
            </button>
            <button
              type="button"
              onClick={function () {
                setShowHelp(true);
              }}
              className="min-h-[44px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/80 hover:bg-white/10"
            >
              遊び方
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <ModeCard
            step="STEP1"
            accent="cyan"
            title="化学式マッチ"
            detail="物質名と化学式を対応づける（20問）。まずはここから。"
          >
            <StartButton
              accent="cyan"
              mode={MODES.FORMULA_BASIC}
              best={bestByMode[MODES.FORMULA_BASIC]}
              onClick={function () {
                startMode(MODES.FORMULA_BASIC);
              }}
            >
              基本
            </StartButton>
            <StartButton
              accent="cyan"
              mode={MODES.FORMULA_CHALLENGE}
              best={bestByMode[MODES.FORMULA_CHALLENGE]}
              onClick={function () {
                startMode(MODES.FORMULA_CHALLENGE);
              }}
            >
              チャレンジ
            </StartButton>
          </ModeCard>

          <ModeCard
            step="STEP2"
            accent="violet"
            title="係数バランス"
            detail="係数を入力して左右の原子数をそろえる（10問）。基本は空欄1カ所、チャレンジは全係数を入力。"
          >
            <StartButton
              accent="violet"
              mode={MODES.COEFF_BASIC}
              best={bestByMode[MODES.COEFF_BASIC]}
              onClick={function () {
                startMode(MODES.COEFF_BASIC);
              }}
            >
              基本
            </StartButton>
            <StartButton
              accent="violet"
              mode={MODES.COEFF_CHALLENGE}
              best={bestByMode[MODES.COEFF_CHALLENGE]}
              onClick={function () {
                startMode(MODES.COEFF_CHALLENGE);
              }}
            >
              チャレンジ
            </StartButton>
          </ModeCard>

          <ModeCard
            step={secretUnlocked ? "STEP3" : "🔒 裏モード"}
            locked={!secretUnlocked}
            accent="amber"
            title="○×ジャッジ"
            detail="この反応式は正しいか、瞬時に見極める（20問）。ミスは＋5秒。"
          >
            <StartButton
              accent="amber"
              mode={MODES.JUDGE}
              best={bestByMode[MODES.JUDGE]}
              inert={!secretUnlocked}
              onClick={function () {
                startMode(MODES.JUDGE);
              }}
            >
              スタート
            </StartButton>
          </ModeCard>

          <ModeCard
            step={secretUnlocked ? "STEP4" : "🔒 裏モード"}
            locked={!secretUnlocked}
            accent="rose"
            title="組み立てラボ"
            detail="実験の説明文から反応式を一から組み立てる最終ステージ（5問）。"
          >
            <StartButton
              accent="rose"
              mode={MODES.BUILD}
              best={bestByMode[MODES.BUILD]}
              inert={!secretUnlocked}
              onClick={function () {
                startMode(MODES.BUILD);
              }}
            >
              スタート
            </StartButton>
          </ModeCard>

          <div className="sm:col-span-2">
            <ModeCard
              step={deepUnlocked ? "FINAL" : "🔒 真の裏モード"}
              locked={!deepUnlocked}
              accent="emerald"
              title="無限ラボ"
              detail="教科書にない反応式も出てくる、終わりのないサバイバル。持ち時間60秒から始まり、1問正解するごとに時間が増える。層が上がるほど反応式は難しく、増える時間は短くなる。何問クリアできるかを競う。"
            >
              <StartButton
                accent="emerald"
                mode={MODES.LAB}
                best={bestByMode[MODES.LAB]}
                inert={!deepUnlocked}
                onClick={function () {
                  startMode(MODES.LAB);
                }}
              >
                スタート
              </StartButton>
            </ModeCard>
          </div>
        </div>

        <div className="mt-6 text-center text-[11px] leading-relaxed text-white/35">
          ベスト記録は各ボタンに表示（この端末に保存）
          <br />
          係数は「最も簡単な整数比」で入力（1 も入力する）
          <br />
          中学範囲の頻出化学反応式（イオン反応式を除く）を収録
          <br />
          無限ラボだけは中学範囲外の反応式も自動生成して出題
        </div>
      </div>
    );
  }

  /* ----- 全体 ----- */

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-white">
      {/* 背景の装飾 */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div
          className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-sky-500/10"
          style={{ filter: "blur(70px)" }}
        />
        <div
          className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-violet-500/10"
          style={{ filter: "blur(70px)" }}
        />
      </div>

      <div className="relative">
        {screen === "home" ? renderHome() : null}
        {screen === "countdown" ? renderCountdown() : null}
        {screen === "run" ? renderRun() : null}
        {screen === "result" ? renderResult() : null}
      </div>

      {overlay ? (
        <Overlay kind={overlay.kind} title={overlay.title} sub={overlay.sub}>
          {overlay.node}
        </Overlay>
      ) : null}

      {toast ? (
        <div
          key={toast.key}
          className="fixed bottom-6 left-1/2 z-[55] w-[90%] max-w-md -translate-x-1/2 rounded-2xl border border-amber-300/40 bg-amber-500/90 px-4 py-3 text-center text-sm font-bold text-slate-950 shadow-xl animate-popin"
        >
          {toast.text}
        </div>
      ) : null}

      {showHelp ? (
        <HelpModal
          onClose={function () {
            setShowHelp(false);
          }}
        />
      ) : null}
    </div>
  );
}
