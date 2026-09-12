import { readFile } from 'node:fs/promises';
export function readWebAsset(name: 'index.html' | 'app.js' | 'style.css' | 'login.html' | 'login.js' | 'login.css'): Promise<Buffer> {
  return readFile(new URL(`../public/${name}`, import.meta.url));
}
