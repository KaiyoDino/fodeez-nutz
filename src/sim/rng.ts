/** mulberry32: tiny seeded PRNG. State is a uint32 kept in the sim state so runs replay exactly. */
export function nextRandom(state: { rng: number }): number {
  let a = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
