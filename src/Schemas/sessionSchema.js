// shape of a session in the Map
const createSessionShape = () => ({
  clients:     new Set(),
  breakpoints: [],
  variables:   {},
});

module.exports = { createSessionShape };