from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(
    r"C:\Users\Julio\.codex\generated_images\01a16f45-6a60-73c3-a444-695fd9ccc1bf\exec-bd1d2c93-548e-4140-ae34-b6b1d318f9b5.png"
)
SOIL_SOURCE = ROOT / "public/assets/kingdom-autotile/crop-field.png"
ATLAS = ROOT / "public/assets/kingdom-autotile/rice-field-dry.png"
PLANTS_ATLAS = ROOT / "public/assets/kingdom-autotile/rice-field-dry-plants.png"
PREVIEW = ROOT / "reports/art-direction/rice-field-dry-game-preview.png"
ATLAS_PREVIEW = ROOT / "reports/art-direction/rice-field-dry-atlas-preview.png"
WIND_PREVIEW = ROOT / "reports/art-direction/rice-field-dry-wind-preview.gif"
WIND_FRAMES_PREVIEW = ROOT / "reports/art-direction/rice-field-dry-wind-frames.png"
VALIDATION = ROOT / "reports/art-direction/rice-field-dry-validation.json"
WIND_FRAME_DURATION_MS = 100
WIND_TOP_OFFSETS_PX = (0, 1, 2, 3, 2, 0, -1, -1)
WIND_TIP_OFFSETS_PX = (0, 1, 0, -1, 1, -1, 1, 0)
WIND_ROOT_START_Y = 56
WIND_BEND_HEIGHT = 48

PALETTE = [
    "#161C2E",
    "#53373C",
    "#6E4D4D",
    "#74514B",
    "#8D6857",
    "#BD8A59",
    "#E5BE76",
    "#AC7A58",
    "#CEA554",
    "#98694E",
    "#DCAA46",
    "#F9E279",
]


def rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def palette_image() -> Image.Image:
    flat = [channel for color in PALETTE for channel in rgb(color)]
    flat.extend(list(rgb(PALETTE[-1])) * ((768 - len(flat)) // 3))
    image = Image.new("P", (1, 1))
    image.putpalette(flat)
    return image


source = Image.open(SOURCE).convert("RGBA")
if source.width != source.height or source.width < 512:
    raise ValueError(f"Unexpected generated atlas dimensions: {source.size}")

soil_atlas = Image.open(SOIL_SOURCE).convert("RGBA")
if soil_atlas.size != (128, 128):
    raise ValueError(f"Unexpected soil atlas dimensions: {soil_atlas.size}")

quadrant_w = source.width // 2
quadrant_h = source.height // 2
palette_ref = palette_image()
plants_atlas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
composite_atlas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
cell_hashes: list[str] = []
visible_plant_colors: set[tuple[int, int, int]] = set()

for row in range(2):
    for column in range(2):
        cell_index = row * 2 + column
        box = (
            column * quadrant_w,
            row * quadrant_h,
            (column + 1) * quadrant_w,
            (row + 1) * quadrant_h,
        )
        cell = source.crop(box).resize((64, 64), Image.Resampling.NEAREST)
        alpha = cell.getchannel("A")
        alpha_pixels = alpha.load()
        for y in range(64):
            for x in range(64):
                value = alpha_pixels[x, y]
                if value == 0:
                    continue
                # Keep the plant body solid; only the outer left/right edges
                # soften into the map beneath it.
                if 2 < x < 61:
                    alpha_pixels[x, y] = 255
                else:
                    alpha_pixels[x, y] = min(value, 218)

        color = cell.convert("RGB").quantize(palette=palette_ref, dither=Image.Dither.NONE).convert("RGB")
        plants = color.convert("RGBA")
        plants.putalpha(alpha)
        position = (column * 64, row * 64)
        plants_atlas.paste(plants, position)
        cell_hashes.append(hashlib.sha256(plants.tobytes()).hexdigest())
        visible_plant_colors.update(
            pixel[:3] for pixel in plants.get_flattened_data() if pixel[3] > 0
        )

        soil_cell = soil_atlas.crop((position[0], position[1], position[0] + 64, position[1] + 64))
        full_cell = Image.alpha_composite(soil_cell, plants)
        composite_atlas.paste(full_cell, position)

plants_atlas.save(PLANTS_ATLAS, optimize=True)
composite_atlas.save(ATLAS, optimize=True)

# The tree references use an eight-frame, 100 ms loop. Their top band moves
# through this pixel-snapped curve while the lower band remains fixed. Apply
# the same curve to rice with a height-weighted displacement so each stalk
# bends from its roots instead of translating as one rigid image.
frame_atlas_width = 128
animated_plants_atlas = Image.new("RGBA", (frame_atlas_width * len(WIND_TOP_OFFSETS_PX), 128), (0, 0, 0, 0))
for frame_index, top_offset in enumerate(WIND_TOP_OFFSETS_PX):
    frame_atlas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    for cell_index in range(4):
        cell_x = (cell_index % 2) * 64
        cell_y = (cell_index // 2) * 64
        plants = plants_atlas.crop((cell_x, cell_y, cell_x + 64, cell_y + 64))
        bent = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        for y in range(64):
            bend_strength = max(0.0, min(1.0, (WIND_ROOT_START_Y - y) / WIND_BEND_HEIGHT)) ** 1.25
            tip_strength = max(0.0, min(1.0, (36 - y) / 28)) ** 1.4
            tip_offset = WIND_TIP_OFFSETS_PX[frame_index]
            for left, right, side in ((0, 32, -1), (32, 64, 1)):
                row_offset = round(top_offset * bend_strength + tip_offset * tip_strength * side)
                row = plants.crop((left, y, right, y + 1))
                bent.paste(row, (left + row_offset, y))
        frame_atlas.paste(bent, (cell_x, cell_y))
    animated_plants_atlas.paste(frame_atlas, (frame_index * frame_atlas_width, 0))

animated_plants_atlas.save(PLANTS_ATLAS, optimize=True)

wind_roots_unchanged = True
wind_frame_hashes = []
wind_frames_preview = Image.new("RGBA", (len(WIND_TOP_OFFSETS_PX) * 128, 128), (0, 0, 0, 0))
for frame_index in range(len(WIND_TOP_OFFSETS_PX)):
    frame_atlas = animated_plants_atlas.crop(
        (frame_index * frame_atlas_width, 0,
         (frame_index + 1) * frame_atlas_width, animated_plants_atlas.height)
    )
    wind_frame_hashes.append(hashlib.sha256(frame_atlas.tobytes()).hexdigest())
    for cell_index in range(4):
        cell_x = (cell_index % 2) * 64
        cell_y = (cell_index // 2) * 64
        animated_cell = animated_plants_atlas.crop(
            (frame_index * frame_atlas_width + cell_x, cell_y,
             frame_index * frame_atlas_width + cell_x + 64, cell_y + 64)
        )
        base_cell = plants_atlas.crop((cell_x, cell_y, cell_x + 64, cell_y + 64))
        wind_roots_unchanged = wind_roots_unchanged and (
            animated_cell.crop((0, WIND_ROOT_START_Y, 64, 64)).tobytes()
            == base_cell.crop((0, WIND_ROOT_START_Y, 64, 64)).tobytes()
        )
        if cell_index == 0:
            soil_cell = soil_atlas.crop((0, 0, 64, 64))
            preview_tile = Image.alpha_composite(soil_cell, animated_cell)
            wind_frames_preview.paste(
                preview_tile.resize((128, 128), Image.Resampling.NEAREST),
                (frame_index * 128, 0),
            )
if not wind_roots_unchanged:
    raise ValueError("Rice wind animation moved pixels in the fixed root band")
if len(set(wind_frame_hashes)) != len(WIND_TOP_OFFSETS_PX):
    raise ValueError("Rice wind animation contains duplicate frames")
wind_frames_preview.save(WIND_FRAMES_PREVIEW, optimize=True)

composite_atlas.resize((512, 512), Image.Resampling.NEAREST).save(ATLAS_PREVIEW, optimize=True)

# Show the full composite at game scale across a 6x6 field for visual review.
game_preview = Image.new("RGBA", (768, 768))
for row in range(6):
    for column in range(6):
        tile_index = (row % 2) * 2 + (column % 2)
        tile_box = (
            (tile_index % 2) * 64,
            (tile_index // 2) * 64,
            (tile_index % 2 + 1) * 64,
            (tile_index // 2 + 1) * 64,
        )
        tile = composite_atlas.crop(tile_box).resize((128, 128), Image.Resampling.NEAREST)
        game_preview.alpha_composite(tile, (column * 128, row * 128))
game_preview.save(PREVIEW, optimize=True)

# A small animated proof of the same eight-frame wind deformation used by
# the renderer, composited over fixed tilled soil with per-tile phase offsets.
wind_frames = []
for frame_index in range(len(WIND_TOP_OFFSETS_PX)):
    field_frame = Image.new("RGBA", (192, 192))
    for row in range(3):
        for column in range(3):
            cell_index = (row % 2) * 2 + (column % 2)
            cell_x = (cell_index % 2) * 64
            cell_y = (cell_index // 2) * 64
            box = (
                cell_x,
                cell_y,
                cell_x + 64,
                cell_y + 64,
            )
            soil = soil_atlas.crop(box)
            phase_offset = (column * 3 + row * 5) % len(WIND_TOP_OFFSETS_PX)
            source_frame = (frame_index + phase_offset) % len(WIND_TOP_OFFSETS_PX)
            plants = animated_plants_atlas.crop(
                (source_frame * frame_atlas_width + cell_x, cell_y,
                 source_frame * frame_atlas_width + cell_x + 64, cell_y + 64)
            )
            tile = Image.alpha_composite(soil, plants)
            field_frame.paste(tile, (column * 64, row * 64))
    wind_frames.append(field_frame.resize((576, 576), Image.Resampling.NEAREST))
wind_frames[0].save(
    WIND_PREVIEW,
    save_all=True,
    append_images=wind_frames[1:],
    duration=WIND_FRAME_DURATION_MS,
    loop=0,
    disposal=2,
    optimize=False,
)

palette_colors = {rgb(color) for color in PALETTE}
overlay_alpha = list(plants_atlas.getchannel("A").get_flattened_data())
overlay_visible_colors = [
    pixel[:3]
    for pixel, alpha_value in zip(plants_atlas.get_flattened_data(), overlay_alpha)
    if alpha_value > 0
]
validation = {
    "source_file": SOURCE.name,
    "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    "atlas_file": str(ATLAS.relative_to(ROOT)).replace("\\", "/"),
    "animated_overlay_file": str(PLANTS_ATLAS.relative_to(ROOT)).replace("\\", "/"),
    "atlas_size": list(composite_atlas.size),
    "layout": "2x2 row-major; each static tile is 64x64",
    "format": "RGBA composite atlas over crop-field soil plus transparent rice overlay for wind animation",
    "animated_overlay_size": list(animated_plants_atlas.size),
    "animated_overlay_layout": "8 horizontal frames; each 128x128 frame contains four 64x64 variants in a 2x2 atlas",
    "plant_body_alpha": "opaque except for slight transparency on the outer lateral edges",
    "soil_center": "visible through the transparent gap between the two rice rows in every tile",
    "wind_animation": "8 pixel-snapped, height-weighted bend frames based on the tree reference loop; roots and soil remain fixed",
    "wind_reference_profile": "reports/art-direction/tree-1-reference-profile.json",
    "wind_frame_duration_ms": WIND_FRAME_DURATION_MS,
    "wind_frame_count": len(WIND_TOP_OFFSETS_PX),
    "wind_distinct_frame_count": len(set(wind_frame_hashes)),
    "wind_top_offsets_px": list(WIND_TOP_OFFSETS_PX),
    "wind_tip_offsets_px": list(WIND_TIP_OFFSETS_PX),
    "wind_root_start_y": WIND_ROOT_START_Y,
    "wind_roots_unchanged": wind_roots_unchanged,
    "wind_preview_file": str(WIND_PREVIEW.relative_to(ROOT)).replace("\\", "/"),
    "wind_frames_preview_file": str(WIND_FRAMES_PREVIEW.relative_to(ROOT)).replace("\\", "/"),
    "overlay_opaque_pixels": sum(1 for value in overlay_alpha if value == 255),
    "overlay_semi_transparent_pixels": sum(1 for value in overlay_alpha if 0 < value < 255),
    "overlay_transparent_pixels": sum(1 for value in overlay_alpha if value == 0),
    "overlay_unique_colors": len(visible_plant_colors),
    "overlay_colors_all_in_kingdom_palette": all(color in palette_colors for color in overlay_visible_colors),
    "unique_cell_variations": len(set(cell_hashes)),
    "cell_sha256": cell_hashes,
    "manual_visual_review": "composite and eight-frame contact sheet confirm tall rice, visible center soil, low root earth, lateral transparency, and canopy-led motion; pixel checks confirm the bottom eight rows are unchanged; live motion still needs confirmation on a mature crop in the game",
}
VALIDATION.write_text(json.dumps(validation, indent=2) + "\n", encoding="utf-8")
