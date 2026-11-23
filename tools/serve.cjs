'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8', '.json':'application/json; charset=utf-8' };
const port = Number(process.env.PORT || 4173);
http.createServer((request,response) => {
  let filename;
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    filename = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if (!filename.startsWith(root+path.sep) || pathname.split('/').some(part=>part.startsWith('.'))) throw new Error();
  } catch { response.writeHead(400);response.end('Bad request');return; }
  if (!['GET','HEAD'].includes(request.method)) {response.writeHead(405);response.end();return;}
  fs.readFile(filename,(error,body)=>{
    if(error){response.writeHead(404);response.end('Not found');return;}
    response.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(request.method==='HEAD'?undefined:body);
  });
}).listen(port,'127.0.0.1',()=>console.log(`MindOrbit ready: http://127.0.0.1:${port}`));
