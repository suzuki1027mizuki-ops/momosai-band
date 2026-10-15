// 型の確認（npm run typecheck）用の、VJ の名前空間の型。ビルド・実行には使わない。
// まだ型を書いていない部分は any のまま。型を確かめるファイル（tsconfig.json の files）を増やすときに、ここも足していく。

/** 設定の 1 項目の決まり（src/core/schema.js） */
interface SettingSpec {
  int?: boolean;
  min?: number | (() => number);
  max?: number | (() => number);
  outside?: 'default';
  oneOf?: readonly unknown[];
  or?: unknown;
  re?: RegExp;
  trim?: boolean;
  maxLen?: number;
  fix?: (v: any, D: any) => unknown;
  ui?: string;
  fields?: Record<string, SettingSpec>;
  array?: number;
  item?: (x: unknown, i: number, D: any) => unknown;
  list?: boolean;
  map?: boolean;
  clean?: (v: any) => any;
}

interface FlashLimitConfig { maxPerSec: number; minGap: number }

interface VJNamespace {
  [name: string]: any;
  settingsSchema?: {
    schema: Record<string, SettingSpec>;
    fit(spec: SettingSpec, v: unknown, d: any, D: any): any;
    apply(D: Record<string, any>, src: Record<string, any> | null): Record<string, any>;
  };
  safety?: {
    FlashLimiter: new (cfg?: Partial<FlashLimitConfig>) => { cfg: FlashLimitConfig; times: number[]; denied: number; setLimit(n: number): void; gap(): number; allow(now: number, reserve?: number): boolean; reset(): void };
    safeFlashColor(rgb: number[]): number[];
    limitConfig(n: number): FlashLimitConfig;
    overSafe(n: number): boolean;
    SAFE: number;
  };
}

// eslint-disable-next-line no-var
declare var VJ: VJNamespace;
