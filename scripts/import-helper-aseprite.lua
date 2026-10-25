-- Assemble existing RGBA frames in a native editable Aseprite document.
-- Run with: aseprite --batch --script-param root=... --script import-helper-aseprite.lua
local root = app.params['root']
assert(root and #root > 0, 'Missing root script parameter')
local output = root .. '/assets/concepts/pawn-helper-female-aseprite-v1/pawn-helper-female.aseprite'
local sprite = Sprite(192, 192, ColorMode.RGB)
local layer = sprite.layers[1]
layer.name = 'Ajudante - quadros importados'
for index = 1, 16 do
  if index > 1 then sprite:newEmptyFrame() end
  local idle = index <= 8
  local action = idle and 'idle' or 'walk'
  local sourceIndex = idle and index or index - 8
  local source = string.format('%s/assets/concepts/pawn-helper-female-%s-v1/frames/%02d.png', root, action, sourceIndex)
  local image = Image { fromFile = source }
  assert(image.width == 192 and image.height == 192, 'Unexpected frame dimensions')
  sprite:newCel(layer, sprite.frames[index], image, Point(0, 0))
  sprite.frames[index].duration = idle and 0.2 or 0.1
end
sprite:saveAs(output)
print('Imported 16 frames into ' .. output)
