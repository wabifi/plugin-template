// The functional categories Wabifi's Plugins shelves group plugins by (CLO-794): the id a
// manifest's discovery.category carries, and the shelf's name. Copied from wabifi-plugins
// scripts/release/categories.mjs, which is the source of truth. A plugin with no category, or one
// not listed here, shows under Other; there's no "other" to write.
export const CATEGORIES = Object.freeze({
  productivity: "Productivity",
  communication: "Communication",
  "data-and-forecasts": "Data & forecasts",
  "project-management": "Project management",
  finance: "Finance",
  utilities: "Utilities",
  examples: "Examples",
});

const ids = Object.keys(CATEGORIES);

// "productivity, communication, … or examples", for messages.
export const categoryList = `${ids.slice(0, -1).join(", ")} or ${ids.at(-1)}`;

export const isCategory = (value) => typeof value === "string" && Object.hasOwn(CATEGORIES, value);
