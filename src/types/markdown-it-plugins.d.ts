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
  import type { PluginWithOptions, StateBlock, StateInline } from 'markdown-it';

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

  // One delimiter rule. texmath keeps these in `texmath.rules`, keyed by
  // delimiter-set name, and reads the same objects in `mergeDelimiters` — so
  // they are the library's extension point, not an internal. markdown.ts reads
  // one member out of here to restate it with a narrower regexp, which is why
  // the shape is declared rather than left as `any`: read from the installed
  // source, `texmath.rules.dollars.inline` and the `rex`/`pre`/`post`/
  // `tmpl`/`tag` members each rule carries.
  //
  // `pre` and `post` are the guards on the characters *outside* the delimiters —
  // what may precede the opening one and what may follow the closing one.
  export interface TexmathRule {
    name: string;
    rex: RegExp;
    tmpl: string;
    tag: string;
    displayMode?: boolean;
    outerSpace?: boolean;
    pre?(str: string, outerSpace: boolean, pos: number): boolean;
    post?(str: string, outerSpace: boolean, pos: number): boolean;
  }

  export interface TexmathDelimiterSet {
    inline: TexmathRule[];
    block: TexmathRule[];
  }

  // The factories texmath uses to turn one rule into a markdown-it rule,
  // exported alongside `rules` and the counterpart to it: a rule re-stated
  // through one of these is registered the way texmath would have registered
  // it. markdown.ts uses both — the inline factory for `$…$` and the block
  // factory for `$$…$$`.
  const plugin: PluginWithOptions<TexmathOptions> & {
    rules: Record<string, TexmathDelimiterSet>;
    inline(rule: TexmathRule): (state: StateInline, silent: boolean) => boolean;
    block(rule: TexmathRule): (state: StateBlock, begLine: number, endLine: number, silent: boolean) => boolean;
  };
  export default plugin;
}
