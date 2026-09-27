# Midjourney prompts for signs and ads

What the city needs most (the current set skews cyan/magenta; the style bible wants warm
practical light with neon as an accent). Drop results into `art/external/textures/small-ads/`
(same folders by aspect) or `ads-v2/`, then run `python3 tools/textures/import_ads.py`.

Keep for every image: near-black background, no real brands or logos, no frame or mockup,
no people's real names. Invented text is fine (Midjourney's gibberish reads as signage).

## 1. Warm vertical neon signs (`small-ads-1-4/`), 8–12 images — highest priority
```
vertical neon sign on a Hong Kong street, single tall narrow sign, glowing red neon tubes
forming stacked Chinese characters, dark metal box frame with rivets, pure black background,
front view, flat orthographic, no perspective, night --ar 1:4 --v 7
```
Variations: swap "red" for "amber orange", "warm white", "sodium orange"; add "one broken
flickering tube", "backlit white acrylic box with red characters", "pawn shop", "herbal
medicine", "hotel", "noodle house", "mahjong parlour", "karaoke".

## 2. Warm horizontal neon signs (`small-ads-4-1/`), 6–10 images
```
horizontal neon shop sign, Hong Kong 1990s, glowing amber and red neon tubes spelling
Chinese characters, dark metal frame, pure black background, front view, flat orthographic
--ar 4:1 --v 7
```
Variations: "backlit lightbox, cream white face with red characters", "restaurant with a
neon bowl icon", "jewelry and gold shop", "tailor".

## 3. Pictorial neon signs (`small-ads-2-3/`), 4–6 images
```
neon sign shaped like a steaming noodle bowl with chopsticks above glowing red Chinese
characters, warm amber and red tubes, black background, front view, flat --ar 2:3 --v 7
```
Icons to try: roast duck, teapot, goldfish, dice, lucky cat, herbal jar, barber pole.

## 4. Tower billboards / screen ads (`ads-v2/`, landscape 3:2 and portrait 2:3), 6–10 images
```
fictional retro-futurist billboard ad for an invented instant noodle brand, bold
condensed typography, warm red and amber palette with deep black, product hero shot,
night city advertising style, no real brand --ar 3:2 --v 7
```
Ideas: canned coffee, electric scooter, mobile network, sleep capsule hotel, mahjong app,
cooking oil, herbal tea, airline. Mix in a few portrait (--ar 2:3) for the tower screens.
