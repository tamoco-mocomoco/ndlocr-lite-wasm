export interface ModelConfig {
  url: string;
  inputShape: number[];
  name: string;
}

export interface ModelPreset {
  id: string;
  label: string;
  description: string;
  deim: ModelConfig;
  parseq: ModelConfig;
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "standard",
    label: "標準 (77MB)",
    description: "FP32 — 最高精度",
    deim: {
      url: `${import.meta.env.BASE_URL}models/deim-s-1024x1024.onnx`,
      inputShape: [1, 3, 800, 800],
      name: "deim-s-1024x1024.onnx",
    },
    parseq: {
      url: `${import.meta.env.BASE_URL}models/parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx`,
      inputShape: [1, 3, 16, 768],
      name: "parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx",
    },
  },
  {
    id: "lite",
    label: "軽量 (50MB)",
    description: "検出INT8 + 認識FP32 — 高速ダウンロード",
    deim: {
      url: `${import.meta.env.BASE_URL}models/deim-s-1024x1024_int8.onnx`,
      inputShape: [1, 3, 800, 800],
      name: "deim-s-1024x1024_int8.onnx",
    },
    parseq: {
      url: `${import.meta.env.BASE_URL}models/parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx`,
      inputShape: [1, 3, 16, 768],
      name: "parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx",
    },
  },
];

export const DEFAULT_PRESET_ID = "standard";

export const DET_CONF_THRESHOLD = 0.25;
export const DET_SCORE_THRESHOLD = 0.2;
