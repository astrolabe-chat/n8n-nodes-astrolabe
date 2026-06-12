/**
 * ESLint config for the n8n "verified community node" program.
 * The n8n-nodes-base plugin enforces the official validation rules.
 * The node UI is English-only (a verification requirement), so all casing
 * rules are kept ON.
 */
module.exports = {
  root: true,
  env: { node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { sourceType: "module", extraFileExtensions: [".json"] },
  ignorePatterns: ["dist/**", "node_modules/**", ".eslintrc.js", "gulpfile.js"],
  overrides: [
    {
      files: ["package.json"],
      plugins: ["eslint-plugin-n8n-nodes-base"],
      extends: ["plugin:n8n-nodes-base/community"],
      rules: {
        "n8n-nodes-base/community-package-json-name-still-default": "off",
      },
    },
    {
      files: ["./credentials/**/*.ts"],
      plugins: ["eslint-plugin-n8n-nodes-base"],
      extends: ["plugin:n8n-nodes-base/credentials"],
      rules: {
        // False positive: this rule tries to camelCase a full HTTPS
        // documentationUrl, which would corrupt the link. Our URL is valid.
        "n8n-nodes-base/cred-class-field-documentation-url-miscased": "off",
      },
    },
    {
      files: ["./nodes/**/*.ts"],
      plugins: ["eslint-plugin-n8n-nodes-base"],
      extends: ["plugin:n8n-nodes-base/nodes"],
    },
  ],
};
