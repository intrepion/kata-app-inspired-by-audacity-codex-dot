import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('dist/src', { recursive: true });
for (const file of ['index.html','styles.css','favicon.svg','app.json','LICENSE']) await copyFile(file, `dist/${file}`);
await cp('src', 'dist/src', {recursive:true});
await cp('docs/screenshots', 'dist/docs/screenshots', {recursive:true});
console.log('Static app built in dist/. No network, bundler, or runtime dependencies.');
