/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The content-hashed what-if module name in a deploy build (scripts/deploy-web.sh); unset in dev. */
  readonly VITE_WASM_FILE?: string;
}

declare const __COMMIT_SHA__: string;
declare const __BUILD_TIME__: string;
