// Item, recipe, and tree-species definitions. Data only - the logic that
// gives, takes, crafts, and examines lives in js/game.js.
const ITEMS = {
  wood:   { name: 'wood',        desc: 'Rough-split timber.' },
  stone:  { name: 'stone',       desc: 'Fist-sized chunks of rock.' },
  lichen: { name: 'glow lichen', desc: 'Faintly luminous. Cold to the touch.' },
  fruit:  { name: 'pale fruit',  desc: 'Heavy and sweet-smelling.' },
  sap:    { name: 'pine sap',    desc: 'Sticky amber resin.' },
  copper: { name: 'copper ore',  desc: 'Green-crusted, soft, warm-toned.' },
  iron:   { name: 'iron ore',    desc: 'Heavy, dull, faintly magnetic.' },
  tin:    { name: 'tin ore',     desc: 'Pale, heavy, and never where the copper is.' },
  bronze: { name: 'bronze',      desc: 'Copper and tin. Harder than either alone.' },
  gem:    { name: 'gem',         desc: 'It holds the light a moment too long.' },
  axe:    { name: 'stone axe',   desc: 'Removed trees.' },
  pick:   { name: 'stone pickaxe', desc: 'Breaks stone and frees the soft metals.' },
  bronzepick: { name: 'bronze pickaxe', desc: 'Bites iron, which stone will not.' },
  ironpick:   { name: 'iron pickaxe',   desc: 'Hard enough for the gem pockets.' },
  shovel: { name: 'wooden shovel', desc: 'Moves soil. Useless on rock.' },
  torch:  { name: 'torch',       desc: 'Brightens your lamp while carried.' },
  lantern:{ name: 'gem lantern', desc: 'A gem in a copper cage. Bright, steady.' },
};

// `n` is how many the recipe yields, defaulting to one. Smelting is the
// only thing so far that gives back more pieces than it takes names.
const RECIPES = [
  { out: 'axe',     needs: { wood: 2, stone: 1 } },
  { out: 'pick',    needs: { wood: 1, stone: 2 } },
  { out: 'shovel',  needs: { wood: 2, stone: 1 } },
  { out: 'torch',   needs: { wood: 1, lichen: 1 } },
  { out: 'lantern', needs: { gem: 1, copper: 2, wood: 1 } },
  // The alloy. Three parts copper to one of tin is roughly what the real
  // thing runs at, and the wood is the fire under it - so bronze costs a
  // journey for the tin and a woodland for the heat.
  { out: 'bronze',  n: 2, needs: { copper: 3, tin: 1, wood: 2 } },
  // A pick only bites what it is harder than, so the metals are a ladder
  // and each rung is the way up to the next: bronze is what opens iron,
  // and iron is what opens the gems the lantern wants.
  { out: 'bronzepick', needs: { bronze: 2, wood: 1 } },
  { out: 'ironpick',   needs: { iron: 3, wood: 1 } },
];

// Species index comes from the tree's placement hash - deterministic per
// tree, same on every visit. harvest: [item, count] or null.
const SPECIES = [
  { name: 'pine',      desc: 'Tall, dark, resin-streaked.',
    harvest: ['sap', 2],   chop: 3,
    hug: 'Sticky. Worth it.' },
  { name: 'bloomwood', desc: 'A broadleaf heavy with pale fruit.',
    harvest: ['fruit', 2], chop: 3,
    hug: 'The canopy rustles approvingly.' },
  { name: 'ironbark',  desc: 'Dense and dark. Dents axe blades.',
    harvest: null,         chop: 4,
    hug: 'Like hugging a wall. Solid.' },
];
