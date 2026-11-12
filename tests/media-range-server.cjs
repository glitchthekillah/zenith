// Local synthetic-media fixture server with the byte ranges real playback needs.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
function createServer(directory){
 const root=path.resolve(directory);
 return http.createServer((req,res)=>{
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400).end();return}
  const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)||!['GET','HEAD'].includes(req.method)){res.writeHead(403).end();return}
  let size;try{size=fs.statSync(file).size}catch{res.writeHead(404).end();return}
  const mime={'.html':'text/html','.mp4':'video/mp4','.mkv':'video/x-matroska'}[path.extname(file)]||'application/octet-stream';
  let start=0,end=size-1,status=200;
  const headers={'Content-Type':mime,'Accept-Ranges':'bytes'};
  if(req.headers.range){
   const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
   if(m&&(m[1]||m[2])){start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));end=m[1]&&m[2]?Math.min(size-1,Number(m[2])):size-1}
   if(!m||(!m[1]&&!m[2])||start>=size||end<start){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return}
   status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length']=end-start+1;
  res.writeHead(status,headers);
  if(req.method==='HEAD'){res.end();return}
  const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 });
}
module.exports={createServer};
if(require.main===module)createServer(process.argv[2]).listen(18488,'127.0.0.1');
