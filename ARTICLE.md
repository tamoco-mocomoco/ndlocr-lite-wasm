---
title: "ブラウザだけで完結する日本語OCR＋透視変換（台形補正）をPure TypeScriptで実装した"
emoji: "📐"
type: "tech"
topics: ["typescript", "ocr", "canvas", "wasm", "画像処理"]
published: false
---

## はじめに

これまで日本語 OCR について、サーバーサイドで動かす [yomitoku を使った Flask + TypeScript 構成](https://zenn.dev/lecto/articles/b345c7f3920ae9)や、ブラウザ上で動く [Tesseract.js でカスタムモデルをトレーニングする方法](https://zenn.dev/lecto/articles/b2a42b8fddef49)を記事にしてきました。

今回は **ブラウザ完結の日本語 OCR** をさらに一歩進めて、**斜めから撮影した文書画像を4点指定で台形補正してから OCR にかける**仕組みを Pure TypeScript で実装しました。

本アプリケーションは国立国会図書館が公開している [NDLOCR](https://github.com/ndl-lab/ndlocr_cli) の軽量版をベースにしており、レイアウト認識（DEIMv2）と文字列認識（PARSeq）の ONNX モデルを WASM で動かしています。サーバーサイドの Python 環境や GPU がなくても、**静的サイトとしてホスティングするだけで、ある程度精度の高い日本語 OCR を提供できる**のが大きな特徴です。

ただし、斜め撮影の文書をそのまま OCR にかけると認識精度がガタ落ちします。「じゃあ事前に台形補正すればいいのでは？」ということで、OpenCV などの外部ライブラリに頼らず、ホモグラフィ変換を自前で実装しています。

この記事では、以下の内容を解説します。

- 透視変換（ホモグラフィ）の数学的な仕組み
- Canvas API を使った4点インタラクションの実装
- リアルタイムプレビューのパフォーマンス戦略
- ONNX Runtime Web（WASM）による OCR パイプラインとの統合

## 全体のUXフロー

```
画像選択（ドラッグ＆ドロップ or クリック）
  ↓
編集モード（左右分割）
  左: 元画像 + 4頂点ハンドル + 四角形ライン + 暗いオーバーレイ
  右: 補正後プレビュー（リアルタイム更新）
  ↓
ユーザーが4頂点をドラッグして文書の四隅に合わせる
  → ドラッグ中: 縮小版で高速プレビュー
  → ドラッグ終了: フル解像度でプレビュー更新
  ↓
「補正して OCR 実行」 or 「そのまま OCR 実行」
  ↓
透視変換 → 補正画像を Web Worker に送信 → OCR パイプライン
```

画像を選択すると、いきなり OCR が走るのではなく、まず**編集モード**に入ります。左右に分割されたパネルで、左側で4点を操作しながら右側でリアルタイムに補正結果を確認できます。

## 技術スタック

| 役割 | 技術 |
|------|------|
| ビルド | Vite + TypeScript |
| 推論エンジン | ONNX Runtime Web（WASM バックエンド） |
| レイアウト認識 | DEIMv2（ONNX モデル） |
| 文字列認識 | PARSeq（ONNX モデル、7141文字対応） |
| 透視変換 | Pure TypeScript（外部ライブラリ不要） |
| 非同期処理 | Web Worker |
| 画像処理 | Canvas API |
| モデルキャッシュ | IndexedDB（idb-keyval） |

すべての処理がブラウザ内で完結し、サーバーへの画像送信は一切ありません。

## 透視変換の実装

ここが今回のメインテーマです。OpenCV などを使わずに、Pure TypeScript でホモグラフィ変換を実装しています。

### ホモグラフィ行列とは

4組の対応点（変換前 → 変換後）から、3x3 の射影変換行列 H を求めます。

```
[x']   [h0 h1 h2] [x]
[y'] = [h3 h4 h5] [y]
[w']   [h6 h7  1] [1]
```

変換後の座標は以下のように計算します。

```
x' = (h0*x + h1*y + h2) / (h6*x + h7*y + 1)
y' = (h3*x + h4*y + h5) / (h6*x + h7*y + 1)
```

未知数は `h0` ～ `h7` の **8個**。4点のペアから 4×2 = 8 本の方程式が立つので、ちょうど一意に解けます。

### ガウス消去法で連立方程式を解く

8x9 の拡大係数行列を構築し、部分ピボット付きガウス消去法で解きます。

```typescript
export function computeHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
  }
  const h = solveLinearSystem(A);
  return [...h, 1]; // h0..h7, h8=1
}
```

各対応点 `(x, y) → (X, Y)` から2本の式を立てています。

```
x*h0 + y*h1 + h2 - X*x*h6 - X*y*h7 = X
x*h3 + y*h4 + h5 - Y*x*h6 - Y*y*h7 = Y
```

部分ピボットは数値安定性のために重要です。ピボット列で絶対値が最大の行を選んで入れ替えてから消去を行います。

```typescript
function solveLinearSystem(A: number[][]): number[] {
  const n = 8;
  for (let col = 0; col < n; col++) {
    // 部分ピボット: 絶対値最大の行を探して入れ替え
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > maxVal) {
        maxVal = Math.abs(A[row][col]);
        maxRow = row;
      }
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];

    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-12) throw new Error("Singular matrix");

    // ピボット行を正規化
    for (let j = col; j <= n; j++) A[col][j] /= pivot;

    // 他の行から引く
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = A[row][col];
      for (let j = col; j <= n; j++) A[row][j] -= factor * A[col][j];
    }
  }
  return A.map((row) => row[n]);
}
```

### 逆変換 + バイリニア補間でピクセルマッピング

出力画像の各ピクセルに対して**逆変換行列（H⁻¹）**を適用し、元画像上の対応座標を求めます。なぜ逆変換かというと、「出力の各ピクセルが元画像のどこに対応するか」を求める方が、穴のない画像を生成できるからです。

座標が整数にならない場合は**バイリニア補間**で周囲4ピクセルから色を計算します。

```typescript
export function applyPerspective(
  srcData: ImageData,
  matrix: number[],
  outW: number,
  outH: number,
): ImageData {
  const inv = invert3x3(matrix);
  const sw = srcData.width;
  const sh = srcData.height;
  const srcPx = srcData.data;
  const out = new ImageData(outW, outH);
  const dstPx = out.data;

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      // 逆変換: 出力座標 → 元画像座標
      const w = inv[6] * dx + inv[7] * dy + inv[8];
      const sx = (inv[0] * dx + inv[1] * dy + inv[2]) / w;
      const sy = (inv[3] * dx + inv[4] * dy + inv[5]) / w;

      // バイリニア補間
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      if (x0 < 0 || y0 < 0 || x1 >= sw || y1 >= sh) {
        const di = (dy * outW + dx) * 4;
        dstPx[di + 3] = 255; // 範囲外は黒
        continue;
      }

      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      // 4近傍ピクセルの加重平均
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;

      const di = (dy * outW + dx) * 4;
      for (let c = 0; c < 3; c++) {
        dstPx[di + c] =
          srcPx[i00 + c] * w00 + srcPx[i10 + c] * w10 +
          srcPx[i01 + c] * w01 + srcPx[i11 + c] * w11;
      }
      dstPx[di + 3] = 255;
    }
  }
  return out;
}
```

この約100行で、OpenCV なしの透視変換エンジンが完成します。

## Canvas で4点インタラクションを実装する

### 描画の構成要素

元画像キャンバスには以下の要素を重ねて描画しています。

1. **元画像**
2. **暗いオーバーレイ**（選択範囲の外側を `rgba(0,0,0,0.4)` で覆う）
3. **四角形のライン**（4点を結ぶ青い線）
4. **ハンドル**（各頂点に青い丸 + 白い縁取り）

オーバーレイは Canvas の `evenodd` fill rule を使って実現しています。

```typescript
function drawSrcCanvas(): void {
  const ctx = srcCanvas.getContext("2d")!;
  const w = srcCanvas.width;
  const h = srcCanvas.height;

  // 1. 元画像
  ctx.drawImage(editImg, 0, 0);

  // 2. 暗いオーバーレイ（四角形の外側）
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);                       // 外側の矩形
  ctx.moveTo(corners[0].x, corners[0].y);      // 内側の四角形（逆回り）
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.closePath();
  ctx.fill("evenodd");  // ← ここがポイント
  ctx.restore();

  // 3. 四角形の線
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = Math.max(2, Math.round(w / 400));
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();

  // 4. ハンドル
  for (const pt of corners) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, HANDLE_RADIUS / displayScale, 0, Math.PI * 2);
    ctx.fillStyle = "#3b82f6";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 / displayScale;
    ctx.stroke();
  }
}
```

### CSS スケーリングへの対応

Canvas の内部解像度（`canvas.width`）と CSS による表示サイズは異なります。`max-width: 100%` で縮小表示されているため、マウス座標を画像座標に変換する際にスケール比を考慮する必要があります。

```typescript
let displayScale = 1;

function updateDisplayScale(): void {
  const cssWidth = srcCanvas.getBoundingClientRect().width;
  displayScale = cssWidth / srcCanvas.width;
}

function canvasToImage(e: MouseEvent | Touch): Point {
  const rect = srcCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / displayScale,
    y: (e.clientY - rect.top) / displayScale,
  };
}
```

ハンドルの描画サイズも `displayScale` で割って、CSS スケーリング後に一定のピクセルサイズで表示されるようにしています。

### マウス＆タッチ対応

ドラッグ操作はマウスとタッチの両方に対応しています。

```typescript
// マウス
srcCanvas.addEventListener("mousedown", (e) => {
  updateDisplayScale();
  const pt = canvasToImage(e);
  draggingIndex = findNearestCorner(pt);
  if (draggingIndex >= 0) isDragging = true;
});

srcCanvas.addEventListener("mousemove", (e) => {
  if (!isDragging || draggingIndex < 0) return;
  corners[draggingIndex] = /* ... */;
  drawSrcCanvas();
  updatePreview(true);  // ← 低解像度プレビュー
});

window.addEventListener("mouseup", () => {
  if (isDragging) {
    isDragging = false;
    updatePreview(false); // ← フル解像度プレビュー
  }
});

// タッチ（同様の構造、passive: false でスクロール抑制）
srcCanvas.addEventListener("touchstart", (e) => { /* ... */ }, { passive: false });
srcCanvas.addEventListener("touchmove", (e) => { /* ... */ }, { passive: false });
```

タッチイベントでは `passive: false` を指定して `e.preventDefault()` を呼び、ドラッグ中にページがスクロールしないようにしています。

## リアルタイムプレビューの工夫

透視変換はピクセルごとの計算なので、高解像度画像だと重くなります。そこで**2段階プレビュー**を採用しました。

| タイミング | 解像度 | 目的 |
|-----------|--------|------|
| ドラッグ中 | 25%（`scale = 0.25`） | 滑らかな操作感 |
| ドラッグ終了 | 100% | 正確なプレビュー |

```typescript
function updatePreview(lowRes = false): void {
  const scale = lowRes ? 0.25 : 1;
  const sw = Math.round(editImg.naturalWidth * scale);
  const sh = Math.round(editImg.naturalHeight * scale);
  const ow = Math.round(dstW * scale);
  const oh = Math.round(dstH * scale);

  // 縮小した画像データを取得
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = sw;
  tmpCanvas.height = sh;
  tmpCanvas.getContext("2d")!.drawImage(editImg, 0, 0, sw, sh);
  const srcData = tmpCtx.getImageData(0, 0, sw, sh);

  // 4点の座標もスケーリング
  const scaledCorners = corners.map(p => ({ x: p.x * scale, y: p.y * scale }));
  const scaledDst = dst.map(p => ({ x: p.x * scale, y: p.y * scale }));

  const matrix = computeHomography(scaledCorners, scaledDst);
  const result = applyPerspective(srcData, matrix, ow, oh);

  previewCanvas.width = ow;
  previewCanvas.height = oh;
  previewCanvas.getContext("2d")!.putImageData(result, 0, 0);
}
```

25% スケールならピクセル数は 1/16 になるので、十分なフレームレートでプレビューが更新されます。

## OCR パイプラインとの統合

透視変換の結果は PNG Blob に変換してから、既存の OCR パイプライン（Web Worker）にそのまま渡します。Worker 側のコード変更は一切不要です。

```typescript
// 「補正して OCR 実行」ボタン
btnCorrectOcr.addEventListener("click", async () => {
  // 1. フル解像度で透視変換
  const correctedBlob = await correctedImageToBlob();

  // 2. 検出結果の描画用に Image を作成
  const correctedUrl = URL.createObjectURL(correctedBlob);
  const correctedImg = new Image();
  correctedImg.src = correctedUrl;
  await correctedImg.decode();

  // 3. 既存の OCR パイプラインに投入
  runOcr(correctedBlob, correctedImg, correctedUrl);
});

// 「そのまま OCR 実行」ボタン
btnDirectOcr.addEventListener("click", () => {
  runOcr(editFile, editImg, editImgUrl);
});
```

OCR パイプラインの内部構成は以下の通りです。

```
画像 Blob
  → Web Worker
    → DEIM（レイアウト認識）: テキストブロック・行の位置を検出
    → NDL Parser: 検出結果を構造化ツリーに変換
    → 読み順整序: XYカットアルゴリズムで読む順番を決定
    → PARSeq（文字列認識）: 各行を切り出して文字認識
  → メインスレッド
    → 検出ボックスの描画
    → テキスト表示 / 構造ビュー表示
```

ONNX Runtime Web の WASM バックエンドを使用しているため、GPU 不要でどのブラウザでも動作します。モデルは初回ダウンロード後に IndexedDB にキャッシュされ、2回目以降は通信不要です。

## レスポンシブ対応

編集モードの2カラムレイアウトは、768px 以下で縦並びに切り替わります。

```css
#edit-section.visible {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
@media (max-width: 768px) {
  #edit-section.visible {
    grid-template-columns: 1fr;
  }
}
```

タッチイベントにも対応しているので、スマートフォンでも4点のドラッグ操作が可能です。

## プロジェクト構成

```
src/
├── main.ts                  # UI制御・編集モード・透視変換UI
├── config/
│   ├── model-config.ts      # モデル設定（standard / lite）
│   ├── ndl-classes.ts       # 検出クラス定義
│   └── charset.ts           # 認識対象の文字一覧（7141字）
├── engine/
│   ├── perspective.ts       # 透視変換（ホモグラフィ・バイリニア補間）
│   ├── deim.ts              # レイアウト認識（DEIMv2）
│   ├── parseq.ts            # 文字列認識（PARSeq）
│   ├── image-utils.ts       # 画像処理ユーティリティ
│   └── tensor-utils.ts      # テンソル操作
├── parser/
│   └── ndl-parser.ts        # 検出結果→構造化ツリー変換
├── reading-order/           # 読み順整序
└── worker/
    └── ocr.worker.ts        # OCRパイプライン（Web Worker）
```

透視変換エンジン（`perspective.ts`）は約100行で、他のモジュールへの依存は `Point` インターフェースのみです。

## まとめ

- **透視変換は Pure TypeScript で約100行**で実装可能。ガウス消去法 + 逆行列 + バイリニア補間だけ
- **2段階プレビュー**（ドラッグ中は25%、終了時はフル解像度）で操作感と画質を両立
- **Canvas の `evenodd` fill rule** で選択範囲外のオーバーレイを簡潔に実装
- **CSS スケーリングと Canvas 座標の変換**を正しく処理することが重要
- 補正結果を Blob に変換すれば、**既存の OCR パイプラインを一切変更せず**に統合できる

OpenCV.js（約8MB）を読み込むまでもなく、ホモグラフィ変換は自前で実装できるシンプルなアルゴリズムです。ブラウザの Canvas API と組み合わせれば、軽量で実用的な画像補正ツールが作れます。
