from pathlib import Path
from collections import Counter
import importlib.util
import json
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
skill = Path('C:/Users/Julio/.codex/plugins/cache/created-by-me-remote/pixel-sprites/0.3.0/skills/pixel-analyser/scripts/analyse.py')
spec = importlib.util.spec_from_file_location('pixel_analyser', skill)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
manifest_text = (ROOT / 'src/ui/animation-manifest.js').read_text(encoding='utf-8')
manifest = json.loads(manifest_text.split('export default ', 1)[1].strip().rstrip(';'))
entries = {entry['url']: entry for entry in manifest['entries']}
paths = [
 'tiny-swords/people/blue/pawn_idle.png',
 'tiny-swords/military/blue/Warrior/Warrior_Idle.png',
 'tiny-swords/military/blue/Lancer/Lancer_Idle.png',
 'tiny-swords/sheep/sheep_idle.png',
 'tiny-swords/buildings/blue/castle.png',
 'tiny-swords/buildings/blue/house1.png',
 'tiny-swords/buildings/red/house1.png',
 'tiny-swords/buildings/yellow/house1.png',
 'tiny-swords/buildings/purple/house1.png',
 'tiny-swords/buildings/black/house1.png',
 'tiny-swords/trees/tree-1.png',
 'tiny-swords/trees/tree-3.png',
 'tiny-swords/minerals/gold-stone-1.png',
 'tiny-swords/fences/tileset-fences-1.png',
 'kingdom-autotile/Tilemap_color1.png',
 'kingdom-autotile/water-background.png',
 'kingdom-ui/paper.png',
 'kingdom-ui/wood-panel.png',
 'kingdom-ui/crest-cyan.png',
 'kingdom-ui/button-red-regular.png',
]
font_path = 'C:/Windows/Fonts/arial.ttf'
font = ImageFont.truetype(font_path, 15)
small = ImageFont.truetype(font_path, 12)
board = Image.new('RGB', (1280, 1500), '#202633')
draw = ImageDraw.Draw(board)
records = []
profiles = []
for i, relative in enumerate(paths):
    path = ROOT / 'public/assets' / relative
    im = Image.open(path).convert('RGBA')
    meta = entries.get('assets/' + relative)
    fw = meta['frameWidth'] if meta else im.width
    fh = meta['frameHeight'] if meta else im.height
    frame = im.crop((0, 0, fw, fh))
    arr = np.array(frame)
    opaque = arr[:, :, 3] == 255
    colors = Counter(tuple(map(int, rgb)) for rgb in arr[:, :, :3][opaque])
    top = [{'hex': '#%02X%02X%02X' % rgb, 'pixels': count} for rgb, count in colors.most_common(18)]
    record = {'path': relative, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              'canvas': list(im.size), 'frame': [fw, fh], 'frames': meta.get('frames') if meta else None,
              'runtime_fps': meta.get('fps') if meta else None, 'anchor': meta.get('anchor') if meta else None,
              'first_frame_alpha_bbox': frame.getbbox(), 'first_frame_unique_opaque_rgb': len(colors),
              'first_frame_partial_alpha_pixels': int(((arr[:, :, 3] > 0) & (arr[:, :, 3] < 255)).sum()),
              'top_opaque_colors': top}
    records.append(record)
    if meta and (np.array(im)[:, :, 3] == 0).any():
        profile = module.analyse(path, im.width // fw, im.height // fh)
        profile['interpretations'] = [
            {'field': 'REFERENCE_PROFILE.layout', 'value': 'manifest grid, left-to-right',
             'method': 'src/ui/animation-manifest.js and sheet inspection', 'confidence': 'high', 'evidence': meta['id']},
            {'field': 'MOTION_SIGNATURE.fps', 'value': meta.get('fps'),
             'method': 'runtime manifest, not inferred original author timing', 'confidence': 'high', 'evidence': meta['id']}
        ]
        profiles.append(profile)
    x, y = (i % 4) * 320, (i // 4) * 300
    draw.text((x+12, y+8), relative.split('/')[-1], font=font, fill='white')
    draw.text((x+12, y+29), '/'.join(relative.split('/')[:-1]), font=small, fill='#ADB8CB')
    crop = frame.crop(frame.getbbox()) if frame.getbbox() else frame
    scale = min(294/crop.width, 193/crop.height)
    if scale >= 2:
        scale = int(scale)
    size = (max(1, int(crop.width*scale)), max(1, int(crop.height*scale)))
    crop = crop.resize(size, Image.Resampling.NEAREST)
    board.paste(crop, (x+(320-size[0])//2, y+52+(193-size[1])//2), crop)
    for j, color in enumerate(top[:12]):
        draw.rectangle((x+12+j*24,y+252,x+34+j*24,y+269), fill=color['hex'])
    draw.text((x+12,y+277), f'frame {fw}x{fh} | alpha bbox {frame.getbbox()}', font=small, fill='#ADB8CB')
board.save(OUT/'asset-reference-board.png')
palette_groups = [
 ('Contorno', ['#161C2E']),
 ('Pele / tecido', ['#C8A876', '#EFE1AB', '#5E5455', '#977B6B', '#ADA081']),
 ('Madeira / alvenaria', ['#74514B', '#8D6857', '#BD8A59', '#E5BE76', '#BBAE93', '#E1DCA3']),
 ('Metal', ['#688C8A', '#9CBEAA', '#D4EDC2']),
 ('Conifera', ['#315A6D', '#2D8381', '#37AE7B', '#68D367']),
 ('Copa amarelada', ['#49655C', '#699157', '#BBBC41', '#F1D15F']),
 ('Grama / agua', ['#80AC5E', '#9BB94E', '#B8B958', '#47ABA9']),
 ('Rocha', ['#354F59', '#486F66', '#669D9D', '#8CC3C4']),
 ('Ouro', ['#AC7A58', '#CEA554', '#E9F044', '#FFFFFF']),
 ('Pergaminho', ['#C4B2AF', '#E2D0C2', '#EEE1C6']),
 ('Madeira UI', ['#53373C', '#6E4D4D', '#9B6253', '#D7B888']),
 ('Faccao azul', ['#4C5C8B', '#4795A7', '#63B7BA']),
 ('Faccao vermelha', ['#924159', '#DE5454', '#F4A47B']),
 ('Faccao amarela', ['#98694E', '#DCAA46', '#F9E279']),
 ('Faccao roxa', ['#5C547E', '#A37096', '#C88BAD']),
 ('Faccao ardosia', ['#413E52', '#54667E', '#7D95A5']),
]
palette_board = Image.new('RGB', (1100, 110 + len(palette_groups)*70), '#202633')
pd = ImageDraw.Draw(palette_board)
pd.text((24, 15), 'KINGDOM | Paleta de referencia extraida dos assets', font=font, fill='white')
pd.text((24, 42), 'Selecao por material. Rampas interpretadas; cores medidas. Familias podem usar variacoes.', font=small, fill='#ADB8CB')
export_colors = []
for i, (label, hexes) in enumerate(palette_groups):
    y = 90+i*70
    pd.text((24, y+9), label, font=font, fill='white')
    for j, color in enumerate(hexes):
        matches = [r['path'] for r in records if color in [c['hex'] for c in r['top_opaque_colors']]]
        assert matches, f'Unverified palette color: {color}'
        x = 220+j*140
        pd.rectangle((x, y, x+120, y+32), fill=color)
        pd.text((x, y+37), color, font=small, fill='white')
        if color not in [c['hex'] for c in export_colors]:
            export_colors.append({'hex': color, 'group': label, 'sources': matches})
palette_board.save(OUT/'kingdom-palette.png')
(OUT/'kingdom-palette.json').write_text(json.dumps({'scope': 'selected reference palette, not exhaustive or mandatory', 'colors': export_colors}, ensure_ascii=False, indent=2), encoding='utf-8')
gpl = ['GIMP Palette', 'Name: Kingdom reference assets', 'Columns: 6', '# Selected opaque colors; measured from current assets']
for color in export_colors:
    rgb = tuple(int(color['hex'][i:i+2], 16) for i in (1,3,5))
    gpl.append(f'{rgb[0]:3d} {rgb[1]:3d} {rgb[2]:3d}  {color["hex"]} {color["group"]}')
(OUT/'kingdom-palette.gpl').write_text('\n'.join(gpl)+'\n', encoding='utf-8')
(OUT/'asset-measurements.json').write_text(json.dumps({'scope':'20 representative files; first-frame palette uses opaque pixels only; atlas palette uses full atlas; no global palette limit inferred', 'assets':records},ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'reference-profiles.json').write_text(json.dumps(profiles,ensure_ascii=False,indent=2),encoding='utf-8')
for record in records:
    print(json.dumps({key:record[key] for key in ['path','frame','frames','first_frame_alpha_bbox','first_frame_unique_opaque_rgb','first_frame_partial_alpha_pixels','top_opaque_colors']},ensure_ascii=False))
