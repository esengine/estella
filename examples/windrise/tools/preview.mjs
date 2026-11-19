import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../output/windrise/web');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.esscene':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.css':'text/css'};
const server=http.createServer(async(req,res)=>{
 let rel;try{rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html';}catch{res.writeHead(400).end();return;}
 const file=path.resolve(root,rel),inside=path.relative(root,file);
 if(inside.startsWith('..')||path.isAbsolute(inside)){res.writeHead(403).end();return;}
 try{res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'}).end(await readFile(file));}
 catch{if(!res.headersSent)res.writeHead(404);res.end('Export the Windrise project first.');}
});
server.listen(Number(process.env.PORT||5187),'127.0.0.1',()=>console.log('Windrise: http://127.0.0.1:'+server.address().port));
