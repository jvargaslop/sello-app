import sharp from 'sharp';

// Tira de sellos (strip de Apple / hero de Google). Sin texto para no depender de fuentes del servidor.
export function stampsSvg(goal, count, color, w, h) {
  const cols = goal <= 6 ? goal : Math.ceil(goal / 2), rows = Math.ceil(goal / cols);
  const cw = w / cols, ch = h / rows, r = Math.min(cw, ch) * 0.34;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${color}"/>`;
  for (let i = 0; i < goal; i++) {
    const cx = (i % cols + 0.5) * cw, cy = (Math.floor(i / cols) + 0.5) * ch;
    if (i < count) {
      s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/><path d="M-.42 .02L-.12 .34L.44 -.3" transform="translate(${cx} ${cy}) scale(${r})" fill="none" stroke="${color}" stroke-width=".16" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${Math.max(2, r * 0.07)}" stroke-dasharray="${r * 0.3} ${r * 0.22}"/>`;
    }
  }
  return s + '</svg>';
}
export const stampsPng = (goal, count, color, w, h) => sharp(Buffer.from(stampsSvg(goal, count, color, w, h))).png().toBuffer();

// Logo/ícono: anillo con punto, igual que la marca de la app.
export function logoPng(color, size) {
  const s = size;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${s * 0.22}" fill="${color}"/><circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.26}" fill="none" stroke="#fff" stroke-width="${s * 0.08}"/><circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.09}" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
