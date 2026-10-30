// plugin templates are bundled as text (esbuild --loader:.txt=text)
declare module '*.txt' { const text: string; export default text; }
