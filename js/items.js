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
  gem:    { name: 'gem',         desc: 'It holds the light a moment too long.' },
  axe:    { name: 'stone axe',   desc: 'Removed trees.' },
  pick:   { name: 'stone pickaxe', desc: 'Breaks stone and frees ore.' },
  shovel: { name: 'wooden shovel', desc: 'Moves soil. Useless on rock.' },
  torch:  { name: 'torch',       desc: 'Brightens your lamp while carried.' },
  lantern:{ name: 'gem lantern', desc: 'A gem in a copper cage. Bright, steady.' },
};

const RECIPES = [
  { out: 'axe',     needs: { wood: 2, stone: 1 } },
  { out: 'pick',    needs: { wood: 1, stone: 2 } },
  { out: 'shovel',  needs: { wood: 2, stone: 1 } },
  { out: 'torch',   needs: { wood: 1, lichen: 1 } },
  { out: 'lantern', needs: { gem: 1, copper: 2, wood: 1 } },
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
