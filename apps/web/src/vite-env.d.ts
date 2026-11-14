/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'local' (anvil, default) or 'base-sepolia'. */
  readonly VITE_NETWORK?: string;
  /** Overrides the network's default public RPC. */
  readonly VITE_RPC_URL?: string;
}
