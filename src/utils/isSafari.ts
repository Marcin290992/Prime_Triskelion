// Standard UA-sniffing pattern for "real Safari" — excludes Chrome/Chromium
// and Android WebView, both of which also carry "Safari" in their own UA
// string. There's no reliable feature-detection substitute for this: what
// we actually need to know is "which rendering engine is this," and no CSS/
// JS API exposes that directly.
export function isSafari(): boolean {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}
