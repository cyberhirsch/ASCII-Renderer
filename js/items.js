// Item, recipe, and tree-species definitions. Data only - the logic that
// gives, takes, crafts, and examines lives in js/game.js.
const ITEMS = {
  wood:   { name: 'wood',        desc: 'Rough-split timber.' },
  stone:  { name: 'stone',       desc: 'Fist-sized chunks of rock.' },
  lichen: { name: 'glow lichen', desc: 'Faintly luminous. Cold to the touch.' },
  fruit:  { name: 'pale fruit',  desc: 'Heavy and sweet-smelling.' },
  sap:    { name: 'pine sap',    desc: 'Sticky amber resin.' },
  axe:    { name: 'stone axe',   desc: 'Fells trees.' },
  pick:   { name: 'stone pick',  desc: 'Digs wider scoops.' },
  torch:  { name: 'torch',       desc: 'Brightens your lamp while carried.' },
};

const RECIPES = [
  { out: 'axe',   needs: { wood: 2, stone: 1 } },
  { out: 'pick',  needs: { wood: 1, stone: 2 } },
  { out: 'torch', needs: { wood: 1, lichen: 1 } },
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
