import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ASSETS, LAYOUTS } from './manifest.gen';
import type { AssetEntry } from './types';

const base = import.meta.env.BASE_URL;
const assets: Readonly<Record<string, AssetEntry>> = ASSETS;
const layouts: Readonly<Record<string, string>> = LAYOUTS;

/** Runtime lookup for ids that come from data (layouts), which TS cannot check. */
export const getAsset = (id: string): AssetEntry | undefined => assets[id];
export const layoutUrl = (id: string): string | undefined => (layouts[id] ? base + layouts[id] : undefined);
export const hasAnyAssets = () => Object.keys(assets).length > 0;

export class AssetLoader {
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private cache = new Map<string, Promise<GLTF>>();

  load(entry: AssetEntry): Promise<GLTF> {
    let p = this.cache.get(entry.url);
    if (!p) {
      p = this.loader.loadAsync(base + entry.url);
      this.cache.set(entry.url, p);
    }
    return p;
  }
}

