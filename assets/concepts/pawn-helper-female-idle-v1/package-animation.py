"""Package the generated 4x2 sheet; do not synthesize or reorder animation poses."""
from pathlib import Path
import json
import hashlib
import subprocess
import sys
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent
source = OUT / 'generated-sheet.png'
sheet = Image.open(source).convert('RGBA')
assert sheet.size == (1536, 1024), 'Inspect grid again if source changes'
strip = Image.new('RGBA', (384 * 8, 512))
for i in range(8):
    frame = sheet.crop((i % 4 * 384, i // 4 * 512, (i % 4 + 1) * 384, (i // 4 + 1) * 512))
    strip.paste(frame, (i * 384, 0))
strip.save(OUT / 'raw-horizontal.png')
normalizer = Path('C:/Users/Julio/.codex/plugins/cache/openai-curated-remote/game-studio/0.1.2/scripts/normalize_sprite_strip.py')
subprocess.run([sys.executable, str(normalizer), '--input', str(OUT/'raw-horizontal.png'),
                '--out-dir', str(OUT/'normalized-72'), '--frames', '8', '--frame-size', '72',
                '--alpha-threshold', '8'], check=True)
frames_dir = OUT/'frames'
frames_dir.mkdir(exist_ok=True)
frames = []
records = []
atlas = Image.new('RGBA', (192*8, 192))
for i in range(8):
    normalized = Image.open(OUT/'normalized-72'/f'{i+1:02d}.png').convert('RGBA')
    frame = Image.new('RGBA', (192, 192))
    # Shared bottom-center convention: bbox including contact shadow ends at y=135.
    # This is a packaging pivot, not a tracked anatomical foot landmark.
    frame.paste(normalized, (60, 63))
    frame.save(frames_dir/f'{i+1:02d}.png')
    atlas.paste(frame, (192*i, 0))
    frames.append(frame)
    records.append({'index':i,'bbox_alpha_gt_zero':frame.getbbox(),
                    'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
atlas.save(OUT/'pawn-helper-female-idle.png')
preview = []
contact = Image.new('RGB', (4*256, 2*280), '#202633')
draw = ImageDraw.Draw(contact)
for i, frame in enumerate(frames):
    # Animation previews are composited only; RGBA production frames retain their alpha.
    bg = Image.new('RGBA', (192,192), '#344D43')
    d = ImageDraw.Draw(bg)
    for y in range(0,192,16):
        for x in range(0,192,16):
            if (x//16+y//16)%2: d.rectangle((x,y,x+15,y+15),fill='#3B564A')
    bg.alpha_composite(frame)
    preview.append(bg.convert('RGB').resize((384,384),Image.Resampling.NEAREST))
    # Shared crop for inspection, not frame-wise trimming.
    enlarged = bg.crop((48,48,144,144)).resize((256,256),Image.Resampling.NEAREST)
    contact.paste(enlarged,(i%4*256,i//4*280))
    draw.text((i%4*256+10,i//4*280+260),f'Frame {i+1}',fill='white')
preview[0].save(OUT/'idle-preview.gif',save_all=True,append_images=preview[1:],duration=200,loop=0,disposal=2)
frames[0].save(OUT/'idle-preview.webp',save_all=True,append_images=frames[1:],duration=200,loop=0,lossless=True)
contact.save(OUT/'contact-sheet.png')
manifest = {'status':'experimental_preview; not integrated into game', 'animation':'idle',
            'source':'generated-sheet.png','source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'source_grid':{'columns':4,'rows':2,'cell':[384,512],'order':'row-major'},
            'frame_size':[192,192],'frames':8,'frame_duration_ms':200,'fps':5,'loop':True,
            'anchor':[96,135],'anchor_kind':'shared bottom-center of content including shadow; not anatomical feet',
            'normalization':{'shared_scale':72/393,'method':'sprite-pipeline shared scale and bottom-center; no frame-1 lock',
                             'alpha_threshold_for_bounds':8,'alpha_processing':'preserved within cropped content'},
            'sheet':'pawn-helper-female-idle.png','individual_frames':'frames/01.png ... frames/08.png',
            'previews':['idle-preview.gif','idle-preview.webp','index.html'],
            'frame_records':records,
            'limitations':['Original generated phase shapes can drift; normalization only aligns content.',
                           '8 frames and 5 FPS selected for this test, not inferred author timing.',
                           'This character is not a pixel-exact replacement for the shipped pawn.',
                           'No in-game animation manifest was modified.']}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
assert len({r['sha256'] for r in records})==8, 'Unexpected duplicate frames'
gif=Image.open(OUT/'idle-preview.gif')
assert gif.n_frames==8
assert atlas.size==(1536,192)
assert all(frame.getchannel('A').histogram()[0]>0 for frame in frames)
print(json.dumps({'frames':8,'distinct_frames':8,'gif_frames':gif.n_frames,'atlas':list(atlas.size),'bbox':[r['bbox_alpha_gt_zero'] for r in records]}))
