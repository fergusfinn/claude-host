const adjectives = [
  "ancient", "bold", "calm", "daring", "eager",
  "fierce", "gentle", "hidden", "idle", "jolly",
  "keen", "lucid", "mellow", "noble", "odd",
  "plucky", "quiet", "rustic", "swift", "terse",
  "unruly", "vivid", "witty", "xenial", "young",
  "zesty", "cosmic", "dusty", "feral", "grumpy",
  "hazy", "icy", "jaunty", "kinetic", "lanky",
  "mossy", "nifty", "ornery", "pesky", "quaint",
  "roving", "stormy", "thorny", "upbeat", "vagrant",
  "wiry", "yearly", "zealous", "brazen", "cryptic",
  "dreamy", "elastic", "foggy", "gritty", "hollow",
  "ironic", "jumpy", "knotty", "lunar", "murky",
];

const nouns = [
  "anvil", "badger", "cipher", "dingo", "ember",
  "falcon", "gopher", "heron", "ibex", "jackal",
  "kettle", "lemur", "moose", "newt", "otter",
  "parrot", "quokka", "raven", "stoat", "tundra",
  "urchin", "vortex", "walrus", "xerus", "yak",
  "zephyr", "cobalt", "dagger", "forge", "glacier",
  "hutch", "ingot", "junco", "kraken", "lantern",
  "mantis", "nebula", "osprey", "pebble", "quasar",
  "riddle", "sphinx", "thorn", "umbra", "vessel",
  "wombat", "yarrow", "zenith", "beacon", "condor",
  "donkey", "ermine", "ferret", "goblet", "hermit",
  "impala", "javelin", "koala", "marmot", "narwhal",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateName(): string {
  return `${pick(adjectives)}-${pick(nouns)}`;
}
