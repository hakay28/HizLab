import express from 'express';
import cors from 'cors';
import {randomBytes} from 'node:crypto';
const app=express();
app.use(cors());
app.use(express.raw({type:'application/octet-stream',limit:'100mb'}));
app.get('/ping',(req,res)=>res.set('Cache-Control','no-store').json({ok:true}));
app.get('/download',(req,res)=>{
 const bytes=Math.min(Math.max(Number(req.query.bytes)||5000000,1024),20000000);
 res.set({'Content-Type':'application/octet-stream','Cache-Control':'no-store, no-transform','Content-Length':String(bytes)});
 const chunk=randomBytes(65536);let left=bytes;
 function write(){while(left>0){const n=Math.min(left,chunk.length);left-=n;if(!res.write(chunk.subarray(0,n)))return res.once('drain',write);}res.end();}
 write();
});
app.post('/upload',(req,res)=>res.set('Cache-Control','no-store').json({received:req.body?.length||0}));
app.listen(process.env.PORT||3001,'0.0.0.0',()=>console.log('Speed test server on port '+(process.env.PORT||3001)));
