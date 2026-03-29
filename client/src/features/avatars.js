const AVATAR_ASSETS = {
  red: {
    label: "Red",
    image: "https://play.pokemonshowdown.com/sprites/trainers/red.png"
  },
  prof_oak: {
    label: "Prof. Chen",
    image: "https://play.pokemonshowdown.com/sprites/trainers/oak.png"
  },
  misty: {
    label: "Misty",
    image: "https://play.pokemonshowdown.com/sprites/trainers/misty.png"
  },
  brock: {
    label: "Brock",
    image: "https://play.pokemonshowdown.com/sprites/trainers/brock.png"
  },
  team_rocket: {
    label: "Team Rocket",
    image: "https://play.pokemonshowdown.com/sprites/trainers/teamrocket.png"
  },
  rocket_grunt: {
    label: "Rocket Grunt",
    image: "https://play.pokemonshowdown.com/sprites/trainers/rocketgrunt.png"
  },
  giovanni: {
    label: "Giovanni",
    image: "https://play.pokemonshowdown.com/sprites/trainers/giovanni.png"
  },
  cynthia: {
    label: "Cynthia",
    image: "https://play.pokemonshowdown.com/sprites/trainers/cynthia.png"
  }
};

export const AVATARS = Object.keys(AVATAR_ASSETS);

export function getAvatarAsset(avatarId) {
  return AVATAR_ASSETS[avatarId] || AVATAR_ASSETS[AVATARS[0]];
}

export function pickRandomAvatar(excludeAvatarId) {
  const pool = AVATARS.filter((id) => id !== excludeAvatarId);
  if (!pool.length) return AVATARS[0];
  return pool[Math.floor(Math.random() * pool.length)];
}
