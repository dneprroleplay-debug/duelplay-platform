// QR encoder adapted from qrcode-terminal's vendored QRCode implementation.
// Copyright (c) 2009 Kazuhiko Arase; MIT license. See lib/qr/LICENSE.txt.
// Generated locally on the server; the MFA secret is never sent to a third party.
import { Buffer } from "node:buffer";
// The upstream implementation is CommonJS JavaScript.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require("./qr/index.js") as new (typeNumber: number, errorCorrectLevel: number) => {
  addData(value: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
};

export function makeQrDataUrl(value: string): string {
  const qr = new QRCode(0, 1); // automatic version, error correction level L
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const size = count + quiet * 2;
  const paths: string[] = [];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (qr.isDark(y, x)) paths.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${paths.join("")}" fill="#000"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
