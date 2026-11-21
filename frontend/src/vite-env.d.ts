/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & {
    readonly BASE_URL: string;
    readonly MODE: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
  };
}
