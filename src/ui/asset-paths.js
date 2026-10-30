const frames = new Set(['scroll', 'paper', 'stone', 'slot', 'wood-panel', 'wood-slot']);

// UI components request logical filenames; media stays organized by its use in the UI.
export function uiAssetUrl(file, extension = null) {
  const name = file.replace(/\.(png|webp)$/i, '');
  const group = ['kingdom-emblem', 'crown'].includes(name) ? 'branding'
    : name.startsWith('button-') ? 'buttons'
      : ['default', 'pointer', 'blocked'].includes(name) ? 'cursors'
        : name.startsWith('hud-') ? 'hud'
          : name.startsWith('ribbon-') ? 'ribbons'
            : name.startsWith('sword-') || name === 'selection-frame' ? 'indicators'
              : name === 'commander' ? 'icons'
                  : frames.has(name) ? 'frames' : null;
  if (!group) throw new Error('Unknown UI asset: ' + file);
  const suffix = extension || file.split('.').at(-1);
  return '/assets/ui/' + group + '/' + name + '.' + suffix;
}
