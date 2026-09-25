"""GenContext: everything a generator receives. Generators must take all randomness
from ctx.rng so output is deterministic for a given def + seed."""
import random


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgb(hex_color: str):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


class GenContext:
    def __init__(self, asset_id: str, params: dict, seed: int, palette: dict):
        self.asset_id = asset_id
        self.name = asset_id.split("/")[-1]
        self.params = params
        self.seed = seed
        self.rng = random.Random(seed)
        self.palette = palette
        # JSON-serializable facts about the asset for the layout and runtime
        # (e.g. body footprint, height). Embedded in the GLB, exposed in the manifest.
        self.meta = {}

    def p(self, key, default):
        """Read a param with a default. Every tunable belongs in the def, not in code."""
        return self.params.get(key, default)

    def color(self, name: str):
        """Linear RGB for a named palette color. Unknown names are an error on purpose."""
        if name not in self.palette:
            raise KeyError(f"Color '{name}' is not in art/style/palette.json")
        return hex_to_linear_rgb(self.palette[name])

    def weighted_choice(self, weights: dict):
        names = list(weights.keys())
        return self.rng.choices(names, weights=[weights[n] for n in names], k=1)[0]
