import { lazy, Suspense, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from "react";

type SyntaxTheme = "dark" | "light";

interface LoadedSyntaxHighlighterProps {
  code: string;
  language: string;
  theme: SyntaxTheme;
  customStyle?: CSSProperties;
  codeTagProps?: HTMLAttributes<HTMLElement>;
  PreTag?: ElementType;
  CodeTag?: ElementType;
}

interface CodeSyntaxHighlighterProps extends LoadedSyntaxHighlighterProps {
  fallback?: ReactNode;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  html: "markup",
  svg: "markup",
  xml: "markup",
  js: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  py: "python",
  rb: "ruby",
};

function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

const LoadedSyntaxHighlighter = lazy(async () => {
  const [
    { default: PrismLight },
    darkTheme,
    lightTheme,
    bash,
    c,
    cpp,
    csharp,
    css,
    diff,
    docker,
    go,
    graphql,
    ini,
    java,
    javascript,
    json,
    jsx,
    kotlin,
    markdown,
    markup,
    php,
    python,
    ruby,
    rust,
    sql,
    swift,
    toml,
    tsx,
    typescript,
    yaml,
  ] = await Promise.all([
    import("react-syntax-highlighter/dist/esm/prism-light"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-light"),
    import("react-syntax-highlighter/dist/esm/languages/prism/bash"),
    import("react-syntax-highlighter/dist/esm/languages/prism/c"),
    import("react-syntax-highlighter/dist/esm/languages/prism/cpp"),
    import("react-syntax-highlighter/dist/esm/languages/prism/csharp"),
    import("react-syntax-highlighter/dist/esm/languages/prism/css"),
    import("react-syntax-highlighter/dist/esm/languages/prism/diff"),
    import("react-syntax-highlighter/dist/esm/languages/prism/docker"),
    import("react-syntax-highlighter/dist/esm/languages/prism/go"),
    import("react-syntax-highlighter/dist/esm/languages/prism/graphql"),
    import("react-syntax-highlighter/dist/esm/languages/prism/ini"),
    import("react-syntax-highlighter/dist/esm/languages/prism/java"),
    import("react-syntax-highlighter/dist/esm/languages/prism/javascript"),
    import("react-syntax-highlighter/dist/esm/languages/prism/json"),
    import("react-syntax-highlighter/dist/esm/languages/prism/jsx"),
    import("react-syntax-highlighter/dist/esm/languages/prism/kotlin"),
    import("react-syntax-highlighter/dist/esm/languages/prism/markdown"),
    import("react-syntax-highlighter/dist/esm/languages/prism/markup"),
    import("react-syntax-highlighter/dist/esm/languages/prism/php"),
    import("react-syntax-highlighter/dist/esm/languages/prism/python"),
    import("react-syntax-highlighter/dist/esm/languages/prism/ruby"),
    import("react-syntax-highlighter/dist/esm/languages/prism/rust"),
    import("react-syntax-highlighter/dist/esm/languages/prism/sql"),
    import("react-syntax-highlighter/dist/esm/languages/prism/swift"),
    import("react-syntax-highlighter/dist/esm/languages/prism/toml"),
    import("react-syntax-highlighter/dist/esm/languages/prism/tsx"),
    import("react-syntax-highlighter/dist/esm/languages/prism/typescript"),
    import("react-syntax-highlighter/dist/esm/languages/prism/yaml"),
  ]);

  PrismLight.registerLanguage("bash", bash.default);
  PrismLight.registerLanguage("c", c.default);
  PrismLight.registerLanguage("cpp", cpp.default);
  PrismLight.registerLanguage("csharp", csharp.default);
  PrismLight.registerLanguage("css", css.default);
  PrismLight.registerLanguage("diff", diff.default);
  PrismLight.registerLanguage("docker", docker.default);
  PrismLight.registerLanguage("go", go.default);
  PrismLight.registerLanguage("graphql", graphql.default);
  PrismLight.registerLanguage("ini", ini.default);
  PrismLight.registerLanguage("java", java.default);
  PrismLight.registerLanguage("javascript", javascript.default);
  PrismLight.registerLanguage("json", json.default);
  PrismLight.registerLanguage("jsx", jsx.default);
  PrismLight.registerLanguage("kotlin", kotlin.default);
  PrismLight.registerLanguage("markdown", markdown.default);
  PrismLight.registerLanguage("markup", markup.default);
  PrismLight.registerLanguage("php", php.default);
  PrismLight.registerLanguage("python", python.default);
  PrismLight.registerLanguage("ruby", ruby.default);
  PrismLight.registerLanguage("rust", rust.default);
  PrismLight.registerLanguage("sql", sql.default);
  PrismLight.registerLanguage("swift", swift.default);
  PrismLight.registerLanguage("toml", toml.default);
  PrismLight.registerLanguage("tsx", tsx.default);
  PrismLight.registerLanguage("typescript", typescript.default);
  PrismLight.registerLanguage("yaml", yaml.default);

  return {
    default: function LoadedSyntaxHighlighterComponent({
      code,
      language,
      theme,
      ...props
    }: LoadedSyntaxHighlighterProps) {
      return (
        <PrismLight
          {...props}
          language={normalizeLanguage(language)}
          style={theme === "light" ? lightTheme.default : darkTheme.default}
        >
          {code}
        </PrismLight>
      );
    },
  };
});

export function CodeSyntaxHighlighter({
  code,
  fallback,
  ...props
}: CodeSyntaxHighlighterProps) {
  return (
    <Suspense fallback={fallback ?? <code>{code}</code>}>
      <LoadedSyntaxHighlighter code={code} {...props} />
    </Suspense>
  );
}
