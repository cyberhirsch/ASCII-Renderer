// Creatures and other mobile things. The city traffic is gone with the city;
// this list will hold wardens and NPCs from the creature phase onward.
// Each entry: { x, y, heading, kind, e1: [a, b, c, d] } packed as two vec4
// per entity for the GPU (kind-specific extras in e1; e1[0] is ground z).
const Entities = {
  list: [],

  init() { this.list = []; },

  update(dt, time) {
    // nothing ambient yet
  },
};
