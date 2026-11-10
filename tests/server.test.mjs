import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const serverPath = new URL('../server.mjs', import.meta.url);
test('localhost server serves app, modules, images, and rejects hidden paths/methods',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(serverPath)],{env:{...process.env,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  try {
    const output=await Promise.race([once(child.stdout,'data').then(([b])=>b.toString()),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start')),4000);timer.unref();})]);
    const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin);
    const main=await fetch(origin+'/');assert.equal(main.status,200);assert.match(await main.text(),/<title>Kata Wave Room/);
    const module=await fetch(origin+'/src/audio.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
    const icon=await fetch(origin+'/favicon.svg');assert.equal(icon.status,200);
    const hidden=await fetch(origin+'/.git/config');assert.equal(hidden.status,404);
    const missing=await fetch(origin+'/missing');assert.equal(missing.status,404);
    const post=await fetch(origin+'/',{method:'POST'});assert.equal(post.status,405);
  } finally {child.kill();await once(child,'exit');}
});
