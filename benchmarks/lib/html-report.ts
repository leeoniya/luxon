const SHADE_CLASSES = new Map([
  [40, "g"],
  [77, "h"],
  [114, "i"],
  [151, "j"],
  [160, "r"],
  [167, "s"],
  [174, "p"],
  [181, "v"],
]);

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function styledOutput(text: string): string {
  const ansi = /\u001b\[(?:(4);)?(?:38;5;(\d+)|(4))m([\s\S]*?)\u001b\[0m/g;
  let at = 0;
  let html = "";

  for (const match of text.matchAll(ansi)) {
    const index = match.index;
    const color = match[2] === undefined ? undefined : Number(match[2]);
    const classNames: string[] = [];

    if (color !== undefined) {
      const className = SHADE_CLASSES.get(color);

      if (className === undefined) {
        throw new Error(`no HTML class for ANSI color ${color}`);
      }

      classNames.push(className);
    }

    if (match[1] !== undefined || match[3] !== undefined) classNames.push("d");

    html += escapeHtml(text.slice(at, index));
    html += `<span class="${classNames.join(" ")}">${escapeHtml(match[4]!)}</span>`;
    at = index + match[0].length;
  }

  const rest = text.slice(at);
  if (rest.includes("\u001b[")) {
    throw new Error("unsupported ANSI escape in benchmark output");
  }

  return html + escapeHtml(rest);
}

export function htmlReport(output: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body {
  background-color: #232627;
  color: #fcfcfc;
}
.t {
  margin: 0;
  font-family: monospace;
}
.g { color: #00d700; }
.h { color: #5fd75f; }
.i { color: #87d787; }
.j { color: #afd7af; }
.r { color: #d70000; }
.s { color: #d75f5f; }
.p { color: #d78787; }
.v { color: #d7afaf; }
.d {
  text-decoration: underline;
  text-underline-offset: 0.15em;
}
</style>
</head>
<body>
<pre class="t">${styledOutput(output)}</pre>
</body>
</html>
`;
}
