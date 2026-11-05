// Use a tight, transparent PocketMark for tabs and maskable-safe padding for home screens.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const root = new URL("../",import.meta.url);
const mark = '<path d="M5 7h28v16c0 8-6 13-14 16C11 36 5 31 5 23V7Z" fill="#8155d9"/><path d="M12 15h14M12 21h8" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="m30 1 1.8 4.2L36 7l-4.2 1.8L30 13l-1.8-4.2L24 7l4.2-1.8L30 1Z" fill="#d4ee8b"/>';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#faf8f2"/><g transform="translate(127 113) scale(6.8)">${mark}</g></svg>`;
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -1 42 42">${mark}</svg>`;
await mkdir(new URL("public/icons/",root),{recursive:true});
for (const size of [192,512]) {
  const png = await sharp(Buffer.from(svg)).resize(size,size).png().toBuffer();
  await writeFile(new URL(`public/icons/pocket-base-${size}.png`,root),png);
  await writeFile(new URL(`public/icons/pocket-base-maskable-${size}.png`,root),png);
}
await writeFile(new URL("src/app/apple-icon.png",root),await sharp(Buffer.from(svg)).resize(180,180).png().toBuffer());
await writeFile(new URL("src/app/icon.svg",root),faviconSvg);
const sizes=[16,32,48];
const images=await Promise.all(sizes.map(size=>sharp(Buffer.from(faviconSvg)).resize(size,size).png().toBuffer()));
const header=Buffer.alloc(6+16*sizes.length); header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(let i=0;i<sizes.length;i++) {
  const at=6+16*i; header[at]=sizes[i]; header[at+1]=sizes[i];
  header.writeUInt16LE(1,at+4); header.writeUInt16LE(32,at+6);
  header.writeUInt32LE(images[i].length,at+8); header.writeUInt32LE(offset,at+12); offset+=images[i].length;
}
await writeFile(new URL("src/app/favicon.ico",root),Buffer.concat([header,...images]));
