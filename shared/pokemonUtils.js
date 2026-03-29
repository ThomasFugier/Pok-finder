export function getPokemonGeneration(pokemonId) {
  if (pokemonId <= 151) return 1;
  if (pokemonId <= 251) return 2;
  if (pokemonId <= 386) return 3;
  if (pokemonId <= 493) return 4;
  if (pokemonId <= 649) return 5;
  if (pokemonId <= 721) return 6;
  if (pokemonId <= 809) return 7;
  if (pokemonId <= 905) return 8;
  return 9;
}

export function getPokemonPool(pokemonList, selectedGenerations = [1]) {
  const pool = pokemonList.filter((pokemon) => selectedGenerations.includes(getPokemonGeneration(pokemon.id)));
  return pool.length ? pool : pokemonList;
}

export function pickRandomPokemon(pokemonList, selectedGenerations = [1], usedPokemonIds = []) {
  const pool = getPokemonPool(pokemonList, selectedGenerations);
  const usedSet = new Set(usedPokemonIds);
  const available = pool.filter((pokemon) => !usedSet.has(pokemon.id));
  const source = available.length ? available : pool;
  return source[Math.floor(Math.random() * source.length)];
}
