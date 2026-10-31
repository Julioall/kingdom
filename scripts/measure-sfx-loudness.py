"""Measure SFX offline and store playback corrections without re-encoding the assets."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SFX = ROOT / 'public/assets/audio/sfx'
TARGET_LUFS = -24.0
PEAK_CEILING = -2.0
MAX_BOOST = 14.0


def measure(ffmpeg, path, repeat=False):
    command = [ffmpeg, '-hide_banner', '-nostats']
    if repeat:
        command += ['-stream_loop', '-1']
    command += ['-i', str(path)]
    if repeat:
        command += ['-t', '3']
    command += ['-af', f'loudnorm=I={TARGET_LUFS}:TP={PEAK_CEILING}:LRA=11:print_format=json', '-f', 'null', '-']
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60, check=True)
    blocks = re.findall(r'\{\s*"input_i".*?\}', result.stderr, re.S)
    if not blocks:
        raise ValueError(f'No loudness measurement for {path}')
    data = json.loads(blocks[-1])
    return float(data['input_i']), float(data['input_tp'])


def analyze(job):
    ffmpeg, sound_id, format_name, relative_path = job
    level, peak = measure(ffmpeg, SFX / relative_path)
    method = 'integrated_lufs'
    if not math.isfinite(level):
        # A single transient can be shorter than the 400 ms loudness window.
        level, repeated_peak = measure(ffmpeg, SFX / relative_path, repeat=True)
        peak = max(peak, repeated_peak)
        method = 'repeated_short_transient_lufs'
    if not math.isfinite(level) or not math.isfinite(peak):
        raise ValueError(f'Silent or unmeasurable audio: {relative_path}')
    correction = min(TARGET_LUFS - level, PEAK_CEILING - peak, MAX_BOOST)
    values = {
        'input_lufs': level,
        'input_true_peak_dbtp': peak,
        'gain_db': round(correction, 3),
        'measurement': method,
    }
    return sound_id, format_name, relative_path, values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--apply', action='store_true', help='Save correction metadata in the SFX manifest')
    args = parser.parse_args()
    manifest_path = SFX / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    jobs = [(args.ffmpeg, sound['id'], format_name, path)
            for sound in manifest['sounds'] if sound['trigger'] != 'wind_ambience'
            for format_name, path in sound['files'].items()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(analyze, jobs))
    by_id = {sound['id']: sound for sound in manifest['sounds']}
    rows = []
    for sound_id, format_name, path, values in results:
        sound = by_id[sound_id]
        sound.setdefault('normalization', {'target_lufs': TARGET_LUFS, 'formats': {}})['formats'][format_name] = values
        rows.append({'id': sound_id, 'format': format_name, 'path': path, **values,
                     'output_lufs': round(values['input_lufs'] + values['gain_db'], 3),
                     'output_true_peak_dbtp': round(values['input_true_peak_dbtp'] + values['gain_db'], 3)})
    policy = {'target_lufs': TARGET_LUFS, 'true_peak_ceiling_dbtp': PEAK_CEILING,
              'max_boost_db': MAX_BOOST, 'excluded_events': ['wind_ambience'],
              'method': 'offline_per_format_gain; original audio files preserved'}
    report = {'policy': policy, 'sounds': len({row['id'] for row in rows}), 'files': len(rows), 'measurements': rows}
    report_path = ROOT / 'reports/sfx-loudness.json'
    report_path.parent.mkdir(exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.apply:
        manifest['loudness_normalization'] = policy
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sounds': report['sounds'], 'files': len(rows),
                      'input_lufs_range': [min(r['input_lufs'] for r in rows), max(r['input_lufs'] for r in rows)],
                      'output_lufs_range': [min(r['output_lufs'] for r in rows), max(r['output_lufs'] for r in rows)],
                      'attenuated_files': sum(r['gain_db'] < 0 for r in rows),
                      'boosted_files': sum(r['gain_db'] > 0 for r in rows),
                      'report': str(report_path)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
