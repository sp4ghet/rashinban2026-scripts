import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import net from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveInstallationRoots} from '../bundles/rashinban/src/extension/config/roots.ts';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
let requestedPort;
let input='replay';
let fixture;
for(let index=0;index<args.length;index++){
  const argument=args[index];
  if(argument==='--port'){
    const value=args[++index];
    if(!value || !/^\d+$/.test(value) || Number(value)<1 || Number(value)>65535)throw Error('--port requires a number between 1 and 65535');
    requestedPort=Number(value);
  }else if(argument==='--input'){
    input=args[++index];
    if(input!=='replay'&&input!=='live')throw Error('--input must be replay or live');
  }else if(argument==='--fixture'){
    fixture=args[++index];
    if(!fixture||!/^[A-Za-z0-9_.-]+\.json$/.test(fixture)||fixture.startsWith('..'))throw Error('--fixture requires a replay fixture filename');
  }else throw Error(`Unknown preview argument: ${argument}`);
}

function portAvailable(port){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',error=>error.code==='EADDRINUSE'?resolve(false):reject(error));
    server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));
  });
}
let port=requestedPort??9091;
while(!await portAvailable(port)){
  if(requestedPort!==undefined)throw Error(`Preview port ${port} is already in use`);
  if(++port>9140)throw Error('No free preview port between 9091 and 9140');
}
const roots=resolveInstallationRoots(appRoot);
const cfgPath=path.join(appRoot,'cfg/nodecg.json');
const config=existsSync(cfgPath)?JSON.parse(readFileSync(cfgPath,'utf8')):{};
const temporary=mkdtempSync(path.join(tmpdir(),'rashinban-preview-'));
writeFileSync(path.join(temporary,'nodecg.json'),JSON.stringify({...config,host:'127.0.0.1',port},null,2));
const child=spawn(process.execPath,[path.join(appRoot,'node_modules/nodecg/index.js'),'--cfgPath',temporary],{
  cwd:appRoot,stdio:'inherit',windowsHide:true,
  env:{...process.env,NODECG_ROOT:appRoot,RASHINBAN_SHARED_ROOT:roots.sharedRoot,
    RASHINBAN_PRESENTER_INPUT:input,...(fixture?{RASHINBAN_PRESENTER_REPLAY_FIXTURE:fixture}:{})},
});
console.log(`Preview dashboard: http://127.0.0.1:${port}/dashboard/`);
console.log(`Presenter preview: http://127.0.0.1:${port}/bundles/rashinban/graphics/presenter.html?role=preview`);
console.log(`Configuration: ${roots.isWorktree?'shared defaults with worktree overrides':'shared installation'}; input: ${input}`);
let stopping=false;
function stop(signal){if(!stopping){stopping=true;child.kill(signal);}}
process.on('SIGINT',()=>stop('SIGINT'));
process.on('SIGTERM',()=>stop('SIGTERM'));
function cleanup(){
  const target=path.resolve(temporary);
  if(path.dirname(target)!==path.resolve(tmpdir())||!path.basename(target).startsWith('rashinban-preview-'))throw Error('Unexpected preview configuration directory');
  rmSync(target,{recursive:true,force:true});
}
child.once('error',error=>{cleanup();console.error(`Preview failed to start: ${error.message}`);process.exitCode=1;});
child.once('exit',(code,signal)=>{cleanup();process.exitCode=code??(signal?1:0);});
