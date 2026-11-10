import { createDemo, duration, validateClip, edit, encodeWav, safeFilename, getStats } from './audio.js';
import { selectionInput } from './selection.js';
const $ = id => document.getElementById(id);
const labels = {trim:'Trim',delete:'Delete',silence:'Silence',reverse:'Reverse',fadeIn:'Fade in',fadeOut:'Fade out',normalize:'Normalize',gain:'Gain'};
const MAX_HISTORY = 128 * 1024 * 1024;
let clip = createDemo(), name = 'Daylight study', start = 0, end = duration(clip), cursor = 0;
let history = [], future = [], changes = 0, zoom = 1, viewStart = 0, busy = false;
let context, source, gainNode, audioBuffer, animation, playing = false, playTime = 0, playStart = 0, playEnd = 0, loopOrigin = 0, playRequest = 0;
let looping = false, pendingReplacement = null, dragStart = null, dragged = false, pointerX = 0;
const formatTime = seconds => {const ms=Math.max(0,Math.round(seconds*1000));return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;};
const bytes = value => value.channels.reduce((sum,c)=>sum+c.byteLength,0);
const hasSelection = () => Math.round(end * clip.sampleRate) > Math.round(start * clip.sampleRate);
const viewLength = () => duration(clip) / zoom;
const status = message => { $('status').textContent = message; };
const snapshot = () => ({clip,start,end,cursor,changes,name});
function trimHistory(){let size=0;history=history.slice(-40);for(let i=history.length-1;i>=0;i--){size+=bytes(history[i].clip);if(size>MAX_HISTORY && i<history.length-1){history=history.slice(i+1);break;}}}
function restore(state){({clip,start,end,cursor,changes,name}=state);audioBuffer=null;zoom=1;viewStart=0;render(true);}
function pushHistory(){history.push(snapshot());trimHistory();future=[];}
function audioContext(){if(!context){const AudioCtor=window.AudioContext||window.webkitAudioContext;if(!AudioCtor)throw Error('This browser does not support Web Audio. Try a recent Chrome, Safari, Firefox or Edge.');context=new AudioCtor();gainNode=context.createGain();gainNode.gain.value=Number($('volume').value)/100;gainNode.connect(context.destination);}return context;}
function stop(reset=false){playRequest++;if(source){source.onended=null;try{source.stop();}catch{/* already finished */}source.disconnect();source=null;}cancelAnimationFrame(animation);playing=false;if(reset)cursor=start;$('play-icon').textContent='▶';$('play-text').textContent='Play';$('play').setAttribute('aria-label','Play audio');$('stop').disabled=true;updateOverlay();}
function currentPosition(){if(!playing)return cursor;const elapsed=context.currentTime-playTime;if(!looping)return Math.min(playEnd,playStart+elapsed);const firstPass=playEnd-playStart;return elapsed<firstPass?playStart+elapsed:loopOrigin+(elapsed-firstPass)%(playEnd-loopOrigin);}
function pause(){cursor=currentPosition();stop();status(`Paused at ${formatTime(cursor)}.`);}
async function play(){
  if(busy)return;
  if(playing){pause();return;}
  try{
    const request=++playRequest;const ctx=audioContext();await ctx.resume();if(request!==playRequest||busy||playing)return;
    const a=hasSelection()?start:0,b=hasSelection()?end:duration(clip);
    if(cursor<a||cursor>=b-1/clip.sampleRate)cursor=a;
    if(!audioBuffer){audioBuffer=ctx.createBuffer(clip.channels.length,clip.channels[0].length,clip.sampleRate);clip.channels.forEach((c,i)=>audioBuffer.copyToChannel(c,i));}
    source=ctx.createBufferSource();source.buffer=audioBuffer;source.connect(gainNode);source.loop=looping;source.loopStart=start<b?start:0;source.loopEnd=b;
    playStart=cursor;playEnd=b;loopOrigin=source.loopStart;playTime=ctx.currentTime;playing=true;
    source.onended=()=>{cursor=b;stop();status('Playback finished.');};
    if(looping)source.start(0,cursor);else source.start(0,cursor,b-cursor);
    $('play-icon').textContent='Ⅱ';$('play-text').textContent='Pause';$('play').setAttribute('aria-label','Pause playback');$('stop').disabled=false;
    status(looping?'Looping the selected range.':'Playing audio.');
    const tick=()=>{if(!playing)return;cursor=currentPosition();updateOverlay();animation=requestAnimationFrame(tick);};tick();
  }catch(error){stop();status(`Playback unavailable: ${error.message}`);}
}
function updateOverlay(){
  const length=viewLength();const left=Math.max(0,Math.min(100,(start-viewStart)/length*100));const right=Math.max(0,Math.min(100,(end-viewStart)/length*100));
  $('selection-overlay').style.left=`${left}%`;$('selection-overlay').style.width=`${Math.max(0,right-left)}%`;$('selection-overlay').hidden=!hasSelection()||end<=viewStart||start>=viewStart+length;
  const point=(cursor-viewStart)/length*100;$('playhead').hidden=point<0||point>100;$('playhead').style.left=`${point}%`;
  $('position').textContent=formatTime(cursor);
}
function updateSelection(){
  if(document.activeElement!==$('selection-start'))$('selection-start').value=start.toFixed(3);if(document.activeElement!==$('selection-end'))$('selection-end').value=end.toFixed(3);$('selection-start').max=$('selection-end').max=duration(clip);
  $('selection-length').innerHTML=`${(end-start).toFixed(3)} <small>s</small>`;
  $('edit-scope').textContent=hasSelection()?`${(end-start).toFixed(3)}s selected`:'Place a range to edit';
  document.querySelectorAll('[data-edit]').forEach(button=>button.disabled=busy||!hasSelection()||(button.dataset.edit==='delete'&&Math.round((end-start)*clip.sampleRate)>=clip.channels[0].length));
  $('apply-gain').disabled=busy||!hasSelection();$('export').disabled=busy||($('export-selection').checked&&!hasSelection());updateOverlay();
}
function clampView(){viewStart=Math.max(0,Math.min(duration(clip)-viewLength(),viewStart));$('view-scroll').value=duration(clip)>viewLength()?viewStart/(duration(clip)-viewLength())*1000:0;}
function drawWaveform(){
  const canvas=$('waveform'),rect=canvas.getBoundingClientRect();if(!rect.width)return;
  const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const w=rect.width,h=rect.height,count=clip.channels.length,span=viewLength();
  ctx.lineWidth=1;ctx.strokeStyle='#385066';ctx.beginPath();for(let i=0;i<=6;i++){const x=Math.round(i*w/6)+.5;ctx.moveTo(x,0);ctx.lineTo(x,h);}for(let channel=0;channel<count;channel++){const cy=(channel+.5)*h/count;ctx.moveTo(0,cy);ctx.lineTo(w,cy);}ctx.stroke();
  clip.channels.forEach((data,channel)=>{const center=(channel+.5)*h/count,amplitude=h/count*.39;ctx.strokeStyle=channel===0?'#94c8db':'#78a9c2';ctx.beginPath();for(let x=0;x<w;x++){const a=Math.max(0,Math.floor((viewStart+x/w*span)*clip.sampleRate)),b=Math.min(data.length,Math.max(a+1,Math.floor((viewStart+(x+1)/w*span)*clip.sampleRate)));let min=0,max=0;for(let i=a;i<b;i++){min=Math.min(min,data[i]);max=Math.max(max,data[i]);}ctx.moveTo(x+.5,center-Math.min(1,max)*amplitude);ctx.lineTo(x+.5,center-Math.max(-1,min)*amplitude);}ctx.stroke();});
  $('ruler').replaceChildren(...Array.from({length:7},(_,i)=>{const spanEl=document.createElement('span');spanEl.textContent=`${(viewStart+i*span/6).toFixed(span<3?2:1)}s`;return spanEl;}));
  $('view-label').textContent=zoom===1?'FULL CLIP':`${viewStart.toFixed(2)}–${(viewStart+span).toFixed(2)}s`;
  $('zoom-level').textContent=`${zoom}×`;$('zoom-out').disabled=zoom===1;$('zoom-in').disabled=zoom===16;$('scroll-wrap').hidden=zoom===1;updateOverlay();
}
function render(full=false){
  $('clip-name').textContent=name;$('clip-meta').textContent=`${clip.channels.length===2?'Stereo':'Mono'} · ${(clip.sampleRate/1000).toFixed(1)} kHz · ${duration(clip).toFixed(3)} seconds`;
  $('total-time').textContent=formatTime(duration(clip));$('channel-label').textContent=clip.channels.length===2?'L + R':'MONO';document.querySelector('.right-channel').hidden=clip.channels.length===1;document.querySelector('.left-channel').textContent=clip.channels.length===1?'M':'L';
  $('clip-state').textContent=changes?'EDITED':'ORIGINAL';$('clip-state').classList.toggle('edited',changes>0);
  $('undo').disabled=busy||!history.length;$('redo').disabled=busy||!future.length;$('history-count').textContent=history.length?`${history.length} undo step${history.length===1?'':'s'}`:'A fresh start';
  $('export-info').textContent=`16-bit PCM · ${clip.channels.length===2?'stereo':'mono'} · ${(clip.sampleRate/1000).toFixed(1)} kHz`;
  updateSelection();if(full){clampView();drawWaveform();const stats=getStats(clip);$('peak-readout').textContent=`PEAK ${stats.peak? (20*Math.log10(stats.peak)).toFixed(1):'−∞'} dBFS${stats.clipped?' · CLIPPING':''}`;}
}
function select(a,b,announce=false){stop();const length=duration(clip);start=Math.max(0,Math.min(length,Math.min(a,b)));end=Math.max(start,Math.min(length,Math.max(a,b)));start=Math.round(start*clip.sampleRate)/clip.sampleRate;end=Math.round(end*clip.sampleRate)/clip.sampleRate;cursor=start;updateSelection();if(announce)status(hasSelection()?`Selected ${start.toFixed(3)} to ${end.toFixed(3)} seconds.`:`Cursor at ${start.toFixed(3)} seconds.`);}
function perform(action){if(busy||!hasSelection())return;stop();try{const next=edit(clip,action,start,end,Number($('gain').value));pushHistory();clip=next;changes++;audioBuffer=null;if(action==='trim'){start=0;end=duration(clip);zoom=1;viewStart=0;}else if(action==='delete'){end=start=Math.min(start,duration(clip));}cursor=start;render(true);const stats=getStats(clip);status(`${labels[action]} applied.${stats.clipped?' Some samples reach full scale. Undo and reduce gain to avoid distortion.':''}`);}catch(error){status(error.message);}}
function undo(){if(!history.length||busy)return;stop();future.push(snapshot());restore(history.pop());status('Undid the last edit.');}
function redo(){if(!future.length||busy)return;stop();history.push(snapshot());trimHistory();restore(future.pop());status('Redid the edit.');}
function loadClip(next,nextName){stop();clip=next;name=nextName;start=0;end=duration(clip);cursor=0;changes=0;history=[];future=[];audioBuffer=null;zoom=1;viewStart=0;$('export-name').value=safeFilename(name).replace(/\.wav$/i,'');$('export-selection').checked=false;render(true);status(`Opened ${name}. Audio stays in this tab.`);}
function requestReplace(action){if(!changes){action();return;}pendingReplacement=action;$('replace-dialog').showModal();}
function setBusy(value){busy=value;$('editor').classList.toggle('busy',value);for(const id of ['import','demo','play','selection-start','selection-end','select-all','clear-selection'])$(id).disabled=value;render();}
async function importFile(file){if(!file||busy)return;if(file.size>25*1024*1024){status('This file is larger than 25 MB. Choose a smaller audio file.');return;}stop();setBusy(true);status(`Opening ${file.name}…`);try{
  const ctx=audioContext();const decoded=await ctx.decodeAudioData(await file.arrayBuffer());
  if(decoded.numberOfChannels>2)throw Error('Only mono and stereo audio are supported.');
  if(decoded.duration>180)throw Error('Choose audio that is 3 minutes or shorter.');
  if(decoded.length*decoded.numberOfChannels*4>64*1024*1024)throw Error('Decoded audio exceeds the 64 MiB limit.');
  const next={sampleRate:decoded.sampleRate,channels:Array.from({length:decoded.numberOfChannels},(_,i)=>new Float32Array(decoded.getChannelData(i)))};validateClip(next);
  setBusy(false);requestReplace(()=>loadClip(next,file.name.replace(/\.[^.]+$/,'')));
}catch(error){status(`Could not open this audio. ${error.name==='EncodingError'?'The format is unsupported or the file is damaged. Try a WAV or MP3.':error.message}`);}finally{setBusy(false);$('file').value='';}}
$('import').onclick=()=>$('file').click();$('file').onchange=()=>importFile($('file').files[0]);$('demo').onclick=()=>requestReplace(()=>loadClip(createDemo(),'Daylight study'));
$('cancel-replace').onclick=()=>{pendingReplacement=null;$('replace-dialog').close();status('Kept your current audio.');};$('confirm-replace').onclick=()=>{const action=pendingReplacement;pendingReplacement=null;$('replace-dialog').close();action?.();};$('replace-dialog').addEventListener('cancel',()=>{pendingReplacement=null;status('Kept your current audio.');});
$('play').onclick=play;$('stop').onclick=()=>{stop(true);status('Playback stopped.');};$('rewind').onclick=()=>{stop();if(hasSelection()){cursor=start;updateOverlay();}else select(0,0);status('Back to the start.');};$('loop').onclick=()=>{const wasPlaying=playing;stop();looping=!looping;$('loop').setAttribute('aria-pressed',String(looping));status(looping?'Loop is on.':'Loop is off.');if(wasPlaying){cursor=start;play();}};
$('volume').oninput=()=>{if(gainNode)gainNode.gain.setTargetAtTime(Number($('volume').value)/100,context.currentTime,.015);$('volume-value').textContent=`${$('volume').value}%`;};
for(const edge of ['start','end']){const field=$(`selection-${edge}`);const change=(commit)=>{const value=selectionInput(field.value,edge,start,end,duration(clip),commit);if(value===null){field.setAttribute('aria-invalid','true');return;}field.removeAttribute('aria-invalid');select(edge==='start'?value:start,edge==='end'?value:end,commit);if(commit)field.value=(edge==='start'?start:end).toFixed(3);};field.oninput=()=>change(false);field.onchange=field.onblur=()=>change(true);}
$('select-all').onclick=()=>select(0,duration(clip),true);$('clear-selection').onclick=()=>select(cursor,cursor,true);
const wave=$('wave-area');const pointToTime=x=>{const rect=wave.getBoundingClientRect();return viewStart+Math.max(0,Math.min(1,(x-rect.left)/rect.width))*viewLength();};
wave.addEventListener('pointerdown',event=>{if(busy||event.button!==0)return;event.preventDefault();stop();pointerX=event.clientX;dragStart=pointToTime(event.clientX);dragged=false;wave.setPointerCapture(event.pointerId);select(dragStart,dragStart);});
wave.addEventListener('pointermove',event=>{if(dragStart===null)return;if(Math.abs(event.clientX-pointerX)>3)dragged=true;if(dragged)select(dragStart,pointToTime(event.clientX));});
function finishDrag(event){if(dragStart===null)return;if(wave.hasPointerCapture(event.pointerId))wave.releasePointerCapture(event.pointerId);dragStart=null;status(hasSelection()?`Selected ${(end-start).toFixed(3)} seconds. Choose an edit below.`:'Cursor placed. Drag or enter times to select a region.');}
wave.addEventListener('pointerup',finishDrag);wave.addEventListener('pointercancel',finishDrag);
function setZoom(value){const midpoint=hasSelection()?(start+end)/2:cursor;zoom=Math.max(1,Math.min(16,value));viewStart=midpoint-viewLength()/2;clampView();drawWaveform();}
$('zoom-in').onclick=()=>setZoom(zoom*2);$('zoom-out').onclick=()=>setZoom(zoom/2);$('fit').onclick=()=>setZoom(1);$('view-scroll').oninput=()=>{viewStart=Number($('view-scroll').value)/1000*(duration(clip)-viewLength());drawWaveform();};
document.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>perform(button.dataset.edit));$('gain').oninput=()=>{$('gain-value').textContent=`${Number($('gain').value)>0?'+':''}${$('gain').value} dB`;};$('apply-gain').onclick=()=>perform('gain');$('undo').onclick=undo;$('redo').onclick=redo;
$('export-selection').onchange=updateSelection;$('export').onclick=()=>{if(busy)return;try{const selected=$('export-selection').checked;const data=selected?encodeWav(clip,start,end):encodeWav(clip);const blob=new Blob([data],{type:'audio/wav'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=safeFilename($('export-name').value);document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status(`WAV download started: ${safeFilename($('export-name').value)}${selected?' (selection)':''}. Check your browser downloads. Your editing session is still open.`);}catch(error){status(`Export failed: ${error.message}`);}};
$('help').onclick=$('about').onclick=()=>$('guide').showModal();$('close-guide').onclick=()=>$('guide').close();
document.addEventListener('keydown',event=>{if($('guide').open||$('replace-dialog').open)return;const target=event.target;if(target.closest('input,textarea,select,[contenteditable=true]'))return;const modifier=event.ctrlKey||event.metaKey;if(modifier&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}if(modifier&&event.key.toLowerCase()==='a'){event.preventDefault();select(0,duration(clip),true);return;}if(modifier&&event.key.toLowerCase()==='y'){event.preventDefault();redo();return;}if(event.code==='Space'&&!target.closest('button,a,summary')){event.preventDefault();play();}if(event.key==='Escape'){stop(true);status('Playback stopped.');}});
window.addEventListener('beforeunload',event=>{if(changes){event.preventDefault();event.returnValue='';}});
new ResizeObserver(()=>drawWaveform()).observe(wave);render(true);
