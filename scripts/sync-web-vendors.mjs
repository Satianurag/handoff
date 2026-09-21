import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('web/lib/pdfjs',{recursive:true});
await mkdir('web/lib/maplibre',{recursive:true});
for(const name of ['pdf.mjs','pdf.worker.mjs'])await copyFile(`node_modules/pdfjs-dist/build/${name}`,`web/lib/pdfjs/${name}`);
for(const name of ['maplibre-gl.mjs','maplibre-gl-shared.mjs','maplibre-gl-worker.mjs','maplibre-gl.css'])await copyFile(`node_modules/maplibre-gl/dist/${name}`,`web/lib/maplibre/${name}`);
await copyFile('node_modules/pdfjs-dist/LICENSE','web/lib/pdfjs/LICENSE.txt');
await copyFile('node_modules/maplibre-gl/LICENSE.txt','web/lib/maplibre/LICENSE.txt');
