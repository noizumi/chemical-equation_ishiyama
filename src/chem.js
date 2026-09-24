/**
 * 化学式ユーティリティ
 * - 化学式は ASCII 文字列で保持する（例: "H2O", "Ca(OH)2", "C6H12O6"）
 * - 添字の表示は App 側で <sub> に変換する
 * - 古い iPadOS/Safari 対策のため、Optional Chaining (?.) / Nullish Coalescing (??)
 *   などの新しい構文は使わない
 */

/**
 * 化学式をパースして原子数を数える。
 * 例: parseFormula("Ca(OH)2") => { Ca: 1, O: 2, H: 2 }
 * 対応: 元素記号 + 数字, かっこ ( ) + 数字
 */
export function parseFormula(formula) {
  var counts = {};
  var i = 0;
  var n = formula.length;

  function readNumber() {
    var start = i;
    while (i < n && formula.charCodeAt(i) >= 48 && formula.charCodeAt(i) <= 57) {
      i++;
    }
    if (start === i) return 1;
    return parseInt(formula.slice(start, i), 10);
  }

  function addCount(target, el, num) {
    if (typeof target[el] !== "number") target[el] = 0;
    target[el] += num;
  }

  function parseGroup() {
    // "(" の次から ")" までをパースして原子数マップを返す
    var local = {};
    while (i < n) {
      var ch = formula.charAt(i);
      if (ch === "(") {
        i++; // consume "("
        var inner = parseGroup();
        // ")" は parseGroup 内で消費済み
        var mult = readNumber();
        for (var key in inner) {
          if (Object.prototype.hasOwnProperty.call(inner, key)) {
            addCount(local, key, inner[key] * mult);
          }
        }
      } else if (ch === ")") {
        i++; // consume ")"
        return local;
      } else if (ch >= "A" && ch <= "Z") {
        var sym = ch;
        i++;
        while (i < n) {
          var c2 = formula.charAt(i);
          if (c2 >= "a" && c2 <= "z") {
            sym += c2;
            i++;
          } else {
            break;
          }
        }
        var num = readNumber();
        addCount(local, sym, num);
      } else {
        // 想定外の文字はスキップ（データ検証で検出する）
        i++;
      }
    }
    return local;
  }

  counts = parseGroup();
  return counts;
}

/**
 * 反応式の左右の原子数を数える。
 * side: [{ coeff: 2, formula: "H2" }, ...]
 * 戻り値: { H: 4, O: 2 } のようなマップ
 */
export function countAtoms(side, coeffs) {
  var total = {};
  for (var s = 0; s < side.length; s++) {
    var item = side[s];
    var coeff = coeffs ? coeffs[s] : item.coeff;
    var atoms = parseFormula(item.formula);
    for (var el in atoms) {
      if (Object.prototype.hasOwnProperty.call(atoms, el)) {
        if (typeof total[el] !== "number") total[el] = 0;
        total[el] += atoms[el] * coeff;
      }
    }
  }
  return total;
}

/** 2 つの原子数マップが等しいか */
export function atomsEqual(a, b) {
  var key;
  for (key in a) {
    if (Object.prototype.hasOwnProperty.call(a, key)) {
      if (a[key] !== b[key]) return false;
    }
  }
  for (key in b) {
    if (Object.prototype.hasOwnProperty.call(b, key)) {
      if (b[key] !== a[key]) return false;
    }
  }
  return true;
}

export function gcd2(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 0) {
    var t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function gcdAll(nums) {
  var g = 0;
  for (var i = 0; i < nums.length; i++) {
    g = gcd2(g, nums[i]);
  }
  return g;
}

/**
 * 係数リストで反応式がつり合うか判定する。
 * eq: { left: [{coeff, formula}], right: [{coeff, formula}] }
 * leftCoeffs / rightCoeffs: ユーザー入力の係数配列（省略時はデータの係数）
 * 戻り値: { balanced: boolean, simplest: boolean, leftAtoms, rightAtoms }
 */
export function checkBalance(eq, leftCoeffs, rightCoeffs) {
  var la = countAtoms(eq.left, leftCoeffs);
  var ra = countAtoms(eq.right, rightCoeffs);
  var balanced = atomsEqual(la, ra);
  var all = [];
  var i;
  if (leftCoeffs) {
    for (i = 0; i < leftCoeffs.length; i++) all.push(leftCoeffs[i]);
  } else {
    for (i = 0; i < eq.left.length; i++) all.push(eq.left[i].coeff);
  }
  if (rightCoeffs) {
    for (i = 0; i < rightCoeffs.length; i++) all.push(rightCoeffs[i]);
  } else {
    for (i = 0; i < eq.right.length; i++) all.push(eq.right[i].coeff);
  }
  var simplest = gcdAll(all) === 1;
  return { balanced: balanced, simplest: simplest, leftAtoms: la, rightAtoms: ra };
}

/** 反応式に登場する元素の一覧（左辺の登場順 → 右辺のみの元素） */
export function elementsInEquation(eq) {
  var seen = {};
  var list = [];
  function collect(side) {
    for (var s = 0; s < side.length; s++) {
      var atoms = parseFormula(side[s].formula);
      for (var el in atoms) {
        if (Object.prototype.hasOwnProperty.call(atoms, el) && !seen[el]) {
          seen[el] = true;
          list.push(el);
        }
      }
    }
  }
  collect(eq.left);
  collect(eq.right);
  return list;
}

/** 化学式文字列をテキスト表現（Unicode 添字）にする。検証・デバッグ用 */
var SUB_DIGITS = {
  0: "₀",
  1: "₁",
  2: "₂",
  3: "₃",
  4: "₄",
  5: "₅",
  6: "₆",
  7: "₇",
  8: "₈",
  9: "₉",
};

export function formulaToUnicode(formula) {
  var out = "";
  for (var i = 0; i < formula.length; i++) {
    var ch = formula.charAt(i);
    if (ch >= "0" && ch <= "9") {
      out += SUB_DIGITS[ch];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 反応式全体を Unicode テキストにする（係数 1 は省略） */
export function equationToUnicode(eq) {
  function sideText(side) {
    var parts = [];
    for (var i = 0; i < side.length; i++) {
      var c = side[i].coeff;
      var prefix = c === 1 ? "" : String(c);
      parts.push(prefix + formulaToUnicode(side[i].formula));
    }
    return parts.join(" + ");
  }
  return sideText(eq.left) + " → " + sideText(eq.right);
}
