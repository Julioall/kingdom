from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(
    r"C:\Users\Julio\.codex\attachments\6b061fb0-8f2a-4381-b217-52a1a404c3a9\Texto colado.txt"
)
SOIL_REFERENCE = Path(r"C:\Users\Julio\Downloads\1_Terrains_48x48 (1).png")
GENERATED_SOIL_TEXTURE = Path(
    r"C:\Users\Julio\.codex\generated_images\01a16f45-6a60-73c3-a444-695fd9ccc1bf\exec-c8bdcb54-9124-4a97-a6eb-91554c117af6.png"
)
PALETTE_FILE = ROOT / "reports/art-direction/kingdom-palette.gpl"
OUTPUT_DIR = ROOT / "public/assets/kingdom-autotile"
GROUND_ATLAS = OUTPUT_DIR / "rice-field-ground.png"
STAGES_ATLAS = OUTPUT_DIR / "rice-growth-stages.png"
WIND_ATLAS = OUTPUT_DIR / "rice-growth-wind.png"
GROUND_PREVIEW = ROOT / "reports/art-direction/rice-field-ground-preview.png"
STAGES_PREVIEW = ROOT / "reports/art-direction/rice-growth-stages-preview.png"
WIND_PREVIEW = ROOT / "reports/art-direction/rice-growth-wind-preview.gif"
VALIDATION = ROOT / "reports/art-direction/rice-growth-animation-validation.json"

STAGE_COUNT = 4
SOURCE_FRAME_WIDTH = 48
SOURCE_HEIGHT = 75
FIELD_TILE_SIZE = 48
FRAME_SIZE = 64
PLANT_HEIGHT = 54
PLANT_Y = (FRAME_SIZE - PLANT_HEIGHT) // 2
WIND_TOP_OFFSETS = (
    0, 0.5, 1, 1.5, 2, 1.5, 1, 0.5,
    0, -0.5, -1, -1.5, -2, -1.5, -1, -0.5,
)
STAGE_WIND_SCALE = (0.8, 0.85, 0.9, 0.75)
WIND_FRAME_DURATION_MS = 50
ROOT_START_Y = 56
ROOT_BEND_HEIGHT = 48
GROUND_VARIANTS = 4
GAME_GRASS = "#80AC5E"
DARK_OUTLINE = "#53373C"
SOIL_SHADOW = "#161C2E"
SOIL_PALETTE_FALLBACK = [
    "#161C2E", "#53373C", "#6E4D4D", "#74514B", "#8D6857",
    "#AC7A58", "#BD8A59", "#E5BE76", "#DCAA46", "#F9E279",
]
SOIL_TEXTURE_PALETTE = [
    "#53373C", "#6E4D4D", "#74514B", "#8D6857",
    "#AC7A58", "#BD8A59", "#E5BE76",
]


def read_game_palette(path: Path) -> list[str]:
    colors: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) >= 4 and all(part.isdigit() for part in parts[:3]):
            red, green, blue = (int(value) for value in parts[:3])
            colors.append(f"#{red:02X}{green:02X}{blue:02X}")
    return colors or SOIL_PALETTE_FALLBACK


GAME_PALETTE = read_game_palette(PALETTE_FILE)
RED_GROWTH_COLORS = {"#924159", "#9B6253", "#DE5454", "#F4A47B"}
RICE_GROWTH_PALETTE = [color for color in GAME_PALETTE if color.upper() not in RED_GROWTH_COLORS]


def make_palette_image(colors: list[str]) -> Image.Image:
    values = [
        int(color[index:index + 2], 16)
        for color in colors
        for index in (1, 3, 5)
    ]
    values.extend(values[-3:] * ((768 - len(values)) // 3))
    palette = Image.new("P", (1, 1))
    palette.putpalette(values[:768])
    return palette


PALETTE_REFERENCE = make_palette_image(GAME_PALETTE)
RICE_PALETTE_REFERENCE = make_palette_image(RICE_GROWTH_PALETTE)


def quantize_game_palette(
    image: Image.Image, palette_reference: Image.Image = PALETTE_REFERENCE
) -> Image.Image:
    rgba = image.convert("RGBA")
    indexed = rgba.convert("RGB").quantize(
        palette=palette_reference, dither=Image.Dither.NONE
    )
    result = indexed.convert("RGB")
    result.putalpha(rgba.getchannel("A"))
    return result


def color_from_data(value: int | str) -> tuple[int, int, int, int]:
    if isinstance(value, int):
        # The pasted Uint32 pixels use little-endian RGBA image memory.
        return (value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255)
    if value == "rgba(0, 0, 0, 0)":
        return (0, 0, 0, 0)
    raise ValueError(f"Unsupported pixel color: {value!r}")


def rgba_fill(size: tuple[int, int], color: str, alpha: int = 255) -> Image.Image:
    rgba = tuple(int(color[index:index + 2], 16) for index in (1, 3, 5)) + (alpha,)
    return Image.new("RGBA", size, rgba)


def soil_row_spans(variant: int) -> list[tuple[int, int] | None]:
    # Chamfered corners and small uneven steps keep the plot square-like,
    # while avoiding long ruler-straight sides.
    profile = [
        (12, 35), (8, 39), (5, 42), (4, 43), (3, 44), (3, 44),
        (3, 44), (4, 43), (3, 44), (3, 44), (4, 43), (3, 44),
        (4, 43), (3, 44), (3, 44), (4, 43), (3, 44), (3, 44),
        (4, 43), (3, 44), (3, 44), (4, 43), (3, 44), (3, 44),
        (4, 43), (3, 44), (4, 43), (3, 44), (4, 43), (3, 44),
        (4, 43), (3, 44), (3, 44), (4, 43), (3, 44), (4, 43),
        (3, 44), (3, 44), (4, 43), (3, 44), (8, 39), (12, 35),
    ]
    left_noise = (0, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 0, 1)
    right_noise = (0, 1, 0, -1, 0, 0, -1, 0, 1, 0, 0, -1, 0)
    rows: list[tuple[int, int] | None] = [None] * FIELD_TILE_SIZE
    for row, (left, right) in enumerate(profile, start=4):
        left += left_noise[(row + variant * 3) % len(left_noise)]
        right += right_noise[(row + variant * 2) % len(right_noise)]
        rows[row] = (left, right)
    return rows


def make_plot_mask(variant: int) -> Image.Image:
    mask = Image.new("L", (FIELD_TILE_SIZE, FIELD_TILE_SIZE), 0)
    pixels = mask.load()
    for y, span in enumerate(soil_row_spans(variant)):
        if span is None:
            continue
        left, right = span
        for x in range(left, right + 1):
            pixels[x, y] = 255
    return mask


def make_soil_texture() -> Image.Image:
    source = Image.open(GENERATED_SOIL_TEXTURE).convert("RGBA")
    bounds = source.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("Generated soil texture has no visible pixels")
    left, top, right, bottom = bounds
    inset_x = max(1, round((right - left) * 0.07))
    inset_y = max(1, round((bottom - top) * 0.07))
    source = source.crop((left + inset_x, top + inset_y, right - inset_x, bottom - inset_y))
    # Re-sample to the game's small tile grid; this removes the original round
    # silhouette while retaining its soil color and chunky pixel texture.
    texture = source.resize(
        (FIELD_TILE_SIZE, FIELD_TILE_SIZE), Image.Resampling.NEAREST
    ).convert("RGB")
    red, green, blue = texture.split()
    warmer = Image.merge("RGB", (
        red.point(lambda value: min(255, value + 14)),
        green.point(lambda value: min(255, value + 7)),
        blue.point(lambda value: max(0, value - 5)),
    ))
    soil_palette = make_palette_image(SOIL_TEXTURE_PALETTE)
    indexed = warmer.quantize(palette=soil_palette, dither=Image.Dither.NONE)
    result = indexed.convert("RGB").convert("RGBA")
    result.putalpha(Image.new("L", result.size, 255))
    return result


def make_plot_tile(texture: Image.Image, variant: int) -> tuple[Image.Image, Image.Image]:
    mask = make_plot_mask(variant)
    tile = Image.new("RGBA", (FIELD_TILE_SIZE, FIELD_TILE_SIZE), (0, 0, 0, 0))

    # A subdued drop shadow peeks out along the lower and left edges.
    shadow_mask = Image.new("L", mask.size, 0)
    shadow_mask.paste(mask.crop((1, 0, FIELD_TILE_SIZE, FIELD_TILE_SIZE - 2)), (0, 2))
    shadow = rgba_fill(mask.size, SOIL_SHADOW, 92)
    shadow.putalpha(shadow_mask)
    tile.alpha_composite(shadow)

    expanded = mask.filter(ImageFilter.MaxFilter(3))
    outer_border = ImageChops.subtract(expanded, mask)
    outline = rgba_fill(mask.size, DARK_OUTLINE)
    outline.putalpha(outer_border)
    tile.alpha_composite(outline)

    soil = texture.copy()
    if variant == 1:
        soil = ImageOps.mirror(soil)
    elif variant == 2:
        soil = ImageOps.flip(soil)
    elif variant == 3:
        soil = ImageOps.mirror(ImageOps.flip(soil))
    soil.putalpha(mask)
    tile.alpha_composite(soil)

    # Raised earth catches warm light on the upper/left contour; the lower/right
    # lip stays darker so the patch reads as a small bed with depth.
    inner = mask.filter(ImageFilter.MinFilter(3))
    inner_rim = ImageChops.subtract(mask, inner)
    rim_pixels = inner_rim.load()
    tile_pixels = tile.load()
    for y in range(FIELD_TILE_SIZE):
        for x in range(FIELD_TILE_SIZE):
            if not rim_pixels[x, y]:
                continue
            if y <= 7 or x <= 7:
                color = "#BD8A59" if (x + y + variant) % 4 else "#E5BE76"
            elif y >= 39 or x >= 40:
                color = "#6E4D4D" if (x + y) % 3 else DARK_OUTLINE
            else:
                color = "#8D6857"
            tile_pixels[x, y] = tuple(
                int(color[index:index + 2], 16) for index in (1, 3, 5)
            ) + (255,)

    # Keep a one-pixel inner margin clear for the rice stalks.
    safe_mask = mask.filter(ImageFilter.MinFilter(3))
    return tile, safe_mask


data = json.loads(SOURCE.read_text(encoding="utf-8"))
pixels = data["pixels"]
min_x = min(pixel["col"] for pixel in pixels)
max_x = max(pixel["col"] for pixel in pixels)
min_y = min(pixel["row"] for pixel in pixels)
max_y = max(pixel["row"] for pixel in pixels)
if (max_x - min_x + 1, max_y - min_y + 1) != (195, 77):
    raise ValueError("Unexpected pasted pixel canvas bounds")
if len(pixels) != 195 * 77:
    raise ValueError("Expected one pixel entry for every coordinate in the pasted rectangle")

source_canvas = Image.new("RGBA", (195, 77), (0, 0, 0, 0))
for pixel in pixels:
    source_canvas.putpixel(
        (pixel["col"] - min_x, pixel["row"] - min_y),
        color_from_data(pixel["color"]),
    )

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
GROUND_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
terrain_reference = Image.open(SOIL_REFERENCE).convert("RGBA")
if terrain_reference.size != (FIELD_TILE_SIZE, FIELD_TILE_SIZE):
    raise ValueError("Expected the provided soil tile to be 48x48 pixels")
soil_texture = make_soil_texture()
ground_atlas = Image.new(
    "RGBA", (2 * FIELD_TILE_SIZE, 2 * FIELD_TILE_SIZE), (0, 0, 0, 0)
)
plot_masks: list[Image.Image] = []
safe_masks: list[Image.Image] = []
for variant in range(GROUND_VARIANTS):
    plot_tile, safe_mask = make_plot_tile(soil_texture, variant)
    ground_atlas.paste(
        plot_tile,
        ((variant % 2) * FIELD_TILE_SIZE, (variant // 2) * FIELD_TILE_SIZE),
    )
    plot_masks.append(make_plot_mask(variant))
    safe_masks.append(safe_mask)
ground_atlas.save(GROUND_ATLAS, optimize=True)


def ground_cell(variant: int) -> Image.Image:
    left = (variant % 2) * FIELD_TILE_SIZE
    top = (variant // 2) * FIELD_TILE_SIZE
    return ground_atlas.crop(
        (left, top, left + FIELD_TILE_SIZE, top + FIELD_TILE_SIZE)
    )

# The four source growth drawings are scaled together and centered in each
# 64x64 frame, leaving a consistent soil margin at every growth stage.
stage_frames: list[Image.Image] = []
source_bboxes: list[list[int] | None] = []
plant_width = round(SOURCE_FRAME_WIDTH * PLANT_HEIGHT / SOURCE_HEIGHT)
plant_x = (FRAME_SIZE - plant_width) // 2
for stage_index in range(STAGE_COUNT):
    frame_left = -min_x + stage_index * SOURCE_FRAME_WIDTH
    source_frame = source_canvas.crop(
        (frame_left, 0, frame_left + SOURCE_FRAME_WIDTH, SOURCE_HEIGHT)
    )
    alpha_bounds = source_frame.getchannel("A").getbbox()
    source_bboxes.append(list(alpha_bounds) if alpha_bounds else None)

    normalized = source_frame.resize(
        (plant_width, PLANT_HEIGHT), Image.Resampling.NEAREST
    )
    stage_tile = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    stage_tile.alpha_composite(normalized, (plant_x, PLANT_Y))

    variant_mask = safe_masks[stage_index % GROUND_VARIANTS].resize(
        (FRAME_SIZE, FRAME_SIZE), Image.Resampling.NEAREST
    )
    stage_tile.putalpha(ImageChops.multiply(stage_tile.getchannel("A"), variant_mask))
    stage_frames.append(quantize_game_palette(stage_tile, RICE_PALETTE_REFERENCE))

stages_atlas = Image.new("RGBA", (FRAME_SIZE, STAGE_COUNT * FRAME_SIZE), (0, 0, 0, 0))
for stage_index, stage in enumerate(stage_frames):
    stages_atlas.paste(stage, (0, stage_index * FRAME_SIZE))
stages_atlas.save(STAGES_ATLAS, optimize=True)


def bend_stage(stage: Image.Image, stage_index: int, frame_index: int) -> Image.Image:
    top_offset = WIND_TOP_OFFSETS[frame_index] * STAGE_WIND_SCALE[stage_index]
    source_pixels = stage.load()
    target = Image.new("RGBA", stage.size, (0, 0, 0, 0))
    target_pixels = target.load()
    for y in range(FRAME_SIZE):
        bend_strength = max(
            0.0, min(1.0, (ROOT_START_Y - y) / ROOT_BEND_HEIGHT)
        ) ** 1.25
        row_offset = round(top_offset * bend_strength)
        for x in range(FRAME_SIZE):
            destination_x = x + row_offset
            if 0 <= destination_x < FRAME_SIZE:
                target_pixels[destination_x, y] = source_pixels[x, y]
    return target


wind_frame_count = len(WIND_TOP_OFFSETS)
wind_atlas = Image.new(
    "RGBA", (wind_frame_count * FRAME_SIZE, STAGE_COUNT * FRAME_SIZE), (0, 0, 0, 0)
)
frame_hashes: list[list[str]] = []
roots_unchanged = True
for stage_index, stage in enumerate(stage_frames):
    hashes: list[str] = []
    for frame_index in range(wind_frame_count):
        frame = bend_stage(stage, stage_index, frame_index)
        hashes.append(hashlib.sha256(frame.tobytes()).hexdigest())
        wind_atlas.paste(frame, (frame_index * FRAME_SIZE, stage_index * FRAME_SIZE))
        roots_unchanged = roots_unchanged and (
            frame.crop((0, ROOT_START_Y, FRAME_SIZE, FRAME_SIZE)).tobytes()
            == stage.crop((0, ROOT_START_Y, FRAME_SIZE, FRAME_SIZE)).tobytes()
        )
    if len(set(hashes)) < 4:
        raise ValueError(f"Growth stage {stage_index + 1} does not move enough to animate")
    frame_hashes.append(hashes)
if not roots_unchanged:
    raise ValueError("Wind deformation moved the lower root band")
wind_atlas.save(WIND_ATLAS, optimize=True)

grass = rgba_fill((FIELD_TILE_SIZE, FIELD_TILE_SIZE), GAME_GRASS)
grass_pixels = grass.load()
for y in range(0, FIELD_TILE_SIZE, 6):
    for x in range((y // 6) % 2, FIELD_TILE_SIZE, 8):
        grass_pixels[x, y] = (105, 145, 87, 255)
ground_board = Image.new("RGBA", (FIELD_TILE_SIZE * 2, FIELD_TILE_SIZE * 2), (0, 0, 0, 0))
for variant in range(GROUND_VARIANTS):
    tile = grass.copy()
    soil = ground_cell(variant)
    tile.alpha_composite(soil)
    ground_board.paste(tile, ((variant % 2) * FIELD_TILE_SIZE, (variant // 2) * FIELD_TILE_SIZE))
ground_board.resize((ground_board.width * 6, ground_board.height * 6), Image.Resampling.NEAREST).save(
    GROUND_PREVIEW, optimize=True
)

# The contact sheet shows the 16 wind phases on the four separate stages,
# rendered at the in-game 48x48 tile size over each soil plot.
contact = Image.new("RGBA", (wind_frame_count * FIELD_TILE_SIZE, STAGE_COUNT * FIELD_TILE_SIZE), (0, 0, 0, 0))
for stage_index in range(STAGE_COUNT):
    ground_variant = stage_index % GROUND_VARIANTS
    soil = ground_cell(ground_variant)
    for frame_index in range(wind_frame_count):
        frame = wind_atlas.crop(
            (frame_index * FRAME_SIZE, stage_index * FRAME_SIZE,
             (frame_index + 1) * FRAME_SIZE, (stage_index + 1) * FRAME_SIZE)
        ).resize((FIELD_TILE_SIZE, FIELD_TILE_SIZE), Image.Resampling.NEAREST)
        tile = soil.copy()
        tile.alpha_composite(frame)
        contact.paste(tile, (frame_index * FIELD_TILE_SIZE, stage_index * FIELD_TILE_SIZE))
contact.resize((contact.width * 2, contact.height * 2), Image.Resampling.NEAREST).save(
    STAGES_PREVIEW, optimize=True
)

preview_frames: list[Image.Image] = []
for tick in range(wind_frame_count):
    field = Image.new("RGBA", (STAGE_COUNT * FIELD_TILE_SIZE, FIELD_TILE_SIZE), (0, 0, 0, 0))
    for stage_index in range(STAGE_COUNT):
        frame_index = (tick + stage_index * 2) % wind_frame_count
        frame = wind_atlas.crop(
            (frame_index * FRAME_SIZE, stage_index * FRAME_SIZE,
             (frame_index + 1) * FRAME_SIZE, (stage_index + 1) * FRAME_SIZE)
        ).resize((FIELD_TILE_SIZE, FIELD_TILE_SIZE), Image.Resampling.NEAREST)
        soil = ground_cell(stage_index)
        tile = grass.copy()
        tile.alpha_composite(soil)
        tile.alpha_composite(frame)
        field.paste(tile, (stage_index * FIELD_TILE_SIZE, 0))
    preview_frames.append(field.resize(
        (field.width * 4, field.height * 4), Image.Resampling.NEAREST
    ))
preview_frames[0].save(
    WIND_PREVIEW,
    save_all=True,
    append_images=preview_frames[1:],
    duration=WIND_FRAME_DURATION_MS,
    loop=0,
    disposal=2,
    optimize=False,
)

palette_rgb = {
    tuple(int(color[index:index + 2], 16) for index in (1, 3, 5))
    for color in GAME_PALETTE
}
used_ground_colors = {
    pixel[:3]
    for pixel in ground_atlas.get_flattened_data()
    if pixel[3] > 0
}
used_plant_colors = {
    pixel[:3]
    for pixel in stages_atlas.get_flattened_data()
    if pixel[3] > 0
}
if not used_ground_colors.issubset(palette_rgb):
    raise ValueError("Ground artwork contains colors outside the Kingdom palette")
if not used_plant_colors.issubset(palette_rgb):
    raise ValueError("Rice artwork contains colors outside the Kingdom palette")
red_growth_rgb = {
    tuple(int(color[index:index + 2], 16) for index in (1, 3, 5))
    for color in RED_GROWTH_COLORS
}
if used_plant_colors.intersection(red_growth_rgb):
    raise ValueError("Rice growth artwork contains an unwanted red palette color")

manifest = {
    "source_file": SOURCE.name,
    "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    "source_coordinate_bounds": {"col": [min_x, max_x], "row": [min_y, max_y]},
    "pixel_color_encoding": "uint32 decoded as little-endian RGBA; transparent rgba string preserved",
    "source_growth_frame_count": STAGE_COUNT,
    "source_growth_frame_width": SOURCE_FRAME_WIDTH,
    "source_growth_frame_height": SOURCE_HEIGHT,
    "source_growth_frame_bboxes": source_bboxes,
    "terrain_reference_file": SOIL_REFERENCE.name,
    "terrain_reference_sha256": hashlib.sha256(SOIL_REFERENCE.read_bytes()).hexdigest(),
    "generated_texture_reference": str(GENERATED_SOIL_TEXTURE),
    "palette_reference": str(PALETTE_FILE.relative_to(ROOT)).replace("\\", "/"),
    "soil_description": "near-square raised earth plot with irregular pixel-stepped edges, dark outline, subtle lower-left shadow and no plow furrows",
    "soil_tile_size": [FIELD_TILE_SIZE, FIELD_TILE_SIZE],
    "terrain_variant_count": GROUND_VARIANTS,
    "terrain_atlas": str(GROUND_ATLAS.relative_to(ROOT)).replace("\\", "/"),
    "terrain_atlas_size": list(ground_atlas.size),
    "static_growth_atlas": str(STAGES_ATLAS.relative_to(ROOT)).replace("\\", "/"),
    "static_growth_atlas_size": list(stages_atlas.size),
    "growth_frame_size": [FRAME_SIZE, FRAME_SIZE],
    "growth_frame_display_size": [FIELD_TILE_SIZE, FIELD_TILE_SIZE],
    "plant_centering": {
        "centered_in_frame": True,
        "placement": [plant_x, PLANT_Y],
        "source_art_size": [plant_width, PLANT_HEIGHT],
        "clipped_to_plot_inner_mask": True,
    },
    "wind_animation_atlas": str(WIND_ATLAS.relative_to(ROOT)).replace("\\", "/"),
    "wind_animation_atlas_size": list(wind_atlas.size),
    "wind_animation_layout": "16 columns by 4 rows; columns are eased wind phases and rows are growth stages 1 through 4",
    "wind_frame_duration_ms": WIND_FRAME_DURATION_MS,
    "wind_top_offsets_px": list(WIND_TOP_OFFSETS),
    "stage_wind_scale": list(STAGE_WIND_SCALE),
    "rice_growth_palette_excluded_colors": sorted(RED_GROWTH_COLORS),
    "root_band_start_y": ROOT_START_Y,
    "root_band_unchanged": roots_unchanged,
    "distinct_wind_frames_per_stage": [len(set(hashes)) for hashes in frame_hashes],
    "stage_thresholds": {"stage_1": "0.8 <= cropMass < 24", "stage_2": "24 <= cropMass < 50", "stage_3": "50 <= cropMass < 80", "stage_4": "cropMass >= 80"},
    "ground_preview": str(GROUND_PREVIEW.relative_to(ROOT)).replace("\\", "/"),
    "contact_sheet": str(STAGES_PREVIEW.relative_to(ROOT)).replace("\\", "/"),
    "animated_preview": str(WIND_PREVIEW.relative_to(ROOT)).replace("\\", "/"),
}
VALIDATION.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
