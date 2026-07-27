const path = require("node:path");

function normalizeAsarEntry(entry) {
  return entry.replaceAll("\\", "/").replace(/^\/+/, "");
}

function toAsarLookupEntry(entry, pathApi = path) {
  return pathApi.join(...normalizeAsarEntry(entry).split("/"));
}

module.exports = {
  normalizeAsarEntry,
  toAsarLookupEntry,
};
