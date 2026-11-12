const {createServer}=require('./media-range-server.cjs');
const server=createServer(process.argv[2]);
server.prependListener('request',(req)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/Videos/fixture/stream'&&['video.mkv','pgs.mkv'].includes(url.searchParams.get('file')))req.url='/'+url.searchParams.get('file');
});
server.listen(18488,'127.0.0.1');
if(process.env.ZENITH_FIXTURE_TLS_CERT){
 const fs=require('node:fs');
 require('node:https').createServer({cert:fs.readFileSync(process.env.ZENITH_FIXTURE_TLS_CERT),key:fs.readFileSync(process.env.ZENITH_FIXTURE_TLS_KEY)},(req,res)=>server.emit('request',req,res)).listen(18489,'127.0.0.1');
}
