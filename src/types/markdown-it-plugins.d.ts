// Ambient declarations for the six markdown-it plugins this extension registers.
//
// None of them ships types, and only markdown-it-footnote has a DefinitelyTyped
// package at all — pinned at v3 while the installed runtime is v4, which is the
// same types-vs-runtime drift that `@types/vscode: ~1.134.0` exists to prevent.
// So the shapes are declared here against the code that is actually installed,
// read out of each package's entry file rather than assumed:
//
//   markdown-it-sup / -sub / -ins / -mark / -footnote
//       function <name>_plugin(md) { … }   module.exports = <name>_plugin
//   markdown-it-texmath
//       function texmath(md, options) { … }   module.exports = texmath
//       delimiter sets, read from the source: dollars, brackets, gitlab,
//       julia, kramdown, beg_end
//
// A declaration that is wrong here cannot fail silently: `md.use(plugin)` would
// throw at module load, which the try/catch around each registration in
// markdown.ts already logs and degrades from.
//
// This file deliberately has no top-level import or export. With one, every
// `declare module` below would become a module *augmentation*, and augmentations
// may only target modules that already have types — these have none.

declare module 'markdown-it-sup' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-sub' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-ins' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-mark' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-texmath' {
  import type { PluginWithOptions } from 'markdown-it';

  // Only the options this project passes. texmath's real contract is wider (it
  // takes several engines and more knobs); declaring just these is what makes
  // `delimiters: 'dollar'` a compile error rather than a plugin that silently
  // renders no math at all.
  //
  // Exported, and applied at the call site with `satisfies`, because a plain
  // `md.use(texmath, {…})` does NOT check it: `use<T>(plugin: PluginWithOptions<T>,
  // options?: T)` infers T from the options argument too, and the literal wins —
  // verified by removing a member from this union and watching tsc stay silent.
  export interface TexmathOptions {
    engine: {
      version: string;
      render(tex: string, element: HTMLElement, options?: object): void;
    };
    delimiters: 'dollars' | 'brackets' | 'gitlab' | 'julia' | 'kramdown' | 'beg_end';
    katexOptions?: Record<string, unknown>;
  }

  const plugin: PluginWithOptions<TexmathOptions>;
  export default plugin;
}
