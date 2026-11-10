import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('../dist/', import.meta.url);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of [
  'index.html',
  'menu.html',
  'about.html',
  'news.html',
  'contact.html',
  'checkout.html',
  'payment-return.html',
  'orders.html',
  'admin.html',
  'robots.txt',
  'sitemap.xml'
]) {
  await cp(new URL(file, root), new URL(file, output));
}
for (const directory of ['css', 'js', 'images']) {
  await cp(new URL(`${directory}/`, root), new URL(`${directory}/`, output), { recursive: true });
}
