const { src, dest } = require("gulp");

// Copies node/credential icons (SVG/PNG) into dist/ — n8n serves them from there.
function buildIcons() {
  return src("nodes/**/*.{png,svg}").pipe(dest("dist/nodes"));
}

exports["build:icons"] = buildIcons;
