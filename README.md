# ndlocr-lite-wasm

ブラウザ上で動作する日本語 OCR アプリケーションです。国立国会図書館の [NDLOCR](https://github.com/ndl-lab/ndlocr_cli) 軽量版をベースに、Pure TypeScript + WASM で実装しています。

サーバーへの画像送信は不要で、すべての処理がブラウザ内で完結します。

## 主な機能

- **画像からのテキスト抽出**: JPEG / PNG 画像をドラッグ＆ドロップまたはファイル選択で読み込み、OCR を実行
- **透視変換（台形補正）**: 斜めから撮影した文書画像を、4隅を手動で指定して長方形に補正してからOCRを実行可能
- **構造化出力**: テキストブロック・行単位で構造化された認識結果を表示
- **ブロック／行単位のコピー**: 認識結果をテキスト全体・ブロック単位・行単位でクリップボードにコピー
- **モデル選択**: standard（高精度・77MB）/ lite（軽量・50MB）の2種類から選択可能
- **モデルキャッシュ**: ダウンロード済みモデルはブラウザに自動キャッシュされ、2回目以降は通信不要
- **レスポンシブ対応**: スマートフォン（768px以下）では縦並びレイアウトに自動切り替え

## 使い方

### 1. 画像の読み込み

画像をドラッグ＆ドロップするか、クリックしてファイルを選択します。

### 2. 透視変換（任意）

画像を読み込むと編集モードに入ります。

- **左パネル**: 元画像の上に4つのハンドル（青い丸）が表示されます
- **右パネル**: 補正後のプレビューがリアルタイムで表示されます
- ハンドルをドラッグして文書の四隅に合わせてください
- 「**補正して OCR 実行**」をクリックすると、透視変換を適用してからOCRを実行します
- 「**そのまま OCR 実行**」をクリックすると、元画像のままOCRを実行します

### 3. 結果の確認

OCR完了後、検出結果（バウンディングボックス付き画像）と認識結果（テキスト／構造ビュー）が表示されます。

## 技術スタック

- **TypeScript** + **Vite**（ビルドツール）
- **ONNX Runtime Web**（WASM）によるブラウザ内推論
- **Web Worker** によるメインスレッド非ブロッキング処理
- **Canvas API** による画像処理・描画
- 外部ライブラリ不要の Pure TypeScript 透視変換エンジン

## プロジェクト構成

```
src/
├── main.ts                  # UI制御・編集モード・透視変換UI
├── config/
│   ├── model-config.ts      # モデルプリセット定義
│   ├── ndl-classes.ts       # 検出クラス定義
│   └── charset.ts           # 文字セット定義
├── engine/
│   ├── perspective.ts       # 透視変換（ホモグラフィ・バイリニア補間）
│   ├── deim.ts              # レイアウト認識（DEIMv2）
│   ├── parseq.ts            # 文字列認識（PARSeq）
│   ├── image-utils.ts       # 画像処理ユーティリティ
│   └── tensor-utils.ts      # テンソル操作
├── parser/
│   └── ndl-parser.ts        # 検出結果→構造化ツリー変換
├── reading-order/
│   ├── xy-cut.ts            # XYカットによる読み順整序
│   ├── reorder.ts           # 読み順並び替え
│   ├── smooth-order.ts      # 読み順平滑化
│   ├── eval.ts              # 読み順評価
│   └── warichu.ts           # 割注処理
├── storage/
│   └── model-cache.ts       # IndexedDBモデルキャッシュ
└── worker/
    └── ocr.worker.ts        # OCRパイプライン（Web Worker）
```

## 開発

```bash
# 依存パッケージのインストール
npm install

# 開発サーバーの起動
npm run dev

# プロダクションビルド
npm run build

# ビルド結果のプレビュー
npm run preview
```

## 技術情報

レイアウト認識には DEIMv2、文字列認識には PARSeq を使用しています。読み順整序については [NDLOCR](https://github.com/ndl-lab/ndlocr_cli) と同様のアルゴリズムを採用しています。

- DEIMv2: Shihua Huang et al. "Real-Time Object Detection Meets DINOv3." arXiv:2509.20787, 2025.
- PARSeq: Darwin Bautista, Rowel Atienza. "Scene text recognition with permuted autoregressive sequence models." arXiv:2207.06966, 2022.

## ライセンス

[LICENCE](./LICENCE) をご覧ください。
