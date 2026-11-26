# Hero billboard prompts (GPT / Midjourney)

The big downtown ads: tower billboards (15–50 m up) and the tall campaigns on tower shafts
(30–70 m). Fashion and luxury, high quality (human review 2026-11-24). Everything else stays on
local Z-Image (docs/ADVERTISING.md).

## What to make

- **8 fictional brands** (below), **two images each**:
  - **wide**, 16:10, for the tower billboards.
  - **tall**, 1:3, for the shaft campaigns. The top of it also becomes the 2:3 video-screen crop.
- **No text, letters, logos or watermarks in the image.** I typeset each brand's wordmark at pack
  time, so names are always spelled right and every brand uses the same font everywhere.
- **Leave room for the wordmark:**
  - wide: keep the right third calm (dark or soft background, no detail);
  - tall: keep the top quarter calm.
- **Resolution:** as large as the tool allows. In Midjourney, use Upscale (2x). The atlas packs
  the long edge at about 2048 px.
- **Which tool:** Midjourney does 1:3 natively, so use it for the tall images. GPT's tallest
  shape is 2:3 (1024×1536); cropped to 1:3 it keeps only half its width, so for tall images use
  GPT only if it can make 1:3. Either works for wide; GPT 3:2 (1536×1024) is fine, since I crop
  it to 16:10.
- **No real people:** no recognisable celebrities or real brands. All models are anonymous.
- **Delivery:** save as `art/external/hero-ads/<brand>.wide.png` and `<brand>.tall.png`, using the
  ids below. One good take per image is enough; send a second if you can't choose.

## Shared style

Paste this at the end of every prompt:

> high-end fashion advertising campaign photograph, editorial, shot on medium format, cinematic
> lighting, rich deep colour, luxurious, minimal and elegant composition, sharp focus, ultra
> detailed, no text, no letters, no logo, no watermark

Midjourney parameters: wide `--ar 16:10 --style raw --no text, letters, logo, watermark, frame`;
tall `--ar 1:3 --style raw --no text, letters, logo, watermark, frame`.

## The brands

### 1. `vellard`: MAISON VELLARD (Paris couture)
- **wide:** A tall model in a sculptural black silk evening gown with a dramatic train stands in
  a dim marble hall, one shaft of warm light from a high window. She is in the left two thirds,
  and the right third is dark marble in shadow.
- **tall:** The same black silk couture gown, full length, the model walking slowly toward the
  camera down a dark marble staircase. Warm rim light; the top quarter is dark shadow.

### 2. `aureline`: AURELINE (fine jewellery)
- **wide:** Close-up of a woman's neck and collarbone wearing a delicate diamond and platinum
  necklace, black velvet background, a single soft spotlight making the diamonds sparkle. The
  subject is left of centre; the right third is pure black velvet.
- **tall:** A diamond drop earring and the curve of a woman's jaw and ear in profile, black
  background, glittering highlights. The top quarter is black.

### 3. `kazehana`: KAZEHANA (Tokyo designer label)
- **wide:** A young Japanese model in an oversized avant-garde charcoal wool coat with
  asymmetric layers, standing in a minimalist concrete courtyard at dusk among falling cherry
  blossom petals. Cool grey light; the right third is a plain concrete wall.
- **tall:** The same avant-garde charcoal coat, a full-length portrait in a narrow concrete
  passage, a few cherry blossom petals in the air. Soft overcast light; the top quarter is plain
  pale concrete.

### 4. `vestra`: VESTRA (leather goods)
- **wide:** A structured cognac leather handbag with gold hardware resting on a black lacquered
  table, dramatic side light, deep shadows, a reflection in the lacquer. The bag is in the left
  half; the right third is dark.
- **tall:** A woman's hand in a black leather glove holding the cognac handbag, her elegant dark
  tailored coat in the background, a low warm key light. The top quarter is dark shadow.

### 5. `lumora`: LUMORA (Swiss watches; already a city brand)
- **wide:** A luxury rose gold chronograph wristwatch with a deep blue dial, lying on dark slate
  with water droplets around it, a precise studio light, macro detail. The watch is on the left;
  the right third is dark slate.
- **tall:** The same rose gold blue-dial watch, standing upright and seen from a low angle, a
  thin beam of light across the crystal, black background. The top quarter is black.

### 6. `solenne`: SOLENNE (fragrance; already a city brand)
- **wide:** A faceted crystal perfume bottle filled with pale pink liquid, standing in shallow
  still water at blue hour, with soft pink and violet reflections. The bottle is in the left two
  thirds; the right third is calm water and sky.
- **tall:** A beauty portrait of a woman with dark hair, eyes closed, holding the crystal perfume
  bottle near her face, with soft pink light. The top quarter is soft out-of-focus pink.

### 7. `valence`: VALENCE (premium electric car)
- **wide:** A sleek low dark-graphite electric grand tourer with a thin light bar, parked on wet
  black asphalt at night with long reflections, in a minimal studio-like darkness. The car fills
  the left two thirds; the right third is dark.
- **tall:** The same graphite car, front three-quarter view from a low angle, with rain droplets
  on the bonnet and a thin light bar glowing. The top quarter is dark night sky.

### 8. `arcline`: ARCLINE (premium tech; already a city brand)
- **wide:** A slim titanium smartphone with an edge-to-edge black screen floating above a
  polished obsidian surface, a soft halo of blue light behind it, with a precise reflection. It
  sits left of centre; the right third is dark.
- **tall:** The titanium phone standing on edge, seen from a low angle, a thin line of cold blue
  light tracing its edge, black background. The top quarter is black.

## Example, assembled (Midjourney)

```
A tall model in a sculptural black silk evening gown with a dramatic train stands in a dim marble hall, one shaft of warm light from a high window. She is in the left two thirds, and the right third is dark marble in shadow, high-end fashion advertising campaign photograph, editorial, shot on medium format, cinematic lighting, rich deep colour, luxurious, minimal and elegant composition, sharp focus, ultra detailed, no text, no letters, no logo, no watermark --ar 16:10 --style raw --no text, letters, logo, watermark, frame
```

## What I do with them

1. Record the images in `art/external/manifest.json` (tool, date, prompt, the license note for
   the tool you used).
2. Overlay each wordmark on the calm area of its image, with no dark band. For these brands I'll
   add an elegant OFL serif font (e.g. Bodoni Moda or Cormorant), with your OK before
   downloading it.
3. Pack the images in their own atlas, about 2048 px on the long edge, so they stay sharp at
   tower scale.
4. Change placement: tower billboards and shafts carry only these brands, and the food, drink
   and loan brands move to the roof boards and low buildings.
5. Shots of the downtown views, then commit.
