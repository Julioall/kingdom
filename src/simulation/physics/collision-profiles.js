// Static ground-plane collision profiles for the current building sprites.
// Offsets and entry offsets are measured in map tiles relative to each structure anchor.
export const STRUCTURE_COLLISION_PROFILES = Object.freeze({
  house1: Object.freeze({ offsetX: .026011604818151568, offsetY: -.7574672774770335,
    halfWidth: .6631244940516652, halfDepth: .329480764057422, entryOffsetX: 0, entryOffsetY: -1 }),
  archery: Object.freeze({ offsetX: -.12849288336676068, offsetY: -1.1246058194876731,
    halfWidth: 1.1645569620253156, halfDepth: .5707710011507459, entryOffsetX: -1, entryOffsetY: 0 }),
  castle: Object.freeze({ offsetX: .005734064439550934, offsetY: -1.3476284596345707,
    halfWidth: 2.0939121664124904, halfDepth: .7121271803255347, entryOffsetX: 0, entryOffsetY: -1 }),
  house3: Object.freeze({ offsetX: -.006301792248230242, offsetY: -.9589255399082788,
    halfWidth: .7609939499842078, halfDepth: .4369087523817079, entryOffsetX: 0, entryOffsetY: 0 }),
  tower: Object.freeze({ offsetX: .012790093347973652, offsetY: -.8679086187055738,
    halfWidth: .6490218642117398, halfDepth: .45016408475850866, entryOffsetX: 0, entryOffsetY: -1 }),
  farmhouse: Object.freeze({ offsetX: -.013199500437451661, offsetY: -.9867591092786725,
    halfWidth: .8377445339470633, halfDepth: .49712313003452735, entryOffsetX: -1, entryOffsetY: -1 }),
  barracks: Object.freeze({ offsetX: .0037512998161304267, offsetY: -1.14064645275608,
    halfWidth: 1.209949980843973, halfDepth: .5719601113544108, entryOffsetX: 0, entryOffsetY: 0 }),
  monastery: Object.freeze({ offsetX: -.003331240270313174, offsetY: -1.424984115104067,
    halfWidth: 1.1444535233318902, halfDepth: .9476826841358381, entryOffsetX: 0, entryOffsetY: 0 }),
  house2: Object.freeze({ offsetX: .05191701529653869, offsetY: -.8196888611975197,
    halfWidth: .9252426769766231, halfDepth: .5148796083076608, entryOffsetX: -1, entryOffsetY: -1 })
});
