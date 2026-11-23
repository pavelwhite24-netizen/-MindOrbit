(function () {
  'use strict';
  const M = window.MindOrbit;
  M.data = M.data || {};

  // Original cell sets. Game-side validation rejects rotational or mirror symmetry.
  M.data.B1 = [
    [[1,0],[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[2,0],[0,1],[1,1],[2,1]],
    [[2,0],[3,0],[0,1],[1,1],[2,1]],
    [[0,0],[1,0],[2,0],[3,0],[3,1]],
    [[0,0],[1,0],[2,0],[3,0],[2,1]],
    [[1,0],[1,1],[2,1],[0,2],[1,2],[2,2]],
    [[1,0],[1,1],[0,2],[1,2],[2,2],[2,3]],
    [[0,0],[1,0],[0,1],[1,1],[2,1],[2,2]],
    [[2,0],[0,1],[1,1],[2,1],[3,1],[3,2]],
    [[2,0],[1,1],[2,1],[0,2],[1,2],[1,3]],
    [[1,0],[2,0],[1,1],[2,1],[0,2],[1,2],[2,2]],
    [[2,0],[3,0],[0,1],[1,1],[2,1],[3,1],[3,2]],
    [[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[2,2]],
    [[1,0],[2,0],[3,0],[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[2,1],[0,2],[1,2],[2,2],[0,3]]
  ].map((cells, index) => ({ id: 'rotation-' + (index + 1), cells }));

  // Original parametric polygon paths: no external images, clipping rectangles or
  // area-based masks. All use the same 100 x 100 canvas and 3-unit contour width.
  // Names/features are feedback-only; do not give a verbal answer during play.
  const outlines = [
    ['triangle', '三角形', [[50,10],[90,90],[10,90]], ['cross','crown','key'], '两条长斜边与一条水平底边'],
    ['diamond', '菱形', [[50,10],[90,50],[50,90],[10,50]], ['house','cross','boat'], '四条斜边构成上下左右四个尖角'],
    ['hexagon', '六边形', [[30,10],[70,10],[90,50],[70,90],[30,90],[10,50]], ['star','arrow','key'], '上下短水平边和两侧折角'],
    ['cross', '十字形', [[36,10],[64,10],[64,36],[90,36],[90,64],[64,64],[64,90],[36,90],[36,64],[10,64],[10,36],[36,36]], ['triangle','diamond','boat'], '四个伸出臂和直角内凹处'],
    ['bolt', '闪电形', [[55,10],[18,55],[45,55],[32,90],[82,38],[56,38],[72,10]], ['hexagon','house','cross'], '错开的两段斜向尖角与短水平折返'],
    ['crown', '皇冠形', [[10,20],[30,48],[50,10],[70,48],[90,20],[80,90],[20,90]], ['triangle','diamond','arrow'], '三个高低错落的冠尖和下方平底'],
    ['house', '房屋形', [[10,46],[50,10],[90,46],[90,90],[10,90]], ['star','bolt','diamond'], '上方尖屋顶、竖直墙面和平底'],
    ['arrow', '右箭头形', [[10,35],[55,35],[55,10],[90,50],[55,90],[55,65],[10,65]], ['boat','hexagon','crown'], '右侧尖箭头和左侧窄矩形箭杆'],
    ['boat', '梯形船身', [[10,10],[90,10],[70,90],[30,90]], ['cross','star','diamond'], '上宽下窄的两条水平边与两条斜侧边'],
    ['key', '钥匙形', [[10,10],[55,10],[55,38],[45,38],[45,62],[70,62],[70,74],[90,74],[90,90],[30,90],[30,38],[10,38]], ['triangle','hexagon','star'], '左上方宽头、细颈和右下方阶梯齿'],
    ['fish', '鱼形', [[10,10],[38,32],[62,15],[90,50],[62,85],[38,68],[10,90],[22,50]], ['house','boat','cross'], '左侧收腰鱼尾与右侧尖头鱼身'],
    ['star', '五角星形', [[50,10],[60,38],[90,40],[67,58],[75,90],[50,72],[25,90],[33,58],[10,40],[40,38]], ['key','hexagon','house'], '交替出现的五个外尖角和五个内凹角']
  ].map(([id, name, points, distractors, feature]) => ({ id, name, points, distractors, feature }));

  // Fixed length masks (dash, gap, dash, gap, dash, gap), sum exactly 100.
  // Each offset is curated data, never randomly moved at runtime. The visible
  // contour is tested against all three fixed candidates, not just answer IDs.
  const masks = [
    { level: 'low', hiddenPercent: 25, dash: [18,8,20,9,37,8] },
    { level: 'mid', hiddenPercent: 35, dash: [15,12,19,11,31,12] },
    { level: 'high', hiddenPercent: 45, dash: [12,15,16,15,27,15] }
  ];
  const offsets = [0,4,8,2,6,10,3,7,11,5,9,1];
  M.data.B2 = {
    version: '1', outlines,
    review: '原创轮廓与固定遮挡；附几何可见性检查。尚未进行独立人工或用户可辨识度验收。',
    records: outlines.flatMap((outline, index) => masks.map(mask => ({
      id: 'completion-' + outline.id + '-' + mask.level,
      baseId: outline.id,
      level: mask.level,
      hiddenPercent: mask.hiddenPercent,
      dash: mask.dash.slice(),
      offset: offsets[index],
      options: [outline.id].concat(outline.distractors),
      feature: outline.feature
    })))
  };

  // A single off-centre/notched arrow, asymmetric even across its own axis.
  // Direction, count and fill are the ONLY changing properties in C2.
  M.data.C2 = {
    motif: [[-14,-6],[3,-6],[3,-13],[16,0],[3,13],[3,5],[-14,5],[-14,0],[-8,0],[-8,-3],[-14,-3]],
    periods: { direction: 4, count: 3, filled: 2 }
  };
})();
