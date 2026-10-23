import { defaultRehypePlugins } from "streamdown";

// Sanitize untrusted HTML before KaTeX generates its own trusted markup.
// Streamdown 1.6's default order sanitizes afterward and removes the MathML,
// classes and layout styles needed to display equations.
export const chatRehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.katex,
  defaultRehypePlugins.harden,
];
