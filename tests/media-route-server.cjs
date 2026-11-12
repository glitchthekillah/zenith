const {createServer}=require('./media-range-server.cjs');
const server=createServer(process.argv[2]);
server.prependListener('request',(req)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/Videos/fixture/stream'&&['video.mkv','pgs.mkv'].includes(url.searchParams.get('file')))req.url='/'+url.searchParams.get('file');
});
server.listen(18488,'127.0.0.1');
