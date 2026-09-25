export interface LayoutInstance {
  asset: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
}

export interface Layout {
  name: string;
  version: number;
  seed: number;
  size: [number, number];
  blocks: { min: [number, number]; max: [number, number] }[];
  instances: LayoutInstance[];
}

export async function fetchLayout(url: string): Promise<Layout> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Layout request failed (${res.status}): ${url}`);
  return (await res.json()) as Layout;
}

// In-browser regeneration for `?seed=`. Uses the same generator modules as
// tools/build-layouts.mjs, so they must stay browser-safe (enforced at build).
const layoutDefs = import.meta.glob('/art/layouts/defs/*.json', { import: 'default' });
const layoutGenerators = import.meta.glob('/art/layouts/*.mjs');

interface LayoutDef {
  generator: string;
  seed?: number;
  params?: Record<string, unknown>;
}

interface LayoutGeneratorModule {
  generate(input: { params: Record<string, unknown>; seed: number }): Omit<Layout, 'name'>;
}

export async function generateLayout(id: string, seed: number): Promise<Layout> {
  const loadDef = layoutDefs[`/art/layouts/defs/${id}.json`];
  if (!loadDef) throw new Error(`No layout def "${id}" in art/layouts/defs/`);
  const def = (await loadDef()) as LayoutDef;
  const loadGen = layoutGenerators[`/art/layouts/${def.generator}.mjs`];
  if (!loadGen) throw new Error(`Layout generator "${def.generator}" not found in art/layouts/`);
  const mod = (await loadGen()) as LayoutGeneratorModule;
  return { name: id, ...mod.generate({ params: def.params ?? {}, seed }) };
}
