/**
 * 反応式ジェネレーター（無限ラボ／STEP5 用）
 *
 * 固定の出題データ（src/data.js・42式）だけだと答えを覚えられてしまうため、
 * このモジュールでは反応の「族」とイオンの価数表から反応式を組み立てる。
 *
 * 方針：
 *  - 実際に起こる反応だけを出す。組み合わせは族ごとのホワイトリストで絞る
 *    （例：金属＋酸 は水素より下の銀・銅を入れない）
 *  - 目算法（原子を順に数える）で解ける反応だけにする。酸化還元で係数が
 *    大きく跳ねるもの（Cu＋希硝酸 など）は入れない
 *  - 生徒はイオン化傾向を習っていない。「反応するかどうか」は問わず、
 *    与えられた反応式の係数を合わせることだけに集中させる
 *  - 係数は balance() で自動計算し、npm run validate で全パターンを検査する
 *
 * 古い iPadOS/Safari 対策のため、新しい構文（?. や ??）は使わない。
 */

import { parseFormula, gcdAll } from "./chem.js";

/* ================= 有理数と連立方程式 ================= */

function frac(n, d) {
  if (typeof d !== "number") d = 1;
  if (d < 0) {
    n = -n;
    d = -d;
  }
  var g = gcd2i(Math.abs(n), d);
  if (g === 0) return { n: 0, d: 1 };
  return { n: n / g, d: d / g };
}
function gcd2i(a, b) {
  while (b) {
    var t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function fAdd(a, b) {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}
function fSub(a, b) {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}
function fMul(a, b) {
  return frac(a.n * b.n, a.d * b.d);
}
function fDiv(a, b) {
  return frac(a.n * b.d, a.d * b.n);
}

/**
 * 反応式の係数を求める。
 * left / right は化学式の配列。左辺を正・右辺を負として
 * 元素ごとの原子数がゼロになる係数ベクトル（自由度1）を解く。
 * 返り値は最小の正の整数比。解けない・負が出る場合は null。
 */
export function balance(left, right) {
  var species = left.concat(right);
  var sign = [];
  var i;
  for (i = 0; i < species.length; i++) sign.push(i < left.length ? 1 : -1);

  // 元素の一覧
  var elements = [];
  var atoms = [];
  for (i = 0; i < species.length; i++) {
    var a = parseFormula(species[i]);
    atoms.push(a);
    for (var el in a) {
      if (Object.prototype.hasOwnProperty.call(a, el) && elements.indexOf(el) < 0) {
        elements.push(el);
      }
    }
  }
  var rows = elements.length;
  var cols = species.length;
  if (cols < 2) return null;

  // 係数行列（有理数）
  var m = [];
  for (var r = 0; r < rows; r++) {
    var row = [];
    for (var c = 0; c < cols; c++) {
      var v = atoms[c][elements[r]];
      row.push(frac(typeof v === "number" ? v * sign[c] : 0));
    }
    m.push(row);
  }

  // ガウスの消去法で行簡約階段形にする
  var pivotCol = [];
  var pr = 0;
  for (var col = 0; col < cols && pr < rows; col++) {
    var sel = -1;
    for (var rr = pr; rr < rows; rr++) {
      if (m[rr][col].n !== 0) {
        sel = rr;
        break;
      }
    }
    if (sel < 0) continue;
    var tmp = m[pr];
    m[pr] = m[sel];
    m[sel] = tmp;
    var pv = m[pr][col];
    for (var cc = 0; cc < cols; cc++) m[pr][cc] = fDiv(m[pr][cc], pv);
    for (var r2 = 0; r2 < rows; r2++) {
      if (r2 === pr || m[r2][col].n === 0) continue;
      var factor = m[r2][col];
      for (var c2 = 0; c2 < cols; c2++) {
        m[r2][c2] = fSub(m[r2][c2], fMul(factor, m[pr][c2]));
      }
    }
    pivotCol.push(col);
    pr++;
  }

  // 自由変数がちょうど1つでないと係数が一意に決まらない
  var free = [];
  for (var k = 0; k < cols; k++) if (pivotCol.indexOf(k) < 0) free.push(k);
  if (free.length !== 1) return null;

  var f = free[0];
  var x = [];
  for (i = 0; i < cols; i++) x.push(frac(0));
  x[f] = frac(1);
  for (i = 0; i < pivotCol.length; i++) {
    // pivot 列の値 = -(自由変数の係数)
    x[pivotCol[i]] = fSub(frac(0), m[i][f]);
  }

  // 分母の最小公倍数を掛けて整数にし、最大公約数で割る
  var lcm = 1;
  for (i = 0; i < cols; i++) lcm = (lcm / gcd2i(lcm, x[i].d)) * x[i].d;
  var ints = [];
  for (i = 0; i < cols; i++) ints.push((x[i].n * lcm) / x[i].d);
  var g = gcdAll(ints.map(Math.abs));
  if (!g) return null;
  for (i = 0; i < cols; i++) ints[i] = ints[i] / g;
  if (ints[0] < 0) for (i = 0; i < cols; i++) ints[i] = -ints[i];
  for (i = 0; i < cols; i++) {
    if (!(ints[i] > 0) || Math.floor(ints[i]) !== ints[i]) return null;
  }
  return {
    left: ints.slice(0, left.length),
    right: ints.slice(left.length),
  };
}

/* ================= イオンの表 =================
 * ion-block-lab で扱っているイオンに合わせている。
 * v = 価数, poly = 多原子イオン（かっこが必要かの判定に使う）
 */

var CATIONS = {
  Na: { f: "Na", v: 1, name: "ナトリウム" },
  K: { f: "K", v: 1, name: "カリウム" },
  Ag: { f: "Ag", v: 1, name: "銀" },
  Mg: { f: "Mg", v: 2, name: "マグネシウム" },
  Ca: { f: "Ca", v: 2, name: "カルシウム" },
  Ba: { f: "Ba", v: 2, name: "バリウム" },
  Zn: { f: "Zn", v: 2, name: "亜鉛" },
  Cu: { f: "Cu", v: 2, name: "銅" },
  Pb: { f: "Pb", v: 2, name: "鉛" },
  Fe2: { f: "Fe", v: 2, name: "鉄(Ⅱ)" },
  Fe3: { f: "Fe", v: 3, name: "鉄(Ⅲ)" },
  Al: { f: "Al", v: 3, name: "アルミニウム" },
};

var ANIONS = {
  F: { f: "F", v: 1, name: "フッ化", acid: "HF", acidName: "フッ化水素酸" },
  Cl: { f: "Cl", v: 1, name: "塩化", acid: "HCl", acidName: "塩酸" },
  Br: { f: "Br", v: 1, name: "臭化", acid: "HBr", acidName: "臭化水素酸" },
  I: { f: "I", v: 1, name: "ヨウ化", acid: "HI", acidName: "ヨウ化水素酸" },
  NO3: { f: "NO3", v: 1, name: "硝酸", poly: true, acid: "HNO3", acidName: "硝酸" },
  O: { f: "O", v: 2, name: "酸化" },
  S: { f: "S", v: 2, name: "硫化", acid: "H2S", acidName: "硫化水素" },
  SO4: { f: "SO4", v: 2, name: "硫酸", poly: true, acid: "H2SO4", acidName: "硫酸" },
  CO3: { f: "CO3", v: 2, name: "炭酸", poly: true, acid: "H2CO3", acidName: "炭酸" },
};

function gcdPair(a, b) {
  return gcd2i(a, b);
}

/** 価数から組成比を出す（陽イオンの数, 陰イオンの数） */
function saltRatio(catV, anV) {
  var g = gcdPair(catV, anV);
  return [anV / g, catV / g];
}

/** 化学式の組み立て。多原子イオンが2個以上ならかっこでくくる */
function wrap(ion, count) {
  if (count === 1) return ion.f;
  if (ion.poly) return "(" + ion.f + ")" + String(count);
  return ion.f + String(count);
}

/** 塩・酸化物などの化学式（例: Al + SO4 → "Al2(SO4)3"） */
export function saltFormula(cat, an) {
  var r = saltRatio(cat.v, an.v);
  return wrap(cat, r[0]) + wrap(an, r[1]);
}

/** 水酸化物の化学式（例: Ca → "Ca(OH)2"） */
function hydroxideFormula(cat) {
  return cat.v === 1 ? cat.f + "OH" : cat.f + "(OH)" + String(cat.v);
}

/** 塩の名前（例: 硫酸アルミニウム） */
function saltName(cat, an) {
  return an.name + cat.name;
}

/* ================= 反応の族 =================
 * 各族は「実際に起こる組み合わせ」だけを列挙する。
 * 係数は balance() が求めるので、ここでは化学式を並べるだけでよい。
 * layer は無限ラボの層（1が易しい）。
 */

/** 指定したキーの陽イオンを取り出す */
function cats(keys) {
  return keys.map(function (k) {
    return CATIONS[k];
  });
}

// 単体の非金属と、化合してできる陰イオン。metals は実際に化合するものだけ
var COMBINE = [
  {
    sub: "O2",
    an: ANIONS.O,
    // 銀は空気中で酸化しない。鉄は Fe3O4 になるので下の SPECIALS で扱う
    metals: ["Na", "K", "Mg", "Ca", "Ba", "Zn", "Cu", "Pb", "Al"],
  },
  { sub: "S", an: ANIONS.S, metals: ["Na", "K", "Mg", "Ca", "Ba", "Zn", "Cu", "Pb", "Fe2", "Ag", "Al"] },
  { sub: "Cl2", an: ANIONS.Cl, metals: ["Na", "K", "Mg", "Ca", "Ba", "Zn", "Cu", "Pb", "Fe3", "Ag", "Al"] },
  { sub: "Br2", an: ANIONS.Br, metals: ["Na", "K", "Mg", "Ca", "Zn", "Fe3", "Al"] },
  // ヨウ素は鉄と FeI2 をつくる（FeI3 は不安定）ので鉄を入れない
  { sub: "I2", an: ANIONS.I, metals: ["Na", "K", "Mg", "Ca", "Zn", "Al"] },
];

// 熱分解する炭酸塩・水酸化物（アルカリ金属のものは分解しないので入れない）
var DECOMP_CARBONATE = ["Mg", "Ca", "Ba", "Zn", "Cu", "Pb", "Fe2", "Ag"];
var DECOMP_HYDROXIDE = ["Mg", "Ca", "Zn", "Cu", "Pb", "Fe2", "Fe3", "Al"];

// 中和に使う酸と塩基
var ACIDS_STRONGISH = ["Cl", "Br", "I", "NO3", "SO4"];
var ACIDS_ALL = ["F", "Cl", "Br", "I", "NO3", "SO4", "S", "CO3"];
var BASE_CATIONS = ["Na", "K", "Mg", "Ca", "Ba", "Zn", "Cu", "Pb", "Fe2", "Fe3", "Al"];
var OXIDE_CATIONS = ["Na", "K", "Mg", "Ca", "Ba", "Zn", "Cu", "Pb", "Fe2", "Fe3", "Al", "Ag"];
var CARBONATE_CATIONS = ["Na", "K", "Mg", "Ca", "Ba", "Zn", "Cu", "Pb", "Fe2", "Ag"];
// 水素より上の金属だけ（イオン化傾向は未習なので、出す側で担保する）。
// 硝酸は酸化還元になり目算法で解けないため使わない
var ACTIVE_METALS = ["Mg", "Zn", "Al", "Fe2"];

// 有機物の燃焼。実在する分子だけを名前つきで持つ
var BURNABLES = [
  { f: "CH4", name: "メタン" },
  { f: "C2H2", name: "アセチレン" },
  { f: "C2H4", name: "エチレン" },
  { f: "C2H6", name: "エタン" },
  { f: "C3H6", name: "プロピレン" },
  { f: "C3H8", name: "プロパン" },
  { f: "C4H8", name: "ブテン" },
  { f: "C4H10", name: "ブタン" },
  { f: "C5H12", name: "ペンタン" },
  { f: "C6H6", name: "ベンゼン" },
  { f: "C6H12", name: "シクロヘキサン" },
  { f: "C6H14", name: "ヘキサン" },
  { f: "C7H16", name: "ヘプタン" },
  { f: "C8H18", name: "オクタン" },
  { f: "C2H6O", name: "エタノール" },
  { f: "C3H8O", name: "プロパノール" },
  { f: "C6H12O6", name: "ブドウ糖" },
];

/* ================= 数えて求める系の反応 =================
 * 価数が分かれば係数が決まる反応（中和・炭酸塩＋酸など）と違い、
 * 原子を順に数えないと係数が出ないもの。無限ラボの深い層はこちらを中心に出す。
 * 高校範囲の反応も入れるが、実在すること・目算法で解けることは確認済み。
 */
var COUNTING = [
  /* --- 不完全燃焼（酸素が足りないとき）。一酸化炭素ができる --- */
  ["CH4", "O2", "CO", "H2O"],
  ["C2H6", "O2", "CO", "H2O"],
  ["C2H4", "O2", "CO", "H2O"],
  ["C3H8", "O2", "CO", "H2O"],
  ["C4H10", "O2", "CO", "H2O"],
  ["C6H6", "O2", "CO", "H2O"],
  ["C8H18", "O2", "CO", "H2O"],
  ["C2H6O", "O2", "CO", "H2O"],
];

/* 分類名つきで持つ反応。l=左辺, r=右辺 */
var EXTRA = [
  /* --- 硫化鉱の焙焼（鉱石を空気中で強く熱する）--- */
  { l: ["ZnS", "O2"], r: ["ZnO", "SO2"], cat: "焙焼" },
  { l: ["PbS", "O2"], r: ["PbO", "SO2"], cat: "焙焼" },
  { l: ["FeS", "O2"], r: ["Fe2O3", "SO2"], cat: "焙焼" },
  { l: ["FeS2", "O2"], r: ["Fe2O3", "SO2"], cat: "焙焼" }, // 黄鉄鉱。係数 4,11,2,8
  { l: ["Cu2S", "O2"], r: ["Cu", "SO2"], cat: "焙焼" },
  { l: ["Ag2S", "O2"], r: ["Ag", "SO2"], cat: "焙焼" },
  { l: ["HgS", "O2"], r: ["Hg", "SO2"], cat: "焙焼" }, // 辰砂からの水銀の製造

  /* --- 還元（炭素・一酸化炭素・水素・アルミニウム）--- */
  { l: ["SnO2", "C"], r: ["Sn", "CO2"], cat: "還元" },
  { l: ["MnO2", "C"], r: ["Mn", "CO2"], cat: "還元" },
  { l: ["SnO2", "H2"], r: ["Sn", "H2O"], cat: "還元" },
  { l: ["Fe3O4", "H2"], r: ["Fe", "H2O"], cat: "還元" },
  { l: ["SiO2", "C"], r: ["Si", "CO"], cat: "還元" }, // ケイ素の製造。CO ができる
  // テルミット反応（アルミニウムで金属を取り出す）
  { l: ["Fe2O3", "Al"], r: ["Al2O3", "Fe"], cat: "還元" },
  { l: ["Fe3O4", "Al"], r: ["Al2O3", "Fe"], cat: "還元" },
  { l: ["Cr2O3", "Al"], r: ["Al2O3", "Cr"], cat: "還元" },
  { l: ["MnO2", "Al"], r: ["Al2O3", "Mn"], cat: "還元" },
  { l: ["CuO", "Al"], r: ["Al2O3", "Cu"], cat: "還元" },

  /* --- 加熱による分解（気体が発生する）--- */
  { l: ["KClO3"], r: ["KCl", "O2"], cat: "分解" }, // 酸素の発生（定番）
  { l: ["KMnO4"], r: ["K2MnO4", "MnO2", "O2"], cat: "分解" },
  { l: ["NaNO3"], r: ["NaNO2", "O2"], cat: "分解" },
  { l: ["NaN3"], r: ["Na", "N2"], cat: "分解" }, // エアバッグ
  { l: ["NH4NO3"], r: ["N2O", "H2O"], cat: "分解" },
  { l: ["(NH4)2Cr2O7"], r: ["N2", "Cr2O3", "H2O"], cat: "分解" },
  { l: ["NH4Cl", "Ca(OH)2"], r: ["CaCl2", "NH3", "H2O"], cat: "気体の発生" }, // アンモニアの発生

  /* --- 金属と水 --- */
  { l: ["Na", "H2O"], r: ["NaOH", "H2"], cat: "気体の発生" },
  { l: ["K", "H2O"], r: ["KOH", "H2"], cat: "気体の発生" },
  { l: ["Ca", "H2O"], r: ["Ca(OH)2", "H2"], cat: "気体の発生" },
  { l: ["Mg", "H2O"], r: ["Mg(OH)2", "H2"], cat: "気体の発生" },
  { l: ["Fe", "H2O"], r: ["Fe3O4", "H2"], cat: "気体の発生" }, // 高温の水蒸気と鉄

  /* --- 工業的製法・気体の化学（高校範囲）--- */
  { l: ["NH3", "O2"], r: ["NO", "H2O"], cat: "工業" }, // オストワルト法
  { l: ["NO", "O2"], r: ["NO2"], cat: "工業" },
  { l: ["NO2", "H2O"], r: ["HNO3", "NO"], cat: "工業" },
  { l: ["SO2", "O2"], r: ["SO3"], cat: "工業" }, // 接触法
  { l: ["N2", "O2"], r: ["NO"], cat: "工業" },
  { l: ["CH4", "H2O"], r: ["CO", "H2"], cat: "工業" }, // 水蒸気改質
  { l: ["CO", "H2O"], r: ["CO2", "H2"], cat: "工業" },
  { l: ["C", "H2O"], r: ["CO", "H2"], cat: "工業" }, // 水性ガス
  { l: ["NaCl", "NH3", "CO2", "H2O"], r: ["NaHCO3", "NH4Cl"], cat: "工業" }, // アンモニアソーダ法
  { l: ["Cu", "H2SO4"], r: ["CuSO4", "SO2", "H2O"], cat: "工業" }, // 熱濃硫酸
  { l: ["Cu", "HNO3"], r: ["Cu(NO3)2", "NO2", "H2O"], cat: "工業" }, // 濃硝酸

  /* --- 電気分解の全体の反応 --- */
  { l: ["NaCl", "H2O"], r: ["NaOH", "H2", "Cl2"], cat: "電気分解" },
  { l: ["Al2O3"], r: ["Al", "O2"], cat: "電気分解" },

  /* --- リン・ケイ素 --- */
  { l: ["P", "O2"], r: ["P2O5"], cat: "化合" },
  { l: ["P2O5", "H2O"], r: ["H3PO4"], cat: "化合" },
  { l: ["H3PO4", "Ca(OH)2"], r: ["Ca3(PO4)2", "H2O"], cat: "中和" },
  { l: ["H3PO4", "NaOH"], r: ["Na3PO4", "H2O"], cat: "中和" },

  /* --- 生き物の化学 --- */
  { l: ["CO2", "H2O"], r: ["C6H12O6", "O2"], cat: "光合成" },
  { l: ["C6H12O6"], r: ["C2H6O", "CO2"], cat: "発酵" },

  /* --- 身のまわりの反応 --- */
  { l: ["Ca(OH)2", "CO2"], r: ["CaCO3", "H2O"], cat: "中和" }, // 石灰水がにごる
  { l: ["NaOH", "CO2"], r: ["Na2CO3", "H2O"], cat: "中和" },
  { l: ["Fe", "O2", "H2O"], r: ["Fe(OH)3"], cat: "酸化" }, // 鉄がさびる

  /* --- 大きい有機分子の燃焼 --- */
  { l: ["C10H8", "O2"], r: ["CO2", "H2O"], cat: "燃焼" }, // ナフタレン
  { l: ["C12H22O11", "O2"], r: ["CO2", "H2O"], cat: "燃焼" }, // スクロース（砂糖）
  { l: ["CH4O", "O2"], r: ["CO2", "H2O"], cat: "燃焼" }, // メタノール
  { l: ["C3H6O", "O2"], r: ["CO2", "H2O"], cat: "燃焼" }, // アセトン
  { l: ["C4H10O", "O2"], r: ["CO2", "H2O"], cat: "燃焼" },
];

// 族にきれいに収まらない、よく出る反応
var SPECIALS = [
  { l: ["Fe", "O2"], r: ["Fe3O4"], cat: "化合" },
  { l: ["H2", "O2"], r: ["H2O"], cat: "化合" },
  { l: ["N2", "H2"], r: ["NH3"], cat: "化合" },
  { l: ["Na2O", "H2O"], r: ["NaOH"], cat: "化合" },
  { l: ["K2O", "H2O"], r: ["KOH"], cat: "化合" },
  { l: ["CaO", "H2O"], r: ["Ca(OH)2"], cat: "化合" },
  { l: ["BaO", "H2O"], r: ["Ba(OH)2"], cat: "化合" },
  { l: ["CO2", "H2O"], r: ["H2CO3"], cat: "化合" },
  { l: ["SO2", "H2O"], r: ["H2SO3"], cat: "化合" },
  { l: ["SO3", "H2O"], r: ["H2SO4"], cat: "化合" },
  { l: ["S", "O2"], r: ["SO2"], cat: "燃焼" },
  { l: ["C", "O2"], r: ["CO2"], cat: "燃焼" },
  { l: ["NaHCO3"], r: ["Na2CO3", "H2O", "CO2"], cat: "分解" },
  { l: ["H2O2"], r: ["H2O", "O2"], cat: "分解" },
  { l: ["H2O"], r: ["H2", "O2"], cat: "分解" },
  { l: ["Ag2O"], r: ["Ag", "O2"], cat: "分解" },
  { l: ["NH3", "O2"], r: ["N2", "H2O"], cat: "燃焼" },
  { l: ["H2S", "O2"], r: ["SO2", "H2O"], cat: "燃焼" },
  // 還元（炭素・水素・一酸化炭素で金属を取り出す）
  { l: ["CuO", "H2"], r: ["Cu", "H2O"], cat: "還元" },
  { l: ["CuO", "C"], r: ["Cu", "CO2"], cat: "還元" },
  { l: ["CuO", "CO"], r: ["Cu", "CO2"], cat: "還元" },
  { l: ["ZnO", "C"], r: ["Zn", "CO2"], cat: "還元" },
  { l: ["PbO", "C"], r: ["Pb", "CO2"], cat: "還元" },
  { l: ["Fe2O3", "C"], r: ["Fe", "CO2"], cat: "還元" },
  { l: ["Fe3O4", "C"], r: ["Fe", "CO2"], cat: "還元" },
  { l: ["Fe2O3", "CO"], r: ["Fe", "CO2"], cat: "還元" },
  { l: ["Fe3O4", "CO"], r: ["Fe", "CO2"], cat: "還元" },
  { l: ["Fe2O3", "H2"], r: ["Fe", "H2O"], cat: "還元" },
];

/* ================= カタログの組み立て ================= */

// 係数がこれを超える反応式は出さない（テンキーは2桁まで）
var MAX_COEFF = 25;

/**
 * 目算法（原子を順に数えるやり方）で解けるかを判定する。
 *
 * 「ある元素について、係数がまだ決まっていない物質が1つしか残っていない」なら、
 * その係数はその場で確定できる。これを繰り返して全部決まれば目算法で解ける。
 * どこかで詰まる反応は、未定係数法（連立方程式）か酸化数の知識が必要になる。
 *
 * 例：Cu + 4HNO3 → Cu(NO3)2 + 2NO2 + 2H2O は、窒素が硝酸イオンと二酸化窒素の
 * 2つに分かれるため、どの元素を見ても未知数が2つ以上残って詰まる。
 * 中学生には手が出ないので、こうした反応は出題しない。
 */
function solvableByInspection(left, right, coeffs) {
  var species = left.concat(right);
  var i, j;
  var sign = [];
  var atoms = [];
  var elements = [];
  for (i = 0; i < species.length; i++) {
    sign.push(i < left.length ? 1 : -1);
    var a = parseFormula(species[i]);
    atoms.push(a);
    for (var el in a) {
      if (Object.prototype.hasOwnProperty.call(a, el) && elements.indexOf(el) < 0) {
        elements.push(el);
      }
    }
  }
  // どの物質から数え始めても解けないなら、目算法では解けない
  for (var start = 0; start < species.length; start++) {
    var c = [];
    for (i = 0; i < species.length; i++) c.push(null);
    c[start] = coeffs[start];
    var progress = true;
    while (progress) {
      progress = false;
      for (j = 0; j < elements.length; j++) {
        var e = elements[j];
        var idx = [];
        for (i = 0; i < species.length; i++) if (atoms[i][e]) idx.push(i);
        var unknown = [];
        for (i = 0; i < idx.length; i++) if (c[idx[i]] === null) unknown.push(idx[i]);
        if (unknown.length !== 1) continue;
        var u = unknown[0];
        var sum = 0;
        for (i = 0; i < idx.length; i++) {
          if (idx[i] !== u) sum += atoms[idx[i]][e] * sign[idx[i]] * c[idx[i]];
        }
        c[u] = -sum / (atoms[u][e] * sign[u]);
        progress = true;
      }
    }
    var done = true;
    for (i = 0; i < c.length; i++) if (c[i] === null) done = false;
    if (done) return true;
  }
  return false;
}

/**
 * 反応式を1つ作る。
 *
 * kind は「頭の使い方」の分類：
 *  - "valence" … イオンの価数が分かれば係数まで決まってしまうもの
 *                （中和・炭酸塩＋酸・金属＋非金属 など）
 *  - "count"   … 原子を順に数えないと係数が出ないもの
 *                （燃焼・還元・焙焼 など）
 *
 * layer（難度）は「係数の余剰」＝係数の合計−物質数から自動で決める。
 * 1 以外の係数をどれだけ書くことになるかの目安で、体感の難しさによく合う。
 * 価数で決まるものは、係数が大きくても手は動かないので層2どまりにする。
 */
function makeEq(id, cat, kind, l, r) {
  var b = balance(l, r);
  if (!b) return null;
  var i;
  for (i = 0; i < b.left.length; i++) if (b.left[i] > MAX_COEFF) return null;
  for (i = 0; i < b.right.length; i++) if (b.right[i] > MAX_COEFF) return null;
  // 目算法で解けない反応（酸化還元で元素が2手に分かれるものなど）は出さない
  if (!solvableByInspection(l, r, b.left.concat(b.right))) return null;
  var left = [];
  var right = [];
  var sum = 0;
  for (i = 0; i < l.length; i++) {
    left.push({ coeff: b.left[i], formula: l[i] });
    sum += b.left[i];
  }
  for (i = 0; i < r.length; i++) {
    right.push({ coeff: b.right[i], formula: r[i] });
    sum += b.right[i];
  }
  var excess = sum - (l.length + r.length);
  var layer;
  if (kind === "valence") {
    layer = excess <= 1 ? 1 : 2;
  } else {
    layer = excess <= 2 ? 2 : excess <= 7 ? 3 : 4;
  }
  return {
    id: id,
    cat: cat,
    kind: kind,
    excess: excess,
    layer: layer,
    left: left,
    right: right,
  };
}

function buildCatalog() {
  var out = [];
  var i, j;
  function push(eq) {
    if (eq) out.push(eq);
  }

  // 化合：金属 + 非金属単体
  for (i = 0; i < COMBINE.length; i++) {
    var fam = COMBINE[i];
    for (j = 0; j < fam.metals.length; j++) {
      var cat = CATIONS[fam.metals[j]];
      push(
        makeEq(
          "cb_" + fam.sub + "_" + fam.metals[j],
          "化合",
          "valence",
          [cat.f, fam.sub],
          [saltFormula(cat, fam.an)]
        )
      );
    }
  }

  // 分解：炭酸塩 → 酸化物 + 二酸化炭素
  for (i = 0; i < DECOMP_CARBONATE.length; i++) {
    var dc = CATIONS[DECOMP_CARBONATE[i]];
    push(
      makeEq(
        "dcc_" + DECOMP_CARBONATE[i],
        "分解",
        "valence",
        [saltFormula(dc, ANIONS.CO3)],
        [saltFormula(dc, ANIONS.O), "CO2"]
      )
    );
  }
  // 分解：水酸化物 → 酸化物 + 水
  for (i = 0; i < DECOMP_HYDROXIDE.length; i++) {
    var dh = CATIONS[DECOMP_HYDROXIDE[i]];
    push(
      makeEq(
        "dch_" + DECOMP_HYDROXIDE[i],
        "分解",
        "valence",
        [hydroxideFormula(dh)],
        [saltFormula(dh, ANIONS.O), "H2O"]
      )
    );
  }

  // 中和：酸 + 塩基 → 塩 + 水
  for (i = 0; i < ACIDS_ALL.length; i++) {
    var an = ANIONS[ACIDS_ALL[i]];
    for (j = 0; j < BASE_CATIONS.length; j++) {
      var bc = CATIONS[BASE_CATIONS[j]];
      push(
        makeEq(
          "nt_" + ACIDS_ALL[i] + "_" + BASE_CATIONS[j],
          "中和",
          "valence",
          [an.acid, hydroxideFormula(bc)],
          [saltFormula(bc, an), "H2O"]
        )
      );
    }
  }

  // 金属酸化物 + 酸 → 塩 + 水
  for (i = 0; i < ACIDS_STRONGISH.length; i++) {
    var an2 = ANIONS[ACIDS_STRONGISH[i]];
    for (j = 0; j < OXIDE_CATIONS.length; j++) {
      var oc = CATIONS[OXIDE_CATIONS[j]];
      push(
        makeEq(
          "ox_" + ACIDS_STRONGISH[i] + "_" + OXIDE_CATIONS[j],
          "酸化物と酸",
          "valence",
          [saltFormula(oc, ANIONS.O), an2.acid],
          [saltFormula(oc, an2), "H2O"]
        )
      );
    }
  }

  // 炭酸塩 + 酸 → 塩 + 水 + 二酸化炭素（生成物が3つ）
  for (i = 0; i < ACIDS_STRONGISH.length; i++) {
    var an3 = ANIONS[ACIDS_STRONGISH[i]];
    for (j = 0; j < CARBONATE_CATIONS.length; j++) {
      var cc2 = CATIONS[CARBONATE_CATIONS[j]];
      push(
        makeEq(
          "cbn_" + ACIDS_STRONGISH[i] + "_" + CARBONATE_CATIONS[j],
          "気体の発生",
          "valence",
          [saltFormula(cc2, ANIONS.CO3), an3.acid],
          [saltFormula(cc2, an3), "H2O", "CO2"]
        )
      );
    }
  }

  // 金属 + 酸 → 塩 + 水素
  for (i = 0; i < ACTIVE_METALS.length; i++) {
    var am = CATIONS[ACTIVE_METALS[i]];
    var acidKeys = ["Cl", "Br", "SO4"];
    for (j = 0; j < acidKeys.length; j++) {
      var an4 = ANIONS[acidKeys[j]];
      push(
        makeEq(
          "ma_" + ACTIVE_METALS[i] + "_" + acidKeys[j],
          "気体の発生",
          "valence",
          [am.f, an4.acid],
          [saltFormula(am, an4), "H2"]
        )
      );
    }
  }

  // 有機物の燃焼（係数が2桁になる）
  for (i = 0; i < BURNABLES.length; i++) {
    push(
      makeEq("bn_" + BURNABLES[i].f, "燃焼", "count", [BURNABLES[i].f, "O2"], ["CO2", "H2O"])
    );
  }

  // 不完全燃焼（酸素が足りないとき）
  for (i = 0; i < COUNTING.length; i++) {
    var ic = COUNTING[i];
    push(makeEq("ic_" + ic[0], "不完全燃焼", "count", [ic[0], ic[1]], [ic[2], ic[3]]));
  }

  // 数えて求める系の反応
  for (i = 0; i < EXTRA.length; i++) {
    var ex = EXTRA[i];
    push(makeEq("ex_" + i, ex.cat, "count", ex.l, ex.r));
  }

  // 個別に持っている反応
  for (i = 0; i < SPECIALS.length; i++) {
    var sp = SPECIALS[i];
    push(makeEq("sp_" + i, sp.cat, "count", sp.l, sp.r));
  }

  return out;
}

var CATALOG = buildCatalog();

/** 生成した反応式の一覧（validate 用） */
export function allGenerated() {
  return CATALOG;
}

/** その層ちょうどの反応式 */
function poolOfLayer(layer) {
  var pool = [];
  for (var i = 0; i < CATALOG.length; i++) {
    if (CATALOG[i].layer === layer) pool.push(CATALOG[i]);
  }
  return pool;
}

/** 深い層で出す、歯ごたえのある反応式（層3・4＝数えて求める系） */
function hardPool() {
  var pool = [];
  for (var i = 0; i < CATALOG.length; i++) {
    if (CATALOG[i].layer >= 3) pool.push(CATALOG[i]);
  }
  return pool;
}

/* 5層目以降で、軽めの反応式（層2）を混ぜる割合。
   歯ごたえのある式ばかりだと続けてプレイするのがしんどいので、
   4問に1問くらいは息抜きを入れる */
var EASY_MIX_RATE = 0.25;

/**
 * 層に対応する反応式の候補（テストと validate 用）。
 * 実際の出題は pickEquation を使うこと。
 */
export function poolForLayer(layer) {
  if (layer >= 5) return hardPool().concat(poolOfLayer(2));
  var pool = poolOfLayer(layer);
  // その層に十分な数がないときは、下の層も足す
  if (pool.length < 8) {
    for (var i = 0; i < CATALOG.length; i++) {
      if (CATALOG[i].layer <= layer && pool.indexOf(CATALOG[i]) < 0) pool.push(CATALOG[i]);
    }
  }
  return pool;
}

/** 層に応じて反応式を1つ選ぶ */
export function pickEquation(layer) {
  var pool;
  if (layer >= 5) {
    pool = Math.random() < EASY_MIX_RATE ? poolOfLayer(2) : hardPool();
  } else {
    pool = poolForLayer(layer);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
